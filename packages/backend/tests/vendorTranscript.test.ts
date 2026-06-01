import { describe, expect, test } from 'bun:test'
import { normalizeProcessOutputLine } from '../src/agent/vendorTranscript'

describe('normalizeProcessOutputLine', () => {
  test('normalizes Codex JSONL agent messages and tool interactions with invocation keys', () => {
    const assistant = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        method: 'item/completed',
        params: {
          item: {
            type: 'agent_message',
            text: 'Implemented the runtime patch',
          },
        },
      }),
    })

    const tool = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        method: 'item/completed',
        params: {
          item: {
            type: 'local_shell_call',
            tool_name: 'Bash',
            call_id: 'shell-1',
            command: 'bun test packages/backend/tests/server.test.ts',
          },
        },
      }),
    })
    const toolResult = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        method: 'item/completed',
        params: {
          item: {
            type: 'local_shell_call_output',
            tool_name: 'Bash',
            call_id: 'shell-1',
            content: 'Command completed successfully.',
          },
        },
      }),
    })

    expect(assistant).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'assistant',
        summary: 'Implemented the runtime patch',
        vendorEventType: 'item/completed',
      },
    ])
    expect(tool).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        toolName: 'Bash',
        toolInvocationKey: 'shell-1',
        summary: 'Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
        vendorEventType: 'item/completed',
      },
    ])
    expect(toolResult).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_result',
        toolName: 'Bash',
        toolInvocationKey: 'shell-1',
        summary: 'Command completed successfully.',
        vendorEventType: 'item/completed',
      },
    ])
  })

  test('normalizes Claude stream-json assistant text, tool use, and tool result blocks', () => {
    const assistant = normalizeProcessOutputLine({
      format: 'claude_stream_json',
      stream: 'stdout',
      role: 'reviewer',
      line: JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Reviewed the generated patch.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: 'src/server.ts' },
            },
          ],
        },
      }),
    })

    const toolResult = normalizeProcessOutputLine({
      format: 'claude_stream_json',
      stream: 'stdout',
      role: 'reviewer',
      line: JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'File contents loaded.' },
          ],
        },
      }),
    })

    expect(assistant).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'assistant',
        summary: 'Reviewed the generated patch.',
        vendorEventType: 'assistant',
      },
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'tool_call',
        toolName: 'Read',
        toolInvocationKey: 'toolu_1',
        summary: 'Tool call: Read (src/server.ts)',
        vendorEventType: 'assistant',
      },
    ])
    expect(toolResult).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'tool_result',
        toolInvocationKey: 'toolu_1',
        summary: 'File contents loaded.',
        vendorEventType: 'user',
      },
    ])
  })

  test('normalizes OpenCode JSON events with conservative assistant and tool heuristics', () => {
    const assistant = normalizeProcessOutputLine({
      format: 'opencode_json',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'assistant',
        content: [{ type: 'text', text: 'Applied the UI change.' }],
      }),
    })

    const tool = normalizeProcessOutputLine({
      format: 'opencode_json',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'tool_use',
        name: 'edit',
        callId: 'edit-1',
        input: { filePath: 'src/modal.tsx' },
      }),
    })
    const toolResult = normalizeProcessOutputLine({
      format: 'opencode_json',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'tool_result',
        name: 'edit',
        callId: 'edit-1',
        content: 'Applied the UI change to the modal.',
      }),
    })

    expect(assistant).toEqual([
      {
        kind: 'transcript',
        transport: 'opencode',
        entryKind: 'assistant',
        summary: 'Applied the UI change.',
        vendorEventType: 'assistant',
      },
    ])
    expect(tool).toEqual([
      {
        kind: 'transcript',
        transport: 'opencode',
        entryKind: 'tool_call',
        toolName: 'edit',
        toolInvocationKey: 'edit-1',
        summary: 'Tool call: edit (src/modal.tsx)',
        vendorEventType: 'tool_use',
      },
    ])
    expect(toolResult).toEqual([
      {
        kind: 'transcript',
        transport: 'opencode',
        entryKind: 'tool_result',
        toolName: 'edit',
        toolInvocationKey: 'edit-1',
        summary: 'Applied the UI change to the modal.',
        vendorEventType: 'tool_result',
      },
    ])
  })

  test('converts stderr on built-in vendor transports into transcript error entries', () => {
    const entries = normalizeProcessOutputLine({
      format: 'claude_stream_json',
      stream: 'stderr',
      role: 'reviewer',
      line: 'authentication failed',
    })

    expect(entries).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'error',
        summary: 'authentication failed',
      },
    ])
  })
})
