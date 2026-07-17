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
  if (!reference) return null

  const entry = entries.findLast(
    (candidate) =>
      candidate.kind === 'event' &&
      candidate.event.source === 'reflection' &&
      candidate.event.visibility === 'public' &&
      candidate.event.status === 'handled' &&
      Boolean(candidate.event.reply?.trim()) &&
      Boolean(
        candidate.event.context &&
          normalizeAttentionReferences(candidate.event.context).includes(reference),
      ),
  )
  return entry?.kind === 'event' ? entry.event.id : null
}

export function isNeedsYouAttention(attention: AttentionView) {
  return (
    attention.target !== null && attention.resolvedAt === null && attention.notifiedAt !== null
  )
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
    groups.set(groupId, [...(groups.get(groupId) ?? []), attention])
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
      }
    }
    return { attentionRefs: references }
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
