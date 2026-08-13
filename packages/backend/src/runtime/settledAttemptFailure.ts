import { isWorkTerminal } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { RunAttemptSummary } from './runAttemptStore'
import { responsibilityFor } from './softwareDelivery'
import { workAssignmentHash } from './workAssignment'

export async function settledFailureWorkIds(
  goalPackage: GoalPackage,
  attemptsByWork: ReadonlyMap<string, readonly RunAttemptSummary[]>,
  requestedWorkIds: ReadonlySet<string> = new Set(),
) {
  const blocked = new Set<string>()
  await Promise.all(
    [...goalPackage.works.values()].map(async (work) => {
      if (isWorkTerminal(work.attributes) || requestedWorkIds.has(work.attributes.id)) return
      const latest = attemptsByWork.get(work.attributes.id)?.[0]
      if (!latest || !isSettledFailure(latest)) return
      if (latest.protocol === 'report') {
        if (!latest.workHash) return
        if ((await workAssignmentHash(work)) === latest.workHash) blocked.add(work.attributes.id)
        return
      }
      if (
        latest.responsibility !== responsibilityFor(work.attributes.kind, work.attributes.stage)
      ) {
        return
      }
      if (!latest.workHash) return
      if ((await workAssignmentHash(work)) === latest.workHash) {
        blocked.add(work.attributes.id)
      }
    }),
  )
  return blocked
}

function isSettledFailure(attempt: RunAttemptSummary) {
  if (attempt.protocol === 'report') {
    return (
      (attempt.status === 'finished' || attempt.status === 'interrupted') &&
      attempt.termination !== 'normal'
    )
  }
  if (attempt.status !== 'finished') return false
  if (attempt.application === 'operational_failure' || attempt.application === 'invalid') {
    return true
  }
  if (attempt.application === 'attention') return true
  return attempt.application === 'published' && attempt.result === 'fail'
}
