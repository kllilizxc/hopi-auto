import { describe, expect, test } from 'bun:test'
import {
  isDesignDocumentPath,
  matchEvidenceArtifactRoute,
  matchGoalDocumentRoute,
  matchGoalRoute,
  matchPreviewRoute,
  matchWorkAttemptRoute,
  matchWorkDocumentRoute,
  readGoalView,
} from '../src/api/routeMatchers'

const parts = (path: string) => path.split('/').filter(Boolean)

describe('API route matching', () => {
  test('matches Goal resources and only their supported actions', () => {
    expect(matchGoalRoute(parts('/api/projects/P-1/goals/G-1'))).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      action: null,
    })
    expect(matchGoalRoute(parts('/api/projects/P-1/goals/G-1/execution-cost'))).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      action: 'execution-cost',
    })
    expect(matchGoalRoute(parts('/api/projects/P-1/goals/G-1/unknown'))).toBeNull()
    expect(matchGoalRoute(parts('/api/projects/P-1/goals/G-1/pause/extra'))).toBeNull()
  })

  test('matches canonical Work and Goal document resources exactly', () => {
    expect(matchWorkDocumentRoute(parts('/api/projects/P-1/goals/G-1/works/W-1'))).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    })
    expect(matchGoalDocumentRoute(parts('/api/projects/P-1/goals/G-1/documents'))).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect(matchWorkDocumentRoute(parts('/api/projects/P-1/goals/G-1/works/W-1/extra'))).toBeNull()
  })

  test('keeps design document access inside the canonical Markdown subtree', () => {
    const root = '.hopi/docs/goals/G-1/design'
    expect(isDesignDocumentPath(root, `${root}/index.md`)).toBeTrue()
    expect(isDesignDocumentPath(root, `${root}/flows/checkout.md`)).toBeTrue()
    expect(isDesignDocumentPath(root, `${root}/../goal.md`)).toBeFalse()
    expect(isDesignDocumentPath(root, `${root}/asset.png`)).toBeFalse()
    expect(isDesignDocumentPath(root, `${root}//empty.md`)).toBeFalse()
  })

  test('matches Preview, Attempt, and Evidence artifact resources', () => {
    expect(matchPreviewRoute(parts('/api/projects/P-1/preview/start'))).toEqual({
      projectId: 'P-1',
      action: 'start',
    })
    expect(matchWorkAttemptRoute(parts('/api/projects/P-1/goals/G-1/works/W-1/attempts'))).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: null,
      events: false,
    })
    expect(
      matchWorkAttemptRoute(parts('/api/projects/P-1/goals/G-1/works/W-1/attempts/R-1/events')),
    ).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      events: true,
    })
    expect(
      matchEvidenceArtifactRoute(parts('/api/projects/P-1/goals/G-1/evidence/E-1/artifacts/2')),
    ).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      evidenceId: 'E-1',
      artifactIndex: 2,
    })
    expect(
      matchEvidenceArtifactRoute(
        parts('/api/projects/P-1/goals/G-1/evidence/E-1/artifacts/not-a-number'),
      ),
    ).toBeNull()
  })

  test('accepts only the explicit Goal representations', () => {
    expect(readGoalView('route')).toBe('route')
    expect(readGoalView('docs')).toBe('docs')
    expect(readGoalView('full')).toBe('full')
    expect(readGoalView('unknown')).toBeNull()
    expect(readGoalView(null)).toBe('full')
  })
})
