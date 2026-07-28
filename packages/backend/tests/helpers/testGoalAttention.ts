import { workAttentionTarget } from '../../src/domain/attentionTarget'
import {
  type AttentionDocument,
  renderAttentionDocument,
} from '../../src/domain/canonicalDocuments'
import type { GoalPackageStore } from '../../src/storage/goalPackageStore'

export async function publishTestWorkAttention(
  store: GoalPackageStore,
  goalId: string,
  workId: string,
  ...details: unknown[]
) {
  const body =
    [...details].reverse().find((detail): detail is string => typeof detail === 'string') ??
    'Test condition requires Assistant judgment.'
  const attention: AttentionDocument = {
    attributes: {
      id: `A-${crypto.randomUUID()}`,
      target: workAttentionTarget(store.paths.projectId, goalId, workId),
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      summary: body,
    },
    body: `## Observed condition\n\n${body}\n`,
  }
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.attentionDocument(goalId, attention.attributes.id),
      expectedHash: null,
      content: renderAttentionDocument(attention),
    },
  })
  return attention
}
