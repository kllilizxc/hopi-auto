import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'

export type AssistantConversationScope = { kind: 'home' } | { kind: 'project'; projectId: string }

export const HOME_ASSISTANT_CONVERSATION_SCOPE = { kind: 'home' } as const

export function assistantConversationScopeForEvent(
  event: InboxEventDocument,
): AssistantConversationScope {
  const projectId = event.attributes.context?.projectId
  return projectId ? { kind: 'project', projectId } : HOME_ASSISTANT_CONVERSATION_SCOPE
}

export function assistantConversationScopeKey(scope: AssistantConversationScope) {
  return scope.kind === 'home' ? 'home' : `project:${scope.projectId}`
}

export function assistantEventBelongsToScope(
  event: InboxEventDocument,
  scope: AssistantConversationScope,
) {
  return (
    assistantConversationScopeKey(assistantConversationScopeForEvent(event)) ===
    assistantConversationScopeKey(scope)
  )
}
