import type { AttentionView } from './apiTypes'
import type { GoalScope } from './goalScope'

export interface AssistantInboxContext extends GoalScope {
  attentionId?: string
  attentionRefs?: string[]
}

export function resolveAssistantInboxContext(
  pageScope: GoalScope | null,
  replyAttention: AttentionView | null,
  openAttentions: readonly AttentionView[] = [],
): AssistantInboxContext | undefined {
  if (replyAttention) {
    if (replyAttention.scope === 'goal' && replyAttention.projectId && replyAttention.goalId) {
      return {
        projectId: replyAttention.projectId,
        goalId: replyAttention.goalId,
        attentionId: replyAttention.id,
      }
    }
    return undefined
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
    .map((attention) => attention.id)
  return {
    ...pageScope,
    ...(attentionRefs.length ? { attentionRefs } : {}),
  }
}
