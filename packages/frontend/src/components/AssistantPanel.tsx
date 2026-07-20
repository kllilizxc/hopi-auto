import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowLeft, Bot, ImagePlus, Send, X } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AppSnapshot,
  type AttentionView,
  readAssistantAttentions,
  sendInboxMessage,
} from '../lib/api'
import {
  type AssistantInboxContext,
  assistantAttentionReference,
  findAttentionNotificationEventId,
  findLatestNeedsYouGroupId,
  groupNeedsYouAttentions,
  isNeedsYouAttention,
  resolveAssistantInboxContext,
} from '../lib/assistantContext'
import type { GoalScope } from '../lib/goalScope'
import {
  type OptimisticInboxMessage,
  assistantFeedEntriesToMessageFeed,
  assistantFeedEventIds,
} from '../lib/messageFeed'
import {
  ACTIVE_STREAM_POLL_INTERVAL_MS,
  CANONICAL_POLL_INTERVAL_MS,
  STABLE_QUERY_NOTIFY_PROPS,
} from '../lib/queryPerformance'
import { useAssistantFeedStream } from '../lib/useAssistantFeedStream'
import { cn } from '../lib/utils'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'
import {
  AppAlert,
  AppButton,
  AppScrollShadow,
  AppSpinner,
  AppTextArea,
  CountBadge,
  IconButton,
} from './ui'

const ReflectionDebugPanel = lazy(() =>
  import('./ReflectionDebugPanel').then((module) => ({ default: module.ReflectionDebugPanel })),
)

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

interface OptimisticInboxSubmission extends OptimisticInboxMessage {
  images: DraftImage[]
  context: AssistantInboxContext | undefined
  replyAttentions: AttentionView[]
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
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticInboxSubmission[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [replyAttentions, setReplyAttentions] = useState<AttentionView[]>([])
  const [showReflectionDebug, setShowReflectionDebug] = useState(false)
  const [assistantScrolling, setAssistantScrolling] = useState(false)
  const [messageFocus, setMessageFocus] = useState<{
    source: 'external' | 'needs-you'
    request: number
  } | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftImagesRef = useRef<DraftImage[]>([])
  const optimisticMessagesRef = useRef<OptimisticInboxSubmission[]>([])
  const messageFocusSequenceRef = useRef(0)
  const attentionQuery = useQuery({
    queryKey: ['assistant-attentions'],
    queryFn: readAssistantAttentions,
    enabled: isOpen,
    refetchInterval: isOpen ? CANONICAL_POLL_INTERVAL_MS : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })

  useEffect(() => {
    draftImagesRef.current = draftImages
  }, [draftImages])

  useEffect(() => {
    optimisticMessagesRef.current = optimisticMessages
  }, [optimisticMessages])

  useEffect(
    () => () => {
      const images = [
        ...draftImagesRef.current,
        ...optimisticMessagesRef.current.flatMap((message) => message.images),
      ]
      for (const url of new Set(images.map((image) => image.url))) URL.revokeObjectURL(url)
    },
    [],
  )

  useEffect(() => {
    if (focusRequest === 0) return
    setReplyAttentions(initialReply ? [initialReply] : [])
    setShowReflectionDebug(false)
    setMessageFocus({
      source: 'external',
      request: ++messageFocusSequenceRef.current,
    })
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [focusRequest, initialReply])

  const assistantStream = useAssistantFeedStream({
    enabled: isOpen && !showReflectionDebug,
    refetchInterval:
      isOpen && !showReflectionDebug && !assistantScrolling
        ? ACTIVE_STREAM_POLL_INTERVAL_MS
        : false,
    historyPageSize: 10,
  })
  const canonicalEventIds = useMemo(
    () => assistantFeedEventIds(assistantStream.items),
    [assistantStream.items],
  )
  const messages = useMemo(
    () => assistantFeedEntriesToMessageFeed(assistantStream.items, optimisticMessages),
    [assistantStream.items, optimisticMessages],
  )

  useEffect(() => {
    setOptimisticMessages((current) => {
      const confirmed = current.filter(
        (message) => message.eventId && canonicalEventIds.has(message.eventId),
      )
      if (confirmed.length === 0) return current
      for (const message of confirmed) {
        for (const image of message.images) URL.revokeObjectURL(image.url)
      }
      return current.filter(
        (message) => !message.eventId || !canonicalEventIds.has(message.eventId),
      )
    })
  }, [canonicalEventIds])
  const needsYouAttentions = useMemo(
    () => (attentionQuery.data?.attentions ?? []).filter(isNeedsYouAttention),
    [attentionQuery.data?.attentions],
  )
  const needsYouAttentionsByGroupId = useMemo(
    () => groupNeedsYouAttentions(assistantStream.items, needsYouAttentions, snapshot?.home.homeId),
    [assistantStream.items, needsYouAttentions, snapshot?.home.homeId],
  )
  const needsYouByGroupId = useMemo(
    () =>
      new Map(
        [...needsYouAttentionsByGroupId].map(([groupId, attentions]) => [
          groupId,
          attentions.length,
        ]),
      ),
    [needsYouAttentionsByGroupId],
  )
  const latestNeedsYouGroupId = useMemo(
    () => findLatestNeedsYouGroupId(messages, needsYouByGroupId),
    [messages, needsYouByGroupId],
  )
  const mappedNeedsYouCount = [...needsYouAttentionsByGroupId.values()].reduce(
    (total, attentions) => total + attentions.length,
    0,
  )
  const attentionNotificationEventId = useMemo(
    () =>
      initialReply?.operatorRequest
        ? findAttentionNotificationEventId(
            assistantStream.items,
            initialReply,
            snapshot?.home.homeId,
          )
        : null,
    [assistantStream.items, initialReply, snapshot?.home.homeId],
  )

  useEffect(() => {
    const initialNotificationMissing = Boolean(
      initialReply?.operatorRequest && !attentionNotificationEventId,
    )
    const needsYouNotificationMissing = mappedNeedsYouCount < needsYouAttentions.length
    if (
      (!initialNotificationMissing && !needsYouNotificationMissing) ||
      !assistantStream.hasMoreBefore ||
      assistantStream.isLoadingOlder
    ) {
      return
    }
    assistantStream.loadOlder()
  }, [
    assistantStream.hasMoreBefore,
    assistantStream.isLoadingOlder,
    assistantStream.loadOlder,
    attentionNotificationEventId,
    initialReply?.operatorRequest,
    mappedNeedsYouCount,
    needsYouAttentions.length,
  ])

  useEffect(() => {
    if (!snapshot || !attentionQuery.data || replyAttentions.length === 0) return
    const openReferences = new Set(
      attentionQuery.data.attentions.flatMap((attention) => {
        if (attention.resolvedAt !== null) return []
        const reference = assistantAttentionReference(attention, snapshot.home.homeId)
        return reference ? [reference] : []
      }),
    )
    setReplyAttentions((current) => {
      const next = current.filter((attention) => {
        const reference = assistantAttentionReference(attention, snapshot.home.homeId)
        return Boolean(reference && openReferences.has(reference))
      })
      return next.length === current.length ? current : next
    })
  }, [attentionQuery.data, replyAttentions.length, snapshot])

  const replyToNeedsYouMessage = useCallback(
    (groupId: string) => {
      const attentions = needsYouAttentionsByGroupId.get(groupId)
      if (!attentions?.length) return
      setReplyAttentions(attentions)
      requestAnimationFrame(() => composerRef.current?.focus())
    },
    [needsYouAttentionsByGroupId],
  )
  const focusLatestNeedsYouMessage = useCallback(() => {
    setShowReflectionDebug(false)
    setMessageFocus({
      source: 'needs-you',
      request: ++messageFocusSequenceRef.current,
    })
  }, [])

  const sendMutation = useMutation({
    mutationFn: (submission: OptimisticInboxSubmission) =>
      sendInboxMessage({
        content: submission.text,
        images: submission.images.map(({ file }) => file),
        context: submission.context,
      }),
    onSuccess: (result, submission) => {
      setOptimisticMessages((current) =>
        current.map((message) =>
          message.clientId === submission.clientId
            ? { ...message, eventId: result.eventId }
            : message,
        ),
      )
      assistantStream.refresh()
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mvp-state'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-attentions'] }),
      ])
    },
    onError: (_error, submission) => {
      setOptimisticMessages((current) =>
        current.filter((message) => message.clientId !== submission.clientId),
      )
      setInput((current) =>
        current.trim() ? `${submission.text}\n\n${current}` : submission.text,
      )
      setDraftImages((current) => [...submission.images, ...current])
      setReplyAttentions((current) =>
        current.length > 0 ? current : submission.replyAttentions,
      )
    },
  })

  const handleSend = () => {
    if ((input.trim() || draftImages.length > 0) && !sendMutation.isPending) {
      const text = input.trim()
      const clientId = crypto.randomUUID()
      const images = draftImages
      const submission: OptimisticInboxSubmission = {
        clientId,
        createdAt: new Date().toISOString(),
        text,
        eventId: null,
        attachments: images.map((image) => ({
          reference: `optimistic:${clientId}:${image.id}`,
          fileName: image.file.name || 'Attached image',
          url: image.url,
        })),
        images,
        context: resolveAssistantInboxContext(
          scope,
          replyAttentions,
          attentionQuery.data?.attentions,
          snapshot?.home.homeId,
        ),
        replyAttentions,
      }
      setOptimisticMessages((current) => [...current, submission])
      setInput('')
      setDraftImages([])
      setImageError(null)
      setReplyAttentions([])
      sendMutation.mutate(submission)
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
      <div
        className={cn('assistant-corner-chrome', showReflectionDebug && 'reflection-open')}
        aria-label="Assistant controls"
      >
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
        {!showReflectionDebug && needsYouAttentions.length > 0 ? (
          <AppButton
            className="assistant-needs-you-jump"
            variant="ghost"
            type="button"
            onClick={focusLatestNeedsYouMessage}
            aria-label={`Jump to newest of ${needsYouAttentions.length} requests needing your reply`}
            title="Jump to newest request"
          >
            <CountBadge className="assistant-needs-you-count" color="warning">
              {needsYouAttentions.length}
            </CountBadge>
          </AppButton>
        ) : null}
        {!docked && (
          <IconButton type="button" onClick={onClose} aria-label="Close assistant">
            <X />
          </IconButton>
        )}
      </div>

      {showReflectionDebug ? (
        <Suspense
          fallback={
            <div className="reflection-debug-empty">
              <AppSpinner size="sm" /> Loading runtime stream
            </div>
          }
        >
          <ReflectionDebugPanel enabled={isOpen} />
        </Suspense>
      ) : (
        <>
          <div className="assistant-body">
            <UnifiedMessageFeed
              feedKey="workspace-assistant"
              items={messages}
              tailActivity={assistantStream.activity?.phase ?? null}
              className="assistant-conversation-feed"
              ariaLabel="Workspace Assistant conversation"
              isLoading={assistantStream.isLoading}
              hasMoreBefore={assistantStream.hasMoreBefore}
              isLoadingOlder={assistantStream.isLoadingOlder}
              onLoadOlder={assistantStream.loadOlder}
              onScrollingChange={setAssistantScrolling}
              focusGroupId={
                messageFocus?.source === 'needs-you'
                  ? latestNeedsYouGroupId
                  : attentionNotificationEventId
                    ? `inbox:${attentionNotificationEventId}`
                    : null
              }
              focusRequest={messageFocus?.request ?? 0}
              needsYouByGroupId={needsYouByGroupId}
              onReplyNeedsYou={replyToNeedsYouMessage}
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
            {replyAttentions.length > 0 && (
              <div className="composer-context">
                <span>
                  Replying to{' '}
                  {replyAttentions.length === 1
                    ? 'this request'
                    : `${replyAttentions.length} requests`}
                </span>
                <IconButton
                  className="composer-context__dismiss"
                  type="button"
                  onClick={() => setReplyAttentions([])}
                  aria-label="Clear reply context"
                  title="Clear reply context"
                >
                  <X />
                </IconButton>
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

function extractPastedImages(clipboard: DataTransfer) {
  const itemImages = Array.from(clipboard.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  return itemImages.length > 0
    ? itemImages
    : Array.from(clipboard.files).filter((file) => file.type.startsWith('image/'))
}
