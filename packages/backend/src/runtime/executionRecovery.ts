import type { BoardStore } from '../storage/boardStore'
import type { ExecutionStateStore, WorkerLeaseStore } from './executionStateStore'
import type { RunHistoryStore } from './runHistoryStore'

const DEFAULT_WORKER_STALE_MS = 15_000
const DEFAULT_STEP_STALE_MS = 45_000

export async function recoverGoalExecutionState(options: {
  projectKey: string
  goalKey: string
  board: BoardStore
  execution: ExecutionStateStore
  workers: WorkerLeaseStore
  history: RunHistoryStore
  workerStaleMs?: number
  stepStaleMs?: number
}) {
  const activeWorkerIds = await options.workers.activeWorkerIds(
    options.workerStaleMs ?? DEFAULT_WORKER_STALE_MS,
  )
  const recovered = await options.execution.recoverStaleTaskExecutions({
    goalKey: options.goalKey,
    activeWorkerIds,
    stepStaleMs: options.stepStaleMs ?? DEFAULT_STEP_STALE_MS,
  })
  if (recovered.length === 0) {
    return recovered
  }

  const board = await options.board.readBoard(options.goalKey)
  const taskByRef = new Map(board.items.map((task) => [task.ref, task] as const))
  for (const step of recovered) {
    if (!step.runId || !step.stepId) {
      continue
    }
    const task = taskByRef.get(step.taskRef)
    const statusAfter = task?.status ?? step.statusBefore
    await options.history.recoverStep({
      goalKey: options.goalKey,
      runId: step.runId,
      stepId: step.stepId,
      statusAfter,
      message: {
        kind: 'error',
        role: 'system',
        content: `Recovered stale ${step.role} session for ${step.taskRef}.`,
      },
    })
  }

  return recovered
}
