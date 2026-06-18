import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner, AgentStepInput } from '../src/agent/AgentRunner'
import { MockAgentRunner } from '../src/agent/AgentRunner'
import { ProcessAgentRunner } from '../src/agent/ProcessAgentRunner'
import type { TaskItem } from '../src/domain/board'
import { createAttemptStore } from '../src/runtime/attemptStore'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'
import { RunningTaskRegistry } from '../src/runtime/runningTaskRegistry'
import { createWorktreeManager } from '../src/runtime/worktreeManager'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { reconcileOnce } from '../src/scheduler/reconcileOnce'
import { createBoardStore } from '../src/storage/boardStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'

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

  test('retargets engineering blockers to the next grouped planning leaf during cleanup', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({
        ref: 'P-1',
        kind: 'planning',
        status: 'done',
        title: 'Clarify auth goal context',
        description: 'Goal context is durable.',
      }),
      task({
        ref: 'P-2',
        kind: 'planning',
        status: 'planned',
        title: 'Decompose auth task graph',
        description: 'Todo follow-through stays open.',
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      }),
      task({
        ref: 'T-2',
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      }),
    ])
    const planningRequests = createPlanningRequestStore(rootDir)
    await planningRequests.createRequest(goalKey, {
      requestKey: 'PR-1',
      groupKey: 'auth-follow-through',
      groupTaskKey: 'goal-docs',
      title: 'Clarify auth goal context',
      description: 'Goal context is durable.',
      acceptanceCriteria: ['Goal context is durable.'],
      taskRef: 'P-1',
      decisionRefs: ['auth-strategy'],
      requestedUpdates: ['goal.md', 'design.md'],
    })
    await planningRequests.resolveRequest(goalKey, 'PR-1', {
      resolution: 'Planning task P-1 completed.',
    })
    await planningRequests.createRequest(goalKey, {
      requestKey: 'PR-2',
      groupKey: 'auth-follow-through',
      groupTaskKey: 'task-graph',
      title: 'Decompose auth task graph',
      description: 'Todo follow-through stays open.',
      acceptanceCriteria: ['The auth task graph is visible.'],
      taskRef: 'P-2',
      decisionRefs: ['auth-strategy'],
      requestedUpdates: ['todo.yml'],
    })

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner(),
      }),
    ).resolves.toEqual({ kind: 'idle' })

    await expect(readTask(store, 'P-2')).resolves.toMatchObject({
      blockedBy: [],
    })
    await expect(readTask(store, 'T-2')).resolves.toMatchObject({
      blockedBy: [{ kind: 'task', ref: 'P-2' }],
    })
  })

  test('removes decision blockers whose decision topic is resolved', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({
        ref: 'T-2',
        blockedBy: [{ kind: 'decision', ref: 'db-provider' }],
      }),
    ])
    const decisions = createDecisionStore(rootDir)
    await decisions.createDecision(goalKey, {
      decisionKey: 'db-provider',
      summary: 'Choose the database provider',
      taskRef: 'T-2',
    })
    await decisions.resolveDecision(goalKey, 'db-provider', {
      answer: 'Use Postgres.',
    })

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner(),
      }),
    ).resolves.toEqual({ kind: 'idle' })

    await expect(readTask(store, 'T-2')).resolves.toMatchObject({
      blockedBy: [],
    })

    const events = await Bun.file(store.paths.eventsPath(goalKey)).text()
    expect(events).toContain('"action":"decision_blocker_resolved"')
    expect(events).toContain('"reason":"decision:db-provider"')
  })

  test('advances an engineering task from planned to in_review', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1' })])
    const history = createRunHistoryStore(rootDir)
    const calls: AgentStepInput[] = []
    const runner: AgentRunner = {
      async run(input, observer) {
        calls.push(input)
        await observer?.onEvent?.({
          kind: 'worktree_prepared',
          path: '.hopi/worktrees/T-1',
          branch: 'task/T-1',
          baseBranch: 'main',
        })
        await observer?.onEvent?.({
          kind: 'message',
          level: 'info',
          role: 'generator',
          content: 'Generated patch for T-1',
        })
        await observer?.onEvent?.({
          kind: 'artifact',
          ref: 'patch:T-1',
          label: 'Generated patch',
        })
        return { kind: 'success', artifactRef: 'patch:T-1' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        history,
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({ status: 'in_review' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.runId).toBeString()
    expect(calls[0]?.stepId).toBeString()
    await expect(history.readGoalHistory(goalKey)).resolves.toMatchObject({
      goalKey,
      runs: [
        {
          taskRef: 'T-1',
          status: 'active',
          steps: [
            {
              role: 'generator',
              statusBefore: 'planned',
              statusAfter: 'in_review',
              outcome: 'success',
              execution: {
                worktree: {
                  path: '.hopi/worktrees/T-1',
                  branch: 'task/T-1',
                  baseBranch: 'main',
                },
                artifacts: [{ ref: 'patch:T-1', label: 'Generated patch' }],
              },
              messages: [
                { kind: 'system', role: 'system', content: 'generator dispatched for T-1' },
                { kind: 'info', role: 'generator', content: 'Generated patch for T-1' },
                { kind: 'system', role: 'system', content: 'T-1 advanced to in_review' },
              ],
            },
          ],
        },
      ],
    })
  })

  test('marks planned generator work as in_progress while the agent is running', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'planned' })])

    const runner: AgentRunner = {
      async run() {
        await expect(readTask(store, 'T-1')).resolves.toMatchObject({
          status: 'in_progress',
        })
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })
  })

  test('continues in_progress generator work instead of treating it as idle', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'in_progress' })])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'T-1:generator': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'in_progress',
      to: 'in_review',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({ status: 'in_review' })
  })

  test('keeps reviewer work in the in_review lane while the agent is running', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'in_review' })])

    const runner: AgentRunner = {
      async run() {
        await expect(readTask(store, 'T-1')).resolves.toMatchObject({
          status: 'in_review',
        })
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'in_review',
      to: 'merging',
    })
  })

  test('keeps merger work in the merging lane while the agent is running', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])

    const runner: AgentRunner = {
      async run() {
        await expect(readTask(store, 'T-1')).resolves.toMatchObject({
          status: 'merging',
        })
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        mergeExecutor: {
          async completeMerge() {
            return { kind: 'success' }
          },
        },
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'done',
    })
  })

  test('completes a merger step without launching the merger agent when the merge script already succeeds', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    let finalized = false
    let runnerCalled = false

    const runner: AgentRunner = {
      async run() {
        runnerCalled = true
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        mergeExecutor: {
          async runMergeScript() {
            return {
              attemptedAt: '2026-06-16T00:00:00.000Z',
              scriptPath: '/repo/scripts/hopi/merge-task.sh',
              command: ['bash', '/repo/scripts/hopi/merge-task.sh'],
              stdout: '{"kind":"merged","reason":"merged"}\n',
              stderr: '',
              exitCode: 0,
              result: {
                kind: 'merged',
                reason: 'merged',
              },
            }
          },
          async finalizeMergedRun() {
            finalized = true
          },
          async completeMerge() {
            throw new Error('completeMerge should not be used when script-first merge is available')
          },
        },
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'done',
    })

    expect(runnerCalled).toBeFalse()
    expect(finalized).toBeTrue()
  })

  test('falls back to the merger agent when the merge script requests merger handling and verifies the script afterward', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    let finalized = false
    let mergeScriptCalls = 0
    let runnerCalls = 0

    const runner: AgentRunner = {
      async run() {
        runnerCalls += 1
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        mergeExecutor: {
          async runMergeScript() {
            mergeScriptCalls += 1
            if (mergeScriptCalls === 1) {
              return {
                attemptedAt: '2026-06-16T00:00:00.000Z',
                scriptPath: '/repo/scripts/hopi/merge-task.sh',
                command: ['bash', '/repo/scripts/hopi/merge-task.sh'],
                stdout: '{"kind":"needs_merger","reason":"root has overlap"}\n',
                stderr: '',
                exitCode: 0,
                result: {
                  kind: 'needs_merger',
                  reason: 'root has overlap',
                },
              }
            }

            return {
              attemptedAt: '2026-06-16T00:01:00.000Z',
              scriptPath: '/repo/scripts/hopi/merge-task.sh',
              command: ['bash', '/repo/scripts/hopi/merge-task.sh'],
              stdout: '{"kind":"merged","reason":"merged after fixer"}\n',
              stderr: '',
              exitCode: 0,
              result: {
                kind: 'merged',
                reason: 'merged after fixer',
              },
            }
          },
          async finalizeMergedRun() {
            finalized = true
          },
          async completeMerge() {
            throw new Error('completeMerge should not be used when script-first merge is available')
          },
        },
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'done',
    })

    expect(runnerCalls).toBe(1)
    expect(mergeScriptCalls).toBe(2)
    expect(finalized).toBeTrue()
  })

  test('blocks immediately without launching the merger agent when the initial merge script reports a deterministic merge_conflict', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    let runnerCalled = false

    const runner: AgentRunner = {
      async run() {
        runnerCalled = true
        return { kind: 'success' }
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        mergeExecutor: {
          async runMergeScript() {
            return {
              attemptedAt: '2026-06-16T00:00:00.000Z',
              scriptPath: '/repo/.hopi/runtime/fallback-merge.sh',
              command: ['bash', '/repo/.hopi/runtime/fallback-merge.sh'],
              stdout:
                '{"kind":"merge_conflict","reason":"Root workspace has local changes blocking merge: src/game/ui/deckbuilder/DeckManagementPanel.ts","artifactRef":"src/game/ui/deckbuilder/DeckManagementPanel.ts","artifactLabel":"root-workspace-dirty"}\n',
              stderr: '',
              exitCode: 0,
              result: {
                kind: 'merge_conflict',
                reason:
                  'Root workspace has local changes blocking merge: src/game/ui/deckbuilder/DeckManagementPanel.ts',
                artifactRef: 'src/game/ui/deckbuilder/DeckManagementPanel.ts',
                artifactLabel: 'root-workspace-dirty',
              },
            }
          },
          async finalizeMergedRun() {
            throw new Error('finalizeMergedRun should not be called for deterministic blockers')
          },
          async completeMerge() {
            throw new Error('completeMerge should not be used when script-first merge is available')
          },
        },
        runner,
      }),
    ).resolves.toEqual({
      kind: 'blocked',
      taskRef: 'T-1',
      blocker: {
        kind: 'merge_conflict',
        ref: 'src/game/ui/deckbuilder/DeckManagementPanel.ts',
      },
    })

    expect(runnerCalled).toBeFalse()
  })

  test('prevents a second reconcile step while one task is running for the goal', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'T-1', status: 'planned' }),
      task({ ref: 'T-2', status: 'planned' }),
    ])
    const runningTasks = new RunningTaskRegistry()
    let releaseRunner!: () => void
    let startedRunner!: () => void
    const runnerStarted = new Promise<void>((resolve) => {
      startedRunner = resolve
    })
    const runnerReleased = new Promise<void>((resolve) => {
      releaseRunner = resolve
    })
    const runner: AgentRunner = {
      async run() {
        startedRunner()
        await runnerReleased
        return { kind: 'success' }
      },
    }

    const first = reconcileOnce({
      goalKey,
      store,
      attempts: createAttemptStore(rootDir),
      runningTasks,
      laneParallelism: {
        in_progress: 1,
        in_review: 1,
        merging: 1,
      },
      runner,
    })
    await runnerStarted

    expect(runningTasks.get(rootDir, goalKey)).toMatchObject({
      taskRef: 'T-1',
      role: 'generator',
    })
    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runningTasks,
        laneParallelism: {
          in_progress: 1,
          in_review: 1,
          merging: 1,
        },
        runner: new MockAgentRunner(),
      }),
    ).resolves.toEqual({ kind: 'idle' })
    await expect(readTask(store, 'T-2')).resolves.toMatchObject({ status: 'planned' })

    releaseRunner()
    await expect(first).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })
    expect(runningTasks.get(rootDir, goalKey)).toBeUndefined()
  })

  test('allows multiple different running tasks when maxParallel permits it', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'T-1', status: 'planned' }),
      task({ ref: 'T-2', status: 'planned' }),
    ])
    const runningTasks = new RunningTaskRegistry()
    let releaseRunners!: () => void
    let startedFirst!: () => void
    let startedSecond!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      startedFirst = resolve
    })
    const secondStarted = new Promise<void>((resolve) => {
      startedSecond = resolve
    })
    const runnersReleased = new Promise<void>((resolve) => {
      releaseRunners = resolve
    })
    const startedTaskRefs: string[] = []
    const runner: AgentRunner = {
      async run(input) {
        startedTaskRefs.push(input.taskRef)
        if (startedTaskRefs.length === 1) {
          startedFirst()
        }
        if (startedTaskRefs.length === 2) {
          startedSecond()
        }
        await runnersReleased
        return { kind: 'success' }
      },
    }

    const first = reconcileOnce({
      goalKey,
      store,
      attempts: createAttemptStore(rootDir),
      runningTasks,
      maxParallel: 2,
      runner,
    })
    await firstStarted
    const second = reconcileOnce({
      goalKey,
      store,
      attempts: createAttemptStore(rootDir),
      runningTasks,
      maxParallel: 2,
      runner,
    })
    await secondStarted

    expect(runningTasks.list(rootDir, goalKey).map((task) => task.taskRef).sort()).toEqual([
      'T-1',
      'T-2',
    ])

    releaseRunners()
    await expect(first).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })
    await expect(second).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-2',
      from: 'planned',
      to: 'in_review',
    })
    expect(runningTasks.list(rootDir, goalKey)).toEqual([])
  })

  test('does not dispatch a second planner while one planner task is already running', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-1', kind: 'planning', status: 'planned' }),
      task({ ref: 'P-2', kind: 'planning', status: 'planned' }),
      task({ ref: 'T-1', kind: 'engineering', status: 'planned' }),
    ])
    const runningTasks = new RunningTaskRegistry()
    const plannerLease = runningTasks.acquire({
      rootDir,
      goalKey,
      taskRef: 'P-1',
      role: 'planner',
      lane: 'in_progress',
      laneLimit: 3,
      roleLimit: 1,
    })
    if (!plannerLease) {
      throw new Error('Expected planner lease')
    }

    const result = await reconcileOnce({
      goalKey,
      store,
      attempts: createAttemptStore(rootDir),
      runningTasks,
      maxParallel: 3,
      runner: new MockAgentRunner(),
      writer: 'test',
    })

    expect(result).toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })
    plannerLease.release()
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
          'T-1:reviewer': [{ outcome: { kind: 'reject', reason: 'needs tests' } }],
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
          'T-1:reviewer': [{ outcome: { kind: 'reject', reason: 'needs tests' } }],
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

  test('retries merge conflicts while keeping engineering tasks in merging', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        mergeExecutor: {
          async completeMerge() {
            throw new Error('completeMerge should not be used for agent merge-conflict retry tests')
          },
        },
        runner: new MockAgentRunner({
          'T-1:merger': [{ outcome: { kind: 'merge_conflict', artifactRef: 'patch-1' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'merging',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'merging',
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
        mergeExecutor: {
          async completeMerge() {
            throw new Error(
              'completeMerge should not be used for agent merge-conflict blocker tests',
            )
          },
        },
        runner: new MockAgentRunner({
          'T-1:merger': [{ outcome: { kind: 'merge_conflict', artifactRef: 'patch-1' } }],
        }),
        maxAttempts: 1,
      }),
    ).resolves.toEqual({
      kind: 'blocked',
      taskRef: 'T-1',
      blocker: { kind: 'merge_conflict', ref: 'patch-1' },
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'merging',
      blockedBy: [{ kind: 'merge_conflict', ref: 'patch-1' }],
    })
  })

  test('executes a real engineering merge before marking merger work done', async () => {
    const rootDir = await initGitRepo(testRoot())
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    const history = createRunHistoryStore(rootDir)
    const worktrees = createWorktreeManager(rootDir)
    const attempts = createAttemptStore(rootDir)
    const runId = await seedActiveMergingRun(history)
    const prepared = await worktrees.prepare({
      goalKey,
      taskRef: 'T-1',
      runId,
    })

    await writeFile(join(prepared.path, 'merged.txt'), 'merged by executor\n', 'utf8')
    await git(prepared.path, ['add', 'merged.txt'])
    await git(prepared.path, ['commit', '-m', 'merge candidate'])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        history,
        runner: new MockAgentRunner({
          'T-1:merger': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'done',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({ status: 'done' })
    expect((await Bun.file(join(rootDir, 'merged.txt')).text()).trim()).toBe('merged by executor')
    expect(await pathExists(prepared.path)).toBeFalse()
    await expect(history.readGoalHistory(goalKey)).resolves.toMatchObject({
      runs: [
        {
          runId,
          status: 'completed',
          terminalOutcome: 'success',
          finalTaskStatus: 'done',
        },
      ],
    })
  })

  test('routes merge executor conflicts back into merging retry state', async () => {
    const rootDir = await initGitRepo(testRoot())
    const store = await seedBoard(rootDir, [task({ ref: 'T-1', status: 'merging' })])
    const history = createRunHistoryStore(rootDir)
    const worktrees = createWorktreeManager(rootDir)
    const attempts = createAttemptStore(rootDir)
    const runId = await seedActiveMergingRun(history)
    const prepared = await worktrees.prepare({
      goalKey,
      taskRef: 'T-1',
      runId,
    })

    await writeFile(join(prepared.path, 'shared.txt'), 'worktree version\n', 'utf8')
    await git(prepared.path, ['add', 'shared.txt'])
    await git(prepared.path, ['commit', '-m', 'worktree change'])

    await writeFile(join(rootDir, 'shared.txt'), 'root version\n', 'utf8')
    await git(rootDir, ['add', 'shared.txt'])
    await git(rootDir, ['commit', '-m', 'root change'])

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        history,
        runner: new MockAgentRunner({
          'T-1:merger': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'merging',
      to: 'merging',
    })

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'merging',
      blockedBy: [],
    })
    expect(await pathExists(prepared.path)).toBeTrue()
    await expect(attempts.get('T-1', 'merge_conflict')).resolves.toBe(1)
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
          'P-1:generator': [{ outcome: { kind: 'fail', reason: 'wrong role' } }],
          'P-1:planner': [{ outcome: { kind: 'success' } }],
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

  test('retries planner failures before the attempt budget is exhausted', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-2', kind: 'planning', status: 'planned' }),
    ])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'P-2:planner': [{ outcome: { kind: 'fail', reason: 'missing planning output' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-2',
      from: 'planned',
      to: 'planned',
    })

    await expect(readTask(store, 'P-2')).resolves.toMatchObject({
      status: 'planned',
      blockedBy: [],
    })
    await expect(attempts.get('P-2', 'agent_failed')).resolves.toBe(1)
  })

  test('writes an intervention blocker when planner failure budget is exhausted', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-3', kind: 'planning', status: 'planned' }),
    ])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        maxAttempts: 1,
        runner: new MockAgentRunner({
          'P-3:planner': [{ outcome: { kind: 'fail', reason: 'missing planning output' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'blocked',
      taskRef: 'P-3',
      blocker: { kind: 'intervention', ref: 'P-3:agent_failed' },
    })

    await expect(readTask(store, 'P-3')).resolves.toMatchObject({
      status: 'planned',
      blockedBy: [{ kind: 'intervention', ref: 'P-3:agent_failed' }],
    })
    await expect(attempts.get('P-3', 'agent_failed')).resolves.toBe(1)
  })

  test('marks planning tasks done after merge success', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-1', kind: 'planning', status: 'merging' }),
    ])
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
      `version: 1
goalKey: ${goalKey}
requests:
  - requestKey: PR-1
    title: Plan auth follow-through
    description: Capture the auth design follow-through.
    acceptanceCriteria:
      - The auth plan is durable.
    taskRef: P-1
    requestedUpdates:
      - design.md
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-planning',
      stepId: 'step-planner',
      taskRef: 'P-1',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner',
      targetPaths: ['.hopi/docs/goals/goal-1/design.md', '.hopi/docs/goals/goal-1/todo.yml'],
      changes: [
        { path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' },
        { path: '.hopi/docs/goals/goal-1/todo.yml', kind: 'modified' },
      ],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (2 changed files)',
    })

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'P-1:merger': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-1',
      from: 'merging',
      to: 'done',
    })

    await expect(readTask(store, 'P-1')).resolves.toMatchObject({ status: 'done' })
    const planningRequests = await Bun.file(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
    ).text()
    expect(planningRequests).toContain('status: resolved')
    expect(planningRequests).toContain('resolution: Planning task P-1 completed.')
  })

  test('returns planning review work to planned when requested durable updates are still missing', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-2', kind: 'planning', status: 'in_review' }),
    ])
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
      `version: 1
goalKey: ${goalKey}
requests:
  - requestKey: PR-2
    title: Plan auth reshape
    description: Capture the auth design follow-through.
    acceptanceCriteria:
      - The auth plan is durable.
    taskRef: P-2
    requestedUpdates:
      - design.md
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-planner',
      stepId: 'step-planner',
      taskRef: 'P-2',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner',
      targetPaths: ['.hopi/docs/goals/goal-1/design.md'],
      changes: [{ path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' }],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (1 changed file)',
    })
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'P-2:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-2',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'P-2')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('P-2', 'planning_follow_through_missing')).resolves.toBe(1)
    const planningRequests = await Bun.file(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
    ).text()
    expect(planningRequests).toContain('status: open')
  })

  test('returns planning review work to planned when requested goal.md evidence is still missing', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-3', kind: 'planning', status: 'in_review' }),
    ])
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
      `version: 1
goalKey: ${goalKey}
requests:
  - requestKey: PR-3
    title: Clarify goal boundaries
    description: Refresh durable Goal context before planning concludes.
    acceptanceCriteria:
      - Goal context is durable.
    taskRef: P-3
    requestedUpdates:
      - goal.md
      - design.md
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-planner',
      stepId: 'step-planner',
      taskRef: 'P-3',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner',
      targetPaths: ['.hopi/docs/goals/goal-1/design.md'],
      changes: [{ path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' }],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (1 changed file)',
    })
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'P-3:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-3',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'P-3')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('P-3', 'planning_follow_through_missing')).resolves.toBe(1)
    const planningRequests = await Bun.file(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
    ).text()
    expect(planningRequests).toContain('- goal.md')
    expect(planningRequests).toContain('status: open')
  })

  test('returns planning review work to planned when todo decomposition leaves overlapping engineering surfaces unordered', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-2', kind: 'planning', status: 'in_review' }),
      task({
        ref: 'T-1',
        status: 'planned',
        title: 'Reshape deck editor shell',
        description: 'Rebuild `DeckManagementPanel` around the reference shell.',
        acceptanceCriteria: ['`DeckManagementPanel` exposes the split-pane shell.'],
      }),
      task({
        ref: 'T-2',
        status: 'planned',
        title: 'Preserve keyboard interactions',
        description: 'Keep IME and focus behavior inside `DeckManagementPanel`.',
        acceptanceCriteria: ['`DeckManagementPanel` keeps rename/search intact.'],
      }),
    ])
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
      `version: 1
goalKey: ${goalKey}
requests:
  - requestKey: PR-2
    title: Reshape deck task graph
    description: Record the new task graph durably.
    acceptanceCriteria:
      - The task graph is durable.
    taskRef: P-2
    requestedUpdates:
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-planner',
      stepId: 'step-planner',
      taskRef: 'P-2',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner',
      targetPaths: ['.hopi/docs/goals/goal-1/todo.yml'],
      changes: [{ path: '.hopi/docs/goals/goal-1/todo.yml', kind: 'modified' }],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (1 changed file)',
    })
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'P-2:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-2',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'P-2')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('P-2', 'planning_task_graph_invalid')).resolves.toBe(1)
  })

  test('returns planning review work to planned when UI tasks lack Browser Harness acceptance', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-4', kind: 'planning', status: 'in_review' }),
      task({
        ref: 'T-7',
        status: 'planned',
        title: 'Polish deck manager layout',
        description: 'Adjust the visible panel layout and buttons.',
        acceptanceCriteria: ['The deck manager panel balance is improved.'],
      }),
    ])
    await Bun.write(
      join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'planning-requests.yml'),
      `version: 1
goalKey: ${goalKey}
requests:
  - requestKey: PR-4
    title: Add UI verification
    description: Record a UI task graph.
    acceptanceCriteria:
      - The UI task graph is durable.
    taskRef: P-4
    requestedUpdates:
      - todo.yml
    status: open
    createdAt: 2026-06-01T00:00:00.000Z
`,
    )
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-planner-browser',
      stepId: 'step-planner-browser',
      taskRef: 'P-4',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-planner-browser',
      targetPaths: ['.hopi/docs/goals/goal-1/todo.yml'],
      changes: [{ path: '.hopi/docs/goals/goal-1/todo.yml', kind: 'modified' }],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (1 changed file)',
    })
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'P-4:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-4',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'P-4')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('P-4', 'planning_task_graph_invalid')).resolves.toBe(1)
  })

  test('returns legacy bootstrap planning review to planned when durable bootstrap evidence is missing', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'plan-goal', kind: 'planning', status: 'in_review' }),
    ])
    const attempts = createAttemptStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts,
        runner: new MockAgentRunner({
          'plan-goal:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'plan-goal',
      from: 'in_review',
      to: 'planned',
    })

    await expect(readTask(store, 'plan-goal')).resolves.toMatchObject({ status: 'planned' })
    await expect(attempts.get('plan-goal', 'planning_follow_through_missing')).resolves.toBe(1)
  })

  test('allows legacy bootstrap planning review to continue when durable bootstrap evidence exists', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'plan-goal', kind: 'planning', status: 'in_review' }),
    ])
    const traces = createWriteTraceStore(rootDir)
    await traces.appendEntry(goalKey, {
      runId: 'run-bootstrap',
      stepId: 'step-bootstrap',
      taskRef: 'plan-goal',
      role: 'planner',
      agent: 'process_runner',
      cwd: '/tmp/root',
      toolName: 'process',
      callId: 'step-bootstrap',
      targetPaths: ['.hopi/docs/goals/goal-1/design.md', '.hopi/docs/goals/goal-1/todo.yml'],
      changes: [
        { path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' },
        { path: '.hopi/docs/goals/goal-1/todo.yml', kind: 'modified' },
      ],
      argumentSummary: 'bun run planner',
      resultSummary: 'exit 0 (2 changed files)',
    })

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        runner: new MockAgentRunner({
          'plan-goal:reviewer': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'plan-goal',
      from: 'in_review',
      to: 'merging',
    })

    await expect(readTask(store, 'plan-goal')).resolves.toMatchObject({ status: 'merging' })
  })

  test('appends reviewer work to the same active run', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1' })])
    const history = createRunHistoryStore(rootDir)
    const attempts = createAttemptStore(rootDir)

    await reconcileOnce({
      goalKey,
      store,
      attempts,
      history,
      runner: new MockAgentRunner(),
    })

    await reconcileOnce({
      goalKey,
      store,
      attempts,
      history,
      runner: new MockAgentRunner(),
    })

    const goalHistory = await history.readGoalHistory(goalKey)
    expect(goalHistory.runs).toHaveLength(1)
    expect(goalHistory.runs[0]).toMatchObject({
      taskRef: 'T-1',
      status: 'active',
      steps: [
        { role: 'generator', statusBefore: 'planned', statusAfter: 'in_review' },
        { role: 'reviewer', statusBefore: 'in_review', statusAfter: 'merging' },
      ],
    })
  })

  test('closes completed runs after merger success', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [
      task({ ref: 'P-1', kind: 'planning', status: 'planned' }),
    ])
    const history = createRunHistoryStore(rootDir)
    const attempts = createAttemptStore(rootDir)

    await reconcileOnce({
      goalKey,
      store,
      attempts,
      history,
      runner: new MockAgentRunner(),
    })
    await reconcileOnce({
      goalKey,
      store,
      attempts,
      history,
      runner: new MockAgentRunner(),
    })
    await reconcileOnce({
      goalKey,
      store,
      attempts,
      history,
      runner: new MockAgentRunner(),
    })

    await expect(history.readGoalHistory(goalKey)).resolves.toMatchObject({
      goalKey,
      runs: [
        {
          taskRef: 'P-1',
          taskKind: 'planning',
          status: 'completed',
          finalTaskStatus: 'done',
          terminalOutcome: 'success',
          steps: [
            { role: 'planner' },
            { role: 'reviewer' },
            { role: 'merger', statusAfter: 'done', outcome: 'success' },
          ],
        },
      ],
    })
  })

  test('records system-error runs without mutating task blockers', async () => {
    const rootDir = testRoot()
    const store = await seedBoard(rootDir, [task({ ref: 'T-1' })])
    const history = createRunHistoryStore(rootDir)

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        history,
        runner: new MockAgentRunner({
          'T-1:generator': [{ outcome: { kind: 'success' } }],
        }),
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    const failingRunner = {
      async run() {
        throw new Error('adapter exploded')
      },
    }

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        history,
        runner: failingRunner,
      }),
    ).rejects.toThrow('adapter exploded')

    await expect(readTask(store, 'T-1')).resolves.toMatchObject({
      status: 'in_review',
      blockedBy: [],
    })
    await expect(history.readGoalHistory(goalKey)).resolves.toMatchObject({
      goalKey,
      runs: [
        {
          taskRef: 'T-1',
          status: 'system_error',
          finalTaskStatus: 'in_review',
          terminalOutcome: 'system_error',
          steps: [
            { role: 'generator' },
            { role: 'reviewer', outcome: 'system_error', statusAfter: 'in_review' },
          ],
        },
      ],
    })
  })

  test('integrates ProcessAgentRunner worktree and artifact evidence into run history', async () => {
    const rootDir = await initGitRepo(testRoot())
    const store = await seedBoard(rootDir, [task({ ref: 'T-1' })])
    const history = createRunHistoryStore(rootDir)
    const runner = new ProcessAgentRunner({
      rootDir,
      worktrees: createWorktreeManager(rootDir),
      resolveCommand(input) {
        return {
          cmd: [
            'bun',
            '-e',
            "await Bun.write('generated.txt', 'Generated patch for T-1'); console.log('Generated patch for T-1')",
          ],
          cwdMode: 'worktree',
          successArtifactRef: `patch:${input.taskRef}`,
          successArtifactLabel: 'Generated patch',
        }
      },
    })

    await expect(
      reconcileOnce({
        goalKey,
        store,
        attempts: createAttemptStore(rootDir),
        history,
        runner,
      }),
    ).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    const goalHistory = await history.readGoalHistory(goalKey)
    expect(goalHistory.runs).toHaveLength(1)
    expect(goalHistory.runs[0]).toMatchObject({
      taskRef: 'T-1',
      steps: [
        {
          role: 'generator',
          statusBefore: 'planned',
          statusAfter: 'in_review',
          outcome: 'success',
          execution: {
            artifacts: [{ ref: 'patch:T-1', label: 'Generated patch' }],
          },
          messages: [
            { kind: 'system', role: 'system', content: 'generator dispatched for T-1' },
            { kind: 'info', role: 'generator', content: 'Generated patch for T-1' },
            { kind: 'system', role: 'system', content: 'T-1 advanced to in_review' },
          ],
        },
      ],
    })

    const worktreePath = goalHistory.runs[0]?.steps[0]?.execution?.worktree?.path
    expect(worktreePath).toBeString()
    expect(worktreePath).toContain('.hopi/worktrees/goal-1/T-1/')
    if (!worktreePath) {
      throw new Error('Expected worktree path')
    }
    expect(await pathExists(worktreePath)).toBeTrue()
    await expect(createWriteTraceStore(rootDir).readGoalTrace(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          runId: goalHistory.runs[0]?.runId,
          stepId: goalHistory.runs[0]?.steps[0]?.stepId,
          taskRef: 'T-1',
          role: 'generator',
          targetPaths: ['generated.txt'],
          changes: [{ path: 'generated.txt', kind: 'added' }],
          resultSummary: 'exit 0 (1 changed file)',
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function initGitRepo(rootDir: string) {
  await mkdir(rootDir, { recursive: true })
  await git(rootDir, ['init'])
  await git(rootDir, ['config', 'user.name', 'HOPI Tests'])
  await git(rootDir, ['config', 'user.email', 'hopi@example.com'])
  await writeFile(join(rootDir, 'README.md'), '# test repo\n', 'utf8')
  await git(rootDir, ['add', 'README.md'])
  await git(rootDir, ['commit', '-m', 'init'])
  return rootDir
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
  const item = board.items.find((task) => task.ref === ref)
  if (!item) {
    throw new Error(`Missing task ${ref}`)
  }
  return item
}

async function seedActiveMergingRun(history: ReturnType<typeof createRunHistoryStore>) {
  const generated = await history.startStep({
    goalKey,
    taskRef: 'T-1',
    taskKind: 'engineering',
    role: 'generator',
    statusBefore: 'planned',
    message: systemMessage('generator dispatched'),
  })
  await history.finishStep({
    goalKey,
    runId: generated.runId,
    stepId: generated.stepId,
    statusAfter: 'in_review',
    outcome: 'success',
    message: systemMessage('generator succeeded'),
  })

  const reviewed = await history.startStep({
    goalKey,
    taskRef: 'T-1',
    taskKind: 'engineering',
    role: 'reviewer',
    statusBefore: 'in_review',
    message: systemMessage('reviewer dispatched'),
  })
  await history.finishStep({
    goalKey,
    runId: reviewed.runId,
    stepId: reviewed.stepId,
    statusAfter: 'merging',
    outcome: 'success',
    message: systemMessage('reviewer accepted'),
  })

  return generated.runId
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }

  return stdout.trim()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
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

function systemMessage(content: string) {
  return {
    kind: 'system' as const,
    role: 'system' as const,
    content,
  }
}
