import { AssistantToolRequestError } from './assistantToolRequestError'

const CAPABILITY_TTL_MS = 60 * 60 * 1_000

export interface AssistantToolCapabilityRegistry {
  issue(eventId: string): string
  revoke(token: string): void
  requireEventId(token: string): string
}

export function createAssistantToolCapabilityRegistry(
  now: () => number = Date.now,
): AssistantToolCapabilityRegistry {
  const capabilities = new Map<string, { eventId: string; expiresAt: number }>()

  return {
    issue(eventId) {
      const token = crypto.randomUUID()
      capabilities.set(token, {
        eventId,
        expiresAt: now() + CAPABILITY_TTL_MS,
      })
      return token
    },

    revoke(token) {
      capabilities.delete(token)
    },

    requireEventId(token) {
      const capability = capabilities.get(token)
      if (!capability || capability.expiresAt < now()) {
        capabilities.delete(token)
        throw new AssistantToolRequestError('Assistant tool capability is invalid or expired')
      }
      return capability.eventId
    },
  }
}
