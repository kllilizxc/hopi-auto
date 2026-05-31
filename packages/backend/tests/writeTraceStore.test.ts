import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'write-trace-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createWriteTraceStore', () => {
  test('reads a missing trace file as an empty goal trace', async () => {
    const store = createWriteTraceStore(testRoot())

    await expect(store.readGoalTrace(goalKey)).resolves.toEqual({
      goalKey,
      entries: [],
    })
  })

  test('appends compact JSONL write-trace entries and reads them back in order', async () => {
    const store = createWriteTraceStore(testRoot())

    const first = await store.appendEntry(goalKey, {
      runId: 'run-1',
      stepId: 'step-1',
      taskRef: 'T-1',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/worktree',
      toolName: 'process',
      callId: 'step-1',
      targetPaths: ['src/index.ts'],
      changes: [{ path: 'src/index.ts', kind: 'modified' }],
      argumentSummary: 'bun run build-task',
      resultSummary: 'exit 0 (1 changed file)',
    })
    const second = await store.appendEntry(goalKey, {
      runId: 'run-2',
      stepId: 'step-2',
      taskRef: 'T-2',
      role: 'reviewer',
      agent: 'process_runner',
      cwd: '/tmp/worktree-2',
      toolName: 'process',
      callId: 'step-2',
      targetPaths: ['README.md', 'src/index.ts'],
      changes: [
        { path: 'README.md', kind: 'added' },
        { path: 'src/index.ts', kind: 'deleted' },
      ],
      argumentSummary: 'bun run review-task',
      resultSummary: 'exit 0 (2 changed files)',
    })

    expect(first.id).toBeString()
    expect(first.timestamp).toBeString()
    expect(second.id).toBeString()
    expect(second.timestamp).toBeString()
    await expect(store.readGoalTrace(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          runId: 'run-1',
          stepId: 'step-1',
          taskRef: 'T-1',
          role: 'generator',
          targetPaths: ['src/index.ts'],
          changes: [{ path: 'src/index.ts', kind: 'modified' }],
          argumentSummary: 'bun run build-task',
        },
        {
          runId: 'run-2',
          stepId: 'step-2',
          taskRef: 'T-2',
          role: 'reviewer',
          targetPaths: ['README.md', 'src/index.ts'],
          changes: [
            { path: 'README.md', kind: 'added' },
            { path: 'src/index.ts', kind: 'deleted' },
          ],
          resultSummary: 'exit 0 (2 changed files)',
        },
      ],
    })
  })

  test('filters write traces by run, step, task, role, and limit in newest-first order', async () => {
    const store = createWriteTraceStore(testRoot())

    await store.appendEntry(goalKey, {
      runId: 'run-1',
      stepId: 'step-1',
      taskRef: 'T-1',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/1',
      toolName: 'process',
      callId: 'step-1',
      targetPaths: ['a.ts'],
      changes: [{ path: 'a.ts', kind: 'added' }],
      argumentSummary: 'cmd 1',
      resultSummary: 'exit 0 (1 changed file)',
    })
    await store.appendEntry(goalKey, {
      runId: 'run-1',
      stepId: 'step-2',
      taskRef: 'T-1',
      role: 'reviewer',
      agent: 'process_runner',
      cwd: '/tmp/2',
      toolName: 'process',
      callId: 'step-2',
      targetPaths: ['a.ts', 'b.ts'],
      changes: [{ path: 'b.ts', kind: 'modified' }],
      argumentSummary: 'cmd 2',
      resultSummary: 'exit 0 (1 changed file)',
    })
    await store.appendEntry(goalKey, {
      runId: 'run-2',
      stepId: 'step-3',
      taskRef: 'T-2',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/3',
      toolName: 'process',
      callId: 'step-3',
      targetPaths: ['c.ts'],
      changes: [{ path: 'c.ts', kind: 'deleted' }],
      argumentSummary: 'cmd 3',
      resultSummary: 'exit 0 (1 changed file)',
    })

    await expect(store.listEntries(goalKey)).resolves.toMatchObject([
      { runId: 'run-2', stepId: 'step-3' },
      { runId: 'run-1', stepId: 'step-2' },
      { runId: 'run-1', stepId: 'step-1' },
    ])
    await expect(store.listEntries(goalKey, { runId: 'run-1' })).resolves.toMatchObject([
      { stepId: 'step-2' },
      { stepId: 'step-1' },
    ])
    await expect(
      store.listEntries(goalKey, { taskRef: 'T-1', role: 'reviewer' }),
    ).resolves.toMatchObject([{ stepId: 'step-2', role: 'reviewer' }])
    await expect(store.listEntries(goalKey, { stepId: 'step-1', limit: 1 })).resolves.toMatchObject(
      [{ stepId: 'step-1' }],
    )
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
