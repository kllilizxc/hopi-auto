import { Activity } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import {
  type WakeRunSummary,
  type RunAttemptEvent,
  readWakeRunEvents,
  readWakeRuns,
} from '../lib/api'
import { runEventsToMessageFeed } from '../lib/messageFeed'
import { ACTIVE_STREAM_POLL_INTERVAL_MS } from '../lib/queryPerformance'
import { useInfiniteMessageStream } from '../lib/useInfiniteMessageStream'
import { cn, formatTime } from '../lib/utils'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'
import { AppDisclosure, AppScrollShadow, AppSpinner, WorkingIndicator } from './ui'

export function WakeDebugPanel({ enabled }: { enabled: boolean }) {
  const stream = useInfiniteMessageStream({
    streamKey: 'wake-runs',
    queryKey: ['wake-runs'],
    readPage: readWakeRuns,
    getItemId: wakeRunId,
    compareItems: compareWakeRuns,
    enabled,
    refetchInterval: enabled ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
    reportRefreshing: true,
  })
  const runs = stream.items
  const [firstItemIndex, setFirstItemIndex] = useState(100_000)
  const previousRunsRef = useRef<{ firstId?: string; length: number }>({
    length: 0,
  })

  useEffect(() => {
    const previous = previousRunsRef.current
    if (previous.length > 0 && runs.length > previous.length && previous.firstId) {
      const previousFirstIndex = runs.findIndex(
        (run) => run.manifest.wakeId === previous.firstId,
      )
      if (previousFirstIndex > 0) {
        setFirstItemIndex((current) => current - previousFirstIndex)
      }
    }
    previousRunsRef.current = {
      firstId: runs[0]?.manifest.wakeId,
      length: runs.length,
    }
  }, [runs])

  return (
    <section className="wake-debug-panel" aria-label="Wake debug stream">
      {stream.isLoading ? (
        <div className="wake-debug-empty">
          <AppSpinner size="sm" /> Loading runtime stream
        </div>
      ) : stream.error ? (
        <div className="wake-debug-empty error">{stream.error.message}</div>
      ) : runs.length === 0 ? (
        <div className="wake-debug-empty">
          <Activity />
          <strong>No Wake Runs yet</strong>
          <p>
            The startup snapshot is only a baseline. A semantic state change creates the first Run.
          </p>
        </div>
      ) : (
        <div className="wake-run-list">
          <Virtuoso
            className="wake-run-virtuoso"
            data={runs}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={Math.max(runs.length - 1, 0)}
            computeItemKey={(_, run) => run.manifest.wakeId}
            followOutput="auto"
            atTopThreshold={48}
            startReached={() => {
              if (stream.hasMoreBefore && !stream.isLoadingOlder) stream.loadOlder()
            }}
            increaseViewportBy={{ top: 220, bottom: 260 }}
            components={{
              Scroller: AppScrollShadow,
              Header: () =>
                stream.hasMoreBefore || stream.isLoadingOlder ? (
                  <div className="wake-history-status">
                    {stream.isLoadingOlder ? (
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
              <div className="wake-run-row">
                <WakeRun
                  run={run}
                  latest={run.manifest.wakeId === runs.at(-1)?.manifest.wakeId}
                />
              </div>
            )}
          />
        </div>
      )}
    </section>
  )
}

function WakeRun({ run, latest }: { run: WakeRunSummary; latest: boolean }) {
  const { manifest } = run
  const [open, setOpen] = useState(latest)
  const outcome =
    manifest.status === 'completed'
      ? { className: 'sent', label: 'Sent' }
      : { className: manifest.status, label: manifest.status }
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: `wake:${manifest.wakeId}`,
    queryKey: ['wake-events', manifest.wakeId],
    readPage: (input) => readWakeRunEvents(manifest.wakeId, input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: open,
    refetchInterval: open && manifest.status === 'running' ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
    tailPageSize: 200,
  })
  const messages = useMemo(
    () =>
      runEventsToMessageFeed(eventStream.items, {
        namespace: `wake:${manifest.wakeId}`,
        groupId: manifest.wakeId,
        active: manifest.status === 'running',
      }),
    [eventStream.items, manifest.wakeId, manifest.status],
  )
  return (
    <AppDisclosure
      className={cn('wake-run', outcome.className)}
      isExpanded={open}
      onExpandedChange={setOpen}
      bodyClassName="wake-run-body"
      summary={
        <>
          <span className="wake-status-dot" />
          <span>
            <strong>{manifest.wakeId}</strong>
            <small>{outcome.label}</small>
          </span>
          <time>{formatTime(manifest.startedAt)}</time>
          {manifest.status === 'running' && <WorkingIndicator />}
        </>
      }
    >
      <dl>
        <div>
          <dt>Scope</dt>
          <dd>
            {manifest.scope?.kind === 'project' ? `Project ${manifest.scope.projectId}` : 'Home'}
          </dd>
        </div>
        <div>
          <dt>Digest</dt>
          <dd>{manifest.stateDigest.slice(0, 16)}</dd>
        </div>
        <div>
          <dt>Handoff</dt>
          <dd>{manifest.handoffEventId ?? 'none'}</dd>
        </div>
      </dl>
      {manifest.error && <p className="wake-run-error">{manifest.error}</p>}
      <UnifiedMessageFeed
        feedKey={`wake:${manifest.wakeId}`}
        items={messages}
        density="compact"
        className="wake-message-feed"
        ariaLabel={`Wake ${manifest.wakeId} event stream`}
        isLoading={eventStream.isLoading}
        hasMoreBefore={eventStream.hasMoreBefore}
        isLoadingOlder={eventStream.isLoadingOlder}
        onLoadOlder={eventStream.loadOlder}
        emptyState={<span className="wake-event-empty">No normalized events recorded.</span>}
      />
      <AppDisclosure className="wake-paths" summary="Local diagnostics">
        <code>{run.paths.transcript}</code>
        <code>{run.paths.prompt}</code>
        <code>{run.paths.events}</code>
      </AppDisclosure>
    </AppDisclosure>
  )
}

function wakeRunId(run: WakeRunSummary) {
  return run.manifest.wakeId
}

function compareWakeRuns(left: WakeRunSummary, right: WakeRunSummary) {
  return (
    left.manifest.startedAt.localeCompare(right.manifest.startedAt) ||
    left.manifest.wakeId.localeCompare(right.manifest.wakeId)
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
