import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CursorPage } from './apiTypes'
import type { CursorPageRequest } from './apiClient'

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
  const readPageRef = useRef(readPage)
  readPageRef.current = readPage
  const [tailState, setTailState] = useState<{ streamKey: string; items: T[] }>({
    streamKey,
    items: [],
  })
  const [tailError, setTailError] = useState<Error | null>(null)
  const tailCursorRef = useRef<string | null>(null)
  const tailCountRef = useRef(0)
  const syncGenerationRef = useRef(0)

  const historyQuery = useInfiniteQuery({
    queryKey: [...queryKey, 'history', historyPageSize ?? 'default'],
    queryFn: ({ pageParam }) =>
      readPageRef.current({
        ...(pageParam ? { before: pageParam } : {}),
        ...(historyPageSize === undefined ? {} : { limit: historyPageSize }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.pageInfo.hasOlder ? (page.pageInfo.oldestCursor ?? undefined) : undefined,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
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
  })

  useEffect(() => {
    syncGenerationRef.current += 1
    setTailState({ streamKey, items: [] })
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
        setTailState((current) => ({
          streamKey,
          items: mergeItems(
            current.streamKey === streamKey ? current.items : [],
            additions,
            getItemId,
            compareItems,
          ),
        }))
      }
      tailCursorRef.current = head.pageInfo.newestCursor ?? nextCursor
      tailCountRef.current = head.pageInfo.totalCount
      setTailError(null)
    }

    void synchronizeTail().catch((error: unknown) => {
      if (generation !== syncGenerationRef.current) return
      setTailError(error instanceof Error ? error : new Error(String(error)))
    })
  }, [compareItems, getItemId, headQuery.data, tailPageSize])

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
    const tailItems = tailState.streamKey === streamKey ? tailState.items : []
    for (const item of tailItems) {
      if (keepCachedItem(item)) merged.set(getItemId(item), item)
    }
    for (const item of head?.items ?? []) merged.set(getItemId(item), item)
    return [...merged.values()].sort(compareItems)
  }, [
    compareItems,
    getItemId,
    headQuery.data?.items,
    historyQuery.data?.pages,
    streamKey,
    tailState,
  ])

  const oldestPage = historyQuery.data?.pages.at(-1)
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

function mergeItems<T>(
  current: T[],
  incoming: T[],
  getItemId: (item: T) => string,
  compareItems: (left: T, right: T) => number,
) {
  const merged = new Map(current.map((item) => [getItemId(item), item]))
  for (const item of incoming) merged.set(getItemId(item), item)
  return [...merged.values()].sort(compareItems)
}
