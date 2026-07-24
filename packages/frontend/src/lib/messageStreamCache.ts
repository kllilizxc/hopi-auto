import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { AssistantFeedChanges, AssistantFeedPage, CursorPage } from './apiTypes'
import { infiniteMessageHistoryQueryKey } from './queryKeys'

const CACHE_VERSION = 1
const CACHE_INDEX_KEY = 'hopi.message-stream-cache.v1.index'
const CACHE_ENTRY_PREFIX = 'hopi.message-stream-cache.v1.entry.'

export const MESSAGE_STREAM_CACHE_MAX_ENTRIES = 12
export const MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS = 750_000
export const MESSAGE_STREAM_CACHE_MAX_TOTAL_CHARACTERS = 3_000_000

export interface MessageStreamSnapshot<T> {
  savedAt: number
  value: T
}

export interface MessageStreamStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface CacheIndexEntry {
  key: string
  savedAt: number
  size: number
}

interface CacheEntry<T> extends MessageStreamSnapshot<T> {
  version: typeof CACHE_VERSION
  key: string
}

export function initializeMessageStreamCache() {
  return browserSessionStorage() !== null
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
  storage: MessageStreamStorage | null = browserSessionStorage(),
): MessageStreamSnapshot<T> | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(cacheEntryKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheEntry<T>>
    if (
      parsed.version !== CACHE_VERSION ||
      parsed.key !== key ||
      typeof parsed.savedAt !== 'number' ||
      !('value' in parsed)
    ) {
      return null
    }
    return { savedAt: parsed.savedAt, value: parsed.value as T }
  } catch {
    return null
  }
}

export function writeMessageStreamSnapshot<T>(
  key: string,
  value: T,
  storage: MessageStreamStorage | null = browserSessionStorage(),
  savedAt = Date.now(),
) {
  if (!storage) return false

  let serialized: string
  try {
    serialized = JSON.stringify({ version: CACHE_VERSION, key, savedAt, value })
  } catch {
    return false
  }
  if (serialized.length > MESSAGE_STREAM_CACHE_MAX_ENTRY_CHARACTERS) return false

  const current: CacheIndexEntry = { key, savedAt, size: serialized.length }
  const entries = [
    current,
    ...readCacheIndex(storage)
      .filter((entry) => entry.key !== key)
      .sort((left, right) => right.savedAt - left.savedAt),
  ]
  let total = entries.reduce((sum, entry) => sum + entry.size, 0)
  while (
    entries.length > MESSAGE_STREAM_CACHE_MAX_ENTRIES ||
    total > MESSAGE_STREAM_CACHE_MAX_TOTAL_CHARACTERS
  ) {
    const removed = entries.pop()
    if (!removed || removed.key === key) return false
    total -= removed.size
    safelyRemove(storage, removed.key)
  }

  while (true) {
    try {
      storage.setItem(cacheEntryKey(key), serialized)
      break
    } catch {
      const removed = entries.pop()
      if (!removed || removed.key === key) return false
      safelyRemove(storage, removed.key)
    }
  }

  try {
    storage.setItem(CACHE_INDEX_KEY, JSON.stringify(entries))
    return true
  } catch {
    safelyRemove(storage, key)
    return false
  }
}

function browserSessionStorage(): MessageStreamStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function cacheEntryKey(key: string) {
  return `${CACHE_ENTRY_PREFIX}${encodeURIComponent(key)}`
}

function readCacheIndex(storage: MessageStreamStorage): CacheIndexEntry[] {
  try {
    const raw = storage.getItem(CACHE_INDEX_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is CacheIndexEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.key === 'string' &&
        typeof entry.savedAt === 'number' &&
        typeof entry.size === 'number' &&
        entry.size >= 0,
    )
  } catch {
    return []
  }
}

function safelyRemove(storage: MessageStreamStorage, key: string) {
  try {
    storage.removeItem(cacheEntryKey(key))
  } catch {
    // A cache that cannot be written or evicted is simply ignored.
  }
}
