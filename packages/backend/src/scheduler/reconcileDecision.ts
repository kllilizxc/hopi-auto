import { isWorkTerminal } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { type WorkRuntimeFacts, deriveGoalWorkProjections } from '../domain/workProjection'

export type ReconcileDecision =
  | { kind: 'dispatch'; workId: string }
  | { kind: 'finish_cancellation' }
  | { kind: 'wait'; reasons: string[] }

export interface ReconcileDecisionInput {
  projectId: string
  goalId: string
  goalPackage: GoalPackage
  runtime: WorkRuntimeFacts
}

export function decideGoalReconciliation(input: ReconcileDecisionInput): ReconcileDecision {
  const { projectId, goalId, goalPackage, runtime } = input
  const goal = goalPackage.goal.attributes
  if (
    goal.lifecycle === 'cancelled' &&
    [...goalPackage.works.values()].some((work) => !isWorkTerminal(work.attributes))
  ) {
    return { kind: 'finish_cancellation' }
  }
  if (goal.lifecycle !== 'active') return { kind: 'wait', reasons: [`goal_${goal.lifecycle}`] }
  if (!runtime.projectEligible) return { kind: 'wait', reasons: ['project_ineligible'] }

  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, runtime)
  const next = projections
    .filter(
      (projection) =>
        projection.state === 'queued' &&
        projection.failedPredicates.every((reason) => reason === 'queued_run'),
    )
    .toSorted((left, right) => {
      const rank =
        dependencyRank(left.workId, goalPackage) - dependencyRank(right.workId, goalPackage)
      if (rank) return rank
      const leftWork = goalPackage.works.get(left.workId)
      const rightWork = goalPackage.works.get(right.workId)
      return (
        (leftWork?.attributes.createdAt ?? '').localeCompare(
          rightWork?.attributes.createdAt ?? '',
        ) || left.workId.localeCompare(right.workId)
      )
    })[0]
  if (next) return { kind: 'dispatch', workId: next.workId }

  return {
    kind: 'wait',
    reasons: [
      ...new Set(
        projections
          .filter((projection) => {
            const work = goalPackage.works.get(projection.workId)
            return work ? !isWorkTerminal(work.attributes) : false
          })
          .flatMap((projection) => projection.failedPredicates),
      ),
    ],
  }
}

function dependencyRank(
  workId: string,
  goalPackage: GoalPackage,
  visiting = new Set<string>(),
): number {
  if (visiting.has(workId)) return Number.MAX_SAFE_INTEGER
  const work = goalPackage.works.get(workId)
  if (!work || work.attributes.dependsOn.length === 0) return 0
  const nextVisiting = new Set(visiting).add(workId)
  return (
    1 +
    Math.max(
      ...work.attributes.dependsOn.map((dependencyId) =>
        dependencyRank(dependencyId, goalPackage, nextVisiting),
      ),
    )
  )
}
