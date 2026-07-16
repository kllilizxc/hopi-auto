import { expect, test } from 'bun:test'
import type { AssistantFeedEntry } from './apiTypes'
import { mergeAssistantFeedEntries } from './useAssistantFeedStream'

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
