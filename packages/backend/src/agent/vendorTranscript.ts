import type {
  AgentRuntimeEvent,
  AgentTranscriptEntryKind,
  AgentTranscriptTransport,
} from './AgentRunner'

export type ProcessTranscriptFormat =
  | 'plain'
  | 'codex_jsonl'
  | 'claude_stream_json'
  | 'opencode_json'

export function normalizeProcessOutputLine(options: {
  format: ProcessTranscriptFormat
  stream: 'stdout' | 'stderr'
  role: string
  line: string
}): AgentRuntimeEvent[] {
  if (options.format === 'plain') {
    return [
      messageEvent(options.role, options.stream === 'stderr' ? 'error' : 'info', options.line),
    ]
  }

  if (options.stream === 'stderr') {
    return [transcriptEvent(transportForFormat(options.format), 'error', options.line)]
  }

  const parsed = parseJson(options.line)
  if (!parsed) {
    return [transcriptEvent(transportForFormat(options.format), 'status', options.line)]
  }

  switch (options.format) {
    case 'codex_jsonl':
      return normalizeCodexEvent(parsed)
    case 'claude_stream_json':
      return normalizeClaudeEvent(parsed)
    case 'opencode_json':
      return normalizeOpencodeEvent(parsed)
  }
}

function normalizeCodexEvent(parsed: unknown): AgentRuntimeEvent[] {
  const eventType =
    stringValue(objectValue(parsed)?.type) ?? stringValue(objectValue(parsed)?.method)
  const item =
    objectValue(objectValue(parsed)?.item) ??
    objectValue(objectValue(objectValue(parsed)?.params)?.item)
  const itemType = stringValue(item?.type)

  if (itemType === 'agent_message') {
    const text = extractText(item)
    return text
      ? [
          transcriptEvent('codex', 'assistant', text, {
            vendorEventType: eventType ?? 'item/completed',
          }),
        ]
      : []
  }

  if (itemType && isToolCallType(itemType)) {
    const toolName = extractToolName(item)
    return [
      transcriptEvent('codex', 'tool_call', buildToolCallSummary(toolName, item), {
        toolName: toolName ?? undefined,
        toolInvocationKey: extractToolInvocationKey(item, 'tool_call') ?? undefined,
        vendorEventType: eventType ?? 'item/completed',
      }),
    ]
  }

  if (itemType && isToolResultType(itemType)) {
    const text = extractText(item) ?? 'Tool result'
    return [
      transcriptEvent('codex', 'tool_result', text, {
        toolName: extractToolName(item) ?? undefined,
        toolInvocationKey: extractToolInvocationKey(item, 'tool_result') ?? undefined,
        vendorEventType: eventType ?? 'item/completed',
      }),
    ]
  }

  if (eventType) {
    return [
      transcriptEvent('codex', 'status', humanizeEventType(eventType), {
        vendorEventType: eventType,
      }),
    ]
  }

  return [transcriptEvent('codex', 'status', compactSummary(JSON.stringify(parsed)))]
}

function normalizeClaudeEvent(parsed: unknown): AgentRuntimeEvent[] {
  const value = objectValue(parsed)
  const eventType = stringValue(value?.type)
  const message = objectValue(value?.message)
  const blocks = arrayValue(message?.content) ?? arrayValue(value?.content) ?? []

  if (eventType === 'assistant') {
    return normalizeContentBlocks('claude', eventType, blocks, 'assistant')
  }

  if (eventType === 'user') {
    return normalizeContentBlocks('claude', eventType, blocks, 'tool_result')
  }

  if (eventType === 'result') {
    const summary =
      stringValue(value?.subtype) ??
      stringValue(value?.stop_reason) ??
      extractText(value) ??
      'result received'
    return [
      transcriptEvent('claude', summary.includes('error') ? 'error' : 'status', summary, {
        vendorEventType: eventType,
      }),
    ]
  }

  if (eventType) {
    return [
      transcriptEvent('claude', 'status', extractText(value) ?? humanizeEventType(eventType), {
        vendorEventType: eventType,
      }),
    ]
  }

  return [transcriptEvent('claude', 'status', compactSummary(JSON.stringify(parsed)))]
}

function normalizeOpencodeEvent(parsed: unknown): AgentRuntimeEvent[] {
  const value = objectValue(parsed)
  const eventType =
    stringValue(value?.type) ?? stringValue(value?.event) ?? stringValue(value?.kind)
  const blocks = arrayValue(value?.content) ?? arrayValue(value?.parts) ?? []

  if (eventType?.includes('error')) {
    return [
      transcriptEvent('opencode', 'error', extractText(value) ?? humanizeEventType(eventType), {
        vendorEventType: eventType,
      }),
    ]
  }

  if (eventType && (eventType.includes('assistant') || eventType.includes('message'))) {
    const text = extractText(value)
    if (text) {
      return [
        transcriptEvent('opencode', 'assistant', text, {
          vendorEventType: eventType,
        }),
      ]
    }

    const normalizedBlocks = normalizeContentBlocks('opencode', eventType, blocks, 'assistant')
    if (normalizedBlocks.length > 0) {
      return normalizedBlocks
    }
  }

  if (
    eventType &&
    (eventType.includes('tool_use') ||
      eventType.includes('tool_call') ||
      (eventType.includes('tool') && !eventType.includes('result')))
  ) {
    const toolName = extractToolName(value)
    return [
      transcriptEvent('opencode', 'tool_call', buildToolCallSummary(toolName, value), {
        toolName: toolName ?? undefined,
        toolInvocationKey: extractToolInvocationKey(value, 'tool_call') ?? undefined,
        vendorEventType: eventType,
      }),
    ]
  }

  if (eventType && (eventType.includes('tool_result') || eventType.includes('result'))) {
    const text = extractText(value) ?? humanizeEventType(eventType)
    return [
      transcriptEvent('opencode', 'tool_result', text, {
        toolName: extractToolName(value) ?? undefined,
        toolInvocationKey: extractToolInvocationKey(value, 'tool_result') ?? undefined,
        vendorEventType: eventType,
      }),
    ]
  }

  if (blocks.length > 0) {
    const normalizedBlocks = normalizeContentBlocks(
      'opencode',
      eventType ?? 'content',
      blocks,
      'assistant',
    )
    if (normalizedBlocks.length > 0) {
      return normalizedBlocks
    }
  }

  if (eventType) {
    return [
      transcriptEvent('opencode', 'status', extractText(value) ?? humanizeEventType(eventType), {
        vendorEventType: eventType,
      }),
    ]
  }

  return [transcriptEvent('opencode', 'status', compactSummary(JSON.stringify(parsed)))]
}

function normalizeContentBlocks(
  transport: AgentTranscriptTransport,
  vendorEventType: string,
  blocks: unknown[],
  defaultKind: Extract<AgentTranscriptEntryKind, 'assistant' | 'tool_result'>,
) {
  const events: AgentRuntimeEvent[] = []

  for (const block of blocks) {
    const value = objectValue(block)
    const blockType = stringValue(value?.type)
    if (blockType === 'text') {
      const text = extractText(value)
      if (text) {
        events.push(
          transcriptEvent(
            transport,
            defaultKind === 'assistant' ? 'assistant' : 'tool_result',
            text,
            {
              vendorEventType,
            },
          ),
        )
      }
      continue
    }

    if (blockType === 'tool_use') {
      const toolName = extractToolName(value)
      events.push(
        transcriptEvent(transport, 'tool_call', buildToolCallSummary(toolName, value), {
          toolName: toolName ?? undefined,
          toolInvocationKey: extractToolInvocationKey(value, 'tool_call') ?? undefined,
          vendorEventType,
        }),
      )
      continue
    }

    if (blockType === 'tool_result') {
      events.push(
        transcriptEvent(transport, 'tool_result', extractText(value) ?? 'Tool result', {
          toolInvocationKey: extractToolInvocationKey(value, 'tool_result') ?? undefined,
          vendorEventType,
        }),
      )
    }
  }

  return events
}

function transcriptEvent(
  transport: AgentTranscriptTransport,
  entryKind: AgentTranscriptEntryKind,
  summary: string,
  options: {
    toolName?: string
    toolInvocationKey?: string
    vendorEventType?: string
  } = {},
): AgentRuntimeEvent {
  return {
    kind: 'transcript',
    transport,
    entryKind,
    summary: compactSummary(summary),
    toolName: options.toolName,
    toolInvocationKey: options.toolInvocationKey,
    vendorEventType: options.vendorEventType,
  }
}

function messageEvent(role: string, level: 'info' | 'error', content: string): AgentRuntimeEvent {
  return {
    kind: 'message',
    level,
    role,
    content,
  }
}

function transportForFormat(
  format: Exclude<ProcessTranscriptFormat, 'plain'>,
): AgentTranscriptTransport {
  switch (format) {
    case 'codex_jsonl':
      return 'codex'
    case 'claude_stream_json':
      return 'claude'
    case 'opencode_json':
      return 'opencode'
  }
}

function isToolCallType(itemType: string) {
  return (
    itemType.includes('tool_call') || itemType.endsWith('_call') || itemType === 'local_shell_call'
  )
}

function isToolResultType(itemType: string) {
  return (
    itemType.includes('tool_result') ||
    itemType.includes('call_output') ||
    itemType.endsWith('_output')
  )
}

function extractToolName(value: Record<string, unknown> | undefined) {
  return (
    stringValue(value?.tool_name) ??
    stringValue(value?.name) ??
    stringValue(objectValue(value?.tool)?.name) ??
    stringValue(objectValue(value?.invocation)?.tool_name)
  )
}

function extractToolInvocationKey(
  value: Record<string, unknown> | undefined,
  entryKind: 'tool_call' | 'tool_result',
) {
  return (
    stringValue(value?.call_id) ??
    stringValue(value?.callId) ??
    stringValue(value?.tool_call_id) ??
    stringValue(value?.toolCallId) ??
    stringValue(value?.tool_use_id) ??
    stringValue(value?.toolUseId) ??
    stringValue(value?.invocation_id) ??
    stringValue(objectValue(value?.invocation)?.call_id) ??
    stringValue(objectValue(value?.invocation)?.callId) ??
    stringValue(objectValue(value?.invocation)?.id) ??
    (entryKind === 'tool_call' ? stringValue(value?.id) : undefined)
  )
}

function buildToolCallSummary(
  toolName: string | undefined,
  value: Record<string, unknown> | undefined,
) {
  const detail = extractToolCallDetail(value)
  const label = toolName ? `Tool call: ${toolName}` : 'Tool call'
  return detail ? `${label} (${detail})` : label
}

function extractToolCallDetail(value: Record<string, unknown> | undefined) {
  const scopes = [
    value,
    objectValue(value?.input),
    objectValue(value?.arguments),
    objectValue(value?.params),
    objectValue(value?.invocation),
  ].filter((scope): scope is Record<string, unknown> => Boolean(scope))

  for (const scope of scopes) {
    const command = extractCommandDetail(scope)
    if (command) {
      return command
    }
  }

  for (const scope of scopes) {
    const path = extractPathDetail(scope)
    if (path) {
      return path
    }
  }

  for (const scope of scopes) {
    const search = extractSearchDetail(scope)
    if (search) {
      return search
    }
  }

  for (const scope of scopes) {
    const scalar = extractSingleScalarDetail(scope)
    if (scalar) {
      return scalar
    }
  }

  return undefined
}

function extractCommandDetail(value: Record<string, unknown>) {
  return (
    stringValue(value.command) ??
    stringValue(value.cmd) ??
    joinStringArray(value.argv) ??
    joinStringArray(value.args)
  )
}

function extractPathDetail(value: Record<string, unknown>) {
  return (
    stringValue(value.file_path) ??
    stringValue(value.filePath) ??
    stringValue(value.path) ??
    stringValue(value.file) ??
    stringValue(value.filename) ??
    stringValue(value.target_file) ??
    stringValue(value.targetFile)
  )
}

function extractSearchDetail(value: Record<string, unknown>) {
  const pattern =
    stringValue(value.pattern) ??
    stringValue(value.query) ??
    stringValue(value.search) ??
    stringValue(value.regex)
  const path = extractPathDetail(value)

  if (pattern && path) {
    return `${path}; pattern=${pattern}`
  }

  return pattern
}

function extractSingleScalarDetail(value: Record<string, unknown>) {
  const supportedEntries = Object.entries(value).filter(
    ([, entry]) => typeof entry === 'string' || Array.isArray(entry),
  )
  if (supportedEntries.length !== 1) {
    return undefined
  }

  const firstEntry = supportedEntries[0]
  if (!firstEntry) {
    return undefined
  }

  const [key, entry] = firstEntry
  const normalized =
    typeof entry === 'string' ? entry : Array.isArray(entry) ? joinStringArray(entry) : undefined
  return normalized ? `${key}=${normalized}` : undefined
}

function extractText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return compactSummary(value)
  }

  if (Array.isArray(value)) {
    const parts = value.map(extractText).filter((part): part is string => Boolean(part))
    return parts.length > 0 ? compactSummary(parts.join('\n')) : undefined
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  return (
    stringValue(record.text) ??
    stringValue(record.content) ??
    stringValue(record.message) ??
    extractText(record.content) ??
    extractText(record.message) ??
    extractText(record.result)
  )
}

function humanizeEventType(eventType: string) {
  return compactSummary(eventType.replaceAll(/[./_]+/g, ' '))
}

function compactSummary(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 400)
}

function parseJson(line: string) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function joinStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  )
  return items.length > 0 ? items.join(' ') : undefined
}
