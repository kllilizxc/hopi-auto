import { parseAttentionDocument, renderAttentionDocument } from '../domain/canonicalDocuments'
import { hashBytes } from '../publication/publisher'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'

export interface AttentionDeliveryMessage {
  key: string
  body: string
  eventId: string
}

export interface AttentionTransport {
  send(message: AttentionDeliveryMessage): Promise<void>
}

export interface AttentionDeliveryWorker {
  deliverOnce(): Promise<number>
}

export function createAssistantReplyDeliveryWorker(
  workspace: AssistantWorkspaceStore,
  transport: AttentionTransport,
  options: AttentionDeliveryOptions = {},
): AttentionDeliveryWorker {
  const now = options.now ?? (() => new Date())
  const retryBaseMs = options.retryBaseMs ?? 1_000
  const retryMaxMs = options.retryMaxMs ?? 60_000
  const retries = new Map<string, { failures: number; nextAt: number }>()

  return {
    async deliverOnce() {
      const state = await workspace.readWorkspace()
      const candidate = [...state.events.values()]
        .filter(
          (event) =>
            event.attributes.source === 'reflection' &&
            event.attributes.visibility === 'public' &&
            event.attributes.status === 'handled' &&
            !event.attributes.webhookDeliveredAt,
        )
        .sort((left, right) =>
          left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
        )[0]
      if (!candidate?.attributes.reply) return 0

      const key = `${state.homeId}/${candidate.attributes.id}`
      const currentTime = now()
      const retry = retries.get(key)
      if (retry && retry.nextAt > currentTime.getTime()) return 0
      try {
        await transport.send({
          key,
          body: candidate.attributes.reply,
          eventId: candidate.attributes.id,
        })
      } catch {
        const failures = (retry?.failures ?? 0) + 1
        retries.set(key, {
          failures,
          nextAt:
            currentTime.getTime() +
            Math.min(retryBaseMs * 2 ** Math.min(failures - 1, 20), retryMaxMs),
        })
        return 0
      }
      retries.delete(key)
      await workspace.markEventWebhookDelivered(candidate.attributes.id, now())
      return 1
    },
  }
}

export interface AttentionDeliveryOptions {
  now?: () => Date
  retryBaseMs?: number
  retryMaxMs?: number
}

export function createWebhookAttentionTransport(
  webhookUrl: string,
  request: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch,
): AttentionTransport {
  const endpoint = new URL(webhookUrl)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    throw new Error('Attention webhook must use http or https')
  }
  return {
    async send(message) {
      const response = await request(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': message.key,
        },
        body: JSON.stringify(message),
      })
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 512)
        throw new Error(
          `Attention webhook returned ${response.status}${detail ? `: ${detail}` : ''}`,
        )
      }
    },
  }
}

export async function acknowledgeGoalAttention(
  store: GoalPackageStore,
  goalId: string,
  attentionId: string,
  acknowledgedAt: Date,
) {
  const goalPackage = await store.readPackage(goalId)
  const current = goalPackage.attentions.get(attentionId)
  if (
    !current ||
    current.attributes.resolvedAt !== null ||
    current.attributes.notifiedAt !== null
  ) {
    return false
  }
  const completion = current.attributes.target === null
  if (
    completion &&
    (goalPackage.goal.attributes.lifecycle !== 'done' ||
      goalPackage.goal.attributes.completionAttentionId !== attentionId)
  ) {
    return false
  }
  const path = store.paths.attentionDocument(goalId, attentionId)
  const source = await Bun.file(store.paths.absolute(path)).text()
  const attention = parseAttentionDocument(source)
  attention.attributes.notifiedAt = acknowledgedAt.toISOString()
  if (completion) {
    attention.attributes.resolvedAt = acknowledgedAt.toISOString()
    attention.body += '\n## Resolution\n\nCompletion update delivered.\n'
  }
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(attention),
    },
    validateTransition(currentPackage) {
      const currentGoal = currentPackage.goal.attributes
      if (
        completion &&
        (currentGoal.lifecycle !== 'done' || currentGoal.completionAttentionId !== attentionId)
      ) {
        throw new Error('Completion Attention is no longer deliverable')
      }
    },
  })
  return true
}
