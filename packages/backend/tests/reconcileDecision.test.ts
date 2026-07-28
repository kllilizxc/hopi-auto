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

  test('uses current Engineering dependency order', () => {
    const first = work('W-1', 'engineering', 'generate')
    const second = work('W-2', 'engineering', 'generate', ['W-1'])
    const goalPackage = packageWith([second, first])

    expect(decide(goalPackage)).toMatchObject({ kind: 'dispatch', workId: 'W-1' })
  })

  test('does not use an open Work Attention as a scheduling gate', () => {
    const target = 'project:P-1/goal:G-1/work:W-1'
    const pending = attention('A-1', target)
    const goalPackage = packageWith([work('W-1', 'engineering', 'generate')], [pending])

    expect(decide(goalPackage)).toEqual({
      kind: 'dispatch',
      workId: 'W-1',
      responsibility: 'generator',
    })
    expect(goalPackage.attentions.get('A-1')?.attributes.resolvedAt).toBeNull()
  })

  test('requests final Planning when no nonterminal Work or proposal exists', () => {
    const goalPackage = packageWith([work('W-1', 'engineering', 'done')])

    expect(decide(goalPackage)).toEqual({ kind: 'ensure_planning' })
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
  overrides: Partial<Parameters<typeof decideGoalReconciliation>[0]['runtime']> = {},
) {
  return decideGoalReconciliation({
    projectId: 'P-1',
    goalId: 'G-1',
    goalPackage,
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

function attention(id: string, target: string): AttentionDocument {
  return {
    attributes: {
      id,
      target,
      createdAt: '2026-07-11T00:00:00Z',
      resolvedAt: null,
      summary: 'Attention.',
    },
    body: 'Attention.\n',
  }
}
