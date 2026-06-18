import type { AgentRole, AgentTranscriptEntryKind, AgentTranscriptTransport } from '../agent/AgentRunner'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type { AssistantThreadEntry, GoalAssistantThread } from './assistantThreadStore'
import type { ActionRequiredNotification } from './actionRequiredNotificationTypes'
import type { GoalRun, GoalRunStep, RunStepMessage, RunTranscriptEntry } from './runHistory'

export const MESSAGE_FEED_ITEM_KINDS = [
  'user_message',
  'assistant_message',
  'assistant_delta',
  'system_message',
  'tool_call',
  'tool_result',
  'status',
] as const

export type MessageFeedItemKind = (typeof MESSAGE_FEED_ITEM_KINDS)[number]
export type MessageFeedRole = 'user' | 'assistant' | 'system'

export interface MessageFeedItem {
  id: string
  createdAt: string
  kind: MessageFeedItemKind
  role: MessageFeedRole
  text: string
  collapsedByDefault: boolean
  label?: string
  details?: string[]
  attachments?: GoalAttachmentRef[]
  runId?: string
  stepId?: string
  stepRole?: AgentRole
  toolName?: string
  toolInvocationKey?: string
  transport?: AgentTranscriptTransport
  vendorEventType?: string
  mergeKey?: string
  pending?: boolean
  notification?: ActionRequiredNotification
}

export interface MessageFeedPage {
  items: MessageFeedItem[]
  oldestCursor?: string
  newestCursor?: string
  hasMoreBefore: boolean
}

interface PaginateFeedOptions {
  before?: string
  limit?: number
}

interface FeedCursorPayload {
  index: number
}

export function paginateMessageFeedItems(
  items: MessageFeedItem[],
  options: PaginateFeedOptions = {},
): MessageFeedPage {
  if (items.length === 0) {
    return {
      items: [],
      hasMoreBefore: false,
    }
  }

  const limit = clampFeedLimit(options.limit)
  const beforeIndex = options.before ? decodeFeedCursor(options.before) : items.length
  const endIndex = Math.max(0, Math.min(beforeIndex, items.length))
  const startIndex = Math.max(0, endIndex - limit)
  const pageItems = items.slice(startIndex, endIndex)

  return {
    items: pageItems,
    oldestCursor: pageItems.length > 0 ? encodeFeedCursor({ index: startIndex }) : undefined,
    newestCursor:
      pageItems.length > 0 ? encodeFeedCursor({ index: endIndex - 1 }) : undefined,
    hasMoreBefore: startIndex > 0,
  }
}

export function listItemsAfterCursor(items: MessageFeedItem[], after?: string) {
  if (!after) {
    return [...items]
  }

  const afterIndex = decodeFeedCursor(after)
  const startIndex = Math.max(0, Math.min(afterIndex + 1, items.length))
  return items.slice(startIndex)
}

export function assistantThreadToFeedItems(thread: GoalAssistantThread): MessageFeedItem[] {
  return thread.entries.map((entry) => assistantThreadEntryToFeedItem(entry))
}

export function assistantThreadEntryToFeedItem(entry: AssistantThreadEntry): MessageFeedItem {
  switch (entry.kind) {
    case 'user_message':
      return {
        id: entry.entryId,
        createdAt: entry.createdAt,
        kind: 'user_message',
        role: 'user',
        text: entry.content,
        attachments: entry.attachments,
        collapsedByDefault: false,
      }
    case 'assistant_message':
      return {
        id: entry.entryId,
        createdAt: entry.createdAt,
        kind: 'assistant_message',
        role: 'assistant',
        text: entry.content,
        collapsedByDefault: false,
        ...(entry.mergeKey ? { mergeKey: entry.mergeKey } : {}),
      }
    case 'system_message':
      return {
        id: entry.entryId,
        createdAt: entry.createdAt,
        kind: 'system_message',
        role: 'system',
        text: entry.content,
        collapsedByDefault: entry.collapsedByDefault ?? (entry.notification ? false : true),
        label: entry.label,
        details: entry.details,
        ...(entry.notification ? { notification: entry.notification } : {}),
      }
    case 'action':
      return {
        id: entry.entryId,
        createdAt: entry.createdAt,
        kind: 'system_message',
        role: 'system',
        text: entry.summary,
        collapsedByDefault: true,
        label: `Action · ${entry.actionType}`,
      }
    case 'action_result':
      return {
        id: entry.entryId,
        createdAt: entry.createdAt,
        kind: 'system_message',
        role: 'system',
        text: entry.summary,
        collapsedByDefault: true,
        label: `Result · ${entry.actionType}`,
      }
  }
}

export function runToFeedItems(run: GoalRun, stepId?: string): MessageFeedItem[] {
  const steps = stepId ? run.steps.filter((step) => step.stepId === stepId) : run.steps
  const items: MessageFeedItem[] = []

  for (const step of steps) {
    items.push(...stepToFeedItems(run.runId, step))
  }

  return items
}

export function runMessageToFeedItem(options: {
  runId: string
  step: GoalRunStep
  message: RunStepMessage
}): MessageFeedItem {
  return {
    id: options.message.messageId,
    createdAt: options.message.createdAt,
    kind: 'system_message',
    role: 'system',
    text: options.message.content,
    collapsedByDefault: true,
    label: `Step ${options.message.kind}`,
    details: [`${options.step.role} · ${options.message.kind}`],
    runId: options.runId,
    stepId: options.step.stepId,
    stepRole: options.step.role,
  }
}

export function runTranscriptToFeedItem(options: {
  runId: string
  step: GoalRunStep
  entry: RunTranscriptEntry
}): MessageFeedItem {
  if (options.entry.kind === 'assistant') {
    return {
      id: options.entry.entryId,
      createdAt: options.entry.createdAt,
      kind: 'assistant_message',
      role: 'assistant',
      text: options.entry.summary,
      collapsedByDefault: false,
      runId: options.runId,
      stepId: options.step.stepId,
      stepRole: options.step.role,
      transport: options.entry.transport,
      ...(options.entry.vendorEventType
        ? { vendorEventType: options.entry.vendorEventType }
        : {}),
    }
  }

  return {
    id: options.entry.entryId,
    createdAt: options.entry.createdAt,
    kind: transcriptKindToFeedKind(options.entry.kind),
    role: 'system',
    text: options.entry.summary,
    collapsedByDefault: true,
    label: transcriptKindToLabel(options.entry.kind),
    details: buildTranscriptDetails(options.step.role, options.entry),
    runId: options.runId,
    stepId: options.step.stepId,
    stepRole: options.step.role,
    transport: options.entry.transport,
    ...(options.entry.toolName ? { toolName: options.entry.toolName } : {}),
    ...(options.entry.toolInvocationKey
      ? { toolInvocationKey: options.entry.toolInvocationKey }
      : {}),
    ...(options.entry.vendorEventType
      ? { vendorEventType: options.entry.vendorEventType }
      : {}),
  }
}

export function buildAssistantDeltaFeedItem(options: {
  id: string
  createdAt: string
  text: string
  mergeKey: string
}): MessageFeedItem {
  return {
    id: options.id,
    createdAt: options.createdAt,
    kind: 'assistant_delta',
    role: 'assistant',
    text: options.text,
    collapsedByDefault: true,
    mergeKey: options.mergeKey,
    pending: true,
    label: 'Assistant',
  }
}

function stepToFeedItems(runId: string, step: GoalRunStep) {
  const combined = [
    ...step.messages.map((message, index) => ({
      createdAt: message.createdAt,
      orderKey: `message:${index}`,
      item: runMessageToFeedItem({ runId, step, message }),
      type: 'message' as const,
    })),
    ...step.transcript.map((entry, index) => ({
      createdAt: entry.createdAt,
      orderKey: `transcript:${index}`,
      item: runTranscriptToFeedItem({ runId, step, entry }),
      type: 'transcript' as const,
      transcriptKind: entry.kind,
    })),
  ].sort(compareCombinedFeedEvents)

  const items: MessageFeedItem[] = []
  let activeAssistantIndex: number | null = null

  for (const event of combined) {
    if (event.type === 'transcript' && event.transcriptKind === 'assistant') {
      if (activeAssistantIndex !== null) {
        const current = items[activeAssistantIndex]
        if (!current) {
          activeAssistantIndex = null
          items.push(event.item)
          activeAssistantIndex = items.length - 1
          continue
        }
        current.text = `${current.text}${event.item.text}`
        current.id = `${current.id}+${event.item.id}`
        current.createdAt = event.item.createdAt
        continue
      }

      items.push(event.item)
      activeAssistantIndex = items.length - 1
      continue
    }

    activeAssistantIndex = null
    items.push(event.item)
  }

  return items
}

function compareCombinedFeedEvents(
  left: {
    createdAt: string
    orderKey: string
  },
  right: {
    createdAt: string
    orderKey: string
  },
) {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }

  return left.orderKey.localeCompare(right.orderKey)
}

function buildTranscriptDetails(role: AgentRole, entry: RunTranscriptEntry) {
  const details = [`${role} · ${entry.transport}`]
  if (entry.toolName) {
    details.push(`tool=${entry.toolName}`)
  }
  if (entry.vendorEventType) {
    details.push(`vendor=${entry.vendorEventType}`)
  }
  return details
}

function transcriptKindToFeedKind(kind: AgentTranscriptEntryKind): MessageFeedItemKind {
  if (kind === 'tool_call') {
    return 'tool_call'
  }
  if (kind === 'tool_result') {
    return 'tool_result'
  }
  return 'status'
}

function transcriptKindToLabel(kind: AgentTranscriptEntryKind) {
  switch (kind) {
    case 'tool_call':
      return 'Tool call'
    case 'tool_result':
      return 'Tool result'
    case 'error':
      return 'Error'
    default:
      return 'Status'
  }
}

function clampFeedLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return 50
  }

  return Math.max(1, Math.min(200, Math.trunc(limit)))
}

function encodeFeedCursor(payload: FeedCursorPayload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeFeedCursor(cursor: string) {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(raw) as FeedCursorPayload
    if (!Number.isInteger(parsed.index) || parsed.index < 0) {
      throw new Error('Invalid cursor')
    }
    return parsed.index
  } catch {
    throw new Error('Invalid feed cursor')
  }
}
