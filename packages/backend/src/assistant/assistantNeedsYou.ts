import { stableIdSchema } from '../domain/stableId'

export function needsYouAttentionIds(reply: string) {
  const ids = new Set<string>()
  const pattern = /<NeedsYou\s+attentionId=(?:"([^"]+)"|'([^']+)')\s*>[\s\S]*?<\/NeedsYou>/giu
  for (const match of reply.matchAll(pattern)) {
    const attentionId = match[1] ?? match[2]
    if (attentionId && stableIdSchema.safeParse(attentionId).success) ids.add(attentionId)
  }
  return [...ids]
}
