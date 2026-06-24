import type { AgentRunner, AgentRuntimeEvent } from './agent/AgentRunner'
import { readAndMigrateAgentAdapterConfig } from './agent/adapterConfig'
import { ensureDefaultAgentAdapterConfig } from './agent/defaultAdapterConfig'
import { assistantRunMergeKey } from './assistant/GoalAssistantRuntime'
import type { TodoBoard } from './domain/board'
import { AutomationController } from './runtime/automationController'
import { recoverGoalExecutionState } from './runtime/executionRecovery'
import { createGoalApiContext } from './runtime/goalApiContext'
import {
  type MessageFeedItem,
  assistantThreadEntryToFeedItem,
  assistantThreadToFeedItems,
  buildAssistantDeltaFeedItem,
  listItemsAfterCursor,
  runMessageToFeedItem,
  runToFeedItems,
  runTranscriptToFeedItem,
} from './runtime/messageFeed'
import type { RunHistoryObservedEntry } from './runtime/runHistoryStore'
import { reconcileOnce } from './scheduler/reconcileOnce'
import type { BoardResponse } from './serverSchemas'
import {
  DEFAULT_PROJECT_KEY,
  type EventClient,
  HttpError,
  assistantRuntimeEventToFeedItem,
} from './serverSupport'
import { createProjectPaths } from './storage/paths'
import type { createProjectStore } from './storage/projectStore'

type GoalApiContext = ReturnType<typeof createGoalApiContext>
type ProjectStore = ReturnType<typeof createProjectStore>
type ProjectRecord = Awaited<ReturnType<ProjectStore['readProject']>>

export interface ResolvedProjectContext {
  projectKey: string
  project?: ProjectRecord
  context: GoalApiContext
}

export interface CreateServerRuntimeSupportInput {
  rootDir: string
  runner?: AgentRunner
  workerId: string
  projectStore: ProjectStore
}

export interface ServerRuntimeSupport {
  assistantFeedClients: Map<string, Set<EventClient>>
  clients: Set<EventClient>
  defaultContext: GoalApiContext
  runFeedClients: Map<string, Set<EventClient>>
  assistantFeedScope(projectKey: string | undefined, goalKey: string): string
  automationForContext(context: GoalApiContext): AutomationController
  boardResponse(board: TodoBoard, context: GoalApiContext): Promise<BoardResponse>
  broadcast(payload: unknown): void
  broadcastAssistantRuntimeEvent(
    projectKey: string | undefined,
    goalKey: string,
    assistantRunId: string,
    event: AgentRuntimeEvent,
  ): void
  broadcastGoalEvent(
    type: string,
    goalKey: string,
    projectKey?: string,
    extra?: Record<string, unknown>,
  ): void
  buildExecuteStep(
    projectKey: string,
    goalKey: string,
    context: GoalApiContext,
    options?: {
      maxParallel?: number
      laneParallelism?: {
        in_progress?: number
        in_review?: number
        merging?: number
      }
    },
  ): () => Promise<Awaited<ReturnType<typeof reconcileOnce>>>
  clearLiveAssistantDelta(
    projectKey: string | undefined,
    goalKey: string,
    assistantRunId: string,
  ): void
  maybeResumeAutomation(projectKey: string, goalKey: string, context: GoalApiContext): Promise<void>
  presentProject(project: ProjectRecord): Promise<ProjectRecord & { codingDefaults: unknown }>
  recoverExecutionStateForGoal(
    projectKey: string,
    goalKey: string,
    context: GoalApiContext,
  ): Promise<Awaited<ReturnType<typeof recoverGoalExecutionState>>>
  resolveProjectContext(projectKey?: string): Promise<ResolvedProjectContext>
  runFeedScope(
    projectKey: string | undefined,
    goalKey: string,
    runId: string,
    stepId?: string,
  ): string
  sendAssistantFeedCatchUp(
    controller: EventClient,
    context: GoalApiContext,
    projectKey: string | undefined,
    goalKey: string,
    after?: string,
  ): Promise<void>
  sendRunFeedCatchUp(
    controller: EventClient,
    context: GoalApiContext,
    goalKey: string,
    runId: string,
    stepId: string | undefined,
    after?: string,
  ): Promise<void>
}

export function createServerRuntimeSupport(
  input: CreateServerRuntimeSupportInput,
): ServerRuntimeSupport {
  const { projectStore, rootDir, runner, workerId } = input
  const encoder = new TextEncoder()
  const contextCache = new Map<string, GoalApiContext>()
  const automationByRootDir = new Map<string, AutomationController>()
  const projectKeyByRootDir = new Map<string, string>()
  const clients = new Set<EventClient>()
  const assistantFeedClients = new Map<string, Set<EventClient>>()
  const runFeedClients = new Map<string, Set<EventClient>>()
  const liveAssistantDeltas = new Map<string, Map<string, MessageFeedItem>>()

  function broadcast(payload: unknown) {
    const message = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
    for (const client of clients) {
      try {
        client.enqueue(message)
      } catch {
        clients.delete(client)
      }
    }
  }

  function assistantFeedScope(projectKey: string | undefined, goalKey: string) {
    return `${projectKey ?? DEFAULT_PROJECT_KEY}:${goalKey}`
  }

  function runFeedScope(
    projectKey: string | undefined,
    goalKey: string,
    runId: string,
    stepId?: string,
  ) {
    return `${assistantFeedScope(projectKey, goalKey)}:${runId}:${stepId ?? '*'}`
  }

  function emitToFeedClients(
    feedClients: Map<string, Set<EventClient>>,
    scope: string,
    payload: unknown,
  ) {
    const targets = feedClients.get(scope)
    if (!targets || targets.size === 0) {
      return
    }

    const message = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
    for (const client of targets) {
      try {
        client.enqueue(message)
      } catch {
        targets.delete(client)
      }
    }

    if (targets.size === 0) {
      feedClients.delete(scope)
    }
  }

  function broadcastAssistantFeedItem(
    projectKey: string | undefined,
    goalKey: string,
    entry: Parameters<typeof assistantThreadEntryToFeedItem>[0],
  ) {
    const item = assistantThreadEntryToFeedItem(entry)
    if (entry.kind === 'assistant_message' && entry.mergeKey) {
      liveAssistantDeltas.get(assistantFeedScope(projectKey, goalKey))?.delete(entry.mergeKey)
    }

    emitToFeedClients(assistantFeedClients, assistantFeedScope(projectKey, goalKey), {
      type: 'item',
      item,
    })
  }

  function broadcastRunFeedItem(projectKey: string | undefined, entry: RunHistoryObservedEntry) {
    const item =
      entry.kind === 'message'
        ? runMessageToFeedItem({
            runId: entry.runId,
            step: {
              stepId: entry.stepId,
              role: entry.stepRole,
              statusBefore: 'planned',
              startedAt: entry.message.createdAt,
              outcome: 'running',
              transcript: [],
              messages: [],
            },
            message: entry.message,
          })
        : runTranscriptToFeedItem({
            runId: entry.runId,
            step: {
              stepId: entry.stepId,
              role: entry.stepRole,
              statusBefore: 'planned',
              startedAt: entry.entry.createdAt,
              outcome: 'running',
              transcript: [],
              messages: [],
            },
            entry: entry.entry,
          })

    emitToFeedClients(runFeedClients, runFeedScope(projectKey, entry.goalKey, entry.runId), {
      type: 'item',
      item,
    })
    emitToFeedClients(
      runFeedClients,
      runFeedScope(projectKey, entry.goalKey, entry.runId, entry.stepId),
      {
        type: 'item',
        item,
      },
    )
  }

  const defaultContext = createGoalApiContext(rootDir, runner, {
    assistantThreadObserver: {
      onEntry(goalKey, entry) {
        const projectKey = projectKeyByRootDir.get(rootDir)
        broadcastAssistantFeedItem(projectKey, goalKey, entry)
      },
    },
    runHistoryObserver: {
      onEntry(entry) {
        const projectKey = projectKeyByRootDir.get(rootDir)
        broadcastRunFeedItem(projectKey, entry)
      },
    },
    executionObserver: {
      async onGoalExecutionChanged(goalKey) {
        const projectKey = projectKeyByRootDir.get(rootDir)
        broadcastGoalEvent('board_changed', goalKey, projectKey)
      },
      async onAutomationChanged(goalKey, status) {
        broadcast({
          type: 'automation_changed',
          projectKey: status.projectKey === DEFAULT_PROJECT_KEY ? undefined : status.projectKey,
          goalKey,
          status,
        })
      },
    },
  })

  async function sendAssistantFeedCatchUp(
    controller: EventClient,
    context: GoalApiContext,
    projectKey: string | undefined,
    goalKey: string,
    after?: string,
  ) {
    const thread = await context.assistantThread.readThread(goalKey)
    const persistedItems = listItemsAfterCursor(assistantThreadToFeedItems(thread), after)
    for (const item of persistedItems) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'item', item })}\n\n`))
    }

    const liveItems = [
      ...(liveAssistantDeltas.get(assistantFeedScope(projectKey, goalKey))?.values() ?? []),
    ].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    for (const item of liveItems) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'item', item })}\n\n`))
    }
  }

  async function sendRunFeedCatchUp(
    controller: EventClient,
    context: GoalApiContext,
    goalKey: string,
    runId: string,
    stepId: string | undefined,
    after?: string,
  ) {
    const run = await context.history.readRun(goalKey, runId)
    if (!run) {
      throw new HttpError(404, `Run not found: ${runId}`)
    }

    const items = listItemsAfterCursor(runToFeedItems(run, stepId), after)
    for (const item of items) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'item', item })}\n\n`))
    }
  }

  function clearLiveAssistantDelta(
    projectKey: string | undefined,
    goalKey: string,
    assistantRunId: string,
  ) {
    const scope = assistantFeedScope(projectKey, goalKey)
    const mergeKey = assistantRunMergeKey(assistantRunId)
    const scoped = liveAssistantDeltas.get(scope)
    if (!scoped) {
      return
    }

    scoped.delete(mergeKey)
    if (scoped.size === 0) {
      liveAssistantDeltas.delete(scope)
    }
  }

  function broadcastAssistantRuntimeEvent(
    projectKey: string | undefined,
    goalKey: string,
    assistantRunId: string,
    event: AgentRuntimeEvent,
  ) {
    const scope = assistantFeedScope(projectKey, goalKey)
    if (event.kind === 'transcript' && event.entryKind === 'assistant') {
      const mergeKey = assistantRunMergeKey(assistantRunId)
      const currentItems = liveAssistantDeltas.get(scope) ?? new Map<string, MessageFeedItem>()
      const currentItem = currentItems.get(mergeKey)
      const nextItem = buildAssistantDeltaFeedItem({
        id: `assistant-delta:${assistantRunId}`,
        createdAt: new Date().toISOString(),
        text: `${currentItem?.text ?? ''}${event.summary}`,
        mergeKey,
      })
      currentItems.set(mergeKey, nextItem)
      liveAssistantDeltas.set(scope, currentItems)
      emitToFeedClients(assistantFeedClients, scope, {
        type: 'item',
        item: nextItem,
      })
      return
    }

    const item = assistantRuntimeEventToFeedItem(assistantRunId, event)
    if (!item) {
      return
    }

    emitToFeedClients(assistantFeedClients, scope, {
      type: 'item',
      item,
    })
  }

  function broadcastGoalEvent(
    type: string,
    goalKey: string,
    projectKey?: string,
    extra?: Record<string, unknown>,
  ) {
    broadcast({
      type,
      goalKey,
      ...(projectKey && projectKey !== DEFAULT_PROJECT_KEY ? { projectKey } : {}),
      ...extra,
    })
  }

  function automationForContext(context: GoalApiContext) {
    const current = automationByRootDir.get(context.rootDir)
    if (current) {
      return current
    }
    const created = new AutomationController(context.execution)
    automationByRootDir.set(context.rootDir, created)
    return created
  }

  async function heartbeatKnownWorkers() {
    const contexts = new Map<string, GoalApiContext>()
    contexts.set(defaultContext.rootDir, defaultContext)
    for (const context of contextCache.values()) {
      contexts.set(context.rootDir, context)
    }
    await Promise.all([...contexts.values()].map((context) => context.workers.heartbeat(workerId)))
  }

  void heartbeatKnownWorkers()
  setInterval(() => {
    void heartbeatKnownWorkers()
  }, 5_000)

  async function boardResponse(board: TodoBoard, context: GoalApiContext): Promise<BoardResponse> {
    const runningTaskRefs = new Set(
      (await context.execution.listActiveTaskExecutions(board.goal.goalKey)).map(
        (task) => task.taskRef,
      ),
    )
    if (runningTaskRefs.size === 0) {
      return board
    }

    return {
      ...board,
      items: board.items.map((task) =>
        runningTaskRefs.has(task.ref) ? { ...task, running: true } : task,
      ),
    }
  }

  async function recoverExecutionStateForGoal(
    projectKey: string,
    goalKey: string,
    context: GoalApiContext,
  ) {
    await context.workers.heartbeat(workerId)
    return recoverGoalExecutionState({
      projectKey,
      goalKey,
      board: context.store,
      execution: context.execution,
      workers: context.workers,
      history: context.history,
    })
  }

  function buildExecuteStep(
    projectKey: string,
    goalKey: string,
    context: GoalApiContext,
    options?: {
      maxParallel?: number
      laneParallelism?: {
        in_progress?: number
        in_review?: number
        merging?: number
      }
    },
  ) {
    return async () => {
      await recoverExecutionStateForGoal(projectKey, goalKey, context)
      const reconcileResult = await reconcileOnce({
        goalKey,
        store: context.store,
        planningRequests: context.planningRequests,
        attempts: context.attempts,
        history: context.history,
        execution: context.execution,
        workerId,
        maxParallel: options?.maxParallel ?? 3,
        laneParallelism: options?.laneParallelism,
        runner: context.runner,
        writer: 'automation',
      })
      await context.actionRequired.reconcileGoal(goalKey)
      broadcastGoalEvent('board_changed', goalKey, projectKey)
      return reconcileResult
    }
  }

  async function maybeResumeAutomation(
    projectKey: string,
    goalKey: string,
    context: GoalApiContext,
  ) {
    await recoverExecutionStateForGoal(projectKey, goalKey, context)
    await automationForContext(context).resumeIfEnabled({
      projectKey,
      goalKey,
      executeStep: buildExecuteStep(projectKey, goalKey, context),
    })
  }

  async function resolveProjectContext(projectKey?: string): Promise<ResolvedProjectContext> {
    if (!projectKey) {
      return {
        projectKey: DEFAULT_PROJECT_KEY,
        context: defaultContext,
      }
    }

    const project = await projectStore.readProject(projectKey)
    await ensureDefaultAgentAdapterConfig(project.rootDir)
    projectKeyByRootDir.set(project.rootDir, projectKey)
    const cached = contextCache.get(project.rootDir)
    if (cached) {
      return {
        projectKey,
        project,
        context: cached,
      }
    }

    const context = createGoalApiContext(project.rootDir, runner, {
      assistantThreadObserver: {
        onEntry(goalKey, entry) {
          broadcastAssistantFeedItem(projectKey, goalKey, entry)
        },
      },
      runHistoryObserver: {
        onEntry(entry) {
          broadcastRunFeedItem(projectKey, entry)
        },
      },
      executionObserver: {
        async onGoalExecutionChanged(goalKey) {
          broadcastGoalEvent('board_changed', goalKey, projectKey)
        },
        async onAutomationChanged(goalKey, status) {
          broadcast({
            type: 'automation_changed',
            projectKey: status.projectKey === DEFAULT_PROJECT_KEY ? undefined : status.projectKey,
            goalKey,
            status,
          })
        },
      },
    })
    contextCache.set(project.rootDir, context)
    return {
      projectKey,
      project,
      context,
    }
  }

  async function presentProject(project: ProjectRecord) {
    await ensureDefaultAgentAdapterConfig(project.rootDir)
    const config = await readAndMigrateAgentAdapterConfig(
      createProjectPaths(project.rootDir).adapterConfigPath(),
    )
    return {
      ...project,
      codingDefaults: config.defaults,
    }
  }

  return {
    assistantFeedClients,
    clients,
    defaultContext,
    runFeedClients,
    assistantFeedScope,
    automationForContext,
    boardResponse,
    broadcast,
    broadcastAssistantRuntimeEvent,
    broadcastGoalEvent,
    buildExecuteStep,
    clearLiveAssistantDelta,
    maybeResumeAutomation,
    presentProject,
    recoverExecutionStateForGoal,
    resolveProjectContext,
    runFeedScope,
    sendAssistantFeedCatchUp,
    sendRunFeedCatchUp,
  }
}
