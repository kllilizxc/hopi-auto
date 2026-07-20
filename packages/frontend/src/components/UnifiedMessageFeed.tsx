import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, ArrowDown, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Virtuoso,
  type Components,
  type VirtuosoHandle,
} from 'react-virtuoso'
import {
  buildMessageFeedRows,
  commandTextFromToolSummary,
  summarizeActivityGroup,
  type MessageFeedActivityEntry,
  type MessageFeedDisplayRow,
  type MessageFeedItem,
} from '../lib/messageFeed'
import { cn } from '../lib/utils'
import { MessageFeedSkeleton } from './MessageFeedSkeleton'
import {
  AppButton,
  AppBreathingIndicator,
  AppDisclosure,
  AppLink,
  AppScrollShadow,
  AppSpinner,
  StatusChip,
  WorkingIndicator,
} from './ui'

interface UnifiedMessageFeedProps {
  feedKey: string
  items: MessageFeedItem[]
  emptyState: ReactNode
  tailActivity?: 'waiting' | 'working' | 'thinking' | null
  isLoading?: boolean
  hasMoreBefore?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  mode?: 'scroll' | 'inline'
  density?: 'comfortable' | 'compact'
  className?: string
  ariaLabel?: string
  onScrollingChange?: (scrolling: boolean) => void
  focusGroupId?: string | null
  focusRequest?: number
  needsYouByGroupId?: ReadonlyMap<string, number>
  onReplyNeedsYou?: (groupId: string) => void
}

const INITIAL_FIRST_ITEM_INDEX = 100_000

export { MessageFeedSkeleton } from './MessageFeedSkeleton'
const INITIAL_BOTTOM_LOCATION = { index: 'LAST', align: 'end' } as const
const MESSAGE_FEED_AUTO_FOLLOW_DISTANCE = 160
const FEED_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour12: false,
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
interface FeedVirtuosoContext {
  hasMoreBefore: boolean
  isLoadingOlder: boolean
}

type RenderedFeedRow =
  | MessageFeedDisplayRow
  | {
      type: 'tail_activity'
      id: 'tail-activity'
      phase: 'waiting' | 'working' | 'thinking'
    }

const FEED_VIRTUOSO_COMPONENTS: Components<RenderedFeedRow, FeedVirtuosoContext> = {
  Header: FeedHistoryHeader,
  Footer: FeedBottomClearance,
  Scroller: AppScrollShadow,
}

export const UnifiedMessageFeed = memo(function UnifiedMessageFeed({
  feedKey,
  items,
  emptyState,
  tailActivity = null,
  isLoading = false,
  hasMoreBefore = false,
  isLoadingOlder = false,
  onLoadOlder,
  mode = 'scroll',
  density = 'comfortable',
  className,
  ariaLabel = 'Message stream',
  onScrollingChange,
  focusGroupId = null,
  focusRequest = 0,
  needsYouByGroupId,
  onReplyNeedsYou,
}: UnifiedMessageFeedProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const handledFocusRequestRef = useRef(0)
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [announceUpdates, setAnnounceUpdates] = useState(true)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
  const previousSnapshotRef = useRef<{ firstId?: string; lastId?: string; length: number }>({
    length: 0,
  })
  const displayRows = useMemo(() => buildMessageFeedRows(items), [items])
  const lastRowId = displayRows.at(-1)?.id
  const renderedRows = useMemo<RenderedFeedRow[]>(
    () =>
      tailActivity
        ? [...displayRows, { type: 'tail_activity', id: 'tail-activity', phase: tailActivity }]
        : displayRows,
    [displayRows, tailActivity],
  )
  const focusRowIndex = focusGroupId
    ? renderedRows.findLastIndex((row) => feedRowGroupId(row) === focusGroupId)
    : -1

  useEffect(() => {
    setExpandedItems({})
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setIsNearBottom(true)
    handledFocusRequestRef.current = 0
    previousSnapshotRef.current = { length: 0 }
  }, [feedKey])

  useEffect(() => {
    if (
      focusRequest === 0 ||
      focusRowIndex < 0 ||
      handledFocusRequestRef.current === focusRequest
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: focusRowIndex, align: 'center' })
      handledFocusRequestRef.current = focusRequest
      setIsNearBottom(false)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, focusRowIndex])

  useEffect(() => {
    const previous = previousSnapshotRef.current
    if (
      previous.length > 0 &&
      displayRows.length > previous.length &&
      previous.firstId &&
      previous.lastId
    ) {
      const previousFirstIndex = displayRows.findIndex((row) => row.id === previous.firstId)
      if (previousFirstIndex > 0) {
        setFirstItemIndex((current) => current - previousFirstIndex)
      }
    }

    previousSnapshotRef.current = {
      firstId: displayRows[0]?.id,
      lastId: displayRows.at(-1)?.id,
      length: displayRows.length,
    }
  }, [displayRows])

  useEffect(() => {
    if (isLoadingOlder) {
      setAnnounceUpdates(false)
      return
    }
    const frame = requestAnimationFrame(() => setAnnounceUpdates(true))
    return () => cancelAnimationFrame(frame)
  }, [isLoadingOlder])

  const renderRow = useCallback(
    (row: RenderedFeedRow) => {
      if (row.type === 'tail_activity') return <TailActivityRow phase={row.phase} />
      if (row.type === 'activity_group') {
        if (row.id === lastRowId && row.entries.some((entry) => entry.type === 'tool_block')) {
          return <LiveToolActivityRow row={row} />
        }
        return (
          <ActivityGroupRow
            row={row}
            expanded={expandedItems[row.id] ?? false}
            onToggle={(expanded) =>
              setExpandedItems((current) => ({
                ...current,
                [row.id]: expanded,
              }))
            }
          />
        )
      }
      if (row.type === 'action_required') return <ActionRequiredRow item={row.item} />
      if (row.type === 'system_update') return <SystemUpdateRow item={row.item} />
      const groupId = row.item.groupId
      return (
        <MessageRow
          item={row.item}
          needsYouCount={groupId ? (needsYouByGroupId?.get(groupId) ?? 0) : 0}
          onReply={groupId && onReplyNeedsYou ? () => onReplyNeedsYou(groupId) : undefined}
        />
      )
    },
    [expandedItems, lastRowId, needsYouByGroupId, onReplyNeedsYou],
  )
  const itemContent = useCallback(
    (_index: number, row: RenderedFeedRow) => renderRow(row),
    [renderRow],
  )
  const virtuosoContext = useMemo(
    () => ({ hasMoreBefore, isLoadingOlder }),
    [hasMoreBefore, isLoadingOlder],
  )

  const rootClassName = cn(
    'unified-message-feed',
    `unified-message-feed--${mode}`,
    `unified-message-feed--${density}`,
    className,
  )

  if (isLoading && renderedRows.length === 0) {
    return (
      <div className={rootClassName}>
        <MessageFeedSkeleton density={density} />
      </div>
    )
  }

  if (renderedRows.length === 0) {
    return (
      <div className={rootClassName}>
        <div className="unified-message-feed__empty">{emptyState}</div>
      </div>
    )
  }

  if (mode === 'inline') {
    return (
      <div
        className={rootClassName}
        role="log"
        aria-label={ariaLabel}
        aria-live={announceUpdates ? 'polite' : 'off'}
      >
        <div className="unified-message-feed__inline-list">
          {renderedRows.map((row) => (
            <div key={row.id}>{renderRow(row)}</div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={rootClassName}
      role="log"
      aria-label={ariaLabel}
      aria-live={announceUpdates ? 'polite' : 'off'}
    >
      <Virtuoso
        key={feedKey}
        ref={virtuosoRef}
        className="unified-message-feed__virtuoso"
        data={renderedRows}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={INITIAL_BOTTOM_LOCATION}
        computeItemKey={(_, row) => row.id}
        followOutput="auto"
        alignToBottom
        atTopThreshold={32}
        atBottomThreshold={MESSAGE_FEED_AUTO_FOLLOW_DISTANCE}
        atBottomStateChange={setIsNearBottom}
        isScrolling={onScrollingChange}
        startReached={() => {
          if (hasMoreBefore && !isLoadingOlder) onLoadOlder?.()
        }}
        increaseViewportBy={{ top: 240, bottom: 320 }}
        context={virtuosoContext}
        components={FEED_VIRTUOSO_COMPONENTS}
        itemContent={itemContent}
      />

      {!isNearBottom && (
        <AppButton
          variant="secondary"
          type="button"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({
              index: Math.max(renderedRows.length - 1, 0),
              behavior: 'smooth',
              align: 'end',
            })
          }
          className="unified-message-feed__latest"
        >
          <ArrowDown />
          Latest
        </AppButton>
      )}
    </div>
  )
}, messageFeedPropsEqual)

function messageFeedPropsEqual(
  previous: UnifiedMessageFeedProps,
  next: UnifiedMessageFeedProps,
) {
  if (
    previous.feedKey !== next.feedKey ||
    previous.items !== next.items ||
    previous.tailActivity !== next.tailActivity ||
    previous.isLoading !== next.isLoading ||
    previous.hasMoreBefore !== next.hasMoreBefore ||
    previous.isLoadingOlder !== next.isLoadingOlder ||
    previous.onLoadOlder !== next.onLoadOlder ||
    previous.mode !== next.mode ||
    previous.density !== next.density ||
    previous.className !== next.className ||
    previous.ariaLabel !== next.ariaLabel ||
    previous.onScrollingChange !== next.onScrollingChange ||
    previous.focusGroupId !== next.focusGroupId ||
    previous.focusRequest !== next.focusRequest ||
    previous.needsYouByGroupId !== next.needsYouByGroupId ||
    previous.onReplyNeedsYou !== next.onReplyNeedsYou
  ) {
    return false
  }

  // The empty-state node is commonly authored inline by the parent. Once the
  // stream has data it is not rendered, so its changing identity must not
  // invalidate the virtualized list while a composer or toolbar updates.
  return (
    previous.items.length > 0 ||
    Boolean(previous.tailActivity) ||
    previous.emptyState === next.emptyState
  )
}

function feedRowGroupId(row: RenderedFeedRow) {
  if (row.type === 'tail_activity') return null
  if (row.type === 'activity_group') return row.groupId ?? null
  return row.item.groupId ?? null
}

function MessageRow({
  item,
  needsYouCount = 0,
  onReply,
}: {
  item: MessageFeedItem
  needsYouCount?: number
  onReply?: () => void
}) {
  const isUser = item.kind === 'user_message'
  const needsYou = !isUser && needsYouCount > 0
  return (
    <article
      className={cn(
        'unified-feed-message-row',
        isUser ? 'user' : 'assistant',
        needsYou && 'needs-you',
      )}
    >
      <div className="unified-feed-message">
        {needsYou ? (
          <div className="unified-feed-needs-you">
            <StatusChip color="warning" size="sm" variant="soft">
              Needs you{needsYouCount > 1 ? ` · ${needsYouCount}` : ''}
            </StatusChip>
            <AppButton
              className="unified-feed-needs-you__reply"
              variant="ghost"
              type="button"
              onClick={onReply}
              aria-label="Reply to this request"
            >
              Reply
            </AppButton>
          </div>
        ) : null}
        {isUser && item.text.trim() ? (
          <div className="unified-feed-message__bubble">{item.text}</div>
        ) : !isUser ? (
          <div className="unified-feed-message__text">
            <AssistantMessageText text={item.text} />
          </div>
        ) : null}
        {item.attachments && item.attachments.length > 0 ? (
          <div className="unified-feed-message__attachments">
            {item.attachments.map((attachment) => (
              <AppLink
                href={attachment.url}
                key={attachment.reference}
                target="_blank"
                rel="noreferrer"
                title={attachment.fileName}
              >
                <img src={attachment.url} alt={attachment.fileName} loading="lazy" />
              </AppLink>
            ))}
          </div>
        ) : null}
        {item.pending ? (
          <StatusChip className="unified-feed-message__pending" color="accent" size="sm" variant="soft">
            <WorkingIndicator label="Streaming" />
          </StatusChip>
        ) : null}
      </div>
    </article>
  )
}

const AssistantMarkdown = lazy(() =>
  import('./AssistantMarkdown').then((module) => ({ default: module.AssistantMarkdown })),
)

export const AssistantMessageText = memo(function AssistantMessageText({ text }: { text: string }) {
  return (
    <div className="assistant-message-markdown">
      <Suspense fallback={<span className="assistant-message-markdown__fallback">{text}</span>}>
        <AssistantMarkdown text={text} />
      </Suspense>
    </div>
  )
})

function ActionRequiredRow({ item }: { item: MessageFeedItem }) {
  const [expanded, setExpanded] = useState(false)
  const details = item.details ?? []
  return (
    <article className="unified-feed-action-row">
      <AlertCircle />
      <div>
        <header>
          <strong>{item.label ?? 'Action required'}</strong>
          <time>{formatFeedTimestamp(item.createdAt)}</time>
        </header>
        <div className="unified-feed-action-row__message">
          <AssistantMessageText text={item.text} />
        </div>
        {details.length > 0 ? (
          <>
            <AppButton variant="ghost" type="button" onClick={() => setExpanded((current) => !current)}>
              {expanded ? <ChevronDown /> : <ChevronRight />}
              Details
            </AppButton>
            {expanded ? (
              <div className="unified-feed-action-row__details">
                {details.map((detail, index) => (
                  <span key={`${item.id}:action-detail:${index}`}>{detail}</span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  )
}

function SystemUpdateRow({ item }: { item: MessageFeedItem }) {
  return (
    <article className="unified-feed-system-update">
      <CheckCircle2 />
      <div>
        <header>
          <strong>{item.label ?? 'System update'}</strong>
          <time>{formatFeedTimestamp(item.createdAt)}</time>
        </header>
        <div className="unified-feed-system-update__message">
          <AssistantMessageText text={item.text} />
        </div>
      </div>
    </article>
  )
}

function TailActivityRow({ phase }: { phase: 'waiting' | 'working' | 'thinking' }) {
  const label =
    phase === 'working' ? 'Working' : phase === 'thinking' ? 'Thinking' : 'Waiting to start'
  return (
    <div
      className="unified-feed-waiting unified-feed-tail-activity"
      data-phase={phase}
      role="status"
    >
      <AppBreathingIndicator />
      <span>{label}</span>
    </div>
  )
}

function FeedBottomClearance() {
  return <div className="unified-message-feed__bottom-clearance" aria-hidden="true" />
}

function LiveToolActivityRow({
  row,
}: {
  row: Extract<MessageFeedDisplayRow, { type: 'activity_group' }>
}) {
  return (
    <div className="unified-feed-live-activity">
      <div className="unified-feed-live-activity__entries">
        {row.entries.map((entry) =>
          entry.type === 'tool_block' ? (
            <ToolActivityEntry key={entry.id} entry={entry} isLive />
          ) : (
            <StatusActivityEntry key={entry.id} item={entry.item} />
          ),
        )}
      </div>
    </div>
  )
}

function ActivityGroupRow({
  row,
  expanded,
  onToggle,
}: {
  row: Extract<MessageFeedDisplayRow, { type: 'activity_group' }>
  expanded: boolean
  onToggle: (expanded: boolean) => void
}) {
  const summary = summarizeActivityGroup(row.entries)
  const hasErrors = row.entries.some((entry) =>
    entry.type === 'tool_block'
      ? entry.call?.kind === 'error' || entry.result?.kind === 'error'
      : entry.item.kind === 'error',
  )

  return (
    <AppDisclosure
      className={cn('unified-feed-activity', hasErrors && 'error')}
      isExpanded={expanded}
      onExpandedChange={onToggle}
      bodyClassName="unified-feed-activity__entries"
      summary={
        <span className="unified-feed-activity__summary">
          {expanded ? <ChevronDown /> : <ChevronRight />}
          <span>{summary}</span>
        </span>
      }
    >
      {row.entries.map((entry) =>
        entry.type === 'tool_block' ? (
          <ToolActivityEntry key={entry.id} entry={entry} />
        ) : (
          <StatusActivityEntry key={entry.id} item={entry.item} />
        ),
      )}
    </AppDisclosure>
  )
}

function ToolActivityEntry({
  entry,
  isLive = false,
}: {
  entry: Extract<MessageFeedActivityEntry, { type: 'tool_block' }>
  isLive?: boolean
}) {
  const toolName = entry.call?.toolName ?? entry.result?.toolName
  const pending = isLive && entry.call?.pending === true && !entry.result
  const failed = entry.result?.kind === 'error'
  const toolHeader = toolName === 'command' ? 'Command' : toolName ? `Tool · ${toolName}` : 'Tool'
  const callText = entry.call?.text.trim()
  const resultText = entry.result?.text.trim()

  if (toolName === 'command') {
    return (
      <CommandActivityEntry
        commandText={commandTextFromToolSummary(callText)}
        resultText={resultText}
        pending={pending}
        failed={failed}
      />
    )
  }

  return (
    <AppDisclosure
      className={cn('unified-feed-command', failed && 'error')}
      summary={
        <>
          <ChevronRight className="unified-feed-command__chevron" />
          <span className="unified-feed-command__line">
            <strong>{toolHeader}</strong>
            {callText && <code>{callText.split('\n')[0]}</code>}
          </span>
        </>
      }
    >
      <div className="unified-feed-command__body">
        {callText ? (
          <div>
            <span>Call</span>
            <pre>{callText}</pre>
          </div>
        ) : null}
        <div>
          <span>Result</span>
          {resultText ? (
            <pre className="unified-feed-command__result">{resultText}</pre>
          ) : pending ? (
            <p>Waiting for tool result…</p>
          ) : (
            <p>No tool result was recorded.</p>
          )}
        </div>
      </div>
    </AppDisclosure>
  )
}

function CommandActivityEntry({
  commandText,
  resultText,
  pending,
  failed,
}: {
  commandText: string
  resultText?: string
  pending: boolean
  failed: boolean
}) {
  return (
    <AppDisclosure
      className={cn('unified-feed-command', failed && 'error')}
      summary={
        <>
          <ChevronRight className="unified-feed-command__chevron" />
          <span className="unified-feed-command__line">
            <strong>{pending ? 'Running' : failed ? 'Failed' : 'Ran'}</strong>
            <code title={commandText || 'Command'}>{commandText || 'Command'}</code>
          </span>
        </>
      }
      bodyClassName="unified-feed-command__body"
    >
      {commandText ? (
        <div>
          <span>Command</span>
          <pre>{commandText}</pre>
        </div>
      ) : null}
      <div>
        <span>{failed ? 'Error' : 'Output'}</span>
        {resultText ? (
          <pre className="unified-feed-command__result">{resultText}</pre>
        ) : (
          <p>{pending ? 'Waiting for command output…' : 'No command output was recorded.'}</p>
        )}
      </div>
    </AppDisclosure>
  )
}

function StatusActivityEntry({ item }: { item: MessageFeedItem }) {
  return (
    <div className={cn('unified-feed-status', item.kind === 'error' && 'error')}>
      <p>{item.text}</p>
    </div>
  )
}

function formatFeedTimestamp(timestamp: string) {
  return FEED_TIME_FORMATTER.format(new Date(timestamp))
}

function FeedHistoryHeader({ context }: { context: FeedVirtuosoContext }) {
  if (!context.hasMoreBefore && !context.isLoadingOlder) return null
  return (
    <div className="unified-message-feed__history-status">
      {context.isLoadingOlder ? (
        <>
          <AppSpinner size="sm" /> Loading older messages…
        </>
      ) : (
        'Scroll up for older messages'
      )}
    </div>
  )
}
