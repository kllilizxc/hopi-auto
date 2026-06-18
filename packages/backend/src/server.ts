import { join } from 'node:path'
import { z } from 'zod'
import type { AgentRunner, AgentRuntimeEvent } from './agent/AgentRunner'
import { readAndMigrateAgentAdapterConfig } from './agent/adapterConfig'
import { ensureDefaultAgentAdapterConfig } from './agent/defaultAdapterConfig'
import { projectCodingDefaultsInputSchema } from './agent/projectCodingDefaults'
import {
  assistantRunMergeKey,
  GoalAssistantAttachmentTransportError,
  GoalAssistantNotConfiguredError,
} from './assistant/GoalAssistantRuntime'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES, type TodoBoard } from './domain/board'
import {
  AnswerInterpretationError,
  INTERPRETABLE_SOURCE_RESPONSE_FORMATS,
  listInterpretableFollowThroughAnswerCandidateGroups,
  materializeInterpretedDecisionBundle,
  materializeInterpretedPlanningInput,
  materializeInterpretedPlanningWorkflowBatchInput,
} from './runtime/answerInterpretation'
import { AutomationController } from './runtime/automationController'
import { createGoalApiContext } from './runtime/goalApiContext'
import {
  assistantThreadToFeedItems,
  assistantThreadEntryToFeedItem,
  buildAssistantDeltaFeedItem,
  listItemsAfterCursor,
  paginateMessageFeedItems,
  runMessageToFeedItem,
  runToFeedItems,
  runTranscriptToFeedItem,
  type MessageFeedItem,
} from './runtime/messageFeed'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
  resolveGoalDecision,
} from './runtime/decisionRequest'
import { GoalScaffoldError, createGoalScaffold, listProjectGoals } from './runtime/goalScaffold'
import {
  listGoalPlanningWorkflows,
  readGoalPlanningWorkflow,
  requestGoalPlanning,
  requestGoalPlanningWorkflows,
} from './runtime/planningRequest'
import { recoverGoalExecutionState } from './runtime/executionRecovery'
import { reconcileOnce } from './scheduler/reconcileOnce'
import type { AssistantThreadEntry } from './runtime/assistantThreadStore'
import type { RunHistoryObservedEntry } from './runtime/runHistoryStore'
import {
  goalPlanningRequestBlockedByWorkflowKeysSchema,
  goalPlanningRequestUpdateTargetArraySchema,
} from './storage/planningRequestStore'
import { createProjectPaths } from './storage/paths'
import { ProjectStoreError, createProjectStore } from './storage/projectStore'
import {
  GoalAttachmentStoreError,
  goalAttachmentRefArraySchema,
} from './storage/goalAttachmentStore'
import {
  PREFERENCE_KEY_PATTERN,
  PreferenceStoreError,
} from './storage/preferenceStore'
import indexPage from './ui/index.html'

export interface ServerOptions {
  rootDir?: string
  port?: number
  runner?: AgentRunner
}

type EventClient = ReadableStreamDefaultController<Uint8Array>

const jsonHeaders = { 'content-type': 'application/json' }
const encoder = new TextEncoder()
const matchHintArraySchema = z.array(z.string().min(1)).default([])
const sourceOccurrenceSchema = z.number().int().positive()
const interpretableSourceResponseFormatSchema = z.enum(INTERPRETABLE_SOURCE_RESPONSE_FORMATS)
const interpretablePlanningAnswerArraySchema = z
  .array(
    z.object({
      summary: z.string().min(1),
      answerKey: z.string().min(1).optional(),
      summaryKey: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      matchHints: matchHintArraySchema,
      answer: z.string().min(1).optional(),
      sourceExcerpt: z.string().min(1).optional(),
      sourceOccurrence: sourceOccurrenceSchema.optional(),
      answerSourceKey: z.string().min(1).optional(),
      answerSourceGroupKey: z.string().min(1).optional(),
    }),
  )
  .default([])

const interpretableAnswerSourceMetadataSchema = {
  answerSourceKey: z.string().min(1),
  sourceGroupKey: z.string().min(1).optional(),
  route: z.enum(['decision', 'planning']).optional(),
  decisionKey: z.string().min(1).optional(),
  answerKey: z.string().min(1).optional(),
  summaryKey: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
}

const interpretableAnswerSourceArraySchema = z
  .array(
    z.union([
      z.object({
        ...interpretableAnswerSourceMetadataSchema,
        answer: z.string().min(1),
      }),
      z.object({
        ...interpretableAnswerSourceMetadataSchema,
        sourceExcerpt: z.string().min(1),
        sourceOccurrence: sourceOccurrenceSchema.optional(),
      }),
    ]),
  )
  .default([])

const blockerSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

const createTaskSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  blockedBy: z.array(blockerSchema).default([]),
})

const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().min(1).default('manual transition'),
})

const createDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
})

const createPlanningRequestSchema = z.object({
  requestKey: z.string().min(1).optional(),
  groupKey: z.string().min(1).optional(),
  groupTaskKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  blockedBy: z.array(blockerSchema).default([]),
})

const planningBatchEntrySchema = z.object({
  taskKey: z.string().min(1),
  requestKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  blockedBy: z.array(blockerSchema).default([]),
  blockedByTaskKeys: z.array(z.string().min(1)).default([]),
})

const planningWorkflowLeafSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    requestKey: z.string().min(1).optional(),
    workflowTaskKey: z.string().min(1).optional(),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    groupKey: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
    blockedBy: z.array(blockerSchema).default([]),
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    decisionRefs: z.array(z.string().min(1)).default([]),
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(planningBatchEntrySchema).default([]),
  }),
])

const createPlanningWorkflowBatchSchema = z.object({
  workflowKey: z.string().min(1).optional(),
  reuseTaskRef: z.string().min(1).optional(),
  reuseGroupKey: z.string().min(1).optional(),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferRemainingAnswers: z.boolean().optional(),
  answers: interpretablePlanningAnswerArraySchema,
  workflows: z.array(planningWorkflowLeafSchema).min(1),
})

const resolveDecisionLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    inferRemainingAnswers: z.boolean().optional(),
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    inferRemainingAnswers: z.boolean().optional(),
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(planningBatchEntrySchema).min(1),
  }),
])

const resolveDecisionWorkflowLeafFollowThroughSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('planning'),
    workflowTaskKey: z.string().min(1).optional(),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    title: z.string().min(1),
    description: z.string(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    answers: interpretablePlanningAnswerArraySchema,
    requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  }),
  z.object({
    kind: z.literal('planning_batch'),
    groupKey: z.string().min(1),
    blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
    answers: interpretablePlanningAnswerArraySchema,
    requests: z.array(planningBatchEntrySchema).default([]),
  }),
])

const resolveDecisionFollowThroughSchema = z.discriminatedUnion('kind', [
  ...resolveDecisionLeafFollowThroughSchema.options,
  z.object({
    kind: z.literal('workflow_batch'),
    workflowKey: z.string().min(1).optional(),
    reuseTaskRef: z.string().min(1).optional(),
    reuseGroupKey: z.string().min(1).optional(),
    inferRemainingAnswers: z.boolean().optional(),
    answers: interpretablePlanningAnswerArraySchema,
    workflows: z.array(resolveDecisionWorkflowLeafFollowThroughSchema).min(1),
  }),
])

const resolveDecisionSchema = z.object({
  summary: z.string().min(1).optional(),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const answerDecisionSchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const answerDecisionBatchEntrySchema = z.object({
  decisionKey: z.string().min(1).optional(),
  summary: z.string().min(1),
  summaryKey: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  matchHints: matchHintArraySchema,
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1).optional(),
  sourceOccurrence: sourceOccurrenceSchema.optional(),
  answerSourceKey: z.string().min(1).optional(),
  answerSourceGroupKey: z.string().min(1).optional(),
})

const answerDecisionBatchSchema = z.object({
  answerSources: interpretableAnswerSourceArraySchema,
  sourceResponseFormat: interpretableSourceResponseFormatSchema.optional(),
  sourceResponse: z.string().min(1).optional(),
  inferOpenDecisions: z.boolean().default(false),
  inferDecisionTopics: z.boolean().default(false),
  answers: z.array(answerDecisionBatchEntrySchema).default([]),
  followThrough: resolveDecisionFollowThroughSchema.optional(),
})

const assistantMessageSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
})

const assistantRunSchema = z.object({
  content: z.string().min(1),
  attachments: goalAttachmentRefArraySchema,
  appendUserMessage: z.boolean().default(true),
})

const updatePreferenceSchema = z.object({
  content: z.string().min(1),
})

const recordPreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  supersedes: z.array(z.string().regex(PREFERENCE_KEY_PATTERN)).default([]),
})

const retirePreferenceSchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  reason: z.string().min(1),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

const createProjectSchema = z.object({
  projectKey: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  rootDir: z.string().min(1),
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

const updateProjectSettingsSchema = z.object({
  codingDefaults: projectCodingDefaultsInputSchema.optional(),
})

const createProjectGoalSchema = z.object({
  goalKey: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).default([]),
})

const laneParallelismSchema = z
  .object({
    in_progress: z.number().int().positive().max(10).optional(),
    in_review: z.number().int().positive().max(10).optional(),
    merging: z.number().int().positive().max(10).optional(),
  })
  .partial()
  .optional()

const automationStartSchema = z.object({
  maxSteps: z.number().int().positive().max(100).optional(),
  maxParallel: z.number().int().positive().max(10).optional(),
  laneParallelism: laneParallelismSchema,
})

type BoardResponse = Omit<TodoBoard, 'items'> & {
  items: Array<TodoBoard['items'][number] & { running?: boolean }>
}

export function createServer(options: ServerOptions = {}): Bun.Server<undefined> {
  const rootDir = options.rootDir ?? process.cwd()
  const workerId = crypto.randomUUID()
  const projectStore = createProjectStore(rootDir)
  const contextCache = new Map<string, ReturnType<typeof createGoalApiContext>>()
  const automationByRootDir = new Map<string, AutomationController>()
  const projectKeyByRootDir = new Map<string, string>()
  const clients = new Set<EventClient>()
  const assistantFeedClients = new Map<string, Set<EventClient>>()
  const runFeedClients = new Map<string, Set<EventClient>>()
  const liveAssistantDeltas = new Map<string, Map<string, MessageFeedItem>>()

  const defaultContext = createGoalApiContext(rootDir, options.runner, {
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

  function emitToFeedClients(feedClients: Map<string, Set<EventClient>>, scope: string, payload: unknown) {
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
    entry: AssistantThreadEntry,
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

  async function sendAssistantFeedCatchUp(
    controller: EventClient,
    context: ReturnType<typeof createGoalApiContext>,
    projectKey: string | undefined,
    goalKey: string,
    after?: string,
  ) {
    const thread = await context.assistantThread.readThread(goalKey)
    const persistedItems = listItemsAfterCursor(assistantThreadToFeedItems(thread), after)
    for (const item of persistedItems) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'item', item })}\n\n`))
    }

    const liveItems = [...(liveAssistantDeltas.get(assistantFeedScope(projectKey, goalKey))?.values() ?? [])]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    for (const item of liveItems) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'item', item })}\n\n`))
    }
  }

  async function sendRunFeedCatchUp(
    controller: EventClient,
    context: ReturnType<typeof createGoalApiContext>,
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

  function automationForContext(context: ReturnType<typeof createGoalApiContext>) {
    const current = automationByRootDir.get(context.rootDir)
    if (current) {
      return current
    }
    const created = new AutomationController(context.execution)
    automationByRootDir.set(context.rootDir, created)
    return created
  }

  async function heartbeatKnownWorkers() {
    const contexts = new Map<string, ReturnType<typeof createGoalApiContext>>()
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

  async function boardResponse(
    board: TodoBoard,
    context: ReturnType<typeof createGoalApiContext>,
  ): Promise<BoardResponse> {
    const runningTaskRefs = new Set(
      (await context.execution.listActiveTaskExecutions(board.goal.goalKey)).map((task) => task.taskRef),
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
    context: ReturnType<typeof createGoalApiContext>,
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
    context: ReturnType<typeof createGoalApiContext>,
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
    context: ReturnType<typeof createGoalApiContext>,
  ) {
    await recoverExecutionStateForGoal(projectKey, goalKey, context)
    await automationForContext(context).resumeIfEnabled({
      projectKey,
      goalKey,
      executeStep: buildExecuteStep(projectKey, goalKey, context),
    })
  }

  async function resolveProjectContext(projectKey?: string) {
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

    const context = createGoalApiContext(project.rootDir, options.runner, {
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

  async function presentProject(project: Awaited<ReturnType<typeof projectStore.readProject>>) {
    await ensureDefaultAgentAdapterConfig(project.rootDir)
    const config = await readAndMigrateAgentAdapterConfig(
      createProjectPaths(project.rootDir).adapterConfigPath(),
    )
    return {
      ...project,
      codingDefaults: config.defaults,
    }
  }

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
      let routeContext:
        | Awaited<ReturnType<typeof resolveProjectContext>>
        | undefined

      try {
        if (goalRoute) {
          routeContext = await resolveProjectContext(goalRoute.projectKey)
        }

        if (request.method === 'GET' && url.pathname === '/api/events') {
          server.timeout(request, 0)
          return eventsResponse(clients)
        }

        if (request.method === 'GET' && isProjectsRoute(parts)) {
          return jsonResponse({
            projects: await Promise.all(
              (await projectStore.listProjects()).map((project) => presentProject(project)),
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
          return jsonResponse(await presentProject(project), 201)
        }

        if (request.method === 'PATCH' && isProjectSettingsRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const body = await parseJsonBody(request, updateProjectSettingsSchema)
          const project = await projectStore.readProject(projectKey)
          await ensureDefaultAgentAdapterConfig(project.rootDir, body.codingDefaults)
          return jsonResponse(await presentProject(project))
        }

        if (request.method === 'GET' && isProjectGoalsCollectionRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const projectContext = await resolveProjectContext(projectKey)
          return jsonResponse({
            projectKey,
            goals: await listProjectGoals(projectContext.context.rootDir),
          })
        }

        if (request.method === 'POST' && isProjectGoalsCollectionRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const projectContext = await resolveProjectContext(projectKey)
          const body = await parseJsonBody(request, createProjectGoalSchema)
          const goal = await createGoalScaffold(projectContext.context.rootDir, body)
          await projectStore.recordLastOpenedGoal(projectKey, goal.goalKey)
          return jsonResponse(goal, 201)
        }

        if (request.method === 'GET' && url.pathname === '/api/preferences') {
          return jsonResponse(await defaultContext.preferences.readPreferences())
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences') {
          const body = await parseJsonBody(request, updatePreferenceSchema)
          const document = await defaultContext.preferences.writePreferences(body.content)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/record') {
          const body = await parseJsonBody(request, recordPreferenceSchema)
          const document = await defaultContext.preferences.recordPreference(body)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'POST' && url.pathname === '/api/preferences/retire') {
          const body = await parseJsonBody(request, retirePreferenceSchema)
          const document = await defaultContext.preferences.retirePreference(body)
          broadcast({ type: 'preferences_changed' })
          return jsonResponse(document)
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'board')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentContext = requireRouteContext(routeContext).context
          const currentProjectKey = routeContext?.projectKey ?? DEFAULT_PROJECT_KEY
          await maybeResumeAutomation(currentProjectKey, currentGoalKey, currentContext)
          return jsonResponse(
            await boardResponse(await currentContext.store.readBoard(currentGoalKey), currentContext),
          )
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'docs')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentContext = requireRouteContext(routeContext).context
          const board = await currentContext.store.readBoard(currentGoalKey)
          return jsonResponse(await currentContext.goalDocs.readGoalDocs(currentGoalKey, board.goal.title))
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
          const run = await requireRouteContext(routeContext).context.history.readRun(currentGoalKey, runId)
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
          const run = await requireRouteContext(routeContext).context.history.readRun(currentGoalKey, runId)
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
            runFeedClients,
            runFeedScope(currentProjectKey, currentGoalKey, runId, stepId),
            async (controller) => {
              await sendRunFeedCatchUp(
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
            entries: await requireRouteContext(routeContext).context.writeTraces.listEntries(currentGoalKey, {
              taskRef: stringQuery(url, 'taskRef'),
              runId: stringQuery(url, 'runId'),
              stepId: stringQuery(url, 'stepId'),
              role: roleQuery(url),
              limit: numberQuery(url, 'limit'),
            }),
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
            await requireRouteContext(routeContext).context.planningRequests.readGoalPlanningRequests(
              currentGoalKey,
            ),
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
          broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.blockerAdded) {
            broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
          broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
          broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
          broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          if (result.followThrough) {
            broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          }
          if (result.blockerRemoved || result.followThrough) {
            broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
          broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
          broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          if (result.taskCreated) {
            broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
            assistantFeedClients,
            assistantFeedScope(currentProjectKey, currentGoalKey),
            async (controller) => {
              await sendAssistantFeedCatchUp(
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
            await requireRouteContext(routeContext).context.assistantThread.readThread(
              currentGoalKey,
            ),
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
            runs: await requireRouteContext(routeContext).context.assistantRuns.listRuns(
              currentGoalKey,
            ),
          })
        }

        if (request.method === 'GET' && isGoalLeafRoute(goalRoute, 'assistant', 3)) {
          if (
            requireGoalExtra(goalRoute, 0) !== 'runs' ||
            requireGoalExtra(goalRoute, 2) !== 'bundle'
          ) {
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

        if (
          request.method === 'GET' &&
          goalRoute?.leaf === 'assets' &&
          goalRoute.extra.length >= 1
        ) {
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
              attachments: await requireRouteContext(routeContext).context.attachments.persistAssistantImages(
                currentGoalKey,
                body.images,
              ),
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
                broadcastAssistantRuntimeEvent(
                  currentProjectKey,
                  currentGoalKey,
                  assistantRunId,
                  event,
                )
              },
            })
            .catch((error) => {
              if (activeAssistantRunId) {
                clearLiveAssistantDelta(currentProjectKey, currentGoalKey, activeAssistantRunId)
              }
              throw error
            })
          await currentContext.actionRequired.reconcileGoal(currentGoalKey)
          broadcastGoalEvent('assistant_changed', currentGoalKey, currentProjectKey)
          if (
            result.actionResults.some(
              (actionResult) =>
                actionResult.kind === 'request_decision' ||
                actionResult.kind === 'resolve_decision' ||
                actionResult.kind === 'record_answer' ||
                actionResult.kind === 'record_answers',
            )
          ) {
            broadcastGoalEvent('decisions_changed', currentGoalKey, currentProjectKey)
          }
          broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
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
            broadcastGoalEvent('planning_requests_changed', currentGoalKey, currentProjectKey)
          }
          if (
            result.actionResults.some(
              (actionResult) =>
                actionResult.kind === 'record_preference' ||
                actionResult.kind === 'update_preference',
            )
          ) {
            broadcast({ type: 'preferences_changed' })
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
          broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          return jsonResponse(
            await boardResponse(await currentContext.store.readBoard(currentGoalKey), currentContext),
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
          broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          return jsonResponse(
            await boardResponse(await currentContext.store.readBoard(currentGoalKey), currentContext),
          )
        }

        if (request.method === 'GET' && isGoalAutomationRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const currentGoalKey = requirePathPart(parts, 4)
          const projectContext = await resolveProjectContext(projectKey)
          await maybeResumeAutomation(projectKey, currentGoalKey, projectContext.context)
          return jsonResponse({
            status: await automationForContext(projectContext.context).getStatus(projectKey, currentGoalKey),
          })
        }

        if (request.method === 'POST' && isGoalStartRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const currentGoalKey = requirePathPart(parts, 4)
          const body = await parseJsonBody(request, automationStartSchema)
          await projectStore.recordLastOpenedGoal(projectKey, currentGoalKey)
          const currentContext = (await resolveProjectContext(projectKey)).context
          await recoverExecutionStateForGoal(projectKey, currentGoalKey, currentContext)
          const result = await automationForContext(currentContext).start({
            projectKey,
            goalKey: currentGoalKey,
            maxSteps: body.maxSteps,
            maxParallel: body.maxParallel,
            laneParallelism: body.laneParallelism,
            executeStep: buildExecuteStep(projectKey, currentGoalKey, currentContext, {
              maxParallel: body.maxParallel ?? 3,
              laneParallelism: body.laneParallelism,
            }),
          })
          return jsonResponse(result)
        }

        if (request.method === 'POST' && isGoalStopRoute(parts)) {
          const projectKey = requirePathPart(parts, 2)
          const currentGoalKey = requirePathPart(parts, 4)
          const currentContext = (await resolveProjectContext(projectKey)).context
          return jsonResponse({
            status: await automationForContext(currentContext).stop(projectKey, currentGoalKey),
          })
        }

        if (request.method === 'POST' && isGoalLeafRoute(goalRoute, 'reconcile')) {
          const currentGoalKey = requireGoalRoute(goalRoute).goalKey
          const currentProjectKey = routeContext?.projectKey ?? DEFAULT_PROJECT_KEY
          const currentContext = requireRouteContext(routeContext).context
          await recoverExecutionStateForGoal(currentProjectKey, currentGoalKey, currentContext)
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
          broadcastGoalEvent('board_changed', currentGoalKey, currentProjectKey)
          return jsonResponse(result)
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

const DEFAULT_PROJECT_KEY = '__default__'

interface GoalRouteMatch {
  projectKey?: string
  goalKey: string
  leaf: string
  extra: string[]
}

function isProjectsRoute(parts: string[]) {
  return parts[0] === 'api' && parts[1] === 'projects' && parts.length === 2
}

function isProjectGoalsCollectionRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    parts.length === 4
  )
}

function isProjectSettingsRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'settings' &&
    parts.length === 4
  )
}

function isGoalStartRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'start' &&
    parts.length === 6
  )
}

function isGoalStopRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'stop' &&
    parts.length === 6
  )
}

function isGoalAutomationRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'automation' &&
    parts.length === 6
  )
}

function matchGoalRoute(parts: string[]): GoalRouteMatch | undefined {
  if (parts[0] === 'api' && parts[1] === 'goals' && Boolean(parts[2]) && Boolean(parts[3])) {
    return {
      goalKey: parts[2]!,
      leaf: parts[3]!,
      extra: parts.slice(4),
    }
  }

  if (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    Boolean(parts[5])
  ) {
    return {
      projectKey: parts[2]!,
      goalKey: parts[4]!,
      leaf: parts[5]!,
      extra: parts.slice(6),
    }
  }

  return undefined
}

function isGoalLeafRoute(route: GoalRouteMatch | undefined, leaf: string, extraLength = 0) {
  return Boolean(route && route.leaf === leaf && route.extra.length === extraLength)
}

function requireGoalRoute(route: GoalRouteMatch | undefined) {
  if (!route) {
    throw new HttpError(404, 'Not found')
  }
  return route
}

function requireGoalExtra(route: GoalRouteMatch | undefined, index: number) {
  return requirePathPart(requireGoalRoute(route).extra, index)
}

function requireRouteContext<T>(context: T | undefined) {
  if (!context) {
    throw new HttpError(404, 'Not found')
  }
  return context
}

function requirePathPart(parts: string[], index: number) {
  const value = parts[index]
  if (!value) {
    throw new HttpError(404, 'Not found')
  }
  return value
}

async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }
  return parsed.data
}

async function parseAssistantAttachmentUploadBody(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }
  return {
    images: parseAssistantImageEntries(formData),
  }
}

async function parseAssistantRunBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    const body = await parseJsonBody(request, assistantRunSchema)
    return {
      content: body.content,
      attachments: body.attachments,
      appendUserMessage: body.appendUserMessage,
      images: [] as File[],
    }
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const content = formData.get('content')
  if (typeof content !== 'string') {
    throw new HttpError(400, 'Invalid request body')
  }

  const appendUserMessageValue = formData.get('appendUserMessage')
  const parsed = assistantRunSchema.safeParse({
    content,
    appendUserMessage:
      appendUserMessageValue === null
        ? true
        : appendUserMessageValue === 'true'
          ? true
          : appendUserMessageValue === 'false'
            ? false
            : appendUserMessageValue,
  })
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }

  return {
    content: parsed.data.content,
    attachments: [] as z.infer<typeof goalAttachmentRefArraySchema>,
    appendUserMessage: parsed.data.appendUserMessage,
    images: parseAssistantImageEntries(formData),
  }
}

function parseAssistantImageEntries(formData: FormData) {
  const images = formData
    .getAll('images[]')
    .concat(formData.getAll('images'))
    .filter((entry): entry is File => entry instanceof File)

  const unexpectedImageValue = formData
    .getAll('images[]')
    .concat(formData.getAll('images'))
    .find((entry) => !(entry instanceof File))
  if (unexpectedImageValue !== undefined) {
    throw new HttpError(400, 'Invalid request body')
  }
  return images
}

function stringQuery(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim()
  return value ? value : undefined
}

function numberQuery(url: URL, key: string) {
  const value = stringQuery(url, key)
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid query parameter: ${key}`)
  }
  return parsed
}

function roleQuery(url: URL) {
  const value = stringQuery(url, 'role')
  if (!value) {
    return undefined
  }

  const parsed = z.enum(['planner', 'generator', 'reviewer', 'merger']).safeParse(value)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid query parameter: role')
  }
  return parsed.data
}

function assistantRuntimeEventToFeedItem(
  assistantRunId: string,
  event: AgentRuntimeEvent,
): MessageFeedItem | null {
  const createdAt = new Date().toISOString()

  if (event.kind === 'message') {
    return {
      id: `assistant-runtime:${assistantRunId}:${crypto.randomUUID()}`,
      createdAt,
      kind: 'system_message',
      role: 'system',
      text: event.content,
      collapsedByDefault: true,
      label: `Assistant ${event.level ?? 'info'}`,
      details: [event.role ?? 'assistant'],
    }
  }

  if (event.kind !== 'transcript') {
    return null
  }

  if (event.entryKind === 'assistant') {
    return null
  }

  if (
    event.entryKind === 'status' &&
    (event.summary === 'thread started' ||
      event.summary === 'turn started' ||
      event.summary === 'thread completed' ||
      event.summary === 'turn completed')
  ) {
    return null
  }

  return {
    id: `assistant-runtime:${assistantRunId}:${crypto.randomUUID()}`,
    createdAt,
    kind:
      event.entryKind === 'tool_call'
        ? 'tool_call'
        : event.entryKind === 'tool_result'
          ? 'tool_result'
          : 'status',
    role: 'system',
    text: event.summary,
    collapsedByDefault: true,
    label:
      event.entryKind === 'tool_call'
        ? 'Tool call'
        : event.entryKind === 'tool_result'
          ? 'Tool result'
          : event.entryKind === 'error'
            ? 'Error'
            : 'Status',
    details: [
      ...(event.transport ? [event.transport] : []),
      ...(event.toolName ? [`tool=${event.toolName}`] : []),
      ...(event.vendorEventType ? [`vendor=${event.vendorEventType}`] : []),
    ],
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.transport ? { transport: event.transport } : {}),
    ...(event.vendorEventType ? { vendorEventType: event.vendorEventType } : {}),
  }
}

function eventsResponse(clients: Set<EventClient>) {
  let client: EventClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller
      clients.add(controller)
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
    },
    cancel() {
      if (client) {
        clients.delete(client)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

function feedEventsResponse(
  feedClients: Map<string, Set<EventClient>>,
  scope: string,
  onStart?: (controller: EventClient) => Promise<void> | void,
) {
  let client: EventClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      client = controller
      const scopeClients = feedClients.get(scope) ?? new Set<EventClient>()
      scopeClients.add(controller)
      feedClients.set(scope, scopeClients)
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
      await onStart?.(controller)
    },
    cancel() {
      if (!client) {
        return
      }

      const scopeClients = feedClients.get(scope)
      scopeClients?.delete(client)
      if (scopeClients && scopeClients.size === 0) {
        feedClients.delete(scope)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

async function readBundleFile(path: string) {
  const file = Bun.file(path)
  return {
    path,
    content: (await file.exists()) ? await file.text() : null,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

if (import.meta.main) {
  const envPort = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : undefined
  const server = createServer({
    rootDir: join(import.meta.dir, '..', '..', '..'),
    port: Number.isFinite(envPort) ? envPort : undefined,
  })
  console.log(`[API] Server listening on http://localhost:${server.port}`)
}
