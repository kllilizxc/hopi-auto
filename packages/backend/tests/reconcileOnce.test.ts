import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { MockAgentRunner } from '../src/agent/AgentRunner'
import type { TaskItem } from '../src/domain/board'
import { createAttemptStore } from '../src/runtime/attemptStore'
import { reconcileOnce } from '../src/scheduler/reconcileOnce'
import { createBoardStore } from '../src/storage/boardStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'reconcile-once')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('reconcileOnce', () => {
  test('removes task blockers whose referenced task is done', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'T-1', status: 'done' }),
      task({
        ref: 'T-2',
        blockedBy: [
          { kind: 'task', ref: 'T-1' },
          { kind: 'decision', ref: 'D-1' },
        ],
      }),
    ])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner(),
      }),
    ).resolves.toEqual({ kind: 'idle' })

    await expect(readTask(store, 'T-2')).resolves.toMatchObject({
      blockedBy: [{ kind: 'decision', ref: 'D-1' }],
    })

    const events = await Bun.file(store.paths.eventsPath(goalKey)).text()
    expect(events).toContain('"action":"task_blocker_resolved"')
    expect(events).toContain('"reason":"task:T-1"')
  })

  test('advances an engineering task from planned to in_review', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1' })])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner(),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({ status: 'in_review' })
  })

  test('returns engineering reviewer rejections to planned', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'in_review' })])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'T-1:reviewer': [{ kind: 'reject', reason: 'needs tests' }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('T-1', 'reviewer_rejected')).resolves.toBe(1)
  })

  test('writes an intervention blocker when reviewer rejection budget is exhausted', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'in_review' })])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'T-1:reviewer': [{ kind: 'reject', reason: 'needs tests' }],
        }),
        maxAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'blocked',
      taskRef: 'T-1',
      blocker: { kind: 'intervention', ref: 'T-1:reviewer_rejected' },
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'planned',
      blockedBy: [{ kind: 'intervention', ref: 'T-1:reviewer_rejected' }],
    })
  })

  test('retries merge conflicts by returning engineering tasks to planned', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'T-1:merger': [{ kind: 'merge_conflict', artifactRef: 'patch-1' }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'planned',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'planned',
      blockedBy: [],
    })
    await expect(attempts.get('T-1', 'merge_conflict')).resolves.toBe(1)
  })

  test('writes a merge_conflict blocker when merge conflict budget is exhausted', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'T-1:merger': [{ kind: 'merge_conflict', artifactRef: 'patch-1' }],
        }),
        maxAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'blocked',
      taskRef: 'T-1',
      blocker: { kind: 'merge_conflict', ref: 'patch-1' },
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'planned',
      blockedBy: [{ kind: 'merge_conflict', ref: 'patch-1' }],
    })
  })

  test('uses the planner role for planning tasks in planned status', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-1', kind: 'planning', status: 'planned' }),
    ])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'P-1:generator': [{ kind: 'fail', reason: 'wrong role' }],
          'P-1:planner': [{ kind: 'success' }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-1',
      from: 'planned',
      to: 'in_review',
    })

    await expect(readTask(store, 'P-1')).resolves.toMatchObject({ status: 'in_review' })
  })

  test('marks planning tasks done after merge success', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-1', kind: 'planning', status: 'merging' }),
    ])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'P-1:merger': [{ kind: 'success' }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-1',
      from: 'merging',
      to: 'done',
    })

    await expect(readTask(store, 'P-1')).resolves.toMatchObject({ status: 'done' })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function seedBoard(rootDir: string, items: TaskItem[]) {
  const store = createBoardStore(rootDir)
  await store.mutateBoard(goalKey, 'test', 'seed board', (board) => {
    board.goal.title = 'Test Goal'
    board.items = items
  })
  return store
}

async function readTask(store: ReturnType<typeof createBoardStore>, ref: string) {
  const board = await store.readBoard(goalKey)
  const item = board.items.find((candidate) => candidate.ref === ref)
  if (!item) {
    throw new Error(`Missing task ${ref}`)
  }
  return item
}

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    ref: 'T-1',
    kind: 'engineering',
    status: 'planned',
    title: 'Task',
    description: 'Do the task',
    acceptanceCriteria: ['Task is complete'],
    blockedBy: [],
    ...overrides,
  }
}
