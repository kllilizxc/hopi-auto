const stableIdPattern = '[A-Za-z0-9][A-Za-z0-9._-]*'
const goalReferencePattern = new RegExp(
  `^project:(${stableIdPattern})/goal:(${stableIdPattern})/attention:(${stableIdPattern})$`,
)
const workspaceReferencePattern = new RegExp(
  `^home:(${stableIdPattern})/attention:(${stableIdPattern})$`,
)

export type AttentionReference =
  | { scope: 'goal'; projectId: string; goalId: string; attentionId: string }
  | { scope: 'workspace'; homeId: string; attentionId: string }

export function goalAttentionReference(projectId: string, goalId: string, attentionId: string) {
  return `project:${projectId}/goal:${goalId}/attention:${attentionId}`
}

export function workspaceAttentionReference(homeId: string, attentionId: string) {
  return `home:${homeId}/attention:${attentionId}`
}

export function parseAttentionReference(reference: string): AttentionReference | null {
  const goal = goalReferencePattern.exec(reference)
  if (goal) {
    const [, projectId, goalId, attentionId] = goal
    if (!projectId || !goalId || !attentionId) return null
    return {
      scope: 'goal',
      projectId,
      goalId,
      attentionId,
    }
  }
  const workspace = workspaceReferencePattern.exec(reference)
  if (workspace) {
    const [, homeId, attentionId] = workspace
    if (!homeId || !attentionId) return null
    return {
      scope: 'workspace',
      homeId,
      attentionId,
    }
  }
  return null
}

export function normalizeInboxAttentionReferences(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: readonly string[]
}) {
  const references = [
    ...(context.attentionId ? [context.attentionId] : []),
    ...(context.attentionRefs ?? []),
  ].map((reference) => {
    if (parseAttentionReference(reference)) return reference
    if (context.projectId && context.goalId) {
      return goalAttentionReference(context.projectId, context.goalId, reference)
    }
    return reference
  })
  return [...new Set(references)]
}
