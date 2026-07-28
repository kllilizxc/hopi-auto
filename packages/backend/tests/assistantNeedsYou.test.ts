import { describe, expect, test } from 'bun:test'
import { needsYouAttentionIds } from '../src/assistant/assistantNeedsYou'

describe('NeedsYou presentation', () => {
  test('extracts stable Attention IDs from tagged Assistant text', () => {
    const reply = [
      '<NeedsYou attentionId="A-scope">',
      '请选择适用范围。',
      '</NeedsYou>',
      "<NeedsYou attentionId='A-release'>Choose a release window.</NeedsYou>",
    ].join('\n')

    expect(needsYouAttentionIds(reply)).toEqual(['A-scope', 'A-release'])
  })

  test('deduplicates repeated Attention IDs', () => {
    const reply = [
      '<NeedsYou attentionId="A-scope">First.</NeedsYou>',
      '<NeedsYou attentionId="A-scope">Second.</NeedsYou>',
    ].join('\n')

    expect(needsYouAttentionIds(reply)).toEqual(['A-scope'])
  })

  test('ignores malformed, unstable, and unterminated tags', () => {
    const reply = [
      '<NeedsYou attentionId="not stable">Invalid ID.</NeedsYou>',
      '<NeedsYou attentionId="A-open">Missing close.',
      '<NeedsYou>Missing ID.</NeedsYou>',
    ].join('\n')

    expect(needsYouAttentionIds(reply)).toEqual([])
  })
})
