import { expect, test } from 'bun:test'
import type { GoalRouteDetail, WorkRouteState, WorkRouteView } from '../../lib/api'
import { layoutGoalRoute, routeEdgePath } from './routeLayout'

function work(
  id: string,
  kind: WorkRouteView['kind'],
  state: WorkRouteState,
  dependsOn: string[] = [],
  status: WorkRouteView['status'] = 'open',
): WorkRouteView {
  return {
    id,
    title: id,
    kind,
    status,
    createdAt: '2026-08-14T00:00:00.000Z',
    notBefore: null,
    dependsOn,
    contractRevision: 1,
    evidenceRefs: [],
    runAttemptCount: 0,
    completedAt: status === 'done' ? '2026-08-14T01:00:00.000Z' : null,
    activeAttempt: null,
    blockedBy: null,
    projection: { workId: id, state, ready: state === 'ready', failedPredicates: [] },
  }
}

function route(nodes: WorkRouteView[], fogSummary: string | null = null): GoalRouteDetail['route'] {
  return {
    destination: { goalId: 'goal-1', title: 'Ship the feature', lifecycle: 'active' },
    nodes,
    edges: [],
    completedDecisionCount: nodes.filter(
      (node) => node.kind === 'decision' && node.status === 'done',
    ).length,
    completedEngineeringCount: nodes.filter(
      (node) => node.kind === 'engineering' && node.status === 'done',
    ).length,
    focusWorkId: nodes.find((node) => node.status === 'open')?.id ?? null,
    mapPath: '.hopi/goals/goal-1/design/map.md',
    fogSummary,
  }
}

test('layout derives dependency layers, collapses history, and ends at destination', () => {
  const completed = work('research', 'decision', 'done', [], 'done')
  const decide = work('decide', 'decision', 'ready', ['research'])
  const build = work('build', 'engineering', 'blocked', ['decide'])
  const layout = layoutGoalRoute(route([completed, decide, build], 'Unknown work stays beyond this point'))

  const history = layout.nodes.find((node) => node.id === 'history:decision')
  const decideNode = layout.nodes.find((node) => node.id === 'work:decide')
  const buildNode = layout.nodes.find((node) => node.id === 'work:build')
  const destination = layout.nodes.find((node) => node.id === 'destination')

  expect(history?.type).toBe('history')
  expect(decideNode?.x).toBeGreaterThan(history?.x ?? Number.POSITIVE_INFINITY)
  expect(buildNode?.x).toBeGreaterThan(decideNode?.x ?? Number.POSITIVE_INFINITY)
  expect(destination?.x).toBeGreaterThan(buildNode?.x ?? Number.POSITIVE_INFINITY)
  expect(layout.edges).toContainEqual({ from: 'history:decision', to: 'work:decide', dashed: false })
  expect(layout.edges).toContainEqual({ from: 'work:decide', to: 'work:build', dashed: false })
  expect(layout.edges).toContainEqual({ from: 'work:build', to: 'destination', dashed: true })
  expect(layout.width).toBeLessThanOrEqual(900)
})

test('a four-step branched route fits a common desktop viewport at a glance', () => {
  const research = work('research', 'decision', 'done', [], 'done')
  const removePipeline = work('remove-pipeline', 'engineering', 'done', ['research'], 'done')
  const decide = work('decide', 'decision', 'needs_user', ['remove-pipeline'])
  const build = work('build', 'engineering', 'blocked', ['decide'])
  const navigate = work('navigate', 'engineering', 'blocked', ['decide'])
  const validate = work('validate', 'decision', 'blocked', ['build', 'navigate'])

  const layout = layoutGoalRoute(
    route([research, removePipeline, decide, build, navigate, validate], 'Fog remains explicit'),
  )

  expect(layout.width).toBeLessThanOrEqual(1160)
})

test('layout is deterministic regardless of input order', () => {
  const first = work('a', 'decision', 'ready')
  const second = work('b', 'engineering', 'blocked', ['a'])

  expect(layoutGoalRoute(route([first, second]))).toEqual(layoutGoalRoute(route([second, first])))
})

test('route paths join the right edge of a source to the left edge of a target', () => {
  const layout = layoutGoalRoute(route([work('a', 'engineering', 'ready')]))
  const from = layout.nodes.find((node) => node.id === 'work:a')
  const to = layout.nodes.find((node) => node.id === 'destination')

  expect(from).toBeDefined()
  expect(to).toBeDefined()
  expect(routeEdgePath(from!, to!)).toMatch(
    new RegExp(`^M ${from!.x + from!.width} ${from!.y + from!.height / 2} C `),
  )
  expect(routeEdgePath(from!, to!)).toEndWith(`${to!.x} ${to!.y + to!.height / 2}`)
})
