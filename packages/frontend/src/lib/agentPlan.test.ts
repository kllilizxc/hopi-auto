import { describe, expect, test } from 'bun:test'
import type { RunAttemptEvent } from './apiTypes'
import { latestAgentPlan } from './agentPlan'

describe('latestAgentPlan', () => {
  test('replaces an earlier plan instead of merging retries or revisions', () => {
    const events: RunAttemptEvent[] = [
      planEvent('plan-1', 'Old step', false),
      {
        eventId: 'message-1',
        createdAt: '2026-07-17T10:00:01.000Z',
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: 'Revising the approach.',
      },
      planEvent('plan-2', 'Replacement step', true),
    ]

    expect(latestAgentPlan(events)).toMatchObject({
      planId: 'plan-2',
      items: [{ text: 'Replacement step', completed: true }],
    })
  })

  test('returns null when an Attempt has no normalized plan', () => {
    expect(latestAgentPlan([])).toBeNull()
  })
})

function planEvent(planId: string, text: string, completed: boolean): RunAttemptEvent {
  return {
    eventId: `event-${planId}`,
    createdAt: '2026-07-17T10:00:00.000Z',
    kind: 'plan',
    transport: 'codex',
    planId,
    status: 'active',
    items: [{ text, completed }],
  }
}
