const stableIdPattern = String.raw`[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*`
const canonicalPattern = new RegExp(
  `^(?:project:${stableIdPattern}/goal:${stableIdPattern}/attention:${stableIdPattern}|home:${stableIdPattern}/attention:${stableIdPattern})$`,
  'u',
)

export function goalAttentionReference(projectId: string, goalId: string, attentionId: string) {
  return `project:${projectId}/goal:${goalId}/attention:${attentionId}`
}

export function workspaceAttentionReference(homeId: string, attentionId: string) {
  return `home:${homeId}/attention:${attentionId}`
}

export function normalizeAttentionReferences(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: readonly string[]
}) {
  return [
    ...new Set(
      [...(context.attentionId ? [context.attentionId] : []), ...(context.attentionRefs ?? [])].map(
        (reference) =>
          canonicalPattern.test(reference) || !context.projectId || !context.goalId
            ? reference
            : goalAttentionReference(context.projectId, context.goalId, reference),
      ),
    ),
  ]
}
