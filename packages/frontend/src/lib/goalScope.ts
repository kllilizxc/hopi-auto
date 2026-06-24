import type { ProjectRecord } from './api'

export const LEGACY_GOAL_SCOPE_KEY = '__legacy__'

export type GoalSurface = 'board' | 'session' | 'docs'

export interface GoalRouteState {
  projectKey: string | null
  goalKey: string | null
}

export interface GoalScope extends GoalRouteState {
  goalKey: string
}

type GoalQueryKeyPart = string | number | boolean | null | undefined

type GoalScopedEvent = {
  goalKey?: string | null
  projectKey?: string | null
}

export function goalScopedQueryKey(
  key: string,
  goalKey: string | null | undefined,
  projectKey?: string | null,
  ...rest: GoalQueryKeyPart[]
) {
  return [
    key,
    projectKey ?? LEGACY_GOAL_SCOPE_KEY,
    goalKey ?? null,
    ...rest.map((value) => value ?? null),
  ] as const
}

export function buildGoalRoute(scope: GoalRouteState | null, surface: GoalSurface) {
  if (!scope?.goalKey || !scope.projectKey) {
    return '/projects'
  }

  return `/projects/${encodeURIComponent(scope.projectKey)}/${surface}/${encodeURIComponent(scope.goalKey)}`
}

export function readGoalRouteState(pathname: string): GoalRouteState {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length >= 4 && parts[0] === 'projects') {
    const projectKey = decodeURIComponent(parts[1] ?? '')
    const leaf = parts[2]
    if ((leaf === 'board' || leaf === 'session' || leaf === 'docs') && parts[3]) {
      return {
        projectKey,
        goalKey: decodeURIComponent(parts[3]),
      }
    }

    return {
      projectKey,
      goalKey: null,
    }
  }

  return {
    goalKey: null,
    projectKey: null,
  }
}

export function resolveNavigableGoalScope(
  routeState: GoalRouteState,
  rememberedScope: GoalScope | null,
  projects: ProjectRecord[],
) {
  if (routeState.projectKey && routeState.goalKey) {
    return {
      projectKey: routeState.projectKey,
      goalKey: routeState.goalKey,
    } satisfies GoalScope
  }

  if (routeState.projectKey) {
    const project = projects.find((entry) => entry.projectKey === routeState.projectKey)
    if (project?.lastOpenedGoalKey) {
      return {
        projectKey: routeState.projectKey,
        goalKey: project.lastOpenedGoalKey,
      } satisfies GoalScope
    }

    return null
  }

  if (rememberedScope?.projectKey) {
    return rememberedScope
  }

  if (rememberedScope?.goalKey) {
    const rememberedProject = projects.find(
      (entry) => entry.lastOpenedGoalKey === rememberedScope.goalKey,
    )
    if (rememberedProject?.lastOpenedGoalKey) {
      return {
        projectKey: rememberedProject.projectKey,
        goalKey: rememberedProject.lastOpenedGoalKey,
      } satisfies GoalScope
    }
  }

  const fallbackProject = projects.find((entry) => entry.lastOpenedGoalKey)
  if (!fallbackProject?.lastOpenedGoalKey) {
    return null
  }

  return {
    projectKey: fallbackProject.projectKey,
    goalKey: fallbackProject.lastOpenedGoalKey,
  } satisfies GoalScope
}

export function matchesGoalScope(scope: GoalRouteState, event: GoalScopedEvent) {
  if (!scope.goalKey) {
    return false
  }

  return (
    event.goalKey === scope.goalKey &&
    (scope.projectKey ? event.projectKey === scope.projectKey : !event.projectKey)
  )
}

export function readRememberedGoalScope(storageKey: string): GoalScope | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as GoalRouteState
    if (!parsed.goalKey) {
      return null
    }

    return {
      projectKey: parsed.projectKey ?? null,
      goalKey: parsed.goalKey,
    }
  } catch {
    return null
  }
}

export function writeRememberedGoalScope(storageKey: string, scope: GoalScope) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(scope))
}
