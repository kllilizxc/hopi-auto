import { describe, expect, test } from 'bun:test'
import { parseVendorAssistantOutput } from '../src/agent/vendorAssistantOutput'

describe('parseVendorAssistantOutput', () => {
  test('extracts Codex session IDs', () => {
    expect(
      parseVendorAssistantOutput(
        'codex',
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      ),
    ).toEqual({ sessionId: 'thread-1' })
  })

  test('extracts Claude session IDs and the complete final result', () => {
    const text = 'x'.repeat(800)
    expect(
      parseVendorAssistantOutput(
        'claude',
        JSON.stringify({ type: 'result', session_id: 'session-1', result: text }),
      ),
    ).toEqual({ sessionId: 'session-1', finalText: text })
  })

  test('extracts current OpenCode text and session identity', () => {
    expect(
      parseVendorAssistantOutput(
        'opencode',
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_1',
          part: { messageID: 'msg-1', type: 'text', text: 'Done.' },
        }),
      ),
    ).toEqual({ sessionId: 'ses_1', messageId: 'msg-1', assistantText: 'Done.' })
  })
})
