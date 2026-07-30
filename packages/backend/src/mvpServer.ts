import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ZodError } from 'zod'
import type { RoleRunner } from './agent/RoleRunner'
import { isPresentableAgentRuntimeEvent } from './agent/runtimeEvents'
import {
  deriveAssistantFeedActivity,
  goalCompletionProjection,
  presentAssistantFeed,
  presentAssistantFeedChanges,
} from './api/assistantFeedPresenter'
import {
  deriveGoalSummaries,
  deriveWorkCompletedAt,
  latestAgentPlan,
  presentAttempt,
  presentGoal,
  presentGoalExecutionCost,
} from './api/goalPresenter'
import {
  ApiError,
  inlineContentDisposition,
  json,
  parseBody,
  readAssistantChangeCursor,
  readPageRequest,
  requirePart,
} from './api/http'
import {
  agentRoleSettingsSchema,
  canonicalInboxContext,
  configurableAgentRoleSchema,
  goalSchema,
  parseInboxRequest,
  parsePreviewStartRequest,
  projectAgentAccessSchema,
  projectLabelUpdateSchema,
  projectRepoSchema,
  projectSchema,
  rebindProjectSchema,
  repoPathSchema,
} from './api/requestSchemas'
import {
  isDesignDocumentPath,
  matchEvidenceArtifactRoute,
  matchGoalDocumentRoute,
  matchGoalRoute,
  matchPreviewRoute,
  matchWorkAttemptRoute,
  matchWorkDocumentRoute,
  readGoalView,
} from './api/routeMatchers'
import { presentState } from './api/statePresenter'
import type { AssistantConversationScope } from './assistant/assistantConversationScope'
import { AssistantToolRequestError } from './assistant/assistantToolRequestError'
import { assistantToolRequestSchema } from './assistant/assistantToolSchemas'
import type { AssistantModelRunner } from './assistant/workspaceAssistant'
import {
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from './domain/attentionReference'
import { GoalPackageNotFoundError } from './domain/goalPackage'
import { normalizeProjectCodingDefaults } from './domain/projectCodingDefaults'
import { resolveProjectPath } from './domain/projectPath'
import { deriveReadableId, stableIdSchema } from './domain/stableId'
import { CursorPageError, paginateItems } from './presentation/cursorPage'
import indexPage from './product.html'
import { acquireCoordinatorInstanceLock } from './publication/instanceLock'
import type { PublicationCoordinator } from './publication/publisher'
import { defaultAssistantHomeRoot } from './runtime/assistantHomeRoot'
import {
  type AttentionTransport,
  createWebhookAttentionTransport,
} from './runtime/attentionDelivery'
import {
  EvidenceArtifactResolutionError,
  inlineArtifactMediaType,
  resolveEvidenceArtifact,
} from './runtime/evidenceArtifacts'
import { GoalControllerError } from './runtime/goalController'
import { HostDirectoryPickerError, selectHostDirectory } from './runtime/hostDirectoryPicker'
import { assertSupportedPlatform } from './runtime/hostPlatform'
import { type MvpRuntime, requireProject } from './runtime/mvpRuntime'
import { createMvpRuntimeHost } from './runtime/mvpRuntimeHost'
import { readProjectReleaseHeads } from './runtime/previewManager'
import {
  ProjectDirectoryError,
  classifyProjectDirectory,
  withPreparedProjectRepositories,
} from './runtime/projectDirectory'
import type { RunAttemptDiagnostics } from './runtime/runAttemptDiagnostics'
import type { RunAttemptStore } from './runtime/runAttemptStore'
import { summarizeRunCosts } from './runtime/runCostProjection'
import { AssistantHomeStoreError } from './storage/assistantHomeStore'
import { AssistantImageAttachmentError } from './storage/assistantImageAttachments'
import { createProjectAgentAccessStore } from './storage/projectAgentAccessStore'

export interface ServerOptions {
  rootDir?: string
  port?: number
  instanceId?: string
  publisher?: PublicationCoordinator
  attempts?: RunAttemptStore
  roleRunner?: RoleRunner
  assistantRunner?: AssistantModelRunner
  attentionTransport?: AttentionTransport
  startCoordinator?: boolean
  directoryPicker?: () => Promise<string | null>
}

export type MvpServer = Bun.Server<undefined> & {
  shutdown(): Promise<void>
}

export {
  deriveAssistantFeedActivity,
  deriveGoalSummaries,
  deriveWorkCompletedAt,
  goalCompletionProjection,
  latestAgentPlan,
  presentAttempt,
}

export function createServer(options: ServerOptions = {}): MvpServer {
  assertSupportedPlatform(process.platform)
  const homeRoot = options.rootDir ?? process.cwd()
  const serverStartedAt = new Date().toISOString()
  const serverRef: { current: Bun.Server<undefined> | null } = {
    current: null,
  }
  const projectAgentAccess = createProjectAgentAccessStore(homeRoot)
  const runtimeHost = createMvpRuntimeHost(
    {
      homeRoot,
      publisher: options.publisher,
      attempts: options.attempts,
      roleRunner: options.roleRunner,
      assistantRunner: options.assistantRunner,
      attentionTransport:
        options.attentionTransport ??
        (process.env.HOPI_ATTENTION_WEBHOOK_URL
          ? createWebhookAttentionTransport(process.env.HOPI_ATTENTION_WEBHOOK_URL)
          : undefined),
      assistantToolUrl: () => {
        if (!serverRef.current) throw new Error('Assistant tool server is not ready')
        return `http://127.0.0.1:${serverRef.current.port}/api/internal/assistant-tool`
      },
      projectFullAccess: async (projectId) => (await projectAgentAccess.read(projectId)).fullAccess,
    },
    { startCoordinator: options.startCoordinator !== false },
  )
  const pickDirectory = createSingleFlight(options.directoryPicker ?? selectHostDirectory)

  async function updateRuntimeProjectLabel(projectId: string, label: string | null) {
    return runtimeHost.withStableRuntime(async (runtime) => {
      const project = runtime.projects.get(projectId)
      if (!project) throw new ApiError(404, `Project not found: ${projectId}`)
      const updated = await runtime.home.updateProjectLabel({ projectId, label })
      if (updated.label) project.label = updated.label
      else project.label = undefined
      return runtime
    })
  }

  const server = Bun.serve({
    reusePort: false,
    routes: {
      '/': indexPage,
      '/projects': indexPage,
      '/projects/*': indexPage,
    },
    port: options.port ?? 3000,
    development: false,
    async fetch(request) {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      try {
        if (request.method === 'GET' && url.pathname === '/api/health') {
          const runtimeHealth = runtimeHost.health()
          const coordinator = runtimeHealth.runtime?.coordinator.health() ?? null
          return json({
            status: runtimeHealth.initializationError
              ? 'degraded'
              : runtimeHealth.runtime
                ? coordinator?.status === 'degraded'
                  ? 'degraded'
                  : 'ok'
                : 'starting',
            pid: process.pid,
            instanceId: options.instanceId ?? null,
            startedAt: serverStartedAt,
            runtimeError: runtimeHealth.initializationError,
            coordinator,
          })
        }
        const runtime = await runtimeHost.current()
        if (request.method === 'POST' && url.pathname === '/api/internal/assistant-tool') {
          const body = await parseBody(request, assistantToolRequestSchema)
          return json(await runtime.assistantTools.execute(body.token, body.name, body.arguments))
        }
        if (request.method === 'GET' && url.pathname === '/api/state') {
          return json(
            await presentState(runtime, {
              includeAttentions: url.searchParams.get('view') !== 'shell',
            }),
          )
        }
        if (request.method === 'POST' && url.pathname === '/api/system/select-directory') {
          try {
            const path = await pickDirectory()
            return json({
              selection: path ? await classifyProjectDirectory(path) : null,
            })
          } catch (error) {
            if (error instanceof HostDirectoryPickerError) {
              throw new ApiError(503, error.message)
            }
            throw error
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/feed/changes') {
          return json(
            await presentAssistantFeedChanges(
              runtime,
              readAssistantChangeCursor(url),
              readAssistantConversationScope(runtime, url),
              url.searchParams.get('streamId')?.trim() || null,
            ),
          )
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/feed') {
          return json(
            await presentAssistantFeed(
              runtime,
              readPageRequest(url, 40, 100),
              readAssistantConversationScope(runtime, url),
            ),
          )
        }
        if (
          request.method === 'PATCH' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'agent-roles' &&
          parts[3] === 'settings'
        ) {
          const role = configurableAgentRoleSchema.parse(requirePart(parts, 2))
          const body = await parseBody(request, agentRoleSettingsSchema)
          await runtime.updateAgentRoleCodingDefaults(
            role,
            body.codingDefaults === null
              ? null
              : normalizeProjectCodingDefaults(body.codingDefaults),
          )
          return json(await presentState(runtime))
        }
        if (
          request.method === 'GET' &&
          parts.length === 5 &&
          parts[0] === 'api' &&
          parts[1] === 'assistant' &&
          parts[2] === 'attachments'
        ) {
          const reference = `${runtime.workspace.paths.attachmentRoot}/${parts[3]}/${parts[4]}`
          try {
            const attachment = await runtime.workspace.resolveAttachment(reference)
            if (!attachment) throw new ApiError(404, 'Image attachment not found')
            return new Response(Bun.file(attachment.absolutePath), {
              headers: {
                'cache-control': 'private, immutable, max-age=31536000',
                'content-type': attachment.mediaType,
                'x-content-type-options': 'nosniff',
              },
            })
          } catch (error) {
            if (error instanceof ApiError) throw error
            if (error instanceof AssistantImageAttachmentError) {
              throw new ApiError(404, error.message)
            }
            throw error
          }
        }
        if (request.method === 'GET' && url.pathname === '/api/debug/wakes') {
          const runs = (await runtime.wake.listRunSummaries()).toSorted(
            (left, right) =>
              left.manifest.startedAt.localeCompare(right.manifest.startedAt) ||
              left.manifest.wakeId.localeCompare(right.manifest.wakeId),
          )
          return json(
            paginateItems(runs, readPageRequest(url, 20, 100), {
              scope: 'wake-runs',
              getId: (run) => run.manifest.wakeId,
            }),
          )
        }
        if (
          request.method === 'GET' &&
          parts.length === 5 &&
          parts[0] === 'api' &&
          parts[1] === 'debug' &&
          parts[2] === 'wakes' &&
          parts[3] &&
          parts[4] === 'events'
        ) {
          const wakeId = parts[3]
          const events = await runtime.wake.readRunEvents(wakeId)
          if (!events) throw new ApiError(404, `Wake Run not found: ${wakeId}`)
          const indexedEvents = events.map((event, streamIndex) => ({
            ...event,
            streamIndex,
          }))
          return json(
            paginateItems(indexedEvents, readPageRequest(url, 80, 200), {
              scope: `wake-events:${wakeId}`,
              getId: (event) => event.eventId,
            }),
          )
        }
        if (request.method === 'POST' && url.pathname === '/api/projects') {
          const body = await parseBody(request, projectSchema)
          const nextRuntime = await runtimeHost.reload(async (current) => {
            await withPreparedProjectRepositories(body.repos, (repos) =>
              current.home.linkProject({
                ...(body.projectId ? { projectId: body.projectId } : {}),
                ...(body.label ? { label: body.label } : {}),
                primaryRepoId: body.primaryRepoId,
                repos,
              }),
            )
          })
          return json(await presentState(await nextRuntime), 201)
        }
        if (
          request.method === 'PUT' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'label'
        ) {
          const projectId = requirePart(parts, 2)
          const body = await parseBody(request, projectLabelUpdateSchema)
          return json(await presentState(await updateRuntimeProjectLabel(projectId, body.label)))
        }
        if (
          (request.method === 'GET' || request.method === 'PUT') &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'agent-access'
        ) {
          const projectId = requirePart(parts, 2)
          requireProject(runtime.projects, projectId)
          if (request.method === 'GET') {
            return json({ projectId, ...(await projectAgentAccess.read(projectId)) })
          }
          const body = await parseBody(request, projectAgentAccessSchema)
          return json(await projectAgentAccess.write(projectId, body.fullAccess))
        }
        if (
          request.method === 'POST' &&
          parts.length === 5 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'rebind' &&
          parts[4] === 'plan'
        ) {
          const projectId = requirePart(parts, 2)
          const body = await parseBody(request, rebindProjectSchema)
          return json(await runtime.commands.planProjectRebind({ projectId, repos: body.repos }))
        }
        if (
          request.method === 'POST' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'rebind'
        ) {
          const projectId = requirePart(parts, 2)
          const body = await parseBody(request, rebindProjectSchema)
          const nextRuntime = await runtimeHost.reload(async (current) => {
            await current.commands.executeProjectRebind({ projectId, repos: body.repos })
          })
          return json(await presentState(await nextRuntime))
        }
        if (
          request.method === 'POST' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'repos'
        ) {
          const projectId = requirePart(parts, 2)
          const body = await parseBody(request, projectRepoSchema)
          const nextRuntime = await runtimeHost.reload(async (current) => {
            await withPreparedProjectRepositories([body], ([repo]) => {
              if (!repo) throw new Error('Prepared Repo is missing')
              return current.home.linkRepo({ projectId, ...repo })
            })
          })
          return json(await presentState(await nextRuntime), 201)
        }
        if (
          request.method === 'POST' &&
          parts.length === 6 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'repos' &&
          parts[5] === 'rebind'
        ) {
          const projectId = requirePart(parts, 2)
          const repoId = requirePart(parts, 4)
          const body = await parseBody(request, repoPathSchema)
          const nextRuntime = await runtimeHost.reload(async (current) => {
            await current.rebindRepo(projectId, repoId, body.repoPath, body.projectPath)
          })
          return json(await presentState(await nextRuntime))
        }
        if (
          request.method === 'POST' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'goals'
        ) {
          const project = requireProject(runtime.projects, requirePart(parts, 2))
          const body = await parseBody(request, goalSchema)
          const goalId =
            body.goalId ?? deriveReadableId('G', body.title, await project.store.listGoalIds())
          await executeDirectUserCommand(runtime, {
            content: `Create Goal ${goalId}: ${body.title}\n\n${body.objective}`,
            tool: 'hopi_create_goal',
            input: {
              projectId: project.projectId,
              goalId,
              title: body.title,
              objective: body.objective,
              priority: body.priority,
              firstWork: { kind: 'planning' },
            },
            reply: `Created Goal ${goalId}.`,
            disposition: 'tool:create_goal',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalId), 201)
        }
        if (request.method === 'POST' && url.pathname === '/api/inbox') {
          const body = await parseInboxRequest(request)
          const context = canonicalInboxContext(body.context)
          if (body.context?.projectId) {
            const project = requireProject(runtime.projects, body.context.projectId)
            if (body.context.goalId && !(await project.store.readGoal(body.context.goalId))) {
              throw new ApiError(404, `Goal not found: ${body.context.goalId}`)
            }
          }
          for (const reference of body.context
            ? normalizeInboxAttentionReferences(body.context)
            : []) {
            const parsed = parseAttentionReference(reference)
            if (parsed?.scope === 'workspace') {
              const workspace = await runtime.workspace.readWorkspace()
              if (
                parsed.homeId !== workspace.homeId ||
                !workspace.attentions.has(parsed.attentionId)
              ) {
                throw new ApiError(404, 'Workspace Attention not found')
              }
              continue
            }
            if (parsed?.scope === 'goal') {
              const project = requireProject(runtime.projects, parsed.projectId)
              const goalPackage = await project.store.readPackage(parsed.goalId)
              if (!goalPackage.attentions.has(parsed.attentionId)) {
                throw new ApiError(404, 'Goal Attention not found')
              }
            }
          }
          const event = await receiveUserEvent(runtime, {
            content: body.content,
            images: body.images,
            context,
          })
          runtime.coordinator.wake()
          return json(
            {
              eventId: event.attributes.id,
              status: (await runtime.workspace.readEvent(event.attributes.id))?.attributes.status,
            },
            202,
          )
        }

        const attemptRoute = matchWorkAttemptRoute(parts)
        if (attemptRoute && request.method === 'GET') {
          const project = requireProject(runtime.projects, attemptRoute.projectId)
          const goalPackage = await project.store.readPackage(attemptRoute.goalId)
          if (!goalPackage.works.has(attemptRoute.workId)) {
            throw new ApiError(404, `Work not found: ${attemptRoute.workId}`)
          }
          if (attemptRoute.runId === null) {
            const attempts = await runtime.attempts.list(
              attemptRoute.projectId,
              attemptRoute.goalId,
              attemptRoute.workId,
            )
            const diagnostics: Array<RunAttemptDiagnostics | null> = []
            for (const attempt of attempts) {
              diagnostics.push(
                await runtime.attempts.readDiagnostics(
                  attemptRoute.projectId,
                  attemptRoute.goalId,
                  attemptRoute.workId,
                  attempt.runId,
                ),
              )
            }
            const presentedAttempts = attempts.map((attempt, index) => ({
              ...presentAttempt(attempt, goalPackage, attemptRoute.projectId, attemptRoute.goalId),
              diagnostics: diagnostics[index] ?? null,
            }))
            return json({
              attempts: presentedAttempts,
              summary: summarizeRunCosts(
                presentedAttempts.flatMap((attempt) =>
                  attempt.diagnostics ? [{ ...attempt, diagnostics: attempt.diagnostics }] : [],
                ),
              ),
            })
          }
          const attempt = await runtime.attempts.readMetadata(
            attemptRoute.projectId,
            attemptRoute.goalId,
            attemptRoute.workId,
            attemptRoute.runId,
          )
          if (!attempt) throw new ApiError(404, `Attempt not found: ${attemptRoute.runId}`)
          if (attemptRoute.events) {
            const events = await runtime.attempts.readEvents(
              attemptRoute.projectId,
              attemptRoute.goalId,
              attemptRoute.workId,
              attemptRoute.runId,
            )
            const indexedEvents = (events ?? [])
              .map((event, streamIndex) => ({
                ...event,
                streamIndex,
              }))
              .filter(isPresentableAgentRuntimeEvent)
            return json(
              paginateItems(indexedEvents, readPageRequest(url, 80, 200), {
                scope: `attempt-events:${attemptRoute.projectId}:${attemptRoute.goalId}:${attemptRoute.workId}:${attemptRoute.runId}`,
                getId: (event) => event.eventId,
              }),
            )
          }
          return json({
            ...presentAttempt(attempt, goalPackage, attemptRoute.projectId, attemptRoute.goalId),
            diagnostics: await runtime.attempts.readDiagnostics(
              attemptRoute.projectId,
              attemptRoute.goalId,
              attemptRoute.workId,
              attemptRoute.runId,
            ),
          })
        }

        const evidenceArtifactRoute = matchEvidenceArtifactRoute(parts)
        if (evidenceArtifactRoute && request.method === 'GET') {
          const project = requireProject(runtime.projects, evidenceArtifactRoute.projectId)
          const goalPackage = await project.store.readPackage(evidenceArtifactRoute.goalId)
          const evidence = goalPackage.evidence.get(evidenceArtifactRoute.evidenceId)
          if (
            !evidence ||
            ![...goalPackage.works.values()].some((work) =>
              work.attributes.evidenceRefs.includes(evidenceArtifactRoute.evidenceId),
            )
          ) {
            throw new ApiError(404, 'Evidence not found')
          }
          const reference = evidence.attributes.artifacts[evidenceArtifactRoute.artifactIndex]
          if (!reference) throw new ApiError(404, 'Evidence artifact not found')
          try {
            const artifact = await resolveEvidenceArtifact({
              homeRoot: runtime.homeRoot,
              project,
              reference,
            })
            if (artifact.kind === 'directory') {
              return json({
                kind: 'directory',
                name: artifact.fileName,
                ...(await directoryArtifactIndex(artifact.path)),
              })
            }
            return new Response(Bun.file(artifact.path), {
              headers: {
                'cache-control': 'private, no-store',
                'content-disposition': inlineContentDisposition(artifact.fileName),
                'content-security-policy':
                  "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
                'content-type': inlineArtifactMediaType(artifact.fileName),
                'x-content-type-options': 'nosniff',
              },
            })
          } catch (error) {
            if (error instanceof EvidenceArtifactResolutionError) {
              throw new ApiError(error.code === 'ambiguous' ? 409 : 404, error.message)
            }
            throw error
          }
        }

        const workDocumentRoute = matchWorkDocumentRoute(parts)
        if (workDocumentRoute && request.method === 'GET') {
          const project = requireProject(runtime.projects, workDocumentRoute.projectId)
          const work = (await project.store.readPackage(workDocumentRoute.goalId)).works.get(
            workDocumentRoute.workId,
          )
          if (!work) throw new ApiError(404, `Work not found: ${workDocumentRoute.workId}`)
          return json({ id: work.attributes.id, body: work.body })
        }

        const goalDocumentRoute = matchGoalDocumentRoute(parts)
        if (goalDocumentRoute && request.method === 'GET') {
          const project = requireProject(runtime.projects, goalDocumentRoute.projectId)
          const path = url.searchParams.get('path')
          const designRoot = project.store.paths.designRoot(goalDocumentRoute.goalId)
          if (!path || !isDesignDocumentPath(designRoot, path)) {
            throw new ApiError(400, 'A canonical design document path is required')
          }
          const snapshot = await runtime.publisher.snapshot(project.store.paths.publicationRoot, [
            path,
          ])
          const document = snapshot.files.find((file) => file.path === path)
          if (!document?.content) throw new ApiError(404, `Design document not found: ${path}`)
          return json({ path, content: new TextDecoder().decode(document.content) })
        }

        const goalRoute = matchGoalRoute(parts)
        if (goalRoute && request.method === 'GET' && goalRoute.action === 'execution-cost') {
          return json(
            await presentGoalExecutionCost(runtime, goalRoute.projectId, goalRoute.goalId),
          )
        }
        if (goalRoute && request.method === 'GET' && goalRoute.action === null) {
          return json(
            await presentGoal(
              runtime,
              goalRoute.projectId,
              goalRoute.goalId,
              readGoalView(url.searchParams.get('view')),
            ),
          )
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'pause') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          await executeDirectUserCommand(runtime, {
            content: `Pause Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
            tool: 'hopi_control_goal',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              action: { kind: 'pause' },
            },
            reply: `Paused Goal ${goalRoute.goalId}.`,
            disposition: 'tool:pause',
          })
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'resume') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          await executeDirectUserCommand(runtime, {
            content: `Resume Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
            tool: 'hopi_control_goal',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              action: { kind: 'resume' },
            },
            reply: `Resumed Goal ${goalRoute.goalId}.`,
            disposition: 'tool:resume',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'cancel') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          await executeDirectUserCommand(runtime, {
            content: `Cancel Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
            tool: 'hopi_control_goal',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              action: { kind: 'cancel' },
            },
            reply: `Cancelled Goal ${goalRoute.goalId}.`,
            disposition: 'tool:cancel',
          })
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'reopen') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          await executeDirectUserCommand(runtime, {
            content: `Reopen Goal ${goalRoute.goalId} and reassess its current contract.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
            tool: 'hopi_control_goal',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              action: { kind: 'reopen' },
            },
            reply: `Reopened Goal ${goalRoute.goalId}.`,
            disposition: 'tool:reopen',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }

        const previewRoute = matchPreviewRoute(parts)
        if (previewRoute && request.method === 'POST' && previewRoute.action === 'start') {
          const startRequest = await parsePreviewStartRequest(request)
          const project = requireProject(runtime.projects, previewRoute.projectId)
          const repoRoots = project.repos.map((repo) => ({
            repoId: repo.repoId,
            path: resolveProjectPath(repo.integrationRoot, repo.projectPath),
          }))
          void runtime.preview.start({
            projectId: project.projectId,
            projectRoot: project.sourceRoot,
            requestedBy: 'operator',
            releaseHeads: await readProjectReleaseHeads(
              project.projectId,
              project.repos.map((repo) => ({ repoId: repo.repoId, path: repo.integrationRoot })),
            ),
            primaryRepoId: project.primaryRepoId,
            repoRoots,
            runtimeInputs: startRequest.runtimeInputs,
          })
          const session = runtime.preview.inspect(project.projectId)
          if (!session) throw new Error('Preview operation was not admitted')
          return json(
            {
              kind: session.status === 'running' ? 'started' : 'starting',
              session,
            },
            session.status === 'starting' ? 202 : 200,
          )
        }
        if (previewRoute && request.method === 'POST' && previewRoute.action === 'stop') {
          return json({
            session: await runtime.preview.stop(previewRoute.projectId),
          })
        }
        if (previewRoute && request.method === 'GET' && previewRoute.action === null) {
          return json({
            session: runtime.preview.inspect(previewRoute.projectId),
          })
        }
        return json({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message }, error.status)
        if (error instanceof AssistantToolRequestError) {
          return json({ error: error.message }, 400)
        }
        if (error instanceof AssistantImageAttachmentError) {
          return json({ error: error.message }, 400)
        }
        if (error instanceof ProjectDirectoryError) {
          return json(
            { error: error.message },
            error.code === 'not_empty' || error.code === 'initialization_failed' ? 409 : 400,
          )
        }
        if (error instanceof GoalControllerError) {
          return json({ error: error.message }, 409)
        }
        if (error instanceof GoalPackageNotFoundError) {
          return json({ error: error.message }, 404)
        }
        if (error instanceof CursorPageError) return json({ error: error.message }, 400)
        if (error instanceof AssistantHomeStoreError) {
          const status =
            error.code === 'repo_invalid' ? 400 : error.code === 'project_not_found' ? 404 : 409
          return json({ error: error.message }, status)
        }
        if (error instanceof ZodError) {
          return json({ error: error.issues.map((issue) => issue.message).join(', ') }, 400)
        }
        console.error('[mvp api error]', error)
        return json({ error: errorMessage(error) }, 500)
      }
    },
  })
  serverRef.current = server
  runtimeHost.start()
  let shutdownPromise: Promise<void> | null = null
  return Object.assign(server, {
    shutdown() {
      shutdownPromise ??= (async () => {
        await runtimeHost.stop()
        server.stop(true)
      })()
      return shutdownPromise
    },
  })
}

async function directoryArtifactIndex(root: string, limit = 1_000) {
  const entries: Array<{ path: string; kind: 'file' | 'directory'; sizeBytes: number | null }> = []
  let omitted = 0
  for await (const path of new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: false })) {
    if (entries.length >= limit) {
      omitted += 1
      continue
    }
    const metadata = await stat(join(root, path)).catch(() => null)
    if (!metadata || (!metadata.isFile() && !metadata.isDirectory())) continue
    entries.push({
      path,
      kind: metadata.isDirectory() ? 'directory' : 'file',
      sizeBytes: metadata.isFile() ? metadata.size : null,
    })
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return { entries, omitted }
}

async function receiveUserEvent(
  runtime: MvpRuntime,
  input: Parameters<MvpRuntime['workspace']['receiveEvent']>[0],
) {
  return runtime.workspace.receiveEvent(input)
}

async function executeDirectUserCommand(
  runtime: MvpRuntime,
  command: {
    content: string
    context?: Parameters<MvpRuntime['workspace']['receiveEvent']>[0]['context']
    tool: Parameters<MvpRuntime['assistantTools']['executeForEvent']>[1]
    input: unknown
    reply: string
    disposition: string
  },
) {
  return runtime.coordinator.runDirectAssistantCommand(async () => {
    const event = await receiveUserEvent(runtime, {
      content: command.content,
      ...(command.context ? { context: command.context } : {}),
    })
    try {
      const result = await runtime.assistantTools.executeForEvent(
        event.attributes.id,
        command.tool,
        command.input,
      )
      await runtime.workspace.handleEvent(event.attributes.id, {
        reply: command.reply,
        disposition: command.disposition,
      })
      return result
    } finally {
      await runtime.coordinator.settleAssistantTurn(event.attributes.id)
    }
  })
}

function readAssistantConversationScope(runtime: MvpRuntime, url: URL): AssistantConversationScope {
  const rawProjectId = url.searchParams.get('projectId')?.trim()
  if (!rawProjectId) return { kind: 'home' }
  const projectId = stableIdSchema.parse(rawProjectId)
  if (!runtime.projects.has(projectId)) throw new ApiError(404, `Project not found: ${projectId}`)
  return { kind: 'project', projectId }
}

function createSingleFlight<T>(operation: () => Promise<T>) {
  let activeOperation: Promise<T> | null = null

  return async () => {
    if (activeOperation) return activeOperation

    const nextOperation = Promise.resolve().then(operation)
    activeOperation = nextOperation
    try {
      return await nextOperation
    } finally {
      if (activeOperation === nextOperation) activeOperation = null
    }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  const configuredHome = process.env.HOPI_HOME?.trim()
  const homeRoot = configuredHome || defaultAssistantHomeRoot()
  const instanceLock = await acquireCoordinatorInstanceLock(
    join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
    {
      kind: 'coordinator',
      port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000,
    },
  )
  const server = createServer({
    rootDir: homeRoot,
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined,
    instanceId: instanceLock.owner.instanceId,
  })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    let exitCode = 0
    try {
      await server.shutdown()
    } catch (error) {
      exitCode = 1
      console.error('[mvp shutdown error]', error)
    }
    try {
      await instanceLock.release()
    } catch (error) {
      exitCode = 1
      console.error('[mvp lock release error]', error)
    }
    process.exit(exitCode)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  console.log(`HOPI listening on http://localhost:${server.port}`)
}
