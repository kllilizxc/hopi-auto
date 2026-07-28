import type { Query, QueryClient } from '@tanstack/react-query'
import { NAVIGATION_CACHE_GC_INTERVAL_MS } from './queryPerformance'
import { type SessionSnapshotStorage, createSessionSnapshotCache } from './sessionSnapshotCache'

export const NAVIGATION_CACHE_MAX_ENTRIES = 24
export const NAVIGATION_CACHE_MAX_ENTRY_CHARACTERS = 750_000
export const NAVIGATION_CACHE_MAX_TOTAL_CHARACTERS = 3_000_000
export const NAVIGATION_CACHE_WRITE_INTERVAL_MS = 5_000

const navigationCache = createSessionSnapshotCache({
  storageKey: 'hopi.navigation-cache',
  maxEntries: NAVIGATION_CACHE_MAX_ENTRIES,
  maxEntryCharacters: NAVIGATION_CACHE_MAX_ENTRY_CHARACTERS,
  maxTotalCharacters: NAVIGATION_CACHE_MAX_TOTAL_CHARACTERS,
})

export function navigationSnapshotKey(queryKey: readonly unknown[]) {
  return JSON.stringify(queryKey)
}

export function isNavigationQueryKey(queryKey: readonly unknown[]) {
  if (queryKey.length === 1 && queryKey[0] === 'mvp-state') return true
  return (
    queryKey.length === 4 &&
    queryKey[0] === 'mvp-goal' &&
    typeof queryKey[1] === 'string' &&
    queryKey[1].length > 0 &&
    typeof queryKey[2] === 'string' &&
    queryKey[2].length > 0 &&
    (queryKey[3] === 'board' || queryKey[3] === 'docs')
  )
}

export function hydrateNavigationCache(
  queryClient: QueryClient,
  storage?: SessionSnapshotStorage | null,
  now = Date.now(),
) {
  let hydrated = 0
  for (const { key, snapshot } of navigationCache.readAll<unknown>(storage)) {
    let queryKey: unknown
    try {
      queryKey = JSON.parse(key)
    } catch {
      navigationCache.remove(key, storage)
      continue
    }
    if (
      !Array.isArray(queryKey) ||
      !isNavigationQueryKey(queryKey) ||
      !Number.isFinite(snapshot.savedAt) ||
      snapshot.savedAt <= 0 ||
      now - snapshot.savedAt > NAVIGATION_CACHE_GC_INTERVAL_MS
    ) {
      navigationCache.remove(key, storage)
      continue
    }
    queryClient.setQueryData(queryKey, snapshot.value, { updatedAt: snapshot.savedAt })
    hydrated += 1
  }
  return hydrated
}

export function persistNavigationQuery(query: Query, storage?: SessionSnapshotStorage | null) {
  if (
    !isNavigationQueryKey(query.queryKey) ||
    query.state.status !== 'success' ||
    query.state.data === undefined
  ) {
    return false
  }
  return navigationCache.write(
    navigationSnapshotKey(query.queryKey),
    query.state.data,
    storage,
    query.state.dataUpdatedAt || Date.now(),
  )
}

export function initializeNavigationCache(
  queryClient: QueryClient,
  storage?: SessionSnapshotStorage | null,
) {
  const hydrated = hydrateNavigationCache(queryClient, storage)
  const persistedAt = new Map<string, number>()
  for (const query of queryClient.getQueryCache().getAll()) {
    if (isNavigationQueryKey(query.queryKey)) {
      persistedAt.set(navigationSnapshotKey(query.queryKey), query.state.dataUpdatedAt)
    }
  }
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    const query = event.query
    if (!isNavigationQueryKey(query.queryKey) || query.state.status !== 'success') return
    const key = navigationSnapshotKey(query.queryKey)
    const updatedAt = query.state.dataUpdatedAt
    if (updatedAt <= (persistedAt.get(key) ?? 0) + NAVIGATION_CACHE_WRITE_INTERVAL_MS) {
      return
    }
    if (persistNavigationQuery(query, storage)) persistedAt.set(key, updatedAt)
  })
  return { hydrated, unsubscribe }
}
