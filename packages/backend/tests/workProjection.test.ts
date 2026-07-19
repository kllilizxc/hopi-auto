import { describe, expect, test } from 'bun:test'
import type {
  AttentionDocument,
  GoalDocument,
  WorkDocument,
} from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { deriveGoalWorkProjections } from '../src/domain/workProjection'

describe('derived Work projection', () => {
  test('maps durable stages to the four active Kanban columns and cancelled archive', () => {
    const goalPackage = packageWith([
      work('P-1', 'planning', 'plan'),
      work('W-1', 'engineering', 'generate'),
      work('W-2', 'engineering', 'review'),
      work('W-3', 'engineering', 'done'),
      work('W-4', 'engineering', 'cancelled'),
    ])

    const projections = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, runtime())

    expect(
      projections.map(({ workId, column, cancelled }) => ({ workId, column, cancelled })),
    ).toEqual([
      { workId: 'P-1', column: 'Plan', cancelled: false },
      { workId: 'W-1', column: 'Build', cancelled: false },
      { workId: 'W-2', column: 'Review', cancelled: false },
      { workId: 'W-3', column: 'Done', cancelled: false },
      { workId: 'W-4', column: null, cancelled: true },
    ])
  })

  test('uses one primary badge with the accepted priority', () => {
    const scheduledAt = '2026-07-12T00:00:00Z'
    const goalPackage = packageWith(
      [
        work('W-attention', 'engineering', 'generate', { notBefore: scheduledAt }),
        work('W-needs-you', 'engineering', 'generate', { notBefore: scheduledAt }),
        work('W-working', 'engineering', 'generate', { notBefore: scheduledAt }),
        work('W-scheduled', 'engineering', 'generate', { notBefore: scheduledAt }),
        work('W-queued', 'engineering', 'generate'),
        work('W-waiting', 'engineering', 'generate', { dependsOn: ['W-scheduled'] }),
      ],
      [
        attention('A-1', 'project:Project-1/goal:G-1/work:W-attention'),
        attention('A-2', 'project:Project-1/goal:G-1/work:W-needs-you', '2026-07-11T01:00:00Z'),
      ],
    )

    const projections = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      now: new Date('2026-07-11T00:00:00Z'),
      liveRunWorkIds: new Set(['W-attention', 'W-working']),
    })

    expect(Object.fromEntries(projections.map((item) => [item.workId, item.primaryBadge]))).toEqual(
      {
        'W-attention': 'Waiting for Assistant',
        'W-needs-you': 'Needs you',
        'W-working': 'working',
        'W-scheduled': 'scheduled',
        'W-queued': 'queued',
        'W-waiting': 'waiting',
      },
    )
  })

  test('reports every failed readiness predicate without inventing another stage', () => {
    const goalPackage = packageWith([
      work('P-1', 'planning', 'plan'),
      work('W-1', 'engineering', 'generate', {
        contractRevision: 1,
        attempts: 3,
      }),
    ])
    goalPackage.goal.attributes.lifecycle = 'paused'
    goalPackage.goal.attributes.contractRevision = 2

    const projection = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      projectEligible: false,
      passCapacity: { generator: false },
    }).find((item) => item.workId === 'W-1')

    expect(projection).toMatchObject({
      ready: false,
      primaryBadge: 'waiting',
      failedPredicates: expect.arrayContaining([
        'goal_not_active',
        'project_ineligible',
        'stale_contract_revision',
        'planning_guard',
        'attempts_exhausted',
        'capacity',
      ]),
    })
  })

  test('represents a Project blocker only as project ineligibility on each Work', () => {
    const goalPackage = packageWith([work('P-1', 'planning', 'plan')])

    const projection = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      projectEligible: false,
    })[0]

    expect(projection).toMatchObject({
      ready: false,
      primaryBadge: 'waiting',
      failedPredicates: ['project_ineligible'],
    })
    expect(projection?.failedPredicates).not.toContain('attention')
  })

  test('prioritizes a notified covering Attention over file order', () => {
    const target = 'project:Project-1/goal:G-1/work:W-1'
    const goalPackage = packageWith(
      [work('W-1', 'engineering', 'generate')],
      [attention('A-waiting', target), attention('A-needs', target, '2026-07-11T01:00:00Z')],
    )

    expect(
      deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, runtime())[0]?.primaryBadge,
    ).toBe('Needs you')
  })

  test('keeps an informationally notified blocker with Assistant ownership', () => {
    const target = 'project:Project-1/goal:G-1/work:W-1'
    const goalPackage = packageWith(
      [work('W-1', 'engineering', 'generate')],
      [attention('A-info', target, '2026-07-11T01:00:00Z', null)],
    )

    expect(
      deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, runtime())[0]?.primaryBadge,
    ).toBe('Waiting for Assistant')
  })

  test('queues Planning behind already admitted same-Goal Engineering', () => {
    const goalPackage = packageWith([
      work('P-1', 'planning', 'plan'),
      work('W-1', 'engineering', 'review'),
    ])

    const projections = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      liveRunWorkIds: new Set(['W-1']),
    })
    const planning = projections.find((item) => item.workId === 'P-1')
    const engineering = projections.find((item) => item.workId === 'W-1')

    expect(planning).toMatchObject({
      ready: false,
      primaryBadge: 'waiting',
      failedPredicates: expect.arrayContaining(['planning_guard']),
    })
    expect(engineering).toMatchObject({
      ready: false,
      primaryBadge: 'working',
      failedPredicates: expect.arrayContaining(['planning_guard', 'live_run']),
    })
  })

  test('does not attach the admission guard to historical Planning', () => {
    const goalPackage = packageWith([
      work('P-1', 'planning', 'done'),
      work('W-1', 'engineering', 'review'),
    ])

    const planning = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      liveRunWorkIds: new Set(['W-1']),
    }).find((item) => item.workId === 'P-1')

    expect(planning?.failedPredicates).toEqual(['terminal'])
  })

  test('projects operational retry backoff as waiting without changing Work state', () => {
    const goalPackage = packageWith([work('W-1', 'engineering', 'review')])

    const projection = deriveGoalWorkProjections('Project-1', 'G-1', goalPackage, {
      ...runtime(),
      operationallyDeferredWorkIds: new Set(['W-1']),
    })[0]

    expect(projection).toMatchObject({
      column: 'Review',
      ready: false,
      primaryBadge: 'waiting',
      failedPredicates: ['operational_backoff'],
    })
  })
})

function runtime() {
  return {
    projectEligible: true,
    liveRunWorkIds: new Set<string>(),
    passCapacity: { planner: true, generator: true, reviewer: true },
    now: new Date('2026-07-11T00:00:00Z'),
  }
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
    body: 'Goal contract.\n',
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
  stage: 'plan' | 'generate' | 'review' | 'done' | 'cancelled',
  overrides: Partial<WorkDocument['attributes']> = {},
): WorkDocument {
  const attributes = {
    id,
    title: id,
    notBefore: null,
    dependsOn: [],
    contractRevision: 1,
    evidenceRefs: stage === 'done' && kind === 'engineering' ? ['E-1'] : [],
    attempts: 0,
    ...overrides,
  }
  return kind === 'planning'
    ? {
        attributes: { ...attributes, kind, stage: stage as 'plan' | 'done' | 'cancelled' },
        body: '',
      }
    : {
        attributes: {
          ...attributes,
          kind,
          stage: stage as 'generate' | 'review' | 'done' | 'cancelled',
        },
        body: '',
      }
}

function attention(
  id: string,
  target: string,
  notifiedAt: string | null = null,
  operatorRequest?: string | null,
): AttentionDocument {
  return {
    attributes: {
      id,
      target,
      createdAt: '2026-07-11T00:00:00Z',
      resolvedAt: null,
      notifiedAt,
      operatorRequest:
        operatorRequest === undefined
          ? notifiedAt
            ? `home:H-1/event:EV-${id}`
            : null
          : operatorRequest,
    },
    body: 'Needs you.\n',
  }
}
