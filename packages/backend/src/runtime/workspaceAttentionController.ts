import type { WorkspaceAttentionDocument } from '../domain/assistantWorkspaceDocuments'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'

export interface WorkspaceAttentionController {
  ensureProjectAttention(projectId: string, reason: string): Promise<WorkspaceAttentionDocument>
  ensureEventAttention(eventId: string, reason: string): Promise<WorkspaceAttentionDocument>
}

export function createWorkspaceAttentionController(
  workspace: AssistantWorkspaceStore,
  now: () => Date = () => new Date(),
): WorkspaceAttentionController {
  return {
    async ensureProjectAttention(projectId, reason) {
      return ensure(`project:${projectId}`, `project-${projectId}`, reason)
    },
    async ensureEventAttention(eventId, reason) {
      const state = await workspace.readWorkspace()
      return ensure(`home:${state.homeId}/event:${eventId}`, `event-${eventId}`, reason)
    },
  }

  async function ensure(target: string, idPrefix: string, reason: string) {
    const state = await workspace.readWorkspace()
    const existing = [...state.attentions.values()].find(
      (attention) =>
        attention.attributes.target === target && attention.attributes.resolvedAt === null,
    )
    if (existing) return existing
    const attention: WorkspaceAttentionDocument = {
      attributes: {
        id: `A-${idPrefix}-${crypto.randomUUID()}`,
        target,
        createdAt: now().toISOString(),
        resolvedAt: null,
        notifiedAt: null,
      },
      body: [
        '## Needs you',
        '',
        reason.trim(),
        '',
        'HOPI cannot safely continue this target until the condition is verified and cleared.',
        '',
      ].join('\n'),
    }
    await workspace.createAttention(attention)
    return attention
  }
}
