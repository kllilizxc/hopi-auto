import type { AgentOutcome, AgentRole, AgentRunner } from '../agent/AgentRunner'
import type { BlockerRef, FailureKind, TaskItem, TaskStatus } from '../domain/board'
import type { AttemptStore } from '../runtime/attemptStore'
import type { BoardStore } from '../storage/boardStore'

export interface ReconcileOptions {
  goalKey: string
  store: BoardStore
  attempts: AttemptStore
  runner: AgentRunner
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

  if (await cleanupResolvedTaskBlockers(options.store, options.goalKey, writer)) {
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

  let outcome: AgentOutcome
  try {
    outcome = await options.runner.run({
      goalKey: options.goalKey,
      taskRef: task.ref,
      taskKind: task.kind,
      role: step.role,
    })
  } catch (error) {
    await setTaskStatus(options.store, options.goalKey, writer, task.ref, from)
    await options.store.appendEvent(options.goalKey, {
      writer,
      action: 'system_error',
      goalKey: options.goalKey,
      taskRef: task.ref,
      systemError: {
        kind: 'runner_exception',
        message: errorMessage(error),
        correlationId: crypto.randomUUID(),
      },
    })
    throw error
  }

  const resolution = await resolveOutcome(task, from, step, outcome, options.attempts, maxAttempts)
  await finalizeTask(options.store, options.goalKey, writer, task.ref, resolution)

  if (resolution.blocker) {
    return { kind: 'blocked', taskRef: task.ref, blocker: resolution.blocker }
  }

  return { kind: 'advanced', taskRef: task.ref, from, to: resolution.to }
}

async function cleanupResolvedTaskBlockers(
  store: BoardStore,
  goalKey: string,
  writer: string,
): Promise<boolean> {
  const board = await store.readBoard(goalKey)
  const doneRefs = new Set(
    board.items.filter((task) => task.status === 'done').map((task) => task.ref),
  )
  const removed: Array<{ taskRef: string; blocker: BlockerRef }> = []

  for (const task of board.items) {
    for (const blocker of task.blockedBy) {
      if (blocker.kind === 'task' && doneRefs.has(blocker.ref)) {
        removed.push({ taskRef: task.ref, blocker })
      }
    }
  }

  if (removed.length === 0) {
    return false
  }

  await store.mutateBoard(goalKey, writer, 'resolved task blockers', (nextBoard) => {
    const doneTaskRefs = new Set(
      nextBoard.items.filter((task) => task.status === 'done').map((task) => task.ref),
    )
    for (const task of nextBoard.items) {
      task.blockedBy = task.blockedBy.filter(
        (blocker) => blocker.kind !== 'task' || !doneTaskRefs.has(blocker.ref),
      )
    }
  })

  for (const { taskRef, blocker } of removed) {
    await store.appendEvent(goalKey, {
      writer,
      action: 'task_blocker_resolved',
      goalKey,
      taskRef,
      reason: `task:${blocker.ref}`,
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
  const task = tasks.find((candidate) => candidate.ref === taskRef)
  if (!task) {
    throw new Error(`Missing task ${taskRef}`)
  }
  return task
}

function hasBlocker(blockers: BlockerRef[], blocker: BlockerRef) {
  return blockers.some(
    (candidate) => candidate.kind === blocker.kind && candidate.ref === blocker.ref,
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
