import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { AssistantFeedChanges, AssistantFeedPage, CursorPage } from './apiTypes'
import { infiniteMessageHistoryQueryKey } from './queryKeys'
import {
  createSessionSnapshotCache,
  type SessionSnapshot,
  type SessionSnapshotStorage,
} from './sessionSnapshotCache'

export const MESSAGE_STREAM_CACHE_MAX_ENTRIES = 12
export const MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS = 750_000
export const MESSAGE_STREAM_CACHE_MAX_TOTAL_CHARACTERS = 3_000_000

export type MessageStreamSnapshot<T> = SessionSnapshot<T>
export type MessageStreamStorage = SessionSnapshotStorage

const messageStreamCache = createSessionSnapshotCache({
  storageKey: 'hopi.message-stream-cache.v1',
  version: 1,
  maxEntries: MESSAGE_STREAM_CACHE_MAX_ENTRIES,
  maxEntryCharacters: MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS,
  maxTotalCharacters: MESSAGE_STREAM_CACHE_MAX_TOTAL_CHARACTERS,
})

export function initializeMessageStreamCache() {
  return messageStreamCache.available()
}

export function messageStreamSnapshotKey(queryKey: readonly unknown[]) {
  return JSON.stringify(queryKey)
}

export function hydrateInfiniteMessageStreamSnapshot<T>(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  historyPageSize?: number,
) {
  const historyQueryKey = infiniteMessageHistoryQueryKey(queryKey, historyPageSize)
  if (queryClient.getQueryData(historyQueryKey) !== undefined) return true
  const snapshot = readMessageStreamSnapshot<CursorPage<T>>(
    messageStreamSnapshotKey(historyQueryKey),
  )
  if (!snapshot) return false
  queryClient.setQueryData<InfiniteData<CursorPage<T>, string | null>>(
    historyQueryKey,
    { pages: [snapshot.value], pageParams: [null] },
    { updatedAt: snapshot.savedAt },
  )
  return true
}

export function mergeTailIntoMessageHistory<T>(
  current: InfiniteData<CursorPage<T>, string | null> | undefined,
  additions: T[],
  head: CursorPage<T>,
  getItemId: (item: T) => string,
  compareItems: (left: T, right: T) => number,
) {
  const newestPage = current?.pages[0]
  if (!current || !newestPage || additions.length === 0) return current
  const merged = new Map(newestPage.items.map((item) => [getItemId(item), item]))
  for (const item of additions) merged.set(getItemId(item), item)
  return {
    ...current,
    pages: [
      {
        ...newestPage,
        items: [...merged.values()].sort(compareItems),
        pageInfo: {
          ...newestPage.pageInfo,
          newestCursor: head.pageInfo.newestCursor ?? newestPage.pageInfo.newestCursor,
          hasNewer: false,
          totalCount: head.pageInfo.totalCount,
        },
      },
      ...current.pages.slice(1),
    ],
  } satisfies InfiniteData<CursorPage<T>, string | null>
}

export function mergeAssistantChangesIntoHistory(
  current: InfiniteData<AssistantFeedPage, string | null> | undefined,
  changes: AssistantFeedChanges,
) {
  const newestPage = current?.pages[0]
  if (!current || !newestPage) return current
  if (newestPage.streamId !== changes.streamId) {
    return {
      pages: [
        {
          items: changes.items,
          requests: changes.requests,
          activity: changes.activity,
          syncCursor: changes.syncCursor,
          streamId: changes.streamId,
          pageInfo: {
            oldestCursor: null,
            newestCursor: null,
            hasOlder: false,
            hasNewer: false,
            totalCount: changes.items.length,
          },
        },
      ],
      pageParams: [null],
    }
  }
  const removed = new Set(changes.removedIds)
  const existingIds = new Set(current.pages.flatMap((page) => page.items.map((entry) => entry.id)))
  const removedCount = changes.removedIds.filter((id) => existingIds.has(id)).length
  const addedCount = changes.items.filter((entry) => !existingIds.has(entry.id)).length
  const pages = current.pages.map((page) => ({
    ...page,
    items: page.items.filter((entry) => !removed.has(entry.id)),
  }))
  const merged = new Map(pages[0].items.map((entry) => [entry.id, entry]))
  for (const entry of changes.items) merged.set(entry.id, entry)
  for (const id of changes.removedIds) merged.delete(id)
  pages[0] = {
    ...pages[0],
    items: [...merged.values()].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
    ),
    requests: changes.requests ?? pages[0].requests ?? [],
    activity: changes.activity,
    syncCursor: changes.syncCursor,
    streamId: changes.streamId,
    pageInfo: {
      ...pages[0].pageInfo,
      hasNewer: false,
      totalCount: Math.max(0, pages[0].pageInfo.totalCount - removedCount + addedCount),
    },
  }
  return { ...current, pages } satisfies InfiniteData<AssistantFeedPage, string | null>
}

export function readMessageStreamSnapshot<T>(
  key: string,
  storage?: MessageStreamStorage | null,
): MessageStreamSnapshot<T> | null {
  return messageStreamCache.read<T>(key, storage)
}

export function writeMessageStreamSnapshot<T>(
  key: string,
  value: T,
  storage?: MessageStreamStorage | null,
  savedAt = Date.now(),
) {
  return messageStreamCache.write(key, value, storage, savedAt)
}
