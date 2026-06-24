import { describe, expect, test } from 'bun:test'
import type { ProjectRecord } from './api'
import {
  buildGoalRoute,
  readGoalRouteState,
  resolveNavigableGoalScope,
} from './goalScope'

function makeProject(
  projectKey: string,
  lastOpenedGoalKey?: string,
): ProjectRecord {
  return {
    projectKey,
    name: `${projectKey} name`,
    rootDir: `/tmp/${projectKey}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastOpenedGoalKey,
    codingDefaults: {
      transport: 'codex',
    },
  }
}

describe('buildGoalRoute', () => {
  test('only generates project-scoped routes', () => {
    expect(
      buildGoalRoute({ projectKey: 'alpha', goalKey: 'goal-1' }, 'board'),
    ).toBe('/projects/alpha/board/goal-1')
    expect(buildGoalRoute({ projectKey: null, goalKey: 'goal-1' }, 'board')).toBe(
      '/projects',
    )
    expect(buildGoalRoute({ projectKey: 'alpha', goalKey: null }, 'board')).toBe(
      '/projects',
    )
  })
})

describe('readGoalRouteState', () => {
  test('does not recognize legacy goal routes', () => {
    expect(readGoalRouteState('/board/goal-1')).toEqual({
      projectKey: null,
      goalKey: null,
    })
  })
})

describe('resolveNavigableGoalScope', () => {
  test('falls back from remembered goal key to the matching project', () => {
    const projects = [
      makeProject('alpha', 'goal-1'),
      makeProject('beta', 'goal-2'),
    ]

    expect(
      resolveNavigableGoalScope(
        { projectKey: null, goalKey: null },
        { projectKey: null, goalKey: 'goal-2' },
        projects,
      ),
    ).toEqual({
      projectKey: 'beta',
      goalKey: 'goal-2',
    })
  })
})
