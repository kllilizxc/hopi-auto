import { expect, test } from 'bun:test'
import {
  readAssistantFeedChanges,
  readState,
  requireGoalRouteDetail,
  updateAgentSettings,
} from './apiClient'

test('turns a transport failure into an actionable backend recovery message', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch

  try {
    await expect(readState()).rejects.toThrow(
      'Cannot reach the HOPI backend. Check that it is running, then retry.',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects incomplete Goal Route projections instead of inventing graph or Attention facts', () => {
  expect(() =>
    requireGoalRouteDetail({
      projectId: 'P-1',
      goal: { id: 'G-1' },
      works: [],
      projectAttention: null,
    }),
  ).toThrow('Goal route projection is incomplete')

  const projection = {
    projectId: 'P-1',
    goal: { id: 'G-1' },
    works: [],
    route: { nodes: [], edges: [] },
    attentions: [],
    projectAttention: null,
  }
  expect(requireGoalRouteDetail(projection)).toBe(projection)
})

test('requests mutable Assistant changes from the independent synchronization cursor', async () => {
  const originalFetch = globalThis.fetch
  let observed: RequestInfo | URL | null = null
  globalThis.fetch = (async (input) => {
    observed = input
    return Response.json({
      items: [],
      removedIds: [],
      requests: [],
      activity: null,
      syncCursor: null,
      streamId: 'stream-1',
    })
  }) as typeof fetch

  try {
    await readAssistantFeedChanges('2026-07-16T12:00:00.000Z', 'P-1', 'stream-1')
  } finally {
    globalThis.fetch = originalFetch
  }

  expect(observed).toBe(
    '/api/assistant/feed/changes?cursor=2026-07-16T12%3A00%3A00.000Z&projectId=P-1&streamId=stream-1',
  )
})

test('updates one runtime agent through the unified agent settings API', async () => {
  const originalFetch = globalThis.fetch
  let observed: { input: RequestInfo | URL; init?: RequestInit } | null = null
  globalThis.fetch = (async (input, init) => {
    observed = { input, init }
    return Response.json({ home: { agentCodingDefaults: {} } })
  }) as typeof fetch

  try {
    await updateAgentSettings('worker', {
      transport: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  expect(observed?.input).toBe('/api/agents/worker/settings')
  expect(observed?.init?.method).toBe('PATCH')
  expect(JSON.parse(String(observed?.init?.body))).toEqual({
    codingDefaults: {
      transport: 'codex',
      model: 'gpt-5.5',
      reasoningEffort: 'high',
    },
  })
})
