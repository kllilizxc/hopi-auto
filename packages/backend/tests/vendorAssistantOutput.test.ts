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

  test('uses a Codex terminal turn error instead of unrelated stderr warnings', () => {
    expect(
      parseVendorAssistantOutput(
        'codex',
        JSON.stringify({
          type: 'turn.failed',
          error: {
            message: 'stream disconnected before completion: error sending request for responses',
          },
        }),
      ),
    ).toEqual({
      terminalError: {
        message: 'stream disconnected before completion: error sending request for responses',
        sessionInvalid: false,
      },
    })
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

  test('removes a complete Claude thought envelope from the final reply', () => {
    expect(
      parseVendorAssistantOutput(
        'claude',
        JSON.stringify({
          type: 'result',
          session_id: 'session-1',
          result: '<thought>Internal reasoning.</thought>\nVisible answer.',
        }),
      ),
    ).toEqual({ sessionId: 'session-1', finalText: 'Visible answer.' })
  })

  test('rejects a malformed Claude thought envelope instead of exposing reasoning', () => {
    expect(
      parseVendorAssistantOutput(
        'claude',
        JSON.stringify({
          type: 'result',
          session_id: 'session-1',
          result: '<thought\nInternal reasoning followed by an indistinguishable answer.',
        }),
      ),
    ).toEqual({
      sessionId: 'session-1',
      terminalError: {
        message: 'Claude returned a malformed thought envelope instead of a separable final reply.',
        sessionInvalid: false,
      },
    })
  })

  test('treats a Claude error result as terminal even when its subtype says success', () => {
    expect(
      parseVendorAssistantOutput(
        'claude',
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: true,
          api_error_status: 429,
          terminal_reason: 'api_error',
          session_id: 'session-1',
          result: 'Daily provider allocation exceeded.',
        }),
      ),
    ).toEqual({
      sessionId: 'session-1',
      terminalError: {
        message: 'Daily provider allocation exceeded.',
        status: 429,
        terminalReason: 'api_error',
        sessionInvalid: false,
      },
    })
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
