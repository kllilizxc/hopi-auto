import { expect, test } from 'bun:test'
import type { AssistantFeedEntry, AssistantFeedPage } from './apiTypes'
import { mergeAssistantChangesIntoHistory } from './messageStreamCache'
import {
  type AssistantFeedSyncState,
  assistantFeedSyncStateForScope,
  mergeAssistantFeedEntries,
} from './useAssistantFeedStream'

test('merges mutable Assistant entries by identity instead of only replacing the newest tail', () => {
  const current = [
    eventEntry('event:EV-A', '2026-07-16T09:00:00.000Z', 'running'),
    eventEntry('event:EV-B', '2026-07-16T09:01:00.000Z', 'queued'),
  ]
  const completedA = eventEntry('event:EV-A', '2026-07-16T09:00:00.000Z', 'completed')

  const merged = mergeAssistantFeedEntries(current, [completedA])

  expect(merged.map((entry) => entry.id)).toEqual(['event:EV-A', 'event:EV-B'])
  expect(merged[0]).toBe(completedA)
  expect(merged[0]?.kind === 'event' ? merged[0].event.runtimeStatus : null).toBe('completed')
})

test('removes a standalone projection after it is absorbed into another conversation entry', () => {
  const standalone = {
    kind: 'completion',
    id: 'completion:project:P-1/goal:G-1/attention:A-complete',
    occurredAt: '2026-07-16T09:00:00.000Z',
    attention: {},
  } as AssistantFeedEntry

  expect(mergeAssistantFeedEntries([standalone], [], [standalone.id])).toEqual([])
})

test('retains Assistant changes in cached history for the next mount', () => {
  const removed = eventEntry('event:removed', '2026-07-16T09:00:00.000Z', 'completed')
  const added = eventEntry('event:added', '2026-07-16T09:01:00.000Z', 'running')
  const page: AssistantFeedPage = {
    items: [removed],
    requests: [],
    activity: null,
    syncCursor: 'old-sync',
    pageInfo: {
      oldestCursor: 'before-old',
      newestCursor: 'after-old',
      hasOlder: false,
      hasNewer: false,
      totalCount: 1,
    },
  }

  const merged = mergeAssistantChangesIntoHistory(
    { pages: [page], pageParams: [null] },
    {
      items: [added],
      removedIds: [removed.id],
      requests: [{ eventId: 'EV-request', attentions: [] }],
      activity: { phase: 'working' },
      syncCursor: 'new-sync',
    },
  )

  expect(merged?.pages[0]?.items).toEqual([added])
  expect(merged?.pages[0]?.activity).toEqual({ phase: 'working' })
  expect(merged?.pages[0]?.requests).toEqual([{ eventId: 'EV-request', attentions: [] }])
  expect(merged?.pages[0]?.syncCursor).toBe('new-sync')
})

test('drops all in-memory Feed state when the Assistant scope changes', () => {
  const projectAState: AssistantFeedSyncState = {
    scopeKey: 'project-a',
    initialized: true,
    items: [eventEntry('event-a', '2026-07-24T10:00:00.000Z', 'running')],
    removedIds: ['old-event-a'],
    requests: [{ eventId: 'event-a', attentions: [] }],
    activity: { phase: 'working' },
  }

  expect(assistantFeedSyncStateForScope(projectAState, 'project-a')).toBe(projectAState)
  expect(assistantFeedSyncStateForScope(projectAState, 'project-b')).toEqual({
    scopeKey: 'project-b',
    initialized: false,
    items: [],
    removedIds: [],
    requests: [],
    activity: null,
  })
})

function eventEntry(
  id: string,
  occurredAt: string,
  runtimeStatus: 'queued' | 'running' | 'completed',
) {
  return {
    kind: 'event',
    id,
    occurredAt,
    event: { runtimeStatus },
    completion: null,
  } as AssistantFeedEntry
}
