import { describe, expect, test } from 'bun:test'
import type { GoalDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { decideGoalReconciliation } from '../src/scheduler/reconcileDecision'

describe('deterministic reconciliation', () => {
  test('starts only an explicitly queued Run', () => {
    expect(decide(packageWith([work('W-1')]))).toEqual({ kind: 'wait', reasons: [] })
    expect(decide(packageWith([work('W-1')]), { queuedWorkIds: new Set(['W-1']) })).toEqual({
      kind: 'dispatch',
      workId: 'W-1',
    })
  })

  test('will not dispatch queued Work before its dependency', () => {
    expect(
      decide(packageWith([work('W-1'), work('W-2', ['W-1'])]), {
        queuedWorkIds: new Set(['W-2']),
      }),
    ).toEqual({ kind: 'wait', reasons: ['dependency_incomplete', 'queued_run'] })
  })

  test('rechecks scheduling after a Run was queued', () => {
    const scheduled = work('W-1')
    scheduled.attributes.notBefore = '2026-08-15T00:00:00Z'
    expect(
      decide(packageWith([scheduled]), {
        queuedWorkIds: new Set(['W-1']),
        now: new Date('2026-08-14T00:00:00Z'),
      }),
    ).toEqual({ kind: 'wait', reasons: ['not_before', 'queued_run'] })
  })

  test('finishes cancellation without inventing a Worker Run', () => {
    const goalPackage = packageWith([work('W-1')])
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
      runningWorkIds: new Set(),
      queuedWorkIds: new Set(),
      settledWorkIds: new Set(),
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

function work(id: string, dependsOn: string[] = []): WorkDocument {
  return {
    attributes: {
      id,
      title: id,
      kind: 'engineering',
      status: 'open',
      createdAt: '2026-08-14T00:00:00Z',
      notBefore: null,
      dependsOn,
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: 'Build it.\n',
  }
}
