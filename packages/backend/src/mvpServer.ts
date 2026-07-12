import { join } from 'node:path'
import { z } from 'zod'
import type { RoleRunner } from './agent/RoleRunner'
import { assistantToolRequestSchema } from './assistant/assistantToolSchemas'
import type { AssistantModelRunner } from './assistant/workspaceAssistant'
import {
  normalizeProjectCodingDefaults,
  projectCodingDefaultsInputSchema,
} from './domain/projectCodingDefaults'
import { deriveGoalWorkProjections } from './domain/workProjection'
import { CursorPageError, type CursorPageRequest, paginateItems } from './presentation/cursorPage'
import indexPage from './product.html'
import { acquireCoordinatorInstanceLock } from './publication/instanceLock'
import {
  type AttentionTransport,
  createWebhookAttentionTransport,
} from './runtime/attentionDelivery'
import {
  type MvpProjectRuntime,
  type MvpRuntime,
  createMvpRuntime,
  requireProject,
} from './runtime/mvpRuntime'
import { AssistantImageAttachmentError } from './storage/assistantImageAttachments'

export interface ServerOptions {
  rootDir?: string
  port?: number
  roleRunner?: RoleRunner
  assistantRunner?: AssistantModelRunner
  attentionTransport?: AttentionTransport
  startCoordinator?: boolean
}

export type MvpServer = Bun.Server<undefined> & {
  shutdown(): Promise<void>
}

const projectSchema = z.object({
  projectId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .optional(),
  repoPath: z.string().min(1),
  repoId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .optional(),
})
const rebindProjectSchema = z.object({ repoPath: z.string().min(1) })
const projectRepoSchema = z.object({
  repoId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  repoPath: z.string().min(1),
})
const projectSettingsSchema = z
  .object({ codingDefaults: projectCodingDefaultsInputSchema.nullable() })
  .strict()
const goalSchema = z.object({
  goalId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .optional(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  priority: z.number().int().optional(),
})
const inboxSchema = z
  .object({
    content: z.string(),
    context: z
      .object({
        projectId: z.string().min(1),
        goalId: z.string().min(1),
        attentionId: z.string().min(1).optional(),
      })
      .optional(),
  })
  .strict()

export function createServer(options: ServerOptions = {}): MvpServer {
  const homeRoot = options.rootDir ?? process.cwd()
  const serverRef: { current: Bun.Server<undefined> | null } = { current: null }
  const runtimeOptions = {
    homeRoot,
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
    start: false,
  }
  let runtimePromise = createMvpRuntime(runtimeOptions)
  let reloadTail: Promise<void> = Promise.resolve()

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

  const server = Bun.serve({
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
          return json(await presentState(runtime))
        }
        if (request.method === 'GET' && url.pathname === '/api/assistant/feed') {
          return json(await presentAssistantFeed(runtime, readPageRequest(url, 40, 100)))
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
          const indexedEvents = events.map((event, streamIndex) => ({ ...event, streamIndex }))
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
            await current.rebindProject(projectId, body.repoPath)
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
          const body = await parseBody(request, rebindProjectSchema)
          const nextRuntime = await reloadRuntime(async (current) => {
            await current.rebindRepo(projectId, repoId, body.repoPath)
          })
          return json(await presentState(await nextRuntime))
        }
        if (
          request.method === 'PATCH' &&
          parts.length === 4 &&
          parts[0] === 'api' &&
          parts[1] === 'projects' &&
          parts[3] === 'settings'
        ) {
          const projectId = requirePart(parts, 2)
          const body = await parseBody(request, projectSettingsSchema)
          await runtime.home.updateProjectSettings({
            projectId,
            codingDefaults:
              body.codingDefaults === null
                ? null
                : normalizeProjectCodingDefaults(body.codingDefaults),
          })
          return json(await presentState(runtime))
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
          const goalId = body.goalId ?? `G-${crypto.randomUUID()}`
          const event = await receiveUserEvent(runtime, {
            content: `Create Goal ${goalId}: ${body.title}\n\n${body.objective}`,
          })
          await runtime.assistantTools.executeForEvent(event.attributes.id, 'hopi_create_goal', {
            projectId: project.projectId,
            goalId,
            title: body.title,
            objective: body.objective,
            priority: body.priority,
          })
          await runtime.workspace.handleEvent(event.attributes.id, {
            reply: `Created Goal ${goalId}.`,
            disposition: 'tool:create_goal',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalId), 201)
        }
        if (request.method === 'POST' && url.pathname === '/api/inbox') {
          const body = await parseInboxRequest(request)
          if (body.context) {
            const project = requireProject(runtime.projects, body.context.projectId)
            if (!(await project.store.readGoal(body.context.goalId))) {
              throw new ApiError(404, `Goal not found: ${body.context.goalId}`)
            }
          }
          const event = await receiveUserEvent(runtime, {
            content: body.content,
            images: body.images,
            context: body.context,
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
            return json({
              attempts: attempts.map((attempt) =>
                presentAttempt(attempt, goalPackage, attemptRoute.projectId, attemptRoute.goalId),
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
          return json(
            presentAttempt(attempt, goalPackage, attemptRoute.projectId, attemptRoute.goalId),
          )
        }

        const goalRoute = matchGoalRoute(parts)
        if (goalRoute && request.method === 'GET' && goalRoute.action === null) {
          return json(await presentGoal(runtime, goalRoute.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'pause') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          const event = await receiveUserEvent(runtime, {
            content: `Pause Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
          })
          await runtime.assistantTools.executeForEvent(event.attributes.id, 'hopi_control_goal', {
            projectId: project.projectId,
            goalId: goalRoute.goalId,
            operation: 'pause',
          })
          await runtime.workspace.handleEvent(event.attributes.id, {
            reply: `Paused Goal ${goalRoute.goalId}.`,
            disposition: 'tool:pause',
          })
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'resume') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          const event = await receiveUserEvent(runtime, {
            content: `Resume Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
          })
          await runtime.assistantTools.executeForEvent(event.attributes.id, 'hopi_control_goal', {
            projectId: project.projectId,
            goalId: goalRoute.goalId,
            operation: 'resume',
          })
          await runtime.workspace.handleEvent(event.attributes.id, {
            reply: `Resumed Goal ${goalRoute.goalId}.`,
            disposition: 'tool:resume',
          })
          runtime.coordinator.wake()
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'cancel') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          const event = await receiveUserEvent(runtime, {
            content: `Cancel Goal ${goalRoute.goalId}.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
          })
          await runtime.assistantTools.executeForEvent(event.attributes.id, 'hopi_control_goal', {
            projectId: project.projectId,
            goalId: goalRoute.goalId,
            operation: 'cancel',
          })
          await runtime.workspace.handleEvent(event.attributes.id, {
            reply: `Cancelled Goal ${goalRoute.goalId}.`,
            disposition: 'tool:cancel',
          })
          return json(await presentGoal(runtime, project.projectId, goalRoute.goalId))
        }
        if (goalRoute && request.method === 'POST' && goalRoute.action === 'reopen') {
          const project = requireProject(runtime.projects, goalRoute.projectId)
          const event = await receiveUserEvent(runtime, {
            content: `Reopen Goal ${goalRoute.goalId} and reassess its current contract.`,
            context: { projectId: project.projectId, goalId: goalRoute.goalId },
          })
          await runtime.assistantTools.executeForEvent(event.attributes.id, 'hopi_control_goal', {
            projectId: project.projectId,
            goalId: goalRoute.goalId,
            operation: 'reopen',
          })
          await runtime.workspace.handleEvent(event.attributes.id, {
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
              projectRoot: project.projectRoot,
              primaryRepoId: project.primaryRepoId,
              repoRoots: project.repos.map((repo) => ({
                repoId: repo.repoId,
                path: repo.integrationRoot,
              })),
            }),
          )
        }
        if (previewRoute && request.method === 'POST' && previewRoute.action === 'stop') {
          return json({ session: await runtime.preview.stop(previewRoute.projectId) })
        }
        if (previewRoute && request.method === 'GET' && previewRoute.action === null) {
          return json({ session: runtime.preview.inspect(previewRoute.projectId) })
        }
        if (request.method === 'POST' && url.pathname === '/api/preview/repair') {
          const body = await parseBody(request, z.object({ prompt: z.string().min(1) }))
          const event = await receiveUserEvent(runtime, { content: body.prompt })
          runtime.coordinator.wake()
          return json({ eventId: event.attributes.id }, 202)
        }
        return json({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof ApiError) return json({ error: error.message }, error.status)
        if (error instanceof AssistantImageAttachmentError) {
          return json({ error: error.message }, 400)
        }
        if (error instanceof CursorPageError) return json({ error: error.message }, 400)
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

async function presentState(runtime: MvpRuntime) {
  const [home, workspace] = await Promise.all([
    runtime.home.readHome(),
    runtime.workspace.readWorkspace(),
  ])
  const projects = []
  const goalAttentions = []
  for (const project of runtime.projects.values()) {
    const modelSettings = await runtime.readProjectCodingDefaults(project.projectId)
    const goals = []
    for (const goalId of await project.store.listGoalIds()) {
      const goalPackage = await project.store.readPackage(goalId)
      const projectAttentionOpen = [...workspace.attentions.values()].some(
        (attention) =>
          attention.attributes.target === `project:${project.projectId}` &&
          attention.attributes.resolvedAt === null,
      )
      const liveWorkIds = new Set(
        [...runtime.coordinator.activeRuns().keys()]
          .filter((key) => key.startsWith(`${project.projectId}/${goalId}/`))
          .map((key) => key.slice(`${project.projectId}/${goalId}/`.length)),
      )
      const projections = deriveGoalWorkProjections(project.projectId, goalId, goalPackage, {
        projectEligible: !projectAttentionOpen,
        projectAttentionOpen,
        liveRunWorkIds: liveWorkIds,
        operationallyDeferredWorkIds:
          project.reconciler.operationallyDeferredWorkIds?.(goalId) ?? new Set(),
        passCapacity: { planner: true, generator: true, reviewer: true },
        maxAttempts: 3,
      })
      const summaries = deriveGoalSummaries(goalPackage, projections)
      goals.push({
        id: goalId,
        title: goalPackage.goal.attributes.title,
        lifecycle: goalPackage.goal.attributes.lifecycle,
        priority: goalPackage.goal.attributes.priority,
        ...summaries,
        openAttentionCount: [...goalPackage.attentions.values()].filter(
          (attention) =>
            attention.attributes.target !== null && attention.attributes.resolvedAt === null,
        ).length,
      })
      for (const attention of goalPackage.attentions.values()) {
        if (
          attention.attributes.target === null &&
          (goalPackage.goal.attributes.lifecycle !== 'done' ||
            goalPackage.goal.attributes.completionAttentionId !== attention.attributes.id)
        ) {
          continue
        }
        goalAttentions.push({
          projectId: project.projectId,
          goalId,
          ...attention.attributes,
          body: attention.body,
        })
      }
    }
    projects.push({
      projectId: project.projectId,
      primaryRepoId: project.primaryRepoId,
      repos: project.repos.map((repo) => ({
        repoId: repo.repoId,
        repoPath: repo.repoPath,
        integrationRoot: repo.integrationRoot,
        primary: repo.primary,
      })),
      repoPath: project.repoPath,
      guidance: await readProjectGuidance(project.projectRoot),
      codingDefaults: modelSettings.codingDefaults,
      codingDefaultsInherited: modelSettings.inherited,
      preview: runtime.preview.inspect(project.projectId),
      goals,
    })
  }
  return {
    home,
    projects,
    attentions: [
      ...[...workspace.attentions.values()].map((attention) => ({
        scope: 'workspace',
        ...attention.attributes,
        body: attention.body,
      })),
      ...goalAttentions.map((attention) => ({ scope: 'goal', ...attention })),
    ],
    activeRuns: [...runtime.coordinator.activeRuns()].map(([key, responsibility]) => ({
      key,
      responsibility,
    })),
  }
}

async function presentAssistantFeed(runtime: MvpRuntime, request: CursorPageRequest) {
  const workspace = await runtime.workspace.readWorkspace()
  const goalCompletions = await readGoalCompletionAttentions(runtime)
  const completions = [
    ...[...workspace.attentions.values()]
      .filter((attention) => attention.attributes.target === null)
      .map((attention) => ({
        scope: 'workspace' as const,
        ...attention.attributes,
        body: attention.body,
      })),
    ...goalCompletions,
  ]
  const completionById = new Map(completions.map((attention) => [attention.id, attention]))
  const publicEvents = [...workspace.events.values()].filter(
    (event) => event.attributes.visibility === 'public',
  )
  const linkedCompletionIds = new Set(
    publicEvents
      .map((event) => event.attributes.context?.attentionId)
      .filter((id): id is string => Boolean(id && completionById.has(id))),
  )
  const entries = [
    ...publicEvents.map((event) => ({
      kind: 'event' as const,
      id: `event:${event.attributes.id}`,
      occurredAt: event.attributes.receivedAt,
      event,
      completion: event.attributes.context?.attentionId
        ? (completionById.get(event.attributes.context.attentionId) ?? null)
        : null,
    })),
    ...completions
      .filter((attention) => !linkedCompletionIds.has(attention.id))
      .map((attention) => ({
        kind: 'completion' as const,
        id: `completion:${attention.scope}:${attention.id}`,
        occurredAt: attention.notifiedAt ?? attention.resolvedAt ?? attention.createdAt,
        attention,
      })),
  ].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  )
  const page = paginateItems(entries, request, {
    scope: 'assistant-feed',
    getId: (entry) => entry.id,
  })

  return {
    ...page,
    items: await Promise.all(
      page.items.map(async (entry) => {
        if (entry.kind === 'completion') return entry
        const turn = await runtime.assistantConversation.readTurn(entry.event.attributes.id)
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
            runtimeStatus:
              entry.event.attributes.status === 'handled'
                ? 'completed'
                : (turn?.manifest.status ?? 'queued'),
            runtimeEvents: turn?.events ?? [],
            runtimeError: turn?.manifest.error ?? null,
          },
        }
      }),
    ),
  }
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
  const focus = ordered.find((projection) => projection.primaryBadge === 'Needs you') ?? ordered[0]
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
  const producerRun = `project:${projectId}/goal:${goalId}/work:${attempt.workId}/run:${attempt.runId}`
  const evidence = [...goalPackage.evidence.values()].find(
    (document) => document.attributes.producerRun === producerRun,
  )
  if (!evidence) return attempt
  const publishedResult = evidence.body.match(/^- Result: (success|reject|replan|fail)$/m)?.[1]
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

async function receiveUserEvent(
  runtime: MvpRuntime,
  input: Parameters<MvpRuntime['workspace']['receiveEvent']>[0],
) {
  const event = await runtime.workspace.receiveEvent(input)
  runtime.reflection.interruptForUser()
  runtime.coordinator.interruptInternalAssistant()
  return event
}

async function presentGoal(runtime: MvpRuntime, projectId: string, goalId: string) {
  const project = requireProject(runtime.projects, projectId)
  const goalPackage = await project.store.readPackage(goalId)
  const activePrefix = `${projectId}/${goalId}/`
  const liveWorkIds = new Set(
    [...runtime.coordinator.activeRuns().keys()]
      .filter((key) => key.startsWith(activePrefix))
      .map((key) => key.slice(activePrefix.length)),
  )
  const workspace = await runtime.workspace.readWorkspace()
  const projectAttentionOpen = [...workspace.attentions.values()].some(
    (attention) =>
      attention.attributes.target === `project:${projectId}` &&
      attention.attributes.resolvedAt === null,
  )
  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, {
    projectEligible: !projectAttentionOpen,
    projectAttentionOpen,
    liveRunWorkIds: liveWorkIds,
    operationallyDeferredWorkIds:
      project.reconciler.operationallyDeferredWorkIds?.(goalId) ?? new Set(),
    passCapacity: { planner: true, generator: true, reviewer: true },
    maxAttempts: 3,
  })
  const projectionByWork = new Map(projections.map((projection) => [projection.workId, projection]))
  const designSnapshot = await runtime.publisher.snapshotTree(
    project.store.paths.publicationRoot,
    project.store.paths.designRoot(goalId),
  )
  return {
    projectId,
    goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
    works: [...goalPackage.works.values()].map((work) => ({
      ...work.attributes,
      body: work.body,
      projection: projectionByWork.get(work.attributes.id),
    })),
    design: designSnapshot.files.map((file) => ({
      path: file.path,
      content: file.content ? new TextDecoder().decode(file.content) : '',
    })),
    attentions: [...goalPackage.attentions.values()].map((attention) => ({
      scope: 'goal' as const,
      projectId,
      goalId,
      ...attention.attributes,
      body: attention.body,
    })),
    evidence: [...goalPackage.evidence.values()].map((evidence) => ({
      ...evidence.attributes,
      body: evidence.body,
    })),
  }
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
    action !== 'reopen'
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4], action }
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

async function parseBody<T>(request: Request, schema: z.ZodType<T>) {
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
  const homeRoot = process.env.HOPI_HOME ?? join(import.meta.dir, '..', '..', '..')
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
