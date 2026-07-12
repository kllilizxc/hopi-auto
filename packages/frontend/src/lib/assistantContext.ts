import type { AttentionView } from './apiTypes'
import type { GoalScope } from './goalScope'

export interface AssistantInboxContext extends GoalScope {
  attentionId?: string
}

export function resolveAssistantInboxContext(
  pageScope: GoalScope | null,
  replyAttention: AttentionView | null,
): AssistantInboxContext | undefined {
  if (replyAttention) {
    if (
      replyAttention.scope === 'goal' &&
      replyAttention.projectId &&
      replyAttention.goalId
    ) {
      return {
        projectId: replyAttention.projectId,
        goalId: replyAttention.goalId,
        attentionId: replyAttention.id,
      }
    }
    return undefined
  }
  return pageScope ? { ...pageScope } : undefined
}
