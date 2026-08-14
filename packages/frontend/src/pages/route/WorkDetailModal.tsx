import { useQuery } from '@tanstack/react-query'
import { Activity, BookOpen, Clock, AlertTriangle, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { MessageFeedSkeleton } from '../../components/MessageFeedSkeleton'
import {
  AppAlert,
  AppBreathingIndicator,
  AppButton,
  AppDisclosure,
  AppModal,
  AppScrollShadow,
  CountBadge,
  StatusChip,
} from '../../components/ui'
import {
  type RunAttemptEvent,
  type RunAttemptSummary,
  type WorkRouteView,
  readWorkAttempt,
  readWorkAttemptEvents,
  readWorkAttempts,
  readWorkDocument,
} from '../../lib/api'
import { runEventsToMessageFeed } from '../../lib/messageFeed'
import { ACTIVE_STREAM_POLL_INTERVAL_MS, STABLE_QUERY_NOTIFY_PROPS } from '../../lib/queryPerformance'
import { workAttemptEventsQueryKey, workAttemptsQueryKey } from '../../lib/queryKeys'
import { useInfiniteMessageStream } from '../../lib/useInfiniteMessageStream'
import { formatTime, cn } from '../../lib/utils'

const UnifiedMessageFeed = lazy(() =>
  import('../../components/UnifiedMessageFeed').then((module) => ({
    default: module.UnifiedMessageFeed,
  })),
)

export function WorkDetailModal({
  projectId,
  goalId,
  work,
  onClose,
}: {
  projectId: string
  goalId: string
  work: WorkRouteView
  onClose: () => void
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const attemptsQuery = useQuery({
    queryKey: workAttemptsQueryKey(projectId, goalId, work.id),
    queryFn: () => readWorkAttempts(projectId, goalId, work.id),
    refetchInterval: work.status === 'open' ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const attempts = attemptsQuery.data?.attempts ?? []
  const selected = attempts.find((attempt) => attempt.runId === selectedRunId) ?? attempts[0] ?? null
  useEffect(() => {
    if (!selectedRunId && attempts[0]) setSelectedRunId(attempts[0].runId)
  }, [attempts, selectedRunId])

  const detailQuery = useQuery({
    queryKey: ['work-attempt', projectId, goalId, work.id, selected?.runId],
    queryFn: () => readWorkAttempt(projectId, goalId, work.id, selected?.runId ?? ''),
    enabled: Boolean(selected),
    refetchInterval: selected?.status === 'running' ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: selected?.runId ?? 'no-run',
    queryKey: workAttemptEventsQueryKey(projectId, goalId, work.id, selected?.runId ?? null),
    readPage: (input) =>
      readWorkAttemptEvents(projectId, goalId, work.id, selected?.runId ?? '', input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: Boolean(selected),
    refetchInterval:
      selected?.status === 'running'
        ? ACTIVE_STREAM_POLL_INTERVAL_MS
        : false,
    tailPageSize: 200,
  })
  const documentQuery = useQuery({
    queryKey: ['work-document', projectId, goalId, work.id, work.contractRevision],
    queryFn: () => readWorkDocument(projectId, goalId, work.id),
    staleTime: Number.POSITIVE_INFINITY,
    notifyOnChangeProps: STABLE_QUERY_NOTIFY_PROPS,
  })
  const messages = useMemo(() => {
    if (!selected) return []
    const groupId = `attempt:${selected.runId}`
    return runEventsToMessageFeed(eventStream.items, {
      namespace: groupId,
      groupId,
      active: selected.status === 'running',
    })
  }, [eventStream.items, selected])
  const activityError = attemptsQuery.error ?? eventStream.error

  return (
    <AppModal isOpen onOpenChange={(open) => !open && onClose()}>
      <AppModal.Backdrop className="modal-backdrop" isDismissable variant="blur">
        <AppModal.Container className="route-work-modal-container" placement="center" scroll="inside" size="cover">
          <AppModal.Dialog className="route-work-modal" aria-label={work.title}>
            <header className="route-work-modal__header">
              <span className="eyebrow">
                {workKindLabel(work)} · <span className="eyebrow-id">{work.id}</span>
              </span>
              <h2>{work.title}</h2>
              <AppModal.CloseTrigger className="icon-button route-work-main__close" aria-label="Close Work detail">
                <X />
              </AppModal.CloseTrigger>
            </header>

            <div className="route-work-modal__body">
              <aside className="route-work-sidebar">
                <AppScrollShadow className="route-work-sidebar__scroll">
                  <section className="route-work-section">
                    <header className="route-work-section-header">
                      <h3>STATUS</h3>
                    </header>
                    <div className="route-work-facts-grid">
                      <div className="route-work-fact"><small>Current State</small><strong>{workStateLabel(work.projection.state)}</strong></div>
                      <div className="route-work-fact"><small>Revision</small><strong>{work.contractRevision}</strong></div>
                    </div>
                    {work.blockedBy && <AppAlert className="compact-alert">Blocked: {work.blockedBy}</AppAlert>}
                  </section>

                  {attempts.length > 0 && (
                    <section className="route-work-section">
                      <header className="route-work-section-header">
                        <h3>Runs</h3>
                        <CountBadge>{attempts.length}</CountBadge>
                      </header>
                      <div className="route-work-run-list">
                        {attempts.map((attempt, index) => (
                          <AppButton
                            className={cn('route-work-run-item', attempt.runId === selected?.runId && 'active')}
                            key={attempt.runId}
                            onClick={() => setSelectedRunId(attempt.runId)}
                            type="button"
                            variant="ghost"
                          >
                            <div className="route-work-run-item-info">
                              <strong>Run {attempts.length - index}</strong>
                              <small>{formatTime(attempt.requestedAt)}</small>
                            </div>
                            <StatusChip size="sm">{attemptLabel(attempt)}</StatusChip>
                          </AppButton>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="route-work-section">
                    <header className="route-work-section-header">
                      <h3><BookOpen /> Contract</h3>
                    </header>
                    <AppDisclosure summary="View Canonical Work">
                      {documentQuery.isLoading ? <AppBreathingIndicator /> : <pre className="route-work-code">{documentQuery.data?.body ?? ''}</pre>}
                    </AppDisclosure>
                    {work.dependsOn.length > 0 && (
                      <AppDisclosure summary="Dependencies">
                        <p className="route-work-text">{work.dependsOn.join(', ')}</p>
                      </AppDisclosure>
                    )}
                  </section>

                  {selected && (
                    <section className="route-work-section route-work-section--highlight">
                      <header className="route-work-section-header">
                        <h3>Run Details</h3>
                      </header>
                      <div className="route-work-run-meta">
                        <code>{selected.runId}</code>
                        <small>{selected.execution ? `${selected.execution.transport}${selected.execution.model ? ` · ${selected.execution.model}` : ''}` : 'Worker'}</small>
                      </div>
                      {selected.reportMarkdown && (
                        <div className="route-work-report">
                          <small>Report</small>
                          <p>{selected.reportMarkdown}</p>
                        </div>
                      )}
                      {selected.instructionMarkdown && (
                        <AppDisclosure summary="Run Instruction">
                          <p className="route-work-text">{selected.instructionMarkdown}</p>
                        </AppDisclosure>
                      )}
                      {detailQuery.data?.runPrompt && (
                        <AppDisclosure summary="Full Staged Prompt">
                          <pre className="route-work-code">{detailQuery.data.runPrompt}</pre>
                        </AppDisclosure>
                      )}
                    </section>
                  )}
                </AppScrollShadow>
              </aside>

              <main className="route-work-main">
                <div className="route-work-stream">
                  {activityError ? (
                    <div className="route-work-stream-center"><AppAlert>{activityError.message}</AppAlert></div>
                  ) : !selected ? (
                    <div className="route-work-stream-center"><AlertTriangle /> This Work has no Run evidence yet.</div>
                  ) : (
                    <Suspense fallback={<MessageFeedSkeleton density="compact" />}>
                      <UnifiedMessageFeed
                        feedKey={`attempt:${selected.runId}`}
                        items={messages}
                        tailActivity={selected.status === 'running' ? 'working' : null}
                        density="compact"
                        className="attempt-message-feed"
                        ariaLabel={`Run ${selected.runId} message stream`}
                        isLoading={eventStream.isLoading}
                        hasMoreBefore={eventStream.hasMoreBefore}
                        isLoadingOlder={eventStream.isLoadingOlder}
                        onLoadOlder={eventStream.loadOlder}
                        emptyState={<div className="route-work-stream-center">This Run predates live event capture.</div>}
                      />
                    </Suspense>
                  )}
                </div>
              </main>
            </div>
          </AppModal.Dialog>
        </AppModal.Container>
      </AppModal.Backdrop>
    </AppModal>
  )
}

function runEventId(event: { eventId: string }) {
  return event.eventId
}

function compareRunEvents(left: RunAttemptEvent, right: RunAttemptEvent) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.eventId.localeCompare(right.eventId)
  )
}

function attemptLabel(attempt: RunAttemptSummary) {
  if (attempt.status !== 'settled') return attempt.status
  return attempt.termination ?? 'settled'
}

function workKindLabel(work: WorkRouteView) {
  if (work.kind === 'engineering') return 'Engineering Work'
  return `${work.decisionType ?? 'Decision'} Decision`
}

export function workStateLabel(state: WorkRouteView['projection']['state']) {
  return {
    done: 'Done', cancelled: 'Cancelled', needs_user: 'Needs you', running: 'HOPI is working',
    queued: 'Queued', scheduled: 'Scheduled', waiting_assistant: 'HOPI is deciding',
    blocked: 'Waiting for prerequisites', ready: 'Ready now',
  }[state]
}

export function workSummary(work: WorkRouteView) {
  if (work.blockedBy) return `Waiting for ${work.blockedBy}`
  if (work.activeAttempt?.status === 'queued' && work.activeAttempt.waitReason === 'capacity') return 'Waiting for Worker capacity'
  return work.kind === 'decision'
    ? `${work.decisionType ?? 'decision'} · ${work.runAttemptCount} Run${work.runAttemptCount === 1 ? '' : 's'}`
    : `${work.runAttemptCount} Run${work.runAttemptCount === 1 ? '' : 's'} · ${work.evidenceRefs.length} Evidence`
}
