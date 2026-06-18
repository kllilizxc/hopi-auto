import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Loader2, X } from 'lucide-react'
import type {
  GoalRunDetail,
  GoalRunStep,
  GoalRunStepBundle,
  GoalRunSummary,
  TodoTaskItem,
} from '../lib/api'
import { openGoalRunFeedStream, readGoalRunFeed, readGoalRunStepBundle } from '../lib/api'
import { useMessageFeed } from '../lib/messageFeed'
import { cn } from '../lib/utils'
import { ScrollContainer } from './ScrollContainer'
import { UnifiedMessageFeed } from './UnifiedMessageFeed'

interface TaskRunHistoryModalProps {
  goalKey: string
  projectKey?: string
  isOpen: boolean
  task: TodoTaskItem | null
  runs: GoalRunSummary[]
  selectedRunId: string | null
  onSelectRunId: (runId: string) => void
  runDetail: GoalRunDetail | null
  runDetailLoading: boolean
  runDetailError: Error | null
  selectedStepId: string | null
  onSelectStepId: (stepId: string | null) => void
  onClose: () => void
}

const RUN_STATUS_STYLES: Record<string, string> = {
  active: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
  retryable: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  completed: 'text-green-300 bg-green-500/10 border-green-500/20',
  blocked: 'text-red-300 bg-red-500/10 border-red-500/20',
  system_error: 'text-red-200 bg-red-600/10 border-red-600/20',
  failed: 'text-red-300 bg-red-500/10 border-red-500/20',
}

export function TaskRunHistoryModal({
  goalKey,
  projectKey,
  isOpen,
  task,
  runs,
  selectedRunId,
  onSelectRunId,
  runDetail,
  runDetailLoading,
  runDetailError,
  selectedStepId,
  onSelectStepId,
  onClose,
}: TaskRunHistoryModalProps) {
  const [showPromptPanel, setShowPromptPanel] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setShowPromptPanel(false)
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const activeRun = runs.find((run) => run.runId === selectedRunId) ?? runs[0] ?? null
  const selectedStep =
    runDetail?.steps.find((step) => step.stepId === selectedStepId) ?? null
  const promptStep = selectedStep ?? runDetail?.steps.at(-1) ?? null

  const loadFeedPage = useCallback(
    (before?: string) => {
      if (!activeRun) {
        return Promise.resolve({
          items: [],
          hasMoreBefore: false,
        })
      }

      return readGoalRunFeed(goalKey, activeRun.runId, {
        before,
        limit: 80,
        stepId: selectedStepId,
        projectKey,
      })
    },
    [activeRun, goalKey, projectKey, selectedStepId],
  )

  const openFeedStream = useCallback(
    (after?: string) => {
      if (!activeRun) {
        return new EventSource('data:,')
      }

      return openGoalRunFeedStream(goalKey, activeRun.runId, {
        after,
        stepId: selectedStepId,
        projectKey,
      })
    },
    [activeRun, goalKey, projectKey, selectedStepId],
  )

  const feed = useMessageFeed({
    enabled: isOpen && Boolean(goalKey) && Boolean(activeRun),
    queryKey: ['run-feed', projectKey ?? '__legacy__', goalKey, activeRun?.runId ?? null, selectedStepId ?? null],
    loadPage: loadFeedPage,
    openStream: openFeedStream,
  })

  const stepMetadata = useMemo(() => buildStepMetadata(selectedStep), [selectedStep])
  const promptBundleQuery = useQuery<GoalRunStepBundle>({
    queryKey: [
      'run-step-bundle',
      projectKey ?? '__legacy__',
      goalKey,
      activeRun?.runId ?? null,
      promptStep?.stepId ?? null,
    ],
    queryFn: () => readGoalRunStepBundle(goalKey, activeRun!.runId, promptStep!.stepId, projectKey),
    enabled:
      isOpen &&
      showPromptPanel &&
      Boolean(goalKey) &&
      Boolean(activeRun?.runId) &&
      Boolean(promptStep?.stepId),
    staleTime: 0,
  })

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="absolute inset-0" aria-hidden="true" onClick={onClose} />

      <div className="relative z-10 flex h-[min(88vh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#343434] bg-[#111] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#2d2d2d] px-6 py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {task && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase leading-none',
                    task.kind === 'planning'
                      ? 'border-blue-400/20 bg-blue-500/10 text-blue-300'
                      : 'border-white/10 bg-white/5 text-gray-300',
                  )}
                >
                  {task.kind}
                </span>
              )}
              {task?.status && (
                <span className="inline-flex items-center rounded-full border border-[#3a3a3a] bg-[#1a1a1a] px-2 py-1 text-[10px] font-semibold uppercase leading-none text-gray-300">
                  {task.status}
                </span>
              )}
              {activeRun && (
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase leading-none',
                    RUN_STATUS_STYLES[activeRun.status] ??
                      'border-[#3a3a3a] bg-[#1a1a1a] text-gray-300',
                  )}
                >
                  {activeRun.status}
                </span>
              )}
            </div>
            <h3 className="mt-3 text-xl font-semibold text-white">
              {task?.title ?? 'Task session history'}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-400">
              {activeRun && <span>{activeRun.stepCount} steps</span>}
              {activeRun?.startedAt && <span>{formatTimestamp(activeRun.startedAt)}</span>}
              {selectedStep && <span>{selectedStep.role}</span>}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#343434] bg-[#181818] text-gray-300 transition hover:border-[#4a4a4a] hover:text-white"
            aria-label="Close task session history"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-[#232323] px-6 py-4">
          {runs.length > 0 ? (
            <ScrollContainer
              axis="horizontal"
              className="-mx-1"
              viewportClassName="pb-1"
            >
              <div className="flex min-w-max gap-2 px-1">
                {runs.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    onClick={() => {
                      onSelectRunId(run.runId)
                      onSelectStepId(null)
                    }}
                    className={cn(
                      'w-72 shrink-0 rounded-lg border px-3 py-2 text-left transition',
                      run.runId === activeRun?.runId
                        ? 'border-purple-500/40 bg-purple-500/10'
                        : 'border-[#343434] bg-[#151515] hover:border-purple-500/30 hover:bg-[#1a1a1a]',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-white">{run.runId}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                          RUN_STATUS_STYLES[run.status] ??
                            'border-[#3a3a3a] bg-[#1a1a1a] text-gray-300',
                        )}
                      >
                        {run.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-gray-500">
                      {run.taskKind} · {formatTimestamp(run.startedAt)}
                    </div>
                  </button>
                ))}
              </div>
            </ScrollContainer>
          ) : (
            <div className="text-sm text-gray-500">
              No workflow run has been recorded for this task yet.
            </div>
          )}
        </div>

        <div className="border-b border-[#232323] px-6 py-4">
          {runDetail ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onSelectStepId(null)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm transition',
                    selectedStepId === null
                      ? 'border-purple-500/40 bg-purple-500/10 text-purple-200'
                      : 'border-[#343434] bg-[#151515] text-gray-300 hover:border-purple-500/30 hover:text-white',
                  )}
                >
                  Full run
                </button>
                {runDetail.steps.map((step) => (
                  <button
                    key={step.stepId}
                    type="button"
                    onClick={() => onSelectStepId(step.stepId)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm transition',
                      selectedStepId === step.stepId
                        ? 'border-purple-500/40 bg-purple-500/10 text-purple-200'
                        : 'border-[#343434] bg-[#151515] text-gray-300 hover:border-purple-500/30 hover:text-white',
                    )}
                  >
                    <div className="font-medium">{step.role}</div>
                    <div className="mt-1 text-[11px] uppercase text-gray-500">{step.outcome}</div>
                  </button>
                ))}
              </div>

              {promptStep && (
                <button
                  type="button"
                  onClick={() => setShowPromptPanel((current) => !current)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
                    showPromptPanel
                      ? 'border-purple-500/40 bg-purple-500/10 text-purple-200'
                      : 'border-[#343434] bg-[#151515] text-gray-300 hover:border-purple-500/30 hover:text-white',
                  )}
                >
                  <FileText className="h-4 w-4" />
                  <span className="font-medium">Prompt bundle</span>
                  <span className="text-[11px] uppercase text-gray-500">
                    {promptStep.role}
                    {selectedStepId === null ? ' · latest' : ''}
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              Select a run to inspect its step history.
            </div>
          )}
        </div>

        {selectedStep && stepMetadata.length > 0 && (
          <div className="border-b border-[#232323] px-6 py-4">
            <div className="flex flex-wrap gap-2 text-xs text-gray-400">
              {stepMetadata.map((item) => (
                <div
                  key={`${selectedStep.stepId}:${item.label}:${item.value}`}
                  className="rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    {item.label}
                  </div>
                  <div className="mt-1 break-all text-gray-300">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0">
            <div className="min-h-0 flex-1 px-6 py-5">
              {runDetailError ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">
                  {runDetailError.message}
                </div>
              ) : runDetailLoading && !runDetail ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading run history...
                </div>
              ) : !activeRun ? (
                <div className="rounded-xl border border-dashed border-[#303030] bg-[#151515] px-4 py-6 text-center text-sm text-gray-500">
                  No run detail is available for this task.
                </div>
              ) : (
                <UnifiedMessageFeed
                  goalKey={goalKey}
                  projectKey={projectKey}
                  items={feed.items}
                  isLoading={feed.isLoading && feed.items.length === 0}
                  hasMoreBefore={feed.hasMoreBefore}
                  isLoadingOlder={feed.isFetchingOlder}
                  onLoadOlder={() => {
                    void feed.fetchOlder()
                  }}
                  emptyLabel="No session history was recorded for this selection."
                />
              )}
            </div>

            {showPromptPanel && promptStep && (
              <aside className="flex h-full w-[min(38vw,480px)] shrink-0 flex-col border-l border-[#232323] bg-[#101010]">
                <div className="border-b border-[#232323] px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Prompt bundle
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {promptStep.role} · {formatTimestamp(promptStep.startedAt)} · instructions + bundled context
                        {selectedStepId === null ? ' · latest step' : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPromptPanel(false)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#343434] bg-[#181818] text-gray-300 transition hover:border-[#4a4a4a] hover:text-white"
                      aria-label="Hide prompt bundle"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 p-5">
                  {promptBundleQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading prompt bundle...
                    </div>
                  ) : promptBundleQuery.error ? (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      {promptBundleQuery.error.message}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#141414]">
                      <div className="border-b border-[#262626] px-4 py-2 text-[11px] text-gray-500">
                        {promptBundleQuery.data?.prompt.path ?? 'prompt.md'}
                      </div>
                      <ScrollContainer
                        axis="both"
                        className="min-h-0 flex-1"
                        viewportClassName="h-full"
                      >
                        <pre className="min-h-full whitespace-pre-wrap break-words px-4 py-4 font-mono text-[12px] leading-6 text-gray-200">
                          {promptBundleQuery.data?.prompt.content?.trim() ||
                            'No prompt bundle was recorded for this step.'}
                        </pre>
                      </ScrollContainer>
                    </div>
                  )}
                </div>
              </aside>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function buildStepMetadata(step: GoalRunStep | null) {
  if (!step) {
    return []
  }

  const metadata: Array<{ label: string; value: string }> = []
  if (step.execution?.worktree?.path) {
    metadata.push({ label: 'Worktree', value: step.execution.worktree.path })
  }
  if ((step.execution?.artifacts.length ?? 0) > 0) {
    const artifactLabels = step.execution?.artifacts.map((artifact) => artifact.label).join(', ')
    if (!artifactLabels) {
      return metadata
    }
    metadata.push({
      label: 'Artifacts',
      value: artifactLabels,
    })
  }
  return metadata
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
