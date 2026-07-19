export function goalBoardQueryKey(projectId: string | undefined, goalId: string | undefined) {
  return ['mvp-goal', projectId, goalId, 'board'] as const
}

export function goalDocsQueryKey(projectId: string | undefined, goalId: string | undefined) {
  return ['mvp-goal', projectId, goalId, 'docs'] as const
}

export function workAttemptsQueryKey(projectId: string, goalId: string, workId: string) {
  return ['work-attempts', projectId, goalId, workId] as const
}

export function workAttemptEventsQueryKey(
  projectId: string,
  goalId: string,
  workId: string,
  runId: string | null,
) {
  return ['work-attempt-events', projectId, goalId, workId, runId] as const
}

export function infiniteMessageHistoryQueryKey(
  queryKey: readonly unknown[],
  historyPageSize?: number,
) {
  return [...queryKey, 'history', historyPageSize ?? 'default'] as const
}
