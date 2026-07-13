import type { AttentionView } from './apiTypes'
import { goalAttentionReference, workspaceAttentionReference } from './attentionReference'
import type { GoalScope } from './goalScope'

export interface AssistantInboxContext {
  projectId?: string
  goalId?: string
  attentionRefs?: string[]
}

export function resolveAssistantInboxContext(
  pageScope: GoalScope | null,
  replyAttention: AttentionView | null,
  openAttentions: readonly AttentionView[] = [],
  homeId?: string,
): AssistantInboxContext | undefined {
  if (replyAttention) {
    if (replyAttention.scope === 'goal' && replyAttention.projectId && replyAttention.goalId) {
      return {
        projectId: replyAttention.projectId,
        goalId: replyAttention.goalId,
        attentionRefs: [
          goalAttentionReference(
            replyAttention.projectId,
            replyAttention.goalId,
            replyAttention.id,
          ),
        ],
      }
    }
    return homeId
      ? { attentionRefs: [workspaceAttentionReference(homeId, replyAttention.id)] }
      : undefined
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
