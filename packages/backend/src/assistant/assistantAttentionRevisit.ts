import { createHash } from 'node:crypto'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import { needsYouAttentionIds } from './assistantNeedsYou'

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
  if (input.operatorRequest || workspaceAttentionAwaitsReply(input)) return null
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

function workspaceAttentionAwaitsReply(input: {
  reference: string
  id: string
  operatorRequest?: string | null
  workspace: AssistantWorkspace
}) {
  const requests = [...input.workspace.events.values()]
    .filter(
      (event) =>
        event.attributes.status === 'handled' &&
        event.attributes.visibility === 'public' &&
        event.attributes.reply !== null &&
        event.attributes.context?.attentionRefs?.includes(input.reference) &&
        needsYouAttentionIds(event.attributes.reply).includes(input.id),
    )
    .toSorted((left, right) =>
      (left.attributes.handledAt ?? left.attributes.receivedAt).localeCompare(
        right.attributes.handledAt ?? right.attributes.receivedAt,
      ),
    )
  const latest = requests.at(-1)
  if (!latest) return false
  const requestReference = `home:${input.workspace.homeId}/event:${latest.attributes.id}`
  return ![...input.workspace.events.values()].some(
    (event) =>
      event.attributes.source === 'user' &&
      event.attributes.context?.replyTo === requestReference &&
      event.attributes.context.attentionRefs?.includes(input.reference),
  )
}
