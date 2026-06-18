import type { GoalRunSummary, TaskStatus } from './api'

export function compareGoalRunsForRecency(left: GoalRunSummary, right: GoalRunSummary) {
  const statusDelta = activeRunPriority(left.status) - activeRunPriority(right.status)
  if (statusDelta !== 0) {
    return statusDelta
  }

  return Date.parse(right.startedAt) - Date.parse(left.startedAt)
}

export function sortGoalRunsForRecency(runs: GoalRunSummary[]) {
  return [...runs].sort(compareGoalRunsForRecency)
}

export function sortTaskRunsForPresentation(
  runs: GoalRunSummary[],
  taskStatus?: TaskStatus | null,
) {
  if (taskStatus !== 'done') {
    return sortGoalRunsForRecency(runs)
  }

  return [...runs].sort((left, right) => {
    const doneDelta = doneTaskRunPriority(left) - doneTaskRunPriority(right)
    if (doneDelta !== 0) {
      return doneDelta
    }

    return compareGoalRunsForRecency(left, right)
  })
}

export function pickPreferredTaskRun(
  runs: GoalRunSummary[],
  taskRef: string,
  requestedRunId?: string | null,
  taskStatus?: TaskStatus | null,
) {
  const taskRuns = sortTaskRunsForPresentation(
    runs.filter((run) => run.taskRef === taskRef),
    taskStatus,
  )
  if (taskRuns.length === 0) {
    return null
  }

  if (requestedRunId) {
    const requested = taskRuns.find((run) => run.runId === requestedRunId)
    if (requested) {
      return requested
    }
  }

  return taskRuns[0] ?? null
}

function activeRunPriority(status: GoalRunSummary['status']) {
  if (status === 'active') {
    return 0
  }
  if (status === 'blocked') {
    return 1
  }
  if (status === 'retryable') {
    return 2
  }
  return 3
}

function doneTaskRunPriority(run: GoalRunSummary) {
  if (run.finalTaskStatus === 'done' || run.status === 'completed') {
    return 0
  }

  if (run.status === 'retryable' || run.status === 'blocked' || run.status === 'system_error') {
    return 1
  }

  return 2
}
