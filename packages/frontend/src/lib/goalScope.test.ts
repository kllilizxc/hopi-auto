import { describe, expect, test } from 'bun:test'
import { buildGoalRoute, readGoalRouteState } from './goalScope'

describe('Goal routes', () => {
  test('builds board and design routes from stable scoped identity', () => {
    const scope = { projectId: 'project alpha', goalId: 'goal/1' }

    expect(buildGoalRoute(scope, 'board')).toBe('/projects/project%20alpha/board/goal%2F1')
    expect(buildGoalRoute(scope, 'docs')).toBe('/projects/project%20alpha/docs/goal%2F1')
    expect(buildGoalRoute(null, 'board')).toBe('/projects')
  })

  test('reads only Goal-scoped product routes', () => {
    expect(readGoalRouteState('/projects/P-1/board/G-1')).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect(readGoalRouteState('/projects/P-1/docs/G-1')).toEqual({
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect(readGoalRouteState('/projects/P-1/session/G-1')).toBeNull()
    expect(readGoalRouteState('/projects')).toBeNull()
  })
})
