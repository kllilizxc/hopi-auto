import { describe, expect, test } from 'bun:test'
import {
  assistantThreadToFeedItems,
  buildAssistantDeltaFeedItem,
  listItemsAfterCursor,
  paginateMessageFeedItems,
  runToFeedItems,
  type MessageFeedItem,
} from '../src/runtime/messageFeed'
import type { GoalAssistantThread } from '../src/runtime/assistantThreadStore'
import type { GoalRun } from '../src/runtime/runHistory'

describe('messageFeed', () => {
  test('maps assistant thread entries into feed items', () => {
    const thread: GoalAssistantThread = {
      goalKey: 'goal-1',
      entries: [
        {
          entryId: 'user-1',
          createdAt: '2026-06-16T00:00:00.000Z',
          kind: 'user_message',
          content: 'Please use the attached screenshot.',
          attachments: [
            {
              assetPath: 'assets/assistant/image-1/reference.png',
              fileName: 'reference.png',
              mediaType: 'image/png',
              sizeBytes: 123,
              createdAt: '2026-06-16T00:00:00.000Z',
            },
          ],
        },
        {
          entryId: 'assistant-1',
          createdAt: '2026-06-16T00:00:01.000Z',
          kind: 'assistant_message',
          content: 'I will update the plan around that screenshot.',
          mergeKey: 'assistant-run:1:assistant',
        },
        {
          entryId: 'action-1',
          createdAt: '2026-06-16T00:00:02.000Z',
          kind: 'action_result',
          actionType: 'request_planning',
          summary: 'Opened PR-3.',
        },
        {
          entryId: 'notification-1',
          createdAt: '2026-06-16T00:00:03.000Z',
          kind: 'system_message',
          label: 'Action required',
          content: 'T-1 needs intervention.',
          details: ['Blocker: intervention · T-1:reviewer_rejected'],
          collapsedByDefault: false,
          notification: {
            kind: 'task_blocked_intervention',
            taskRef: 'T-1',
            blocker: { kind: 'intervention', ref: 'T-1:reviewer_rejected' },
            actions: ['inspect_task', 'retry_task'],
          },
        },
      ],
    }

    expect(assistantThreadToFeedItems(thread)).toEqual([
      expect.objectContaining({
        id: 'user-1',
        kind: 'user_message',
        role: 'user',
        collapsedByDefault: false,
        attachments: [
          expect.objectContaining({
            assetPath: 'assets/assistant/image-1/reference.png',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'assistant-1',
        kind: 'assistant_message',
        role: 'assistant',
        mergeKey: 'assistant-run:1:assistant',
      }),
      expect.objectContaining({
        id: 'action-1',
        kind: 'system_message',
        role: 'system',
        collapsedByDefault: true,
        label: 'Result · request_planning',
      }),
      expect.objectContaining({
        id: 'notification-1',
        kind: 'system_message',
        role: 'system',
        collapsedByDefault: false,
        label: 'Action required',
        notification: {
          kind: 'task_blocked_intervention',
          taskRef: 'T-1',
          blocker: { kind: 'intervention', ref: 'T-1:reviewer_rejected' },
          actions: ['inspect_task', 'retry_task'],
        },
      }),
    ])
  })

  test('paginates and resumes feed items from cursors', () => {
    const items: MessageFeedItem[] = [
      createFeedItem('1', '2026-06-16T00:00:00.000Z', 'one'),
      createFeedItem('2', '2026-06-16T00:00:01.000Z', 'two'),
      createFeedItem('3', '2026-06-16T00:00:02.000Z', 'three'),
    ]

    const latestPage = paginateMessageFeedItems(items, { limit: 2 })
    expect(latestPage.items.map((item) => item.id)).toEqual(['2', '3'])
    expect(latestPage.hasMoreBefore).toBe(true)

    const olderPage = paginateMessageFeedItems(items, {
      before: latestPage.oldestCursor,
      limit: 2,
    })
    expect(olderPage.items.map((item) => item.id)).toEqual(['1'])
    expect(olderPage.hasMoreBefore).toBe(false)

    expect(listItemsAfterCursor(items, latestPage.oldestCursor).map((item) => item.id)).toEqual([
      '3',
    ])
  })

  test('coalesces adjacent assistant transcript chunks in historical run feeds', () => {
    const run: GoalRun = {
      runId: 'run-1',
      taskRef: 'T-1',
      taskKind: 'engineering',
      startedAt: '2026-06-16T00:00:00.000Z',
      status: 'active',
      steps: [
        {
          stepId: 'step-1',
          role: 'generator',
          statusBefore: 'planned',
          startedAt: '2026-06-16T00:00:00.000Z',
          outcome: 'running',
          messages: [
            {
              messageId: 'msg-1',
              createdAt: '2026-06-16T00:00:00.000Z',
              kind: 'system',
              role: 'system',
              content: 'generator dispatched',
            },
          ],
          transcript: [
            {
              entryId: 'assistant-1',
              createdAt: '2026-06-16T00:00:01.000Z',
              transport: 'codex',
              kind: 'assistant',
              summary: 'First chunk. ',
            },
            {
              entryId: 'assistant-2',
              createdAt: '2026-06-16T00:00:02.000Z',
              transport: 'codex',
              kind: 'assistant',
              summary: 'Second chunk.',
            },
            {
              entryId: 'tool-1',
              createdAt: '2026-06-16T00:00:03.000Z',
              transport: 'codex',
              kind: 'tool_call',
              summary: 'read_file src/App.tsx',
              toolName: 'read_file',
              toolInvocationKey: 'tool-call-1',
            },
          ],
        },
      ],
    }

    const items = runToFeedItems(run)
    expect(items).toHaveLength(3)
    expect(items[1]).toMatchObject({
      kind: 'assistant_message',
      text: 'First chunk. Second chunk.',
      createdAt: '2026-06-16T00:00:02.000Z',
    })
    expect(items[2]).toMatchObject({
      kind: 'tool_call',
      collapsedByDefault: true,
      toolName: 'read_file',
      toolInvocationKey: 'tool-call-1',
    })
  })

  test('marks assistant deltas as pending collapsed feed items', () => {
    expect(
      buildAssistantDeltaFeedItem({
        id: 'delta-1',
        createdAt: '2026-06-16T00:00:00.000Z',
        text: 'Streaming reply',
        mergeKey: 'assistant-run:1:assistant',
      }),
    ).toMatchObject({
      id: 'delta-1',
      kind: 'assistant_delta',
      role: 'assistant',
      pending: true,
      collapsedByDefault: true,
      mergeKey: 'assistant-run:1:assistant',
    })
  })
})

function createFeedItem(id: string, createdAt: string, text: string): MessageFeedItem {
  return {
    id,
    createdAt,
    kind: 'system_message',
    role: 'system',
    text,
    collapsedByDefault: true,
  }
}
