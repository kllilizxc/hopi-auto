import { type ReactNode, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Cpu,
  Loader2,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { sortGoalRunsForRecency } from '../lib/runSelection'
import { ScrollContainer } from '../components/ScrollContainer'
import {
  type AssistantRunSummary,
  type GoalRunSummary,
  openGoalEventStream,
  readGoalAssistantRuns,
  readGoalRuns,
} from '../lib/api'
import { buildGoalRoute, goalScopedQueryKey, matchesGoalScope } from '../lib/goalScope'

const RUN_STATUS_STYLES: Record<string, string> = {
  active: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
  retryable: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  completed: 'text-green-300 bg-green-500/10 border-green-500/20',
  blocked: 'text-red-300 bg-red-500/10 border-red-500/20',
  system_error: 'text-red-200 bg-red-600/10 border-red-600/20',
  failed: 'text-red-300 bg-red-500/10 border-red-500/20',
}

interface SessionViewProps {
  goalKey?: string
  projectKey?: string
}

export function SessionView({ goalKey: goalKeyProp, projectKey: projectKeyProp }: SessionViewProps = {}) {
  const routeParams = useParams<{ goalKey: string; projectKey: string }>()
  const goalKey = goalKeyProp ?? routeParams.goalKey
  const projectKey = projectKeyProp ?? routeParams.projectKey
  const boardHref = buildGoalRoute(
    goalKey ? { goalKey, projectKey: projectKey ?? null } : null,
    'board',
  )

  const runsQuery = useQuery({
    queryKey: goalScopedQueryKey('goal-runs', goalKey, projectKey),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalRuns(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  const assistantRunsQuery = useQuery({
    queryKey: goalScopedQueryKey('assistant-runs', goalKey, projectKey),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalAssistantRuns(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  useEffect(() => {
    if (!goalKey) {
      return undefined
    }

    const evtSource = openGoalEventStream()
    evtSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        type?: string
        goalKey?: string
        projectKey?: string
      }
      if (!matchesGoalScope({ goalKey, projectKey: projectKey ?? null }, payload)) {
        return
      }

      if (payload.type === 'board_changed') {
        void runsQuery.refetch()
      }

      if (payload.type === 'assistant_changed') {
        void assistantRunsQuery.refetch()
      }
    }

    return () => evtSource.close()
  }, [assistantRunsQuery, goalKey, projectKey, runsQuery])

  const orderedRuns = useMemo(
    () => sortGoalRunsForRecency(runsQuery.data?.runs ?? []),
    [runsQuery.data?.runs],
  )
  const activeWorkflowRuns = orderedRuns.filter(
    (run) => run.status === 'active' || run.status === 'retryable',
  )
  const assistantRuns = (assistantRunsQuery.data?.runs ?? []).slice(0, 8)

  const isLoading = runsQuery.isLoading || assistantRunsQuery.isLoading
  const error = runsQuery.error ?? assistantRunsQuery.error

  return (
    <div className="flex flex-1 flex-col bg-[#1A1A1A]">
      <header className="border-b border-[#333] px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <TerminalSquare className="h-5 w-5 text-green-400" />
              Active Sessions
            </h2>
            {goalKey && (
              <p className="mt-1 text-sm text-gray-400">
                Goal:{' '}
                <code className="rounded bg-[#2A2A2A] px-1.5 py-0.5 text-green-400">
                  {goalKey}
                </code>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to={boardHref}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-[#333]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Board
            </Link>
            <button
              type="button"
              onClick={() => {
                void Promise.all([runsQuery.refetch(), assistantRunsQuery.refetch()])
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2A2A2A] px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-[#333]"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <ScrollContainer axis="vertical" className="flex-1" viewportClassName="h-full px-6 py-6">
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-4 text-sm text-red-200">
            {(error as Error).message}
          </div>
        )}

        {isLoading && !error && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading session summaries...
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <SummaryCard label="Active workflow runs" value={String(activeWorkflowRuns.length)} />
              <SummaryCard label="Workflow runs recorded" value={String(orderedRuns.length)} />
              <SummaryCard label="Assistant runs" value={String(assistantRunsQuery.data?.runs.length ?? 0)} />
            </div>

            <SessionSection
              title="Active Workflow Runs"
              icon={<Cpu className="h-4 w-4 text-yellow-300" />}
              emptyLabel="No workflow run is currently active."
            >
              {activeWorkflowRuns.map((run) => (
                <WorkflowRunCard key={run.runId} run={run} />
              ))}
            </SessionSection>

            <SessionSection
              title="Assistant Runs"
              icon={<Bot className="h-4 w-4 text-cyan-300" />}
              emptyLabel="No assistant runs recorded yet."
            >
              {assistantRuns.map((run) => (
                <AssistantRunCard key={run.assistantRunId} run={run} />
              ))}
            </SessionSection>
          </div>
        )}
      </ScrollContainer>
    </div>
  )
}

function SessionSection({
  title,
  icon,
  emptyLabel,
  children,
}: {
  title: string
  icon: ReactNode
  emptyLabel: string
  children: ReactNode
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children].filter(Boolean)

  return (
    <section className="rounded-2xl border border-[#2d2d2d] bg-[#141414] p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#303030] bg-[#151515] px-4 py-6 text-sm text-gray-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">{items}</div>
      )}
    </section>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#2d2d2d] bg-[#141414] px-4 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  )
}

function WorkflowRunCard({ run }: { run: GoalRunSummary }) {
  return (
    <div className="rounded-xl border border-[#2e2e2e] bg-[#191919] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{run.taskRef}</div>
          <div className="mt-1 text-xs text-gray-500">
            {run.taskKind} · {run.stepCount} steps · {formatTimestamp(run.startedAt)}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
            RUN_STATUS_STYLES[run.status] ?? 'border-[#3a3a3a] bg-[#1a1a1a] text-gray-300',
          )}
        >
          {run.status}
        </span>
      </div>
      {(run.finalTaskStatus || run.terminalOutcome || run.endedAt) && (
        <div className="mt-3 space-y-1 text-xs text-gray-400">
          {run.finalTaskStatus && <div>Task status: {run.finalTaskStatus}</div>}
          {run.terminalOutcome && <div>Outcome: {run.terminalOutcome}</div>}
          {run.endedAt && <div>Ended: {formatTimestamp(run.endedAt)}</div>}
        </div>
      )}
    </div>
  )
}

function AssistantRunCard({ run }: { run: AssistantRunSummary }) {
  return (
    <div className="rounded-xl border border-[#2e2e2e] bg-[#191919] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{run.assistantRunId}</div>
          <div className="mt-1 text-xs text-gray-500">
            {run.actionCount} actions · {formatTimestamp(run.startedAt)}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
            RUN_STATUS_STYLES[run.status] ?? 'border-[#3a3a3a] bg-[#1a1a1a] text-gray-300',
          )}
        >
          {run.status}
        </span>
      </div>
      <div className="mt-3 line-clamp-3 text-sm leading-6 text-gray-400">{run.message}</div>
    </div>
  )
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
