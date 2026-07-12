import { describe, expect, test } from 'bun:test'
import { SUPPORTED_BUN_VERSION, assertSupportedBunVersion } from './verify-runtime'

describe('runtime verification', () => {
  test('accepts the exact supported Bun version', () => {
    expect(SUPPORTED_BUN_VERSION).toBe('1.3.11')
    expect(() => assertSupportedBunVersion('1.3.11')).not.toThrow()
  })

  test('rejects another Bun version with an actionable error', () => {
    expect(() => assertSupportedBunVersion('1.3.10')).toThrow(
      'HOPI requires Bun 1.3.11, but the current runtime is 1.3.10.',
    )
  })
})
