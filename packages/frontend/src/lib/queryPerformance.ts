import type { AppSnapshot, GoalBoardDetail, GoalDetail, GoalDocsDetail } from './apiTypes'

export const CANONICAL_POLL_INTERVAL_MS = 2_000
export const ACTIVE_STREAM_POLL_INTERVAL_MS = 1_000
export const DOCUMENT_POLL_INTERVAL_MS = 5_000
export const SETTLED_POLL_INTERVAL_MS = 15_000
export const NAVIGATION_CACHE_GC_INTERVAL_MS = 30 * 60 * 1_000

type QueryNotifyProp = 'data' | 'error' | 'isLoading' | 'isError' | 'isFetching'

export const STABLE_QUERY_NOTIFY_PROPS: QueryNotifyProp[] = [
  'data',
  'error',
  'isLoading',
  'isError',
]
export const REFRESHING_QUERY_NOTIFY_PROPS: QueryNotifyProp[] = [
  'data',
  'error',
  'isLoading',
  'isError',
  'isFetching',
]

interface QueryWithData<T> {
  state: { data: T | undefined }
}

export function shellPollInterval(query: QueryWithData<AppSnapshot>) {
  return query.state.data?.activeRuns.length ||
    query.state.data?.projects.some((project) => project.preview?.status === 'starting')
    ? CANONICAL_POLL_INTERVAL_MS
    : SETTLED_POLL_INTERVAL_MS
}

export function boardPollInterval(query: QueryWithData<GoalBoardDetail>) {
  return query.state.data?.goal.lifecycle === 'active'
    ? CANONICAL_POLL_INTERVAL_MS
    : SETTLED_POLL_INTERVAL_MS
}

export function documentPollInterval(query: QueryWithData<GoalDetail | GoalDocsDetail>) {
  return query.state.data?.goal.lifecycle === 'active'
    ? DOCUMENT_POLL_INTERVAL_MS
    : SETTLED_POLL_INTERVAL_MS
}
