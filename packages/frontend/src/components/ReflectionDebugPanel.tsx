import { Activity } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import {
  type ReflectionRunSummary,
  type RunAttemptEvent,
  readReflectionRunEvents,
  readReflectionRuns,
} from '../lib/api'
import { runEventsToMessageFeed } from '../lib/messageFeed'
import { ACTIVE_STREAM_POLL_INTERVAL_MS } from '../lib/queryPerformance'
import { useInfiniteMessageStream } from '../lib/useInfiniteMessageStream'
import { cn, formatTime } from '../lib/utils'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'
import {
  AppDisclosure,
  AppScrollShadow,
  AppSpinner,
  WorkingIndicator,
} from './ui'

export function ReflectionDebugPanel({ enabled }: { enabled: boolean }) {
  const stream = useInfiniteMessageStream({
    streamKey: 'reflection-runs',
    queryKey: ['reflection-runs'],
    readPage: readReflectionRuns,
    getItemId: reflectionRunId,
    compareItems: compareReflectionRuns,
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
      {stream.isLoading ? (
        <div className="reflection-debug-empty">
          <AppSpinner size="sm" /> Loading runtime stream
        </div>
      ) : stream.error ? (
        <div className="reflection-debug-empty error">{stream.error.message}</div>
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
              if (stream.hasMoreBefore && !stream.isLoadingOlder) stream.loadOlder()
            }}
            increaseViewportBy={{ top: 220, bottom: 260 }}
            components={{
              Scroller: AppScrollShadow,
              Header: () =>
                stream.hasMoreBefore || stream.isLoadingOlder ? (
                  <div className="reflection-history-status">
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
        : { className: 'no-action', label: 'No handoff' }
      : { className: manifest.status, label: manifest.status }
  const eventStream = useInfiniteMessageStream<RunAttemptEvent>({
    streamKey: `reflection:${manifest.reflectionId}`,
    queryKey: ['reflection-events', manifest.reflectionId],
    readPage: (input) => readReflectionRunEvents(manifest.reflectionId, input),
    getItemId: runEventId,
    compareItems: compareRunEvents,
    enabled: open,
    refetchInterval: open && manifest.status === 'running' ? ACTIVE_STREAM_POLL_INTERVAL_MS : false,
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
          <dt>Scope</dt>
          <dd>
            {manifest.scope?.kind === 'project'
              ? `Project ${manifest.scope.projectId}`
              : manifest.scope?.kind === 'home'
                ? 'Home'
                : 'Legacy'}
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
