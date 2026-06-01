import { describe, expect, test } from 'bun:test'
import { summarizePlanningFollowThroughEvidence } from '../src/runtime/planningFollowThroughEvidence'

describe('summarizePlanningFollowThroughEvidence', () => {
  test('merges requested updates and detects observed versus missing targets from durable traces', () => {
    const evidence = summarizePlanningFollowThroughEvidence(
      [
        {
          requestKey: 'PR-1',
          title: 'Plan data model reshape',
          description: 'Turn the provider answer into durable planning work.',
          acceptanceCriteria: ['The planning follow-through is visible in todo.yml.'],
          taskRef: 'P-1',
          decisionRefs: ['db-provider'],
          requestedUpdates: ['design.md', 'todo.yml'],
          status: 'open',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
        {
          requestKey: 'PR-2',
          title: 'Plan migration reshape',
          description: 'Turn the migration answer into durable planning work.',
          acceptanceCriteria: ['The migration follow-through is visible in todo.yml.'],
          taskRef: 'P-1',
          decisionRefs: ['migration-strategy'],
          requestedUpdates: ['goal.md', 'todo.yml'],
          status: 'open',
          createdAt: '2026-06-01T00:01:00.000Z',
        },
      ],
      [
        {
          id: 'trace-1',
          timestamp: '2026-06-01T00:02:00.000Z',
          goalKey: 'goal-1',
          runId: 'run-1',
          stepId: 'step-1',
          taskRef: 'P-1',
          role: 'planner',
          agent: 'process_runner',
          cwd: '/tmp/root',
          toolName: 'process',
          callId: 'call-1',
          targetPaths: ['.hopi/docs/goals/goal-1/design.md'],
          changes: [{ path: '.hopi/docs/goals/goal-1/design.md', kind: 'modified' }],
          argumentSummary: 'bun run planner',
          resultSummary: 'exit 0 (1 changed file)',
        },
        {
          id: 'trace-2',
          timestamp: '2026-06-01T00:03:00.000Z',
          goalKey: 'goal-1',
          runId: 'run-1',
          stepId: 'step-1',
          taskRef: 'P-1',
          role: 'planner',
          agent: 'process_runner',
          cwd: '/tmp/root',
          toolName: 'process',
          callId: 'call-2',
          targetPaths: ['.hopi/docs/goals/goal-1/goal.md'],
          changes: [{ path: '.hopi/docs/goals/goal-1/goal.md', kind: 'modified' }],
          argumentSummary: 'bun run planner',
          resultSummary: 'exit 0 (1 changed file)',
        },
      ],
    )

    expect(evidence.requestKeys).toEqual(['PR-1', 'PR-2'])
    expect(evidence.decisionRefs).toEqual(['db-provider', 'migration-strategy'])
    expect(evidence.requestedUpdates).toEqual(['goal.md', 'design.md', 'todo.yml'])
    expect(evidence.observedUpdates).toEqual(['goal.md', 'design.md'])
    expect(evidence.missingUpdates).toEqual(['todo.yml'])
  })

  test('tracks extra Goal-local requested update paths after the core durable docs', () => {
    const evidence = summarizePlanningFollowThroughEvidence(
      [
        {
          requestKey: 'PR-1',
          title: 'Capture rollout notes',
          description: 'Record rollout-specific planning notes durably.',
          acceptanceCriteria: ['Rollout notes are durable.'],
          taskRef: 'P-2',
          decisionRefs: ['rollout-strategy'],
          requestedUpdates: ['notes/rollout.md', 'goal.md'],
          status: 'open',
          createdAt: '2026-06-01T00:10:00.000Z',
        },
        {
          requestKey: 'PR-2',
          title: 'Capture auth contract',
          description: 'Record the API contract before more planning work continues.',
          acceptanceCriteria: ['The auth contract is durable.'],
          taskRef: 'P-2',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['docs/api-contract.md', 'design.md'],
          status: 'open',
          createdAt: '2026-06-01T00:11:00.000Z',
        },
      ],
      [
        {
          id: 'trace-3',
          timestamp: '2026-06-01T00:12:00.000Z',
          goalKey: 'goal-1',
          runId: 'run-2',
          stepId: 'step-2',
          taskRef: 'P-2',
          role: 'planner',
          agent: 'process_runner',
          cwd: '/tmp/root',
          toolName: 'process',
          callId: 'call-3',
          targetPaths: ['.hopi/docs/goals/goal-1/docs/api-contract.md'],
          changes: [{ path: '.hopi/docs/goals/goal-1/docs/api-contract.md', kind: 'modified' }],
          argumentSummary: 'bun run planner',
          resultSummary: 'exit 0 (1 changed file)',
        },
        {
          id: 'trace-4',
          timestamp: '2026-06-01T00:13:00.000Z',
          goalKey: 'goal-1',
          runId: 'run-2',
          stepId: 'step-2',
          taskRef: 'P-2',
          role: 'planner',
          agent: 'process_runner',
          cwd: '/tmp/root',
          toolName: 'process',
          callId: 'call-4',
          targetPaths: ['.hopi/docs/goals/goal-1/goal.md'],
          changes: [{ path: '.hopi/docs/goals/goal-1/goal.md', kind: 'modified' }],
          argumentSummary: 'bun run planner',
          resultSummary: 'exit 0 (1 changed file)',
        },
      ],
    )

    expect(evidence.requestKeys).toEqual(['PR-1', 'PR-2'])
    expect(evidence.decisionRefs).toEqual(['rollout-strategy', 'auth-strategy'])
    expect(evidence.requestedUpdates).toEqual([
      'goal.md',
      'design.md',
      'notes/rollout.md',
      'docs/api-contract.md',
    ])
    expect(evidence.observedUpdates).toEqual(['goal.md', 'docs/api-contract.md'])
    expect(evidence.missingUpdates).toEqual(['design.md', 'notes/rollout.md'])
  })
})
