import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readAssistantFeed, readAssistantFeedChanges } from './apiClient'
import type { AssistantFeedActivity, AssistantFeedEntry } from './apiTypes'

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
  const cursorRef = useRef<string | null | undefined>(undefined)
  const initializedRef = useRef(false)
  const [syncState, setSyncState] = useState<AssistantFeedSyncState>({
    initialized: false,
    items: [],
    removedIds: [],
    activity: null,
  })

  const historyQuery = useInfiniteQuery({
    queryKey: ['assistant-feed', 'history', historyPageSize],
    queryFn: ({ pageParam }) =>
      readAssistantFeed({
        ...(pageParam ? { before: pageParam } : {}),
        limit: historyPageSize,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.pageInfo.hasOlder ? (page.pageInfo.oldestCursor ?? undefined) : undefined,
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
  })

  useEffect(() => {
    const changes = changesQuery.data
    if (!changes) return
    cursorRef.current = changes.syncCursor
    setSyncState((current) => ({
      initialized: true,
      items: mergeAssistantFeedEntries(current.items, changes.items, changes.removedIds),
      removedIds: [...new Set([...current.removedIds, ...changes.removedIds])],
      activity: changes.activity,
    }))
  }, [changesQuery.data])

  const items = useMemo(() => {
    const historyItems = [...(historyQuery.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.items)
    return mergeAssistantFeedEntries(historyItems, syncState.items, syncState.removedIds)
  }, [historyQuery.data?.pages, syncState.items, syncState.removedIds])

  const oldestPage = historyQuery.data?.pages.at(-1)
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
    activity: syncState.initialized ? syncState.activity : (initialPage?.activity ?? null),
    error: (historyQuery.error ??
      (items.length === 0 ? changesQuery.error : null)) as Error | null,
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
