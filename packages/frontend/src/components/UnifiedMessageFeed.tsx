import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
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
  isLoading?: boolean
  hasMoreBefore?: boolean
  isLoadingOlder?: boolean
  onLoadOlder?: () => void
  mode?: 'scroll' | 'inline'
  density?: 'comfortable' | 'compact'
  className?: string
  ariaLabel?: string
  onScrollingChange?: (scrolling: boolean) => void
}

const INITIAL_FIRST_ITEM_INDEX = 100_000
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

const FEED_VIRTUOSO_COMPONENTS: Components<MessageFeedDisplayRow, FeedVirtuosoContext> = {
  Header: FeedHistoryHeader,
  Scroller: AppScrollShadow,
}

export const UnifiedMessageFeed = memo(function UnifiedMessageFeed({
  feedKey,
  items,
  emptyState,
  isLoading = false,
  hasMoreBefore = false,
  isLoadingOlder = false,
  onLoadOlder,
  mode = 'scroll',
  density = 'comfortable',
  className,
  ariaLabel = 'Message stream',
  onScrollingChange,
}: UnifiedMessageFeedProps) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [announceUpdates, setAnnounceUpdates] = useState(true)
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})
  const previousSnapshotRef = useRef<{ firstId?: string; lastId?: string; length: number }>({
    length: 0,
  })
  const displayRows = useMemo(() => buildMessageFeedRows(items), [items])

  useEffect(() => {
    setExpandedItems({})
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setIsAtBottom(true)
    previousSnapshotRef.current = { length: 0 }
  }, [feedKey])

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

  const renderRow = useCallback((row: MessageFeedDisplayRow) => {
    if (row.type === 'activity_group') {
      return (
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
      )
    }
    if (row.type === 'action_required') return <ActionRequiredRow item={row.item} />
    if (row.type === 'system_update') return <SystemUpdateRow item={row.item} />
    return <MessageRow item={row.item} />
  }, [expandedItems])
  const itemContent = useCallback(
    (_index: number, row: MessageFeedDisplayRow) => renderRow(row),
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

  if (isLoading && displayRows.length === 0) {
    return (
      <div className={rootClassName}>
        <div className="unified-message-feed__empty unified-message-feed__empty--loading">
          <AppSpinner size="sm" />
          <span>Loading messages…</span>
        </div>
      </div>
    )
  }

  if (displayRows.length === 0) {
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
          {displayRows.map((row) => (
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
        data={displayRows}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={Math.max(displayRows.length - 1, 0)}
        computeItemKey={(_, row) => row.id}
        followOutput={isAtBottom ? 'auto' : false}
        alignToBottom
        atTopThreshold={32}
        atBottomThreshold={96}
        atBottomStateChange={setIsAtBottom}
        isScrolling={onScrollingChange}
        startReached={() => {
          if (hasMoreBefore && !isLoadingOlder) onLoadOlder?.()
        }}
        increaseViewportBy={{ top: 240, bottom: 320 }}
        context={virtuosoContext}
        components={FEED_VIRTUOSO_COMPONENTS}
        itemContent={itemContent}
      />

      {!isAtBottom && (
        <AppButton
          variant="secondary"
          type="button"
          onClick={() =>
            virtuosoRef.current?.scrollToIndex({
              index: Math.max(displayRows.length - 1, 0),
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
    previous.isLoading !== next.isLoading ||
    previous.hasMoreBefore !== next.hasMoreBefore ||
    previous.isLoadingOlder !== next.isLoadingOlder ||
    previous.onLoadOlder !== next.onLoadOlder ||
    previous.mode !== next.mode ||
    previous.density !== next.density ||
    previous.className !== next.className ||
    previous.ariaLabel !== next.ariaLabel ||
    previous.onScrollingChange !== next.onScrollingChange
  ) {
    return false
  }

  // The empty-state node is commonly authored inline by the parent. Once the
  // stream has data it is not rendered, so its changing identity must not
  // invalidate the virtualized list while a composer or toolbar updates.
  return previous.items.length > 0 || previous.emptyState === next.emptyState
}

function MessageRow({ item }: { item: MessageFeedItem }) {
  const isUser = item.kind === 'user_message'
  return (
    <article className={cn('unified-feed-message-row', isUser ? 'user' : 'assistant')}>
      <div className="unified-feed-message">
        {isUser && item.text.trim() ? (
          <div className="unified-feed-message__bubble">{item.text}</div>
        ) : !isUser ? (
          <div className="unified-feed-message__text">{item.text}</div>
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
        {item.details && item.details.length > 0 ? (
          <div className="unified-feed-message__details">
            {item.details.map((detail, index) => (
              <span key={`${item.id}:detail:${index}`}>{detail}</span>
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
        <p>{item.text}</p>
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
        <p>{item.text}</p>
      </div>
    </article>
  )
}

function ActivityGroupRow({
  row,
  expanded,
  onToggle,
}: {
  row: Extract<MessageFeedDisplayRow, { type: 'activity_group' }>
  expanded: boolean
  onToggle: () => void
}) {
  const summary = summarizeActivityGroup(row.entries)
  const pendingStatus = row.entries.find(
    (entry): entry is Extract<MessageFeedActivityEntry, { type: 'activity_message' }> =>
      entry.type === 'activity_message' && entry.item.pending === true,
  )
  const hasPendingEntries = row.entries.some((entry) =>
    entry.type === 'tool_block'
      ? (entry.call?.pending === true && !entry.result) || entry.result?.pending === true
      : entry.item.pending === true,
  )
  const hasErrors = row.entries.some((entry) =>
    entry.type === 'tool_block'
      ? entry.call?.kind === 'error' || entry.result?.kind === 'error'
      : entry.item.kind === 'error',
  )

  if (row.entries.length === 1 && pendingStatus) {
    return (
      <div className="unified-feed-waiting" role="status" aria-live="polite">
        <AppBreathingIndicator />
        <span>{pendingStatus.item.text}</span>
      </div>
    )
  }

  return (
    <AppDisclosure
      className={cn('unified-feed-activity', hasErrors && 'error')}
      isExpanded={expanded}
      onExpandedChange={onToggle}
      bodyClassName="unified-feed-activity__entries"
      summary={
        <>
        <span className="unified-feed-activity__summary">
          {expanded ? <ChevronDown /> : <ChevronRight />}
          {hasPendingEntries ? <AppBreathingIndicator /> : null}
          <span>{summary}</span>
        </span>
        <time>{formatFeedTimestamp(row.latestCreatedAt)}</time>
        </>
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
}: {
  entry: Extract<MessageFeedActivityEntry, { type: 'tool_block' }>
}) {
  const toolName = entry.call?.toolName ?? entry.result?.toolName
  const pending = entry.call?.pending === true && !entry.result
  const failed = entry.result?.kind === 'error'
  const toolHeader = toolName === 'command' ? 'Command' : toolName ? `Tool · ${toolName}` : 'Tool'
  const callText = entry.call?.text.trim()
  const resultText = entry.result?.text.trim()

  if (toolName === 'command') {
    return (
      <CommandActivityEntry
        entry={entry}
        commandText={commandTextFromToolSummary(callText)}
        resultText={resultText}
        pending={pending}
        failed={failed}
      />
    )
  }

  return (
    <div className={cn('unified-feed-tool', failed && 'error')}>
      <header>
        <span>
          <strong>{toolHeader}</strong>
          {pending ? (
            <em>
              <WorkingIndicator label="Running" />
            </em>
          ) : null}
        </span>
        <time>{formatFeedTimestamp(entry.result?.createdAt ?? entry.createdAt)}</time>
      </header>
      {callText ? <pre>{callText}</pre> : null}
      {resultText ? (
        <pre className="unified-feed-tool__result">{resultText}</pre>
      ) : pending ? (
        <p>Waiting for tool result…</p>
      ) : (
        <p>No tool result was recorded.</p>
      )}
    </div>
  )
}

function CommandActivityEntry({
  entry,
  commandText,
  resultText,
  pending,
  failed,
}: {
  entry: Extract<MessageFeedActivityEntry, { type: 'tool_block' }>
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
          {pending ? <WorkingIndicator /> : null}
          <strong>{pending ? 'Running' : failed ? 'Failed' : 'Ran'}</strong>
          <code title={commandText || 'Command'}>{commandText || 'Command'}</code>
        </span>
        <time>{formatFeedTimestamp(entry.result?.createdAt ?? entry.createdAt)}</time>
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
      <header>
        <strong>{item.label ?? (item.kind === 'error' ? 'Error' : 'Status')}</strong>
        <time>{formatFeedTimestamp(item.createdAt)}</time>
      </header>
      <p>{item.text}</p>
      {item.details && item.details.length > 0 ? (
        <div>
          {item.details.map((detail, index) => (
            <span key={`${item.id}:status-detail:${index}`}>{detail}</span>
          ))}
        </div>
      ) : null}
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
