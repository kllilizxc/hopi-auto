import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type CoordinatorInstanceLock,
  CoordinatorInstanceLockError,
  acquireCoordinatorInstanceLock,
  readCoordinatorLockOwner,
} from '../src/publication/instanceLock'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'coordinator-instance-lock')
const heldLocks: CoordinatorInstanceLock[] = []

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await Promise.all(heldLocks.splice(0).map((lock) => lock.release()))
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('acquireCoordinatorInstanceLock', () => {
  test('holds one OS lock for the Coordinator lifetime', async () => {
    const path = join(temporaryRoot, 'coordinator.lock')
    const first = await acquireCoordinatorInstanceLock(path, {
      kind: 'coordinator',
      port: 3000,
    })
    heldLocks.push(first)
    expect(await readCoordinatorLockOwner(path)).toEqual(first.owner)

    await expect(acquireCoordinatorInstanceLock(path)).rejects.toBeInstanceOf(
      CoordinatorInstanceLockError,
    )

    await first.release()
    heldLocks.splice(heldLocks.indexOf(first), 1)
    const replacement = await acquireCoordinatorInstanceLock(path)
    heldLocks.push(replacement)
    expect(replacement.path).toBe(path)
    expect(replacement.owner.instanceId).not.toBe(first.owner.instanceId)
  })

  test('removes only the released instance owner record', async () => {
    const path = join(temporaryRoot, 'coordinator.lock')
    const lock = await acquireCoordinatorInstanceLock(path, { kind: 'coordinator' })
    heldLocks.push(lock)

    await lock.release()
    heldLocks.splice(heldLocks.indexOf(lock), 1)

    expect(await readCoordinatorLockOwner(path)).toBeNull()
  })
})
