import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createResponsibilitySessionStore } from '../src/runtime/responsibilitySessionStore'

const homeRoot = join(process.cwd(), 'tests', 'tmp', 'responsibility-session-store')
const scope = {
  contractRevision: 1,
  assignmentHash: 'a'.repeat(64),
  runtimeDigest: 'b'.repeat(64),
}

beforeEach(async () => {
  await rm(homeRoot, { recursive: true, force: true })
  await mkdir(homeRoot, { recursive: true })
})

afterEach(async () => {
  await rm(homeRoot, { recursive: true, force: true })
})

describe('ResponsibilitySessionStore', () => {
  test('persists a provider Session only inside one Run', async () => {
    const store = createResponsibilitySessionStore(homeRoot)
    const firstKey = key('R-1')
    const secondKey = key('R-2')
    expect((await store.open(firstKey, scope)).session).toBeNull()
    await store.write(firstKey, scope, {
      transport: 'codex',
      sessionId: 'vendor-session-1',
      executionKey: 'execution-1',
    })
    expect((await store.open(firstKey, scope)).session).toMatchObject({
      sessionId: 'vendor-session-1',
    })
    expect((await store.open(secondKey, scope)).session).toBeNull()
    expect((await store.open(secondKey, scope)).workspaceDir).toContain('run-R-2')
  })

  test('invalidates one Run without touching another Run', async () => {
    const store = createResponsibilitySessionStore(homeRoot)
    await store.write(key('R-1'), scope, {
      transport: 'claude',
      sessionId: 'session-1',
      executionKey: 'execution-1',
    })
    await store.write(key('R-2'), scope, {
      transport: 'claude',
      sessionId: 'session-2',
      executionKey: 'execution-2',
    })
    await store.invalidateVendor(key('R-1'), scope)
    expect((await store.open(key('R-1'), scope)).session).toBeNull()
    expect((await store.open(key('R-2'), scope)).session?.sessionId).toBe('session-2')
  })

  test('clearWork removes every Run-local Session for that Work', async () => {
    const store = createResponsibilitySessionStore(homeRoot)
    await store.write(key('R-1'), scope, {
      transport: 'opencode',
      sessionId: 'session-1',
      executionKey: 'execution-1',
    })
    await store.clearWork({ projectId: 'P-1', goalId: 'G-1', workId: 'W-1' })
    expect((await store.open(key('R-1'), scope)).session).toBeNull()
  })
})

function key(runId: string) {
  return {
    projectId: 'P-1',
    goalId: 'G-1',
    workId: 'W-1',
    runId,
    responsibility: 'generator' as const,
  }
}
