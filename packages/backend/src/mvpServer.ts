import { join } from 'node:path'
import { z } from 'zod'
import type { RoleRunner } from './agent/RoleRunner'
import { type ConfigurableAgentRole, WORKFLOW_ROLE_KEYS } from './agent/adapterConfig'
import type { AgentPlanEvent, AgentRuntimeEvent } from './agent/runtimeEvents'
import { assistantToolRequestSchema } from './assistant/assistantToolSchemas'
import type { AssistantModelRunner } from './assistant/workspaceAssistant'
import type { InboxEventDocument } from './domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  parseAttentionReference,
  workspaceAttentionReference,
} from './domain/attentionReference'
import { workAttentionTarget } from './domain/attentionTarget'
import type { WorkDocument } from './domain/canonicalDocuments'
import type { GoalPackage } from './domain/goalPackage'
import { inboxEventReferenceSchema } from './domain/inboxEventReference'
import {
  normalizeProjectCodingDefaults,
  projectCodingDefaultsInputSchema,
} from './domain/projectCodingDefaults'
import { isNormalizedProjectPath, resolveProjectPath } from './domain/projectPath'
import { deriveReadableId, stableIdSchema } from './domain/stableId'
import { type WorkProjection, deriveGoalWorkProjections } from './domain/workProjection'
import { CursorPageError, type CursorPageRequest, paginateItems } from './presentation/cursorPage'
import indexPage from './product.html'
import { acquireCoordinatorInstanceLock } from './publication/instanceLock'
import {
  defaultAssistantHomeRoot,
  migrateRepositoryAssistantHome,
} from './runtime/assistantHomeMigration'
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
import {
  type CreateMvpRuntimeOptions,
  type MvpProjectRuntime,
  type MvpRuntime,
  createMvpRuntime,
  requireProject,
} from './runtime/mvpRuntime'
import {
  ProjectDirectoryError,
  classifyProjectDirectory,
  initializeEmptyGitRepository,
} from './runtime/projectDirectory'
import type { RunAttemptDiagnostics } from './runtime/runAttemptDiagnostics'
import type { RunAttemptSummary } from './runtime/runAttemptStore'
import { type RunCostEntry, summarizeRunCosts } from './runtime/runCostProjection'
import { AssistantHomeStoreError } from './storage/assistantHomeStore'
import { AssistantImageAttachmentError } from './storage/assistantImageAttachments'

export interface ServerOptions {
  rootDir?: string
  port?: number
  roleRunner?: RoleRunner
  assistantRunner?: AssistantModelRunner
  reflectionRunner?: AssistantModelRunner
  attentionTransport?: AttentionTransport
  startCoordinator?: boolean
  directoryPicker?: () => Promise<string | null>
}

export type MvpServer = Bun.Server<undefined> & {
  shutdown(): Promise<void>
}

const projectIdentitySchema = z.object({
  projectId: stableIdSchema.optional(),
})
const projectRepoSchema = z.object({
  repoId: stableIdSchema,
  repoPath: z.string().min(1),
  projectPath: z.string().refine(isNormalizedProjectPath).optional(),
})
const repoPathSchema = z
  .object({
    repoPath: z.string().min(1),
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
  })
  .strict()
const initializeRepositorySchema = z.object({ path: z.string().min(1) }).strict()
const projectSchema = z.union([
  projectIdentitySchema
    .extend({
      primaryRepoId: stableIdSchema,
      repos: z.array(projectRepoSchema).min(1),
    })
    .strict(),
  projectIdentitySchema
    .extend({
      repoPath: z.string().min(1),
      projectPath: z.string().refine(isNormalizedProjectPath).optional(),
      repoId: stableIdSchema.optional(),
    })
    .strict()
    .transform((input) => {
      const repoId = input.repoId ?? 'primary'
      return {
        projectId: input.projectId,
        primaryRepoId: repoId,
        repos: [{ repoId, repoPath: input.repoPath, projectPath: input.projectPath }],
      }
    }),
])
const rebindProjectSchema = z.union([
  z.object({ repos: z.array(projectRepoSchema).min(1) }).strict(),
  repoPathSchema,
])
const agentRoleSettingsSchema = z
  .object({ codingDefaults: projectCodingDefaultsInputSchema.nullable() })
  .strict()
const CONFIGURABLE_AGENT_ROLES = ['assistant', ...WORKFLOW_ROLE_KEYS] as const
const configurableAgentRoleSchema = z.enum(CONFIGURABLE_AGENT_ROLES)
const goalSchema = z.object({
  goalId: stableIdSchema.optional(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  priority: z.number().int().optional(),
})
const inboxSchema = z
  .object({
    content: z.string(),
    context: z
      .object({
        projectId: z.string().min(1).optional(),
        goalId: z.string().min(1).optional(),
        attentionId: z.string().min(1).optional(),
        attentionRefs: z
          .array(z.string().refine((value) => Boolean(parseAttentionReference(value))))
          .optional(),
        replyTo: inboxEventReferenceSchema.optional(),
      })
      .superRefine((context, refinement) => {
        if (Boolean(context.projectId) !== Boolean(context.goalId)) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'projectId and goalId must appear together',
          })
        }
        if (!context.projectId && !context.attentionRefs?.length) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'context requires a Goal location or Attention reference',
          })
        }
        if (context.replyTo && !context.attentionRefs?.length) {
          refinement.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'replyTo requires exact Attention references',
          })
        }
      })
      .optional(),
  })
  .strict()
const previewRepairSchema = z
  .object({
    prompt: z.string().min(1),
    context: z
      .object({
        projectId: stableIdSchema,
        goalId: stableIdSchema,
      })
      .strict(),
  })
  .strict()

export function createServer(options: ServerOptions = {}): MvpServer {
  assertSupportedPlatform(process.platform)
  const homeRoot = options.rootDir ?? process.cwd()
  const serverRef: { current: Bun.Server<undefined> | null } = {
    current: null,
  }
  let topologyReloadScheduled = false
  const runtimeOptions: CreateMvpRuntimeOptions = {
    homeRoot,
    roleRunner: options.roleRunner,
    assistantRunner: options.assistantRunner,
    reflectionRunner: options.reflectionRunner,
    attentionTransport:
      options.attentionTransport ??
      (process.env.HOPI_ATTENTION_WEBHOOK_URL
        ? createWebhookAttentionTransport(process.env.HOPI_ATTENTION_WEBHOOK_URL)
        : undefined),
    assistantToolUrl: () => {
      if (!serverRef.current) throw new Error('Assistant tool server is not ready')
      return `http://127.0.0.1:${serverRef.current.port}/api/internal/assistant-tool`
    },
    onProjectTopologyChanged: scheduleTopologyReload,
    start: false,
  }
  let runtimePromise = createMvpRuntime(runtimeOptions)
  let reloadTail: Promise<void> = Promise.resolve()
  const pickDirectory = createSingleFlight(options.directoryPicker ?? selectHostDirectory)

  async function reloadRuntime(mutate: (runtime: MvpRuntime) => Promise<void>) {
    const operation = reloadTail.then(async () => {
      const previous = await runtimePromise
      await previous.coordinator.stop()
      await previous.preview.stopAll()
      try {
        await mutate(previous)
      } catch (error) {
        if (options.startCoordinator !== false) previous.coordinator.start()
        throw error
      }
      runtimePromise = createMvpRuntime(runtimeOptions)
      const next = await runtimePromise
      if (options.startCoordinator !== false) next.coordinator.start()
    })
    reloadTail = operation.catch(() => undefined)
    await operation
    return runtimePromise
  }

  function scheduleTopologyReload() {
    if (topologyReloadScheduled) return
    topologyReloadScheduled = true
    setTimeout(() => {
      void reloadRuntime(async () => undefined)
        .catch((error) => console.error('[mvp runtime reload error]', error))
        .finally(() => {
          topologyReloadScheduled = false
        })
    }, 0)
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
        const runtime = await runtimePromise
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
        if (request.method === 'POST' && url.pathname === '/api/system/initialize-repository') {
          const body = await parseBody(request, initializeRepositorySchema)
          return json({
            selection: await initializeEmptyGitRepository(body.path),
          })
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/feed/changes') {
          return json(await presentAssistantFeedChanges(runtime, readAssistantChangeCursor(url)))
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/attentions') {
          return json(await presentAssistantAttentions(runtime))
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/feed') {
          return json(await presentAssistantFeed(runtime, readPageRequest(url, 40, 100)))
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
        if (request.method === 'GET' && url.pathname === '/api/debug/reflections') {
          const runs = (await runtime.reflection.listRunSummaries()).toSorted(
            (left, right) =>
              left.manifest.startedAt.localeCompare(right.manifest.startedAt) ||
              left.manifest.reflectionId.localeCompare(right.manifest.reflectionId),
          )
          return json(
            paginateItems(runs, readPageRequest(url, 20, 100), {
              scope: 'reflection-runs',
              getId: (run) => run.manifest.reflectionId,
            }),
          )
        }
        if (
          request.method === 'GET' &&
          parts.length === 5 &&
          parts[0] === 'api' &&
          parts[1] === 'debug' &&
          parts[2] === 'reflections' &&
          parts[3] &&
          parts[4] === 'events'
        ) {
          const reflectionId = parts[3]
          const events = await runtime.reflection.readRunEvents(reflectionId)
          if (!events) throw new ApiError(404, `Reflection Run not found: ${reflectionId}`)
          const indexedEvents = events.map((event, streamIndex) => ({
            ...event,
            streamIndex,
          }))
          return json(
            paginateItems(indexedEvents, readPageRequest(url, 80, 200), {
              scope: `reflection-events:${reflectionId}`,
              getId: (event) => event.eventId,
            }),
          )
        }
        if (request.method === 'POST' && url.pathname === '/api/projects') {
          const body = await parseBody(request, projectSchema)
          const nextRuntime = await reloadRuntime(async (current) => {
            await current.home.linkProject(body)
          })
          return json(await presentState(await nextRuntime), 201)
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
          const nextRuntime = await reloadRuntime(async (current) => {
            if ('repos' in body) await current.home.rebindRepos({ projectId, repos: body.repos })
            else await current.rebindProject(projectId, body.repoPath, body.projectPath)
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
          const nextRuntime = await reloadRuntime(async (current) => {
            await current.home.linkRepo({ projectId, ...body })
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
          const nextRuntime = await reloadRuntime(async (current) => {
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
          if (body.context?.projectId && body.context.goalId) {
            const project = requireProject(runtime.projects, body.context.projectId)
            if (!(await project.store.readGoal(body.context.goalId))) {
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
            const indexedEvents = (events ?? []).map((event, streamIndex) => ({
              ...event,
              streamIndex,
            }))
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
            tool: 'hopi_control',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              operation: 'pause',
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
            tool: 'hopi_control',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              operation: 'resume',
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
            tool: 'hopi_control',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              operation: 'cancel',
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
            tool: 'hopi_control',
            input: {
              projectId: project.projectId,
              goalId: goalRoute.goalId,
              operation: 'reopen',
            },
            reply: `Reopened Goal ${goalRoute.goalId}.`,
            disposition: 'tool:reopen',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }

        const previewRoute = matchPreviewRoute(parts)
        if (previewRoute && request.method === 'POST' && previewRoute.action === 'start') {
          const project = requireProject(runtime.projects, previewRoute.projectId)
          const workspace = await runtime.workspace.readWorkspace()
          if (
            [...workspace.attentions.values()].some(
              (attention) =>
                attention.attributes.target === `project:${project.projectId}` &&
                attention.attributes.resolvedAt === null,
            )
          ) {
            throw new ApiError(409, 'Preview is blocked until Project Attention is resolved')
          }
          return json(
            await runtime.preview.start({
              projectId: project.projectId,
              projectRoot: project.sourceRoot,
              primaryRepoId: project.primaryRepoId,
              repoRoots: project.repos.map((repo) => ({
                repoId: repo.repoId,
                path: resolveProjectPath(repo.integrationRoot, repo.projectPath),
              })),
            }),
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
        if (request.method === 'POST' && url.pathname === '/api/preview/repair') {
          const body = await parseBody(request, previewRepairSchema)
          const project = requireProject(runtime.projects, body.context.projectId)
          if (!(await project.store.readGoal(body.context.goalId))) {
            throw new ApiError(404, `Goal not found: ${body.context.goalId}`)
          }
          const event = await receiveUserEvent(runtime, {
            content: body.prompt,
            context: body.context,
          })
          runtime.coordinator.wake()
          return json({ eventId: event.attributes.id }, 202)
        }
        return json({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message }, error.status)
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
        if (error instanceof CursorPageError) return json({ error: error.message }, 400)
        if (error instanceof AssistantHomeStoreError) {
          const status =
            error.code === 'repo_invalid' ? 400 : error.code === 'project_not_found' ? 404 : 409
          return json({ error: error.message }, status)
        }
        if (error instanceof z.ZodError) {
          return json({ error: error.issues.map((issue) => issue.message).join(', ') }, 400)
        }
        console.error('[mvp api error]', error)
        return json({ error: errorMessage(error) }, 500)
      }
    },
  })
  serverRef.current = server
  if (options.startCoordinator !== false) {
    void runtimePromise.then((runtime) => runtime.coordinator.start())
  }
  let shutdownPromise: Promise<void> | null = null
  return Object.assign(server, {
    shutdown() {
      shutdownPromise ??= (async () => {
        await reloadTail
        const runtime = await runtimePromise
        await runtime.coordinator.stop()
        await runtime.preview.stopAll()
        server.stop(true)
      })()
      return shutdownPromise
    },
  })
}

async function presentState(runtime: MvpRuntime, options: { includeAttentions?: boolean } = {}) {
  const includeAttentions = options.includeAttentions ?? true
  const [home, workspace, agentRoleSettingEntries] = await Promise.all([
    runtime.home.readHome(),
    runtime.workspace.readWorkspace(),
    Promise.all(
      CONFIGURABLE_AGENT_ROLES.map(
        async (role) => [role, await runtime.readAgentRoleCodingDefaults(role)] as const,
      ),
    ),
  ])
  const agentRoleSettings = Object.fromEntries(agentRoleSettingEntries) as Record<
    ConfigurableAgentRole,
    Awaited<ReturnType<MvpRuntime['readAgentRoleCodingDefaults']>>
  >
  const projects = []
  const goalAttentions = []
  for (const project of runtime.projects.values()) {
    const projectAttention = [...workspace.attentions.values()].find(
      (attention) =>
        attention.attributes.target === `project:${project.projectId}` &&
        attention.attributes.resolvedAt === null,
    )
    const goals = []
    let goalOpenAttentionCount = 0
    const readableGoalPackages: Array<{
      goalId: string
      goalPackage: GoalPackage
    }> = []
    try {
      for (const goalId of await project.store.listGoalIds()) {
        readableGoalPackages.push({
          goalId,
          goalPackage: await project.store.readPackage(goalId),
        })
      }
    } catch (error) {
      if (!projectAttention) throw error
    }
    for (const { goalId, goalPackage } of readableGoalPackages) {
      const projectAttentionOpen = Boolean(projectAttention)
      const liveWorkIds = new Set(
        [...runtime.coordinator.activeRuns().keys()]
          .filter((key) => key.startsWith(`${project.projectId}/${goalId}/`))
          .map((key) => key.slice(`${project.projectId}/${goalId}/`.length)),
      )
      const projections = deriveGoalWorkProjections(project.projectId, goalId, goalPackage, {
        projectEligible: !projectAttentionOpen,
        liveRunWorkIds: liveWorkIds,
        operationallyDeferredWorkIds:
          project.reconciler.operationallyDeferredWorkIds?.(goalId) ?? new Set(),
        passCapacity: { planner: true, generator: true, reviewer: true },
        maxAttempts: 3,
      })
      const summaries = deriveGoalSummaries(goalPackage, projections)
      const openAttentionCount = [...goalPackage.attentions.values()].filter(
        (attention) =>
          attention.attributes.target !== null && attention.attributes.resolvedAt === null,
      ).length
      goalOpenAttentionCount += openAttentionCount
      goals.push({
        id: goalId,
        title: goalPackage.goal.attributes.title,
        createdAt: goalCreatedAt(goalPackage, workspace.events),
        lifecycle: goalPackage.goal.attributes.lifecycle,
        priority: goalPackage.goal.attributes.priority,
        ...summaries,
        openAttentionCount,
      })
      if (includeAttentions) {
        goalAttentions.push(...presentGoalAttentions(project.projectId, goalId, goalPackage))
      }
    }
    projects.push({
      projectId: project.projectId,
      primaryRepoId: project.primaryRepoId,
      repos: project.repos.map((repo) => ({
        repoId: repo.repoId,
        repoPath: repo.repoPath,
        projectPath: repo.projectPath,
        deliveryBranch: repo.deliveryBranch,
        integrationRoot: repo.integrationRoot,
        primary: repo.primary,
      })),
      repoPath: project.repoPath,
      projectPath: project.projectPath,
      guidance: await readProjectGuidance(project.sourceRoot),
      preview: runtime.preview.inspect(project.projectId),
      openAttentionCount: goalOpenAttentionCount + (projectAttention ? 1 : 0),
      goals,
    })
  }
  return {
    home: {
      ...home,
      agentRoleCodingDefaults: agentRoleSettings,
    },
    projects,
    attentions: includeAttentions
      ? [
          ...[...workspace.attentions.values()].map((attention) => ({
            scope: 'workspace',
            ...attention.attributes,
            operatorRequest: attention.attributes.operatorRequest ?? null,
            body: attention.body,
          })),
          ...goalAttentions.map((attention) => ({ scope: 'goal', ...attention })),
        ]
      : [],
    activeRuns: [...runtime.coordinator.activeRuns()].map(([key, responsibility]) => ({
      key,
      responsibility,
    })),
  }
}

async function presentAssistantAttentions(runtime: MvpRuntime) {
  const workspace = await runtime.workspace.readWorkspace()
  const goalAttentions = []
  for (const project of runtime.projects.values()) {
    let goalIds: string[]
    try {
      goalIds = await project.store.listGoalIds()
    } catch {
      continue
    }
    for (const goalId of goalIds) {
      try {
        goalAttentions.push(
          ...presentGoalAttentions(
            project.projectId,
            goalId,
            await project.store.readPackage(goalId),
          ),
        )
      } catch {
        // A project-level recovery Attention remains available even when one Goal package is unreadable.
      }
    }
  }
  return {
    attentions: [
      ...[...workspace.attentions.values()].map((attention) => ({
        scope: 'workspace' as const,
        ...attention.attributes,
        operatorRequest: attention.attributes.operatorRequest ?? null,
        body: attention.body,
      })),
      ...goalAttentions.map((attention) => ({ scope: 'goal' as const, ...attention })),
    ],
  }
}

function presentGoalAttentions(projectId: string, goalId: string, goalPackage: GoalPackage) {
  return [...goalPackage.attentions.values()].flatMap((attention) => {
    if (
      attention.attributes.target === null &&
      (goalPackage.goal.attributes.lifecycle !== 'done' ||
        goalPackage.goal.attributes.completionAttentionId !== attention.attributes.id)
    ) {
      return []
    }
    return [
      {
        projectId,
        goalId,
        ...attention.attributes,
        operatorRequest: attention.attributes.operatorRequest ?? null,
        body: attention.body,
      },
    ]
  })
}

function goalCreatedAt(goalPackage: GoalPackage, events: ReadonlyMap<string, InboxEventDocument>) {
  let earliest: { value: string; timestamp: number } | null = null
  for (const input of goalPackage.inputs.values()) {
    const receivedAt = events.get(input.attributes.sourceEventId)?.attributes.receivedAt
    const inputTimestamp = receivedAt ? Date.parse(receivedAt) : Number.NaN
    if (
      receivedAt &&
      Number.isFinite(inputTimestamp) &&
      (!earliest || inputTimestamp < earliest.timestamp)
    ) {
      earliest = { value: receivedAt, timestamp: inputTimestamp }
    }
  }
  return earliest?.value ?? null
}

async function presentAssistantFeed(runtime: MvpRuntime, request: CursorPageRequest) {
  const projection = await readAssistantFeedProjection(runtime)
  const page = paginateItems(projection.entries, request, {
    scope: 'assistant-feed',
    getId: (entry) => entry.id,
  })

  return {
    ...page,
    items: await Promise.all(page.items.map((entry) => presentAssistantFeedEntry(runtime, entry))),
    activity: projection.activity,
    syncCursor: projection.syncCursor,
  }
}

async function presentAssistantFeedChanges(runtime: MvpRuntime, cursor: string | null) {
  const projection = await readAssistantFeedProjection(runtime)
  const replayFrom = cursor ? Date.parse(cursor) - 1 : null
  const changed =
    replayFrom !== null
      ? projection.entries.filter((entry) => Date.parse(entry.updatedAt) >= replayFrom)
      : projection.entries
  const removedIds = projection.removals
    .filter((removal) => replayFrom === null || Date.parse(removal.updatedAt) >= replayFrom)
    .map((removal) => removal.id)
  return {
    items: await Promise.all(changed.map((entry) => presentAssistantFeedEntry(runtime, entry))),
    removedIds,
    activity: projection.activity,
    syncCursor: projection.syncCursor,
  }
}

async function readAssistantFeedProjection(runtime: MvpRuntime) {
  const workspace = await runtime.workspace.readWorkspace()
  const goalCompletions = await readGoalCompletionAttentions(runtime)
  const completions = [
    ...[...workspace.attentions.values()]
      .filter((attention) => attention.attributes.target === null)
      .map((attention) => ({
        scope: 'workspace' as const,
        ...attention.attributes,
        operatorRequest: attention.attributes.operatorRequest ?? null,
        body: attention.body,
      })),
    ...goalCompletions,
  ]
  const completionByReference = new Map(
    completions.map((attention) => [
      attention.scope === 'goal'
        ? goalAttentionReference(attention.projectId, attention.goalId, attention.id)
        : workspaceAttentionReference(workspace.homeId, attention.id),
      attention,
    ]),
  )
  const workspaceEvents = [...workspace.events.values()]
  const publicEvents = workspaceEvents.filter((event) => event.attributes.visibility === 'public')
  const internalSpeakingEvents = workspaceEvents.filter(
    (event) =>
      event.attributes.source === 'reflection' &&
      event.attributes.visibility === 'internal' &&
      event.attributes.status === 'pending',
  )
  const [eventStates, internalSpeakingTurns] = await Promise.all([
    Promise.all(
      publicEvents.map(async (event) => {
        if (event.attributes.status === 'handled') {
          return {
            event,
            turn: null,
            runtimeStatus: 'completed' as const,
            updatedAt: maxTimestamp(event.attributes.receivedAt, event.attributes.handledAt),
          }
        }
        const turn = await runtime.assistantConversation.readTurn(event.attributes.id)
        return {
          event,
          turn,
          runtimeStatus: turn?.manifest.status ?? ('queued' as const),
          updatedAt: maxTimestamp(
            event.attributes.receivedAt,
            turn?.manifest.updatedAt,
            turn?.events.at(-1)?.createdAt,
          ),
        }
      }),
    ),
    Promise.all(
      internalSpeakingEvents.map((event) =>
        runtime.assistantConversation.readTurn(event.attributes.id),
      ),
    ),
  ])
  const linkedCompletionReferences = new Set<string>()
  const eventCompletionReferences = new Map<string, string>()
  for (const event of publicEvents.toSorted(
    (left, right) =>
      left.attributes.receivedAt.localeCompare(right.attributes.receivedAt) ||
      left.attributes.id.localeCompare(right.attributes.id),
  )) {
    if (event.attributes.source !== 'reflection' || event.attributes.status !== 'handled') continue
    const reference = event.attributes.context
      ? normalizeInboxAttentionReferences(event.attributes.context).find(
          (candidate) =>
            completionByReference.has(candidate) && !linkedCompletionReferences.has(candidate),
        )
      : undefined
    if (!reference) continue
    linkedCompletionReferences.add(reference)
    eventCompletionReferences.set(event.attributes.id, reference)
  }
  const eventEntries = eventStates.map((state) => {
    const completion =
      completionByReference.get(eventCompletionReferences.get(state.event.attributes.id) ?? '') ??
      null
    return {
      kind: 'event' as const,
      id: `event:${state.event.attributes.id}`,
      occurredAt: state.event.attributes.receivedAt,
      updatedAt: maxTimestamp(
        state.updatedAt,
        completion?.createdAt,
        completion?.resolvedAt,
        completion?.notifiedAt,
      ),
      event: state.event,
      turn: state.turn,
      runtimeStatus: state.runtimeStatus,
      completion,
    }
  })
  const removals = eventEntries.flatMap((entry) => {
    if (!entry.completion) return []
    const reference = eventCompletionReferences.get(entry.event.attributes.id)
    return reference ? [{ id: `completion:${reference}`, updatedAt: entry.updatedAt }] : []
  })
  const entries = [
    ...eventEntries,
    ...completions
      .filter((attention) => {
        const reference =
          attention.scope === 'goal'
            ? goalAttentionReference(attention.projectId, attention.goalId, attention.id)
            : workspaceAttentionReference(workspace.homeId, attention.id)
        return !linkedCompletionReferences.has(reference)
      })
      .map((attention) => ({
        kind: 'completion' as const,
        id:
          attention.scope === 'goal'
            ? `completion:${goalAttentionReference(attention.projectId, attention.goalId, attention.id)}`
            : `completion:${workspaceAttentionReference(workspace.homeId, attention.id)}`,
        occurredAt: attention.notifiedAt ?? attention.resolvedAt ?? attention.createdAt,
        updatedAt: maxTimestamp(attention.createdAt, attention.resolvedAt, attention.notifiedAt),
        attention,
      })),
  ].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  )
  const statuses = eventStates.map((state) => state.runtimeStatus)
  return {
    entries,
    removals,
    activity: deriveAssistantFeedActivity({
      publicStatuses: statuses,
      internalSpeakingRunning: internalSpeakingTurns.some(
        (turn) => turn?.manifest.status === 'running',
      ),
      reflectionRunning: runtime.reflection.isActive(),
    }),
    syncCursor: entries.reduce<string | null>(
      (latest, entry) =>
        !latest || Date.parse(entry.updatedAt) > Date.parse(latest) ? entry.updatedAt : latest,
      null,
    ),
  }
}

type AssistantFeedRuntimeStatus = 'queued' | 'running' | 'interrupted' | 'completed' | 'failed'

export function deriveAssistantFeedActivity(input: {
  publicStatuses: readonly AssistantFeedRuntimeStatus[]
  internalSpeakingRunning: boolean
  reflectionRunning: boolean
}) {
  if (input.publicStatuses.includes('running')) return { phase: 'working' as const }
  if (input.internalSpeakingRunning || input.reflectionRunning) {
    return { phase: 'thinking' as const }
  }
  if (input.publicStatuses.some((status) => status === 'queued' || status === 'interrupted')) {
    return { phase: 'waiting' as const }
  }
  return null
}

type AssistantFeedProjectionEntry = Awaited<
  ReturnType<typeof readAssistantFeedProjection>
>['entries'][number]

async function presentAssistantFeedEntry(runtime: MvpRuntime, entry: AssistantFeedProjectionEntry) {
  if (entry.kind === 'completion') {
    return {
      kind: entry.kind,
      id: entry.id,
      occurredAt: entry.occurredAt,
      attention: entry.attention,
    }
  }
  const turn =
    entry.turn ?? (await runtime.assistantConversation.readTurn(entry.event.attributes.id))
  return {
    kind: entry.kind,
    id: entry.id,
    occurredAt: entry.occurredAt,
    completion: entry.completion,
    event: {
      ...entry.event.attributes,
      attachments: await presentInboxAttachments(runtime, entry.event.attributes.attachments),
      context: entry.event.attributes.context ?? null,
      routeClaim: entry.event.attributes.routeClaim ?? null,
      body: entry.event.body,
      runtimeStatus: entry.runtimeStatus,
      runtimeEvents: turn?.events ?? [],
      runtimeError: turn?.manifest.error ?? null,
    },
  }
}

function maxTimestamp(...values: Array<string | null | undefined>) {
  const present = values.filter((value): value is string => Boolean(value))
  if (present.length === 0) throw new Error('Assistant feed entry has no timestamp')
  return present.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  )
}

async function readGoalCompletionAttentions(runtime: MvpRuntime) {
  const completions = []
  for (const project of runtime.projects.values()) {
    for (const goalId of await project.store.listGoalIds()) {
      const goalPackage = await project.store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle !== 'done') continue
      const completionId = goalPackage.goal.attributes.completionAttentionId
      if (!completionId) continue
      const attention = goalPackage.attentions.get(completionId)
      if (!attention || attention.attributes.target !== null) continue
      completions.push({
        scope: 'goal' as const,
        projectId: project.projectId,
        goalId,
        ...attention.attributes,
        operatorRequest: attention.attributes.operatorRequest ?? null,
        body: attention.body,
      })
    }
  }
  return completions
}

function deriveGoalSummaries(
  goalPackage: Awaited<ReturnType<MvpProjectRuntime['store']['readPackage']>>,
  projections: ReturnType<typeof deriveGoalWorkProjections>,
) {
  const lifecycle = goalPackage.goal.attributes.lifecycle
  if (lifecycle === 'done') return { currentSummary: 'Outcome delivered', nextSummary: 'Complete' }
  if (lifecycle === 'cancelled')
    return { currentSummary: 'Preserved history', nextSummary: 'Cancelled' }
  const ordered = projections
    .filter((projection) => {
      const work = goalPackage.works.get(projection.workId)
      return work && work.attributes.stage !== 'done' && work.attributes.stage !== 'cancelled'
    })
    .toSorted((left, right) => {
      const columns = ['Plan', 'Build', 'Review', 'Done']
      return columns.indexOf(left.column ?? 'Done') - columns.indexOf(right.column ?? 'Done')
    })
  const focus =
    ordered.find((projection) => projection.primaryBadge === 'Needs you') ??
    ordered.find((projection) => projection.primaryBadge === 'Waiting for Assistant') ??
    ordered[0]
  if (lifecycle === 'paused') {
    return {
      currentSummary: focus
        ? `Paused at ${goalPackage.works.get(focus.workId)?.attributes.title ?? focus.workId}`
        : 'Paused',
      nextSummary: 'Resume to continue',
    }
  }
  if (!focus) return { currentSummary: 'Final assessment', nextSummary: 'Planner' }
  const work = goalPackage.works.get(focus.workId)
  return {
    currentSummary: `${focus.column ?? 'Waiting'}: ${work?.attributes.title ?? focus.workId}`,
    nextSummary: focus.primaryBadge
      ? `${focus.primaryBadge}${focus.responsibility ? ` · ${focus.responsibility}` : ''}`
      : (focus.responsibility ?? 'Waiting for prerequisites'),
  }
}

async function readProjectGuidance(projectRoot: string) {
  const file = Bun.file(join(projectRoot, 'AGENTS.md'))
  return (await file.exists()) ? await file.text() : null
}

export function presentAttempt<
  T extends {
    runId: string
    workId: string
    result: string | null
    summary: string | null
    application: string | null
  },
>(
  attempt: T,
  goalPackage: Awaited<ReturnType<MvpProjectRuntime['store']['readPackage']>>,
  projectId: string,
  goalId: string,
) {
  const producerRun = `${workAttentionTarget(projectId, goalId, attempt.workId)}/run:${attempt.runId}`
  const evidence = [...goalPackage.evidence.values()].find(
    (document) => document.attributes.producerRun === producerRun,
  )
  if (!evidence) return attempt
  const publishedResult = evidence.body.match(
    /^- Result: (success|reject|attention|replan|fail)$/m,
  )?.[1]
  const consumed = [...goalPackage.works.values()].some((work) =>
    work.attributes.evidenceRefs.includes(evidence.attributes.id),
  )
  return {
    ...attempt,
    result: attempt.result ?? publishedResult ?? null,
    summary: attempt.summary ?? evidence.body.match(/## Summary\s+([\s\S]+)$/)?.[1]?.trim() ?? null,
    application: attempt.application ?? (consumed ? 'published' : 'evidence_preserved'),
  }
}

export function deriveWorkCompletedAt(
  work: Pick<WorkDocument['attributes'], 'kind' | 'stage'>,
  attempts: readonly Pick<
    RunAttemptSummary,
    'responsibility' | 'status' | 'result' | 'endedAt' | 'application'
  >[],
): string | null {
  if (work.stage !== 'done') return null

  const terminalResponsibility = work.kind === 'planning' ? 'planner' : 'reviewer'
  const terminalApplications =
    work.kind === 'planning'
      ? new Set(['published'])
      : new Set(['integrated', 'already_integrated'])
  const successfulTerminalAttempts = attempts.filter(
    (attempt) =>
      attempt.responsibility === terminalResponsibility &&
      attempt.status === 'finished' &&
      attempt.result === 'success' &&
      attempt.endedAt !== null,
  )
  const appliedAttempts = successfulTerminalAttempts.filter((attempt) =>
    terminalApplications.has(attempt.application ?? ''),
  )
  // Pre-manifest-application Attempts remain readable without weakening current completion semantics.
  const candidates = appliedAttempts.length
    ? appliedAttempts
    : successfulTerminalAttempts.filter((attempt) => attempt.application === null)

  return candidates.reduce<string | null>(
    (latest, attempt) =>
      attempt.endedAt && (!latest || attempt.endedAt > latest) ? attempt.endedAt : latest,
    null,
  )
}

async function receiveUserEvent(
  runtime: MvpRuntime,
  input: Parameters<MvpRuntime['workspace']['receiveEvent']>[0],
) {
  const event = await runtime.workspace.receiveEvent(input)
  try {
    await runtime.assistantTools.acceptUserAttentionReply(event.attributes.id)
  } catch (error) {
    console.error('[assistant attention reply acknowledgement error]', error)
  }
  runtime.coordinator.interruptInternalAssistant()
  return event
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
      runtime.coordinator.settleAssistantTurn(event.attributes.id)
    }
  })
}

async function presentGoal(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
  view: 'full' | 'board' | 'docs' = 'full',
) {
  const project = requireProject(runtime.projects, projectId)
  const goalPackage = await project.store.readPackage(goalId)
  if (view === 'docs') {
    const designSnapshot = await runtime.publisher.snapshotTree(
      project.store.paths.publicationRoot,
      project.store.paths.designRoot(goalId),
    )
    return {
      projectId,
      goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
      design: designSnapshot.files.map((file) => ({
        path: file.path,
        excerpt: presentExcerpt(file.content ? new TextDecoder().decode(file.content) : '', 60),
      })),
      evidence: [...goalPackage.evidence.values()].map((evidence) => ({
        id: evidence.attributes.id,
        createdAt: evidence.attributes.createdAt,
        producerRun: evidence.attributes.producerRun,
        owner: evidence.attributes.owner,
        excerpt: presentExcerpt(evidence.body, 150),
      })),
    }
  }
  const activePrefix = `${projectId}/${goalId}/`
  const liveWorkIds = new Set(
    [...runtime.coordinator.activeRuns().keys()]
      .filter((key) => key.startsWith(activePrefix))
      .map((key) => key.slice(activePrefix.length)),
  )
  const workspace = await runtime.workspace.readWorkspace()
  const projectAttention = [...workspace.attentions.values()].find(
    (attention) =>
      attention.attributes.target === `project:${projectId}` &&
      attention.attributes.resolvedAt === null,
  )
  const projectAttentionOpen = Boolean(projectAttention)
  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, {
    projectEligible: !projectAttentionOpen,
    liveRunWorkIds: liveWorkIds,
    operationallyDeferredWorkIds:
      project.reconciler.operationallyDeferredWorkIds?.(goalId) ?? new Set(),
    passCapacity: { planner: true, generator: true, reviewer: true },
    maxAttempts: 3,
  })
  const projectionByWork = new Map(projections.map((projection) => [projection.workId, projection]))
  const [designSnapshot, attemptsByWork] = await Promise.all([
    view === 'full'
      ? runtime.publisher.snapshotTree(
          project.store.paths.publicationRoot,
          project.store.paths.designRoot(goalId),
        )
      : null,
    runtime.attempts.listGoal(projectId, goalId),
  ])
  const agentPlanByWork = await readLiveAgentPlans(
    runtime,
    projectId,
    goalId,
    liveWorkIds,
    attemptsByWork,
  )
  const projection = {
    projectId,
    goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
    works: [...goalPackage.works.values()].map((work) => {
      const workAttempts = attemptsByWork.get(work.attributes.id) ?? []
      return {
        ...work.attributes,
        ...(view === 'full' ? { body: work.body } : {}),
        projection: projectionByWork.get(work.attributes.id),
        blockedBy: presentWorkBlocker(work, projectionByWork, goalPackage),
        agentPlan: agentPlanByWork.get(work.attributes.id) ?? null,
        runAttemptCount: workAttempts.length,
        completedAt: deriveWorkCompletedAt(work.attributes, workAttempts),
      }
    }),
    attentions: [...goalPackage.attentions.values()]
      .filter((attention) => view === 'full' || attention.attributes.resolvedAt === null)
      .map((attention) => ({
        scope: 'goal' as const,
        projectId,
        goalId,
        ...attention.attributes,
        operatorRequest: attention.attributes.operatorRequest ?? null,
        ...(view === 'full' ? { body: attention.body } : {}),
      })),
    projectAttention: projectAttention
      ? {
          scope: 'workspace' as const,
          projectId,
          ...projectAttention.attributes,
          operatorRequest: projectAttention.attributes.operatorRequest ?? null,
          body: projectAttention.body,
        }
      : null,
  }
  if (view === 'board') return projection
  return {
    ...projection,
    design: (designSnapshot?.files ?? []).map((file) => ({
      path: file.path,
      content: file.content ? new TextDecoder().decode(file.content) : '',
    })),
    evidence: [...goalPackage.evidence.values()].map((evidence) => ({
      ...evidence.attributes,
      body: evidence.body,
    })),
  }
}

async function presentGoalExecutionCost(runtime: MvpRuntime, projectId: string, goalId: string) {
  const project = requireProject(runtime.projects, projectId)
  await project.store.readPackage(goalId)
  const attemptsByWork = await runtime.attempts.listGoal(projectId, goalId)
  const entries: RunCostEntry[] = []
  for (const [workId, attempts] of attemptsByWork) {
    for (const attempt of attempts) {
      const diagnostics = await runtime.attempts.readDiagnostics(
        projectId,
        goalId,
        workId,
        attempt.runId,
      )
      if (diagnostics) entries.push({ ...attempt, diagnostics })
    }
  }
  const byWork = [...attemptsByWork.keys()].map((workId) => {
    const scoped = entries.filter((entry) => entry.workId === workId)
    return { workId, summary: summarizeRunCosts(scoped) }
  })
  const byResponsibility = (['planner', 'generator', 'reviewer'] as const).map(
    (responsibility) => ({
      responsibility,
      summary: summarizeRunCosts(
        entries.filter((entry) => entry.responsibility === responsibility),
      ),
    }),
  )
  return {
    projectId,
    goalId,
    summary: summarizeRunCosts(entries),
    byWork,
    byResponsibility,
    runs: entries,
  }
}

function presentWorkBlocker(
  work: WorkDocument,
  projections: ReadonlyMap<string, WorkProjection>,
  goalPackage: GoalPackage,
) {
  const projection = projections.get(work.attributes.id)
  if (
    !projection ||
    work.attributes.stage === 'done' ||
    work.attributes.stage === 'cancelled' ||
    projection.ready ||
    projection.primaryBadge === 'working'
  ) {
    return null
  }

  const reasons = new Set(projection.failedPredicates)
  if (reasons.has('attention')) {
    if (projection.primaryBadge === 'Needs you') return 'you'
    if (projection.primaryBadge === 'Waiting for Assistant') return 'Assistant'
    return 'Attention'
  }
  if (reasons.has('project_ineligible')) return 'Project'
  if (reasons.has('goal_not_active')) return 'Goal'
  if (reasons.has('planning_guard')) {
    if (work.attributes.kind === 'engineering') return 'Planner'
    const activeResponsibilities = new Set(
      [...goalPackage.works.values()]
        .filter((candidate) => candidate.attributes.kind === 'engineering')
        .map((candidate) => projections.get(candidate.attributes.id))
        .filter(
          (candidate): candidate is WorkProjection =>
            candidate?.primaryBadge === 'working' && candidate.responsibility !== null,
        )
        .map((candidate) => candidate.responsibility),
    )
    if (activeResponsibilities.size === 1) {
      const responsibility = [...activeResponsibilities][0]
      return responsibility ? capitalize(responsibility) : null
    }
    return 'active Work'
  }
  if (reasons.has('stale_contract_revision')) return 'Planner'
  if (reasons.has('dependency_incomplete')) {
    const dependencies = work.attributes.dependsOn
      .map((dependencyId) => goalPackage.works.get(dependencyId))
      .filter((dependency): dependency is WorkDocument =>
        Boolean(dependency && dependency.attributes.stage !== 'done'),
      )
    if (dependencies.length === 1) return dependencies[0]?.attributes.title ?? 'dependency'
    return dependencies.length > 1 ? `${dependencies.length} dependencies` : 'dependency'
  }
  if (reasons.has('not_before')) return 'schedule'
  if (reasons.has('attempts_exhausted')) return 'attempt limit'
  if (reasons.has('operational_backoff')) return 'retry backoff'
  if (reasons.has('capacity')) {
    return projection.responsibility
      ? `${capitalize(projection.responsibility)} capacity`
      : 'Agent capacity'
  }
  if (reasons.has('no_profile_pass')) return 'runner profile'
  return null
}

function capitalize(value: string) {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}

async function readLiveAgentPlans(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
  liveWorkIds: ReadonlySet<string>,
  attemptsByWork: ReadonlyMap<string, readonly RunAttemptSummary[]>,
) {
  const plans = await Promise.all(
    [...liveWorkIds].map(async (workId) => {
      const attempt = attemptsByWork
        .get(workId)
        ?.find((candidate) => candidate.status === 'running')
      if (!attempt) return null
      const events = await runtime.attempts.readEvents(projectId, goalId, workId, attempt.runId)
      const plan = latestAgentPlan(events ?? [])
      return plan
        ? ([
            workId,
            {
              runId: attempt.runId,
              transport: plan.transport,
              planId: plan.planId,
              status: plan.status,
              items: plan.items,
              vendorEventType: plan.vendorEventType,
            },
          ] as const)
        : null
    }),
  )
  return new Map(plans.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
}

export function latestAgentPlan(events: readonly AgentRuntimeEvent[]): AgentPlanEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'plan') return event
  }
  return null
}

function matchGoalRoute(parts: string[]) {
  if (
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    !parts[2] ||
    !parts[4] ||
    parts.length > 6
  ) {
    return null
  }
  const action = parts[5] ?? null
  if (
    action !== null &&
    action !== 'pause' &&
    action !== 'resume' &&
    action !== 'cancel' &&
    action !== 'reopen' &&
    action !== 'execution-cost'
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4], action }
}

function matchWorkDocumentRoute(parts: string[]) {
  if (
    parts.length !== 7 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'works' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6]
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4], workId: parts[6] }
}

function matchGoalDocumentRoute(parts: string[]) {
  if (
    parts.length !== 6 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'documents' ||
    !parts[2] ||
    !parts[4]
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4] }
}

function isDesignDocumentPath(designRoot: string, path: string) {
  const prefix = `${designRoot}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return false
  const relative = path.slice(prefix.length)
  return (
    relative.length > 0 &&
    relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

function readGoalView(view: string | null): 'full' | 'board' | 'docs' {
  if (view === 'board' || view === 'docs') return view
  return 'full'
}

function presentExcerpt(value: string, maxLength: number) {
  const plain = value
    .replace(/^#+\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}

function matchPreviewRoute(parts: string[]) {
  if (
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'preview' ||
    !parts[2] ||
    parts.length > 5
  ) {
    return null
  }
  const action = parts[4] ?? null
  if (action !== null && action !== 'start' && action !== 'stop') return null
  return { projectId: parts[2], action }
}

function matchWorkAttemptRoute(parts: string[]) {
  if (
    parts.length < 8 ||
    parts.length > 10 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'works' ||
    parts[7] !== 'attempts' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6]
  ) {
    return null
  }
  if (parts.length === 10 && parts[9] !== 'events') return null
  if (parts.length === 10 && !parts[8]) return null
  return {
    projectId: parts[2],
    goalId: parts[4],
    workId: parts[6],
    runId: parts[8] ?? null,
    events: parts[9] === 'events',
  }
}

function matchEvidenceArtifactRoute(parts: string[]) {
  if (
    parts.length !== 9 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'evidence' ||
    parts[7] !== 'artifacts' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6] ||
    !parts[8] ||
    !/^\d+$/.test(parts[8])
  ) {
    return null
  }
  return {
    projectId: parts[2],
    goalId: parts[4],
    evidenceId: parts[6],
    artifactIndex: Number.parseInt(parts[8], 10),
  }
}

function readPageRequest(url: URL, defaultLimit: number, maxLimit: number): CursorPageRequest {
  const before = url.searchParams.get('before') ?? undefined
  const after = url.searchParams.get('after') ?? undefined
  if (before && after) throw new ApiError(400, 'before and after are mutually exclusive')
  const rawLimit = url.searchParams.get('limit')
  if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
    throw new ApiError(400, 'limit must be a positive integer')
  }
  const requestedLimit = rawLimit === null ? defaultLimit : Number.parseInt(rawLimit, 10)
  if (requestedLimit < 1) throw new ApiError(400, 'limit must be a positive integer')
  return {
    before,
    after,
    limit: Math.min(requestedLimit, maxLimit),
  }
}

function readAssistantChangeCursor(url: URL) {
  const cursor = url.searchParams.get('cursor')
  if (cursor === null) return null
  if (!z.string().datetime({ offset: true }).safeParse(cursor).success) {
    throw new ApiError(400, 'Assistant change cursor must be an ISO timestamp')
  }
  return cursor
}

async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  return schema.parse(await request.json())
}

async function parseInboxRequest(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) {
    const parsed = inboxSchema.parse(await request.json())
    if (!parsed.content.trim()) throw new ApiError(400, 'Inbox message is empty')
    return { ...parsed, images: [] as File[] }
  }
  const form = await request.formData()
  const rawContext = form.get('context')
  let context: unknown
  if (typeof rawContext === 'string' && rawContext.trim()) {
    try {
      context = JSON.parse(rawContext)
    } catch {
      throw new ApiError(400, 'Invalid Inbox context')
    }
  }
  const parsed = inboxSchema.parse({ content: form.get('content'), context })
  const images = form.getAll('images').filter((value): value is File => value instanceof File)
  if (!parsed.content.trim() && images.length === 0) {
    throw new ApiError(400, 'Inbox message is empty')
  }
  return { ...parsed, images }
}

function canonicalInboxContext(context: z.infer<typeof inboxSchema>['context']) {
  if (!context) return undefined
  const attentionRefs = normalizeInboxAttentionReferences(context)
  return {
    ...(context.projectId && context.goalId
      ? { projectId: context.projectId, goalId: context.goalId }
      : {}),
    ...(attentionRefs.length ? { attentionRefs } : {}),
    ...(context.replyTo ? { replyTo: context.replyTo } : {}),
  }
}

async function presentInboxAttachments(runtime: MvpRuntime, references: readonly string[]) {
  const attachments = []
  for (const reference of references) {
    const attachment = await runtime.workspace.resolveAttachment(reference)
    if (!attachment) continue
    attachments.push({
      reference,
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      url: `/api/assistant/attachments/${encodeURIComponent(attachment.contentHash)}/${encodeURIComponent(attachment.fileName)}`,
    })
  }
  return attachments
}

function requirePart(parts: string[], index: number) {
  const value = parts[index]
  if (!value) throw new ApiError(404, 'Route parameter is missing')
  return value
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status })
}

function inlineContentDisposition(fileName: string) {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName).replaceAll("'", '%27')}`
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

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  const sourceRoot = join(import.meta.dir, '..', '..', '..')
  const configuredHome = process.env.HOPI_HOME?.trim()
  const homeRoot = configuredHome || defaultAssistantHomeRoot()
  if (!configuredHome) {
    const migration = await migrateRepositoryAssistantHome({
      legacyRoot: sourceRoot,
      homeRoot,
    })
    if (migration.relocated || migration.flattenedRuns > 0) {
      console.log(
        `HOPI Home migrated to ${homeRoot}: ${migration.flattenedRuns} Runs flattened, ${migration.preservedArtifacts} artifacts preserved, ${migration.removedScratchRoots} scratch roots removed.`,
      )
    }
    for (const warning of migration.warnings)
      console.warn(`HOPI Home migration warning: ${warning}`)
  }
  const instanceLock = await acquireCoordinatorInstanceLock(
    join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
  )
  const server = createServer({
    rootDir: homeRoot,
    port: process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined,
  })
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await server.shutdown()
    await instanceLock.release()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  console.log(`HOPI listening on http://localhost:${server.port}`)
}
