import { describe, expect, test } from 'bun:test'
import type { GoalDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { deriveGoalWorkProjections } from '../src/domain/workProjection'

describe('derived Route state', () => {
  test('derives one state from claims and prerequisites without lanes', () => {
    const goalPackage = packageWith([
      work('W-done', 'done'),
      work('W-running', 'open'),
      work('W-queued', 'open'),
      work('W-dependent', 'open', ['W-running']),
      work('W-ready', 'open'),
    ])
    const projections = project(goalPackage, {
      runningWorkIds: new Set(['W-running']),
      queuedWorkIds: new Set(['W-queued']),
    })
    expect(Object.fromEntries(projections.map((item) => [item.workId, item.state]))).toEqual({
      'W-done': 'done',
      'W-running': 'running',
      'W-queued': 'queued',
      'W-dependent': 'blocked',
      'W-ready': 'ready',
    })
  })

  test('settled current authority waits for Assistant and Attention takes precedence', () => {
    const goalPackage = packageWith([work('W-1', 'open')])
    goalPackage.attentions.set('A-1', {
      attributes: {
        id: 'A-1',
        target: 'project:P-1/goal:G-1/work:W-1',
        createdAt: '2026-08-14T00:00:00Z',
        resolvedAt: null,
        resolutionInput: null,
        summary: 'Choose one.',
        decisionPrompt: null,
      },
      body: 'Choose one.\n',
    })
    expect(project(goalPackage, { settledWorkIds: new Set(['W-1']) })[0]?.state).toBe('needs_user')
  })

  test('a newer explicit claim supersedes an older settled Report', () => {
    const goalPackage = packageWith([work('W-retry', 'open')])

    expect(
      deriveGoalWorkProjections('P-1', 'G-1', goalPackage, {
        projectEligible: true,
        runningWorkIds: new Set(),
        queuedWorkIds: new Set(['W-retry']),
        settledWorkIds: new Set(['W-retry']),
        now: new Date('2026-08-14T00:00:00.000Z'),
      })[0],
    ).toMatchObject({ state: 'queued', failedPredicates: ['queued_run'] })
  })
})

function project(
  goalPackage: GoalPackage,
  overrides: Partial<Parameters<typeof deriveGoalWorkProjections>[3]> = {},
) {
  return deriveGoalWorkProjections('P-1', 'G-1', goalPackage, {
    projectEligible: true,
    runningWorkIds: new Set(),
    queuedWorkIds: new Set(),
    settledWorkIds: new Set(),
    now: new Date('2026-08-14T00:00:00Z'),
    ...overrides,
  })
}

function packageWith(works: WorkDocument[]): GoalPackage {
  const goal: GoalDocument = {
    attributes: { id: 'G-1', title: 'Goal', lifecycle: 'active', priority: 0, contractRevision: 1 },
    body: '## Objective\n\nReach it.\n',
  }
  return {
    goal,
    works: new Map(works.map((item) => [item.attributes.id, item])),
    attentions: new Map(),
    evidence: new Map(),
    inputs: [],
  }
}

function work(id: string, status: 'open' | 'done', dependsOn: string[] = []): WorkDocument {
  return {
    attributes: {
      id,
      title: id,
      kind: 'engineering',
      status,
      createdAt: `2026-08-14T00:00:0${id.length % 10}Z`,
      notBefore: null,
      dependsOn,
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: '## Objective\n\nBuild it.\n',
  }
}
