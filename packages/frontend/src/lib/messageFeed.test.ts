import { describe, expect, test } from 'bun:test'
import type { AssistantFeedEntry, AttentionView, InboxEventView, RunAttemptEvent } from './apiTypes'
import {
  assistantEventsToMessageFeed,
  assistantFeedEntriesToMessageFeed,
  buildMessageFeedRows,
  commandTextFromToolSummary,
  inboxEventsToMessageFeed,
  runEventsToMessageFeed,
  summarizeActivityGroup,
} from './messageFeed'

describe('unified message feed adapters', () => {
  test('moves a linked completion Attention into the stream without duplicating its reply', () => {
    const completion = completionAttention()
    const items = assistantEventsToMessageFeed(
      [
        inboxEvent({
          source: 'reflection',
          status: 'handled',
          body: 'Internal completion handoff.',
          context: { projectId: 'P-1', goalId: 'G-1', attentionId: completion.id },
          reply: 'Goal G-1 is complete.',
          runtimeStatus: 'completed',
          runtimeEvents: [transcript('answer', 'assistant', 'Goal G-1 is complete.')],
        }),
      ],
      [completion],
    )

    expect(items.filter((item) => item.kind === 'system_update')).toHaveLength(1)
    expect(items.filter((item) => item.text === 'Goal G-1 is complete.')).toHaveLength(1)
    expect(items.find((item) => item.kind === 'system_update')).toMatchObject({
      label: 'Completed',
      text: 'Goal G-1 is complete.',
    })
  })

  test('adds an unlinked completion Attention as a readable system update', () => {
    const items = assistantEventsToMessageFeed([], [completionAttention()])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'system_update',
      text: 'Completion\n\nGoal proof is sufficient.\n\n• Work W-1 is done.',
    })
  })

  test('does not collide when two Goals reuse the same local completion ID', () => {
    const first = completionAttention()
    const second = completionAttention({
      projectId: 'P-1',
      goalId: 'G-2',
      body: '## Completion\n\nSecond Goal is complete.',
    })
    const items = assistantEventsToMessageFeed(
      [
        inboxEvent({
          id: 'EV-1',
          source: 'reflection',
          status: 'handled',
          context: {
            projectId: 'P-1',
            goalId: 'G-1',
            attentionRefs: ['project:P-1/goal:G-1/attention:completion-G-1'],
          },
          reply: 'First Goal is complete.',
        }),
        inboxEvent({
          id: 'EV-2',
          source: 'reflection',
          status: 'handled',
          context: {
            projectId: 'P-1',
            goalId: 'G-2',
            attentionRefs: ['project:P-1/goal:G-2/attention:completion-G-1'],
          },
          reply: 'Second Goal is complete.',
        }),
      ],
      [first, second],
    )

    expect(items.filter((item) => item.kind === 'system_update')).toMatchObject([
      { text: 'First Goal is complete.' },
      { text: 'Second Goal is complete.' },
    ])
  })

  test('links one completion only to its handled Reflection reply, not a later user turn', () => {
    const completion = completionAttention()
    const reference = 'project:P-1/goal:G-1/attention:completion-G-1'
    const items = assistantEventsToMessageFeed(
      [
        inboxEvent({
          id: 'EV-reflection',
          source: 'reflection',
          status: 'handled',
          context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
          reply: 'The Goal is complete.',
        }),
        inboxEvent({
          id: 'EV-user',
          status: 'handled',
          context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
          body: 'Thanks.',
          reply: 'You are welcome.',
        }),
      ],
      [completion],
    )

    expect(items.filter((item) => item.kind === 'system_update')).toMatchObject([
      { text: 'The Goal is complete.' },
    ])
    expect(items).toContainEqual(expect.objectContaining({ kind: 'user_message', text: 'Thanks.' }))
    expect(items).toContainEqual(
      expect.objectContaining({ kind: 'assistant_message', text: 'You are welcome.' }),
    )
  })

  test('renders independently paged Assistant entries without cross-page completion lookup', () => {
    const completion = completionAttention()
    const event = inboxEvent({
      source: 'reflection',
      context: { projectId: 'P-1', goalId: 'G-1', attentionId: completion.id },
      reply: 'Goal G-1 is complete.',
      runtimeStatus: 'completed',
    })
    const entries: AssistantFeedEntry[] = [
      {
        kind: 'event',
        id: `event:${event.id}`,
        occurredAt: event.receivedAt,
        event,
        completion,
      },
    ]

    expect(assistantFeedEntriesToMessageFeed(entries)).toMatchObject([
      { kind: 'system_update', label: 'Completed', text: 'Goal G-1 is complete.' },
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
        completion: null,
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
        completion: null,
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
        completion: null,
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
        transcript('legacy-system', 'status', 'system', {
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
        transcript('legacy-success', 'status', 'success', {
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
        completion: null,
      },
    ])

    expect(items.filter((item) => item.kind === 'error')).toEqual([
      expect.objectContaining({ text: error }),
    ])
    expect(items.map((item) => item.text)).not.toContain('system')
    expect(items.map((item) => item.text)).not.toContain('success')
    expect(items.map((item) => item.text)).not.toContain('Working')
    expect(items.map((item) => item.text)).not.toContain(
      'Provider retry · 10/10 · 429 rate_limit',
    )
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
    const items = inboxEventsToMessageFeed([
      inboxEvent({
        reply: 'Implemented the change.',
        runtimeStatus: 'completed',
        runtimeEvents: [
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
      }),
    ])

    expect(items.map((item) => item.kind)).toEqual([
      'user_message',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
    expect(items.filter((item) => item.kind === 'assistant_message')).toHaveLength(1)

    const rows = buildMessageFeedRows(items)
    expect(rows.map((row) => row.type)).toEqual(['message', 'activity_group', 'message'])
    const activity = rows[1]
    expect(activity?.type).toBe('activity_group')
    if (activity?.type !== 'activity_group') throw new Error('Expected activity group')
    expect(activity.entries).toHaveLength(1)
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

  test('folds a live tool call and turn state into one pending activity group', () => {
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

    expect(items.at(-1)).toMatchObject({ kind: 'status', pending: true, text: 'Working' })
    expect(items.find((item) => item.kind === 'tool_call')).toMatchObject({ pending: true })
    expect(activity?.type).toBe('activity_group')
    if (activity?.type !== 'activity_group') throw new Error('Expected activity group')
    expect(activity.entries).toHaveLength(2)
    expect(summarizeActivityGroup(activity.entries)).toBe('Working')
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

  test('keeps reflection prompts internal while rendering their public reply', () => {
    const items = inboxEventsToMessageFeed([
      inboxEvent({
        source: 'reflection',
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
    routeClaim: null,
    runtimeStatus: 'queued',
    runtimeEvents: [],
    runtimeError: null,
    ...overrides,
  }
}

function completionAttention(overrides: Partial<AttentionView> = {}): AttentionView {
  return {
    scope: 'goal',
    id: 'completion-G-1',
    target: null,
    createdAt: '2026-07-11T08:00:00.000Z',
    resolvedAt: '2026-07-11T08:01:00.000Z',
    notifiedAt: '2026-07-11T08:01:00.000Z',
    body: '## Completion\n\nGoal proof is sufficient.\n\n- Work W-1 is done.',
    projectId: 'P-1',
    goalId: 'G-1',
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
