const GOAL_ROUTE_ACTIONS = ['pause', 'resume', 'cancel', 'reopen', 'execution-cost'] as const

export type GoalRouteAction = (typeof GOAL_ROUTE_ACTIONS)[number]
export type GoalView = 'full' | 'board' | 'docs'

export function matchGoalRoute(parts: readonly string[]) {
  if (
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    !parts[2] ||
    !parts[4] ||
    parts.length > 6
  ) {
    return null
  }
  const action = parts[5] ?? null
  if (action !== null && !isGoalRouteAction(action)) return null
  return { projectId: parts[2], goalId: parts[4], action }
}

export function matchWorkDocumentRoute(parts: readonly string[]) {
  if (
    parts.length !== 7 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'works' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6]
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4], workId: parts[6] }
}

export function matchGoalDocumentRoute(parts: readonly string[]) {
  if (
    parts.length !== 6 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'documents' ||
    !parts[2] ||
    !parts[4]
  ) {
    return null
  }
  return { projectId: parts[2], goalId: parts[4] }
}

export function isDesignDocumentPath(designRoot: string, path: string) {
  const prefix = `${designRoot}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return false
  const relative = path.slice(prefix.length)
  return (
    relative.length > 0 &&
    relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

export function readGoalView(view: string | null): GoalView {
  if (view === 'board' || view === 'docs') return view
  return 'full'
}

export function matchPreviewRoute(parts: readonly string[]) {
  if (
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'preview' ||
    !parts[2] ||
    parts.length > 5
  ) {
    return null
  }
  const action = parts[4] ?? null
  if (action !== null && action !== 'start' && action !== 'stop') return null
  return { projectId: parts[2], action }
}

export function matchWorkAttemptRoute(parts: readonly string[]) {
  if (
    parts.length < 8 ||
    parts.length > 10 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'works' ||
    parts[7] !== 'attempts' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6]
  ) {
    return null
  }
  if (parts.length === 10 && parts[9] !== 'events') return null
  if (parts.length === 10 && !parts[8]) return null
  return {
    projectId: parts[2],
    goalId: parts[4],
    workId: parts[6],
    runId: parts[8] ?? null,
    events: parts[9] === 'events',
  }
}

export function matchEvidenceArtifactRoute(parts: readonly string[]) {
  if (
    parts.length !== 9 ||
    parts[0] !== 'api' ||
    parts[1] !== 'projects' ||
    parts[3] !== 'goals' ||
    parts[5] !== 'evidence' ||
    parts[7] !== 'artifacts' ||
    !parts[2] ||
    !parts[4] ||
    !parts[6] ||
    !parts[8] ||
    !/^\d+$/.test(parts[8])
  ) {
    return null
  }
  return {
    projectId: parts[2],
    goalId: parts[4],
    evidenceId: parts[6],
    artifactIndex: Number.parseInt(parts[8], 10),
  }
}

function isGoalRouteAction(value: string): value is GoalRouteAction {
  return GOAL_ROUTE_ACTIONS.some((action) => action === value)
}
