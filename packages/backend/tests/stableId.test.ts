import { describe, expect, test } from 'bun:test'
import { deriveReadableId, stableIdSchema } from '../src/domain/stableId'

describe('readable stable IDs', () => {
  test('derives compact Project and Goal identities from human names', () => {
    expect(deriveReadableId('P', 'Customer Portal', [])).toBe('P-customer-portal')
    expect(deriveReadableId('G', 'Ship the MVP!', [])).toBe('G-ship-the-mvp')
    expect(deriveReadableId('G', '优化整体前端样式', [])).toBe('G-优化整体前端样式')
  })

  test('does not duplicate a supplied prefix', () => {
    expect(deriveReadableId('P', 'P-HOPI Auto', [])).toBe('P-hopi-auto')
    expect(deriveReadableId('G', 'G-Launch', [])).toBe('G-launch')
  })

  test('uses the smallest case-insensitive free numeric suffix', () => {
    expect(deriveReadableId('G', 'Launch', ['G-LAUNCH', 'G-launch-2', 'G-unrelated'])).toBe(
      'G-launch-3',
    )
  })

  test('keeps only path-safe separators and bounds generated stems', () => {
    const id = deriveReadableId('G', `  Design / Build: ${'x'.repeat(80)}  `, [])

    expect(id).toStartWith('G-design-build-')
    expect([...id.slice(2)]).toHaveLength(48)
    expect(stableIdSchema.safeParse(id).success).toBe(true)
    expect(stableIdSchema.safeParse('G-folder/name').success).toBe(false)
    expect(stableIdSchema.safeParse('G-target:value').success).toBe(false)
  })
})
