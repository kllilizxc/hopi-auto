import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowLeft, Bot, ImagePlus, RefreshCw, Send, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import {
  type AppSnapshot,
  type AssistantFeedEntry,
  type AttentionView,
  type ReflectionRunSummary,
  type RunAttemptEvent,
  readAssistantFeed,
  readReflectionRunEvents,
  readReflectionRuns,
  sendInboxMessage,
} from '../lib/api'
import { resolveAssistantInboxContext } from '../lib/assistantContext'
import type { GoalScope } from '../lib/goalScope'
import { assistantFeedEntriesToMessageFeed, runEventsToMessageFeed } from '../lib/messageFeed'
import { useInfiniteMessageStream } from '../lib/useInfiniteMessageStream'
import { cn, formatTime } from '../lib/utils'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'
import {
  AppAlert,
  AppButton,
  AppDisclosure,
  AppScrollShadow,
  AppSpinner,
  AppTextArea,
  IconButton,
  WorkingIndicator,
} from './ui'

interface AssistantPanelProps {
  docked?: boolean
  focusRequest?: number
  initialReply: AttentionView | null
  isOpen: boolean
  scope: GoalScope | null
  snapshot?: AppSnapshot
  onClose: () => void
}

interface DraftImage {
  id: string
  file: File
  url: string
}

const MAX_DRAFT_IMAGES = 4
const MAX_DRAFT_IMAGE_BYTES = 10 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function AssistantPanel({
  docked = false,
  focusRequest = 0,
  initialReply,
  isOpen,
  scope,
  snapshot,
  onClose,
}: AssistantPanelProps) {
  const queryClient = useQueryClient()
  const [input, setInput] = useState('')
  const [draftImages, setDraftImages] = useState<DraftImage[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [replyAttention, setReplyAttention] = useState<AttentionView | null>(null)
  const [showReflectionDebug, setShowReflectionDebug] = useState(false)
  const [assistantScrolling, setAssistantScrolling] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftImagesRef = useRef<DraftImage[]>([])

  useEffect(() => {
    draftImagesRef.current = draftImages
  }, [draftImages])

  useEffect(
    () => () => {
      for (const image of draftImagesRef.current) URL.revokeObjectURL(image.url)
    },
    [],
  )

  useEffect(() => {
    if (focusRequest === 0) return
    setReplyAttention(initialReply)
    setShowReflectionDebug(false)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [focusRequest, initialReply])

  const assistantStream = useInfiniteMessageStream({
    streamKey: 'workspace-assistant',
    queryKey: ['assistant-feed'],
    readPage: readAssistantFeed,
    getItemId: assistantFeedEntryId,
    compareItems: compareAssistantFeedEntries,
    enabled: isOpen && !showReflectionDebug,
    refetchInterval: isOpen && !showReflectionDebug && !assistantScrolling ? 1_000 : false,
    historyPageSize: 10,
  })
  const reflectionStream = useInfiniteMessageStream({
    streamKey: 'reflection-runs',
    queryKey: ['reflection-runs'],
    readPage: readReflectionRuns,
    getItemId: reflectionRunId,
    compareItems: compareReflectionRuns,
    enabled: isOpen && showReflectionDebug,
    refetchInterval: isOpen && showReflectionDebug ? 1_000 : false,
    reportRefreshing: true,
  })
  const messages = useMemo(
    () => assistantFeedEntriesToMessageFeed(assistantStream.items),
    [assistantStream.items],
  )

  const sendMutation = useMutation({
    mutationFn: async () => {
      const draft = input.trim()
      if (!draft && draftImages.length === 0) throw new Error('Message is empty')
      return sendInboxMessage({
        content: draft,
        images: draftImages.map(({ file }) => file),
        context: resolveAssistantInboxContext(
          scope,
          replyAttention,
          snapshot?.attentions,
          snapshot?.home.homeId,
        ),
      })
    },
    onSuccess: async () => {
      setInput('')
      setDraftImages((current) => {
        for (const image of current) URL.revokeObjectURL(image.url)
        return []
      })
      setImageError(null)
      setReplyAttention(null)
      assistantStream.refresh()
      await queryClient.invalidateQueries({ queryKey: ['mvp-state'] })
    },
  })

  const handleSend = () => {
    if ((input.trim() || draftImages.length > 0) && !sendMutation.isPending) {
      sendMutation.mutate()
    }
  }

  const queueImages = (files: File[]) => {
    setImageError(null)
    const selected = files.filter((file) => file.type.startsWith('image/'))
    if (draftImages.length + selected.length > MAX_DRAFT_IMAGES) {
      setImageError(`Attach at most ${MAX_DRAFT_IMAGES} images per message.`)
      return
    }
    const unsupported = selected.find((file) => !ACCEPTED_IMAGE_TYPES.has(file.type))
    if (unsupported) {
      setImageError(`Unsupported image type: ${unsupported.type || unsupported.name}`)
      return
    }
    const oversized = selected.find((file) => file.size > MAX_DRAFT_IMAGE_BYTES)
    if (oversized) {
      setImageError(`${oversized.name || 'Image'} exceeds the 10 MB limit.`)
      return
    }
    setDraftImages((current) => [
      ...current,
      ...selected.map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      })),
    ])
  }

  const removeImage = (imageId: string) => {
    setDraftImages((current) => {
      const removed = current.find((image) => image.id === imageId)
      if (removed) URL.revokeObjectURL(removed.url)
      return current.filter((image) => image.id !== imageId)
    })
  }

  return (
    <section
      className={cn('assistant-drawer', isOpen && 'open', docked && 'docked')}
      aria-hidden={!isOpen}
    >
      <header className="assistant-header">
        <div>
          <span className={cn('assistant-avatar', showReflectionDebug && 'debug')}>
            {showReflectionDebug ? <Activity /> : <Bot />}
          </span>
          <span>
            <strong>{showReflectionDebug ? 'Reflection debug' : 'Assistant'}</strong>
            <small>{showReflectionDebug ? 'Runtime event stream' : 'Workspace conversation'}</small>
          </span>
        </div>
        <div className="assistant-header-actions">
          <IconButton
            className={cn('reflection-debug-button', showReflectionDebug && 'active')}
            type="button"
            onClick={() => setShowReflectionDebug((value) => !value)}
            aria-label={
              showReflectionDebug ? 'Back to Assistant conversation' : 'Open Reflection debug'
            }
            aria-pressed={showReflectionDebug}
            title={showReflectionDebug ? 'Back to conversation' : 'Reflection debug'}
          >
            {showReflectionDebug ? <ArrowLeft /> : <Activity />}
          </IconButton>
          {!docked && (
            <IconButton type="button" onClick={onClose} aria-label="Close assistant">
              <X />
            </IconButton>
          )}
        </div>
      </header>

      {showReflectionDebug ? (
        <ReflectionDebugPanel
          runs={reflectionStream.items}
          loading={reflectionStream.isLoading}
          error={reflectionStream.error}
          refreshing={reflectionStream.isRefreshing}
          hasMoreBefore={reflectionStream.hasMoreBefore}
          loadingOlder={reflectionStream.isLoadingOlder}
          onLoadOlder={reflectionStream.loadOlder}
          onRefresh={reflectionStream.refresh}
        />
      ) : (
        <>
      <div className="assistant-body">
        <UnifiedMessageFeed
          feedKey="workspace-assistant"
          items={messages}
          className="assistant-conversation-feed"
          ariaLabel="Workspace Assistant conversation"
          isLoading={assistantStream.isLoading}
          hasMoreBefore={assistantStream.hasMoreBefore}
          isLoadingOlder={assistantStream.isLoadingOlder}
          onLoadOlder={assistantStream.loadOlder}
          onScrollingChange={setAssistantScrolling}
              emptyState={
            <div className="conversation-empty">
              {assistantStream.error ? (
                <>
                  <Activity />
                  <strong>Conversation unavailable.</strong>
                  <p>{assistantStream.error.message}</p>
                </>
              ) : (
                <>
                  <Bot />
                  <strong>No ceremony.</strong>
                  <p>Describe an outcome, ask a question, or change the selected Goal.</p>
                </>
              )}
            </div>
              }
        />
      </div>

      <footer className="assistant-composer">
        {(sendMutation.error || imageError) && (
              <AppAlert className="inline-error">
                {sendMutation.error?.message ?? imageError}
              </AppAlert>
        )}
        {replyAttention && (
          <div className="composer-context">
            <AppButton variant="ghost" type="button" onClick={() => setReplyAttention(null)}>
              Responding to this request <X />
            </AppButton>
          </div>
        )}
        {draftImages.length > 0 && (
          <AppScrollShadow
            className="composer-images"
            orientation="horizontal"
            aria-label="Attached images"
          >
            {draftImages.map((image) => (
              <figure key={image.id}>
                <img src={image.url} alt={image.file.name || 'Pasted image'} />
                <IconButton
                  type="button"
                  aria-label={`Remove ${image.file.name || 'image'}`}
                  onClick={() => removeImage(image.id)}
                  disabled={sendMutation.isPending}
                >
                  <X />
                </IconButton>
              </figure>
            ))}
          </AppScrollShadow>
        )}
        <div className="composer-box">
          <input
            ref={fileInputRef}
            className="composer-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(event) => {
              queueImages(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <AppTextArea
            ref={composerRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const images = extractPastedImages(event.clipboardData)
              if (images.length > 0) queueImages(images)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            placeholder="Tell HOPI what should change…"
            rows={3}
          />
          <IconButton
            className="composer-image-button"
            type="button"
            disabled={sendMutation.isPending || draftImages.length >= MAX_DRAFT_IMAGES}
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach images"
            title="Attach images"
          >
            <ImagePlus />
          </IconButton>
          <IconButton
            className="send-button"
            type="button"
            disabled={(!input.trim() && draftImages.length === 0) || sendMutation.isPending}
            onClick={handleSend}
            aria-label="Send message"
          >
            {sendMutation.isPending ? <AppSpinner size="sm" /> : <Send />}
          </IconButton>
        </div>
        <small>Paste or attach up to 4 images · Enter to send</small>
      </footer>
        </>
      )}
    </section>
  )
}

function ReflectionDebugPanel({
  runs,
  loading,
  error,
  refreshing,
  hasMoreBefore,
  loadingOlder,
  onLoadOlder,
  onRefresh,
}: {
  runs: ReflectionRunSummary[]
  loading: boolean
  error: Error | null
  refreshing: boolean
  hasMoreBefore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onRefresh: () => void
}) {
  const [firstItemIndex, setFirstItemIndex] = useState(100_000)
  const previousRunsRef = useRef<{ firstId?: string; length: number }>({ length: 0 })

  useEffect(() => {
    const previous = previousRunsRef.current
    if (previous.length > 0 && runs.length > previous.length && previous.firstId) {
      const previousFirstIndex = runs.findIndex(
        (run) => run.manifest.reflectionId === previous.firstId,
      )
      if (previousFirstIndex > 0) {
        setFirstItemIndex((current) => current - previousFirstIndex)
      }
    }
    previousRunsRef.current = {
      firstId: runs[0]?.manifest.reflectionId,
      length: runs.length,
    }
  }, [runs])

  return (
    <section className="reflection-debug-panel" aria-label="Reflection debug stream">
      <div className="reflection-debug-toolbar">
        <div>
          <strong>Runtime reflections</strong>
          <small>Read-only · refreshes every second while open</small>
        </div>
        <IconButton type="button" onClick={onRefresh} aria-label="Refresh reflections">
          <RefreshCw className={cn(refreshing && 'spin')} />
        </IconButton>
      </div>

      {loading ? (
        <div className="reflection-debug-empty">
          <AppSpinner size="sm" /> Loading runtime stream
        </div>
      ) : error ? (
        <div className="reflection-debug-empty error">{error.message}</div>
      ) : runs.length === 0 ? (
        <div className="reflection-debug-empty">
          <Activity />
          <strong>No Reflection Runs yet</strong>
          <p>
            The startup snapshot is only a baseline. A semantic state change creates the first Run.
          </p>
        </div>
      ) : (
        <div className="reflection-run-list">
          <Virtuoso
            className="reflection-run-virtuoso"
            data={runs}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={Math.max(runs.length - 1, 0)}
            computeItemKey={(_, run) => run.manifest.reflectionId}
            followOutput="auto"
            atTopThreshold={48}
            startReached={() => {
              if (hasMoreBefore && !loadingOlder) onLoadOlder()
            }}
            increaseViewportBy={{ top: 220, bottom: 260 }}
            components={{
              Scroller: AppScrollShadow,
              Header: () =>
                hasMoreBefore || loadingOlder ? (
                  <div className="reflection-history-status">
                    {loadingOlder ? (
                      <>
                        <AppSpinner size="sm" /> Loading older Runs…
                      </>
                    ) : (
                      'Scroll up for older Runs'
                    )}
                  </div>
                ) : null,
            }}
            itemContent={(_, run) => (
              <div className="reflection-run-row">
                <ReflectionRun
                  run={run}
                  latest={run.manifest.reflectionId === runs.at(-1)?.manifest.reflectionId}
                />
              </div>
            )}
          />
        </div>
      )}
    </section>
  )
}

function ReflectionRun({ run, latest }: { run: ReflectionRunSummary; latest: boolean }) {
  const { manifest } = run
  const [open, setOpen] = useState(latest)
  const outcome =
    manifest.status === 'completed'
      ? manifest.handoffEventId
        ? { className: 'sent', label: 'Sent' }
        : { className: 'no-action', label: 'No action' }
      : { className: manifest.status, label: manifest.status }
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: `reflection:${manifest.reflectionId}`,
    queryKey: ['reflection-events', manifest.reflectionId],
    readPage: (input) => readReflectionRunEvents(manifest.reflectionId, input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: open,
    refetchInterval: open && manifest.status === 'running' ? 1_000 : false,
    tailPageSize: 200,
  })
  const messages = useMemo(
    () =>
      runEventsToMessageFeed(eventStream.items, {
        namespace: `reflection:${manifest.reflectionId}`,
        groupId: manifest.reflectionId,
        active: manifest.status === 'running',
      }),
    [eventStream.items, manifest.reflectionId, manifest.status],
  )
  return (
    <AppDisclosure
      className={cn('reflection-run', outcome.className)}
      isExpanded={open}
      onExpandedChange={setOpen}
      bodyClassName="reflection-run-body"
      summary={
        <>
        <span className="reflection-status-dot" />
        <span>
          <strong>{manifest.reflectionId}</strong>
          <small>{outcome.label}</small>
        </span>
        <time>{formatTime(manifest.startedAt)}</time>
        {manifest.status === 'running' && <WorkingIndicator />}
        </>
      }
    >
        <dl>
        <div>
          <dt>Digest</dt>
          <dd>{manifest.stateDigest.slice(0, 16)}</dd>
        </div>
        <div>
          <dt>Handoff</dt>
          <dd>{manifest.handoffEventId ?? 'none'}</dd>
        </div>
        </dl>
        {manifest.error && <p className="reflection-run-error">{manifest.error}</p>}
        <UnifiedMessageFeed
          feedKey={`reflection:${manifest.reflectionId}`}
          items={messages}
          density="compact"
          className="reflection-message-feed"
          ariaLabel={`Reflection ${manifest.reflectionId} event stream`}
          isLoading={eventStream.isLoading}
          hasMoreBefore={eventStream.hasMoreBefore}
          isLoadingOlder={eventStream.isLoadingOlder}
          onLoadOlder={eventStream.loadOlder}
          emptyState={<span className="reflection-event-empty">No normalized events recorded.</span>}
        />
        <AppDisclosure className="reflection-paths" summary="Local diagnostics">
          <code>{run.paths.transcript}</code>
          <code>{run.paths.prompt}</code>
          <code>{run.paths.events}</code>
        </AppDisclosure>
    </AppDisclosure>
  )
}

function assistantFeedEntryId(entry: AssistantFeedEntry) {
  return entry.id
}

function compareAssistantFeedEntries(left: AssistantFeedEntry, right: AssistantFeedEntry) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id)
}

function reflectionRunId(run: ReflectionRunSummary) {
  return run.manifest.reflectionId
}

function compareReflectionRuns(left: ReflectionRunSummary, right: ReflectionRunSummary) {
  return (
    left.manifest.startedAt.localeCompare(right.manifest.startedAt) ||
    left.manifest.reflectionId.localeCompare(right.manifest.reflectionId)
  )
}

function runEventId(event: { eventId: string }) {
  return event.eventId
}

function compareRunEvents(left: RunAttemptEvent, right: RunAttemptEvent) {
  if (left.streamIndex !== undefined && right.streamIndex !== undefined) {
    return left.streamIndex - right.streamIndex
  }
  return left.createdAt.localeCompare(right.createdAt) || left.eventId.localeCompare(right.eventId)
}

function extractPastedImages(clipboard: DataTransfer) {
  const itemImages = Array.from(clipboard.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  return itemImages.length > 0
    ? itemImages
    : Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'))
}
