import { describe, expect, test } from 'bun:test'
import type { GoalDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { deriveGoalWorkProjections } from '../src/domain/workProjection'

describe('derived Work projection', () => {
  test('keeps the old four-lane projection and cancelled archive', () => {
    const projections = project(
      packageWith([
        work('P-1', 'planning', 'plan'),
        work('W-1', 'engineering', 'generate'),
        work('W-2', 'engineering', 'review'),
        work('W-3', 'engineering', 'done'),
        work('W-4', 'engineering', 'cancelled'),
      ]),
    )
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

  test('does not synthesize a Run from Work kind or stage', () => {
    const [planning, build, review] = project(
      packageWith([
        work('P-1', 'planning', 'plan'),
        work('W-build', 'engineering', 'generate'),
        work('W-review', 'engineering', 'review'),
      ]),
    )
    for (const projection of [planning, build, review]) {
      expect(projection).toMatchObject({
        ready: false,
        responsibility: null,
        primaryBadge: 'waiting',
        failedPredicates: ['no_queued_run'],
      })
    }
  })

  test('projects only an explicitly queued profile as runnable', () => {
    const [projection] = project(packageWith([work('W-1', 'engineering', 'review')]), {
      queuedRunProfiles: new Map([['W-1', 'generator']]),
    })
    expect(projection).toMatchObject({
      ready: true,
      responsibility: 'generator',
      primaryBadge: 'queued',
      failedPredicates: [],
    })
  })

  test('shows a settled Run as waiting for Assistant without changing the lane', () => {
    const [projection] = project(packageWith([work('W-1', 'engineering', 'review')]), {
      settledRunWorkIds: new Set(['W-1']),
    })
    expect(projection).toMatchObject({
      column: 'Review',
      ready: false,
      responsibility: null,
      primaryBadge: 'Waiting for Assistant',
      failedPredicates: ['no_queued_run'],
    })
  })

  test('retains lifecycle, dependency, schedule, lease, and capacity gates', () => {
    const goalPackage = packageWith([
      work('W-dependency', 'engineering', 'generate'),
      work('W-1', 'engineering', 'generate', {
        dependsOn: ['W-dependency'],
        notBefore: '2026-08-14T00:00:00Z',
      }),
    ])
    goalPackage.goal.attributes.lifecycle = 'paused'
    const projection = project(goalPackage, {
      projectEligible: false,
      liveRunWorkIds: new Set(['W-1']),
      queuedRunProfiles: new Map([['W-1', 'generator']]),
      runCapacity: { planner: true, generator: false, reviewer: true },
    })[1]
    expect(projection?.failedPredicates).toEqual(
      expect.arrayContaining([
        'goal_not_active',
        'project_ineligible',
        'dependency_incomplete',
        'not_before',
        'live_run',
        'capacity',
      ]),
    )
  })
})

function project(
  goalPackage: GoalPackage,
  overrides: Partial<Parameters<typeof deriveGoalWorkProjections>[3]> = {},
) {
  return deriveGoalWorkProjections('P-1', 'G-1', goalPackage, {
    projectEligible: true,
    liveRunWorkIds: new Set(),
    queuedRunProfiles: new Map(),
    settledRunWorkIds: new Set(),
    runCapacity: { planner: true, generator: true, reviewer: true },
    now: new Date('2026-08-13T00:00:00Z'),
    ...overrides,
  })
}

function packageWith(works: WorkDocument[]): GoalPackage {
  const goal: GoalDocument = {
    attributes: { id: 'G-1', title: 'Goal', lifecycle: 'active', priority: 0, contractRevision: 1 },
    body: 'Goal contract.\n',
  }
  return {
    goal,
    works: new Map(works.map((document) => [document.attributes.id, document])),
    attentions: new Map(),
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
  const common = {
    id,
    title: id,
    notBefore: null,
    dependsOn: [],
    contractRevision: 1,
    evidenceRefs: [],
    contextRefs: [],
    ownerMessages: [],
    ...overrides,
  }
  return kind === 'planning'
    ? { attributes: { ...common, kind, stage: stage as 'plan' | 'done' | 'cancelled' }, body: '' }
    : {
        attributes: {
          ...common,
          kind,
          stage: stage as 'generate' | 'review' | 'done' | 'cancelled',
        },
        body: '',
      }
}
