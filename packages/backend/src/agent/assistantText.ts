export interface AssistantTextParts {
  visibleText?: string
  thoughtText?: string
  malformedThoughtEnvelope: boolean
}

const LEADING_THOUGHT_ENVELOPE = /^\s*<thought\s*>([\s\S]*?)<\/thought\s*>/i
const THOUGHT_MARKER = /<\/?thought\b/i

export function splitAssistantText(value: string | undefined): AssistantTextParts {
  if (!value) return { malformedThoughtEnvelope: false }

  const thoughts: string[] = []
  let visibleText = value
  while (true) {
    const envelope = LEADING_THOUGHT_ENVELOPE.exec(visibleText)
    if (!envelope) break
    const thought = envelope[1]?.trim()
    if (thought) thoughts.push(thought)
    visibleText = visibleText.slice(envelope[0].length)
  }

  if (THOUGHT_MARKER.test(visibleText)) {
    return {
      thoughtText: thoughts.length > 0 ? thoughts.join('\n\n') : undefined,
      malformedThoughtEnvelope: true,
    }
  }

  const visible = visibleText.trim()
  return {
    visibleText: visible || undefined,
    thoughtText: thoughts.length > 0 ? thoughts.join('\n\n') : undefined,
    malformedThoughtEnvelope: false,
  }
}
