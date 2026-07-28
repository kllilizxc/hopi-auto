import { STABLE_ID_SOURCE } from './stableId'

const goalReferencePattern = new RegExp(
  `^project:(${STABLE_ID_SOURCE})/goal:(${STABLE_ID_SOURCE})/attention:(${STABLE_ID_SOURCE})$`,
  'u',
)
const workspaceReferencePattern = new RegExp(
  `^home:(${STABLE_ID_SOURCE})/attention:(${STABLE_ID_SOURCE})$`,
  'u',
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
  attentionRefs?: readonly string[]
}) {
  return [...new Set(context.attentionRefs ?? [])]
}
