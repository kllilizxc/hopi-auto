export type GoalSurface = 'board' | 'docs'

export interface GoalScope {
  projectId: string
  goalId: string
}

export interface GoalPreferenceStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export interface RecentProjectPreference {
  projectId: string
  visitedAt: string
}

export interface RecentGoalPreference {
  projectId: string
  goalId: string
  visitedAt: string
}

export type GoalViewLane = 'Plan' | 'Build' | 'Review' | 'Done'

export interface GoalViewState {
  expandedWorkIds: string[]
  mobileLane: GoalViewLane | null
}

const RECENT_PROJECT_KEY = 'hopi.navigation.recent-project'
const RECENT_GOAL_KEY_PREFIX = 'hopi.navigation.recent-goal.'
const GOAL_VIEW_STATE_KEY_PREFIX = 'hopi.view.goal.'

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
  return readRecentGoals(projectId, storage)[0]?.goalId ?? null
}

export function readRecentProjects(
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
) {
  let raw: string | null
  try {
    raw = storage?.getItem(RECENT_PROJECT_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const value = JSON.parse(raw) as unknown
    const preferences = normalizeRecentProjects(value)
    if (!Array.isArray(value) && preferences.length) {
      writePreference(storage, RECENT_PROJECT_KEY, preferences)
    }
    return preferences
  } catch {
    return []
  }
}

export function readRecentGoals(
  projectId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
): RecentGoalPreference[] {
  const key = recentGoalKey(projectId)
  let raw: string | null
  try {
    raw = storage?.getItem(key) ?? null
  } catch {
    return []
  }
  if (!raw) return []

  try {
    const value = JSON.parse(raw) as unknown
    if (!isString(value)) {
      const preferences = normalizeRecentGoals(value, projectId)
      if (!Array.isArray(value) && preferences.length) {
        writePreference(storage, key, preferences)
      }
      return preferences
    }
    raw = value
  } catch {
    // The previous preference format stored only the Goal ID.
  }

  const migrated = { projectId, goalId: raw, visitedAt: new Date().toISOString() }
  try {
    storage?.setItem(key, JSON.stringify([migrated]))
  } catch {
    // A readable legacy preference remains useful even when migration cannot be persisted.
  }
  return [migrated]
}

export function rememberRecentProject(
  projectId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
  visitedAt = new Date(),
) {
  const preference = { projectId, visitedAt: visitedAt.toISOString() }
  const preferences = normalizeRecentProjects([
    preference,
    ...readRecentProjects(storage).filter((item) => item.projectId !== projectId),
  ])
  writePreference(storage, RECENT_PROJECT_KEY, preferences)
  return preferences
}

export function rememberRecentGoal(
  projectId: string,
  goalId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
  visitedAt = new Date(),
) {
  const preference = { projectId, goalId, visitedAt: visitedAt.toISOString() }
  const preferences = normalizeRecentGoals(
    [
      preference,
      ...readRecentGoals(projectId, storage).filter((item) => item.goalId !== goalId),
    ],
    projectId,
  )
  writePreference(storage, recentGoalKey(projectId), preferences)
  return preferences
}

export function readGoalViewState(
  projectId: string,
  goalId: string,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
): GoalViewState {
  let raw: string | null
  try {
    raw = storage?.getItem(goalViewStateKey(projectId, goalId)) ?? null
  } catch {
    return emptyGoalViewState()
  }
  if (!raw) return emptyGoalViewState()

  try {
    return normalizeGoalViewState(JSON.parse(raw) as unknown)
  } catch {
    return emptyGoalViewState()
  }
}

export function rememberGoalViewState(
  projectId: string,
  goalId: string,
  state: GoalViewState,
  storage: GoalPreferenceStorage | null = browserPreferenceStorage(),
) {
  const normalized = normalizeGoalViewState(state)
  writePreference(storage, goalViewStateKey(projectId, goalId), normalized)
  return normalized
}

export function orderProjectsByRecency<T extends { projectId: string }>(
  projects: readonly T[],
  recentProjects: readonly RecentProjectPreference[],
) {
  const visitedAtByProject = new Map(
    recentProjects.map((preference) => [preference.projectId, timestamp(preference.visitedAt)]),
  )
  return stableOrder(projects, (project) => visitedAtByProject.get(project.projectId) ?? 0)
}

export function selectPeerShortcuts<T>(
  items: readonly T[],
  selectedId: string,
  limit: number,
  getId: (item: T) => string,
) {
  if (limit <= 0) return []
  const shortcuts = items.slice(0, limit)
  if (shortcuts.some((item) => getId(item) === selectedId)) return shortcuts

  const selected = items.find((item) => getId(item) === selectedId)
  return selected ? [selected, ...shortcuts.slice(0, limit - 1)] : shortcuts
}

export function orderGoalsByRecency<T extends { id: string; createdAt?: string | null }>(
  goals: readonly T[],
  projectId: string,
  recentGoals: readonly RecentGoalPreference[],
) {
  const visitedAtByGoal = new Map<string, number>()
  for (const preference of recentGoals) {
    if (preference.projectId !== projectId) continue
    visitedAtByGoal.set(
      preference.goalId,
      Math.max(
        visitedAtByGoal.get(preference.goalId) ?? 0,
        timestamp(preference.visitedAt),
      ),
    )
  }
  return stableOrder(goals, (goal) =>
    Math.max(timestamp(goal.createdAt), visitedAtByGoal.get(goal.id) ?? 0),
  )
}

export function findNewestUnseenGoal<T extends { id: string; createdAt?: string | null }>(
  goals: readonly T[],
  projectId: string,
  knownGoalIds: ReadonlySet<string> | undefined,
) {
  const unseen = goals.filter((goal) => !knownGoalIds?.has(goal.id))
  return orderGoalsByRecency(unseen, projectId, [])[0] ?? null
}

export function resolveProjectGoalId<T extends { id: string; createdAt?: string | null }>(
  goals: readonly T[],
  projectId: string,
  recentGoals: readonly RecentGoalPreference[],
) {
  return orderGoalsByRecency(goals, projectId, recentGoals)[0]?.id ?? null
}

function recentGoalKey(projectId: string) {
  return `${RECENT_GOAL_KEY_PREFIX}${encodeURIComponent(projectId)}`
}

function goalViewStateKey(projectId: string, goalId: string) {
  return `${GOAL_VIEW_STATE_KEY_PREFIX}${encodeURIComponent(projectId)}.${encodeURIComponent(goalId)}`
}

function writePreference(
  storage: GoalPreferenceStorage | null,
  key: string,
  value: unknown,
) {
  try {
    storage?.setItem(key, JSON.stringify(value))
  } catch {
    // Navigation preferences must never block the workspace when storage is unavailable.
  }
}

function emptyGoalViewState(): GoalViewState {
  return { expandedWorkIds: [], mobileLane: null }
}

function normalizeGoalViewState(value: unknown): GoalViewState {
  if (!isRecord(value)) return emptyGoalViewState()
  const expandedWorkIds = Array.isArray(value.expandedWorkIds)
    ? [...new Set(value.expandedWorkIds.filter(isString))]
    : []
  const mobileLane = isGoalViewLane(value.mobileLane) ? value.mobileLane : null
  return { expandedWorkIds, mobileLane }
}

function isGoalViewLane(value: unknown): value is GoalViewLane {
  return value === 'Plan' || value === 'Build' || value === 'Review' || value === 'Done'
}

function normalizeRecentProjects(value: unknown) {
  const candidates = Array.isArray(value) ? value : [value]
  const byProject = new Map<string, RecentProjectPreference>()
  for (const candidate of candidates) {
    if (
      !isRecord(candidate) ||
      !isString(candidate.projectId) ||
      !isTimestamp(candidate.visitedAt)
    ) {
      continue
    }
    const preference = { projectId: candidate.projectId, visitedAt: candidate.visitedAt }
    const current = byProject.get(preference.projectId)
    if (!current || timestamp(preference.visitedAt) > timestamp(current.visitedAt)) {
      byProject.set(preference.projectId, preference)
    }
  }
  return stableOrder([...byProject.values()], (preference) => timestamp(preference.visitedAt))
}

function normalizeRecentGoals(value: unknown, projectId: string) {
  const candidates = Array.isArray(value) ? value : [value]
  const byGoal = new Map<string, RecentGoalPreference>()
  for (const candidate of candidates) {
    if (
      !isRecord(candidate) ||
      candidate.projectId !== projectId ||
      !isString(candidate.goalId) ||
      !isTimestamp(candidate.visitedAt)
    ) {
      continue
    }
    const preference = { projectId, goalId: candidate.goalId, visitedAt: candidate.visitedAt }
    const current = byGoal.get(preference.goalId)
    if (!current || timestamp(preference.visitedAt) > timestamp(current.visitedAt)) {
      byGoal.set(preference.goalId, preference)
    }
  }
  return stableOrder([...byGoal.values()], (preference) => timestamp(preference.visitedAt))
}

function stableOrder<T>(items: readonly T[], score: (item: T) => number) {
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ item }) => item)
}

function timestamp(value: string | null | undefined) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isTimestamp(value: unknown): value is string {
  return isString(value) && timestamp(value) > 0
}

function browserPreferenceStorage(): GoalPreferenceStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}
