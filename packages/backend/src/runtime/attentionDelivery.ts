import { isInternalInboxSource } from '../domain/assistantWorkspaceDocuments'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'

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
  nextAttemptAt(): number | null
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
    nextAttemptAt() {
      const deadlines = [...retries.values()].map((retry) => retry.nextAt)
      return deadlines.length > 0 ? Math.min(...deadlines) : null
    },
    async deliverOnce() {
      const state = await workspace.readWorkspace()
      const candidate = [...state.events.values()]
        .filter(
          (event) =>
            isInternalInboxSource(event.attributes.source) &&
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
