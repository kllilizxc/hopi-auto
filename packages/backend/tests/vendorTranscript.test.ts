import { describe, expect, test } from 'bun:test'
import { normalizeProcessOutputLine } from '../src/agent/vendorTranscript'

describe('normalizeProcessOutputLine', () => {
  test('normalizes Codex JSONL agent messages and tool calls into transcript events', () => {
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
        summary: 'Tool call: Bash',
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
            { type: 'tool_use', name: 'Read', input: { file_path: 'src/server.ts' } },
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
          content: [{ type: 'tool_result', content: 'File contents loaded.' }],
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
        summary: 'Tool call: Read',
        vendorEventType: 'assistant',
      },
    ])
    expect(toolResult).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'tool_result',
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
        summary: 'Tool call: edit',
        vendorEventType: 'tool_use',
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
