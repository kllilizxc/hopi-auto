import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readAssistantFeed, readAssistantFeedChanges } from './apiClient'
import type {
  AssistantFeedActivity,
  AssistantFeedEntry,
  AssistantFeedPage,
  AssistantOpenRequest,
} from './apiTypes'
import {
  mergeAssistantChangesIntoHistory,
  messageStreamSnapshotKey,
  readMessageStreamSnapshot,
  writeMessageStreamSnapshot,
} from './messageStreamCache'
import { STABLE_QUERY_NOTIFY_PROPS } from './queryPerformance'

interface UseAssistantFeedStreamOptions {
  enabled?: boolean
  refetchInterval?: number | false
  historyPageSize?: number
  projectId?: string
}

export interface AssistantFeedSyncState {
  scopeKey: string
  initialized: boolean
  items: AssistantFeedEntry[]
  removedIds: string[]
  requests: AssistantOpenRequest[]
  activity: AssistantFeedActivity | null
}

export function useAssistantFeedStream({
  enabled = true,
  refetchInterval = false,
  historyPageSize = 10,
  projectId,
}: UseAssistantFeedStreamOptions) {
  const queryClient = useQueryClient()
  const scopeKey = projectId ?? 'home'
  const historyQueryKey = useMemo(
    () => ['assistant-feed', scopeKey, 'history', historyPageSize] as const,
    [historyPageSize, scopeKey],
  )
  const historySnapshotKey = messageStreamSnapshotKey(historyQueryKey)
  const persistedHistory = useMemo(
    () => readMessageStreamSnapshot<AssistantFeedPage>(historySnapshotKey),
    [historySnapshotKey],
  )
  const cursorRef = useRef<string | null | undefined>(undefined)
  const initializedScopeRef = useRef<string | null>(null)
  const [syncState, setSyncState] = useState<AssistantFeedSyncState>(() =>
    emptyAssistantFeedSyncState(scopeKey),
  )
  const currentSyncState = useMemo(
    () => assistantFeedSyncStateForScope(syncState, scopeKey),
    [scopeKey, syncState],
  )

  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) =>
      readAssistantFeed({
        ...(pageParam ? { before: pageParam } : {}),
        limit: historyPageSize,
        ...(projectId ? { projectId } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.pageInfo.hasOlder ? (page.pageInfo.oldestCursor ?? undefined) : undefined,
    initialData: persistedHistory
      ? { pages: [persistedHistory.value], pageParams: [null] }
      : undefined,
    initialDataUpdatedAt: persistedHistory?.savedAt,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const initialPage = historyQuery.data?.pages[0]
  useEffect(() => {
    if (!initialPage || initializedScopeRef.current === scopeKey) return
    initializedScopeRef.current = scopeKey
    cursorRef.current = initialPage.syncCursor ?? null
    setSyncState({
      scopeKey,
      initialized: true,
      items: [],
      removedIds: [],
      requests: initialPage.requests ?? [],
      activity: initialPage.activity,
    })
  }, [initialPage, scopeKey])

  const changesQuery = useQuery({
    queryKey: ['assistant-feed', scopeKey, 'changes'],
    queryFn: () => readAssistantFeedChanges(cursorRef.current ?? null, projectId),
    enabled: enabled && currentSyncState.initialized,
    refetchInterval: enabled ? refetchInterval : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })

  useEffect(() => {
    const changes = changesQuery.data
    if (!changes) return
    cursorRef.current = changes.syncCursor
    queryClient.setQueryData<InfiniteData<AssistantFeedPage, string | null>>(
      historyQueryKey,
      (current) => mergeAssistantChangesIntoHistory(current, changes),
    )
    setSyncState((current) => ({
      scopeKey,
      initialized: true,
      items: mergeAssistantFeedEntries(
        current.scopeKey === scopeKey ? current.items : [],
        changes.items,
        changes.removedIds,
      ),
      removedIds: [
        ...new Set([
          ...(current.scopeKey === scopeKey ? current.removedIds : []),
          ...changes.removedIds,
        ]),
      ],
      requests: changes.requests ?? (current.scopeKey === scopeKey ? current.requests : []),
      activity: changes.activity,
    }))
  }, [changesQuery.data, historyQueryKey, queryClient, scopeKey])

  const items = useMemo(() => {
    const historyItems = [...(historyQuery.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.items)
    return mergeAssistantFeedEntries(
      historyItems,
      currentSyncState.items,
      currentSyncState.removedIds,
    )
  }, [currentSyncState.items, currentSyncState.removedIds, historyQuery.data?.pages])

  const oldestPage = historyQuery.data?.pages.at(-1)
  const newestPage = historyQuery.data?.pages[0]
  const activity = currentSyncState.initialized
    ? currentSyncState.activity
    : (initialPage?.activity ?? null)
  useEffect(() => {
    if (!newestPage) return
    const timeout = window.setTimeout(() => {
      writeMessageStreamSnapshot<AssistantFeedPage>(historySnapshotKey, {
        items,
        requests: currentSyncState.requests,
        activity,
        syncCursor: cursorRef.current ?? newestPage.syncCursor,
        pageInfo: {
          oldestCursor: oldestPage?.pageInfo.oldestCursor ?? null,
          newestCursor: newestPage.pageInfo.newestCursor,
          hasOlder: oldestPage?.pageInfo.hasOlder ?? false,
          hasNewer: false,
          totalCount: Math.max(items.length, newestPage.pageInfo.totalCount),
        },
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [activity, currentSyncState.requests, historySnapshotKey, items, newestPage, oldestPage])

  const loadOlder = useCallback(() => {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return
    void historyQuery.fetchNextPage()
  }, [historyQuery.fetchNextPage, historyQuery.hasNextPage, historyQuery.isFetchingNextPage])
  const refresh = useCallback(() => {
    if (currentSyncState.initialized) void changesQuery.refetch()
    else void historyQuery.refetch()
  }, [changesQuery.refetch, currentSyncState.initialized, historyQuery.refetch])

  return {
    items,
    requests: currentSyncState.requests,
    activity,
    error: (historyQuery.error ?? (items.length === 0 ? changesQuery.error : null)) as Error | null,
    isLoading: historyQuery.isLoading,
    isLoadingOlder: historyQuery.isFetchingNextPage,
    hasMoreBefore: oldestPage?.pageInfo.hasOlder ?? false,
    loadOlder,
    refresh,
  }
}

export function mergeAssistantFeedEntries(
  current: AssistantFeedEntry[],
  incoming: AssistantFeedEntry[],
  removedIds: string[] = [],
) {
  const merged = new Map(current.map((entry) => [entry.id, entry]))
  for (const entry of incoming) merged.set(entry.id, entry)
  for (const id of removedIds) merged.delete(id)
  return [...merged.values()].sort(compareAssistantFeedEntries)
}

export function assistantFeedSyncStateForScope(state: AssistantFeedSyncState, scopeKey: string) {
  return state.scopeKey === scopeKey ? state : emptyAssistantFeedSyncState(scopeKey)
}

function emptyAssistantFeedSyncState(scopeKey: string): AssistantFeedSyncState {
  return {
    scopeKey,
    initialized: false,
    items: [],
    removedIds: [],
    requests: [],
    activity: null,
  }
}

function compareAssistantFeedEntries(left: AssistantFeedEntry, right: AssistantFeedEntry) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)
}
