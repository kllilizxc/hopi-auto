import type { GoalRouteDetail, WorkRouteView } from '../../lib/api'

export const ROUTE_NODE_WIDTH = 184
export const ROUTE_NODE_HEIGHT = 92

export type RouteLayoutNode =
  | {
      id: string
      type: 'work'
      x: number
      y: number
      width: number
      height: number
      work: WorkRouteView
    }
  | {
      id: string
      type: 'history'
      historyKind: 'decision' | 'engineering'
      count: number
      x: number
      y: number
      width: number
      height: number
    }
  | {
      id: string
      type: 'destination'
      x: number
      y: number
      width: number
      height: number
    }

export interface RouteLayoutEdge {
  from: string
  to: string
  dashed: boolean
}

export interface RouteLayout {
  width: number
  height: number
  nodes: RouteLayoutNode[]
  edges: RouteLayoutEdge[]
}

type UnpositionedRouteLayoutNode =
  | Omit<Extract<RouteLayoutNode, { type: 'work' }>, 'x' | 'y'>
  | Omit<Extract<RouteLayoutNode, { type: 'history' }>, 'x' | 'y'>
  | Omit<Extract<RouteLayoutNode, { type: 'destination' }>, 'x' | 'y'>

const LEFT = 24
const TOP = 36
const COLUMN_GAP = 48
const ROW_GAP = 24
const DESTINATION_WIDTH = 156

export function layoutGoalRoute(route: GoalRouteDetail['route']): RouteLayout {
  const works = route.nodes.filter((work) => work.status === 'open')
  const openById = new Map(works.map((work) => [work.id, work]))
  const allById = new Map(route.nodes.map((work) => [work.id, work]))
  const history = [
    ...(route.completedDecisionCount > 0
      ? [{ id: 'history:decision', kind: 'decision' as const, count: route.completedDecisionCount }]
      : []),
    ...(route.completedEngineeringCount > 0
      ? [{ id: 'history:engineering', kind: 'engineering' as const, count: route.completedEngineeringCount }]
      : []),
  ]
  const rootLayer = history.length > 0 ? 1 : 0
  const layerByWork = new Map<string, number>()

  const layerFor = (workId: string, visiting = new Set<string>()): number => {
    const cached = layerByWork.get(workId)
    if (cached !== undefined) return cached
    if (visiting.has(workId)) return rootLayer
    const work = openById.get(workId)
    if (!work) return rootLayer
    const nextVisiting = new Set(visiting).add(workId)
    const openDependencies = work.dependsOn.filter((dependencyId) => openById.has(dependencyId))
    const layer = openDependencies.length
      ? Math.max(...openDependencies.map((dependencyId) => layerFor(dependencyId, nextVisiting))) + 1
      : rootLayer
    layerByWork.set(workId, layer)
    return layer
  }

  for (const work of works) layerFor(work.id)
  const lastWorkLayer = Math.max(rootLayer, ...layerByWork.values())
  const destinationLayer = works.length > 0 ? lastWorkLayer + 1 : history.length > 0 ? 1 : 0
  const groups = new Map<number, UnpositionedRouteLayoutNode[]>()
  const add = (layer: number, node: UnpositionedRouteLayoutNode) => {
    const group = groups.get(layer) ?? []
    group.push(node)
    groups.set(layer, group)
  }

  for (const item of history) {
    add(0, {
      id: item.id,
      type: 'history',
      historyKind: item.kind,
      count: item.count,
      width: ROUTE_NODE_WIDTH,
      height: ROUTE_NODE_HEIGHT,
    })
  }
  for (const work of works) {
    add(layerByWork.get(work.id) ?? rootLayer, {
      id: `work:${work.id}`,
      type: 'work',
      work,
      width: ROUTE_NODE_WIDTH,
      height: ROUTE_NODE_HEIGHT,
    })
  }
  add(destinationLayer, {
    id: 'destination',
    type: 'destination',
    width: DESTINATION_WIDTH,
    height: ROUTE_NODE_HEIGHT,
  })

  const largestGroup = Math.max(1, ...[...groups.values()].map((group) => group.length))
  const height = Math.max(430, TOP * 2 + largestGroup * ROUTE_NODE_HEIGHT + (largestGroup - 1) * ROW_GAP)
  const nodes: RouteLayoutNode[] = []
  for (const [layer, group] of [...groups].sort(([left], [right]) => left - right)) {
    const groupHeight = group.length * ROUTE_NODE_HEIGHT + (group.length - 1) * ROW_GAP
    const y = Math.max(TOP, (height - groupHeight) / 2)
    const x = LEFT + layer * (ROUTE_NODE_WIDTH + COLUMN_GAP)
    group
      .toSorted((left, right) => nodeOrder(left) - nodeOrder(right) || left.id.localeCompare(right.id))
      .forEach((node, index) => nodes.push({ ...node, x, y: y + index * (ROUTE_NODE_HEIGHT + ROW_GAP) } as RouteLayoutNode))
  }

  const edges: RouteLayoutEdge[] = []
  const openOutgoing = new Map(works.map((work) => [work.id, 0]))
  for (const work of works) {
    for (const dependencyId of work.dependsOn) {
      const dependency = allById.get(dependencyId)
      if (!dependency || dependency.status === 'cancelled') continue
      if (dependency.status === 'open') {
        edges.push({ from: `work:${dependencyId}`, to: `work:${work.id}`, dashed: false })
        openOutgoing.set(dependencyId, (openOutgoing.get(dependencyId) ?? 0) + 1)
      } else {
        edges.push({
          from: dependency.kind === 'decision' ? 'history:decision' : 'history:engineering',
          to: `work:${work.id}`,
          dashed: false,
        })
      }
    }
  }
  const leaves = works.filter((work) => (openOutgoing.get(work.id) ?? 0) === 0)
  if (leaves.length > 0) {
    for (const work of leaves) {
      edges.push({ from: `work:${work.id}`, to: 'destination', dashed: Boolean(route.fogSummary) })
    }
  } else if (history.length > 0) {
    for (const item of history) edges.push({ from: item.id, to: 'destination', dashed: false })
  }

  const validNodeIds = new Set(nodes.map((node) => node.id))
  const uniqueEdges = new Map(
    edges
      .filter((edge) => validNodeIds.has(edge.from) && validNodeIds.has(edge.to))
      .map((edge) => [`${edge.from}\u0000${edge.to}`, edge]),
  )
  const width = Math.max(760, LEFT * 2 + destinationLayer * (ROUTE_NODE_WIDTH + COLUMN_GAP) + DESTINATION_WIDTH)
  return { width, height, nodes, edges: [...uniqueEdges.values()] }
}

export function routeEdgePath(from: RouteLayoutNode, to: RouteLayoutNode) {
  const startX = from.x + from.width
  const startY = from.y + from.height / 2
  const endX = to.x
  const endY = to.y + to.height / 2
  const control = Math.max(36, (endX - startX) / 2)
  return `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`
}

function nodeOrder(node: UnpositionedRouteLayoutNode) {
  if (node.type === 'history') return node.historyKind === 'decision' ? 0 : 1
  if (node.type === 'destination') return 0
  const stateOrder = {
    running: 0,
    queued: 1,
    needs_user: 2,
    waiting_assistant: 3,
    ready: 4,
    scheduled: 5,
    blocked: 6,
    done: 7,
    cancelled: 8,
  } as const
  return stateOrder[node.work.projection.state]
}
