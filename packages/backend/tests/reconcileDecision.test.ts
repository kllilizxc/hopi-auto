import { describe, expect, test } from 'bun:test'
import type {
  AttentionDocument,
  GoalDocument,
  WorkDocument,
} from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { decideGoalReconciliation } from '../src/scheduler/reconcileDecision'

describe('decideGoalReconciliation', () => {
  test('dispatches the fixed responsibility selected by Work kind and stage', () => {
    const goalPackage = packageWith([work('plan', 'planning', 'plan')])

    expect(decide(goalPackage)).toEqual({
      kind: 'dispatch',
      workId: 'plan',
      responsibility: 'planner',
    })
  })

  test('uses permanent dependency order and the Planning guard', () => {
    const plan = work('plan', 'planning', 'plan')
    const first = work('W-1', 'engineering', 'generate')
    const second = work('W-2', 'engineering', 'generate', ['W-1'])
    let goalPackage = packageWith([first, second, plan])

    expect(decide(goalPackage)).toMatchObject({ kind: 'dispatch', workId: 'plan' })

    plan.attributes.stage = 'done'
    goalPackage = packageWith([second, first, plan])
    expect(decide(goalPackage)).toMatchObject({ kind: 'dispatch', workId: 'W-1' })
  })

  test('ensures Attention before exhausted Work can be considered again', () => {
    const exhausted = work('W-1', 'engineering', 'generate')
    exhausted.attributes.attempts = 3
    const goalPackage = packageWith([exhausted])

    expect(decide(goalPackage)).toEqual({
      kind: 'ensure_attention',
      workId: 'W-1',
      target: 'project:P-1/goal:G-1/work:W-1',
      reason: 'attempts_exhausted',
    })

    goalPackage.attentions = new Map([['A-1', attention('A-1', 'project:P-1/goal:G-1/work:W-1')]])
    expect(decide(goalPackage)).toMatchObject({
      kind: 'wait',
      reasons: ['attempts_exhausted', 'attention'],
    })
  })

  test('requests final Planning when no nonterminal Work or proposal exists', () => {
    const goalPackage = packageWith([work('W-1', 'engineering', 'done')])

    expect(decide(goalPackage)).toEqual({ kind: 'ensure_planning' })
  })

  test('claims a final Planner proposal only after structural completion checks', () => {
    const goalPackage = packageWith(
      [work('plan-final', 'planning', 'done')],
      [attention('A-complete', null)],
    )

    expect(decide(goalPackage, { completionStructureValid: false })).toEqual({
      kind: 'wait',
      reasons: ['completion_structure_invalid'],
    })
    expect(decide(goalPackage)).toEqual({
      kind: 'complete_goal',
      attentionId: 'A-complete',
    })
  })

  test('does nothing for paused Goals or ineligible Projects', () => {
    const goalPackage = packageWith([work('plan', 'planning', 'plan')])
    goalPackage.goal.attributes.lifecycle = 'paused'
    expect(decide(goalPackage)).toEqual({ kind: 'wait', reasons: ['goal_paused'] })

    goalPackage.goal.attributes.lifecycle = 'active'
    expect(decide(goalPackage, { projectEligible: false })).toEqual({
      kind: 'wait',
      reasons: ['project_ineligible'],
    })
  })

  test('finishes cancellation cleanup from the durable Goal guard', () => {
    const goalPackage = packageWith([
      work('W-1', 'engineering', 'generate', []),
      work('W-2', 'engineering', 'generate', ['W-1']),
    ])
    goalPackage.goal.attributes.lifecycle = 'cancelled'

    expect(decide(goalPackage)).toEqual({
      kind: 'finish_cancellation',
    })
  })
})

function decide(
  goalPackage: GoalPackage,
  overrides: Partial<Parameters<typeof decideGoalReconciliation>[0]['runtime']> & {
    completionStructureValid?: boolean
  } = {},
) {
  return decideGoalReconciliation({
    projectId: 'P-1',
    goalId: 'G-1',
    goalPackage,
    completionStructureValid: overrides.completionStructureValid,
    runtime: {
      projectEligible: true,
      liveRunWorkIds: new Set(),
      passCapacity: { planner: true, generator: true, reviewer: true },
      ...overrides,
    },
  })
}

function packageWith(works: WorkDocument[], attentions: AttentionDocument[] = []): GoalPackage {
  const goal: GoalDocument = {
    attributes: {
      id: 'G-1',
      title: 'Goal',
      lifecycle: 'active',
      priority: 0,
      contractRevision: 1,
      completionAttentionId: null,
    },
    body: 'Goal.\n',
  }
  return {
    goal,
    works: new Map(works.map((document) => [document.attributes.id, document])),
    attentions: new Map(attentions.map((document) => [document.attributes.id, document])),
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
    evidenceRefs: stage === 'done' && kind === 'engineering' ? ['E-1'] : [],
    attempts: 0,
  }
  return kind === 'planning'
    ? { attributes: { ...common, kind, stage: stage as 'plan' | 'done' }, body: '' }
    : {
        attributes: {
          ...common,
          kind,
          stage: stage as 'generate' | 'review' | 'done',
        },
        body: '',
      }
}

function attention(id: string, target: string | null): AttentionDocument {
  return {
    attributes: {
      id,
      target,
      createdAt: '2026-07-11T00:00:00Z',
      resolvedAt: null,
      notifiedAt: null,
    },
    body: 'Attention.\n',
  }
}
