import type {
  AgentRuntimeEvent,
  AgentTranscriptEntryKind,
  AgentTranscriptTransport,
} from './runtimeEvents'

export type ProcessTranscriptFormat =
  | 'plain'
  | 'codex_jsonl'
  | 'claude_stream_json'
  | 'opencode_json'

const NON_FATAL_CODEX_MODEL_REFRESH_TIMEOUT =
  /^(?:\S+\s+)?ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit\s*$/

export function isNonFatalProcessDiagnostic(options: {
  format: ProcessTranscriptFormat
  stream: 'stdout' | 'stderr'
  line: string
}): boolean {
  return (
    options.format === 'codex_jsonl' &&
    options.stream === 'stderr' &&
    NON_FATAL_CODEX_MODEL_REFRESH_TIMEOUT.test(options.line)
  )
}

export function normalizeProcessOutputLine(options: {
  format: ProcessTranscriptFormat
  stream: 'stdout' | 'stderr'
  role: string
  line: string
}): AgentRuntimeEvent[] {
  if (isNonFatalProcessDiagnostic(options)) return []

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

  if (itemType === 'todo_list') {
    return normalizeCodexPlanEvent(eventType, item)
  }

  if (itemType === 'command_execution') {
    return normalizeCodexCommandExecutionEvent(eventType, item)
  }

  if (itemType === 'mcp_tool_call') {
    return normalizeCodexMcpToolCallEvent(eventType, item)
  }

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

  const itemText = extractText(item)
  if (itemText) {
    return [
      transcriptEvent('codex', 'status', itemText, {
        vendorEventType: eventType ?? 'item/completed',
      }),
    ]
  }

  if (shouldIgnoreCodexLifecycleStatus(eventType)) {
    return []
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

function normalizeCodexPlanEvent(
  eventType: string | undefined,
  item: Record<string, unknown> | undefined,
): AgentRuntimeEvent[] {
  const items = (arrayValue(item?.items) ?? []).flatMap((candidate) => {
    const value = objectValue(candidate)
    const text = stringValue(value?.text)
    return text ? [{ text: compactSummary(text), completed: value?.completed === true }] : []
  })
  if (items.length === 0) return []

  return [
    {
      kind: 'plan',
      transport: 'codex',
      planId: stringValue(item?.id) ?? 'codex-todo-list',
      status: normalizeEventType(eventType) === 'item.completed' ? 'completed' : 'active',
      items,
      vendorEventType: eventType,
    },
  ]
}

function normalizeCodexMcpToolCallEvent(
  eventType: string | undefined,
  item: Record<string, unknown> | undefined,
): AgentRuntimeEvent[] {
  const normalizedEventType = normalizeEventType(eventType)
  const toolName = extractToolName(item)
  const invocationKey = stringValue(item?.id) ?? extractToolInvocationKey(item, 'tool_call')

  if (normalizedEventType === 'item.started') {
    return [
      transcriptEvent('codex', 'tool_call', buildToolCallSummary(toolName, item), {
        toolName: toolName ?? undefined,
        toolInvocationKey: invocationKey ?? undefined,
        vendorEventType: eventType ?? 'item.started',
      }),
    ]
  }

  if (normalizedEventType === 'item.completed') {
    const error = extractCodexMcpError(item)
    return [
      transcriptEvent(
        'codex',
        error ? 'error' : 'tool_result',
        error ?? extractText(item?.result) ?? 'Tool completed.',
        {
          toolName: toolName ?? undefined,
          toolInvocationKey: invocationKey ?? undefined,
          vendorEventType: eventType ?? 'item.completed',
        },
      ),
    ]
  }

  return [
    transcriptEvent('codex', 'status', humanizeEventType(eventType ?? 'MCP tool call'), {
      toolName: toolName ?? undefined,
      toolInvocationKey: invocationKey ?? undefined,
      vendorEventType: eventType,
    }),
  ]
}

function normalizeCodexCommandExecutionEvent(
  eventType: string | undefined,
  item: Record<string, unknown> | undefined,
): AgentRuntimeEvent[] {
  const normalizedEventType = normalizeEventType(eventType)
  const commandDetail = stringValue(item?.command) ?? extractCommandDetail(item ?? {})
  const invocationKey = stringValue(item?.id) ?? extractToolInvocationKey(item, 'tool_call')
  const toolName = 'command'

  if (normalizedEventType === 'item.started') {
    return [
      transcriptEvent(
        'codex',
        'tool_call',
        `Tool call: ${toolName}${commandDetail ? ` (${commandDetail})` : ''}`,
        {
          toolName,
          toolInvocationKey: invocationKey ?? undefined,
          vendorEventType: eventType ?? 'item.started',
        },
      ),
    ]
  }

  if (normalizedEventType === 'item.completed') {
    return [
      transcriptEvent(
        'codex',
        'tool_result',
        extractCodexCommandExecutionResult(item, commandDetail),
        {
          toolName,
          toolInvocationKey: invocationKey ?? undefined,
          vendorEventType: eventType ?? 'item.completed',
        },
      ),
    ]
  }

  return [
    transcriptEvent('codex', 'status', humanizeEventType(eventType ?? 'command execution'), {
      vendorEventType: eventType,
    }),
  ]
}

function normalizeClaudeEvent(parsed: unknown): AgentRuntimeEvent[] {
  const value = objectValue(parsed)
  const eventType = stringValue(value?.type)
  const eventSubtype = stringValue(value?.subtype)
  const message = objectValue(value?.message)
  const blocks = arrayValue(message?.content) ?? arrayValue(value?.content) ?? []

  if (eventType === 'assistant') {
    return normalizeContentBlocks('claude', eventType, blocks, 'assistant')
  }

  if (eventType === 'user') {
    return normalizeContentBlocks('claude', eventType, blocks, 'tool_result')
  }

  if (eventType === 'result') {
    const terminalReason = stringValue(value?.terminal_reason)
    const isError = value?.is_error === true || terminalReason?.includes('error') === true
    const summary = isError
      ? (extractText(value) ?? claudeResultSummary(value))
      : (eventSubtype ?? stringValue(value?.stop_reason) ?? extractText(value) ?? 'result received')
    return [
      transcriptEvent('claude', isError ? 'error' : 'status', summary, {
        vendorEventType: `result.${terminalReason ?? eventSubtype ?? 'completed'}`,
      }),
    ]
  }

  if (eventType === 'system') {
    return [
      transcriptEvent('claude', 'status', claudeSystemSummary(value, eventSubtype), {
        vendorEventType: `system.${eventSubtype ?? 'status'}`,
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

function claudeSystemSummary(
  value: Record<string, unknown> | undefined,
  subtype: string | undefined,
) {
  if (subtype === 'init') return 'Claude initialized'
  if (subtype !== 'api_retry') return extractText(value) ?? humanizeEventType(subtype ?? 'system')

  const attempt = numberValue(value?.attempt)
  const maxRetries = numberValue(value?.max_retries)
  const status = numberValue(value?.error_status)
  const error = stringValue(value?.error)
  const progress =
    attempt !== undefined && maxRetries !== undefined
      ? `${attempt}/${maxRetries}`
      : attempt !== undefined
        ? String(attempt)
        : undefined
  const reason = [status !== undefined ? String(status) : undefined, error]
    .filter((detail): detail is string => Boolean(detail))
    .join(' ')
  return ['Provider retry', progress, reason].filter(Boolean).join(' · ')
}

function claudeResultSummary(value: Record<string, unknown> | undefined) {
  const status = numberValue(value?.api_error_status)
  const reason = stringValue(value?.terminal_reason)
  const details = [status !== undefined ? String(status) : undefined, reason]
    .filter((detail): detail is string => Boolean(detail))
    .join(' · ')
  return details ? `Claude invocation failed: ${details}` : 'Claude invocation failed'
}

function normalizeOpencodeEvent(parsed: unknown): AgentRuntimeEvent[] {
  const value = objectValue(parsed)
  const eventType =
    stringValue(value?.type) ?? stringValue(value?.event) ?? stringValue(value?.kind)
  const part = objectValue(value?.part)
  const blocks = arrayValue(value?.content) ?? arrayValue(value?.parts) ?? []

  if (eventType?.includes('error')) {
    return [
      transcriptEvent('opencode', 'error', extractText(value) ?? humanizeEventType(eventType), {
        vendorEventType: eventType,
      }),
    ]
  }

  const opencodeText = stringValue(part?.text)
  if (eventType === 'text' && opencodeText) {
    return [
      transcriptEvent('opencode', 'assistant', opencodeText, {
        vendorEventType: eventType,
      }),
    ]
  }

  if (eventType === 'tool_use' && part?.type === 'tool') {
    const toolName = stringValue(part.tool)
    const state = objectValue(part.state)
    const invocationKey = stringValue(part.id)
    if (state?.status === 'error') {
      return [
        transcriptEvent('opencode', 'error', extractText(state.error) ?? 'Tool failed.', {
          toolName,
          toolInvocationKey: invocationKey,
          vendorEventType: eventType,
        }),
      ]
    }
    return [
      transcriptEvent(
        'opencode',
        'tool_result',
        extractText(state?.output) ?? `${toolName ?? 'Tool'} completed.`,
        {
          toolName,
          toolInvocationKey: invocationKey,
          vendorEventType: eventType,
        },
      ),
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
    stringValue(value?.tool) ??
    stringValue(objectValue(value?.tool)?.name) ??
    stringValue(objectValue(value?.invocation)?.tool_name)
  )
}

function extractCodexMcpError(value: Record<string, unknown> | undefined) {
  const error = value?.error
  return typeof error === 'string' ? stringValue(error) : extractText(error)
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
    stringValue(record.aggregated_output) ??
    extractText(record.content) ??
    extractText(record.message) ??
    extractText(record.result)
  )
}

function humanizeEventType(eventType: string) {
  return compactSummary(eventType.replaceAll(/[./_]+/g, ' '))
}

function normalizeEventType(eventType: string | undefined) {
  return eventType?.trim().toLowerCase().replaceAll('/', '.')
}

function shouldIgnoreCodexLifecycleStatus(eventType: string | undefined) {
  const normalized = normalizeEventType(eventType)
  return normalized === 'item.completed' || normalized === 'item.started'
}

function extractCodexCommandExecutionResult(
  item: Record<string, unknown> | undefined,
  commandDetail: string | undefined,
) {
  const aggregatedOutput = stringValue(item?.aggregated_output)
  if (aggregatedOutput) {
    return aggregatedOutput
  }

  const exitCode = typeof item?.exit_code === 'number' ? item.exit_code : null
  if (exitCode !== null) {
    return exitCode === 0
      ? `Command completed successfully.${commandDetail ? ` (${commandDetail})` : ''}`
      : `Command exited with code ${exitCode}.${commandDetail ? ` (${commandDetail})` : ''}`
  }

  return `Command completed.${commandDetail ? ` (${commandDetail})` : ''}`
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

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
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
