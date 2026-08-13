import type { Responsibility } from '../runtime/roleContextStager'
import { type WorkAttributes, isWorkTerminal } from './canonicalDocuments'
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
  | 'dependency_incomplete'
  | 'not_before'
  | 'settled_run'
  | 'live_run'
  | 'capacity'
  | 'no_queued_run'

export interface WorkRuntimeFacts {
  projectEligible: boolean
  liveRunWorkIds: ReadonlySet<string>
  queuedRunProfiles: ReadonlyMap<string, Responsibility>
  settledRunWorkIds: ReadonlySet<string>
  runCapacity: Record<'planner' | 'generator' | 'reviewer', boolean>
  now?: Date
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
  _projectId: string,
  _goalId: string,
  work: WorkAttributes,
  goalPackage: GoalPackage,
  runtime: WorkRuntimeFacts,
): WorkProjection {
  const goal = goalPackage.goal.attributes
  const now = runtime.now ?? new Date()
  const responsibility = runtime.queuedRunProfiles.get(work.id) ?? null
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
    work.dependsOn.some(
      (dependencyId) => goalPackage.works.get(dependencyId)?.attributes.stage !== 'done',
    )
  ) {
    failedPredicates.push('dependency_incomplete')
  }
  const scheduled = work.notBefore !== null && Date.parse(work.notBefore) > now.getTime()
  if (scheduled) failedPredicates.push('not_before')
  const settledRun = runtime.settledRunWorkIds.has(work.id)
  const working = runtime.liveRunWorkIds.has(work.id)
  if (working) failedPredicates.push('live_run')
  if (responsibility && runtime.runCapacity[responsibility] === false) {
    failedPredicates.push('capacity')
  }
  if (!terminal && !responsibility) failedPredicates.push('no_queued_run')

  const ready = failedPredicates.length === 0
  return {
    workId: work.id,
    column: kanbanColumn(work),
    cancelled,
    ready,
    responsibility,
    primaryBadge: terminal
      ? null
      : working
        ? 'working'
        : scheduled
          ? 'scheduled'
          : ready
            ? 'queued'
            : settledRun
              ? 'Waiting for Assistant'
              : 'waiting',
    failedPredicates,
  }
}

function kanbanColumn(work: WorkAttributes): KanbanColumn | null {
  if (work.stage === 'cancelled') return null
  if (work.stage === 'done') return 'Done'
  if (work.kind === 'planning') return 'Plan'
  return work.stage === 'generate' ? 'Build' : 'Review'
}
