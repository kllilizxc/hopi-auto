import type { AgentOutcome, AgentRole, AgentRunner, AgentRuntimeEvent } from '../agent/AgentRunner'
import type { BlockerRef, FailureKind, TaskItem, TaskStatus } from '../domain/board'
import type { AttemptStore } from '../runtime/attemptStore'
import { type GitMergeExecutor, createGitMergeExecutor } from '../runtime/gitMergeExecutor'
import { inspectPlanningFollowThroughEvidence } from '../runtime/planningFollowThroughEvidence'
import {
  resolvePlanningRequestsForTask,
  syncGroupedPlanningEngineeringBlockers,
} from '../runtime/planningRequest'
import type { RunStatus, StepOutcome } from '../runtime/runHistory'
import type { RunHistoryStore } from '../runtime/runHistoryStore'
import { type WriteTraceStore, createWriteTraceStore } from '../runtime/writeTraceStore'
import type { BoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import {
  type PlanningRequestStore,
  createPlanningRequestStore,
} from '../storage/planningRequestStore'

export interface ReconcileOptions {
  goalKey: string
  store: BoardStore
  decisions?: DecisionStore
  planningRequests?: PlanningRequestStore
  writeTraces?: WriteTraceStore
  attempts: AttemptStore
  history?: RunHistoryStore
  runner: AgentRunner
  mergeExecutor?: GitMergeExecutor
  writer?: string
  maxAttempts?: number
}

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }

interface DispatchStep {
  role: AgentRole
  successTo: TaskStatus
  rejectTo?: TaskStatus
  mergeConflictTo?: TaskStatus
}

interface OutcomeResolution {
  to: TaskStatus
  failureKind?: FailureKind
  blocker?: BlockerRef
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_WRITER = 'scheduler'

export async function reconcileOnce(options: ReconcileOptions): Promise<ReconcileResult> {
  const writer = options.writer ?? DEFAULT_WRITER
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const mergeExecutor = options.mergeExecutor ?? createGitMergeExecutor(options.store.paths.rootDir)
  const decisions = options.decisions ?? createDecisionStore(options.store.paths.rootDir)
  const planningRequests =
    options.planningRequests ?? createPlanningRequestStore(options.store.paths.rootDir)
  const writeTraces = options.writeTraces ?? createWriteTraceStore(options.store.paths.rootDir)

  if (
    await cleanupResolvedBlockers(
      options.store,
      decisions,
      planningRequests,
      options.goalKey,
      writer,
    )
  ) {
    return { kind: 'idle' }
  }

  const board = await options.store.readBoard(options.goalKey)
  const task = board.items.find(isDispatchableTask)
  if (!task) {
    return { kind: 'idle' }
  }

  const step = stepForTask(task)
  if (!step) {
    return { kind: 'idle' }
  }

  const from = task.status
  await setTaskStatus(options.store, options.goalKey, writer, task.ref, 'in_progress')

  let runRef: {
    runId: string
    stepId: string
  } = {
    runId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
  }
  if (options.history) {
    try {
      runRef = await options.history.startStep({
        goalKey: options.goalKey,
        taskRef: task.ref,
        taskKind: task.kind,
        role: step.role,
        statusBefore: from,
        message: statusMessage(`${step.role} dispatched for ${task.ref}`),
      })
    } catch (error) {
      await setTaskStatus(options.store, options.goalKey, writer, task.ref, from)
      throw error
    }
  }

  let outcome: AgentOutcome
  try {
    outcome = await options.runner.run(
      {
        goalKey: options.goalKey,
        runId: runRef.runId,
        stepId: runRef.stepId,
        taskRef: task.ref,
        taskKind: task.kind,
        role: step.role,
      },
      {
        onEvent: async (event) => {
          await options.history?.recordStepEvent({
            goalKey: options.goalKey,
            runId: runRef.runId,
            stepId: runRef.stepId,
            event: historyEventForRuntimeEvent(event),
          })
        },
      },
    )

    if (step.role === 'merger' && outcome.kind === 'success') {
      outcome = await mergeExecutor.completeMerge({
        goalKey: options.goalKey,
        taskRef: task.ref,
        taskKind: task.kind,
        runId: runRef.runId,
      })
    }
  } catch (error) {
    await setTaskStatus(options.store, options.goalKey, writer, task.ref, from)
    await finishHistoryStep(options.history, runRef, {
      goalKey: options.goalKey,
      statusAfter: from,
      outcome: 'system_error',
      runStatus: 'system_error',
      message: statusMessage(errorMessage(error)),
    })
    throw error
  }

  const resolution = await resolveOutcome(task, from, step, outcome, options.attempts, maxAttempts)
  const validated = await validatePlanningFollowThroughIfNeeded({
    goalKey: options.goalKey,
    task,
    step,
    outcome,
    resolution,
    attempts: options.attempts,
    maxAttempts,
    planningRequests,
    writeTraces,
  })
  try {
    await finalizeTask(options.store, options.goalKey, writer, task.ref, validated.resolution)
  } catch (error) {
    await setTaskStatus(options.store, options.goalKey, writer, task.ref, from)
    await finishHistoryStep(options.history, runRef, {
      goalKey: options.goalKey,
      statusAfter: from,
      outcome: 'system_error',
      runStatus: 'system_error',
      message: statusMessage(errorMessage(error)),
    })
    throw error
  }

  if (task.kind === 'planning' && validated.resolution.to === 'done') {
    await resolvePlanningRequestsForTask(
      {
        boardStore: options.store,
        planningRequests,
      },
      {
        goalKey: options.goalKey,
        taskRef: task.ref,
        resolution: `Planning task ${task.ref} completed.`,
        writer,
      },
    )
    await syncGroupedPlanningEngineeringBlockers(
      {
        boardStore: options.store,
        planningRequests,
      },
      {
        goalKey: options.goalKey,
        writer,
        reason: `sync grouped planning blockers after ${task.ref}`,
      },
    )
  }

  await finishHistoryStep(options.history, runRef, {
    goalKey: options.goalKey,
    statusAfter: validated.resolution.to,
    outcome: stepOutcomeForAgentOutcome(validated.outcome),
    runStatus: runStatusForResolution(validated.resolution),
    message: statusMessage(messageForOutcome(task.ref, validated.outcome, validated.resolution.to)),
  })

  if (validated.resolution.blocker) {
    return { kind: 'blocked', taskRef: task.ref, blocker: validated.resolution.blocker }
  }

  return { kind: 'advanced', taskRef: task.ref, from, to: validated.resolution.to }
}

async function cleanupResolvedBlockers(
  store: BoardStore,
  decisions: DecisionStore,
  planningRequests: PlanningRequestStore | undefined,
  goalKey: string,
  writer: string,
): Promise<boolean> {
  const groupedBlockerSyncChanged = planningRequests
    ? await syncGroupedPlanningEngineeringBlockers(
        {
          boardStore: store,
          planningRequests,
        },
        {
          goalKey,
          writer,
          reason: 'sync grouped planning blockers during cleanup',
        },
      )
    : false
  const board = await store.readBoard(goalKey)
  const doneRefs = new Set(
    board.items.filter((task) => task.status === 'done').map((task) => task.ref),
  )
  const resolvedDecisionRefs = new Set(
    (await decisions.readGoalDecisions(goalKey)).decisions
      .filter((decision) => decision.status === 'resolved')
      .map((decision) => decision.decisionKey),
  )
  const removed: Array<{ taskRef: string; blocker: BlockerRef }> = []

  for (const task of board.items) {
    for (const blocker of task.blockedBy) {
      if (blocker.kind === 'task' && doneRefs.has(blocker.ref)) {
        removed.push({ taskRef: task.ref, blocker })
        continue
      }
      if (blocker.kind === 'decision' && resolvedDecisionRefs.has(blocker.ref)) {
        removed.push({ taskRef: task.ref, blocker })
      }
    }
  }

  if (removed.length === 0) {
    if (groupedBlockerSyncChanged) {
      return true
    }
    return false
  }

  await store.mutateBoard(goalKey, writer, 'resolved task blockers', (nextBoard) => {
    const doneTaskRefs = new Set(
      nextBoard.items.filter((task) => task.status === 'done').map((task) => task.ref),
    )
    for (const task of nextBoard.items) {
      task.blockedBy = task.blockedBy.filter(
        (blocker) =>
          !(
            (blocker.kind === 'task' && doneTaskRefs.has(blocker.ref)) ||
            (blocker.kind === 'decision' && resolvedDecisionRefs.has(blocker.ref))
          ),
      )
    }
  })

  for (const { taskRef, blocker } of removed) {
    await store.appendEvent(goalKey, {
      writer,
      action: blocker.kind === 'task' ? 'task_blocker_resolved' : 'decision_blocker_resolved',
      goalKey,
      taskRef,
      reason: `${blocker.kind}:${blocker.ref}`,
    })
  }

  return true
}

function isDispatchableTask(task: TaskItem) {
  return task.blockedBy.length === 0 && stepForTask(task) !== null
}

function stepForTask(task: TaskItem): DispatchStep | null {
  if (task.status === 'planned') {
    return {
      role: task.kind === 'planning' ? 'planner' : 'generator',
      successTo: 'in_review',
    }
  }

  if (task.status === 'in_review') {
    return {
      role: 'reviewer',
      successTo: 'merging',
      rejectTo: 'planned',
    }
  }

  if (task.status === 'merging') {
    return {
      role: 'merger',
      successTo: 'done',
      mergeConflictTo: 'planned',
    }
  }

  return null
}

async function resolveOutcome(
  task: TaskItem,
  from: TaskStatus,
  step: DispatchStep,
  outcome: AgentOutcome,
  attempts: AttemptStore,
  maxAttempts: number,
): Promise<OutcomeResolution> {
  if (outcome.kind === 'success') {
    return { to: step.successTo }
  }

  if (outcome.kind === 'reject') {
    return resolveFailure({
      task,
      attempts,
      maxAttempts,
      failureKind: 'reviewer_rejected',
      retryStatus: step.rejectTo ?? from,
    })
  }

  if (outcome.kind === 'merge_conflict') {
    return resolveFailure({
      task,
      attempts,
      maxAttempts,
      failureKind: 'merge_conflict',
      retryStatus: step.mergeConflictTo ?? from,
      blockerRef: outcome.artifactRef,
    })
  }

  return resolveFailure({
    task,
    attempts,
    maxAttempts,
    failureKind: outcome.kind === 'timeout' ? 'timeout' : 'agent_failed',
    retryStatus: from,
  })
}

async function validatePlanningFollowThroughIfNeeded(options: {
  goalKey: string
  task: TaskItem
  step: DispatchStep
  outcome: AgentOutcome
  resolution: OutcomeResolution
  attempts: AttemptStore
  maxAttempts: number
  planningRequests: PlanningRequestStore
  writeTraces: WriteTraceStore
}) {
  if (
    options.task.kind !== 'planning' ||
    options.outcome.kind !== 'success' ||
    (options.step.role !== 'reviewer' && options.step.role !== 'merger')
  ) {
    return {
      outcome: options.outcome,
      resolution: options.resolution,
    }
  }

  const evidence = await inspectPlanningFollowThroughEvidence({
    goalKey: options.goalKey,
    taskRef: options.task.ref,
    planningRequests: options.planningRequests,
    writeTraces: options.writeTraces,
  })
  if (evidence.missingUpdates.length === 0) {
    return {
      outcome: options.outcome,
      resolution: options.resolution,
    }
  }

  return {
    outcome: {
      kind: 'fail' as const,
      reason: `Missing requested planning follow-through evidence: ${evidence.missingUpdates.join(', ')}`,
    },
    resolution: await resolveFailure({
      task: options.task,
      attempts: options.attempts,
      maxAttempts: options.maxAttempts,
      failureKind: 'planning_follow_through_missing',
      retryStatus: 'planned',
    }),
  }
}

async function resolveFailure(options: {
  task: TaskItem
  attempts: AttemptStore
  maxAttempts: number
  failureKind: FailureKind
  retryStatus: TaskStatus
  blockerRef?: string
}): Promise<OutcomeResolution> {
  const attemptCount = await options.attempts.increment(options.task.ref, options.failureKind)
  const blocker =
    attemptCount >= options.maxAttempts
      ? blockerForFailure(options.task.ref, options.failureKind, options.blockerRef)
      : undefined

  return {
    to: options.retryStatus,
    failureKind: options.failureKind,
    blocker,
  }
}

function blockerForFailure(
  taskRef: string,
  failureKind: FailureKind,
  blockerRef?: string,
): BlockerRef {
  if (failureKind === 'merge_conflict') {
    return { kind: 'merge_conflict', ref: blockerRef ?? `${taskRef}:merge_conflict` }
  }

  return { kind: 'intervention', ref: `${taskRef}:${failureKind}` }
}

async function setTaskStatus(
  store: BoardStore,
  goalKey: string,
  writer: string,
  taskRef: string,
  status: TaskStatus,
) {
  await store.mutateBoard(goalKey, writer, `set ${taskRef} ${status}`, (board) => {
    findTask(board.items, taskRef).status = status
  })
}

async function finalizeTask(
  store: BoardStore,
  goalKey: string,
  writer: string,
  taskRef: string,
  resolution: OutcomeResolution,
) {
  await store.mutateBoard(goalKey, writer, `finalize ${taskRef}`, (board) => {
    const task = findTask(board.items, taskRef)
    task.status = resolution.to

    if (resolution.blocker && !hasBlocker(task.blockedBy, resolution.blocker)) {
      task.blockedBy.push(resolution.blocker)
    }
  })
}

function findTask(tasks: TaskItem[], taskRef: string) {
  const task = tasks.find((item) => item.ref === taskRef)
  if (!task) {
    throw new Error(`Missing task ${taskRef}`)
  }
  return task
}

function hasBlocker(blockers: BlockerRef[], blocker: BlockerRef) {
  return blockers.some((item) => item.kind === blocker.kind && item.ref === blocker.ref)
}

async function finishHistoryStep(
  history: RunHistoryStore | undefined,
  runRef: { runId: string; stepId: string } | undefined,
  input: {
    goalKey: string
    statusAfter: TaskStatus
    outcome: StepOutcome
    runStatus?: RunStatus
    message: { kind: 'system'; role: 'system'; content: string }
  },
) {
  if (!history || !runRef) {
    return
  }

  await history.finishStep({
    goalKey: input.goalKey,
    runId: runRef.runId,
    stepId: runRef.stepId,
    statusAfter: input.statusAfter,
    outcome: input.outcome,
    runStatus: input.runStatus,
    message: input.message,
  })
}

function runStatusForResolution(resolution: OutcomeResolution): RunStatus | undefined {
  if (resolution.blocker) {
    return 'blocked'
  }

  if (resolution.to === 'done') {
    return 'completed'
  }

  if (resolution.to === 'planned') {
    return 'retryable'
  }

  return undefined
}

function stepOutcomeForAgentOutcome(outcome: AgentOutcome): StepOutcome {
  switch (outcome.kind) {
    case 'success':
      return 'success'
    case 'reject':
      return 'reject'
    case 'merge_conflict':
      return 'merge_conflict'
    case 'timeout':
      return 'timeout'
    case 'fail':
      return 'fail'
  }
}

function messageForOutcome(taskRef: string, outcome: AgentOutcome, statusAfter: TaskStatus) {
  switch (outcome.kind) {
    case 'success':
      return `${taskRef} advanced to ${statusAfter}`
    case 'reject':
      return outcome.reason
    case 'merge_conflict':
      return `merge conflict: ${outcome.artifactRef}`
    case 'timeout':
      return outcome.reason
    case 'fail':
      return outcome.reason
  }
}

function statusMessage(content: string) {
  return {
    kind: 'system' as const,
    role: 'system' as const,
    content,
  }
}

function historyEventForRuntimeEvent(event: AgentRuntimeEvent) {
  if (event.kind === 'transcript') {
    return {
      kind: 'transcript' as const,
      transport: event.transport,
      entryKind: event.entryKind,
      summary: event.summary,
      toolName: event.toolName,
      vendorEventType: event.vendorEventType,
    }
  }

  if (event.kind === 'message') {
    return {
      kind: 'message' as const,
      level: event.level,
      role: event.role,
      content: event.content,
    }
  }

  if (event.kind === 'worktree_prepared') {
    return {
      kind: 'worktree_prepared' as const,
      path: event.path,
      branch: event.branch,
      baseBranch: event.baseBranch,
    }
  }

  return {
    kind: 'artifact' as const,
    ref: event.ref,
    label: event.label,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
