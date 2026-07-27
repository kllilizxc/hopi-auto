import { createHash } from 'node:crypto'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'

export function attentionRevisitEventId(reference: string, revisitAt: string) {
  const digest = createHash('sha256')
    .update(`${reference}\u0000${revisitAt}`)
    .digest('hex')
    .slice(0, 24)
  return `EV-revisit-${digest}`
}

export function attentionRevisitTimestamp(input: {
  reference: string
  id: string
  projectId: string | null
  resolvedAt: string | null
  operatorRequest?: string | null
  revisitAt?: string | null
  workspace: AssistantWorkspace
}) {
  if (input.resolvedAt !== null || !input.revisitAt) return null
  if (input.operatorRequest) return null
  if (input.workspace.events.has(attentionRevisitEventId(input.reference, input.revisitAt))) {
    return null
  }
  const timestamp = Date.parse(input.revisitAt)
  if (Number.isNaN(timestamp)) return null
  const coveredByLaterTurn = [...input.workspace.events.values()].some(
    (event) =>
      Date.parse(event.attributes.receivedAt) >= timestamp &&
      (event.attributes.context?.projectId ?? null) === input.projectId,
  )
  return coveredByLaterTurn ? null : timestamp
}
