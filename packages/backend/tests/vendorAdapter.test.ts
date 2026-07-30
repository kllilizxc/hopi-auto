import { describe, expect, test } from 'bun:test'
import {
  VENDOR_ADAPTERS,
  transportForTranscriptFormat,
  vendorAdapterFor,
} from '../src/agent/vendorAdapter'

describe('vendor adapter registry', () => {
  test('owns one bijective transcript format for every built-in transport', () => {
    for (const adapter of Object.values(VENDOR_ADAPTERS)) {
      expect(vendorAdapterFor(adapter.transport)).toBe(adapter)
      expect(transportForTranscriptFormat(adapter.transcriptFormat)).toBe(adapter.transport)
    }
    expect(
      new Set(Object.values(VENDOR_ADAPTERS).map((adapter) => adapter.transcriptFormat)).size,
    ).toBe(Object.keys(VENDOR_ADAPTERS).length)
  })

  test('keeps provider-specific native compaction controls in the registry', () => {
    expect(vendorAdapterFor('codex').autoCompactionDisableKeys).toEqual([])
    expect(vendorAdapterFor('claude').autoCompactionDisableKeys).toContain('DISABLE_AUTO_COMPACT')
    expect(vendorAdapterFor('opencode').autoCompactionDisableKeys).toContain(
      'OPENCODE_DISABLE_AUTOCOMPACT',
    )
  })
})
