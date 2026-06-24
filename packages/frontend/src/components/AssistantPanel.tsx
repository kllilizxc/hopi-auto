import { type ChangeEvent, type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, MessageSquare, Send, X } from 'lucide-react'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'
import { goalScopedQueryKey } from '../lib/goalScope'
import { useMessageFeed, mergeMessageFeedItems } from '../lib/messageFeed'
import { cn } from '../lib/utils'
import {
  appendGoalAssistantMessage,
  type GoalAssistantActionResult,
  type GoalAttachmentRef,
  openGoalAssistantFeedStream,
  readGoalAssistantFeed,
  runGoalAssistant,
  type MessageFeedItem,
  uploadGoalAssistantImages,
} from '../lib/api'

interface DraftAttachment {
  id: string
  fileName: string
  mediaType: string
  url: string
  status: 'uploading' | 'uploaded'
  attachmentRef?: GoalAttachmentRef
}

export interface AssistantPanelProactiveMessage {
  id: string
  content: string
  details?: string[]
  label?: string
  timestamp: string
}

interface AssistantPanelProps {
  goalKey: string
  projectKey?: string
  isOpen: boolean
  onClose: () => void
  proactiveMessage?: AssistantPanelProactiveMessage | null
}

function hasAssistantDecisionMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'request_decision' ||
      actionResult.kind === 'resolve_decisions' ||
      actionResult.kind === 'resolve_decision' ||
      actionResult.kind === 'record_answer' ||
      actionResult.kind === 'record_answers',
  )
}

function hasAssistantPlanningMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'request_planning' ||
      actionResult.kind === 'request_planning_batch' ||
      actionResult.kind === 'request_planning_workflows' ||
      ((actionResult.kind === 'resolve_decisions' ||
        actionResult.kind === 'resolve_decision' ||
        actionResult.kind === 'record_answer' ||
        actionResult.kind === 'record_answers') &&
        (actionResult.followThrough?.requestKeys.length ?? 0) > 0),
  )
}

function hasAssistantPreferenceMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'set_preference' ||
      actionResult.kind === 'record_preference' ||
      actionResult.kind === 'retire_preference' ||
      actionResult.kind === 'update_preference',
  )
}

export function AssistantPanel({
  goalKey,
  projectKey,
  isOpen,
  onClose,
  proactiveMessage,
}: AssistantPanelProps) {
  const [input, setInput] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<DraftAttachment[]>([])
  const [optimisticMessages, setOptimisticMessages] = useState<MessageFeedItem[]>([])
  const [statusMessages, setStatusMessages] = useState<MessageFeedItem[]>([])
  const [assistantPendingMessage, setAssistantPendingMessage] = useState<MessageFeedItem | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const draftAttachmentsRef = useRef<DraftAttachment[]>([])
  const queryClient = useQueryClient()
  const goalQueryKey = (key: string, ...rest: Array<string | number | null>) =>
    goalScopedQueryKey(key, goalKey, projectKey, ...rest)

  const loadFeedPage = useCallback(
    (before?: string) =>
      readGoalAssistantFeed(goalKey, {
        before,
        limit: 40,
        projectKey,
      }),
    [goalKey, projectKey],
  )
  const openFeedStream = useCallback(
    (after?: string) => openGoalAssistantFeedStream(goalKey, projectKey, after),
    [goalKey, projectKey],
  )

  const feed = useMessageFeed({
    enabled: isOpen && Boolean(goalKey),
    queryKey: goalQueryKey('assistant-feed'),
    loadPage: loadFeedPage,
    openStream: openFeedStream,
  })

  const uploadImagesMutation = useMutation({
    mutationFn: async (payload: { files: File[]; draftIds: string[] }) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }
      const result = await uploadGoalAssistantImages(goalKey, payload.files, projectKey)
      return {
        draftIds: payload.draftIds,
        attachments: result.attachments,
      }
    },
    onSuccess: ({ draftIds, attachments }) => {
      setDraftAttachments((current) =>
        current.map((attachment) => {
          const index = draftIds.indexOf(attachment.id)
          if (index === -1) {
            return attachment
          }

          const uploaded = attachments[index]
          if (!uploaded) {
            return attachment
          }

          revokeObjectUrlIfNeeded(attachment.url)
          return {
            ...attachment,
            fileName: uploaded.fileName,
            mediaType: uploaded.mediaType,
            url: goalAssetUrl(goalKey, uploaded.assetPath, projectKey),
            status: 'uploaded' as const,
            attachmentRef: uploaded,
          }
        }),
      )
    },
    onError: (_error, payload) => {
      setDraftAttachments((current) => {
        const removed = current.filter((attachment) => payload.draftIds.includes(attachment.id))
        for (const attachment of removed) {
          URL.revokeObjectURL(attachment.url)
        }
        return current.filter((attachment) => !payload.draftIds.includes(attachment.id))
      })
    },
  })

  const runAssistantMutation = useMutation({
    mutationFn: async (payload: {
      content: string
      attachments: GoalAttachmentRef[]
      optimisticId: string
    }) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      await appendGoalAssistantMessage(
        goalKey,
        {
          content: payload.content,
          attachments: payload.attachments,
        },
        projectKey,
      )

      setOptimisticMessages((current) =>
        current.filter((message) => message.id !== payload.optimisticId),
      )

      return runGoalAssistant(
        goalKey,
        {
          content: payload.content,
          attachments: payload.attachments,
          appendUserMessage: false,
        },
        projectKey,
      )
    },
    onSuccess: async (run) => {
      const actionResults = run.actionResults ?? []
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: goalQueryKey('automation') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('board') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-docs') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-runs') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-run-detail') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('planning-workflows') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('planning-workflow-detail') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('task-write-traces') }),
        queryClient.invalidateQueries({ queryKey: goalQueryKey('task-run-write-traces') }),
        ...(hasAssistantDecisionMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-decisions') })]
          : []),
        ...(hasAssistantPlanningMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: goalQueryKey('planning-requests') })]
          : []),
        ...(hasAssistantPreferenceMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: ['preferences'] })]
          : []),
      ])
      await Promise.all([
        queryClient.refetchQueries({ queryKey: goalQueryKey('automation') }),
        queryClient.refetchQueries({ queryKey: goalQueryKey('board') }),
      ])
    },
    onError: async (_error, payload) => {
      setOptimisticMessages((current) =>
        current.filter((message) => message.id !== payload.optimisticId),
      )
    },
    onSettled: () => {
      setAssistantPendingMessage(null)
    },
  })

  const readyAttachments = draftAttachments
    .map((attachment) => attachment.attachmentRef)
    .filter((attachment): attachment is GoalAttachmentRef => Boolean(attachment))
  const hasUploadingAttachments = draftAttachments.some(
    (attachment) => attachment.status === 'uploading',
  )
  const displayError = uploadImagesMutation.error ?? runAssistantMutation.error ?? feed.error

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments
  }, [draftAttachments])

  useEffect(
    () => () => {
      for (const attachment of draftAttachmentsRef.current) {
        revokeObjectUrlIfNeeded(attachment.url)
      }
    },
    [],
  )

  useEffect(() => {
    setStatusMessages([])
    setOptimisticMessages([])
    setAssistantPendingMessage(null)
  }, [goalKey, projectKey])

  useEffect(() => {
    if (!goalKey || !proactiveMessage) {
      return
    }

    setStatusMessages((current) => {
      if (current.some((message) => message.id === proactiveMessage.id)) {
        return current
      }

      return [
        ...current,
        {
          id: proactiveMessage.id,
          createdAt: proactiveMessage.timestamp,
          kind: 'system_message',
          role: 'assistant',
          label: proactiveMessage.label ?? 'Status update',
          text: proactiveMessage.content,
          details: proactiveMessage.details,
          collapsedByDefault: true,
        },
      ]
    })
  }, [goalKey, proactiveMessage])

  const queueDraftImages = (selected: File[]) => {
    if (selected.length === 0) {
      return
    }

    const nextDrafts = selected.map((image, index) => ({
      id: crypto.randomUUID(),
      fileName: getAttachmentDisplayName(image, index),
      mediaType: image.type,
      url: URL.createObjectURL(image),
      status: 'uploading' as const,
    }))
    setDraftAttachments((current) => [...current, ...nextDrafts])
    uploadImagesMutation.mutate({
      files: selected,
      draftIds: nextDrafts.map((draft) => draft.id),
    })
  }

  const handleImageSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? [])
    if (selected.length === 0) {
      return
    }
    queueDraftImages(selected)
    event.target.value = ''
  }

  const handleInputPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedImages = extractPastedImageFiles(event)
    if (pastedImages.length === 0) {
      return
    }

    const pastedText = event.clipboardData.getData('text/plain').trim()
    if (!pastedText) {
      event.preventDefault()
    }

    queueDraftImages(pastedImages)
  }

  const removePendingImage = (draftId: string) => {
    setDraftAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== draftId)
      const removed = current.find((attachment) => attachment.id === draftId)
      if (removed) {
        revokeObjectUrlIfNeeded(removed.url)
      }
      return next
    })
  }

  const handleRunAssistant = () => {
    const trimmed = input.trim()
    if (!trimmed || runAssistantMutation.isPending || hasUploadingAttachments) {
      return
    }

    const optimisticId = `optimistic-user:${crypto.randomUUID()}`
    const createdAt = new Date().toISOString()
    setOptimisticMessages((current) => [
      ...current,
      {
        id: optimisticId,
        createdAt,
        kind: 'user_message',
        role: 'user',
        text: trimmed,
        attachments: readyAttachments,
        collapsedByDefault: false,
      },
    ])
    setAssistantPendingMessage({
      id: `assistant-pending:${crypto.randomUUID()}`,
      createdAt: new Date(Date.parse(createdAt) + 1).toISOString(),
      kind: 'status',
      role: 'assistant',
      text: 'Assistant is working…',
      collapsedByDefault: true,
      pending: true,
      label: 'Assistant',
    })
    setInput('')
    setDraftAttachments((current) => {
      for (const attachment of current) {
        revokeObjectUrlIfNeeded(attachment.url)
      }
      return []
    })

    runAssistantMutation.mutate({
      content: trimmed,
      attachments: readyAttachments,
      optimisticId,
    })
  }

  const messages = useMemo(
    () =>
      mergeMessageFeedItems(
        feed.items,
        statusMessages,
        optimisticMessages,
        assistantPendingMessage ? [assistantPendingMessage] : [],
      ),
    [assistantPendingMessage, feed.items, optimisticMessages, statusMessages],
  )

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-[30rem] max-w-full transform flex-col border-l border-[#333] bg-[#1A1A1A] shadow-2xl transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="flex items-center justify-between border-b border-[#333] bg-[#141414] px-4 py-3">
        <div className="flex items-center gap-2 text-white">
          <MessageSquare className="h-4 w-4 text-purple-400" />
          <span className="font-medium">Goal Assistant</span>
          <span className="rounded-full border border-[#3a3a3a] bg-[#1d1d1d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {messages.length} entries
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 transition-colors hover:bg-[#333] hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 px-2 py-3">
        {displayError && (
          <div className="mx-2 mb-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {(displayError as Error).message}
          </div>
        )}

        <UnifiedMessageFeed
          goalKey={goalKey}
          projectKey={projectKey}
          items={messages}
          isLoading={feed.isLoading}
          hasMoreBefore={feed.hasMoreBefore}
          isLoadingOlder={feed.isFetchingOlder}
          onLoadOlder={() => {
            void feed.fetchOlder()
          }}
          emptyLabel={`The assistant thread is empty for ${goalKey}. Send a message to start.`}
        />
      </div>

      <div className="border-t border-[#333] bg-[#141414] p-4">
        {draftAttachments.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {draftAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#1d1d1d]"
              >
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  className={cn(
                    'h-24 w-full object-cover',
                    attachment.status === 'uploading' && 'opacity-60',
                  )}
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[11px] text-gray-300">{attachment.fileName}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
                      {attachment.status === 'uploading' ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Uploading
                        </>
                      ) : (
                        'Ready'
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingImage(attachment.id)}
                    className="rounded p-1 text-gray-500 transition-colors hover:bg-[#2a2a2a] hover:text-white"
                    title="Remove image"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={handleImageSelection}
          />
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handleInputPaste}
            onKeyDown={(event) => event.key === 'Enter' && handleRunAssistant()}
            placeholder="Ask assistant to plan, fix tasks, or paste images with a thread note..."
            className="w-full rounded-lg border border-[#444] bg-[#222] py-2.5 pr-10 pl-12 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={runAssistantMutation.isPending || uploadImagesMutation.isPending}
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded p-1.5 text-gray-400 transition-colors hover:text-white disabled:opacity-50"
            title="Attach images"
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleRunAssistant}
            disabled={!input.trim() || runAssistantMutation.isPending || hasUploadingAttachments}
            className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 text-purple-400 transition-colors hover:text-purple-300 disabled:opacity-50 disabled:hover:text-purple-400"
            title="Run assistant"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 text-[11px] text-gray-500">
          {uploadImagesMutation.isPending
            ? 'Uploading images. Send is available when uploads finish.'
            : 'Press Enter to run the assistant for this goal. Paste or attach images to send them with the current message.'}
        </div>
      </div>
    </div>
  )
}

function goalAssetUrl(goalKey: string, assetPath: string, projectKey?: string) {
  const encodedPath = assetPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')

  if (projectKey) {
    return `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/assets/${encodedPath}`
  }

  return `/api/goals/${encodeURIComponent(goalKey)}/assets/${encodedPath}`
}

function revokeObjectUrlIfNeeded(url: string) {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

function extractPastedImageFiles(event: ClipboardEvent<HTMLInputElement>) {
  const filesFromItems = Array.from(event.clipboardData.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))

  if (filesFromItems.length > 0) {
    return filesFromItems
  }

  return Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
}

function getAttachmentDisplayName(file: File, index: number) {
  const trimmed = file.name.trim()
  if (trimmed.length > 0) {
    return trimmed
  }

  const extension = mediaTypeToExtension(file.type)
  return `pasted-image-${index + 1}${extension ? `.${extension}` : ''}`
}

function mediaTypeToExtension(mediaType: string) {
  switch (mediaType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return ''
  }
}
