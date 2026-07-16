import { describe, expect, test } from 'bun:test'
import { inboxContextSchema } from '../src/domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  parseAttentionReference,
  workspaceAttentionReference,
} from '../src/domain/attentionReference'

describe('canonical Attention references', () => {
  test('round-trips Goal-local and Workspace identities', () => {
    const goal = goalAttentionReference('P-1', 'G-1', 'A-1')
    const workspace = workspaceAttentionReference('H-1', 'A-1')

    expect(parseAttentionReference(goal)).toEqual({
      scope: 'goal',
      projectId: 'P-1',
      goalId: 'G-1',
      attentionId: 'A-1',
    })
    expect(parseAttentionReference(workspace)).toEqual({
      scope: 'workspace',
      homeId: 'H-1',
      attentionId: 'A-1',
    })
  })

  test('round-trips readable Unicode Project and Goal identities', () => {
    const reference = goalAttentionReference('P-产品工作台', 'G-优化前端样式', 'A-review')

    expect(parseAttentionReference(reference)).toEqual({
      scope: 'goal',
      projectId: 'P-产品工作台',
      goalId: 'G-优化前端样式',
      attentionId: 'A-review',
    })
    expect(inboxContextSchema.parse({ attentionRefs: [reference] })).toEqual({
      attentionRefs: [reference],
    })
  })

  test('normalizes legacy local IDs only inside their stored Goal context', () => {
    expect(
      normalizeInboxAttentionReferences({
        projectId: 'P-1',
        goalId: 'G-1',
        attentionId: 'A-1',
        attentionRefs: ['A-1', 'project:P-2/goal:G-2/attention:A-1'],
      }),
    ).toEqual(['project:P-1/goal:G-1/attention:A-1', 'project:P-2/goal:G-2/attention:A-1'])
  })

  test('accepts reference-only Workspace context and rejects partial page context', () => {
    expect(inboxContextSchema.parse({ attentionRefs: ['home:H-1/attention:A-project'] })).toEqual({
      attentionRefs: ['home:H-1/attention:A-project'],
    })
    expect(() => inboxContextSchema.parse({ projectId: 'P-1' })).toThrow(
      'projectId and goalId must appear together',
    )
  })
})
