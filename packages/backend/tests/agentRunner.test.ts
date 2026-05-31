import { describe, expect, test } from 'bun:test'
import { MockAgentRunner } from '../src/agent/AgentRunner'

describe('MockAgentRunner', () => {
  test('returns success when no outcome is configured', async () => {
    const runner = new MockAgentRunner()

    await expect(
      runner.run({
        goalKey: 'goal-1',
        runId: 'run-1',
        stepId: 'step-1',
        taskRef: 'T-1',
        taskKind: 'engineering',
        role: 'generator',
      }),
    ).resolves.toEqual({ kind: 'success' })
  })

  test('consumes scripted outcomes in order', async () => {
    const runner = new MockAgentRunner({
      'T-1:generator': [
        { outcome: { kind: 'fail', reason: 'first failure' } },
        { outcome: { kind: 'success' } },
      ],
    })
    const input = {
      goalKey: 'goal-1',
      runId: 'run-1',
      stepId: 'step-1',
      taskRef: 'T-1',
      taskKind: 'engineering' as const,
      role: 'generator' as const,
    }

    await expect(runner.run(input)).resolves.toEqual({
      kind: 'fail',
      reason: 'first failure',
    })
    await expect(runner.run(input)).resolves.toEqual({ kind: 'success' })
    await expect(runner.run(input)).resolves.toEqual({ kind: 'success' })
  })

  test('streams scripted runtime events to the observer', async () => {
    const runner = new MockAgentRunner({
      'T-2:generator': [
        {
          events: [
            {
              kind: 'worktree_prepared',
              path: '.hopi/worktrees/T-2',
              branch: 'task/T-2',
              baseBranch: 'main',
            },
            {
              kind: 'message',
              level: 'info',
              role: 'generator',
              content: 'Generated implementation patch',
            },
            {
              kind: 'artifact',
              ref: 'patch:T-2',
              label: 'Generated patch',
            },
          ],
          outcome: { kind: 'success', artifactRef: 'patch:T-2' },
        },
      ],
    })

    const events: unknown[] = []
    const result = await runner.run(
      {
        goalKey: 'goal-1',
        runId: 'run-22',
        stepId: 'step-22',
        taskRef: 'T-2',
        taskKind: 'engineering',
        role: 'generator',
      },
      {
        async onEvent(event) {
          events.push(event)
        },
      },
    )

    expect(result).toEqual({ kind: 'success', artifactRef: 'patch:T-2' })
    expect(events).toEqual([
      {
        kind: 'worktree_prepared',
        path: '.hopi/worktrees/T-2',
        branch: 'task/T-2',
        baseBranch: 'main',
      },
      {
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: 'Generated implementation patch',
      },
      {
        kind: 'artifact',
        ref: 'patch:T-2',
        label: 'Generated patch',
      },
    ])
  })

  test('returns reviewer rejection outcomes', async () => {
    const runner = new MockAgentRunner({
      'T-2:reviewer': [
        { outcome: { kind: 'reject', artifactRef: 'review-1', reason: 'needs tests' } },
      ],
    })

    await expect(
      runner.run({
        goalKey: 'goal-1',
        runId: 'run-2',
        stepId: 'step-2',
        taskRef: 'T-2',
        taskKind: 'engineering',
        role: 'reviewer',
      }),
    ).resolves.toEqual({
      kind: 'reject',
      artifactRef: 'review-1',
      reason: 'needs tests',
    })
  })

  test('returns merger conflict outcomes', async () => {
    const runner = new MockAgentRunner({
      'T-3:merger': [{ outcome: { kind: 'merge_conflict', artifactRef: 'patch-1' } }],
    })

    await expect(
      runner.run({
        goalKey: 'goal-1',
        runId: 'run-3',
        stepId: 'step-3',
        taskRef: 'T-3',
        taskKind: 'engineering',
        role: 'merger',
      }),
    ).resolves.toEqual({ kind: 'merge_conflict', artifactRef: 'patch-1' })
  })
})
