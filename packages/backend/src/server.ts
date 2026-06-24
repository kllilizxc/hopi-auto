import { join } from 'node:path'
import type { AgentRunner } from './agent/AgentRunner'
import { ensureDefaultAgentAdapterConfig } from './agent/defaultAdapterConfig'
import {
  GoalAssistantAttachmentTransportError,
  GoalAssistantNotConfiguredError,
} from './assistant/GoalAssistantRuntime'
import {
  AnswerInterpretationError,
} from './runtime/answerInterpretation'
import { GoalScaffoldError, createGoalScaffold, listProjectGoals } from './runtime/goalScaffold'
import { paginateMessageFeedItems, runToFeedItems } from './runtime/messageFeed'
import { handleGoalActionRoute } from './serverGoalActionRoutes'
import { parseJsonBody, readBundleFile } from './serverRequestParsing'
import { createServerRuntimeSupport } from './serverRuntimeSupport'
import {
  createProjectGoalSchema,
  createProjectSchema,
  updateProjectSettingsSchema,
} from './serverSchemas'
import {
  DEFAULT_PROJECT_KEY,
  HttpError,
  errorMessage,
  eventsResponse,
  feedEventsResponse,
  isGoalLeafRoute,
  isProjectGoalsCollectionRoute,
  isProjectSettingsRoute,
  isProjectsRoute,
  jsonResponse,
  matchGoalRoute,
  numberQuery,
  requireGoalExtra,
  requireGoalRoute,
  requirePathPart,
  requireRouteContext,
  roleQuery,
  stringQuery,
} from './serverSupport'
import { GoalAttachmentStoreError } from './storage/goalAttachmentStore'
import { createProjectPaths } from './storage/paths'
import { PreferenceStoreError } from './storage/preferenceStore'
import { ProjectStoreError, createProjectStore } from './storage/projectStore'
import indexPage from './ui/index.html'

export interface ServerOptions {
  rootDir?: string
  port?: number
  runner?: AgentRunner
}

export function createServer(options: ServerOptions = {}): Bun.Server<undefined> {
  const rootDir = options.rootDir ?? process.cwd()
  const workerId = crypto.randomUUID()
  const projectStore = createProjectStore(rootDir)
  const runtime = createServerRuntimeSupport({
    rootDir,
    runner: options.runner,
    workerId,
    projectStore,
  })

  return Bun.serve({
    routes: {
      '/': indexPage,
    },
    port: options.port ?? 3000,
    development: false,
    async fetch(request, server) {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const goalRoute = matchGoalRoute(parts)
      const goalKey = goalRoute?.goalKey
      let routeContext: Awaited<ReturnType<typeof runtime.resolveProjectContext>> | undefined

      try {
        if (goalRoute) {
          routeContext = await runtime.resolveProjectContext(goalRoute.projectKey)
        }

        if (request.method === 'GET' && url.pathname === '/api/events') {
          server.timeout(request, 0)
          return eventsResponse(runtime.clients)
        }

        if (request.method === 'GET' && isProjectsRoute(parts)) {
          return jsonResponse({
            projects: await Promise.all(
              (await projectStore.listProjects()).map((project) => runtime.presentProject(project)),
            ),
          })
        }

        if (request.method === 'POST' && isProjectsRoute(parts)) {
          const body = await parseJsonBody(request, createProjectSchema)
          const project = await projectStore.createProject({
            projectKey: body.projectKey,
            name: body.name,
            rootDir: body.rootDir,
          })
          await ensureDefaultAgentAdapterConfig(project.rootDir, body.codingDefaults)
          return jsonResponse(await runtime.presentProject(project), 201)
        }

        if (request.method === 'PATCH' && isProjectSettingsRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const body = await parseJsonBody(request, updateProjectSettingsSchema)
          const project = await projectStore.readProject(projectKey)
          await ensureDefaultAgentAdapterConfig(project.rootDir, body.codingDefaults)
          return jsonResponse(await runtime.presentProject(project))
        }

        if (request.method === 'GET' && isProjectGoalsCollectionRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const projectContext = await runtime.resolveProjectContext(projectKey)
          return jsonResponse({
            projectKey,
            goals: await listProjectGoals(projectContext.context.rootDir),
          })
        }

        if (request.method === 'POST' && isProjectGoalsCollectionRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const projectContext = await runtime.resolveProjectContext(projectKey)
          const body = await parseJsonBody(request, createProjectGoalSchema)
          const goal = await createGoalScaffold(projectContext.context.rootDir, body)
          await projectStore.recordLastOpenedGoal(projectKey, goal.goalKey)
          return jsonResponse(goal, 201)
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'board')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentContext = requireRouteContext(routeContext).context
          const currentProjectKey = routeContext?.projectKey ?? DEFAULT_PROJECT_KEY
          await runtime.maybeResumeAutomation(currentProjectKey, currentGoalKey, currentContext)
          return jsonResponse(
            await runtime.boardResponse(
              await currentContext.store.readBoard(currentGoalKey),
              currentContext,
            ),
          )
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'docs')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentContext = requireRouteContext(routeContext).context
          const board = await currentContext.store.readBoard(currentGoalKey)
          return jsonResponse(
            await currentContext.goalDocs.readGoalDocs(currentGoalKey, board.goal.title),
          )
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'runs')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          return jsonResponse({
            goalKey: currentGoalKey,
            runs: await requireRouteContext(routeContext).context.history.listRuns(currentGoalKey),
          })
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'runs', 1)) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const runId = requireGoalExtra(goalRoute, 0)
          const run = await requireRouteContext(routeContext).context.history.readRun(
            currentGoalKey,
            runId,
          )
          if (!run) {
            throw new HttpError(404, `Run not found: ${runId}`)
          }
          return jsonResponse(run)
        }

        if (
          request.method === 'GET' &&
          isGoalLeafRoute(goalRoute, 'runs', 4) &&
          requireGoalExtra(goalRoute, 1) === 'steps' &&
          requireGoalExtra(goalRoute, 3) === 'bundle'
        ) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const runId = requireGoalExtra(goalRoute, 0)
          const stepId = requireGoalExtra(goalRoute, 2)
          const currentContext = requireRouteContext(routeContext).context
          const run = await currentContext.history.readRun(currentGoalKey, runId)
          if (!run) {
            throw new HttpError(404, `Run not found: ${runId}`)
          }
          const step = run.steps.find((item) => item.stepId === stepId)
          if (!step) {
            throw new HttpError(404, `Step not found: ${stepId}`)
          }

          const paths = createProjectPaths(currentContext.rootDir)
          return jsonResponse({
            goalKey: currentGoalKey,
            runId,
            stepId,
            context: await readBundleFile(paths.runtimeContextPath(currentGoalKey, runId, stepId)),
            prompt: await readBundleFile(paths.runtimePromptPath(currentGoalKey, runId, stepId)),
            outcome: await readBundleFile(paths.runtimeOutcomePath(currentGoalKey, runId, stepId)),
          })
        }

        if (
          request.method === 'GET' &&
          isGoalLeafRoute(goalRoute, 'runs', 2) &&
          requireGoalExtra(goalRoute, 1) === 'feed'
        ) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const runId = requireGoalExtra(goalRoute, 0)
          const run = await requireRouteContext(routeContext).context.history.readRun(
            currentGoalKey,
            runId,
          )
          if (!run) {
            throw new HttpError(404, `Run not found: ${runId}`)
          }

          return jsonResponse(
            paginateMessageFeedItems(runToFeedItems(run, stringQuery(url, 'stepId')), {
              before: stringQuery(url, 'before'),
              limit: numberQuery(url, 'limit'),
            }),
          )
        }

        if (
          request.method === 'GET' &&
          isGoalLeafRoute(goalRoute, 'runs', 3) &&
          requireGoalExtra(goalRoute, 1) === 'feed' &&
          requireGoalExtra(goalRoute, 2) === 'stream'
        ) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const runId = requireGoalExtra(goalRoute, 0)
          const stepId = stringQuery(url, 'stepId')
          const currentProjectKey = routeContext?.projectKey
          server.timeout(request, 0)
          return feedEventsResponse(
            runtime.runFeedClients,
            runtime.runFeedScope(currentProjectKey, currentGoalKey, runId, stepId),
            async (controller) => {
              await runtime.sendRunFeedCatchUp(
                controller,
                requireRouteContext(routeContext).context,
                currentGoalKey,
                runId,
                stepId,
                stringQuery(url, 'after'),
              )
            },
          )
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'write-traces')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          return jsonResponse({
            goalKey: currentGoalKey,
            entries: await requireRouteContext(routeContext).context.writeTraces.listEntries(
              currentGoalKey,
              {
                taskRef: stringQuery(url, 'taskRef'),
                runId: stringQuery(url, 'runId'),
                stepId: stringQuery(url, 'stepId'),
                role: roleQuery(url),
                limit: numberQuery(url, 'limit'),
              },
            ),
          })
        }

        const actionRouteResponse = await handleGoalActionRoute({
          request,
          server,
          url,
          parts,
          goalRoute,
          routeContext,
          runtime,
          workerId,
          projectStore,
        })
        if (actionRouteResponse) {
          return actionRouteResponse
        }

        return jsonResponse({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse({ error: error.message }, error.status)
        }
        if (error instanceof ProjectStoreError) {
          return jsonResponse({ error: error.message }, error.status)
        }
        if (error instanceof GoalScaffoldError) {
          return jsonResponse({ error: error.message }, error.status)
        }
        if (error instanceof GoalAssistantNotConfiguredError) {
          return jsonResponse({ error: error.message }, 409)
        }
        if (error instanceof GoalAssistantAttachmentTransportError) {
          return jsonResponse({ error: error.message }, 409)
        }
        if (error instanceof AnswerInterpretationError) {
          return jsonResponse({ error: error.message }, 400)
        }
        if (error instanceof PreferenceStoreError) {
          return jsonResponse({ error: error.message }, 400)
        }
        if (error instanceof GoalAttachmentStoreError) {
          return jsonResponse({ error: error.message }, 400)
        }

        const correlationId = crypto.randomUUID()
        if (goalKey && routeContext) {
          await routeContext.context.store
            .appendEvent(goalKey, {
              writer: 'api',
              action: 'system_error',
              goalKey,
              systemError: {
                kind: 'route_error',
                message: errorMessage(error),
                correlationId,
              },
            })
            .catch(() => undefined)
        }

        console.error('[api route error]', {
          method: request.method,
          pathname: url.pathname,
          goalKey,
          projectKey: routeContext?.projectKey,
          correlationId,
          error,
        })

        return jsonResponse({ error: 'Internal server error', correlationId }, 500)
      }
    },
  })
}

if (import.meta.main) {
  const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined
  const server = createServer({
    rootDir: join(import.meta.dir, '..', '..', '..'),
    port: Number.isFinite(envPort) ? envPort : undefined,
  })
  console.log(`[API] Server listening on http://localhost:${server.port}`)
}
