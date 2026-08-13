import { describe, expect, test } from 'bun:test'
import type { GoalDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { decideGoalReconciliation } from '../src/scheduler/reconcileDecision'

describe('decideGoalReconciliation', () => {
  test('waits when Work has no explicitly queued Attempt', () => {
    expect(decide(packageWith([work('W-1', 'engineering', 'generate')]))).toEqual({
      kind: 'wait',
      reasons: ['no_queued_run'],
    })
  })

  test('dispatches the profile recorded by the queued Attempt, not the Work stage', () => {
    expect(
      decide(packageWith([work('W-1', 'engineering', 'generate')]), {
        queuedRunProfiles: new Map([['W-1', 'reviewer']]),
      }),
    ).toEqual({ kind: 'dispatch', workId: 'W-1', responsibility: 'reviewer' })
  })

  test('does not dispatch an explicit Run while its dependency is incomplete', () => {
    expect(
      decide(
        packageWith([
          work('W-1', 'engineering', 'generate'),
          work('W-2', 'engineering', 'generate', ['W-1']),
        ]),
        { queuedRunProfiles: new Map([['W-2', 'generator']]) },
      ),
    ).toEqual({ kind: 'wait', reasons: ['no_queued_run', 'dependency_incomplete'] })
  })

  test('waits for inactive Goals and ineligible Projects', () => {
    const goalPackage = packageWith([work('W-1', 'engineering', 'generate')])
    goalPackage.goal.attributes.lifecycle = 'paused'
    expect(decide(goalPackage)).toEqual({ kind: 'wait', reasons: ['goal_paused'] })
    goalPackage.goal.attributes.lifecycle = 'active'
    expect(decide(goalPackage, { projectEligible: false })).toEqual({
      kind: 'wait',
      reasons: ['project_ineligible'],
    })
  })

  test('finishes cancellation deterministically without creating a Run', () => {
    const goalPackage = packageWith([work('W-1', 'engineering', 'generate')])
    goalPackage.goal.attributes.lifecycle = 'cancelled'
    expect(decide(goalPackage)).toEqual({ kind: 'finish_cancellation' })
  })
})

function decide(
  goalPackage: GoalPackage,
  overrides: Partial<Parameters<typeof decideGoalReconciliation>[0]['runtime']> = {},
) {
  return decideGoalReconciliation({
    projectId: 'P-1',
    goalId: 'G-1',
    goalPackage,
    runtime: {
      projectEligible: true,
      liveRunWorkIds: new Set(),
      queuedRunProfiles: new Map(),
      settledRunWorkIds: new Set(),
      runCapacity: { planner: true, generator: true, reviewer: true },
      ...overrides,
    },
  })
}

function packageWith(works: WorkDocument[]): GoalPackage {
  const goal: GoalDocument = {
    attributes: { id: 'G-1', title: 'Goal', lifecycle: 'active', priority: 0, contractRevision: 1 },
    body: 'Goal.\n',
  }
  return {
    goal,
    works: new Map(works.map((item) => [item.attributes.id, item])),
    attentions: new Map(),
    evidence: new Map(),
    inputs: [],
  }
}

function work(
  id: string,
  kind: 'planning' | 'engineering',
  stage: 'plan' | 'generate' | 'review' | 'done',
  dependsOn: string[] = [],
): WorkDocument {
  const common = {
    id,
    title: id,
    notBefore: null,
    dependsOn,
    contractRevision: 1,
    evidenceRefs: [],
    contextRefs: [],
    ownerMessages: [],
  }
  return kind === 'planning'
    ? { attributes: { ...common, kind, stage: stage as 'plan' | 'done' }, body: '' }
    : { attributes: { ...common, kind, stage: stage as 'generate' | 'review' | 'done' }, body: '' }
}
