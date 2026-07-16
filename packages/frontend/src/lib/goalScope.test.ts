import { describe, expect, test } from 'bun:test'
import {
  buildGoalRoute,
  readGoalRouteState,
  readRecentGoalId,
  rememberRecentGoal,
  resolveProjectGoalId,
  type GoalPreferenceStorage,
} from './goalScope'

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

describe('recent Goal navigation', () => {
  test('remembers a Goal independently for each Project', () => {
    const values = new Map<string, string>()
    const storage: GoalPreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }

    rememberRecentGoal('P-1', 'G-2', storage)
    rememberRecentGoal('P-2', 'G-9', storage)

    expect(readRecentGoalId('P-1', storage)).toBe('G-2')
    expect(readRecentGoalId('P-2', storage)).toBe('G-9')
  })

  test('restores the recent Goal when it still belongs to the Project', () => {
    expect(resolveProjectGoalId([{ id: 'G-1' }, { id: 'G-2' }], 'G-2')).toBe('G-2')
  })

  test('falls back to the first Goal when the preference is missing or stale', () => {
    const goals = [{ id: 'G-1' }, { id: 'G-2' }]

    expect(resolveProjectGoalId(goals, null)).toBe('G-1')
    expect(resolveProjectGoalId(goals, 'G-deleted')).toBe('G-1')
    expect(resolveProjectGoalId([], 'G-deleted')).toBeNull()
  })

  test('ignores unavailable browser storage', () => {
    const unavailableStorage: GoalPreferenceStorage = {
      getItem: () => {
        throw new Error('unavailable')
      },
      setItem: () => {
        throw new Error('unavailable')
      },
    }

    expect(readRecentGoalId('P-1', unavailableStorage)).toBeNull()
    expect(() => rememberRecentGoal('P-1', 'G-1', unavailableStorage)).not.toThrow()
  })
})
