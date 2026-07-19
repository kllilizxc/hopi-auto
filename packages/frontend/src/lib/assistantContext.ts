import type { AssistantFeedEntry, AttentionView } from './apiTypes'
import {
  goalAttentionReference,
  normalizeAttentionReferences,
  workspaceAttentionReference,
} from './attentionReference'
import type { GoalScope } from './goalScope'

export interface AssistantInboxContext {
  projectId?: string
  goalId?: string
  attentionRefs?: string[]
  replyTo?: string
}

export function assistantAttentionReference(attention: AttentionView, homeId?: string) {
  if (attention.scope === 'goal') {
    return attention.projectId && attention.goalId
      ? goalAttentionReference(attention.projectId, attention.goalId, attention.id)
      : null
  }
  return homeId ? workspaceAttentionReference(homeId, attention.id) : null
}

export function findAttentionNotificationEventId(
  entries: readonly AssistantFeedEntry[],
  attention: AttentionView,
  homeId?: string,
) {
  const reference = assistantAttentionReference(attention, homeId)
  const requestEventId = attention.operatorRequest?.split('/event:')[1]
  if (!reference || !requestEventId) return null

  return entries.some(
    (candidate) =>
      candidate.kind === 'event' &&
      candidate.event.id === requestEventId &&
      candidate.event.context &&
      normalizeAttentionReferences(candidate.event.context).includes(reference),
  )
    ? requestEventId
    : null
}

export function isNeedsYouAttention(attention: AttentionView) {
  return attention.resolvedAt === null && !!attention.operatorRequest
}

export function groupNeedsYouAttentions(
  entries: readonly AssistantFeedEntry[],
  attentions: readonly AttentionView[],
  homeId?: string,
) {
  const groups = new Map<string, AttentionView[]>()
  for (const attention of attentions) {
    if (!isNeedsYouAttention(attention)) continue
    const eventId = findAttentionNotificationEventId(entries, attention, homeId)
    if (!eventId) continue
    const groupId = `inbox:${eventId}`
    const group = groups.get(groupId)
    if (group) group.push(attention)
    else groups.set(groupId, [attention])
  }
  return groups
}

export function resolveAssistantInboxContext(
  pageScope: GoalScope | null,
  replyAttention: AttentionView | AttentionView[] | null,
  openAttentions: readonly AttentionView[] = [],
  homeId?: string,
): AssistantInboxContext | undefined {
  const replyAttentions = Array.isArray(replyAttention)
    ? replyAttention
    : replyAttention
      ? [replyAttention]
      : []
  if (replyAttentions.length > 0) {
    const references = [
      ...new Set(
        replyAttentions.flatMap((attention) => {
          const reference = assistantAttentionReference(attention, homeId)
          return reference ? [reference] : []
        }),
      ),
    ]
    if (references.length === 0) return undefined
    const first = replyAttentions[0]
    const replyTo =
      first?.operatorRequest &&
      replyAttentions.every((attention) => attention.operatorRequest === first.operatorRequest)
        ? first.operatorRequest
        : undefined
    const sharedGoal =
      first?.scope === 'goal' &&
      first.projectId &&
      first.goalId &&
      replyAttentions.every(
        (attention) =>
          attention.scope === 'goal' &&
          attention.projectId === first.projectId &&
          attention.goalId === first.goalId,
      )
    if (sharedGoal && first) {
      return {
        projectId: first.projectId,
        goalId: first.goalId,
        attentionRefs: references,
        ...(replyTo ? { replyTo } : {}),
      }
    }
    return { attentionRefs: references, ...(replyTo ? { replyTo } : {}) }
  }
  if (!pageScope) return undefined
  const attentionRefs = openAttentions
    .filter(
      (attention) =>
        attention.scope === 'goal' &&
        attention.resolvedAt === null &&
        attention.projectId === pageScope.projectId &&
        attention.goalId === pageScope.goalId,
    )
    .map((attention) => goalAttentionReference(pageScope.projectId, pageScope.goalId, attention.id))
  return {
    ...pageScope,
    ...(attentionRefs.length ? { attentionRefs } : {}),
  }
}
