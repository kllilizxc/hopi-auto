import { describe, expect, test } from 'bun:test'
import {
  PREVIEW_RUNTIME_INPUT_MAX_ENTRIES,
  PREVIEW_RUNTIME_INPUT_MAX_KEY_LENGTH,
  PREVIEW_RUNTIME_INPUT_MAX_VALUE_LENGTH,
  previewRuntimeInputsSchema,
} from '../src/runtime/previewRuntimeInputs'

describe('Preview runtime inputs', () => {
  test('accepts a bounded opaque string map', () => {
    expect(
      previewRuntimeInputsSchema.parse({
        certificatePath: '/tmp/client.pem',
        emptyProjectValue: '',
      }),
    ).toEqual({
      certificatePath: '/tmp/client.pem',
      emptyProjectValue: '',
    })
  })

  test('bounds entry count, key length, value length, and serialized UTF-8 size', () => {
    expect(() =>
      previewRuntimeInputsSchema.parse(
        Object.fromEntries(
          Array.from({ length: PREVIEW_RUNTIME_INPUT_MAX_ENTRIES + 1 }, (_, index) => [
            `input-${index}`,
            'value',
          ]),
        ),
      ),
    ).toThrow(`at most ${PREVIEW_RUNTIME_INPUT_MAX_ENTRIES} entries`)

    expect(() =>
      previewRuntimeInputsSchema.parse({
        ['k'.repeat(PREVIEW_RUNTIME_INPUT_MAX_KEY_LENGTH + 1)]: 'value',
      }),
    ).toThrow()

    expect(() =>
      previewRuntimeInputsSchema.parse({
        input: 'v'.repeat(PREVIEW_RUNTIME_INPUT_MAX_VALUE_LENGTH + 1),
      }),
    ).toThrow()

    expect(() =>
      previewRuntimeInputsSchema.parse({
        first: '界'.repeat(4_000),
        second: '界'.repeat(4_000),
        third: '界'.repeat(4_000),
      }),
    ).toThrow('serialized bytes')
  })
})
