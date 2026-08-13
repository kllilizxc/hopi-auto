import { splitAssistantText } from './assistantText'
import type { AssistantTransport } from './vendorAdapter'

export type { AssistantTransport, VendorSession } from './vendorAdapter'

export interface VendorAssistantTerminalError {
  message: string
  status?: number
  terminalReason?: string
  sessionInvalid: boolean
}

export interface VendorAssistantOutput {
  sessionId?: string
  messageId?: string
  assistantText?: string
  finalText?: string
  terminalError?: VendorAssistantTerminalError
}

export function parseVendorAssistantOutput(
  transport: AssistantTransport,
  line: string,
): VendorAssistantOutput {
  const parsed = parseJsonObject(line)
  if (!parsed) return {}

  if (transport === 'codex') {
    const eventType = stringValue(parsed.type)
    const failure = errorText(parsed.error) ?? stringValue(parsed.message)
    const sessionId = stringValue(parsed.thread_id) ?? stringValue(parsed.threadId)
    return {
      ...(sessionId ? { sessionId } : {}),
      ...(eventType === 'turn.failed' && failure
        ? {
            terminalError: {
              message: failure,
              sessionInvalid: false,
            },
          }
        : {}),
    }
  }

  if (transport === 'claude') {
    const eventType = stringValue(parsed.type)
    const message = objectValue(parsed.message)
    const sessionId = stringValue(parsed.session_id) ?? stringValue(parsed.sessionId)
    if (eventType === 'result') {
      const terminalReason = stringValue(parsed.terminal_reason)
      const result = stringValue(parsed.result)
      const error = errorText(parsed.error) ?? errorListText(parsed.errors)
      const status = numberValue(parsed.api_error_status)
      if (parsed.is_error === true) {
        const failure = result ?? error ?? claudeFailureSummary(status, terminalReason)
        return {
          sessionId,
          terminalError: {
            message: failure,
            status,
            terminalReason,
            sessionInvalid: parsed.subtype === 'error_during_execution',
          },
        }
      }
      const text = splitAssistantText(result)
      if (text.malformedThoughtEnvelope) {
        return {
          sessionId,
          terminalError: {
            message:
              'Claude returned a malformed thought envelope instead of a separable final reply.',
            sessionInvalid: false,
          },
        }
      }
      return {
        sessionId,
        finalText: text.visibleText,
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
  const eventType = stringValue(parsed.type)
  if (eventType?.includes('error')) {
    const failure = errorText(parsed.error) ?? errorText(parsed) ?? 'OpenCode invocation failed.'
    return {
      sessionId,
      terminalError: {
        message: failure,
        sessionInvalid: false,
      },
    }
  }
  if (eventType !== 'text') return { sessionId }
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
    if (block?.type !== 'text' || typeof block.text !== 'string') return []
    const text = splitAssistantText(block.text)
    return text.malformedThoughtEnvelope || !text.visibleText ? [] : [text.visibleText]
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

function errorText(value: unknown): string | undefined {
  if (typeof value === 'string') return stringValue(value)
  const record = objectValue(value)
  if (!record) return undefined
  return stringValue(record?.message) ?? errorText(record?.error) ?? errorText(record?.data)
}

function errorListText(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const errors = value.flatMap((entry) => {
    const detail = errorText(entry)
    return detail ? [detail] : []
  })
  return errors.length > 0 ? errors.join('\n') : undefined
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function claudeFailureSummary(status: number | undefined, terminalReason: string | undefined) {
  const details = [status ? String(status) : undefined, terminalReason]
    .filter((detail): detail is string => Boolean(detail))
    .join(' · ')
  return details ? `Claude invocation failed: ${details}` : 'Claude invocation failed'
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
