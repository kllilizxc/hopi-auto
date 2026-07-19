import { z } from 'zod'
import { STABLE_ID_SOURCE, stableIdSchema } from './stableId'

export const inboxEventReferenceSchema = z
  .string()
  .regex(new RegExp(`^home:${STABLE_ID_SOURCE}/event:${STABLE_ID_SOURCE}$`, 'u'))

export type InboxEventReference = z.infer<typeof inboxEventReferenceSchema>

export function inboxEventReference(homeId: string, eventId: string): InboxEventReference {
  return inboxEventReferenceSchema.parse(
    `home:${stableIdSchema.parse(homeId)}/event:${stableIdSchema.parse(eventId)}`,
  )
}

export function parseInboxEventReference(value: string) {
  const parsed = inboxEventReferenceSchema.safeParse(value)
  if (!parsed.success) return null
  const match = /^home:(.+)\/event:(.+)$/u.exec(parsed.data)
  return match?.[1] && match[2]
    ? { homeId: match[1], eventId: match[2], reference: parsed.data }
    : null
}
