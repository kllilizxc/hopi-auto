import type { AgentOutcome, AgentRole, AgentRunner, AgentRuntimeEvent } from '../agent/AgentRunner'
import type { BlockerRef, FailureKind, TaskItem, TaskStatus } from '../domain/board'
import type { AttemptStore } from '../runtime/attemptStore'
import { type GitMergeExecutor, createGitMergeExecutor } from '../runtime/gitMergeExecutor'
import {
  type LaneParallelismInput,
  executionLaneForStatus,
  normalizeLaneParallelism,
} from '../runtime/laneParallelism'
import { inspectPlanningFollowThroughEvidence } from '../runtime/planningFollowThroughEvidence'
import {
  resolvePlanningRequestsForTask,
  syncGroupedPlanningEngineeringBlockers,
} from '../runtime/planningRequest'
import {
  inspectBrowserHarnessAcceptanceCriteria,
  inspectEngineeringTaskDecomposition,
} from '../runtime/taskGraphPolicy'
import type { ExecutionStateStore } from '../runtime/executionStateStore'
import type { RunningTaskRegistry } from '../runtime/runningTaskRegistry'
import type { RunStatus, StepOutcome } from '../runtime/runHistory'
import type { RunHistoryStore } from '../runtime/runHistoryStore'
import { type WriteTraceStore, createWriteTraceStore } from '../runtime/writeTraceStore'
import type { BoardStore } from '../storage/boardStore'
import { type DecisionStore, createDecisionStore } from '../storage/decisionStore'
import {
  type GoalPlanningRequestUpdateTarget,
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
  runningTasks?: RunningTaskRegistry
  execution?: ExecutionStateStore
  workerId?: string
  maxParallel?: number
  laneParallelism?: LaneParallelismInput
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
const LEGACY_BOOTSTRAP_PLANNING_UPDATES: GoalPlanningRequestUpdateTarget[] = [
  'design.md',
  'todo.yml',
]

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

  const selected = await selectDispatchableTask({
    board: await options.store.readBoard(options.goalKey),
    goalKey: options.goalKey,
    rootDir: options.store.paths.rootDir,
    runningTasks: options.runningTasks,
    execution: options.execution,
    workerId: options.workerId,
    maxParallel: options.maxParallel,
    laneParallelism: options.laneParallelism,
  })
  if (!selected) {
    return { kind: 'idle' }
  }

  const { task, step, executionLease, runningLease } = selected
  const from = task.status

  let executionFinalized = false
  try {
    if (from === 'planned') {
      await setTaskStatus(options.store, options.goalKey, writer, task.ref, 'in_progress')
    }

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
          refs: executionLease ? { stepId: executionLease.executionId } : undefined,
        })
        if (executionLease && executionLease.executionId !== runRef.stepId) {
          await options.execution?.bindRunStepRefs(options.goalKey, executionLease.executionId, runRef)
        } else if (executionLease) {
          await options.execution?.bindRunStepRefs(options.goalKey, executionLease.executionId, runRef)
        }
      } catch (error) {
        await setTaskStatus(options.store, options.goalKey, writer, task.ref, from)
        if (executionLease) {
          await options.execution?.finishTaskExecution({
            goalKey: options.goalKey,
            executionId: executionLease.executionId,
            outcome: 'system_error',
          })
        }
        throw error
      }
    }

    let outcome: AgentOutcome
    let forcedResolution: OutcomeResolution | undefined
    try {
      const runMergeScript = mergeExecutor.runMergeScript
      const finalizeMergedRun = mergeExecutor.finalizeMergedRun
      const supportsScriptFirstMerge =
        step.role === 'merger' &&
        typeof runMergeScript === 'function' &&
        typeof finalizeMergedRun === 'function'

      if (supportsScriptFirstMerge) {
        const initialAttempt = await runMergeScript({
          goalKey: options.goalKey,
          taskRef: task.ref,
          taskKind: task.kind,
          runId: runRef.runId,
          stepId: runRef.stepId,
        })
        await recordMergeScriptAttempt(options.history, {
          goalKey: options.goalKey,
          runId: runRef.runId,
          stepId: runRef.stepId,
          attempt: initialAttempt,
          phase: 'initial',
        })

        if (initialAttempt.result?.kind === 'merged') {
          await finalizeMergedRun({
            goalKey: options.goalKey,
            taskRef: task.ref,
            taskKind: task.kind,
            runId: runRef.runId,
            stepId: runRef.stepId,
          })
          outcome = { kind: 'success' }
        } else if (initialAttempt.result?.kind === 'merge_conflict') {
          outcome = {
            kind: 'merge_conflict',
            artifactRef:
              initialAttempt.result.artifactRef ?? `branch:${task.ref}:${runRef.runId}`,
          }
          forcedResolution = {
            to: step.mergeConflictTo ?? from,
            failureKind: 'merge_conflict',
            blocker: {
              kind: 'merge_conflict',
              ref: initialAttempt.result.artifactRef ?? `branch:${task.ref}:${runRef.runId}`,
            },
          }
        } else {
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
              onHeartbeat: async () => {
                if (executionLease) {
                  await options.execution?.heartbeatTaskExecution(
                    options.goalKey,
                    executionLease.executionId,
                  )
                }
              },
            },
          )

          if (outcome.kind === 'success') {
            const verificationAttempt = await runMergeScript({
              goalKey: options.goalKey,
              taskRef: task.ref,
              taskKind: task.kind,
              runId: runRef.runId,
              stepId: runRef.stepId,
            })
            await recordMergeScriptAttempt(options.history, {
              goalKey: options.goalKey,
              runId: runRef.runId,
              stepId: runRef.stepId,
              attempt: verificationAttempt,
              phase: 'verification',
            })

            if (verificationAttempt.result?.kind === 'merged') {
              await finalizeMergedRun({
                goalKey: options.goalKey,
                taskRef: task.ref,
                taskKind: task.kind,
                runId: runRef.runId,
                stepId: runRef.stepId,
              })
            } else if (verificationAttempt.result) {
              outcome = {
                kind: 'merge_conflict',
                artifactRef:
                  verificationAttempt.result.artifactRef ??
                  `branch:${task.ref}:${runRef.runId}`,
              }
              if (verificationAttempt.result.kind === 'merge_conflict') {
                forcedResolution = {
                  to: step.mergeConflictTo ?? from,
                  failureKind: 'merge_conflict',
                  blocker: {
                    kind: 'merge_conflict',
                    ref:
                      verificationAttempt.result.artifactRef ??
                      `branch:${task.ref}:${runRef.runId}`,
                  },
                }
              }
            } else {
              throw new Error(
                `merge script verification failed: ${firstNonEmpty(
                  verificationAttempt.parseError,
                  verificationAttempt.stderr.trim(),
                  verificationAttempt.stdout.trim(),
                  `exit ${verificationAttempt.exitCode}`,
                )}`,
              )
            }
          }
        }
      } else {
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
            onHeartbeat: async () => {
              if (executionLease) {
                await options.execution?.heartbeatTaskExecution(
                  options.goalKey,
                  executionLease.executionId,
                )
              }
            },
          },
        )

        if (step.role === 'merger' && outcome.kind === 'success') {
          outcome = await mergeExecutor.completeMerge({
            goalKey: options.goalKey,
            taskRef: task.ref,
            taskKind: task.kind,
            runId: runRef.runId,
            stepId: runRef.stepId,
          })
        }
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
      if (executionLease) {
        await options.execution?.finishTaskExecution({
          goalKey: options.goalKey,
          executionId: executionLease.executionId,
          outcome: 'system_error',
        })
        executionFinalized = true
      }
      throw error
    }

    const resolution =
      forcedResolution ??
      (await resolveOutcome(task, from, step, outcome, options.attempts, maxAttempts))
    const validated = await validatePlanningFollowThroughIfNeeded({
      goalKey: options.goalKey,
      task,
      step,
      outcome,
      resolution,
      attempts: options.attempts,
      maxAttempts,
      store: options.store,
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
      if (executionLease) {
        await options.execution?.finishTaskExecution({
          goalKey: options.goalKey,
          executionId: executionLease.executionId,
          outcome: 'system_error',
        })
        executionFinalized = true
      }
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
    if (executionLease) {
      await options.execution?.finishTaskExecution({
        goalKey: options.goalKey,
        executionId: executionLease.executionId,
        outcome: executionOutcomeForAgentOutcome(validated.outcome),
      })
      executionFinalized = true
    }

    if (validated.resolution.blocker) {
      return { kind: 'blocked', taskRef: task.ref, blocker: validated.resolution.blocker }
    }

    return { kind: 'advanced', taskRef: task.ref, from, to: validated.resolution.to }
  } finally {
    runningLease?.release()
    if (executionLease && !executionFinalized) {
      await options.execution?.finishTaskExecution({
        goalKey: options.goalKey,
        executionId: executionLease.executionId,
        outcome: 'system_error',
      }).catch(() => undefined)
    }
  }
}

async function selectDispatchableTask(options: {
  board: { items: TaskItem[] }
  goalKey: string
  rootDir: string
  runningTasks?: RunningTaskRegistry
  execution?: ExecutionStateStore
  workerId?: string
  maxParallel?: number
  laneParallelism?: LaneParallelismInput
}): Promise<{
  task: TaskItem
  step: DispatchStep
  executionLease?: Awaited<ReturnType<ExecutionStateStore['acquireTaskExecution']>>
  runningLease?: ReturnType<RunningTaskRegistry['acquire']>
} | null> {
  const laneParallelism = normalizeLaneParallelism(options.laneParallelism, options.maxParallel)
  for (const task of options.board.items) {
    if (!isDispatchableTask(task)) {
      continue
    }

    const step = stepForTask(task)
    if (!step) {
      continue
    }

    const lane = executionLaneForStatus(task.status)
    if (!lane) {
      continue
    }

    if (options.execution && options.workerId) {
      const executionLease = await options.execution.acquireTaskExecution({
        goalKey: options.goalKey,
        taskRef: task.ref,
        taskKind: task.kind,
        role: step.role,
        lane,
        statusBefore: task.status,
        workerId: options.workerId,
        laneLimit: laneParallelism[lane],
        roleLimit: roleParallelismLimit(step.role),
      })
      if (executionLease) {
        return { task, step, executionLease }
      }
      continue
    }

    if (!options.runningTasks) {
      return { task, step }
    }

    const runningLease = options.runningTasks.acquire({
      rootDir: options.rootDir,
      goalKey: options.goalKey,
      taskRef: task.ref,
      role: step.role,
      lane,
      laneLimit: laneParallelism[lane],
      roleLimit: roleParallelismLimit(step.role),
    })
    if (runningLease) {
      return { task, step, runningLease }
    }
  }

  return null
}

function roleParallelismLimit(role: AgentRole) {
  if (role === 'planner') {
    return 1
  }

  return undefined
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
  if (task.status === 'planned' || task.status === 'in_progress') {
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
      mergeConflictTo: 'merging',
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
  store: BoardStore
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
    fallbackRequestedUpdates: defaultPlanningRequestedUpdates(options.task),
  })
  if (evidence.missingUpdates.length === 0) {
    if (evidence.requestedUpdates.includes('todo.yml')) {
      const board = await options.store.readBoard(options.goalKey)
      const issues = inspectEngineeringTaskDecomposition(board)
      if (issues.length > 0) {
        return {
          outcome: {
            kind: 'fail' as const,
            reason: `Invalid engineering task decomposition: ${issues.map((issue) => issue.message).join(' ')}`,
          },
          resolution: await resolveFailure({
            task: options.task,
            attempts: options.attempts,
            maxAttempts: options.maxAttempts,
            failureKind: 'planning_task_graph_invalid',
            retryStatus: 'planned',
          }),
        }
      }
      const browserHarnessIssues = inspectBrowserHarnessAcceptanceCriteria(board)
      if (browserHarnessIssues.length > 0) {
        return {
          outcome: {
            kind: 'fail' as const,
            reason: `Invalid engineering Browser Harness acceptance: ${browserHarnessIssues.map((issue) => issue.message).join(' ')}`,
          },
          resolution: await resolveFailure({
            task: options.task,
            attempts: options.attempts,
            maxAttempts: options.maxAttempts,
            failureKind: 'planning_task_graph_invalid',
            retryStatus: 'planned',
          }),
        }
      }
    }

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

function defaultPlanningRequestedUpdates(
  task: TaskItem,
): GoalPlanningRequestUpdateTarget[] | undefined {
  if (task.ref === 'plan-goal') {
    return [...LEGACY_BOOTSTRAP_PLANNING_UPDATES]
  }

  return undefined
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

function executionOutcomeForAgentOutcome(outcome: AgentOutcome) {
  if (outcome.kind === 'success') {
    return 'succeeded' as const
  }
  if (outcome.kind === 'reject') {
    return 'rejected' as const
  }
  if (outcome.kind === 'timeout') {
    return 'timed_out' as const
  }
  if (outcome.kind === 'merge_conflict') {
    return 'merge_conflict' as const
  }
  if (outcome.kind === 'fail') {
    return 'failed' as const
  }
  return 'system_error' as const
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
      toolInvocationKey: event.toolInvocationKey,
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

async function recordMergeScriptAttempt(
  history: RunHistoryStore | undefined,
  options: {
    goalKey: string
    runId: string
    stepId: string
    attempt: NonNullable<GitMergeExecutor['runMergeScript']> extends (
      options: any,
    ) => Promise<infer TResult>
      ? TResult
      : never
    phase: 'initial' | 'verification'
  },
) {
  if (!history) {
    return
  }

  const toolInvocationKey = `merge-script:${options.phase}:${options.runId}:${options.stepId}`
  const commandSummary = `command (${options.attempt.command.join(' ')})`
  const resultSummary = summarizeMergeScriptAttempt(options.attempt, options.phase)
  await history.recordStepEvent({
    goalKey: options.goalKey,
    runId: options.runId,
    stepId: options.stepId,
    event: {
      kind: 'transcript',
      transport: 'process',
      entryKind: 'tool_call',
      summary: commandSummary,
      toolName: 'command',
      toolInvocationKey,
      vendorEventType: 'merge_script',
    },
  })
  await history.recordStepEvent({
    goalKey: options.goalKey,
    runId: options.runId,
    stepId: options.stepId,
    event: {
      kind: 'transcript',
      transport: 'process',
      entryKind: 'tool_result',
      summary: resultSummary,
      toolName: 'command',
      toolInvocationKey,
      vendorEventType: 'merge_script',
    },
  })
}

function summarizeMergeScriptAttempt(
  attempt: Awaited<ReturnType<NonNullable<GitMergeExecutor['runMergeScript']>>>,
  phase: 'initial' | 'verification',
) {
  const parts = [`${phase} merge script`]
  if (attempt.result) {
    parts.push(`${attempt.result.kind}: ${attempt.result.reason}`)
  } else if (attempt.parseError) {
    parts.push(`invalid output: ${attempt.parseError}`)
  } else {
    parts.push(`exit ${attempt.exitCode}`)
  }

  const stdout = attempt.stdout.trim()
  if (stdout) {
    parts.push(`stdout=${truncateHistorySummary(stdout)}`)
  }
  const stderr = attempt.stderr.trim()
  if (stderr) {
    parts.push(`stderr=${truncateHistorySummary(stderr)}`)
  }

  return parts.join(' | ')
}

function truncateHistorySummary(content: string, maxLength = 240) {
  if (content.length <= maxLength) {
    return content
  }
  return `${content.slice(0, maxLength)}...[truncated]`
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return ''
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
