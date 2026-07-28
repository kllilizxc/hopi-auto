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
})
