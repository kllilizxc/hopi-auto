import type { AssistantOpenRequest, AttentionView } from './apiTypes'
import { goalAttentionReference, workspaceAttentionReference } from './attentionReference'

export interface AssistantPageScope {
  projectId: string
  goalId?: string
}

export function readAssistantPageScope(pathname: string): AssistantPageScope | null {
  const goal = /^\/projects\/([^/]+)\/(?:board|docs)\/([^/]+)$/.exec(pathname)
  if (goal?.[1] && goal[2]) {
    return { projectId: decodeURIComponent(goal[1]), goalId: decodeURIComponent(goal[2]) }
  }
  const project = /^\/projects\/([^/]+)$/.exec(pathname)
  return project?.[1] ? { projectId: decodeURIComponent(project[1]) } : null
}

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

export function findAttentionRequestEventId(
  requests: readonly AssistantOpenRequest[],
  attention: AttentionView,
  homeId?: string,
) {
  const reference = assistantAttentionReference(attention, homeId)
  if (!reference) return null
  return (
    requests.find((request) =>
      request.attentions.some(
        (candidate) => assistantAttentionReference(candidate, homeId) === reference,
      ),
    )?.eventId ?? null
  )
}

export function resolveAssistantInboxContext(
  pageScope: AssistantPageScope | null,
  replyAttention: AttentionView | AttentionView[] | null,
  homeId?: string,
  replyEventId?: string,
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
    const replyTo = homeId && replyEventId ? `home:${homeId}/event:${replyEventId}` : undefined
    const sharedProjectId =
      first?.projectId &&
      replyAttentions.every((attention) => attention.projectId === first.projectId)
        ? first.projectId
        : undefined
    const sharedGoal =
      first?.scope === 'goal' &&
      sharedProjectId &&
      first.goalId &&
      replyAttentions.every(
        (attention) =>
          attention.scope === 'goal' &&
          attention.projectId === sharedProjectId &&
          attention.goalId === first.goalId,
      )
    if (sharedGoal && first) {
      return {
        projectId: sharedProjectId,
        goalId: first.goalId,
        attentionRefs: references,
        ...(replyTo ? { replyTo } : {}),
      }
    }
    if (sharedProjectId) {
      return {
        projectId: sharedProjectId,
        attentionRefs: references,
        ...(replyTo ? { replyTo } : {}),
      }
    }
    return { attentionRefs: references, ...(replyTo ? { replyTo } : {}) }
  }
  if (!pageScope) return undefined
  return { ...pageScope }
}
