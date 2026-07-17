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

  test('drops empty Codex lifecycle status events that carry no meaningful payload', () => {
    const entries = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        method: 'item/completed',
        params: {
          item: {
            type: 'reasoning',
          },
        },
      }),
    })

    expect(entries).toEqual([])
  })

  test('normalizes Codex todo snapshots without flattening them into transcript status', () => {
    const started = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item-plan-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect the current runtime', completed: false },
            { text: 'Implement the projection', completed: false },
          ],
        },
      }),
    })
    const updated = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'item.updated',
        item: {
          id: 'item-plan-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect the current runtime', completed: true },
            { text: 'Implement the projection', completed: false },
          ],
        },
      }),
    })
    const completed = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item-plan-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect the current runtime', completed: true },
            { text: 'Implement the projection', completed: true },
          ],
        },
      }),
    })

    expect(started).toEqual([
      {
        kind: 'plan',
        transport: 'codex',
        planId: 'item-plan-1',
        status: 'active',
        items: [
          { text: 'Inspect the current runtime', completed: false },
          { text: 'Implement the projection', completed: false },
        ],
        vendorEventType: 'item.started',
      },
    ])
    expect(updated[0]).toMatchObject({
      kind: 'plan',
      status: 'active',
      items: [{ completed: true }, { completed: false }],
      vendorEventType: 'item.updated',
    })
    expect(completed[0]).toMatchObject({
      kind: 'plan',
      status: 'completed',
      items: [{ completed: true }, { completed: true }],
      vendorEventType: 'item.completed',
    })
  })

  test('normalizes current Codex command_execution started/completed events into tool rows', () => {
    const toolStarted = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: '/usr/bin/zsh -lc pwd',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress',
        },
      }),
    })

    const toolCompleted = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_1',
          type: 'command_execution',
          command: '/usr/bin/zsh -lc pwd',
          aggregated_output: '/home/kllilizxc/Code/hopi-auto\n',
          exit_code: 0,
          status: 'completed',
        },
      }),
    })

    expect(toolStarted).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        toolName: 'command',
        toolInvocationKey: 'item_1',
        summary: 'Tool call: command (/usr/bin/zsh -lc pwd)',
        vendorEventType: 'item.started',
      },
    ])
    expect(toolCompleted).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_result',
        toolName: 'command',
        toolInvocationKey: 'item_1',
        summary: '/home/kllilizxc/Code/hopi-auto',
        vendorEventType: 'item.completed',
      },
    ])
  })

  test('normalizes current Codex MCP started/completed events as one call and result pair', () => {
    const toolStarted = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'assistant',
      line: JSON.stringify({
        type: 'item.started',
        item: {
          id: 'mcp_1',
          type: 'mcp_tool_call',
          server: 'hopi',
          tool: 'hopi_control_goal',
          arguments: { projectId: 'P-1', goalId: 'G-1', operation: 'pause' },
          status: 'in_progress',
        },
      }),
    })
    const toolCompleted = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'assistant',
      line: JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'mcp_1',
          type: 'mcp_tool_call',
          server: 'hopi',
          tool: 'hopi_control_goal',
          arguments: { projectId: 'P-1', goalId: 'G-1', operation: 'pause' },
          result: { content: [{ type: 'text', text: '{"summary":"Goal paused"}' }] },
          status: 'completed',
        },
      }),
    })

    expect(toolStarted).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        toolName: 'hopi_control_goal',
        toolInvocationKey: 'mcp_1',
        summary: 'Tool call: hopi_control_goal',
        vendorEventType: 'item.started',
      },
    ])
    expect(toolCompleted).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_result',
        toolName: 'hopi_control_goal',
        toolInvocationKey: 'mcp_1',
        summary: '{"summary":"Goal paused"}',
        vendorEventType: 'item.completed',
      },
    ])
  })

  test('normalizes a rejected Codex MCP call as a visible error', () => {
    const entries = normalizeProcessOutputLine({
      format: 'codex_jsonl',
      stream: 'stdout',
      role: 'assistant',
      line: JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'mcp_2',
          type: 'mcp_tool_call',
          server: 'hopi',
          tool: 'hopi_control_goal',
          arguments: {},
          error: { message: 'user cancelled MCP tool call' },
          status: 'failed',
        },
      }),
    })

    expect(entries).toEqual([
      {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'error',
        toolName: 'hopi_control_goal',
        toolInvocationKey: 'mcp_2',
        summary: 'user cancelled MCP tool call',
        vendorEventType: 'item.completed',
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
              input: { file_path: 'src/service.ts' },
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
        summary: 'Tool call: Read (src/service.ts)',
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

  test('keeps Claude retry detail and honors terminal is_error over a success subtype', () => {
    const retry = normalizeProcessOutputLine({
      format: 'claude_stream_json',
      stream: 'stdout',
      role: 'assistant',
      line: JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 3,
        max_retries: 10,
        error_status: 429,
        error: 'rate_limit',
      }),
    })
    const result = normalizeProcessOutputLine({
      format: 'claude_stream_json',
      stream: 'stdout',
      role: 'assistant',
      line: JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: true,
        api_error_status: 429,
        terminal_reason: 'api_error',
        result: 'Daily provider allocation exceeded.',
      }),
    })

    expect(retry).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'status',
        summary: 'Provider retry · 3/10 · 429 rate_limit',
        vendorEventType: 'system.api_retry',
      },
    ])
    expect(result).toEqual([
      {
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'error',
        summary: 'Daily provider allocation exceeded.',
        vendorEventType: 'result.api_error',
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

  test('normalizes current OpenCode text and completed tool events', () => {
    const assistant = normalizeProcessOutputLine({
      format: 'opencode_json',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'text',
        sessionID: 'ses_1',
        part: {
          id: 'part-1',
          messageID: 'msg-1',
          type: 'text',
          text: 'Implemented the change.',
        },
      }),
    })
    const tool = normalizeProcessOutputLine({
      format: 'opencode_json',
      stream: 'stdout',
      role: 'generator',
      line: JSON.stringify({
        type: 'tool_use',
        sessionID: 'ses_1',
        part: {
          id: 'tool-1',
          messageID: 'msg-1',
          type: 'tool',
          tool: 'bash',
          state: { status: 'completed', output: '3 tests passed' },
        },
      }),
    })

    expect(assistant).toEqual([
      {
        kind: 'transcript',
        transport: 'opencode',
        entryKind: 'assistant',
        summary: 'Implemented the change.',
        vendorEventType: 'text',
      },
    ])
    expect(tool).toEqual([
      {
        kind: 'transcript',
        transport: 'opencode',
        entryKind: 'tool_result',
        toolName: 'bash',
        toolInvocationKey: 'tool-1',
        summary: '3 tests passed',
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
