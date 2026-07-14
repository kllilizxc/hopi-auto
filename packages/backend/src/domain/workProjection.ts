import { responsibilityFor } from '../runtime/softwareDeliveryProfile'
import { goalAttentionTarget, workAttentionTarget } from './attentionTarget'
import { type WorkAttributes, isPlanningWork, isWorkTerminal } from './canonicalDocuments'
import type { GoalPackage } from './goalPackage'

export type KanbanColumn = 'Plan' | 'Build' | 'Review' | 'Done'
export type WorkPrimaryBadge =
  | 'Needs you'
  | 'Waiting for Assistant'
  | 'working'
  | 'scheduled'
  | 'queued'
  | 'waiting'

export type WorkReadinessReason =
  | 'terminal'
  | 'goal_not_active'
  | 'project_ineligible'
  | 'stale_contract_revision'
  | 'planning_guard'
  | 'dependency_incomplete'
  | 'not_before'
  | 'attempts_exhausted'
  | 'attention'
  | 'live_run'
  | 'operational_backoff'
  | 'capacity'
  | 'no_profile_pass'

export interface WorkRuntimeFacts {
  projectEligible: boolean
  liveRunWorkIds: ReadonlySet<string>
  passCapacity: Partial<Record<'planner' | 'generator' | 'reviewer', boolean>>
  operationallyDeferredWorkIds?: ReadonlySet<string>
  now?: Date
  maxAttempts?: number
}

export interface WorkProjection {
  workId: string
  column: KanbanColumn | null
  cancelled: boolean
  ready: boolean
  responsibility: 'planner' | 'generator' | 'reviewer' | null
  primaryBadge: WorkPrimaryBadge | null
  failedPredicates: WorkReadinessReason[]
}

export function deriveGoalWorkProjections(
  projectId: string,
  goalId: string,
  goalPackage: GoalPackage,
  runtime: WorkRuntimeFacts,
) {
  return [...goalPackage.works.values()].map((work) =>
    deriveWorkProjection(projectId, goalId, work.attributes, goalPackage, runtime),
  )
}

export function deriveWorkProjection(
  projectId: string,
  goalId: string,
  work: WorkAttributes,
  goalPackage: GoalPackage,
  runtime: WorkRuntimeFacts,
): WorkProjection {
  const goal = goalPackage.goal.attributes
  const maxAttempts = runtime.maxAttempts ?? 3
  const now = runtime.now ?? new Date()
  const responsibility = responsibilityFor(work.kind, work.stage)
  const failedPredicates: WorkReadinessReason[] = []
  const terminal = isWorkTerminal(work)
  const cancelled = work.stage === 'cancelled'

  if (terminal) failedPredicates.push('terminal')
  if (goal.lifecycle !== 'active') failedPredicates.push('goal_not_active')
  if (!runtime.projectEligible) failedPredicates.push('project_ineligible')
  if (work.contractRevision !== goal.contractRevision) {
    failedPredicates.push('stale_contract_revision')
  }
  if (
    work.kind === 'engineering' &&
    [...goalPackage.works.values()].some(
      (candidate) => isPlanningWork(candidate.attributes) && candidate.attributes.stage === 'plan',
    )
  ) {
    failedPredicates.push('planning_guard')
  }
  if (
    work.kind === 'planning' &&
    work.stage === 'plan' &&
    [...goalPackage.works.values()].some(
      (candidate) =>
        candidate.attributes.kind === 'engineering' &&
        runtime.liveRunWorkIds.has(candidate.attributes.id),
    )
  ) {
    failedPredicates.push('planning_guard')
  }
  if (
    work.dependsOn.some(
      (dependencyId) => goalPackage.works.get(dependencyId)?.attributes.stage !== 'done',
    )
  ) {
    failedPredicates.push('dependency_incomplete')
  }
  const scheduled = work.notBefore !== null && Date.parse(work.notBefore) > now.getTime()
  if (scheduled) failedPredicates.push('not_before')
  if (work.attempts >= maxAttempts) failedPredicates.push('attempts_exhausted')
  const coveringAttention = findCoveringAttention(projectId, goalId, work.id, goalPackage)
  const needsAttention = Boolean(coveringAttention)
  const attentionNotified = Boolean(coveringAttention?.attributes.notifiedAt)
  if (needsAttention) failedPredicates.push('attention')
  const working = runtime.liveRunWorkIds.has(work.id)
  if (working) failedPredicates.push('live_run')
  if (runtime.operationallyDeferredWorkIds?.has(work.id)) {
    failedPredicates.push('operational_backoff')
  }
  if (responsibility && runtime.passCapacity[responsibility] === false) {
    failedPredicates.push('capacity')
  }
  if (!terminal && !responsibility) failedPredicates.push('no_profile_pass')

  const ready = failedPredicates.length === 0
  return {
    workId: work.id,
    column: kanbanColumn(work),
    cancelled,
    ready,
    responsibility,
    primaryBadge: terminal
      ? null
      : needsAttention
        ? attentionNotified
          ? 'Needs you'
          : 'Waiting for Assistant'
        : working
          ? 'working'
          : scheduled
            ? 'scheduled'
            : ready
              ? 'queued'
              : 'waiting',
    failedPredicates,
  }
}

function findCoveringAttention(
  projectId: string,
  goalId: string,
  workId: string,
  goalPackage: GoalPackage,
) {
  const goalTarget = goalAttentionTarget(projectId, goalId)
  const workTarget = workAttentionTarget(projectId, goalId, workId)
  const covering = [...goalPackage.attentions.values()].filter(
    (attention) =>
      attention.attributes.resolvedAt === null &&
      (attention.attributes.target === goalTarget || attention.attributes.target === workTarget),
  )
  return covering.find((attention) => attention.attributes.notifiedAt !== null) ?? covering[0]
}

function kanbanColumn(work: WorkAttributes): KanbanColumn | null {
  if (work.stage === 'cancelled') return null
  if (work.stage === 'done') return 'Done'
  if (work.kind === 'planning') return 'Plan'
  return work.stage === 'generate' ? 'Build' : 'Review'
}
