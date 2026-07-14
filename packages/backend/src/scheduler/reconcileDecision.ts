import { goalAttentionTarget, workAttentionTarget } from '../domain/attentionTarget'
import { isWorkTerminal } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { type WorkRuntimeFacts, deriveGoalWorkProjections } from '../domain/workProjection'

export type ReconcileDecision =
  | {
      kind: 'dispatch'
      workId: string
      responsibility: 'planner' | 'generator' | 'reviewer'
    }
  | { kind: 'ensure_planning' }
  | { kind: 'ensure_attention'; workId: string; target: string; reason: 'attempts_exhausted' }
  | { kind: 'complete_goal'; attentionId: string }
  | { kind: 'finish_cancellation' }
  | { kind: 'wait'; reasons: string[] }

export interface ReconcileDecisionInput {
  projectId: string
  goalId: string
  goalPackage: GoalPackage
  runtime: WorkRuntimeFacts
  completionStructureValid?: boolean
}

export function decideGoalReconciliation(input: ReconcileDecisionInput): ReconcileDecision {
  const { projectId, goalId, goalPackage, runtime } = input
  const goal = goalPackage.goal.attributes
  if (
    goal.lifecycle === 'cancelled' &&
    ([...goalPackage.works.values()].some((work) => !isWorkTerminal(work.attributes)) ||
      [...goalPackage.attentions.values()].some(
        (attention) => attention.attributes.resolvedAt === null,
      ))
  ) {
    return { kind: 'finish_cancellation' }
  }
  if (goal.lifecycle !== 'active') {
    return { kind: 'wait', reasons: [`goal_${goal.lifecycle}`] }
  }
  if (!runtime.projectEligible) {
    return { kind: 'wait', reasons: ['project_ineligible'] }
  }

  const nonterminal = [...goalPackage.works.values()].filter(
    (work) => !isWorkTerminal(work.attributes),
  )
  const exhausted = nonterminal.find(
    (work) =>
      work.attributes.attempts >= (runtime.maxAttempts ?? 3) &&
      !hasCoveringAttention(projectId, goalId, work.attributes.id, goalPackage),
  )
  if (exhausted) {
    return {
      kind: 'ensure_attention',
      workId: exhausted.attributes.id,
      target: workAttentionTarget(projectId, goalId, exhausted.attributes.id),
      reason: 'attempts_exhausted',
    }
  }

  if (nonterminal.length === 0) {
    const completion = [...goalPackage.attentions.values()].find(
      (attention) =>
        attention.attributes.target === null &&
        attention.attributes.resolvedAt === null &&
        attention.attributes.id !== goal.completionAttentionId,
    )
    if (!completion) return { kind: 'ensure_planning' }
    if (hasAnyOpenTargetedAttention(goalPackage)) {
      return { kind: 'wait', reasons: ['attention'] }
    }
    if (input.completionStructureValid === false) {
      return { kind: 'wait', reasons: ['completion_structure_invalid'] }
    }
    return { kind: 'complete_goal', attentionId: completion.attributes.id }
  }

  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, runtime)
  const ready = projections
    .filter(
      (
        projection,
      ): projection is typeof projection & {
        responsibility: 'planner' | 'generator' | 'reviewer'
      } => projection.ready && projection.responsibility !== null,
    )
    .toSorted((left, right) => {
      const rankDifference =
        dependencyRank(left.workId, goalPackage) - dependencyRank(right.workId, goalPackage)
      return rankDifference || left.workId.localeCompare(right.workId)
    })
  const next = ready[0]
  if (next) {
    return {
      kind: 'dispatch',
      workId: next.workId,
      responsibility: next.responsibility,
    }
  }

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

function hasCoveringAttention(
  projectId: string,
  goalId: string,
  workId: string,
  goalPackage: GoalPackage,
) {
  const goalTarget = goalAttentionTarget(projectId, goalId)
  const workTarget = workAttentionTarget(projectId, goalId, workId)
  return [...goalPackage.attentions.values()].some(
    (attention) =>
      attention.attributes.resolvedAt === null &&
      (attention.attributes.target === goalTarget || attention.attributes.target === workTarget),
  )
}

function hasAnyOpenTargetedAttention(goalPackage: GoalPackage) {
  return [...goalPackage.attentions.values()].some(
    (attention) => attention.attributes.target !== null && attention.attributes.resolvedAt === null,
  )
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
