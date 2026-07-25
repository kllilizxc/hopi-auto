import { isWorkTerminal, renderWorkDocument } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { hashBytes } from '../publication/publisher'
import type { RunAttemptSummary } from './runAttemptStore'
import { responsibilityFor } from './softwareDeliveryProfile'
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
      if (
        latest.responsibility !== responsibilityFor(work.attributes.kind, work.attributes.stage)
      ) {
        return
      }
      if (!latest.workHash) return
      const [assignmentHash, legacyDocumentHash] = await Promise.all([
        workAssignmentHash(work),
        hashBytes(new TextEncoder().encode(renderWorkDocument(work))),
      ])
      if (assignmentHash === latest.workHash || legacyDocumentHash === latest.workHash) {
        blocked.add(work.attributes.id)
      }
    }),
  )
  return blocked
}

function isSettledFailure(attempt: RunAttemptSummary) {
  if (attempt.status !== 'finished') return false
  if (attempt.application === 'operational_failure' || attempt.application === 'invalid') {
    return true
  }
  return (
    attempt.application === 'published' &&
    (attempt.result === 'fail' || attempt.result === 'attention')
  )
}
