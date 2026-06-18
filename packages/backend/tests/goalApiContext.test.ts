import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalApiContext } from '../src/runtime/goalApiContext'
import { stringifyBoardYaml } from '../src/domain/validation'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-api-context')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalApiContext', () => {
  test('appends a durable assistant notification when an action-required blocker is present', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'T-1',
        kind: 'engineering',
        status: 'merging',
        title: 'Merge the deck shell',
        description: 'Finish the merge.',
        acceptanceCriteria: ['Merge succeeds.'],
        blockedBy: [
          { kind: 'merge_conflict' as const, ref: 'src/game/ui/deckbuilder/DeckManagementPanel.ts' },
        ],
      },
    ])

    const context = createGoalApiContext(rootDir)
    await context.execution.startAutomation('project-1', goalKey)
    await context.execution.recordAutomationResult('project-1', goalKey, {
      kind: 'blocked',
      taskRef: 'T-1',
      blocker: {
        kind: 'merge_conflict',
        ref: 'src/game/ui/deckbuilder/DeckManagementPanel.ts',
      },
    })
    await context.execution.completeAutomation('project-1', goalKey, {
      state: 'blocked',
    })

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(1)
    expect(thread.entries[0]).toMatchObject({
      kind: 'system_message',
      label: 'Action required',
      content: 'T-1 needs intervention: Merge the deck shell.',
      collapsedByDefault: false,
      details: [
        'Blocker: merge_conflict · src/game/ui/deckbuilder/DeckManagementPanel.ts',
        'Inspect the latest merger run for T-1, reconcile the conflicting files, then retry the task.',
      ],
      notification: {
        kind: 'task_blocked_merge_conflict',
        taskRef: 'T-1',
        blocker: {
          kind: 'merge_conflict',
          ref: 'src/game/ui/deckbuilder/DeckManagementPanel.ts',
        },
        actions: ['inspect_task', 'retry_task'],
      },
    })
  })

  test('appends a durable assistant notification when automation blocks on a planner failure', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Plan the rollout',
        description: 'Capture the rollout plan.',
        acceptanceCriteria: ['Planning output is durable.'],
        blockedBy: [{ kind: 'intervention' as const, ref: 'P-1:agent_failed' }],
      },
    ])

    const context = createGoalApiContext(rootDir)
    await context.execution.startAutomation('project-1', goalKey)
    await context.execution.recordAutomationResult('project-1', goalKey, {
      kind: 'blocked',
      taskRef: 'P-1',
      blocker: {
        kind: 'intervention',
        ref: 'P-1:agent_failed',
      },
    })
    await context.execution.completeAutomation('project-1', goalKey, {
      state: 'blocked',
    })

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(1)
    expect(thread.entries[0]).toMatchObject({
      kind: 'system_message',
      label: 'Action required',
      content: 'P-1 needs intervention: Plan the rollout.',
      collapsedByDefault: false,
      details: [
        'Blocker: intervention · P-1:agent_failed',
        'Inspect the latest run for P-1, resolve the cited issue, then retry the task.',
      ],
      notification: {
        kind: 'task_blocked_intervention',
        taskRef: 'P-1',
        blocker: {
          kind: 'intervention',
          ref: 'P-1:agent_failed',
        },
        actions: ['inspect_task', 'retry_task'],
      },
    })
  })

  test('appends a visible assistant update when automation will retry a planner failure', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'P-2',
        kind: 'planning',
        status: 'planned',
        title: 'Plan the rollout',
        description: 'Capture the rollout plan.',
        acceptanceCriteria: ['Planning output is durable.'],
        blockedBy: [],
      },
    ])

    const context = createGoalApiContext(rootDir)
    const started = await context.history.startStep({
      goalKey,
      taskRef: 'P-2',
      taskKind: 'planning',
      role: 'planner',
      statusBefore: 'planned',
      message: {
        kind: 'system',
        role: 'system',
        content: 'planner dispatched for P-2',
      },
    })
    await context.history.finishStep({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      statusAfter: 'planned',
      outcome: 'fail',
      runStatus: 'retryable',
      message: {
        kind: 'system',
        role: 'system',
        content: 'missing planning output',
      },
    })
    await context.attempts.increment('P-2', 'agent_failed')
    await context.execution.startAutomation('project-1', goalKey)
    await context.execution.recordAutomationResult('project-1', goalKey, {
      kind: 'advanced',
      taskRef: 'P-2',
      from: 'planned',
      to: 'planned',
    })
    await context.execution.recordAutomationWorkerClaim('project-1', goalKey)

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(1)
    expect(thread.entries[0]).toMatchObject({
      kind: 'system_message',
      label: 'Automation update',
      content: 'Automation will retry P-2 automatically.',
      collapsedByDefault: false,
      details: [
        'Latest result: planner failure: missing planning output',
        'Attempt 1 recorded. Automation will keep retrying until the task succeeds or the attempt budget is exhausted.',
      ],
      dedupeKey: `retryable_run:${started.runId}`,
    })
  })

  test('dedupes active notifications and ignores task dependency blockers', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement prerequisite',
        description: 'Do the first thing.',
        acceptanceCriteria: ['Done.'],
        blockedBy: [],
      },
      {
        ref: 'T-2',
        kind: 'engineering',
        status: 'planned',
        title: 'Wait on prerequisite',
        description: 'Do the second thing.',
        acceptanceCriteria: ['Done.'],
        blockedBy: [{ kind: 'task' as const, ref: 'T-1' }],
      },
      {
        ref: 'T-3',
        kind: 'engineering',
        status: 'in_review',
        title: 'Needs reviewer fix',
        description: 'Review failed.',
        acceptanceCriteria: ['Accepted.'],
        blockedBy: [{ kind: 'intervention' as const, ref: 'T-3:reviewer_rejected' }],
      },
    ])

    const context = createGoalApiContext(rootDir)
    await context.actionRequired.reconcileGoal(goalKey)
    await context.actionRequired.reconcileGoal(goalKey)

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(1)
    expect(thread.entries[0]).toMatchObject({
      kind: 'system_message',
      content: 'T-3 needs intervention: Needs reviewer fix.',
      notification: {
        kind: 'task_blocked_intervention',
        taskRef: 'T-3',
      },
    })
  })

  test('renotifies when a resolved action-required blocker appears again', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'T-1',
        kind: 'engineering',
        status: 'in_review',
        title: 'Needs reviewer fix',
        description: 'Review failed.',
        acceptanceCriteria: ['Accepted.'],
        blockedBy: [{ kind: 'intervention' as const, ref: 'T-1:reviewer_rejected' }],
      },
    ])

    const context = createGoalApiContext(rootDir)
    await context.actionRequired.reconcileGoal(goalKey)
    await context.store.mutateBoard(goalKey, 'test', 'clear blocker', (board) => {
      const task = board.items.find((item) => item.ref === 'T-1')
      if (task) {
        task.blockedBy = []
      }
    })
    await context.actionRequired.reconcileGoal(goalKey)
    await context.store.mutateBoard(goalKey, 'test', 'restore blocker', (board) => {
      const task = board.items.find((item) => item.ref === 'T-1')
      if (task) {
        task.blockedBy = [{ kind: 'intervention', ref: 'T-1:reviewer_rejected' }]
      }
    })
    await context.actionRequired.reconcileGoal(goalKey)

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(2)
    expect(
      thread.entries.map((entry) => (entry.kind === 'system_message' ? entry.dedupeKey : '')),
    ).toEqual([
      'task_blocked_intervention:T-1:T-1%3Areviewer_rejected:g1',
      'task_blocked_intervention:T-1:T-1%3Areviewer_rejected:g2',
    ])
  })

  test('renotifies automation failures after automation leaves failed state', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [])

    const context = createGoalApiContext(rootDir)
    await context.execution.startAutomation('project-1', goalKey)
    await context.execution.completeAutomation('project-1', goalKey, {
      state: 'failed',
      error: 'adapter exploded',
    })
    await context.execution.startAutomation('project-1', goalKey)
    await context.execution.completeAutomation('project-1', goalKey, {
      state: 'failed',
      error: 'adapter exploded',
    })

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(2)
    expect(thread.entries).toEqual([
      expect.objectContaining({
        content: 'Automation stopped after a system error.',
        notification: expect.objectContaining({ kind: 'automation_failed' }),
      }),
      expect.objectContaining({
        content: 'Automation stopped after a system error.',
        notification: expect.objectContaining({ kind: 'automation_failed' }),
      }),
    ])
  })

  test('notifies decision blockers and standalone open decisions', async () => {
    const rootDir = testRoot()
    await writeBoard(rootDir, [
      {
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Choose auth',
        description: 'Needs a decision.',
        acceptanceCriteria: ['Decision reflected.'],
        blockedBy: [{ kind: 'decision' as const, ref: 'auth-strategy' }],
      },
    ])

    const context = createGoalApiContext(rootDir)
    await context.decisions.createDecision(goalKey, {
      decisionKey: 'auth-strategy',
      summary: 'Choose auth strategy',
      prompt: 'Which auth strategy should be used?',
      taskRef: 'T-1',
    })
    await context.decisions.createDecision(goalKey, {
      decisionKey: 'deploy-target',
      summary: 'Choose deploy target',
      prompt: 'Where should this be deployed?',
    })
    await context.actionRequired.reconcileGoal(goalKey)

    const thread = await context.assistantThread.readThread(goalKey)
    expect(thread.entries).toHaveLength(2)
    expect(thread.entries).toEqual([
      expect.objectContaining({
        content: 'T-1 is waiting for a decision: Choose auth strategy.',
        notification: expect.objectContaining({
          kind: 'task_blocked_decision',
          taskRef: 'T-1',
          decisionKey: 'auth-strategy',
        }),
      }),
      expect.objectContaining({
        content: 'Decision needed: Choose deploy target.',
        notification: expect.objectContaining({
          kind: 'open_decision',
          decisionKey: 'deploy-target',
        }),
      }),
    ])
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function writeBoard(rootDir: string, items: Parameters<typeof stringifyBoardYaml>[0]['items']) {
  const todoPath = join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'todo.yml')
  await mkdir(join(rootDir, '.hopi', 'docs', 'goals', goalKey), { recursive: true })
  await Bun.write(
    todoPath,
    stringifyBoardYaml({
      version: 1,
      goal: {
        goalKey,
        title: 'Goal One',
      },
      items,
    }),
  )
}
