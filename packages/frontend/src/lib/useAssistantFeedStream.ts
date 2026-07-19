import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readAssistantFeed, readAssistantFeedChanges } from './apiClient'
import type {
  AssistantFeedActivity,
  AssistantFeedEntry,
  AssistantFeedPage,
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
}

interface AssistantFeedSyncState {
  initialized: boolean
  items: AssistantFeedEntry[]
  removedIds: string[]
  activity: AssistantFeedActivity | null
}

export function useAssistantFeedStream({
  enabled = true,
  refetchInterval = false,
  historyPageSize = 10,
}: UseAssistantFeedStreamOptions) {
  const queryClient = useQueryClient()
  const historyQueryKey = useMemo(
    () => ['assistant-feed', 'history', historyPageSize] as const,
    [historyPageSize],
  )
  const historySnapshotKey = messageStreamSnapshotKey(historyQueryKey)
  const persistedHistory = useMemo(
    () => readMessageStreamSnapshot<AssistantFeedPage>(historySnapshotKey),
    [historySnapshotKey],
  )
  const cursorRef = useRef<string | null | undefined>(undefined)
  const initializedRef = useRef(false)
  const [syncState, setSyncState] = useState<AssistantFeedSyncState>({
    initialized: false,
    items: [],
    removedIds: [],
    activity: null,
  })

  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) =>
      readAssistantFeed({
        ...(pageParam ? { before: pageParam } : {}),
        limit: historyPageSize,
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
    if (!initialPage || initializedRef.current) return
    initializedRef.current = true
    cursorRef.current = initialPage.syncCursor ?? null
    setSyncState({
      initialized: true,
      items: [],
      removedIds: [],
      activity: initialPage.activity,
    })
  }, [initialPage])

  const changesQuery = useQuery({
    queryKey: ['assistant-feed', 'changes'],
    queryFn: () => readAssistantFeedChanges(cursorRef.current ?? null),
    enabled: enabled && syncState.initialized,
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
      initialized: true,
      items: mergeAssistantFeedEntries(current.items, changes.items, changes.removedIds),
      removedIds: [...new Set([...current.removedIds, ...changes.removedIds])],
      activity: changes.activity,
    }))
  }, [changesQuery.data, historyQueryKey, queryClient])

  const items = useMemo(() => {
    const historyItems = [...(historyQuery.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.items)
    return mergeAssistantFeedEntries(historyItems, syncState.items, syncState.removedIds)
  }, [historyQuery.data?.pages, syncState.items, syncState.removedIds])

  const oldestPage = historyQuery.data?.pages.at(-1)
  const newestPage = historyQuery.data?.pages[0]
  const activity = syncState.initialized ? syncState.activity : (initialPage?.activity ?? null)
  useEffect(() => {
    if (!newestPage) return
    const timeout = window.setTimeout(() => {
      writeMessageStreamSnapshot<AssistantFeedPage>(historySnapshotKey, {
        items,
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
  }, [activity, historySnapshotKey, items, newestPage, oldestPage])

  const loadOlder = useCallback(() => {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return
    void historyQuery.fetchNextPage()
  }, [historyQuery.fetchNextPage, historyQuery.hasNextPage, historyQuery.isFetchingNextPage])
  const refresh = useCallback(() => {
    if (syncState.initialized) void changesQuery.refetch()
    else void historyQuery.refetch()
  }, [changesQuery.refetch, historyQuery.refetch, syncState.initialized])

  return {
    items,
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

function compareAssistantFeedEntries(left: AssistantFeedEntry, right: AssistantFeedEntry) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)
}
