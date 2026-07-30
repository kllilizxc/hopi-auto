import { describe, expect, test } from 'bun:test'
import { createAssistantToolCapabilityRegistry } from '../src/assistant/assistantToolCapabilityRegistry'
import { AssistantToolRequestError } from '../src/assistant/assistantToolRequestError'

describe('Assistant tool capability registry', () => {
  test('binds an opaque token to exactly one Inbox turn', () => {
    const registry = createAssistantToolCapabilityRegistry(() => 1_000)
    const token = registry.issue('EV-1')

    expect(token).not.toBe('EV-1')
    expect(registry.requireEventId(token)).toBe('EV-1')
  })

  test('revokes and expires capabilities without retaining an accepted token', () => {
    let now = 1_000
    const registry = createAssistantToolCapabilityRegistry(() => now)
    const revoked = registry.issue('EV-revoked')
    registry.revoke(revoked)

    expect(() => registry.requireEventId(revoked)).toThrow(AssistantToolRequestError)

    const expired = registry.issue('EV-expired')
    now += 60 * 60 * 1_000 + 1
    expect(() => registry.requireEventId(expired)).toThrow(AssistantToolRequestError)
    expect(() => registry.requireEventId(expired)).toThrow(AssistantToolRequestError)
  })
})
