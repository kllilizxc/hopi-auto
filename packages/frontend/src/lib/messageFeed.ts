import type { AssistantFeedEntry, AttentionView, InboxEventView, RunAttemptEvent } from './apiTypes'
import { goalAttentionReference, normalizeAttentionReferences } from './attentionReference'

export interface MessageFeedAttachment {
  reference: string
  fileName: string
  url: string
}

export type MessageFeedItemKind =
  | 'user_message'
  | 'assistant_message'
  | 'system_message'
  | 'system_update'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'error'
  | 'action_required'

export interface MessageFeedItem {
  id: string
  createdAt: string
  kind: MessageFeedItemKind
  role: 'user' | 'assistant' | 'system'
  text: string
  label?: string
  details?: string[]
  groupId?: string
  toolName?: string
  toolInvocationKey?: string
  transport?: 'process' | 'codex' | 'claude' | 'opencode'
  vendorEventType?: string
  pending?: boolean
  attachments?: MessageFeedAttachment[]
}

export type MessageFeedActivityEntry =
  | {
      type: 'tool_block'
      id: string
      createdAt: string
      call?: MessageFeedItem
      result?: MessageFeedItem
      groupId?: string
    }
  | {
      type: 'activity_message'
      id: string
      createdAt: string
      item: MessageFeedItem
      groupId?: string
    }

export type MessageFeedDisplayRow =
  | {
      type: 'message'
      id: string
      item: MessageFeedItem
    }
  | {
      type: 'action_required'
      id: string
      item: MessageFeedItem
    }
  | {
      type: 'system_update'
      id: string
      item: MessageFeedItem
    }
  | {
      type: 'activity_group'
      id: string
      createdAt: string
      latestCreatedAt: string
      entries: MessageFeedActivityEntry[]
      groupId?: string
    }

type NormalizedFeedRow =
  | Extract<MessageFeedDisplayRow, { type: 'message' }>
  | Extract<MessageFeedDisplayRow, { type: 'action_required' }>
  | Extract<MessageFeedDisplayRow, { type: 'system_update' }>
  | MessageFeedActivityEntry

interface RunEventFeedOptions {
  namespace: string
  groupId?: string
  active?: boolean
}

interface InboxEventFeedOptions {
  assistantPresentation?: boolean
}

export function runEventsToMessageFeed(
  events: RunAttemptEvent[],
  options: RunEventFeedOptions,
): MessageFeedItem[] {
  return events.map((event) => {
    const common = {
      id: `${options.namespace}:${event.eventId}`,
      createdAt: event.createdAt,
      groupId: options.groupId,
    }

    if (event.kind === 'message') {
      const isUser = event.role.toLowerCase() === 'user'
      return {
        ...common,
        kind: isUser ? 'user_message' : event.level === 'error' ? 'error' : 'assistant_message',
        role: isUser ? 'user' : 'assistant',
        text: event.content,
        label: event.role,
      }
    }

    const details = [event.transport, event.vendorEventType].filter((detail): detail is string =>
      Boolean(detail),
    )

    if (event.entryKind === 'assistant') {
      return {
        ...common,
        kind: 'assistant_message',
        role: 'assistant',
        text: event.summary,
        label: 'Assistant',
        details,
        transport: event.transport,
        vendorEventType: event.vendorEventType,
      }
    }

    if (event.entryKind === 'tool_call' || event.entryKind === 'tool_result') {
      return {
        ...common,
        kind: event.entryKind,
        role: 'system',
        text: event.summary,
        label: event.entryKind === 'tool_call' ? 'Tool call' : 'Tool result',
        details,
        toolName: event.toolName,
        toolInvocationKey: event.toolInvocationKey,
        transport: event.transport,
        vendorEventType: event.vendorEventType,
        pending: event.entryKind === 'tool_call' && options.active === true,
      }
    }

    return {
      ...common,
      kind: event.entryKind === 'error' ? 'error' : 'status',
      role: 'system',
      text: event.summary,
      label: event.entryKind === 'error' ? 'Error' : 'Status',
      details,
      toolName: event.toolName,
      toolInvocationKey: event.toolInvocationKey,
      transport: event.transport,
      vendorEventType: event.vendorEventType,
    }
  })
}

export function inboxEventsToMessageFeed(events: InboxEventView[]): MessageFeedItem[] {
  return [...events]
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
    .flatMap((event) => inboxEventToMessageFeed(event))
}

export function assistantEventsToMessageFeed(
  events: InboxEventView[],
  attentions: AttentionView[],
): MessageFeedItem[] {
  const completions = attentions
    .filter((attention) => attention.target === null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const completionByReference = new Map(
    completions.flatMap((attention) => {
      const reference = completionReference(attention)
      return reference ? [[reference, attention] as const] : []
    }),
  )
  const linkedCompletionReferences = new Set<string>()
  const items = [...events]
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
    .flatMap((event) => {
      const eventItems = inboxEventToMessageFeed(event, { assistantPresentation: true })
      if (event.source !== 'reflection' || event.status !== 'handled') return eventItems
      const reference = event.context
        ? normalizeAttentionReferences(event.context).find((candidate) =>
            completionByReference.has(candidate) && !linkedCompletionReferences.has(candidate),
          )
        : undefined
      if (!reference) return eventItems
      const completion = completionByReference.get(reference)
      if (!completion) return eventItems

      linkedCompletionReferences.add(reference)
      const assistantIndex = eventItems.findLastIndex((item) => item.kind === 'assistant_message')
      if (assistantIndex >= 0) {
        const assistant = eventItems[assistantIndex]
        if (assistant) {
          eventItems[assistantIndex] = {
            ...assistant,
            kind: 'system_update',
            role: 'system',
            label: 'Completed',
          }
        }
      } else {
        eventItems.push(completionAttentionItem(completion))
      }
      return eventItems
    })

  for (const completion of completions) {
    const reference = completionReference(completion)
    if (!reference || !linkedCompletionReferences.has(reference)) {
      items.push(completionAttentionItem(completion))
    }
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestamp = left.item.createdAt.localeCompare(right.item.createdAt)
      return timestamp === 0 ? left.index - right.index : timestamp
    })
    .map(({ item }) => item)
}

function completionReference(attention: AttentionView) {
  return attention.scope === 'goal' && attention.projectId && attention.goalId
    ? goalAttentionReference(attention.projectId, attention.goalId, attention.id)
    : null
}

export function assistantFeedEntriesToMessageFeed(
  entries: AssistantFeedEntry[],
): MessageFeedItem[] {
  return entries
    .flatMap((entry) => {
      if (entry.kind === 'completion') return [completionAttentionItem(entry.attention)]
      const items = inboxEventToMessageFeed(entry.event, { assistantPresentation: true })
      return entry.completion ? applyCompletion(items, entry.completion) : items
    })
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const timestamp = left.item.createdAt.localeCompare(right.item.createdAt)
      return timestamp === 0 ? left.index - right.index : timestamp
    })
    .map(({ item }) => item)
}

function inboxEventToMessageFeed(
  event: InboxEventView,
  options: InboxEventFeedOptions = {},
): MessageFeedItem[] {
  const groupId = `inbox:${event.id}`
  const items: MessageFeedItem[] = []

  if (event.source === 'user') {
    items.push({
      id: `${groupId}:user`,
      createdAt: event.receivedAt,
      kind: 'user_message',
      role: 'user',
      text: event.body,
      label: 'You',
      attachments: event.attachments.map(({ reference, fileName, url }) => ({
        reference,
        fileName,
        url,
      })),
      groupId,
    })
  }

  const runtimeItems = runEventsToMessageFeed(event.runtimeEvents, {
    namespace: groupId,
    groupId,
    active: event.runtimeStatus === 'running',
  })
  items.push(
    ...(options.assistantPresentation
      ? presentAssistantRuntimeItems(runtimeItems, event.runtimeStatus)
      : runtimeItems),
  )

  if (event.runtimeError && !items.some((item) => sameText(item.text, event.runtimeError!))) {
    items.push({
      id: `${groupId}:runtime-error`,
      createdAt: lastTimestamp(items, event.receivedAt),
      kind: 'error',
      role: 'system',
      text: event.runtimeError,
      label: 'Assistant error',
      groupId,
    })
  }

  const reply = event.reply?.trim()
  if (reply) {
    const matchingReply = items.findLast(
      (item) => item.kind === 'assistant_message' && sameText(item.text, reply),
    )
    if (!matchingReply) {
      items.push({
        id: `${groupId}:assistant`,
        createdAt: lastTimestamp(items, event.receivedAt),
        kind: 'assistant_message',
        role: 'assistant',
        text: reply,
        label: 'Assistant',
        groupId,
      })
    }
    return items
  }

  const pending = event.runtimeStatus === 'queued' || event.runtimeStatus === 'running'
  const statusText = assistantRuntimeStatus(event.runtimeStatus)
  items.push({
    id: `${groupId}:runtime-status`,
    createdAt: lastTimestamp(items, event.receivedAt),
    kind: event.runtimeStatus === 'failed' ? 'error' : 'status',
    role: 'system',
    text: statusText,
    label: 'Assistant',
    groupId,
    pending,
  })

  return items
}

export function buildMessageFeedRows(items: MessageFeedItem[]): MessageFeedDisplayRow[] {
  const normalized = buildNormalizedRows(items)
  const rows: MessageFeedDisplayRow[] = []
  let activeGroup: Extract<MessageFeedDisplayRow, { type: 'activity_group' }> | null = null

  const flushGroup = (boundaryId = 'tail') => {
    if (activeGroup) {
      rows.push({
        ...activeGroup,
        id: `activity-group:${activeGroup.groupId ?? 'ungrouped'}:${boundaryId}`,
      })
      activeGroup = null
    }
  }

  for (const entry of normalized) {
    if (
      entry.type === 'message' ||
      entry.type === 'action_required' ||
      entry.type === 'system_update'
    ) {
      flushGroup(entry.id)
      rows.push(entry)
      continue
    }

    if (!activeGroup || activeGroup.groupId !== entry.groupId) {
      flushGroup(`scope:${entry.groupId ?? entry.id}`)
      activeGroup = {
        type: 'activity_group',
        id: `activity-group:${entry.id}`,
        createdAt: entry.createdAt,
        latestCreatedAt: entry.createdAt,
        entries: [entry],
        groupId: entry.groupId,
      }
      continue
    }

    activeGroup.entries.push(entry)
    activeGroup.latestCreatedAt = entry.createdAt
  }

  flushGroup()
  return rows
}

export function summarizeActivityGroup(entries: MessageFeedActivityEntry[]) {
  const pendingStatus = entries.find(
    (entry) => entry.type === 'activity_message' && entry.item.pending,
  )
  if (pendingStatus?.type === 'activity_message') return pendingStatus.item.text

  const errors = entries.filter(
    (entry) => entry.type === 'activity_message' && entry.item.kind === 'error',
  )
  if (errors.length > 0) {
    const firstError = errors[0]
    if (firstError?.type === 'activity_message') {
      const compact = firstError.item.text.trim().replace(/\s+/g, ' ')
      if (compact.length <= 72) return compact
    }
    return errors.length === 1 ? 'An error occurred' : `${errors.length} errors`
  }

  const tools = entries.filter(
    (entry): entry is Extract<MessageFeedActivityEntry, { type: 'tool_block' }> =>
      entry.type === 'tool_block',
  )
  if (tools.length > 0) {
    const failedTool = tools.find((entry) => entry.result?.kind === 'error')
    if (failedTool) {
      const name = failedTool.call?.toolName ?? failedTool.result?.toolName
      return name ? `${name} failed` : 'Tool failed'
    }
    if (tools.length === 1) {
      const tool = tools[0]
      const name = tool.call?.toolName ?? tool.result?.toolName
      const pending = tool.call?.pending === true && !tool.result
      if (name === 'command') return pending ? 'Running command' : 'Ran command'
      if (name) return pending ? `Using ${name}` : `Used ${name}`
      return pending ? 'Using tool' : 'Used tool'
    }

    const commandsOnly = tools.every(
      (entry) => (entry.call?.toolName ?? entry.result?.toolName) === 'command',
    )
    return commandsOnly ? `Ran ${tools.length} commands` : `Used ${tools.length} tool steps`
  }

  const firstStatus = entries.find(
    (entry): entry is Extract<MessageFeedActivityEntry, { type: 'activity_message' }> =>
      entry.type === 'activity_message',
  )
  if (!firstStatus) return 'System activity'

  const compact = firstStatus.item.text.trim().replace(/\s+/g, ' ')
  if (compact.length <= 72) return compact
  return entries.length > 1 ? `${entries.length} status updates` : 'Status update'
}

export function commandTextFromToolSummary(summary: string | undefined) {
  const trimmed = summary?.trim() ?? ''
  const wrapped = /^Tool call:\s*command\s*\(([\s\S]*)\)\s*$/i.exec(trimmed)
  return (wrapped?.[1] ?? trimmed).trim()
}

function buildNormalizedRows(items: MessageFeedItem[]): NormalizedFeedRow[] {
  const rows: NormalizedFeedRow[] = []
  const toolRowIndexById = new Map<string, number>()

  for (const item of items) {
    if (item.kind === 'system_update') {
      rows.push({ type: 'system_update', id: `system-update:${item.id}`, item })
      continue
    }

    if (item.kind === 'action_required') {
      rows.push({ type: 'action_required', id: `action-required:${item.id}`, item })
      continue
    }

    if (item.kind === 'user_message' || item.kind === 'assistant_message') {
      rows.push({ type: 'message', id: `message:${item.id}`, item })
      continue
    }

    const toolRowId = getToolRowId(item)
    if (item.kind === 'tool_call') {
      rows.push({
        type: 'tool_block',
        id: toolRowId,
        createdAt: item.createdAt,
        call: item,
        groupId: item.groupId,
      })
      if (item.toolInvocationKey) toolRowIndexById.set(toolRowId, rows.length - 1)
      continue
    }

    if ((item.kind === 'tool_result' || item.kind === 'error') && item.toolInvocationKey) {
      const existingIndex = toolRowIndexById.get(toolRowId)
      const existing = existingIndex === undefined ? undefined : rows[existingIndex]
      if (existingIndex !== undefined && existing?.type === 'tool_block') {
        rows[existingIndex] = { ...existing, result: item }
        continue
      }

      if (item.kind === 'tool_result') {
        rows.push({
          type: 'tool_block',
          id: toolRowId,
          createdAt: item.createdAt,
          result: item,
          groupId: item.groupId,
        })
        continue
      }
    }

    rows.push({
      type: 'activity_message',
      id: `activity:${item.id}`,
      createdAt: item.createdAt,
      item,
      groupId: item.groupId,
    })
  }

  return rows
}

function getToolRowId(item: MessageFeedItem) {
  return `tool:${item.groupId ?? ''}:${item.toolInvocationKey ?? item.id}`
}

function assistantRuntimeStatus(status: InboxEventView['runtimeStatus']) {
  switch (status) {
    case 'queued':
      return 'Waiting to start'
    case 'running':
      return 'Working'
    case 'interrupted':
      return 'Waiting to resume'
    case 'failed':
      return 'Something went wrong. Retrying automatically.'
    case 'completed':
      return 'No reply was produced'
  }
}

function presentAssistantRuntimeItems(
  items: MessageFeedItem[],
  runtimeStatus: InboxEventView['runtimeStatus'],
) {
  return items.flatMap((item) => {
    if (isAssistantProtocolNoise(item)) return []
    if (item.kind === 'error' && runtimeStatus !== 'failed') return []
    if (item.kind === 'assistant_message' || item.kind === 'status') {
      return [{ ...item, details: undefined }]
    }
    return [item]
  })
}

function isAssistantProtocolNoise(item: MessageFeedItem) {
  if (
    item.kind === 'assistant_message' &&
    item.label?.toLowerCase() === 'coordinator' &&
    /^(starting|resuming) assistant turn\b/i.test(item.text.trim())
  ) {
    return true
  }

  if (item.kind !== 'status') return false
  const eventType = item.vendorEventType?.trim().toLowerCase().replaceAll('/', '.')
  if (eventType && /^(thread|turn|item)\.(started|completed)$/.test(eventType)) {
    return true
  }

  const summary = item.text
    .trim()
    .toLowerCase()
    .replaceAll(/[./_]+/g, ' ')
  return /^(thread|turn|item) (started|completed)$/.test(summary)
}

function completionAttentionItem(attention: AttentionView): MessageFeedItem {
  return {
    id: `completion:${attention.scope}:${attention.id}`,
    createdAt: attention.notifiedAt ?? attention.resolvedAt ?? attention.createdAt,
    kind: 'system_update',
    role: 'system',
    text: readableCompletionBody(attention.body),
    label: 'Completed',
    groupId: `completion:${attention.scope}:${attention.id}`,
  }
}

function applyCompletion(items: MessageFeedItem[], completion: AttentionView) {
  const assistantIndex = items.findLastIndex((item) => item.kind === 'assistant_message')
  if (assistantIndex < 0) return [...items, completionAttentionItem(completion)]
  const assistant = items[assistantIndex]
  if (!assistant) return [...items, completionAttentionItem(completion)]
  const next = [...items]
  next[assistantIndex] = {
    ...assistant,
    kind: 'system_update',
    role: 'system',
    label: 'Completed',
  }
  return next
}

function readableCompletionBody(body: string) {
  return body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .trim()
}

function sameText(left: string, right: string) {
  return left.trim().replace(/\s+/g, ' ') === right.trim().replace(/\s+/g, ' ')
}

function lastTimestamp(items: MessageFeedItem[], fallback: string) {
  return items.at(-1)?.createdAt ?? fallback
}
