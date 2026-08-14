import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorkerSessionStore } from '../src/runtime/workerSessionStore'

const homeRoot = join(process.cwd(), 'tests', 'tmp', 'worker-session-store')
const scope = { contractRevision: 1, assignmentHash: 'a'.repeat(64), runtimeDigest: 'b'.repeat(64) }
const key = (runId: string) => ({ projectId: 'P-1', goalId: 'G-1', workId: 'W-1', runId })

beforeEach(async () => {
  await rm(homeRoot, { recursive: true, force: true })
  await mkdir(homeRoot, { recursive: true })
})
afterEach(() => rm(homeRoot, { recursive: true, force: true }))

describe('WorkerSessionStore', () => {
  test('keeps provider sessions inside one Run namespace', async () => {
    const store = createWorkerSessionStore(homeRoot)
    await store.write(key('R-1'), scope, {
      transport: 'codex',
      sessionId: 'session-1',
      executionKey: 'execution-1',
    })
    expect((await store.open(key('R-1'), scope)).session?.sessionId).toBe('session-1')
    expect((await store.open(key('R-2'), scope)).session).toBeNull()
  })

  test('invalidates one Run and can clear every Run for one Work', async () => {
    const store = createWorkerSessionStore(homeRoot)
    await store.write(key('R-1'), scope, {
      transport: 'claude',
      sessionId: 'session-1',
      executionKey: 'execution-1',
    })
    await store.invalidateVendor(key('R-1'), scope)
    expect((await store.open(key('R-1'), scope)).session).toBeNull()
    await store.write(key('R-2'), scope, {
      transport: 'opencode',
      sessionId: 'session-2',
      executionKey: 'execution-2',
    })
    await store.clearWork({ projectId: 'P-1', goalId: 'G-1', workId: 'W-1' })
    expect((await store.open(key('R-2'), scope)).session).toBeNull()
  })
})
