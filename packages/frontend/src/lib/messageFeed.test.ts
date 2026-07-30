import { describe, expect, test } from 'bun:test'
import type { AssistantFeedEntry, InboxEventView, RunAttemptEvent } from './apiTypes'
import {
  assistantFeedEntriesToMessageFeed,
  buildMessageFeedRows,
  commandTextFromToolSummary,
  inboxEventsToMessageFeed,
  runEventsToMessageFeed,
  summarizeActivityGroup,
} from './messageFeed'

describe('unified message feed adapters', () => {
  test('renders a submitted user message before the canonical Inbox event exists', () => {
    const items = assistantFeedEntriesToMessageFeed(
      [],
      [
        {
          clientId: 'client-1',
          createdAt: '2026-07-11T08:00:00.000Z',
          text: 'Start the next task.',
          eventId: null,
          attachments: [],
        },
      ],
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'optimistic:client-1:user',
        kind: 'user_message',
        text: 'Start the next task.',
      }),
    ])
  })

  test('replaces an optimistic user message with its exact canonical Inbox event', () => {
    const canonical: AssistantFeedEntry = {
      kind: 'event',
      id: 'event:EV-server',
      occurredAt: '2026-07-11T08:00:01.000Z',
      event: inboxEvent({
        id: 'EV-server',
        receivedAt: '2026-07-11T08:00:01.000Z',
        body: 'Start the next task.',
      }),
    }
    const items = assistantFeedEntriesToMessageFeed(
      [canonical],
      [
        {
          clientId: 'client-1',
          createdAt: '2026-07-11T08:00:00.000Z',
          text: 'Start the next task.',
          eventId: 'EV-server',
          attachments: [],
        },
      ],
    )

    expect(items.filter((item) => item.kind === 'user_message')).toEqual([
      expect.objectContaining({ id: 'inbox:EV-server:user', text: 'Start the next task.' }),
    ])
    expect(items.some((item) => item.id.startsWith('optimistic:'))).toBe(false)
  })

  test('renders final Planning Evidence as the same Completed system update', () => {
    const completionMarkdown =
      '## Ship the Goal\n\nThe reviewed outcome is available in [the release](https://example.test/release).\n\n- Checks passed\n'
    const items = assistantFeedEntriesToMessageFeed([
      {
        kind: 'goal_completion',
        id: 'goal-completion:project:P-1/goal:G-1/evidence:E-final',
        occurredAt: '2026-07-26T11:32:06.638Z',
        completion: {
          projectId: 'P-1',
          goalId: 'G-1',
          evidenceId: 'E-final',
          completedAt: '2026-07-26T11:32:06.638Z',
          body: completionMarkdown,
        },
      },
    ])

    expect(items).toEqual([
      {
        id: 'goal-completion:P-1:G-1:E-final',
        createdAt: '2026-07-26T11:32:06.638Z',
        kind: 'system_update',
        role: 'system',
        text: completionMarkdown,
        label: 'Completed',
        groupId: 'goal-completion:P-1:G-1',
      },
    ])
  })

  test('hides Assistant protocol lifecycle noise while preserving useful tools and replies', () => {
    const event = inboxEvent({
      reply: 'Implemented the useful change.',
      runtimeStatus: 'completed',
      runtimeEvents: [
        {
          eventId: 'coordinator-start',
          createdAt: '2026-07-11T08:00:00.000Z',
          kind: 'message',
          level: 'info',
          role: 'coordinator',
          content: 'Starting Assistant turn.',
        },
        transcript('thread-start', 'status', 'thread started', {
          vendorEventType: 'thread.started',
        }),
        transcript('turn-complete', 'status', 'turn completed', {
          vendorEventType: 'turn.completed',
        }),
        transcript('step-start', 'status', 'step start', {
          transport: 'opencode',
          vendorEventType: 'step_start',
        }),
        transcript('step-finish', 'status', 'step finish', {
          transport: 'opencode',
          vendorEventType: 'step_finish',
        }),
        transcript('provider-warning', 'error', 'Provider refresh timed out.'),
        transcript('tool-start', 'tool_call', 'Tool call: command (bun test)', {
          toolName: 'command',
          toolInvocationKey: 'call-1',
          vendorEventType: 'item.started',
        }),
        transcript('tool-end', 'tool_result', '4 pass, 0 fail', {
          toolName: 'command',
          toolInvocationKey: 'call-1',
          vendorEventType: 'item.completed',
        }),
        transcript('answer', 'assistant', 'Implemented the useful change.', {
          vendorEventType: 'item.completed',
        }),
      ],
    })
    const entries: AssistantFeedEntry[] = [
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
      },
    ]

    const items = assistantFeedEntriesToMessageFeed(entries)

    expect(items.map((item) => item.kind)).toEqual([
      'user_message',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
    expect(items.map((item) => item.text)).not.toContain('Starting Assistant turn.')
    expect(items.map((item) => item.text)).not.toContain('thread started')
    expect(items.map((item) => item.text)).not.toContain('turn completed')
    expect(items.map((item) => item.text)).not.toContain('step start')
    expect(items.map((item) => item.text)).not.toContain('step finish')
    expect(items.map((item) => item.text)).not.toContain('Provider refresh timed out.')
    expect(items.find((item) => item.kind === 'assistant_message')?.details).toBeUndefined()
  })

  test('keeps a terminal speaking-turn error visible', () => {
    const event = inboxEvent({
      runtimeStatus: 'failed',
      runtimeEvents: [transcript('provider-error', 'error', 'Provider is unavailable.')],
    })

    const items = assistantFeedEntriesToMessageFeed([
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
      },
    ])

    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'error', text: 'Provider is unavailable.' }),
    )
  })

  test('shows only the latest provider retry while a speaking turn is running', () => {
    const event = inboxEvent({
      runtimeStatus: 'running',
      runtimeEvents: [
        transcript('init', 'status', 'Claude initialized', {
          transport: 'claude',
          vendorEventType: 'system.init',
        }),
        transcript('retry-1', 'status', 'Provider retry · 1/10 · 429 rate_limit', {
          transport: 'claude',
          vendorEventType: 'system.api_retry',
        }),
        transcript('retry-2', 'status', 'Provider retry · 2/10 · 429 rate_limit', {
          transport: 'claude',
          vendorEventType: 'system.api_retry',
        }),
      ],
    })

    const items = assistantFeedEntriesToMessageFeed([
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
      },
    ])

    expect(items.map((item) => item.text)).toContain('Provider retry · 2/10 · 429 rate_limit')
    expect(items.map((item) => item.text)).not.toContain('Provider retry · 1/10 · 429 rate_limit')
    expect(items.map((item) => item.text)).not.toContain('Claude initialized')
  })

  test('replaces retry and synthetic Assistant noise with one terminal provider error', () => {
    const error = 'Daily provider allocation exceeded.'
    const event = inboxEvent({
      runtimeStatus: 'failed',
      runtimeError: error,
      runtimeEvents: [
        transcript('plain-system', 'status', 'system', {
          transport: 'claude',
          vendorEventType: 'system',
        }),
        transcript('retry', 'status', 'Provider retry · 10/10 · 429 rate_limit', {
          transport: 'claude',
          vendorEventType: 'system.api_retry',
        }),
        transcript('synthetic-error', 'assistant', error, {
          transport: 'claude',
          vendorEventType: 'assistant',
        }),
        transcript('provider-error', 'error', error, {
          transport: 'claude',
          vendorEventType: 'result.api_error',
        }),
        transcript('plain-success', 'status', 'success', {
          transport: 'claude',
          vendorEventType: 'result',
        }),
        {
          eventId: 'stored-failure',
          createdAt: '2026-07-11T08:00:09.000Z',
          kind: 'message',
          level: 'error',
          role: 'assistant',
          content: error,
        },
      ],
    })

    const items = assistantFeedEntriesToMessageFeed([
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
      },
    ])

    expect(items.filter((item) => item.kind === 'error')).toEqual([
      expect.objectContaining({ text: error }),
    ])
    expect(items.map((item) => item.text)).not.toContain('system')
    expect(items.map((item) => item.text)).not.toContain('success')
    expect(items.map((item) => item.text)).not.toContain('Working')
    expect(items.map((item) => item.text)).not.toContain('Provider retry · 10/10 · 429 rate_limit')
  })

  test('keeps internal page context out of the visible user message', () => {
    const [message] = inboxEventsToMessageFeed([inboxEvent()])

    expect(message).toMatchObject({ kind: 'user_message', text: 'Please implement the change.' })
    expect(message?.details).toBeUndefined()
  })

  test('extracts the command from the Codex tool-call wrapper for the collapsed row', () => {
    expect(
      commandTextFromToolSummary('Tool call: command (bun test src/lib/messageFeed.test.ts)'),
    ).toBe('bun test src/lib/messageFeed.test.ts')
    expect(commandTextFromToolSummary('bun run check')).toBe('bun run check')
  })

  test('keeps one final assistant message and pairs tool calls with their results', () => {
    const event = inboxEvent({
      reply: 'Implemented the change.',
      runtimeStatus: 'completed',
      runtimeEvents: [
        transcript('progress', 'assistant', 'I am inspecting the tool schema.'),
        transcript('tool-start', 'tool_call', 'Tool call: command (bun test)', {
          toolName: 'command',
          toolInvocationKey: 'call-1',
        }),
        transcript('tool-end', 'tool_result', '4 pass, 0 fail', {
          toolName: 'command',
          toolInvocationKey: 'call-1',
        }),
        transcript('answer', 'assistant', 'Implemented the change.'),
      ],
    })
    const items = assistantFeedEntriesToMessageFeed([
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
      },
    ])

    expect(items.map((item) => item.kind)).toEqual([
      'user_message',
      'tool_call',
      'status',
      'tool_result',
      'assistant_message',
    ])
    expect(items.filter((item) => item.kind === 'assistant_message')).toHaveLength(1)
    expect(items.find((item) => item.text === 'I am inspecting the tool schema.')).toMatchObject({
      kind: 'status',
      role: 'system',
      label: 'Activity',
    })

    const rows = buildMessageFeedRows(items)
    expect(rows.map((row) => row.type)).toEqual(['message', 'activity_group', 'message'])
    const activity = rows[1]
    expect(activity?.type).toBe('activity_group')
    if (activity?.type !== 'activity_group') throw new Error('Expected activity group')
    expect(activity.entries).toHaveLength(2)
    expect(activity.entries[0]).toMatchObject({
      type: 'tool_block',
      call: { toolInvocationKey: 'call-1' },
      result: { text: '4 pass, 0 fail' },
    })
  })

  test('keeps durable Inbox image references on the user message', () => {
    const items = inboxEventsToMessageFeed([
      inboxEvent({
        attachments: [
          {
            reference: '.hopi/docs/assistant/attachments/hash/layout.png',
            fileName: 'layout.png',
            mediaType: 'image/png',
            sizeBytes: 9,
            url: '/api/assistant/attachments/hash/layout.png',
          },
        ],
      }),
    ])

    expect(items[0]).toMatchObject({
      kind: 'user_message',
      attachments: [
        {
          reference: '.hopi/docs/assistant/attachments/hash/layout.png',
          fileName: 'layout.png',
          url: '/api/assistant/attachments/hash/layout.png',
        },
      ],
    })
  })

  test('marks the active tool call without leaking live state into its historical summary', () => {
    const items = inboxEventsToMessageFeed([
      inboxEvent({
        runtimeStatus: 'running',
        runtimeEvents: [
          transcript('tool-start', 'tool_call', 'Tool call: command (bun test)', {
            toolName: 'command',
            toolInvocationKey: 'call-1',
          }),
        ],
      }),
    ])
    const rows = buildMessageFeedRows(items)
    const activity = rows[1]

    expect(items.map((item) => item.text)).not.toContain('Working')
    expect(items.find((item) => item.kind === 'tool_call')).toMatchObject({ pending: true })
    expect(activity?.type).toBe('activity_group')
    if (activity?.type !== 'activity_group') throw new Error('Expected activity group')
    expect(activity.entries).toHaveLength(1)
    expect(summarizeActivityGroup(activity.entries)).toBe('Ran command')
  })

  test('does not present an unmatched tool call as running after a completed run', () => {
    const items = runEventsToMessageFeed(
      [
        transcript('tool-start', 'tool_call', 'Tool call: command (bun test)', {
          toolName: 'command',
          toolInvocationKey: 'call-1',
        }),
      ],
      { namespace: 'attempt:R-1', groupId: 'R-1', active: false },
    )
    const rows = buildMessageFeedRows(items)
    const activity = rows[0]

    expect(items[0]?.pending).toBe(false)
    expect(activity?.type).toBe('activity_group')
    if (activity?.type !== 'activity_group') throw new Error('Expected activity group')
    expect(summarizeActivityGroup(activity.entries)).toBe('Ran command')
  })

  test('keeps Agent plan snapshots out of conversational Activity rows', () => {
    const items = runEventsToMessageFeed(
      [
        {
          eventId: 'plan-1',
          createdAt: '2026-07-11T08:00:00.000Z',
          kind: 'plan',
          transport: 'codex',
          planId: 'todo-1',
          status: 'active',
          items: [{ text: 'Implement the projection', completed: false }],
          vendorEventType: 'item.started',
        },
      ],
      { namespace: 'attempt:R-1', groupId: 'R-1', active: true },
    )

    expect(items).toEqual([])
  })

  test('keeps content-free provider progress out of conversational Activity rows', () => {
    const items = runEventsToMessageFeed(
      [
        transcript('task-progress', 'status', 'task progress', {
          transport: 'claude',
          vendorEventType: 'system.task_progress',
        }),
        transcript('thinking-progress', 'status', 'thinking tokens', {
          transport: 'claude',
          vendorEventType: 'system.thinking_tokens',
        }),
        transcript('answer', 'assistant', 'Implemented the projection.', {
          transport: 'claude',
        }),
      ],
      { namespace: 'attempt:R-1', groupId: 'R-1', active: true },
    )

    expect(items).toEqual([
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Implemented the projection.',
      }),
    ])
  })

  test('keeps an activity row identity stable when its older tool call is prepended', () => {
    const options = { namespace: 'attempt:R-1', groupId: 'R-1', active: false }
    const result = transcript('tool-end', 'tool_result', '4 pass, 0 fail', {
      toolName: 'command',
      toolInvocationKey: 'call-1',
    })
    const answer = transcript('answer', 'assistant', 'Done.')
    const call = transcript('tool-start', 'tool_call', 'Tool call: command (bun test)', {
      toolName: 'command',
      toolInvocationKey: 'call-1',
    })
    const latestRows = buildMessageFeedRows(runEventsToMessageFeed([result, answer], options))
    const expandedRows = buildMessageFeedRows(
      runEventsToMessageFeed([call, result, answer], options),
    )

    expect(latestRows[0]?.type).toBe('activity_group')
    expect(expandedRows[0]?.type).toBe('activity_group')
    expect(expandedRows[0]?.id).toBe(latestRows[0]?.id)
  })

  test('keeps system prompts internal while rendering their public reply', () => {
    const items = inboxEventsToMessageFeed([
      inboxEvent({
        source: 'system',
        body: 'Internal state digest and handoff brief.',
        reply: 'Please choose a release strategy.',
        runtimeStatus: 'completed',
        runtimeEvents: [],
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'assistant_message',
      text: 'Please choose a release strategy.',
    })
  })
})

function inboxEvent(overrides: Partial<InboxEventView> = {}): InboxEventView {
  return {
    id: 'EV-1',
    receivedAt: '2026-07-11T08:00:00.000Z',
    status: 'pending',
    source: 'user',
    visibility: 'public',
    body: 'Please implement the change.',
    attachments: [],
    reply: null,
    disposition: null,
    context: { projectId: 'P-1', goalId: 'G-1' },
    runtimeStatus: 'queued',
    runtimeEvents: [],
    runtimeError: null,
    ...overrides,
  }
}

function transcript(
  eventId: string,
  entryKind: Extract<RunAttemptEvent, { kind: 'transcript' }>['entryKind'],
  summary: string,
  extra: Partial<Extract<RunAttemptEvent, { kind: 'transcript' }>> = {},
): RunAttemptEvent {
  return {
    eventId,
    createdAt: `2026-07-11T08:00:0${eventId === 'tool-start' ? '1' : '2'}.000Z`,
    kind: 'transcript',
    transport: 'codex',
    entryKind,
    summary,
    ...extra,
  }
}
