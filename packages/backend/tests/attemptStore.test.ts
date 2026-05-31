import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAttemptStore } from '../src/runtime/attemptStore'
import { createProjectPaths } from '../src/storage/paths'

const tmpRoot = join(process.cwd(), 'tests', 'tmp', 'attempt-store')

async function resetTmpRoot() {
  await rm(tmpRoot, { recursive: true, force: true })
}

afterEach(async () => {
  await resetTmpRoot()
})

describe('createAttemptStore', () => {
  test('returns zero for a missing attempts overlay', async () => {
    const attempts = createAttemptStore(tmpRoot)

    expect(await attempts.get('T-1', 'merge_conflict')).toBe(0)
  })

  test('increments and persists attempts', async () => {
    const attempts = createAttemptStore(tmpRoot)

    expect(await attempts.increment('T-1', 'merge_conflict')).toBe(1)
    expect(await attempts.increment('T-1', 'merge_conflict')).toBe(2)

    const freshAttempts = createAttemptStore(tmpRoot)
    expect(await freshAttempts.get('T-1', 'merge_conflict')).toBe(2)

    const paths = createProjectPaths(tmpRoot)
    const raw = JSON.parse(await Bun.file(paths.attemptsPath()).text())
    expect(raw).toEqual({ 'T-1:merge_conflict': 2 })
  })

  test('resets one attempt bucket without touching others', async () => {
    const attempts = createAttemptStore(tmpRoot)

    await attempts.increment('T-1', 'merge_conflict')
    await attempts.increment('T-1', 'reviewer_rejected')
    await attempts.reset('T-1', 'merge_conflict')

    expect(await attempts.get('T-1', 'merge_conflict')).toBe(0)
    expect(await attempts.get('T-1', 'reviewer_rejected')).toBe(1)
  })

  test('keeps different tasks and failure kinds separate', async () => {
    const attempts = createAttemptStore(tmpRoot)

    await attempts.increment('T-1', 'merge_conflict')
    await attempts.increment('T-1', 'timeout')
    await attempts.increment('T-2', 'merge_conflict')

    expect(await attempts.get('T-1', 'merge_conflict')).toBe(1)
    expect(await attempts.get('T-1', 'timeout')).toBe(1)
    expect(await attempts.get('T-2', 'merge_conflict')).toBe(1)
    expect(await attempts.get('T-2', 'timeout')).toBe(0)
  })
})
