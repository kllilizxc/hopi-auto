import { expect, test } from 'bun:test'
import type { AppSnapshot, GoalDetail, GoalRouteDetail, PreviewSession } from './apiTypes'
import {
  CANONICAL_POLL_INTERVAL_MS,
  DOCUMENT_POLL_INTERVAL_MS,
  documentPollInterval,
  NAVIGATION_CACHE_GC_INTERVAL_MS,
  routePollInterval,
  SETTLED_POLL_INTERVAL_MS,
  shellPollInterval,
} from './queryPerformance'

test('Route polling is responsive only while canonical state can change actively', () => {
  const shell = (activeRuns: AppSnapshot['activeRuns'], previewStatus?: PreviewSession['status']) => ({
    state: {
      data: {
        activeRuns,
        projects: previewStatus ? [{ preview: { status: previewStatus } }] : [],
      } as AppSnapshot,
    },
  })
  const route = (lifecycle: GoalRouteDetail['goal']['lifecycle']) => ({
    state: { data: { goal: { lifecycle } } as GoalRouteDetail },
  })
  const documents = (lifecycle: GoalDetail['goal']['lifecycle']) => ({
    state: { data: { goal: { lifecycle } } as GoalDetail },
  })

  expect(NAVIGATION_CACHE_GC_INTERVAL_MS).toBe(30 * 60 * 1_000)
  expect(shellPollInterval(shell([{ key: 'P/G/W', runId: 'R-1', status: 'running', requestedAt: '', startedAt: '', waitReason: null }]))).toBe(CANONICAL_POLL_INTERVAL_MS)
  expect(shellPollInterval(shell([]))).toBe(SETTLED_POLL_INTERVAL_MS)
  expect(shellPollInterval(shell([], 'starting'))).toBe(CANONICAL_POLL_INTERVAL_MS)
  expect(routePollInterval(route('active'))).toBe(CANONICAL_POLL_INTERVAL_MS)
  expect(routePollInterval(route('done'))).toBe(SETTLED_POLL_INTERVAL_MS)
  expect(documentPollInterval(documents('active'))).toBe(DOCUMENT_POLL_INTERVAL_MS)
})

test('Route and Docs use stable query notifications and split document bodies', async () => {
  const route = await Bun.file(new URL('../pages/RouteView.tsx', import.meta.url)).text()
  const docs = await Bun.file(new URL('../pages/GoalDocsPage.tsx', import.meta.url)).text()
  const api = await Bun.file(new URL('./apiClient.ts', import.meta.url)).text()

  expect(route).toContain('refetchInterval: routePollInterval')
  expect(route).toContain('notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS')
  expect(docs).toContain('queryKey: goalDocsQueryKey(projectId, goalId)')
  expect(docs).toContain('staleTime: Number.POSITIVE_INFINITY')
  expect(api).toContain('?view=route')
  expect(api).toContain('?view=docs')
})
