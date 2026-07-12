import { describe, expect, test } from 'bun:test'
import type { AttentionView } from './apiTypes'
import { resolveAssistantInboxContext } from './assistantContext'

describe('Assistant automatic context', () => {
  test('uses the current Goal as the default page context', () => {
    expect(
      resolveAssistantInboxContext({ projectId: 'P-1', goalId: 'G-current' }, null),
    ).toEqual({ projectId: 'P-1', goalId: 'G-current' })
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
    ).toEqual({ projectId: 'P-2', goalId: 'G-attention', attentionId: 'A-1' })
  })

  test('keeps a Workspace Attention at Workspace scope', () => {
    expect(
      resolveAssistantInboxContext(
        { projectId: 'P-1', goalId: 'G-current' },
        attention({ scope: 'workspace', id: 'A-workspace' }),
      ),
    ).toBeUndefined()
  })

  test('uses Workspace scope when no Goal page is selected', () => {
    expect(resolveAssistantInboxContext(null, null)).toBeUndefined()
  })
})

function attention(overrides: Partial<AttentionView>): AttentionView {
  return {
    scope: 'goal',
    id: 'A-1',
    target: 'project:P-1/goal:G-1',
    createdAt: '2026-07-12T00:00:00.000Z',
    resolvedAt: null,
    notifiedAt: null,
    body: 'Needs a decision.',
    ...overrides,
  }
}
