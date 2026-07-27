import {
  type AssistantDecisionPrompt,
  assistantDecisionPromptSchema,
} from '../domain/assistantDecisionPrompt'
import { stableIdSchema } from '../domain/stableId'

export type { AssistantDecisionPrompt } from '../domain/assistantDecisionPrompt'

export interface NeedsYouRequest {
  attentionId: string
  decisionPrompt: AssistantDecisionPrompt | null
}

export function needsYouAttentionIds(reply: string) {
  return [...new Set(needsYouRequests(reply).map((request) => request.attentionId))]
}

export function needsYouRequests(reply: string): NeedsYouRequest[] {
  const requests: NeedsYouRequest[] = []
  const pattern = /<NeedsYou\s+attentionId=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/NeedsYou>/giu
  for (const match of reply.matchAll(pattern)) {
    const attentionId = match[1] ?? match[2]
    if (!attentionId || !stableIdSchema.safeParse(attentionId).success) continue
    requests.push({
      attentionId,
      decisionPrompt: parseDecisionPrompt(match[3] ?? ''),
    })
  }
  return requests
}

function parseDecisionPrompt(needsYouBody: string) {
  const matches = [
    ...needsYouBody.matchAll(/<DecisionPrompt>\s*([\s\S]*?)\s*<\/DecisionPrompt>/giu),
  ]
  if (matches.length !== 1) return null

  try {
    const result = assistantDecisionPromptSchema.safeParse(JSON.parse(matches[0]?.[1] ?? ''))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
