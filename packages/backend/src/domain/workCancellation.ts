import { isEngineeringWork, isWorkTerminal } from './canonicalDocuments'
import type { GoalPackage } from './goalPackage'

export class WorkCancellationError extends Error {}

export function workCancellationClosure(
  goalPackage: GoalPackage,
  requestedWorkIds: Iterable<string>,
) {
  const closure = new Set<string>()
  for (const workId of requestedWorkIds) {
    const work = goalPackage.works.get(workId)
    if (!work || !isEngineeringWork(work.attributes)) {
      throw new WorkCancellationError(`Cannot cancel missing or non-Engineering Work: ${workId}`)
    }
    if (work.attributes.stage === 'done') {
      throw new WorkCancellationError(`Cannot cancel completed Work: ${workId}`)
    }
    closure.add(workId)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const work of goalPackage.works.values()) {
      if (
        isEngineeringWork(work.attributes) &&
        !isWorkTerminal(work.attributes) &&
        !closure.has(work.attributes.id) &&
        work.attributes.dependsOn.some((dependencyId) => closure.has(dependencyId))
      ) {
        closure.add(work.attributes.id)
        changed = true
      }
    }
  }
  return closure
}

export function workCancellationOrder(
  goalPackage: GoalPackage,
  requestedWorkIds: Iterable<string>,
) {
  const remaining = workCancellationClosure(goalPackage, requestedWorkIds)
  for (const workId of [...remaining]) {
    const work = goalPackage.works.get(workId)
    if (!work || isWorkTerminal(work.attributes)) remaining.delete(workId)
  }

  const ordered: string[] = []
  while (remaining.size > 0) {
    const candidateId = [...remaining].find(
      (workId) =>
        ![...remaining].some((dependentId) =>
          goalPackage.works.get(dependentId)?.attributes.dependsOn.includes(workId),
        ),
    )
    if (!candidateId) throw new WorkCancellationError('Cannot cancel a cyclic Work graph')
    ordered.push(candidateId)
    remaining.delete(candidateId)
  }
  return ordered
}
