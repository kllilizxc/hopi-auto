import { describe, expect, test } from 'bun:test'
import type { AssistantFeedEntry, AttentionView, InboxEventView } from './apiTypes'
import {
  findAttentionNotificationEventId,
  findLatestNeedsYouGroupId,
  groupNeedsYouAttentions,
  readAssistantPageScope,
  resolveAssistantInboxContext,
} from './assistantContext'

describe('Assistant automatic context', () => {
  test('derives Home, Project, and Project plus Goal scope only from the page', () => {
    expect(readAssistantPageScope('/projects')).toBeNull()
    expect(readAssistantPageScope('/projects/P-1/goals/new')).toEqual({ projectId: 'P-1' })
    expect(readAssistantPageScope('/projects/P-1/board/G-1')).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
    })
  })

  test('uses the current Project as context while a Goal is being created', () => {
    expect(resolveAssistantInboxContext({ projectId: 'P-1' }, null)).toEqual({
      projectId: 'P-1',
    })
  })

  test('uses the current Goal as the default page context', () => {
    expect(resolveAssistantInboxContext({ projectId: 'P-1', goalId: 'G-current' }, null)).toEqual({
      projectId: 'P-1',
      goalId: 'G-current',
    })
  })

  test('lets an exact Goal Attention override the current page', () => {
    expect(
      resolveAssistantInboxContext(
        { projectId: 'P-1', goalId: 'G-current' },
        attention({
          scope: 'goal',
          projectId: 'P-2',
          goalId: 'G-attention',
          id: 'A-1',
        }),
      ),
    ).toEqual({
      projectId: 'P-2',
      goalId: 'G-attention',
      attentionRefs: ['project:P-2/goal:G-attention/attention:A-1'],
    })
  })

  test('keeps a Workspace Attention at Workspace scope', () => {
    expect(
      resolveAssistantInboxContext(
        { projectId: 'P-1', goalId: 'G-current' },
        attention({ scope: 'workspace', id: 'A-workspace' }),
        [],
        'H-1',
      ),
    ).toEqual({ attentionRefs: ['home:H-1/attention:A-workspace'] })
  })

  test('uses Workspace scope when no Goal page is selected', () => {
    expect(resolveAssistantInboxContext(null, null)).toBeUndefined()
  })

  test('does not infer open Attention from ordinary page context', () => {
    expect(
      resolveAssistantInboxContext({ projectId: 'P-1', goalId: 'G-current' }, null, [
        attention({
          projectId: 'P-1',
          goalId: 'G-current',
          id: 'A-1',
          operatorRequest: 'home:H-1/event:EV-question',
        }),
        attention({ projectId: 'P-1', goalId: 'G-current', id: 'A-2' }),
      ]),
    ).toEqual({
      projectId: 'P-1',
      goalId: 'G-current',
    })
  })

  test('keeps every open reference from one Assistant question in its reply context', () => {
    expect(
      resolveAssistantInboxContext(
        { projectId: 'P-1', goalId: 'G-current' },
        [
          attention({
            projectId: 'P-2',
            goalId: 'G-attention',
            id: 'A-1',
            operatorRequest: 'home:H-1/event:EV-question',
          }),
          attention({
            projectId: 'P-2',
            goalId: 'G-attention',
            id: 'A-2',
            operatorRequest: 'home:H-1/event:EV-question',
          }),
        ],
      ),
    ).toEqual({
      projectId: 'P-2',
      goalId: 'G-attention',
      attentionRefs: [
        'project:P-2/goal:G-attention/attention:A-1',
        'project:P-2/goal:G-attention/attention:A-2',
      ],
      replyTo: 'home:H-1/event:EV-question',
    })
  })

  test('finds the exact public speaking turn currently awaiting a reply', () => {
    const target = attention({
      projectId: 'P-1',
      goalId: 'G-1',
      id: 'A-1',
      notifiedAt: NOW,
      operatorRequest: 'home:H-1/event:EV-public',
    })
    const reference = 'project:P-1/goal:G-1/attention:A-1'

    expect(
      findAttentionNotificationEventId(
        [
          feedEvent('EV-user', { source: 'user', context: { attentionRefs: [reference] } }),
          feedEvent('EV-internal', {
            visibility: 'internal',
            context: { attentionRefs: [reference] },
          }),
          feedEvent('EV-public', { context: { attentionRefs: [reference] } }),
        ],
        target,
      ),
    ).toBe('EV-public')
  })

  test('does not confuse a similarly named Attention in another Goal', () => {
    expect(
      findAttentionNotificationEventId(
        [
          feedEvent('EV-other', {
            context: { attentionRefs: ['project:P-1/goal:G-2/attention:A-1'] },
          }),
        ],
        attention({
          projectId: 'P-1',
          goalId: 'G-1',
          id: 'A-1',
          notifiedAt: NOW,
          operatorRequest: 'home:H-1/event:EV-public',
        }),
      ),
    ).toBeNull()
  })

  test('groups only unresolved operator requests under the exact Assistant message', () => {
    const references = [
      'project:P-1/goal:G-1/attention:A-1',
      'project:P-1/goal:G-1/attention:A-2',
    ]
    const groups = groupNeedsYouAttentions(
      [feedEvent('EV-public', { context: { attentionRefs: references } })],
      [
        attention({
          projectId: 'P-1',
          goalId: 'G-1',
          id: 'A-1',
          notifiedAt: NOW,
          operatorRequest: 'home:H-1/event:EV-public',
        }),
        attention({
          projectId: 'P-1',
          goalId: 'G-1',
          id: 'A-2',
          notifiedAt: NOW,
          operatorRequest: 'home:H-1/event:EV-public',
        }),
        attention({
          projectId: 'P-1',
          goalId: 'G-1',
          id: 'A-resolved',
          notifiedAt: NOW,
          operatorRequest: null,
          resolvedAt: NOW,
        }),
        attention({
          projectId: 'P-1',
          goalId: 'G-1',
          id: 'A-informed',
          notifiedAt: NOW,
          operatorRequest: null,
        }),
        attention({ projectId: 'P-1', goalId: 'G-1', id: 'A-unnotified', notifiedAt: null }),
      ],
    )

    expect(
      [...groups.entries()].map(([groupId, attentions]) => [
        groupId,
        attentions.map((item) => item.id),
      ]),
    ).toEqual([['inbox:EV-public', ['A-1', 'A-2']]])
  })

  test('selects the newest visible message that still needs a reply', () => {
    expect(
      findLatestNeedsYouGroupId(
        [
          message('older', 'inbox:EV-older'),
          message('ordinary', 'inbox:EV-ordinary'),
          message('newer', 'inbox:EV-newer'),
          message('optimistic'),
        ],
        new Map([
          ['inbox:EV-older', 1],
          ['inbox:EV-newer', 2],
        ]),
      ),
    ).toBe('inbox:EV-newer')
  })
})

const NOW = '2026-07-12T00:00:00.000Z'

function feedEvent(id: string, overrides: Partial<InboxEventView> = {}): AssistantFeedEntry {
  return {
    kind: 'event',
    id: `event:${id}`,
    occurredAt: NOW,
    completion: null,
    event: {
      id,
      receivedAt: NOW,
      status: 'handled',
      source: 'reflection',
      visibility: 'public',
      body: 'Internal handoff.',
      attachments: [],
      reply: 'Please decide.',
      disposition: null,
      context: null,
      routeClaim: null,
      runtimeStatus: 'completed',
      runtimeEvents: [],
      runtimeError: null,
      ...overrides,
    },
  }
}

function attention(overrides: Partial<AttentionView>): AttentionView {
  return {
    scope: 'goal',
    id: 'A-1',
    target: 'project:P-1/goal:G-1',
    createdAt: NOW,
    resolvedAt: null,
    notifiedAt: null,
    operatorRequest: null,
    body: 'Needs a decision.',
    ...overrides,
  }
}

function message(id: string, groupId?: string) {
  return {
    id,
    createdAt: NOW,
    kind: 'assistant_message' as const,
    role: 'assistant' as const,
    text: id,
    ...(groupId ? { groupId } : {}),
  }
}
