import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'run-attempt-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('RunAttemptStore', () => {
  test('persists one queued → running → settled Attempt with Report and candidate commits', async () => {
    let tick = 0
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date(Date.UTC(2026, 7, 13, 0, 0, tick++)),
    })
    await store.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      workHash: 'a'.repeat(64),
      request: runRequest('generator', 'isolated_write', 'Implement the Work.'),
    })
    expect((await store.snapshot()).queued()).toHaveLength(1)

    const recorder = await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      responsibility: 'generator',
      runRoot: runRoot('R-1'),
    })
    await Bun.write(join(runRoot('R-1'), 'prompt.md'), '# Run\n')
    await recorder.setExecution({
      transport: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    })
    await recorder.settle({
      termination: 'normal',
      reportMarkdown: '# Report\n\nImplemented and checked.',
      exitCode: 0,
      candidateCommits: [
        { repoId: 'repo-a', baseCommit: 'a'.repeat(40), resultCommit: 'b'.repeat(40) },
      ],
    })

    expect(await store.read('P-1', 'G-1', 'W-1', 'R-1')).toMatchObject({
      status: 'settled',
      termination: 'normal',
      reportMarkdown: '# Report\n\nImplemented and checked.',
      workspaceMode: 'isolated_write',
      instructionMarkdown: 'Implement the Work.',
      execution: { transport: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' },
      candidateCommits: [{ repoId: 'repo-a', resultCommit: 'b'.repeat(40) }],
      runPrompt: '# Run\n',
    })
  })

  test('starts only an explicitly queued Attempt', async () => {
    const store = createRunAttemptStore(temporaryRoot)
    expect(
      store.start({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-missing',
        responsibility: 'planner',
        runRoot: runRoot('R-missing'),
      }),
    ).rejects.toThrow('Queued Attempt not found')
  })

  test('deduplicates the same explicit request and settles a superseded queued request', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-13T00:00:00Z'),
    })
    const input = {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      workHash: 'a'.repeat(64),
      request: runRequest('generator', 'isolated_write', 'First instruction.'),
    } as const
    expect(await store.reserve({ ...input, runId: 'R-1' })).toMatchObject({
      runId: 'R-1',
      disposition: 'scheduled',
    })
    expect(await store.reserve({ ...input, runId: 'R-2' })).toMatchObject({
      runId: 'R-1',
      disposition: 'already_scheduled',
    })
    await store.reserve({
      ...input,
      runId: 'R-3',
      request: runRequest('reviewer', 'read_only', 'Review independently.'),
    })
    const attempts = await store.list('P-1', 'G-1', 'W-1')
    expect(attempts).toEqual([
      expect.objectContaining({ runId: 'R-3', status: 'queued' }),
      expect.objectContaining({
        runId: 'R-1',
        status: 'settled',
        termination: 'interrupted',
        reportMarkdown: expect.stringContaining('superseded'),
      }),
    ])
  })

  test('restart settles an abandoned running Attempt exactly once with a factual Report', async () => {
    const first = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-13T00:00:00Z'),
    })
    await first.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-running',
      workHash: 'a'.repeat(64),
      request: runRequest('generator', 'isolated_write', 'Implement.'),
    })
    await first.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-running',
      responsibility: 'generator',
      runRoot: runRoot('R-running'),
    })

    const restarted = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-08-13T00:01:00Z'),
    })
    const recoveredCommits = [
      { repoId: 'primary', baseCommit: 'b'.repeat(40), resultCommit: 'c'.repeat(40) },
    ]
    const recovered: string[] = []
    expect(
      await restarted.interruptRunningAttempts(async (attempt) => {
        recovered.push(attempt.runId)
        return recoveredCommits
      }),
    ).toBe(1)
    expect(await restarted.interruptRunningAttempts()).toBe(0)
    expect(recovered).toEqual(['R-running'])
    expect(await restarted.read('P-1', 'G-1', 'W-1', 'R-running')).toMatchObject({
      status: 'settled',
      termination: 'interrupted',
      candidateCommits: recoveredCommits,
      reportMarkdown: expect.stringContaining(
        'Coordinator stopped before the running Attempt settled.',
      ),
    })
  })

  test('does not interpret a pre-switch manifest through a compatibility fallback', async () => {
    const root = runRoot('R-old')
    await mkdir(root, { recursive: true })
    await Bun.write(
      join(root, 'attempt.json'),
      `${JSON.stringify({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-old',
        responsibility: 'generator',
        status: 'finished',
        result: 'success',
      })}\n`,
    )
    const store = createRunAttemptStore(temporaryRoot)
    expect(await store.read('P-1', 'G-1', 'W-1', 'R-old')).toBeNull()
    expect((await store.snapshot()).list('P-1', 'G-1', 'W-1')).toEqual([])
  })
})

function runRequest(
  profile: 'planner' | 'generator' | 'reviewer',
  workspaceMode: 'none' | 'read_only' | 'isolated_write',
  instructionMarkdown: string,
) {
  return { profile, workspaceMode, instructionMarkdown, refs: [] }
}

function runRoot(runId: string) {
  return join(temporaryRoot, '.hopi', 'runtime', 'runs', runId)
}
