import { describe, expect, test } from 'bun:test'
import {
  MINIMUM_BUN_VERSION,
  SUPPORTED_BUN_RANGE,
  assertSupportedBunVersion,
  assertSupportedPlatform,
} from './verify-runtime'

describe('runtime verification', () => {
  test('accepts the baseline and compatible Bun 1 releases', () => {
    expect(MINIMUM_BUN_VERSION).toBe('1.3.11')
    expect(SUPPORTED_BUN_RANGE).toBe('>=1.3.11 <2')
    for (const version of ['1.3.11', '1.3.13', '1.4.0', '1.99.0']) {
      expect(() => assertSupportedBunVersion(version)).not.toThrow()
    }
  })

  test('rejects an older, next-major, or malformed Bun version', () => {
    for (const version of ['1.3.10', '1.2.99', '2.0.0', 'development']) {
      expect(() => assertSupportedBunVersion(version)).toThrow(
        `HOPI requires Bun >=1.3.11 <2, but the current runtime is ${version}.`,
      )
    }
  })

  test('supports POSIX hosts and directs native Windows to WSL', () => {
    for (const platform of ['darwin', 'linux']) {
      expect(() => assertSupportedPlatform(platform)).not.toThrow()
    }
    expect(() => assertSupportedPlatform('win32')).toThrow(
      'HOPI supports macOS, Linux, and WSL hosts; win32 is not supported. Run the Coordinator in WSL when using Windows.',
    )
    expect(() => assertSupportedPlatform('freebsd')).toThrow('freebsd is not supported')
  })
})
