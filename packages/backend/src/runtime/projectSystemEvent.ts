import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'

export async function recordProjectSystemEvent(
  workspace: AssistantWorkspaceStore,
  input: {
    projectId: string
    summary: string
    details?: readonly string[]
    receivedAt?: Date
  },
) {
  return workspace.receiveSystemEvent({
    eventId: `EV-system-${crypto.randomUUID()}`,
    context: { projectId: input.projectId },
    receivedAt: input.receivedAt,
    content: [
      input.summary.trim(),
      ...(input.details ?? []).map((detail) => detail.trim()).filter(Boolean),
    ].join('\n'),
  })
}
