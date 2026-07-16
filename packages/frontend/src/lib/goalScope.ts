export type GoalSurface = 'board' | 'docs'

export interface GoalScope {
  projectId: string
  goalId: string
}

export interface GoalPreferenceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const RECENT_GOAL_KEY_PREFIX = 'hopi.navigation.recent-goal.'

export function buildGoalRoute(scope: GoalScope | null, surface: GoalSurface) {
  if (!scope) return '/projects'
  return `/projects/${encodeURIComponent(scope.projectId)}/${surface}/${encodeURIComponent(scope.goalId)}`
}

export function readGoalRouteState(pathname: string): GoalScope | null {
  const match = /^\/projects\/([^/]+)\/(?:board|docs)\/([^/]+)$/.exec(pathname)
  if (!match?.[1] || !match[2]) return null
  return { projectId: decodeURIComponent(match[1]), goalId: decodeURIComponent(match[2]) }
}

export function readRecentGoalId(
  projectId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
) {
  try {
    return storage?.getItem(recentGoalKey(projectId)) ?? null
  } catch {
    return null
  }
}

export function rememberRecentGoal(
  projectId: string,
  goalId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
) {
  try {
    storage?.setItem(recentGoalKey(projectId), goalId)
  } catch {
    // Navigation preferences must never block the workspace when storage is unavailable.
  }
}

export function resolveProjectGoalId(
  goals: readonly { id: string }[],
  recentGoalId: string | null,
) {
  if (recentGoalId && goals.some((goal) => goal.id === recentGoalId)) return recentGoalId
  return goals[0]?.id ?? null
}

function recentGoalKey(projectId: string) {
  return `${RECENT_GOAL_KEY_PREFIX}${encodeURIComponent(projectId)}`
}

function browserPreferenceStorage(): GoalPreferenceStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
