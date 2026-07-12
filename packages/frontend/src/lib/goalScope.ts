export type GoalSurface = 'board' | 'docs'

export interface GoalScope {
  projectId: string
  goalId: string
}

export function buildGoalRoute(scope: GoalScope | null, surface: GoalSurface) {
  if (!scope) return '/projects'
  return `/projects/${encodeURIComponent(scope.projectId)}/${surface}/${encodeURIComponent(scope.goalId)}`
}

export function readGoalRouteState(pathname: string): GoalScope | null {
  const match = /^\/projects\/([^/]+)\/(?:board|docs)\/([^/]+)$/.exec(pathname)
  if (!match?.[1] || !match[2]) return null
  return { projectId: decodeURIComponent(match[1]), goalId: decodeURIComponent(match[2]) }
}
