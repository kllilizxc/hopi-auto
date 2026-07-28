export function goalAttentionReference(projectId: string, goalId: string, attentionId: string) {
  return `project:${projectId}/goal:${goalId}/attention:${attentionId}`
}

export function workspaceAttentionReference(homeId: string, attentionId: string) {
  return `home:${homeId}/attention:${attentionId}`
}

export function normalizeAttentionReferences(context: {
  attentionRefs?: readonly string[]
}) {
  return [...new Set(context.attentionRefs ?? [])]
}
