import { describe, expect, test } from 'bun:test'
import { normalizeLaneParallelism } from '../src/runtime/laneParallelism'

describe('normalizeLaneParallelism', () => {
  test('hard-caps merging concurrency at one even when callers request more', () => {
    expect(
      normalizeLaneParallelism({
        in_progress: 4,
        in_review: 2,
        merging: 5,
      }),
    ).toEqual({
      in_progress: 4,
      in_review: 2,
      merging: 1,
    })
  })
})
