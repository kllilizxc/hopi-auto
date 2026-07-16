import { describe, expect, test } from 'bun:test'
import { goalAttentionReference, normalizeAttentionReferences } from './attentionReference'

describe('Attention references with readable identities', () => {
  test('keeps a canonical Unicode reference intact', () => {
    const reference = goalAttentionReference('P-产品工作台', 'G-优化前端样式', 'A-review')

    expect(
      normalizeAttentionReferences({
        projectId: 'P-产品工作台',
        goalId: 'G-优化前端样式',
        attentionRefs: [reference],
      }),
    ).toEqual([reference])
  })

  test('qualifies a local Attention ID with the readable Goal identity', () => {
    expect(
      normalizeAttentionReferences({
        projectId: 'P-产品工作台',
        goalId: 'G-优化前端样式',
        attentionId: 'A-review',
      }),
    ).toEqual(['project:P-产品工作台/goal:G-优化前端样式/attention:A-review'])
  })
})
