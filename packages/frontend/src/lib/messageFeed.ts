import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { MessageFeedItem, MessageFeedPage, MessageFeedStreamEvent } from './api'

export function mergeMessageFeedItems(...sources: MessageFeedItem[][]) {
  const flattened = sources.flat()
  const order: string[] = []
  const byId = new Map<string, MessageFeedItem>()
  const assistantDeltaIdByMergeKey = new Map<string, string>()

  for (const item of flattened) {
    if (!byId.has(item.id)) {
      order.push(item.id)
    }
    byId.set(item.id, item)

    if (item.kind === 'assistant_delta' && item.mergeKey) {
      assistantDeltaIdByMergeKey.set(item.mergeKey, item.id)
      continue
    }

    if (item.mergeKey) {
      const deltaId = assistantDeltaIdByMergeKey.get(item.mergeKey)
      if (deltaId && deltaId !== item.id) {
        byId.delete(deltaId)
      }
    }
  }

  return order
    .map((id) => byId.get(id))
    .filter((item): item is MessageFeedItem => Boolean(item))
    .sort(compareFeedItems)
}

export function useMessageFeed(options: {
  enabled: boolean
  queryKey: readonly unknown[]
  loadPage: (before?: string) => Promise<MessageFeedPage>
  openStream: (after?: string) => EventSource
}) {
  const { enabled, queryKey, loadPage, openStream } = options
  const [liveItems, setLiveItems] = useState<MessageFeedItem[]>([])
  const queryKeyHash = useMemo(() => JSON.stringify(queryKey), [queryKey])

  const query = useInfiniteQuery<MessageFeedPage, Error>({
    queryKey,
    queryFn: async ({ pageParam }) => loadPage(asOptionalCursor(pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: () => undefined,
    getPreviousPageParam: (page) => (page.hasMoreBefore ? page.oldestCursor : undefined),
    enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const pages = query.data?.pages ?? []
  const persistedItems = useMemo(
    () => mergeMessageFeedItems(...pages.map((page) => page.items)),
    [pages],
  )
  const newestCursor = pages.at(-1)?.newestCursor

  useEffect(() => {
    setLiveItems([])
  }, [enabled, queryKeyHash])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    const eventSource = openStream(newestCursor)
    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as MessageFeedStreamEvent
      const item = payload.item
      if (payload.type !== 'item' || !item) {
        return
      }

      setLiveItems((current) => mergeMessageFeedItems(current, [item]))
    }

    return () => eventSource.close()
  }, [enabled, newestCursor, openStream])

  return {
    ...query,
    items: useMemo(
      () => mergeMessageFeedItems(persistedItems, liveItems),
      [liveItems, persistedItems],
    ),
    hasMoreBefore: pages[0]?.hasMoreBefore ?? false,
    fetchOlder: query.fetchPreviousPage,
    isFetchingOlder: query.isFetchingPreviousPage,
  }
}

function compareFeedItems(left: MessageFeedItem, right: MessageFeedItem) {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }

  return left.id.localeCompare(right.id)
}

function asOptionalCursor(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
