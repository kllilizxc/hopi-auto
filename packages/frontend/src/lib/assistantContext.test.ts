import { describe, expect, test } from 'bun:test'
import type { AssistantOpenRequest, AttentionView } from './apiTypes'
import {
  findAttentionRequestEventId,
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
        'H-1',
      ),
    ).toEqual({ attentionRefs: ['home:H-1/attention:A-workspace'] })
  })

  test('uses Workspace scope when no Goal page is selected', () => {
    expect(resolveAssistantInboxContext(null, null)).toBeUndefined()
  })

  test('does not infer open Attention from ordinary page context', () => {
    expect(resolveAssistantInboxContext({ projectId: 'P-1', goalId: 'G-current' }, null)).toEqual({
      projectId: 'P-1',
      goalId: 'G-current',
    })
  })

  test('keeps every open reference from one Assistant question in its reply context', () => {
    expect(
      resolveAssistantInboxContext({ projectId: 'P-1', goalId: 'G-current' }, [
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
      ]),
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
    expect(findAttentionRequestEventId([openRequest('EV-public', [target])], target)).toBe(
      'EV-public',
    )
  })

  test('does not confuse a similarly named Attention in another Goal', () => {
    expect(
      findAttentionRequestEventId(
        [openRequest('EV-other', [attention({ projectId: 'P-1', goalId: 'G-2', id: 'A-1' })])],
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
})

const NOW = '2026-07-12T00:00:00.000Z'

function openRequest(eventId: string, attentions: AttentionView[]): AssistantOpenRequest {
  return { eventId, attentions }
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
