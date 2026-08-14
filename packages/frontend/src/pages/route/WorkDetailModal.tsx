import { useQuery } from '@tanstack/react-query'
import { FileText, MessageSquareText, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { MessageFeedSkeleton } from '../../components/MessageFeedSkeleton'
import {
  AppAlert,
  AppBreathingIndicator,
  AppButton,
  AppDisclosure,
  AppModal,
  AppScrollShadow,
  AppTabs,
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
import { formatTime } from '../../lib/utils'

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
  const [pane, setPane] = useState<'activity' | 'contract'>('activity')
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
    enabled: Boolean(selected) && pane === 'activity',
    refetchInterval:
      pane === 'activity' && selected?.status === 'running'
        ? ACTIVE_STREAM_POLL_INTERVAL_MS
        : false,
    tailPageSize: 200,
  })
  const documentQuery = useQuery({
    queryKey: ['work-document', projectId, goalId, work.id, work.contractRevision],
    queryFn: () => readWorkDocument(projectId, goalId, work.id),
    enabled: pane === 'contract',
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
              <div>
                <span className="eyebrow">{workKindLabel(work)} · {work.id}</span>
                <AppModal.Heading>{work.title}</AppModal.Heading>
              </div>
              <AppModal.CloseTrigger className="icon-button" aria-label="Close Work detail">
                <X />
              </AppModal.CloseTrigger>
            </header>

            <div className="route-work-facts">
              <span><small>Status</small><strong>{workStateLabel(work.projection.state)}</strong></span>
              <span><small>Revision</small><strong>{work.contractRevision}</strong></span>
              <span><small>Runs</small><strong>{work.runAttemptCount}</strong></span>
              <span><small>Dependencies</small><strong>{work.dependsOn.length}</strong></span>
            </div>

            <AppTabs
              className="route-work-tabs"
              selectedKey={pane}
              onSelectionChange={(key) => setPane(String(key) as 'activity' | 'contract')}
            >
              <AppTabs.List aria-label="Work detail view">
                <AppTabs.Tab id="activity"><MessageSquareText /> Activity</AppTabs.Tab>
                <AppTabs.Tab id="contract"><FileText /> Contract</AppTabs.Tab>
              </AppTabs.List>
              <AppTabs.Panel id="activity">
                {pane === 'activity' ? (
                  <div className="route-work-activity">
                    <aside>
                      <header><strong>Runs</strong><CountBadge>{attempts.length}</CountBadge></header>
                      {attempts.length ? attempts.map((attempt, index) => (
                        <AppButton
                          className={attempt.runId === selected?.runId ? 'active' : undefined}
                          key={attempt.runId}
                          onClick={() => setSelectedRunId(attempt.runId)}
                          type="button"
                          variant="ghost"
                        >
                          <span><strong>Run {attempts.length - index}</strong><small>{formatTime(attempt.requestedAt)}</small></span>
                          <StatusChip size="sm">{attemptLabel(attempt)}</StatusChip>
                        </AppButton>
                      )) : <p>No Worker Run has been requested.</p>}
                    </aside>
                    <div className="route-work-stream">
                      {activityError ? (
                        <AppAlert>{activityError.message}</AppAlert>
                      ) : !selected ? (
                        <div className="route-work-empty">This Work has no Run evidence yet.</div>
                      ) : (
                        <>
                          <header className="route-run-heading">
                            <div><StatusChip size="sm">{attemptLabel(selected)}</StatusChip><code>{selected.runId}</code></div>
                            <small>{selected.execution ? `${selected.execution.transport}${selected.execution.model ? ` · ${selected.execution.model}` : ''}` : 'Worker'}</small>
                          </header>
                          {selected.reportMarkdown ? (
                            <section className="route-run-report"><small>Report</small><p>{selected.reportMarkdown}</p></section>
                          ) : null}
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
                              emptyState={<div className="route-work-empty">This Run predates live event capture.</div>}
                            />
                          </Suspense>
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </AppTabs.Panel>
              <AppTabs.Panel id="contract">
                {pane === 'contract' ? (
                  <AppScrollShadow className="route-work-contract">
                    {work.dependsOn.length > 0 ? <section><h3>Depends on</h3><p>{work.dependsOn.join(', ')}</p></section> : null}
                    {work.blockedBy ? <section><h3>Why it is waiting</h3><p>{work.blockedBy}</p></section> : null}
                    <section>
                      <h3>Canonical Work</h3>
                      {documentQuery.error ? <AppAlert>{documentQuery.error.message}</AppAlert> : documentQuery.isLoading ? <div className="route-work-empty"><AppBreathingIndicator /> Loading contract</div> : <pre>{documentQuery.data?.body ?? ''}</pre>}
                    </section>
                    {selected ? (
                      <section>
                        <h3>Selected Run instruction</h3>
                        <p>{selected.instructionMarkdown}</p>
                        {detailQuery.data?.runPrompt ? <AppDisclosure summary="Full staged prompt"><pre>{detailQuery.data.runPrompt}</pre></AppDisclosure> : null}
                      </section>
                    ) : null}
                  </AppScrollShadow>
                ) : null}
              </AppTabs.Panel>
            </AppTabs>
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
