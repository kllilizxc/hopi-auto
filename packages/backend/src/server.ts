import { join } from 'node:path'
import type { AgentRunner } from './agent/AgentRunner'
import { ensureDefaultAgentAdapterConfig } from './agent/defaultAdapterConfig'
import {
  GoalAssistantAttachmentTransportError,
  GoalAssistantNotConfiguredError,
} from './assistant/GoalAssistantRuntime'
import {
  AnswerInterpretationError,
  listInterpretableFollowThroughAnswerCandidateGroups,
  materializeInterpretedDecisionBundle,
  materializeInterpretedPlanningInput,
  materializeInterpretedPlanningWorkflowBatchInput,
} from './runtime/answerInterpretation'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
  resolveGoalDecision,
} from './runtime/decisionRequest'
import { GoalScaffoldError, createGoalScaffold, listProjectGoals } from './runtime/goalScaffold'
import { paginateMessageFeedItems, runToFeedItems } from './runtime/messageFeed'
import {
  listGoalPlanningWorkflows,
  readGoalPlanningWorkflow,
  requestGoalPlanning,
  requestGoalPlanningWorkflows,
} from './runtime/planningRequest'
import { handleGoalActionRoute } from './serverGoalActionRoutes'
import { parseJsonBody, readBundleFile } from './serverRequestParsing'
import { createServerRuntimeSupport } from './serverRuntimeSupport'
import {
  answerDecisionBatchSchema,
  answerDecisionSchema,
  createDecisionSchema,
  createPlanningRequestSchema,
  createPlanningWorkflowBatchSchema,
  createProjectGoalSchema,
  createProjectSchema,
  recordPreferenceSchema,
  resolveDecisionSchema,
  retirePreferenceSchema,
  updatePreferenceSchema,
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

        if (request.method === 'GET' && url.pathname === '/api/preferences') {
          return jsonResponse(await runtime.defaultContext.preferences.readPreferences())
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences') {
          const body = await parseJsonBody(request, updatePreferenceSchema)
          const document = await runtime.defaultContext.preferences.writePreferences(body.content)
          runtime.broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/record') {
          const body = await parseJsonBody(request, recordPreferenceSchema)
          const document = await runtime.defaultContext.preferences.recordPreference(body)
          runtime.broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/retire') {
          const body = await parseJsonBody(request, retirePreferenceSchema)
          const document = await runtime.defaultContext.preferences.retirePreference(body)
          runtime.broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
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

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'decisions')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          return jsonResponse(
            await requireRouteContext(routeContext).context.decisions.readGoalDecisions(
              currentGoalKey,
            ),
          )
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'planning-requests', 1)) {
          if (requireGoalExtra(goalRoute, 0) !== 'workflows') {
            throw new HttpError(404, 'Not found')
          }
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentContext = requireRouteContext(routeContext).context
          return jsonResponse({
            goalKey: currentGoalKey,
            workflows: await listGoalPlanningWorkflows(
              {
                boardStore: currentContext.store,
                planningRequests: currentContext.planningRequests,
              },
              {
                goalKey: currentGoalKey,
              },
            ),
          })
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'planning-requests', 2)) {
          if (requireGoalExtra(goalRoute, 0) !== 'workflows') {
            throw new HttpError(404, 'Not found')
          }
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const workflowKey = requireGoalExtra(goalRoute, 1)
          const currentContext = requireRouteContext(routeContext).context
          const workflow = await readGoalPlanningWorkflow(
            {
              boardStore: currentContext.store,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              workflowKey,
            },
          )
          if (!workflow) {
            throw new HttpError(404, `Planning workflow not found: ${workflowKey}`)
          }
          return jsonResponse(workflow)
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'planning-requests')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          return jsonResponse(
            await requireRouteContext(
              routeContext,
            ).context.planningRequests.readGoalPlanningRequests(currentGoalKey),
          )
        }

        if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'decisions')) {
          const currentGoalRoute = requireGoalRoute(goalRoute)
          const currentGoalKey = currentGoalRoute.goalKey
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, createDecisionSchema)
          const result = await requestGoalDecision(
            {
              boardStore: currentContext.store,
              decisions: currentContext.decisions,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey: body.decisionKey,
              summary: body.summary,
              summaryKey: body.summaryKey,
              prompt: body.prompt,
              matchHints: body.matchHints,
              taskRef: body.taskRef,
              writer: 'api',
              reason: `api request decision ${body.decisionKey ?? body.summary}`,
            },
          )
          await currentContext.actionRequired.reconcileGoal(currentGoalKey)
          runtime.broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.blockerAdded) {
            runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          }
          return jsonResponse(result.decision, result.created ? 201 : 200)
        }

        if (
          request.method === 'POST' &&
          isGoalLeafRoute(goalRoute, 'decisions', 1) &&
          requireGoalExtra(goalRoute, 0) === 'answer'
        ) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, answerDecisionSchema)
          const materialized = materializeInterpretedDecisionBundle({
            answers: [
              {
                summary: body.summary,
                summaryKey: body.summaryKey,
                prompt: body.prompt,
                matchHints: body.matchHints,
                decisionKey: body.decisionKey,
                taskRef: body.taskRef,
                answer: body.answer,
                sourceExcerpt: body.sourceExcerpt,
                sourceOccurrence: body.sourceOccurrence,
                answerSourceKey: body.answerSourceKey,
                answerSourceGroupKey: body.answerSourceGroupKey,
              },
            ],
            openDecisions: [],
            inferOpenDecisions: false,
            sourceResponse: body.sourceResponse,
            answerSources: body.answerSources,
            sourceResponseFormat: body.sourceResponseFormat,
            followThrough: body.followThrough,
            reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
              body.followThrough,
            ),
          })
          const answers = materialized.answers
          const firstAnswer = answers[0]
          if (!firstAnswer) {
            throw new HttpError(400, 'Expected one decision answer.')
          }
          const result = await answerGoalDecision(
            {
              boardStore: currentContext.store,
              decisions: currentContext.decisions,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey: firstAnswer.decisionKey,
              summary: firstAnswer.summary,
              summaryKey: firstAnswer.summaryKey,
              prompt: firstAnswer.prompt,
              matchHints: firstAnswer.matchHints,
              captureFormat: firstAnswer.captureFormat,
              taskRef: firstAnswer.taskRef,
              answer: firstAnswer.answer,
              followThrough: materialized.followThrough,
              writer: 'api',
              reason: `api record answer ${body.decisionKey ?? body.summary}`,
            },
          )
          await currentContext.actionRequired.reconcileGoal(currentGoalKey)
          runtime.broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            runtime.broadcastGoalEvent(
              'planning_requests_changed',
              currentGoalKey,
              currentProjectKey,
            )
          }
          if (result.blockerRemoved || result.followThrough) {
            runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          }
          return jsonResponse(
            {
              ...result,
              ...(materialized.sourceResponseFormat
                ? { resolvedSourceResponseFormat: materialized.sourceResponseFormat }
                : {}),
            },
            result.created ? 201 : 200,
          )
        }

        if (
          request.method === 'POST' &&
          isGoalLeafRoute(goalRoute, 'decisions', 1) &&
          requireGoalExtra(goalRoute, 0) === 'answers'
        ) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, answerDecisionBatchSchema)
          const current = await currentContext.decisions.readGoalDecisions(currentGoalKey)
          const materialized = materializeInterpretedDecisionBundle({
            answers: body.answers,
            openDecisions: current.decisions
              .filter((decision) => decision.status === 'open')
              .map((decision) => ({
                decisionKey: decision.decisionKey,
                summary: decision.summary,
                summaryKey: decision.summaryKey,
                prompt: decision.prompt,
                matchHints: decision.matchHints,
                taskRef: decision.taskRef,
              })),
            inferOpenDecisions: body.inferOpenDecisions ?? false,
            sourceResponse: body.sourceResponse,
            answerSources: body.answerSources,
            sourceResponseFormat: body.sourceResponseFormat,
            inferDecisionTopics: body.inferDecisionTopics ?? false,
            knownDecisions: current.decisions.map((decision) => ({
              decisionKey: decision.decisionKey,
              summary: decision.summary,
              summaryKey: decision.summaryKey,
              prompt: decision.prompt,
              matchHints: decision.matchHints,
              taskRef: decision.taskRef,
            })),
            followThrough: body.followThrough,
            reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
              body.followThrough,
            ),
          })
          const answers = materialized.answers
          const result = await answerGoalDecisions(
            {
              boardStore: currentContext.store,
              decisions: currentContext.decisions,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              answers,
              followThrough: materialized.followThrough,
              writer: 'api',
              reason: `api record answers ${answers
                .map((answer) => answer.decisionKey ?? answer.summary)
                .join(', ')}`,
            },
          )
          await currentContext.actionRequired.reconcileGoal(currentGoalKey)
          runtime.broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            runtime.broadcastGoalEvent(
              'planning_requests_changed',
              currentGoalKey,
              currentProjectKey,
            )
          }
          if (result.blockerRemoved || result.followThrough) {
            runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          }
          return jsonResponse(
            {
              ...result,
              ...(materialized.sourceResponseFormat
                ? { resolvedSourceResponseFormat: materialized.sourceResponseFormat }
                : {}),
            },
            result.createdDecisionKeys.length > 0 ? 201 : 200,
          )
        }

        if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'decisions', 2)) {
          if (requireGoalExtra(goalRoute, 1) !== 'resolve') {
            throw new HttpError(404, 'Not found')
          }
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const decisionKey = requireGoalExtra(goalRoute, 0)
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, resolveDecisionSchema)
          const current = await currentContext.decisions.readGoalDecisions(currentGoalKey)
          if (!current.decisions.some((item) => item.decisionKey === decisionKey)) {
            throw new HttpError(404, `Decision not found: ${decisionKey}`)
          }
          const materialized = materializeInterpretedDecisionBundle({
            answers: [
              {
                summary: body.summary ?? `Decision: ${decisionKey}`,
                summaryKey: body.summaryKey,
                prompt: body.prompt,
                matchHints: body.matchHints,
                decisionKey,
                taskRef: body.taskRef,
                answer: body.answer,
                sourceExcerpt: body.sourceExcerpt,
                sourceOccurrence: body.sourceOccurrence,
                answerSourceKey: body.answerSourceKey,
                answerSourceGroupKey: body.answerSourceGroupKey,
              },
            ],
            openDecisions: [],
            inferOpenDecisions: false,
            sourceResponse: body.sourceResponse,
            answerSources: body.answerSources,
            sourceResponseFormat: body.sourceResponseFormat,
            followThrough: body.followThrough,
            reservedAnswerCandidates: listInterpretableFollowThroughAnswerCandidateGroups(
              body.followThrough,
            ),
          })
          const materializedAnswers = materialized.answers
          const firstAnswer = materializedAnswers[0]
          if (!firstAnswer) {
            throw new HttpError(400, `Expected one decision answer for ${decisionKey}.`)
          }
          const result = await resolveGoalDecision(
            {
              boardStore: currentContext.store,
              decisions: currentContext.decisions,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              decisionKey,
              summaryKey: firstAnswer.summaryKey,
              prompt: firstAnswer.prompt,
              matchHints: firstAnswer.matchHints,
              captureFormat: firstAnswer.captureFormat,
              answer: firstAnswer.answer,
              followThrough: materialized.followThrough,
              writer: 'api',
              reason: `api resolve decision ${decisionKey}`,
            },
          )
          await currentContext.actionRequired.reconcileGoal(currentGoalKey)
          runtime.broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            runtime.broadcastGoalEvent(
              'planning_requests_changed',
              currentGoalKey,
              currentProjectKey,
            )
          }
          if (result.blockerRemoved || result.followThrough) {
            runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          }
          return jsonResponse({
            ...result,
            ...(materialized.sourceResponseFormat
              ? { resolvedSourceResponseFormat: materialized.sourceResponseFormat }
              : {}),
          })
        }

        if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'planning-requests', 1)) {
          if (requireGoalExtra(goalRoute, 0) !== 'workflows') {
            throw new HttpError(404, 'Not found')
          }
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, createPlanningWorkflowBatchSchema)
          const materialized = materializeInterpretedPlanningWorkflowBatchInput(
            {
              workflowKey: body.workflowKey,
              reuseTaskRef: body.reuseTaskRef,
              reuseGroupKey: body.reuseGroupKey,
              inferRemainingAnswers: body.inferRemainingAnswers,
              answers: body.answers,
              workflows: body.workflows,
            },
            body.sourceResponse,
            body.answerSources,
            body.sourceResponseFormat,
          )
          const result = await requestGoalPlanningWorkflows(
            {
              boardStore: currentContext.store,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              workflowKey: materialized.workflowKey,
              reuseTaskRef: materialized.reuseTaskRef,
              reuseGroupKey: materialized.reuseGroupKey,
              decisionRefs: body.decisionRefs,
              answers: materialized.answers,
              workflows: materialized.workflows as Parameters<
                typeof requestGoalPlanningWorkflows
              >[1]['workflows'],
              writer: 'api',
              reason: 'api request planning workflows',
            },
          )
          runtime.broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          return jsonResponse(
            {
              ...result,
              ...(materialized.resolvedSourceResponseFormat
                ? { resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat }
                : {}),
            },
            result.createdRequestKeys.length > 0 ? 201 : 200,
          )
        }

        if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'planning-requests')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentProjectKey = routeContext?.projectKey
          const currentContext = requireRouteContext(routeContext).context
          const body = await parseJsonBody(request, createPlanningRequestSchema)
          const materialized = materializeInterpretedPlanningInput(
            {
              requestKey: body.requestKey,
              groupKey: body.groupKey,
              groupTaskKey: body.groupTaskKey,
              title: body.title,
              description: body.description,
              acceptanceCriteria: body.acceptanceCriteria,
              decisionRefs: body.decisionRefs,
              answers: body.answers,
              requestedUpdates: body.requestedUpdates,
              blockedBy: body.blockedBy,
              inferRemainingAnswers: body.inferRemainingAnswers,
            },
            body.sourceResponse,
            body.answerSources,
            body.sourceResponseFormat,
          )
          const result = await requestGoalPlanning(
            {
              boardStore: currentContext.store,
              planningRequests: currentContext.planningRequests,
            },
            {
              goalKey: currentGoalKey,
              requestKey: materialized.requestKey,
              groupKey: materialized.groupKey,
              groupTaskKey: materialized.groupTaskKey,
              title: materialized.title,
              description: materialized.description,
              acceptanceCriteria: materialized.acceptanceCriteria,
              decisionRefs: materialized.decisionRefs,
              answers: materialized.answers,
              requestedUpdates: materialized.requestedUpdates,
              blockedBy: materialized.blockedBy,
              writer: 'api',
              reason: `api request planning ${materialized.requestKey ?? materialized.title}`,
            },
          )
          runtime.broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          if (result.taskCreated) {
            runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          }
          return jsonResponse(
            {
              ...result.request,
              ...(materialized.resolvedSourceResponseFormat
                ? { resolvedSourceResponseFormat: materialized.resolvedSourceResponseFormat }
                : {}),
            },
            result.created ? 201 : 200,
          )
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
