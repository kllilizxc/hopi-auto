import type { AgentTranscriptTransport } from './runtimeEvents'

type AssistantTransport = Exclude<AgentTranscriptTransport, 'process'>

export interface VendorAssistantOutput {
  sessionId?: string
  messageId?: string
  assistantText?: string
  finalText?: string
}

export function parseVendorAssistantOutput(
  transport: AssistantTransport,
  line: string,
): VendorAssistantOutput {
  const parsed = parseJsonObject(line)
  if (!parsed) return {}

  if (transport === 'codex') {
    return {
      sessionId: stringValue(parsed.thread_id) ?? stringValue(parsed.threadId),
    }
  }

  if (transport === 'claude') {
    const eventType = stringValue(parsed.type)
    const message = objectValue(parsed.message)
    const sessionId = stringValue(parsed.session_id) ?? stringValue(parsed.sessionId)
    if (eventType === 'result') {
      return {
        sessionId,
        finalText: stringValue(parsed.result),
      }
    }
    if (eventType !== 'assistant') return { sessionId }

    return {
      sessionId,
      messageId: stringValue(message?.id),
      assistantText: contentText(message?.content),
    }
  }

  const sessionId = stringValue(parsed.sessionID) ?? stringValue(parsed.sessionId)
  if (stringValue(parsed.type) !== 'text') return { sessionId }
  const part = objectValue(parsed.part)
  return {
    sessionId,
    messageId: stringValue(part?.messageID) ?? stringValue(part?.messageId),
    assistantText: stringValue(part?.text),
  }
}

function contentText(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const parts = value.flatMap((entry) => {
    const block = objectValue(entry)
    return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  })
  return parts.length > 0 ? parts.join('\n') : undefined
}

function parseJsonObject(line: string) {
  try {
    return objectValue(JSON.parse(line))
  } catch {
    return undefined
  }
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
