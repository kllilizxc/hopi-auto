import { describe, expect, test } from 'bun:test'
import { MockAgentRunner } from '../src/agent/AgentRunner'

describe('MockAgentRunner', () => {
  test('returns success when no outcome is configured', async () => {
    const runner = new MockAgentRunner()

    await expect(
      runner.run({
        goalKey: 'goal-1',
        taskRef: 'T-1',
        taskKind: 'engineering',
        role: 'generator',
      }),
    ).resolves.toEqual({ kind: 'success' })
  })

  test('consumes configured outcomes in order', async () => {
    const runner = new MockAgentRunner({
      'T-1:generator': [{ kind: 'fail', reason: 'first failure' }, { kind: 'success' }],
    })
    const input = {
      goalKey: 'goal-1',
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

  test('returns reviewer rejection outcomes', async () => {
    const runner = new MockAgentRunner({
      'T-2:reviewer': [{ kind: 'reject', artifactRef: 'review-1', reason: 'needs tests' }],
    })

    await expect(
      runner.run({
        goalKey: 'goal-1',
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
      'T-3:merger': [{ kind: 'merge_conflict', artifactRef: 'patch-1' }],
    })

    await expect(
      runner.run({
        goalKey: 'goal-1',
        taskRef: 'T-3',
        taskKind: 'engineering',
        role: 'merger',
      }),
    ).resolves.toEqual({ kind: 'merge_conflict', artifactRef: 'patch-1' })
  })
})
