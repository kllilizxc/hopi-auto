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
                {workKindLabel(work)} <span className="eyebrow-id">{work.id}</span>
              </span>
              <h2>{work.title}</h2>
              <AppModal.CloseTrigger className="icon-button route-work-main__close" aria-label="Close Work detail">
                <X />
              </AppModal.CloseTrigger>
            </header>

            <div className="route-work-modal__body">
              <div className="route-work-meta-bar">
                <div className="route-work-meta-item">
                  <Activity /> <span>State:</span> <strong>{workStateLabel(work.projection.state)}</strong>
                </div>
                <div className="route-work-meta-item">
                  <BookOpen /> <span>Rev:</span> <strong>{work.contractRevision}</strong>
                </div>
                <div className="route-work-meta-item">
                  <Clock /> <span>Runs:</span> <strong>{attempts.length}</strong>
                </div>
                {work.blockedBy && (
                  <div className="route-work-meta-item">
                    <AlertTriangle className="text-warning-400" /> <span>Blocked by:</span> <strong>{work.blockedBy}</strong>
                  </div>
                )}
              </div>

              <div className="route-work-main-scroll">
                <div className="route-work-details-accordion">
                  <AppDisclosure summary="View Contract & Dependencies">
                    <div className="route-work-section" style={{ marginTop: 16 }}>
                      {documentQuery.isLoading ? <AppBreathingIndicator /> : <pre className="route-work-code">{documentQuery.data?.body ?? ''}</pre>}
                      {work.dependsOn.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <h3 style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>Dependencies</h3>
                          <p className="route-work-text">{work.dependsOn.join(', ')}</p>
                        </div>
                      )}
                    </div>
                  </AppDisclosure>
                </div>

                {attempts.length > 0 && (
                  <div className="route-work-run-selector">
                    <h3>Run History</h3>
                    <div className="route-work-run-list-compact">
                      {attempts.map((attempt, index) => (
                        <AppButton
                          key={attempt.runId}
                          className={cn('route-work-run-pill', attempt.runId === selected?.runId && 'active')}
                          onClick={() => setSelectedRunId(attempt.runId)}
                          type="button"
                          variant="ghost"
                        >
                          Run {attempts.length - index}
                          <StatusChip size="sm">{attemptLabel(attempt)}</StatusChip>
                        </AppButton>
                      ))}
                    </div>
                  </div>
                )}

                <div className="route-work-stream">
                  {selected && (
                    <div style={{ marginBottom: 24 }}>
                       <div className="route-work-run-meta" style={{ paddingBottom: 0, border: 'none', marginBottom: 12 }}>
                        <code>{selected.runId}</code>
                        <small>{selected.execution ? `${selected.execution.transport}${selected.execution.model ? ` · ${selected.execution.model}` : ''}` : 'Worker'}</small>
                      </div>
                      {selected.reportMarkdown && (
                        <div className="route-work-report">
                          <small>Final Report</small>
                          <p>{selected.reportMarkdown}</p>
                        </div>
                      )}
                    </div>
                  )}

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
              </div>
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
