import { expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import {
  hydrateNavigationCache,
  initializeNavigationCache,
  isNavigationQueryKey,
  persistNavigationQuery,
} from './navigationCache'
import { NAVIGATION_CACHE_GC_INTERVAL_MS } from './queryPerformance'
import type { SessionSnapshotStorage } from './sessionSnapshotCache'

class MemoryStorage implements SessionSnapshotStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

test('hydrates only exact shell and Goal projection identities with their canonical age', () => {
  const storage = new MemoryStorage()
  const source = new QueryClient()
  const savedAt = 10_000
  const shellKey = ['mvp-state'] as const
  const boardKey = ['mvp-goal', 'project-a', 'goal-a', 'board'] as const
  const unrelatedKey = ['work-attempts', 'project-a', 'goal-a', 'work-a'] as const

  source.setQueryData(shellKey, { projects: ['project-a'] }, { updatedAt: savedAt })
  source.setQueryData(boardKey, { goal: 'goal-a' }, { updatedAt: savedAt })
  source.setQueryData(unrelatedKey, { attempts: [] }, { updatedAt: savedAt })
  for (const query of source.getQueryCache().getAll()) persistNavigationQuery(query, storage)

  const target = new QueryClient()
  expect(hydrateNavigationCache(target, storage, savedAt + 1)).toBe(2)
  expect(target.getQueryData(shellKey)).toEqual({ projects: ['project-a'] })
  expect(target.getQueryData(boardKey)).toEqual({ goal: 'goal-a' })
  expect(target.getQueryData(unrelatedKey)).toBeUndefined()
  expect(target.getQueryState(boardKey)?.dataUpdatedAt).toBe(savedAt)
})

test('drops expired projections instead of presenting them as current navigation state', () => {
  const storage = new MemoryStorage()
  const source = new QueryClient()
  const boardKey = ['mvp-goal', 'project-a', 'goal-a', 'board'] as const
  source.setQueryData(boardKey, { goal: 'old' }, { updatedAt: 1 })
  const query = source.getQueryCache().find({ queryKey: boardKey, exact: true })
  expect(query && persistNavigationQuery(query, storage)).toBe(true)

  const target = new QueryClient()
  expect(hydrateNavigationCache(target, storage, NAVIGATION_CACHE_GC_INTERVAL_MS + 2)).toBe(0)
  expect(target.getQueryData(boardKey)).toBeUndefined()
})

test('persists successful navigation reads without widening the cache scope', () => {
  const storage = new MemoryStorage()
  const source = new QueryClient()
  const subscription = initializeNavigationCache(source, storage)
  const docsKey = ['mvp-goal', 'project-a', 'goal-a', 'docs'] as const
  const unrelatedKey = ['assistant-feed', 'project-a'] as const

  source.setQueryData(docsKey, { goal: 'goal-a' })
  source.setQueryData(unrelatedKey, { messages: ['private stream'] })
  subscription.unsubscribe()

  const target = new QueryClient()
  expect(hydrateNavigationCache(target, storage)).toBe(1)
  expect(target.getQueryData(docsKey)).toEqual({ goal: 'goal-a' })
  expect(target.getQueryData(unrelatedKey)).toBeUndefined()
  expect(isNavigationQueryKey(['mvp-goal', 'project-a', 'goal-b', 'board'])).toBe(true)
  expect(isNavigationQueryKey(['mvp-goal', 'project-a', undefined, 'board'])).toBe(false)
})
