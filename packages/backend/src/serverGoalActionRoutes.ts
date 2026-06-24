import { assistantThreadToFeedItems, paginateMessageFeedItems } from './runtime/messageFeed'
import { reconcileOnce } from './scheduler/reconcileOnce'
import {
  parseAssistantAttachmentUploadBody,
  parseAssistantRunBody,
  parseJsonBody,
} from './serverRequestParsing'
import type { ResolvedProjectContext, ServerRuntimeSupport } from './serverRuntimeSupport'
import {
  assistantMessageSchema,
  automationStartSchema,
  createTaskSchema,
  moveTaskSchema,
} from './serverSchemas'
import {
  DEFAULT_PROJECT_KEY,
  type GoalRouteMatch,
  HttpError,
  feedEventsResponse,
  isGoalAutomationRoute,
  isGoalLeafRoute,
  isGoalStartRoute,
  isGoalStopRoute,
  jsonResponse,
  numberQuery,
  requireGoalExtra,
  requireGoalRoute,
  requirePathPart,
  requireRouteContext,
  stringQuery,
} from './serverSupport'

export interface GoalActionRouteInput {
  request: Request
  server: Bun.Server<undefined>
  url: URL
  parts: string[]
  goalRoute: GoalRouteMatch | undefined
  routeContext: ResolvedProjectContext | undefined
  runtime: ServerRuntimeSupport
  workerId: string
  projectStore: {
    recordLastOpenedGoal(projectKey: string, goalKey: string): Promise<unknown>
  }
}

export async function handleGoalActionRoute(input: GoalActionRouteInput): Promise<Response | null> {
  const { goalRoute, parts, projectStore, request, routeContext, runtime, server, url, workerId } =
    input

  if (
    request.method === 'GET' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'feed'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentContext = requireRouteContext(routeContext).context
    await currentContext.actionRequired.reconcileGoal(currentGoalKey)
    const thread = await currentContext.assistantThread.readThread(currentGoalKey)
    return jsonResponse(
      paginateMessageFeedItems(assistantThreadToFeedItems(thread), {
        before: stringQuery(url, 'before'),
        limit: numberQuery(url, 'limit'),
      }),
    )
  }

  if (
    request.method === 'GET' &&
    isGoalLeafRoute(goalRoute, 'assistant', 2) &&
    requireGoalExtra(goalRoute, 0) === 'feed' &&
    requireGoalExtra(goalRoute, 1) === 'stream'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentProjectKey = routeContext?.projectKey
    server.timeout(request, 0)
    return feedEventsResponse(
      runtime.assistantFeedClients,
      runtime.assistantFeedScope(currentProjectKey, currentGoalKey),
      async (controller) => {
        await runtime.sendAssistantFeedCatchUp(
          controller,
          requireRouteContext(routeContext).context,
          currentProjectKey,
          currentGoalKey,
          stringQuery(url, 'after'),
        )
      },
    )
  }

  if (
    request.method === 'GET' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'thread'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    return jsonResponse(
      await requireRouteContext(routeContext).context.assistantThread.readThread(currentGoalKey),
    )
  }

  if (
    request.method === 'GET' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'runs'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    return jsonResponse({
      goalKey: currentGoalKey,
      runs: await requireRouteContext(routeContext).context.assistantRuns.listRuns(currentGoalKey),
    })
  }

  if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'assistant', 3)) {
    if (requireGoalExtra(goalRoute, 0) !== 'runs' || requireGoalExtra(goalRoute, 2) !== 'bundle') {
      throw new HttpError(404, 'Not found')
    }
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const assistantRunId = requireGoalExtra(goalRoute, 1)
    const bundle = await requireRouteContext(routeContext).context.assistantRuns.readBundle(
      currentGoalKey,
      assistantRunId,
    )
    if (!bundle) {
      throw new HttpError(404, `Assistant run bundle not found: ${assistantRunId}`)
    }
    return jsonResponse(bundle)
  }

  if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'assistant', 2)) {
    if (requireGoalExtra(goalRoute, 0) !== 'runs') {
      throw new HttpError(404, 'Not found')
    }
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const assistantRunId = requireGoalExtra(goalRoute, 1)
    const run = await requireRouteContext(routeContext).context.assistantRuns.readRun(
      currentGoalKey,
      assistantRunId,
    )
    if (!run) {
      throw new HttpError(404, `Assistant run not found: ${assistantRunId}`)
    }
    return jsonResponse(run)
  }

  if (request.method === 'GET' && goalRoute?.leaf === 'assets' && goalRoute.extra.length >= 1) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const assetPath = goalRoute.extra.join('/')
    const { absolutePath } = requireRouteContext(routeContext).context.attachments.resolveGoalAsset(
      currentGoalKey,
      assetPath,
    )
    const file = Bun.file(absolutePath)
    if (!(await file.exists())) {
      throw new HttpError(404, `Goal asset not found: ${assetPath}`)
    }
    return new Response(file, {
      headers: {
        'content-type': file.type || 'application/octet-stream',
      },
    })
  }

  if (
    request.method === 'POST' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'attachments'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const body = await parseAssistantAttachmentUploadBody(request)
    return jsonResponse(
      {
        goalKey: currentGoalKey,
        attachments: await requireRouteContext(
          routeContext,
        ).context.attachments.persistAssistantImages(currentGoalKey, body.images),
      },
      201,
    )
  }

  if (
    request.method === 'POST' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'messages'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const body = await parseJsonBody(request, assistantMessageSchema)
    return jsonResponse(
      await requireRouteContext(routeContext).context.assistantThread.appendUserMessage(
        currentGoalKey,
        body.content,
        body.attachments,
      ),
      201,
    )
  }

  if (
    request.method === 'POST' &&
    isGoalLeafRoute(goalRoute, 'assistant', 1) &&
    requireGoalExtra(goalRoute, 0) === 'run'
  ) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentProjectKey = routeContext?.projectKey
    const currentContext = requireRouteContext(routeContext).context
    if (!(await currentContext.assistantRuntime.isConfigured())) {
      throw new HttpError(409, 'Goal assistant is not configured.')
    }
    const body = await parseAssistantRunBody(request)
    let activeAssistantRunId: string | null = null
    const result = await currentContext.assistantRuntime
      .run({
        goalKey: currentGoalKey,
        content: body.content,
        images: body.images,
        attachments: body.attachments,
        appendUserMessage: body.appendUserMessage,
        onRunStarted(assistantRunId) {
          activeAssistantRunId = assistantRunId
        },
        onEvent(event, assistantRunId) {
          activeAssistantRunId = assistantRunId
          runtime.broadcastAssistantRuntimeEvent(
            currentProjectKey,
            currentGoalKey,
            assistantRunId,
            event,
          )
        },
      })
      .catch((error) => {
        if (activeAssistantRunId) {
          runtime.clearLiveAssistantDelta(currentProjectKey, currentGoalKey, activeAssistantRunId)
        }
        throw error
      })
    await currentContext.actionRequired.reconcileGoal(currentGoalKey)
    runtime.broadcastGoalEvent('assistant_changed', currentGoalKey, currentProjectKey)
    if (
      result.actionResults.some(
        (actionResult) =>
          actionResult.kind === 'request_decision' ||
          actionResult.kind === 'resolve_decision' ||
          actionResult.kind === 'record_answer' ||
          actionResult.kind === 'record_answers',
      )
    ) {
      runtime.broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
    }
    runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
    if (
      result.actionResults.some(
        (actionResult) =>
          actionResult.kind === 'request_planning' ||
          actionResult.kind === 'request_planning_batch' ||
          actionResult.kind === 'request_planning_workflows' ||
          ((actionResult.kind === 'resolve_decision' ||
            actionResult.kind === 'record_answer' ||
            actionResult.kind === 'record_answers') &&
            (actionResult.followThrough?.requestKeys.length ?? 0) > 0),
      )
    ) {
      runtime.broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
    }
    if (
      result.actionResults.some(
        (actionResult) =>
          actionResult.kind === 'record_preference' || actionResult.kind === 'update_preference',
      )
    ) {
      runtime.broadcast({ type: 'preferences_changed' })
    }
    return jsonResponse(result)
  }

  if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'tasks')) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentProjectKey = routeContext?.projectKey
    const currentContext = requireRouteContext(routeContext).context
    const body = await parseJsonBody(request, createTaskSchema)
    await currentContext.store.mutateBoard(currentGoalKey, 'api', `create ${body.ref}`, (board) => {
      if (board.items.some((task) => task.ref === body.ref)) {
        throw new HttpError(409, `Task already exists: ${body.ref}`)
      }

      board.items.push({
        ...body,
        blockedBy: body.blockedBy ?? [],
        status: 'planned',
      })
    })
    await currentContext.actionRequired.reconcileGoal(currentGoalKey)
    runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
    return jsonResponse(
      await runtime.boardResponse(
        await currentContext.store.readBoard(currentGoalKey),
        currentContext,
      ),
      201,
    )
  }

  if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'tasks', 2)) {
    if (requireGoalExtra(goalRoute, 1) !== 'move') {
      throw new HttpError(404, 'Not found')
    }
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentProjectKey = routeContext?.projectKey
    const currentContext = requireRouteContext(routeContext).context
    const body = await parseJsonBody(request, moveTaskSchema)
    const taskRef = requireGoalExtra(goalRoute, 0)
    await currentContext.store.mutateBoard(
      currentGoalKey,
      'api',
      body.reason ?? 'manual transition',
      (board) => {
        const task = board.items.find((item) => item.ref === taskRef)
        if (!task) {
          throw new HttpError(404, `Task not found: ${taskRef}`)
        }
        task.status = body.status
      },
    )
    await currentContext.actionRequired.reconcileGoal(currentGoalKey)
    runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
    return jsonResponse(
      await runtime.boardResponse(
        await currentContext.store.readBoard(currentGoalKey),
        currentContext,
      ),
    )
  }

  if (request.method === 'GET' && isGoalAutomationRoute(parts)) {
    const projectKey = requirePathPart(parts, 2)
    const currentGoalKey = requirePathPart(parts, 4)
    const projectContext = await runtime.resolveProjectContext(projectKey)
    await runtime.maybeResumeAutomation(projectKey, currentGoalKey, projectContext.context)
    return jsonResponse({
      status: await runtime
        .automationForContext(projectContext.context)
        .getStatus(projectKey, currentGoalKey),
    })
  }

  if (request.method === 'POST' && isGoalStartRoute(parts)) {
    const projectKey = requirePathPart(parts, 2)
    const currentGoalKey = requirePathPart(parts, 4)
    const body = await parseJsonBody(request, automationStartSchema)
    await projectStore.recordLastOpenedGoal(projectKey, currentGoalKey)
    const currentContext = (await runtime.resolveProjectContext(projectKey)).context
    await runtime.recoverExecutionStateForGoal(projectKey, currentGoalKey, currentContext)
    const result = await runtime.automationForContext(currentContext).start({
      projectKey,
      goalKey: currentGoalKey,
      maxSteps: body.maxSteps,
      maxParallel: body.maxParallel,
      laneParallelism: body.laneParallelism,
      executeStep: runtime.buildExecuteStep(projectKey, currentGoalKey, currentContext, {
        maxParallel: body.maxParallel ?? 3,
        laneParallelism: body.laneParallelism,
      }),
    })
    return jsonResponse(result)
  }

  if (request.method === 'POST' && isGoalStopRoute(parts)) {
    const projectKey = requirePathPart(parts, 2)
    const currentGoalKey = requirePathPart(parts, 4)
    const currentContext = (await runtime.resolveProjectContext(projectKey)).context
    return jsonResponse({
      status: await runtime.automationForContext(currentContext).stop(projectKey, currentGoalKey),
    })
  }

  if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'reconcile')) {
    const currentGoalKey = requireGoalRoute(goalRoute).goalKey
    const currentProjectKey = routeContext?.projectKey ?? DEFAULT_PROJECT_KEY
    const currentContext = requireRouteContext(routeContext).context
    await runtime.recoverExecutionStateForGoal(currentProjectKey, currentGoalKey, currentContext)
    const result = await reconcileOnce({
      goalKey: currentGoalKey,
      store: currentContext.store,
      planningRequests: currentContext.planningRequests,
      attempts: currentContext.attempts,
      history: currentContext.history,
      execution: currentContext.execution,
      workerId,
      runner: currentContext.runner,
      writer: 'api',
    })
    await currentContext.actionRequired.reconcileGoal(currentGoalKey)
    runtime.broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
    return jsonResponse(result)
  }

  return null
}
