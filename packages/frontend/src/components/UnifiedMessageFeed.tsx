import { forwardRef, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { AlertCircle, ArrowDown, ChevronDown, ChevronRight, Loader2, Paperclip } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { type GoalAttachmentRef, type MessageFeedItem, goalAssetUrl } from '../lib/api'
import { cn } from '../lib/utils'
import { ScrollContainer } from './ScrollContainer'

interface UnifiedMessageFeedProps {
  goalKey: string
  projectKey?: string
  items: MessageFeedItem[]
  isLoading?: boolean
  hasMoreBefore?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  emptyLabel: string
  className?: string
}

const INITIAL_FIRST_ITEM_INDEX = 100_000

const VirtuosoScroller = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ children, className, ...rest }, ref) => (
    <ScrollContainer
      axis="vertical"
      className="h-full"
      viewportClassName={cn('h-full', className)}
      viewportRef={ref}
      viewportProps={rest}
    >
      {children}
    </ScrollContainer>
  ),
)
VirtuosoScroller.displayName = 'VirtuosoScroller'

type ActivityEntry =
  | {
      type: 'tool_block'
      id: string
      createdAt: string
      call?: MessageFeedItem
      result?: MessageFeedItem
      runId?: string
      stepId?: string
      stepRole?: string
    }
  | {
      type: 'activity_message'
      id: string
      createdAt: string
      item: MessageFeedItem
      runId?: string
      stepId?: string
      stepRole?: string
    }

type DisplayFeedRow =
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
      type: 'activity_group'
      id: string
      createdAt: string
      latestCreatedAt: string
      entries: ActivityEntry[]
      runId?: string
      stepId?: string
      stepRole?: string
    }

type NormalizedFeedRow =
  | Extract<DisplayFeedRow, { type: 'message' }>
  | Extract<DisplayFeedRow, { type: 'action_required' }>
  | ActivityEntry

export function UnifiedMessageFeed({
  goalKey,
  projectKey,
  items,
  isLoading = false,
  hasMoreBefore = false,
  isLoadingOlder = false,
  onLoadOlder,
  emptyLabel,
  className,
}: UnifiedMessageFeedProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
  const previousSnapshotRef = useRef<{
    firstId?: string
    lastId?: string
    length: number
  }>({ length: 0 })

  useEffect(() => {
    setExpandedItems({})
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    previousSnapshotRef.current = { length: 0 }
  }, [goalKey, projectKey])

  const orderedItems = useMemo(() => items, [items])
  const displayRows = useMemo(() => buildDisplayRows(orderedItems), [orderedItems])

  useEffect(() => {
    const previous = previousSnapshotRef.current
    if (
      previous.length > 0 &&
      displayRows.length > previous.length &&
      previous.firstId &&
      previous.lastId
    ) {
      const previousFirstIndex = displayRows.findIndex((row) => row.id === previous.firstId)
      const previousLastIndex = displayRows.findIndex((row) => row.id === previous.lastId)
      if (previousFirstIndex > 0 && previousLastIndex === displayRows.length - 1) {
        setFirstItemIndex((current) => current - previousFirstIndex)
      }
    }

    previousSnapshotRef.current = {
      firstId: displayRows[0]?.id,
      lastId: displayRows.at(-1)?.id,
      length: displayRows.length,
    }
  }, [displayRows])

  if (isLoading && displayRows.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 px-4 text-sm text-gray-500', className)}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading messages...
      </div>
    )
  }

  if (!isLoading && displayRows.length === 0) {
    return (
      <div className={cn('px-4 py-6 text-sm text-gray-500', className)}>
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className={cn('relative h-full min-h-0', className)}>
      <Virtuoso
        ref={virtuosoRef}
        className="h-full"
        data={displayRows}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(displayRows.length - 1, 0)}
        computeItemKey={(_, item) => item.id}
        followOutput={isAtBottom ? 'smooth' : false}
        alignToBottom
        atBottomThreshold={96}
        atBottomStateChange={setIsAtBottom}
        startReached={() => {
          if (hasMoreBefore && !isLoadingOlder) {
            onLoadOlder?.()
          }
        }}
        components={{
          Scroller: VirtuosoScroller,
          Header: () =>
            hasMoreBefore || isLoadingOlder ? (
              <div className="px-4 py-3 text-center text-xs text-gray-500">
                {isLoadingOlder ? 'Loading older messages…' : 'Scroll up for older messages'}
              </div>
            ) : null,
        }}
        itemContent={(_, row) =>
          row.type === 'activity_group' ? (
            <ActivityGroupRow
              row={row}
              expanded={expandedItems[row.id] ?? false}
              onToggle={() =>
                setExpandedItems((current) => ({
                  ...current,
                  [row.id]: !(current[row.id] ?? false),
                }))
              }
            />
          ) : row.type === 'action_required' ? (
            <ActionRequiredRow item={row.item} />
          ) : (
            <MessageFeedRow goalKey={goalKey} projectKey={projectKey} item={row.item} />
          )
        }
      />

      {!isAtBottom && (
        <button
          type="button"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({
              index: Math.max(displayRows.length - 1, 0),
              behavior: 'smooth',
            })
          }
          className="absolute right-4 bottom-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#1a1a1a]/95 px-3 py-2 text-xs font-medium text-gray-200 shadow-lg backdrop-blur transition hover:border-white/15 hover:text-white"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Latest
        </button>
      )}
    </div>
  )
}

function MessageFeedRow({
  goalKey,
  projectKey,
  item,
}: {
  goalKey: string
  projectKey?: string
  item: MessageFeedItem
}) {
  const isUser = item.kind === 'user_message'
  const isAssistant = item.kind === 'assistant_message' || item.kind === 'assistant_delta'

  if (!isUser && !isAssistant) {
    return null
  }

  return (
    <div className={cn('px-4 py-2', isUser ? 'flex justify-end' : 'flex justify-start')}>
      <div className={cn('w-full', isUser ? 'max-w-[min(100%,42rem)]' : 'max-w-[min(100%,52rem)]')}>
        {item.attachments && item.attachments.length > 0 ? (
          <AttachmentRail
            goalKey={goalKey}
            projectKey={projectKey}
            attachments={item.attachments}
            align={isUser ? 'end' : 'start'}
          />
        ) : null}

        {isUser ? (
          <div className="rounded-[1.6rem] bg-[#2b2b2b] px-4 py-3 text-[15px] leading-7 text-white ring-1 ring-white/8">
            <div className="whitespace-pre-wrap break-words">{item.text}</div>
          </div>
        ) : (
          <div className="text-[15px] leading-7 text-gray-100">
            <div className="whitespace-pre-wrap break-words">{item.text}</div>
            {item.pending ? (
              <div className="mt-2 inline-flex items-center gap-2 text-xs text-gray-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Streaming
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function AttachmentRail({
  goalKey,
  projectKey,
  attachments,
  align,
}: {
  goalKey: string
  projectKey?: string
  attachments: GoalAttachmentRef[]
  align: 'start' | 'end'
}) {
  return (
    <div className={cn('mb-2 flex flex-wrap gap-2', align === 'end' ? 'justify-end' : 'justify-start')}>
      {attachments.map((attachment) => (
        <a
          key={attachment.assetPath}
          href={goalAssetUrl(goalKey, attachment.assetPath, projectKey)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-200 transition hover:border-white/20 hover:bg-white/7"
        >
          <div className="h-5 w-5 overflow-hidden rounded-full bg-white/8">
            <img
              src={goalAssetUrl(goalKey, attachment.assetPath, projectKey)}
              alt={attachment.fileName}
              className="h-full w-full object-cover"
            />
          </div>
          <Paperclip className="h-3 w-3 shrink-0 text-gray-400" />
          <span className="truncate">{attachment.fileName}</span>
        </a>
      ))}
    </div>
  )
}

function ActionRequiredRow({ item }: { item: MessageFeedItem }) {
  const [expanded, setExpanded] = useState(false)
  const details = item.details ?? []

  return (
    <div className="px-4 py-2">
      <div className="max-w-[min(100%,52rem)]">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-50 shadow-[0_0_0_1px_rgba(0,0,0,0.16)]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[11px] font-medium uppercase text-amber-300/90">
                  {item.label ?? 'Action required'}
                </span>
                <span className="text-[11px] text-amber-200/50">
                  {formatFeedTimestamp(item.createdAt)}
                </span>
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words leading-6 text-amber-50">
                {item.text}
              </div>
              {details.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => !current)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-200/70 transition hover:text-amber-100"
                  >
                    {expanded ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Details
                  </button>
                  {expanded ? (
                    <div className="mt-2 space-y-1.5 text-xs leading-5 text-amber-100/75">
                      {details.map((detail, index) => (
                        <div key={`${item.id}:action-detail:${index}`} className="break-words">
                          {detail}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityGroupRow({
  row,
  expanded,
  onToggle,
}: {
  row: Extract<DisplayFeedRow, { type: 'activity_group' }>
  expanded: boolean
  onToggle: () => void
}) {
  const summary = summarizeActivityGroup(row.entries)
  const hasPendingEntries = row.entries.some((entry) =>
    entry.type === 'tool_block'
      ? !entry.result || entry.call?.pending || entry.result?.pending
      : entry.item.pending,
  )

  return (
    <div className="px-4 py-1.5">
      <div className="max-w-[min(100%,52rem)]">
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.04]"
        >
          <div className="flex min-w-0 items-center gap-2 text-sm text-gray-400">
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-600" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-600" />
            )}
            {hasPendingEntries ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-gray-500" />
            ) : null}
            <span className="truncate">{summary}</span>
          </div>
          <span className="shrink-0 text-[11px] text-gray-600">
            {formatFeedTimestamp(row.latestCreatedAt)}
          </span>
        </button>

        {expanded ? (
          <div className="mt-1 ml-4 border-l border-white/8 pl-4">
            <div className="space-y-3 py-2">
              {row.entries.map((entry) =>
                entry.type === 'tool_block' ? (
                  <ToolActivityEntry key={entry.id} entry={entry} />
                ) : (
                  <StatusActivityEntry key={entry.id} item={entry.item} />
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ToolActivityEntry({
  entry,
}: {
  entry: Extract<ActivityEntry, { type: 'tool_block' }>
}) {
  const toolName = entry.call?.toolName ?? entry.result?.toolName
  const pending = !entry.result || entry.call?.pending || entry.result?.pending
  const toolHeader = toolName === 'command' ? 'Command' : toolName ? `Tool · ${toolName}` : 'Tool'
  const callText = entry.call?.text?.trim()
  const resultText = entry.result?.text?.trim()

  return (
    <div className="rounded-xl bg-[#151515] px-3 py-3 ring-1 ring-white/6">
      <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium uppercase tracking-wide text-gray-400">
            {toolHeader}
          </span>
          {pending ? (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running
            </span>
          ) : null}
        </div>
        <span>{formatFeedTimestamp(entry.result?.createdAt ?? entry.createdAt)}</span>
      </div>

      {callText ? (
        <div className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-gray-300">
          {callText}
        </div>
      ) : null}

      {resultText ? (
        <div className="mt-3 rounded-lg bg-black/20 px-3 py-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-gray-200">
          {resultText}
        </div>
      ) : pending ? (
        <div className="mt-3 text-xs text-gray-500">Waiting for tool result…</div>
      ) : null}
    </div>
  )
}

function StatusActivityEntry({ item }: { item: MessageFeedItem }) {
  return (
    <div className="text-sm leading-6 text-gray-400">
      {item.label ? (
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {item.label}
        </div>
      ) : null}
      <div className="whitespace-pre-wrap break-words">{item.text}</div>
      {item.details && item.details.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-600">
          {item.details.map((detail, index) => (
            <span key={`${item.id}:detail:${index}`}>{detail}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildDisplayRows(items: MessageFeedItem[]): DisplayFeedRow[] {
  const normalized = buildNormalizedRows(items)
  const rows: DisplayFeedRow[] = []
  let activeGroup: Extract<DisplayFeedRow, { type: 'activity_group' }> | null = null

  const flushGroup = () => {
    if (activeGroup) {
      rows.push(activeGroup)
      activeGroup = null
    }
  }

  for (const entry of normalized) {
    if (entry.type === 'message') {
      flushGroup()
      rows.push(entry)
      continue
    }

    if (entry.type === 'action_required') {
      flushGroup()
      rows.push(entry)
      continue
    }

    if (!activeGroup || !canJoinActivityGroup(activeGroup, entry)) {
      flushGroup()
      activeGroup = {
        type: 'activity_group',
        id: `activity-group:${entry.id}`,
        createdAt: entry.createdAt,
        latestCreatedAt: entry.createdAt,
        entries: [entry],
        runId: entry.runId,
        stepId: entry.stepId,
        stepRole: entry.stepRole,
      }
      continue
    }

    activeGroup.entries.push(entry)
    activeGroup.latestCreatedAt = entry.createdAt
  }

  flushGroup()
  return rows
}

function buildNormalizedRows(items: MessageFeedItem[]) {
  const rows: NormalizedFeedRow[] = []
  const toolRowIndexById = new Map<string, number>()

  for (const item of items) {
    if (item.notification) {
      rows.push({
        type: 'action_required',
        id: `action-required:${item.id}`,
        item,
      })
      continue
    }

    if (isTextMessage(item)) {
      rows.push({
        type: 'message',
        id: `message:${item.id}`,
        item,
      })
      continue
    }

    const toolRowId = getToolRowId(item)
    if (item.kind === 'tool_call' && toolRowId) {
      rows.push({
        type: 'tool_block',
        id: toolRowId,
        createdAt: item.createdAt,
        call: item,
        runId: item.runId,
        stepId: item.stepId,
        stepRole: item.stepRole,
      })
      toolRowIndexById.set(toolRowId, rows.length - 1)
      continue
    }

    if (item.kind === 'tool_result' && toolRowId) {
      const existingIndex = toolRowIndexById.get(toolRowId)
      if (existingIndex !== undefined) {
        const existingRow = rows[existingIndex]
        if (existingRow && 'type' in existingRow && existingRow.type === 'tool_block') {
          rows[existingIndex] = {
            ...existingRow,
            result: item,
          }
          continue
        }
      }

      rows.push({
        type: 'tool_block',
        id: toolRowId,
        createdAt: item.createdAt,
        result: item,
        runId: item.runId,
        stepId: item.stepId,
        stepRole: item.stepRole,
      })
      continue
    }

    rows.push({
      type: 'activity_message',
      id: `activity:${item.id}`,
      createdAt: item.createdAt,
      item,
      runId: item.runId,
      stepId: item.stepId,
      stepRole: item.stepRole,
    })
  }

  return rows
}

function canJoinActivityGroup(
  group: Extract<DisplayFeedRow, { type: 'activity_group' }>,
  entry: ActivityEntry,
) {
  return (group.runId ?? '') === (entry.runId ?? '') && (group.stepId ?? '') === (entry.stepId ?? '')
}

function summarizeActivityGroup(entries: ActivityEntry[]) {
  const toolEntries = entries.filter(
    (entry): entry is Extract<ActivityEntry, { type: 'tool_block' }> => entry.type === 'tool_block',
  )
  const statusEntries = entries.filter(
    (entry): entry is Extract<ActivityEntry, { type: 'activity_message' }> =>
      entry.type === 'activity_message',
  )

  const pendingAssistantStatus = statusEntries.find(
    (entry) => entry.item.pending && entry.item.role === 'assistant',
  )?.item

  if (pendingAssistantStatus) {
    return pendingAssistantStatus.text
  }

  if (toolEntries.length > 0) {
    if (toolEntries.length === 1) {
      const toolName = toolEntries[0].call?.toolName ?? toolEntries[0].result?.toolName
      if (toolName === 'command') {
        return '已运行命令'
      }
      if (toolName) {
        return `已调用 ${toolName}`
      }
      return '已调用工具'
    }

    const isCommandBurst = toolEntries.every(
      (entry) => (entry.call?.toolName ?? entry.result?.toolName) === 'command',
    )
    return isCommandBurst
      ? `已运行 ${toolEntries.length} 条命令`
      : `已调用 ${toolEntries.length} 个工具步骤`
  }

  const firstStatus = statusEntries[0]?.item
  if (!firstStatus) {
    return '系统活动'
  }

  const compact = firstStatus.text.trim().replace(/\s+/g, ' ')
  if (compact.length <= 72) {
    return compact
  }

  return statusEntries.length > 1 ? `已更新 ${statusEntries.length} 条状态` : '状态更新'
}

function getToolRowId(item: MessageFeedItem) {
  if (!item.toolInvocationKey) {
    return undefined
  }

  return `tool:${item.runId ?? ''}:${item.stepId ?? ''}:${item.toolInvocationKey}`
}

function isTextMessage(item: MessageFeedItem) {
  return (
    item.kind === 'user_message' ||
    item.kind === 'assistant_message' ||
    item.kind === 'assistant_delta'
  )
}

function formatFeedTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
