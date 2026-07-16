import { expect, test } from 'bun:test'
import { readAssistantFeedChanges, requestPreviewRepair } from './apiClient'

test('sends the viewed Goal context with a Preview repair instruction', async () => {
  const originalFetch = globalThis.fetch
  let observed: { input: RequestInfo | URL; init?: RequestInit } | null = null
  globalThis.fetch = (async (input, init) => {
    observed = { input, init }
    return Response.json({ eventId: 'EV-repair' })
  }) as typeof fetch

  try {
    await requestPreviewRepair('Repair Preview', { projectId: 'P-1', goalId: 'G-1' })
  } finally {
    globalThis.fetch = originalFetch
  }

  expect(observed?.input).toBe('/api/preview/repair')
  expect(observed?.init?.method).toBe('POST')
  expect(JSON.parse(String(observed?.init?.body))).toEqual({
    prompt: 'Repair Preview',
    context: { projectId: 'P-1', goalId: 'G-1' },
  })
})

test('requests mutable Assistant changes from the independent synchronization cursor', async () => {
  const originalFetch = globalThis.fetch
  let observed: RequestInfo | URL | null = null
  globalThis.fetch = (async (input) => {
    observed = input
    return Response.json({ items: [], removedIds: [], activity: null, syncCursor: null })
  }) as typeof fetch

  try {
    await readAssistantFeedChanges('2026-07-16T12:00:00.000Z')
  } finally {
    globalThis.fetch = originalFetch
  }

  expect(observed).toBe(
    '/api/assistant/feed/changes?cursor=2026-07-16T12%3A00%3A00.000Z',
  )
})
