import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CursorPage } from './apiTypes'
import type { CursorPageRequest } from './apiClient'
import {
  messageStreamSnapshotKey,
  mergeTailIntoMessageHistory,
  readMessageStreamSnapshot,
  writeMessageStreamSnapshot,
} from './messageStreamCache'
import { infiniteMessageHistoryQueryKey } from './queryKeys'
import {
  NAVIGATION_CACHE_GC_INTERVAL_MS,
  REFRESHING_QUERY_NOTIFY_PROPS,
  STABLE_QUERY_NOTIFY_PROPS,
} from './queryPerformance'

interface InfiniteMessageStreamOptions<T> {
  streamKey: string
  queryKey: readonly unknown[]
  readPage(input: CursorPageRequest): Promise<CursorPage<T>>
  getItemId(item: T): string
  compareItems(left: T, right: T): number
  enabled?: boolean
  refetchInterval?: number | false
  historyPageSize?: number
  tailPageSize?: number
  reportRefreshing?: boolean
}

export function prefetchInfiniteMessageStream<T>(
  queryClient: QueryClient,
  input: Pick<
    InfiniteMessageStreamOptions<T>,
    'queryKey' | 'readPage' | 'historyPageSize'
  >,
) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: infiniteMessageHistoryQueryKey(input.queryKey, input.historyPageSize),
    queryFn: ({ pageParam }) =>
      input.readPage({
        ...(pageParam ? { before: pageParam } : {}),
        ...(input.historyPageSize === undefined ? {} : { limit: input.historyPageSize }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: CursorPage<T>) =>
      page.pageInfo.hasOlder ? (page.pageInfo.oldestCursor ?? undefined) : undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: NAVIGATION_CACHE_GC_INTERVAL_MS,
  })
}

export function useInfiniteMessageStream<T>({
  streamKey,
  queryKey,
  readPage,
  getItemId,
  compareItems,
  enabled = true,
  refetchInterval = false,
  historyPageSize,
  tailPageSize = 100,
  reportRefreshing = false,
}: InfiniteMessageStreamOptions<T>) {
  const queryClient = useQueryClient()
  const queryIdentity = messageStreamSnapshotKey(queryKey)
  const historyQueryKey = useMemo(
    () => infiniteMessageHistoryQueryKey(queryKey, historyPageSize),
    [historyPageSize, queryIdentity],
  )
  const historySnapshotKey = messageStreamSnapshotKey(historyQueryKey)
  const persistedHistory = useMemo(
    () => readMessageStreamSnapshot<CursorPage<T>>(historySnapshotKey),
    [historySnapshotKey],
  )
  const readPageRef = useRef(readPage)
  readPageRef.current = readPage
  const [tailError, setTailError] = useState<Error | null>(null)
  const tailCursorRef = useRef<string | null>(null)
  const tailCountRef = useRef(0)
  const syncGenerationRef = useRef(0)

  const historyQuery = useInfiniteQuery({
    queryKey: historyQueryKey,
    queryFn: ({ pageParam }) =>
      readPageRef.current({
        ...(pageParam ? { before: pageParam } : {}),
        ...(historyPageSize === undefined ? {} : { limit: historyPageSize }),
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
    gcTime: NAVIGATION_CACHE_GC_INTERVAL_MS,
  })

  const headQuery = useQuery({
    queryKey: [...queryKey, 'head'],
    // Only the newest logical record can still be mutable. Polling the full
    // history page repeatedly reparses every completed turn while the user is
    // scrolling, which is especially expensive for Assistant turns containing
    // many runtime events. New records are still collected through the cursor
    // walk below.
    queryFn: () => readPageRef.current({ limit: 1 }),
    enabled: enabled && historyQuery.data !== undefined,
    refetchInterval: enabled ? refetchInterval : false,
    notifyOnChangeProps: reportRefreshing
      ? REFRESHING_QUERY_NOTIFY_PROPS
      : STABLE_QUERY_NOTIFY_PROPS,
  })

  useEffect(() => {
    syncGenerationRef.current += 1
    setTailError(null)
    tailCursorRef.current = null
    tailCountRef.current = 0
  }, [streamKey])

  useEffect(() => {
    const initialPage = historyQuery.data?.pages[0]
    if (!initialPage || tailCursorRef.current) return
    tailCursorRef.current = initialPage.pageInfo.newestCursor
    tailCountRef.current = initialPage.pageInfo.totalCount
  }, [historyQuery.data])

  useEffect(() => {
    const head = headQuery.data
    if (!head) return
    const generation = ++syncGenerationRef.current

    const synchronizeTail = async () => {
      const previousCursor = tailCursorRef.current
      const previousCount = tailCountRef.current
      const additions: T[] = []
      let nextCursor = previousCursor

      if (previousCursor && head.pageInfo.totalCount > previousCount) {
        let hasNewer = true
        while (hasNewer && nextCursor) {
          const page = await readPageRef.current({ after: nextCursor, limit: tailPageSize })
          additions.push(...page.items)
          const advancedCursor = page.pageInfo.newestCursor
          if (!advancedCursor || advancedCursor === nextCursor) break
          nextCursor = advancedCursor
          hasNewer = page.pageInfo.hasNewer
        }
      }

      if (generation !== syncGenerationRef.current) return
      if (additions.length > 0) {
        queryClient.setQueryData<InfiniteData<CursorPage<T>, string | null>>(
          historyQueryKey,
          (current) =>
            mergeTailIntoMessageHistory(current, additions, head, getItemId, compareItems),
        )
      }
      tailCursorRef.current = head.pageInfo.newestCursor ?? nextCursor
      tailCountRef.current = head.pageInfo.totalCount
      setTailError(null)
    }

    void synchronizeTail().catch((error: unknown) => {
      if (generation !== syncGenerationRef.current) return
      setTailError(error instanceof Error ? error : new Error(String(error)))
    })
  }, [
    compareItems,
    getItemId,
    headQuery.data,
    historyQueryKey,
    queryClient,
    tailPageSize,
  ])

  const items = useMemo(() => {
    const head = headQuery.data
    if (head?.pageInfo.totalCount === 0) return []
    const merged = new Map<string, T>()
    const headIds = new Set((head?.items ?? []).map(getItemId))
    const headOldest = head?.items[0]
    const keepCachedItem = (item: T) =>
      !headOldest || compareItems(item, headOldest) < 0 || headIds.has(getItemId(item))
    const pages = historyQuery.data?.pages ?? []
    for (const page of [...pages].reverse()) {
      for (const item of page.items) {
        if (keepCachedItem(item)) merged.set(getItemId(item), item)
      }
    }
    for (const item of head?.items ?? []) merged.set(getItemId(item), item)
    return [...merged.values()].sort(compareItems)
  }, [
    compareItems,
    getItemId,
    headQuery.data?.items,
    historyQuery.data?.pages,
  ])

  const oldestPage = historyQuery.data?.pages.at(-1)
  const newestPage = historyQuery.data?.pages[0]
  useEffect(() => {
    if (!newestPage) return
    const timeout = window.setTimeout(() => {
      const head = headQuery.data
      writeMessageStreamSnapshot<CursorPage<T>>(historySnapshotKey, {
        items,
        pageInfo: {
          oldestCursor: oldestPage?.pageInfo.oldestCursor ?? null,
          newestCursor: head?.pageInfo.newestCursor ?? newestPage.pageInfo.newestCursor,
          hasOlder: oldestPage?.pageInfo.hasOlder ?? false,
          hasNewer: false,
          totalCount: Math.max(
            items.length,
            head?.pageInfo.totalCount ?? newestPage.pageInfo.totalCount,
          ),
        },
      })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [headQuery.data, historySnapshotKey, items, newestPage, oldestPage])

  const loadOlder = useCallback(() => {
    if (!historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return
    void historyQuery.fetchNextPage()
  }, [historyQuery.fetchNextPage, historyQuery.hasNextPage, historyQuery.isFetchingNextPage])
  const refresh = useCallback(() => {
    void headQuery.refetch()
  }, [headQuery.refetch])

  return {
    items,
    error: (historyQuery.error ??
      (items.length === 0 ? (headQuery.error ?? tailError) : null)) as Error | null,
    isLoading: historyQuery.isLoading,
    isLoadingOlder: historyQuery.isFetchingNextPage,
    // Reading isFetching subscribes the caller to both edges of every poll.
    // Most streams do not present that state, so avoid two no-data renders per
    // interval unless a visible refresh indicator explicitly needs it.
    isRefreshing: reportRefreshing ? headQuery.isFetching : false,
    hasMoreBefore: oldestPage?.pageInfo.hasOlder ?? false,
    loadOlder,
    refresh,
  }
}
