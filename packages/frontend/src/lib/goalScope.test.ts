import { describe, expect, test } from 'bun:test'
import {
  buildGoalRoute,
  findNewestUnseenGoal,
  orderGoalsByRecency,
  orderProjectsByRecency,
  readGoalRouteState,
  readGoalViewState,
  readRecentGoalId,
  readRecentGoals,
  readRecentProjects,
  rememberRecentProject,
  rememberRecentGoal,
  rememberGoalViewState,
  resolveProjectGoalId,
  selectPeerShortcuts,
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

describe('recent workspace navigation', () => {
  test('remembers Project and Goal visit histories independently', () => {
    const values = new Map<string, string>()
    const storage: GoalPreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }

    rememberRecentProject('P-1', storage, new Date('2026-07-17T09:00:00Z'))
    rememberRecentProject('P-2', storage, new Date('2026-07-17T10:00:00Z'))
    rememberRecentGoal('P-1', 'G-1', storage, new Date('2026-07-17T09:30:00Z'))
    rememberRecentGoal('P-1', 'G-2', storage, new Date('2026-07-17T10:01:00Z'))
    rememberRecentGoal('P-2', 'G-9', storage, new Date('2026-07-17T10:02:00Z'))
    rememberRecentGoal('P-1', 'G-1', storage, new Date('2026-07-17T10:03:00Z'))

    expect(readRecentProjects(storage)).toEqual([
      { projectId: 'P-2', visitedAt: '2026-07-17T10:00:00.000Z' },
      { projectId: 'P-1', visitedAt: '2026-07-17T09:00:00.000Z' },
    ])
    expect(readRecentGoals('P-1', storage)).toEqual([
      { projectId: 'P-1', goalId: 'G-1', visitedAt: '2026-07-17T10:03:00.000Z' },
      { projectId: 'P-1', goalId: 'G-2', visitedAt: '2026-07-17T10:01:00.000Z' },
    ])
    expect(readRecentGoalId('P-1', storage)).toBe('G-1')
    expect(readRecentGoalId('P-2', storage)).toBe('G-9')
  })

  test('orders every visited Project before never-visited Projects', () => {
    const projects = [
      { projectId: 'P-myquant' },
      { projectId: 'P-cardgame' },
      { projectId: 'P-game-asset-skill' },
      { projectId: 'P-unvisited' },
    ]

    expect(
      orderProjectsByRecency(projects, [
        { projectId: 'P-myquant', visitedAt: '2026-07-17T10:00:00Z' },
        { projectId: 'P-game-asset-skill', visitedAt: '2026-07-17T09:00:00Z' },
      ]).map((project) => project.projectId),
    ).toEqual(['P-myquant', 'P-game-asset-skill', 'P-cardgame', 'P-unvisited'])
  })

  test('limits direct Project shortcuts while keeping the current Project visible', () => {
    const projects = [
      { projectId: 'P-recent' },
      { projectId: 'P-second' },
      { projectId: 'P-current' },
      { projectId: 'P-other' },
    ]

    expect(
      selectPeerShortcuts(projects, 'P-second', 2, (project) => project.projectId).map(
        (project) => project.projectId,
      ),
    ).toEqual(['P-recent', 'P-second'])
    expect(
      selectPeerShortcuts(projects, 'P-current', 2, (project) => project.projectId).map(
        (project) => project.projectId,
      ),
    ).toEqual(['P-current', 'P-recent'])
    expect(
      selectPeerShortcuts(projects, 'P-current', 1, (project) => project.projectId),
    ).toEqual([{ projectId: 'P-current' }])
    expect(
      selectPeerShortcuts(
        [{ id: 'G-recent' }, { id: 'G-current' }, { id: 'G-other' }],
        'G-current',
        1,
        (goal) => goal.id,
      ),
    ).toEqual([{ id: 'G-current' }])
  })

  test('migrates the previous single-Project preference into visit history', () => {
    const values = new Map([
      [
        'hopi.navigation.recent-project',
        JSON.stringify({ projectId: 'P-legacy', visitedAt: '2026-07-17T10:00:00Z' }),
      ],
    ])
    const storage: GoalPreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }

    expect(readRecentProjects(storage)).toEqual([
      { projectId: 'P-legacy', visitedAt: '2026-07-17T10:00:00Z' },
    ])
    expect(JSON.parse(values.get('hopi.navigation.recent-project') ?? 'null')).toEqual([
      { projectId: 'P-legacy', visitedAt: '2026-07-17T10:00:00Z' },
    ])
  })

  test('orders Goals by the newer of creation and last visit', () => {
    const goals = [
      { id: 'G-old', createdAt: '2026-07-17T10:00:00Z' },
      { id: 'G-new', createdAt: '2026-07-17T10:20:00Z' },
      { id: 'G-legacy', createdAt: null },
    ]
    const olderVisits = [
      { projectId: 'P-1', goalId: 'G-old', visitedAt: '2026-07-17T10:10:00Z' },
      { projectId: 'P-1', goalId: 'G-legacy', visitedAt: '2026-07-17T10:05:00Z' },
    ]
    const newerVisits = [
      { projectId: 'P-1', goalId: 'G-old', visitedAt: '2026-07-17T10:30:00Z' },
      { projectId: 'P-1', goalId: 'G-legacy', visitedAt: '2026-07-17T10:25:00Z' },
    ]

    expect(orderGoalsByRecency(goals, 'P-1', olderVisits).map((goal) => goal.id)).toEqual([
      'G-new',
      'G-old',
      'G-legacy',
    ])
    expect(orderGoalsByRecency(goals, 'P-1', newerVisits).map((goal) => goal.id)).toEqual([
      'G-old',
      'G-legacy',
      'G-new',
    ])
    expect(resolveProjectGoalId(goals, 'P-1', olderVisits)).toBe('G-new')
    expect(resolveProjectGoalId(goals, 'P-1', newerVisits)).toBe('G-old')
  })

  test('keeps a stable fallback when no Goal has recency evidence', () => {
    const goals = [{ id: 'G-1' }, { id: 'G-2' }]

    expect(resolveProjectGoalId(goals, 'P-1', [])).toBe('G-1')
    expect(resolveProjectGoalId([], 'P-1', [])).toBeNull()
  })

  test('detects the newest Goal introduced by an Assistant refresh', () => {
    const goals = [
      { id: 'G-known', createdAt: '2026-07-17T10:00:00Z' },
      { id: 'G-newer', createdAt: '2026-07-17T10:30:00Z' },
      { id: 'G-new', createdAt: '2026-07-17T10:20:00Z' },
    ]

    expect(findNewestUnseenGoal(goals, 'P-1', new Set(['G-known']))?.id).toBe('G-newer')
    expect(findNewestUnseenGoal(goals, 'P-1', new Set(goals.map((goal) => goal.id)))).toBeNull()
  })

  test('migrates previous single-Goal preferences into visit history', () => {
    const values = new Map([
      ['hopi.navigation.recent-goal.P-1', 'G-plain'],
      [
        'hopi.navigation.recent-goal.P-2',
        JSON.stringify({
          projectId: 'P-2',
          goalId: 'G-object',
          visitedAt: '2026-07-17T10:00:00Z',
        }),
      ],
    ])
    const storage: GoalPreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }

    expect(readRecentGoals('P-1', storage)[0]).toMatchObject({ projectId: 'P-1', goalId: 'G-plain' })
    expect(readRecentGoals('P-2', storage)).toEqual([
      { projectId: 'P-2', goalId: 'G-object', visitedAt: '2026-07-17T10:00:00Z' },
    ])
    expect(JSON.parse(values.get('hopi.navigation.recent-goal.P-1') ?? 'null')).toHaveLength(1)
    expect(JSON.parse(values.get('hopi.navigation.recent-goal.P-2') ?? 'null')).toEqual([
      { projectId: 'P-2', goalId: 'G-object', visitedAt: '2026-07-17T10:00:00Z' },
    ])
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
    expect(readRecentGoals('P-1', unavailableStorage)).toEqual([])
    expect(readRecentProjects(unavailableStorage)).toEqual([])
    expect(() => rememberRecentProject('P-1', unavailableStorage)).not.toThrow()
    expect(() => rememberRecentGoal('P-1', 'G-1', unavailableStorage)).not.toThrow()
  })

  test('keeps presentation state isolated by Project and Goal', () => {
    const values = new Map<string, string>()
    const storage: GoalPreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    }

    rememberGoalViewState(
      'P-1',
      'G-1',
      { expandedWorkIds: ['work-a', 'work-b', 'work-a'], mobileLane: 'Review' },
      storage,
    )

    expect(readGoalViewState('P-1', 'G-1', storage)).toEqual({
      expandedWorkIds: ['work-a', 'work-b'],
      mobileLane: 'Review',
    })
    expect(readGoalViewState('P-1', 'G-2', storage)).toEqual({
      expandedWorkIds: [],
      mobileLane: null,
    })
    expect(readGoalViewState('P-2', 'G-1', storage)).toEqual({
      expandedWorkIds: [],
      mobileLane: null,
    })
  })
})
