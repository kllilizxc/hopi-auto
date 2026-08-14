import { matchGoalAttentionTarget } from './attentionTarget'
import { type WorkAttributes, isWorkTerminal } from './canonicalDocuments'
import type { GoalPackage } from './goalPackage'

export type WorkRouteState =
  | 'done'
  | 'cancelled'
  | 'needs_user'
  | 'running'
  | 'queued'
  | 'scheduled'
  | 'waiting_assistant'
  | 'blocked'
  | 'ready'

export type WorkReadinessReason =
  | 'terminal'
  | 'goal_not_active'
  | 'project_ineligible'
  | 'stale_contract_revision'
  | 'dependency_incomplete'
  | 'dependency_cancelled'
  | 'not_before'
  | 'attention'
  | 'settled_run'
  | 'live_run'
  | 'queued_run'

export interface WorkRuntimeFacts {
  projectEligible: boolean
  runningWorkIds: ReadonlySet<string>
  queuedWorkIds: ReadonlySet<string>
  settledWorkIds: ReadonlySet<string>
  now?: Date
}

export interface WorkProjection {
  workId: string
  state: WorkRouteState
  ready: boolean
  failedPredicates: WorkReadinessReason[]
}

export function deriveGoalWorkProjections(
  projectId: string,
  goalId: string,
  goalPackage: GoalPackage,
  runtime: WorkRuntimeFacts,
) {
  const attentionWorkIds = new Set(
    [...goalPackage.attentions.values()].flatMap((attention) => {
      if (attention.attributes.resolvedAt !== null) return []
      const target = matchGoalAttentionTarget(projectId, goalId, attention.attributes.target)
      return target?.scope === 'work' ? [target.workId] : []
    }),
  )
  return [...goalPackage.works.values()]
    .map((work) => deriveWorkProjection(work.attributes, goalPackage, runtime, attentionWorkIds))
    .toSorted((left, right) => {
      const leftWork = goalPackage.works.get(left.workId)
      const rightWork = goalPackage.works.get(right.workId)
      return (
        (leftWork?.attributes.createdAt ?? '').localeCompare(
          rightWork?.attributes.createdAt ?? '',
        ) || left.workId.localeCompare(right.workId)
      )
    })
}

export function deriveWorkProjection(
  work: WorkAttributes,
  goalPackage: GoalPackage,
  runtime: WorkRuntimeFacts,
  attentionWorkIds: ReadonlySet<string> = new Set(),
): WorkProjection {
  if (work.status === 'done') {
    return { workId: work.id, state: 'done', ready: false, failedPredicates: ['terminal'] }
  }
  if (work.status === 'cancelled') {
    return { workId: work.id, state: 'cancelled', ready: false, failedPredicates: ['terminal'] }
  }

  const goal = goalPackage.goal.attributes
  const now = runtime.now ?? new Date()
  const failedPredicates: WorkReadinessReason[] = []
  if (goal.lifecycle !== 'active') failedPredicates.push('goal_not_active')
  if (!runtime.projectEligible) failedPredicates.push('project_ineligible')
  if (work.contractRevision !== goal.contractRevision) {
    failedPredicates.push('stale_contract_revision')
  }
  for (const dependencyId of work.dependsOn) {
    const dependency = goalPackage.works.get(dependencyId)
    if (dependency?.attributes.status === 'cancelled') {
      if (!failedPredicates.includes('dependency_cancelled')) {
        failedPredicates.push('dependency_cancelled')
      }
    } else if (dependency?.attributes.status !== 'done') {
      if (!failedPredicates.includes('dependency_incomplete')) {
        failedPredicates.push('dependency_incomplete')
      }
    }
  }
  const structurallyBlocked = failedPredicates.length > 0
  const scheduled = work.notBefore !== null && Date.parse(work.notBefore) > now.getTime()
  if (scheduled) failedPredicates.push('not_before')

  const needsUser = attentionWorkIds.has(work.id)
  const running = runtime.runningWorkIds.has(work.id)
  const queued = runtime.queuedWorkIds.has(work.id)
  const waitingAssistant = runtime.settledWorkIds.has(work.id) && !running && !queued
  if (needsUser) failedPredicates.push('attention')
  if (running) failedPredicates.push('live_run')
  if (queued) failedPredicates.push('queued_run')
  if (waitingAssistant) failedPredicates.push('settled_run')

  const state: WorkRouteState = needsUser
    ? 'needs_user'
    : running
      ? 'running'
      : queued
        ? 'queued'
        : structurallyBlocked
          ? 'blocked'
          : scheduled
            ? 'scheduled'
            : waitingAssistant
              ? 'waiting_assistant'
              : 'ready'
  return {
    workId: work.id,
    state,
    ready: state === 'ready',
    failedPredicates,
  }
}

export function isTakeableWork(work: WorkAttributes, projection: WorkProjection) {
  return !isWorkTerminal(work) && projection.state === 'ready'
}
