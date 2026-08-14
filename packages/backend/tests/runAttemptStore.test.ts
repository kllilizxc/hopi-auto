import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'run-attempt-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})
afterEach(() => rm(temporaryRoot, { recursive: true, force: true }))

describe('RunAttemptStore', () => {
  test('persists one generic queued → running → settled Run', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-14T00:00:00Z'),
    })
    await store.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      workHash: 'a'.repeat(64),
      request: request('isolated_write', 'Implement the Work.'),
    })
    const recorder = await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      runRoot: runRoot('R-1'),
      workHash: 'a'.repeat(64),
    })
    await recorder.setExecution({ transport: 'codex', model: 'gpt-5.6', reasoningEffort: 'high' })
    await recorder.settle({
      termination: 'normal',
      reportMarkdown: 'Implemented and checked.',
      exitCode: 0,
      candidateCommits: [
        { repoId: 'repo-a', baseCommit: 'a'.repeat(40), resultCommit: 'b'.repeat(40) },
      ],
    })

    expect(await store.read('P-1', 'G-1', 'W-1', 'R-1')).toMatchObject({
      status: 'settled',
      termination: 'normal',
      workHash: 'a'.repeat(64),
      workspaceMode: 'isolated_write',
      instructionMarkdown: 'Implement the Work.',
      execution: { transport: 'codex', model: 'gpt-5.6' },
    })
  })

  test('deduplicates identical requests and supersedes a different queued request', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-14T00:00:00Z'),
    })
    const input = {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      workHash: 'a'.repeat(64),
      request: request('read_only', 'Inspect.'),
    } as const
    expect(await store.reserve({ ...input, runId: 'R-1' })).toMatchObject({
      disposition: 'scheduled',
    })
    expect(await store.reserve({ ...input, runId: 'R-2' })).toMatchObject({
      runId: 'R-1',
      disposition: 'already_scheduled',
    })
    await store.reserve({
      ...input,
      runId: 'R-3',
      request: request('read_only', 'Inspect independently.'),
    })
    expect(await store.list('P-1', 'G-1', 'W-1')).toEqual([
      expect.objectContaining({ runId: 'R-3', status: 'queued' }),
      expect.objectContaining({ runId: 'R-1', status: 'settled', termination: 'interrupted' }),
    ])
  })

  test('restart settles an abandoned running Run exactly once', async () => {
    const first = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-14T00:00:00Z'),
    })
    await first.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      workHash: 'a'.repeat(64),
      request: request('none', 'Research.'),
    })
    await first.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      runRoot: runRoot('R-1'),
      workHash: 'a'.repeat(64),
    })
    const restarted = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-14T00:01:00Z'),
    })
    expect(await restarted.interruptRunningAttempts()).toBe(1)
    expect(await restarted.interruptRunningAttempts()).toBe(0)
    expect(await restarted.read('P-1', 'G-1', 'W-1', 'R-1')).toMatchObject({
      status: 'settled',
      termination: 'interrupted',
    })
  })

  test('ignores an invalid Attempt manifest', async () => {
    const root = runRoot('R-invalid')
    await mkdir(root, { recursive: true })
    await Bun.write(
      join(root, 'attempt.json'),
      JSON.stringify({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-invalid',
        unsupportedOwner: 'unknown',
        status: 'finished',
      }),
    )
    expect(
      await createRunAttemptStore(temporaryRoot).read('P-1', 'G-1', 'W-1', 'R-invalid'),
    ).toBeNull()
  })
})

function request(
  workspaceMode: 'none' | 'read_only' | 'isolated_write',
  instructionMarkdown: string,
) {
  return { workspaceMode, instructionMarkdown, refs: [] }
}
function runRoot(runId: string) {
  return join(temporaryRoot, '.hopi', 'runtime', 'runs', runId)
}
