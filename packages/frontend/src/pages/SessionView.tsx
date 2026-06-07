import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Terminal,
  Play,
  Pause,
  RefreshCw,
  Loader2,
  Bot,
  Cpu,
  AlertCircle,
  PackageOpen,
  FilePenLine,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  formatAssistantActionCountSummary,
  formatAssistantActionDetails,
  formatAssistantActionPayload,
  formatAssistantActionResultPayload,
  formatAssistantActionResultDetails,
  formatAssistantRuntimeEventDetails,
  summarizeAssistantAction,
  summarizeAssistantRuntimeEvent,
} from '../lib/assistantPresentation';
import {
  type AgentRole,
  type AssistantRuntimeEvent,
  type GoalAssistantRunDetail,
  type GoalAssistantRunBundle,
  type GoalRunDetail,
  type GoalRunStep,
  type GoalRunSummary,
  type GoalWriteTraceEntry,
  type RunStepMessage,
  type RunTranscriptEntry,
  openGoalEventStream,
  readGoalAssistantRun,
  readGoalAssistantRunBundle,
  readGoalAssistantRuns,
  readGoalRun,
  readGoalRuns,
  readGoalWriteTraces,
} from '../lib/api';

type RuntimeTab = 'runs' | 'assistant';

interface AssistantRunSummary {
  assistantRunId: string;
  startedAt: string;
  endedAt: string;
  status: 'completed' | 'failed';
  message: string;
  actionCount: number;
}

interface RuntimeLogEntry {
  id: string;
  timestamp: string;
  category:
    | 'run'
    | 'step'
    | 'message'
    | 'transcript'
    | 'worktree'
    | 'artifact'
    | 'assistant'
    | 'assistant_action'
    | 'assistant_result'
    | 'error';
  title: string;
  payload?: string;
  tone?: 'default' | 'info' | 'success' | 'warning' | 'error';
}

const RUN_STATUS_STYLES: Record<string, string> = {
  active: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20',
  retryable: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  completed: 'text-green-300 bg-green-500/10 border-green-500/20',
  blocked: 'text-red-300 bg-red-500/10 border-red-500/20',
  system_error: 'text-red-200 bg-red-600/10 border-red-600/20',
  failed: 'text-red-300 bg-red-500/10 border-red-500/20',
};

const WRITE_TRACE_ROLE_FILTERS: Array<AgentRole | 'all'> = [
  'all',
  'planner',
  'generator',
  'reviewer',
  'merger',
];
const WRITE_TRACE_LIMIT_OPTIONS: Array<number | 'all'> = ['all', 20, 50, 100, 200];

export function SessionView() {
  const { goalKey } = useParams<{ goalKey: string }>();
  const [activeTab, setActiveTab] = useState<RuntimeTab>('runs');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRunStepId, setSelectedRunStepId] = useState<string | null>(null);
  const [writeTraceRoleFilter, setWriteTraceRoleFilter] = useState<AgentRole | 'all'>('all');
  const [writeTraceLimit, setWriteTraceLimit] = useState<number | 'all'>('all');
  const [selectedAssistantRunId, setSelectedAssistantRunId] = useState<string | null>(null);
  const [isTailing, setIsTailing] = useState(true);
  const endOfLogsRef = useRef<HTMLDivElement | null>(null);

  const runsQuery = useQuery({
    queryKey: ['goal-runs', goalKey],
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return readGoalRuns(goalKey);
    },
    enabled: Boolean(goalKey),
  });

  const assistantRunsQuery = useQuery({
    queryKey: ['assistant-runs', goalKey],
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return readGoalAssistantRuns(goalKey);
    },
    enabled: Boolean(goalKey),
  });

  const runs = runsQuery.data?.runs ?? [];
  const assistantRuns = assistantRunsQuery.data?.runs ?? [];

  useEffect(() => {
    if (runs.length > 0 && !selectedRunId) {
      setSelectedRunId(runs[0]?.runId ?? null);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    setSelectedRunStepId(null);
  }, [selectedRunId]);

  useEffect(() => {
    if (assistantRuns.length > 0 && !selectedAssistantRunId) {
      setSelectedAssistantRunId(assistantRuns[0]?.assistantRunId ?? null);
    }
  }, [assistantRuns, selectedAssistantRunId]);

  useEffect(() => {
    if (activeTab === 'runs' && runs.length === 0 && assistantRuns.length > 0) {
      setActiveTab('assistant');
    }
    if (activeTab === 'assistant' && assistantRuns.length === 0 && runs.length > 0) {
      setActiveTab('runs');
    }
  }, [activeTab, assistantRuns.length, runs.length]);

  const runDetailQuery = useQuery({
    queryKey: ['goal-run-detail', goalKey, selectedRunId],
    queryFn: async () => {
      if (!goalKey || !selectedRunId) {
        throw new Error('Missing run selection');
      }

      return readGoalRun(goalKey, selectedRunId);
    },
    enabled: Boolean(goalKey && selectedRunId),
  });

  const assistantRunDetailQuery = useQuery({
    queryKey: ['assistant-run-detail', goalKey, selectedAssistantRunId],
    queryFn: async () => {
      if (!goalKey || !selectedAssistantRunId) {
        throw new Error('Missing assistant run selection');
      }

      return readGoalAssistantRun(goalKey, selectedAssistantRunId);
    },
    enabled: Boolean(goalKey && selectedAssistantRunId),
  });

  const assistantBundleQuery = useQuery({
    queryKey: ['assistant-run-bundle', goalKey, selectedAssistantRunId],
    queryFn: async () => {
      if (!goalKey || !selectedAssistantRunId) {
        throw new Error('Missing assistant run selection');
      }

      return readGoalAssistantRunBundle(goalKey, selectedAssistantRunId);
    },
    enabled: Boolean(goalKey && selectedAssistantRunId),
  });

  const writeTraceQuery = useQuery({
    queryKey: [
      'goal-write-traces',
      goalKey,
      selectedRunId,
      selectedRunStepId,
      writeTraceRoleFilter,
      writeTraceLimit,
    ],
    queryFn: async () => {
      if (!goalKey || !selectedRunId) {
        throw new Error('Missing run selection');
      }

      return readGoalWriteTraces(goalKey, {
        runId: selectedRunId,
        stepId: selectedRunStepId ?? undefined,
        role: writeTraceRoleFilter === 'all' ? undefined : writeTraceRoleFilter,
        limit: writeTraceLimit === 'all' ? undefined : writeTraceLimit,
      });
    },
    enabled: Boolean(goalKey && selectedRunId),
  });

  useEffect(() => {
    if (!goalKey) {
      return undefined;
    }

    const evtSource = openGoalEventStream();
    evtSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; goalKey?: string };
      if (payload.goalKey !== goalKey) {
        return;
      }

      if (payload.type === 'board_changed') {
        void Promise.all([
          runsQuery.refetch(),
          runDetailQuery.refetch(),
          writeTraceQuery.refetch(),
        ]);
      }

      if (payload.type === 'assistant_changed') {
        if (selectedAssistantRunId) {
          void Promise.all([
            assistantRunsQuery.refetch(),
            assistantRunDetailQuery.refetch(),
            assistantBundleQuery.refetch(),
          ]);
        } else {
          void assistantRunsQuery.refetch();
        }
      }
    };

    return () => evtSource.close();
  }, [
    assistantBundleQuery,
    assistantRunDetailQuery,
    assistantRunsQuery,
    goalKey,
    runDetailQuery,
    runsQuery,
    selectedAssistantRunId,
    writeTraceQuery,
  ]);

  const logs = useMemo(() => {
    if (activeTab === 'assistant') {
      return assistantRunDetailQuery.data
        ? buildAssistantRunLogs(assistantRunDetailQuery.data)
        : [];
    }

    return runDetailQuery.data ? buildGoalRunLogs(runDetailQuery.data) : [];
  }, [activeTab, assistantRunDetailQuery.data, runDetailQuery.data]);

  useEffect(() => {
    if (isTailing && endOfLogsRef.current) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [endOfLogsRef, isTailing, logs]);

  const isLoading =
    runsQuery.isLoading ||
    assistantRunsQuery.isLoading ||
    (activeTab === 'runs'
      ? runDetailQuery.isLoading || writeTraceQuery.isLoading
      : assistantRunDetailQuery.isLoading);

  const error =
    runsQuery.error ??
    assistantRunsQuery.error ??
    runDetailQuery.error ??
    writeTraceQuery.error ??
    assistantRunDetailQuery.error;

  const activeRun = runs.find((run) => run.runId === selectedRunId) ?? null;
  const activeAssistantRun =
    assistantRuns.find((run) => run.assistantRunId === selectedAssistantRunId) ?? null;

  const handleRefresh = () => {
    void Promise.all([
      runsQuery.refetch(),
      assistantRunsQuery.refetch(),
      runDetailQuery.refetch(),
      writeTraceQuery.refetch(),
      assistantRunDetailQuery.refetch(),
      assistantBundleQuery.refetch(),
    ]);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#1A1A1A]">
      <header className="px-6 py-4 border-b border-[#333] shrink-0 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-green-400" />
            Runtime Activity
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Goal: <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-green-400">{goalKey}</code>
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setIsTailing(!isTailing)}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#2A2A2A] hover:bg-[#333] text-sm text-gray-300 transition-colors"
          >
            {isTailing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isTailing ? 'Pause Auto-scroll' : 'Resume Auto-scroll'}
          </button>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#2A2A2A] hover:bg-[#333] text-sm text-gray-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <aside className="w-80 border-r border-[#333] bg-[#141414] flex flex-col">
          <div className="p-4 border-b border-[#333]">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setActiveTab('runs')}
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === 'runs'
                    ? 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                    : 'bg-[#202020] text-gray-400 hover:text-gray-200 hover:bg-[#282828]',
                )}
              >
                Workflow Runs
              </button>
              <button
                onClick={() => setActiveTab('assistant')}
                className={cn(
                  'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  activeTab === 'assistant'
                    ? 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                    : 'bg-[#202020] text-gray-400 hover:text-gray-200 hover:bg-[#282828]',
                )}
              >
                Assistant Runs
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {activeTab === 'runs' ? (
              runs.length === 0 ? (
                <EmptyRuntimeList icon={<Cpu className="w-4 h-4" />} label="No workflow runs yet." />
              ) : (
                runs.map((run) => (
                  <RunCard
                    key={run.runId}
                    run={run}
                    selected={run.runId === selectedRunId}
                    onClick={() => setSelectedRunId(run.runId)}
                  />
                ))
              )
            ) : assistantRuns.length === 0 ? (
              <EmptyRuntimeList icon={<Bot className="w-4 h-4" />} label="No assistant runs yet." />
            ) : (
              assistantRuns.map((run) => (
                <AssistantRunCard
                  key={run.assistantRunId}
                  run={run}
                  selected={run.assistantRunId === selectedAssistantRunId}
                  onClick={() => setSelectedAssistantRunId(run.assistantRunId)}
                />
              ))
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-6 py-4 border-b border-[#333] bg-[#111]">
            {activeTab === 'runs' ? (
              <RuntimeSelectionSummary
                title={activeRun?.taskRef ?? 'Select a workflow run'}
                subtitle={
                  activeRun
                    ? `${activeRun.taskKind} · ${activeRun.stepCount} steps · ${activeRun.status}`
                    : 'The current goal has no active workflow run selected.'
                }
                status={activeRun?.status}
              />
            ) : (
              <RuntimeSelectionSummary
                title={activeAssistantRun?.assistantRunId ?? 'Select an assistant run'}
                subtitle={
                  activeAssistantRun
                    ? `${formatAssistantActionCountSummary(activeAssistantRun.actionCount)} · ${activeAssistantRun.status}`
                    : 'The current goal has no assistant run selected.'
                }
                status={activeAssistantRun?.status}
              />
            )}
          </div>

          <div className="flex-1 p-6 overflow-y-auto bg-[#0F0F0F] font-mono text-sm">
            {error && (
              <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-200">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{(error as Error).message}</span>
              </div>
            )}

            {isLoading && (
              <div className="flex items-center justify-center py-12 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}

            {!isLoading && logs.length === 0 && !error && (
              <div className="rounded-xl border border-dashed border-[#303030] bg-[#151515] px-4 py-6 text-center text-gray-500">
                No runtime entries available for the current selection.
              </div>
            )}

            {activeTab === 'assistant' && assistantRunDetailQuery.data && (
              <AssistantRunDetailPanel run={assistantRunDetailQuery.data} />
            )}

            {activeTab === 'runs' && runDetailQuery.data && (
              <RunStepInspector
                run={runDetailQuery.data}
                selectedStepId={selectedRunStepId}
                onSelectStepId={setSelectedRunStepId}
              />
            )}

            {logs.map((log) => (
              <RuntimeLogRow key={log.id} entry={log} />
            ))}
            {activeTab === 'runs' && writeTraceQuery.data && (
              <WriteTracePanel
                entries={writeTraceQuery.data.entries}
                stepFilter={
                  selectedRunStepId
                    ? runDetailQuery.data?.steps.find((step) => step.stepId === selectedRunStepId) ?? null
                    : null
                }
                roleFilter={writeTraceRoleFilter}
                onRoleFilterChange={setWriteTraceRoleFilter}
                limit={writeTraceLimit}
                onLimitChange={setWriteTraceLimit}
                onClearStepFilter={
                  selectedRunStepId ? () => setSelectedRunStepId(null) : undefined
                }
              />
            )}
            {activeTab === 'assistant' && assistantBundleQuery.data && (
              <AssistantBundlePanel bundle={assistantBundleQuery.data} />
            )}
            <div ref={endOfLogsRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RunCard({
  run,
  selected,
  onClick,
}: {
  run: GoalRunSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-purple-500/30 bg-purple-500/10'
          : 'border-[#303030] bg-[#1B1B1B] hover:bg-[#232323]',
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold text-white">{run.taskRef}</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', RUN_STATUS_STYLES[run.status])}>
          {run.status}
        </span>
      </div>
      <div className="text-xs text-gray-400 space-y-1">
        <p>{run.taskKind} workflow</p>
        <p>{run.stepCount} steps</p>
        <p>{formatTimestamp(run.startedAt)}</p>
      </div>
    </button>
  );
}

function AssistantRunCard({
  run,
  selected,
  onClick,
}: {
  run: AssistantRunSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
        selected
          ? 'border-purple-500/30 bg-purple-500/10'
          : 'border-[#303030] bg-[#1B1B1B] hover:bg-[#232323]',
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold text-white">{run.assistantRunId}</span>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', RUN_STATUS_STYLES[run.status])}>
          {run.status}
        </span>
      </div>
      <div className="text-xs text-gray-400 space-y-1">
        <p>{formatAssistantActionCountSummary(run.actionCount)}</p>
        <p className="line-clamp-2">{run.message}</p>
        <p>{formatTimestamp(run.startedAt)}</p>
      </div>
    </button>
  );
}

function RuntimeSelectionSummary({
  title,
  subtitle,
  status,
}: {
  title: string;
  subtitle: string;
  status?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="mt-1 text-sm text-gray-400">{subtitle}</p>
      </div>
      {status && (
        <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase', RUN_STATUS_STYLES[status] ?? 'text-gray-300 border-[#444] bg-[#202020]')}>
          {status}
        </span>
      )}
    </div>
  );
}

function EmptyRuntimeList({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#303030] bg-[#1A1A1A] px-4 py-6 text-center text-sm text-gray-500">
      <div className="mb-2 flex justify-center text-gray-400">{icon}</div>
      {label}
    </div>
  );
}

function RuntimeLogRow({ entry }: { entry: RuntimeLogEntry }) {
  return (
    <div className="mb-2 flex gap-4 group hover:bg-[#1A1A1A] px-2 py-1 rounded -mx-2 transition-colors">
      <span className="text-gray-600 shrink-0 select-none">
        {formatClock(entry.timestamp)}
      </span>
      <div className="flex-1 break-words">
        <div className={cn('font-semibold', toneClass(entry.tone))}>[{entry.title}]</div>
        {entry.payload && <div className="text-gray-300 whitespace-pre-wrap">{entry.payload}</div>}
      </div>
    </div>
  );
}

function AssistantBundlePanel({ bundle }: { bundle: GoalAssistantRunBundle }) {
  return (
    <div className="mt-6 rounded-2xl border border-[#2d2d2d] bg-[#141414] p-4">
      <div className="mb-4 flex items-center gap-2 text-white font-medium">
        <PackageOpen className="w-4 h-4 text-purple-400" />
        Assistant Bundle
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <BundleFileCard title="context.md" file={bundle.context} />
        <BundleFileCard title="prompt.md" file={bundle.prompt} />
        <BundleFileCard title="outcome.json" file={bundle.outcome} />
        <BundleFileCard title="result.json" file={bundle.result} />
      </div>
    </div>
  );
}

function AssistantRunDetailPanel({ run }: { run: GoalAssistantRunDetail }) {
  return (
    <div className="mb-6 rounded-2xl border border-[#2d2d2d] bg-[#141414] p-4">
      <div className="mb-4 flex items-center gap-2 text-white font-medium">
        <Bot className="w-4 h-4 text-purple-400" />
        Selected Assistant Run
      </div>
      <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-2 xl:grid-cols-4">
        <div>Started: {formatTimestamp(run.startedAt)}</div>
        <div>Ended: {formatTimestamp(run.endedAt)}</div>
        <div>Actions: {run.actions.length}</div>
        <div>Action results: {run.actionResults.length}</div>
        <div>Events: {run.events.length}</div>
        <div>Status: {run.status}</div>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <AssistantRunTextCard title="Reply" content={run.message} />
        <AssistantRunTextCard title="Request" content={run.requestContent} />
      </div>
      {run.error && <AssistantRunTextCard className="mt-4" title="Assistant Error" content={run.error} />}
      {(run.actions.length > 0 || run.actionResults.length > 0) && (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <AssistantRunEntriesPanel
            title="Actions"
            entries={run.actions.map((action, index) => ({
              key: `${run.assistantRunId}:action:${index}`,
              kind: action.kind,
              summary: summarizeAssistantAction(action),
              details: formatAssistantActionDetails(action),
            }))}
          />
          <AssistantRunEntriesPanel
            title="Action Results"
            entries={run.actionResults.map((result, index) => ({
              key: `${run.assistantRunId}:result:${index}`,
              kind: result.kind,
              summary: result.summary,
              details: formatAssistantActionResultDetails(result),
            }))}
          />
        </div>
      )}
      {run.events.length > 0 && (
        <div className="mt-4">
          <AssistantRunEntriesPanel
            title="Runtime Events"
            entries={run.events.map((event, index) => ({
              key: `${run.assistantRunId}:event:${event.kind}:${index}`,
              kind: event.kind,
              summary: summarizeAssistantRuntimeEvent(event),
              details: formatAssistantRuntimeEventDetails(event),
            }))}
          />
        </div>
      )}
    </div>
  );
}

function AssistantRunEntriesPanel({
  title,
  entries,
}: {
  title: string;
  entries: Array<{
    key: string;
    kind: string;
    summary: string;
    details: string[];
  }>;
}) {
  return (
    <div className="rounded-xl border border-[#2e2e2e] bg-[#191919] p-4">
      <div className="mb-3 text-sm font-medium text-white">{title}</div>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#303030] bg-[#151515] px-3 py-4 text-xs text-gray-500">
          No entries recorded for this run.
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div key={entry.key} className="rounded-lg border border-[#2d2d2d] bg-[#121212] px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                  {entry.kind}
                </span>
              </div>
              <div className="mt-2 text-xs leading-5 text-gray-300">{entry.summary}</div>
              {entry.details.length > 0 && (
                <div className="mt-2 space-y-1">
                  {entry.details.map((detail, index) => (
                    <div key={`${entry.key}:detail:${index}`} className="text-[11px] leading-5 text-gray-500">
                      {detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssistantRunTextCard({
  title,
  content,
  className,
}: {
  title: string;
  content: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-[#2e2e2e] bg-[#191919] p-4', className)}>
      <div className="mb-3 text-sm font-medium text-white">{title}</div>
      <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-gray-400 font-mono">
        {content}
      </pre>
    </div>
  );
}

function RunStepInspector({
  run,
  selectedStepId,
  onSelectStepId,
}: {
  run: GoalRunDetail;
  selectedStepId: string | null;
  onSelectStepId: (stepId: string | null) => void;
}) {
  if (run.steps.length === 0) {
    return null;
  }

  const selectedStep = run.steps.find((step) => step.stepId === selectedStepId) ?? null;

  return (
    <div className="mt-6 rounded-2xl border border-[#2d2d2d] bg-[#141414] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-white font-medium">Run Steps</div>
          <div className="mt-1 text-xs text-gray-500">
            Select one step to filter the durable write traces below to that run step.
          </div>
        </div>
        {selectedStepId && (
          <button
            onClick={() => onSelectStepId(null)}
            className="rounded-lg border border-[#3a3a3a] bg-[#101010] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-[#1a1a1a] hover:text-white"
          >
            Clear step filter
          </button>
        )}
      </div>

      <div className="space-y-3">
        {run.steps.map((step) => {
          const selected = step.stepId === selectedStepId;
          return (
            <button
              key={step.stepId}
              onClick={() => onSelectStepId(selected ? null : step.stepId)}
              className={cn(
                'w-full rounded-xl border px-4 py-3 text-left transition-colors',
                selected
                  ? 'border-purple-500/30 bg-purple-500/10'
                  : 'border-[#303030] bg-[#191919] hover:bg-[#202020]',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">{step.stepId}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    {step.role} · {step.statusBefore}
                    {step.statusAfter ? ` -> ${step.statusAfter}` : ''}
                    {step.outcome ? ` · ${step.outcome}` : ''}
                  </div>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                    RUN_STATUS_STYLES[step.outcome === 'running' ? 'active' : step.outcome === 'success' ? 'completed' : 'blocked'] ??
                      'border-[#444] bg-[#202020] text-gray-300',
                  )}
                >
                  {step.outcome}
                </span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-gray-400 md:grid-cols-2 xl:grid-cols-4">
                <div>Messages: {step.messages.length}</div>
                <div>Transcript: {step.transcript.length}</div>
                <div>Artifacts: {step.execution?.artifacts.length ?? 0}</div>
                <div>{formatTimestamp(step.startedAt)}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedStep && (
        <div className="mt-4 rounded-xl border border-[#303030] bg-[#191919] px-4 py-4">
          <div className="mb-3 text-sm font-medium text-white">Selected Step Detail</div>
            <div className="grid gap-2 text-xs text-gray-400 md:grid-cols-2 xl:grid-cols-3">
              <div>Role: {selectedStep.role}</div>
              <div>Status before: {selectedStep.statusBefore}</div>
              <div>Outcome: {selectedStep.outcome}</div>
              {selectedStep.statusAfter && <div>Status after: {selectedStep.statusAfter}</div>}
              <div>Started: {formatTimestamp(selectedStep.startedAt)}</div>
            {selectedStep.endedAt && <div>Ended: {formatTimestamp(selectedStep.endedAt)}</div>}
            <div>Messages: {selectedStep.messages.length}</div>
            <div>Transcript: {selectedStep.transcript.length}</div>
            <div>Artifacts: {selectedStep.execution?.artifacts.length ?? 0}</div>
          </div>

          {selectedStep.execution?.worktree && (
            <div className="mt-4 rounded-lg border border-[#2d2d2d] bg-[#121212] px-3 py-3 text-xs text-gray-300">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">Worktree</div>
              <div>{selectedStep.execution.worktree.path}</div>
              {(selectedStep.execution.worktree.branch || selectedStep.execution.worktree.baseBranch) && (
                <div className="mt-1 space-y-1 text-gray-500">
                  {selectedStep.execution.worktree.branch && (
                    <div>Branch: {selectedStep.execution.worktree.branch}</div>
                  )}
                  {selectedStep.execution.worktree.baseBranch && (
                    <div>Base branch: {selectedStep.execution.worktree.baseBranch}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedStep.messages.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">Step Messages</div>
              <div className="space-y-2">
                {selectedStep.messages.map((message) => (
                  <div
                    key={`${selectedStep.stepId}:message:${message.messageId}`}
                    className="rounded-lg border border-[#2d2d2d] bg-[#121212] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        {message.kind}:{message.role}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500">
                        {formatTimestamp(message.createdAt)}
                      </div>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-300">
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedStep.transcript.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">Transcript Entries</div>
              <div className="space-y-2">
                {selectedStep.transcript.map((entry) => (
                  <div
                    key={`${selectedStep.stepId}:transcript:${entry.entryId}`}
                    className="rounded-lg border border-[#2d2d2d] bg-[#121212] px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        {entry.transport}:{entry.kind}
                      </div>
                      <div className="text-[10px] font-mono text-gray-500">
                        {formatTimestamp(entry.createdAt)}
                      </div>
                    </div>
                    <div className="mt-1 break-words text-xs text-gray-300">{entry.summary}</div>
                    {(entry.toolName || entry.toolInvocationKey || entry.vendorEventType) && (
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
                        {entry.toolName && <span>tool={entry.toolName}</span>}
                        {entry.toolInvocationKey && (
                          <span>invocation={entry.toolInvocationKey}</span>
                        )}
                        {entry.vendorEventType && <span>vendor={entry.vendorEventType}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(selectedStep.execution?.artifacts.length ?? 0) > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-[11px] uppercase tracking-wide text-gray-500">Artifacts</div>
              <div className="space-y-2">
                {selectedStep.execution?.artifacts.map((artifact) => (
                  <div
                    key={`${selectedStep.stepId}:artifact:${artifact.ref}`}
                    className="rounded-lg border border-[#2d2d2d] bg-[#121212] px-3 py-3"
                  >
                    <div className="text-xs text-white">{artifact.label}</div>
                    <div className="mt-1 break-all font-mono text-[11px] text-gray-500">
                      {artifact.ref}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WriteTracePanel({
  entries,
  stepFilter,
  roleFilter,
  onRoleFilterChange,
  limit,
  onLimitChange,
  onClearStepFilter,
}: {
  entries: GoalWriteTraceEntry[];
  stepFilter?: GoalRunStep | null;
  roleFilter: AgentRole | 'all';
  onRoleFilterChange: (value: AgentRole | 'all') => void;
  limit: number | 'all';
  onLimitChange: (value: number | 'all') => void;
  onClearStepFilter?: () => void;
}) {
  return (
    <div className="mt-6 rounded-2xl border border-[#2d2d2d] bg-[#141414] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white font-medium">
            <FilePenLine className="w-4 h-4 text-purple-400" />
            Durable Write Traces
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500">
            <span>Role</span>
            <select
              value={roleFilter}
              onChange={(event) => onRoleFilterChange(event.target.value as AgentRole | 'all')}
              className="rounded-lg border border-[#343434] bg-[#101010] px-2 py-1 text-[11px] normal-case text-gray-200 outline-none transition focus:border-purple-500/50"
            >
              {WRITE_TRACE_ROLE_FILTERS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <span>Limit</span>
            <select
              value={String(limit)}
              onChange={(event) =>
                onLimitChange(
                  event.target.value === 'all'
                    ? 'all'
                    : Number.parseInt(event.target.value, 10),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#101010] px-2 py-1 text-[11px] normal-case text-gray-200 outline-none transition focus:border-purple-500/50"
            >
              {WRITE_TRACE_LIMIT_OPTIONS.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        {stepFilter && onClearStepFilter && (
          <button
            onClick={onClearStepFilter}
            className="rounded-lg border border-[#3a3a3a] bg-[#101010] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-[#1a1a1a] hover:text-white"
          >
            Show full run traces
          </button>
        )}
      </div>
      {stepFilter && (
        <div className="mb-4 rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-3 text-xs text-purple-200">
          Filtering durable writes to step <span className="font-mono">{stepFilter.stepId}</span>
          {' '}({stepFilter.role} · {stepFilter.outcome})
        </div>
      )}
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#303030] bg-[#151515] px-4 py-6 text-center text-sm text-gray-500">
          {stepFilter
            ? 'No durable write traces currently match this selected run step.'
            : 'No durable write traces currently match this selected run.'}
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-[#303030] bg-[#191919] px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                  {entry.role}
                </span>
                <span className="rounded-full border border-[#3a3a3a] bg-[#101010] px-2 py-0.5 text-[10px] font-mono text-gray-400">
                  {entry.stepId}
                </span>
                <span className="text-xs text-gray-500">{formatTimestamp(entry.timestamp)}</span>
              </div>
              <div className="mt-2 text-sm text-gray-200">{entry.resultSummary}</div>
              <div className="mt-1 text-xs text-gray-500">
                {entry.toolName} · {entry.agent} · {entry.taskRef}
              </div>
              <div className="mt-2 space-y-1 text-xs text-gray-400">
                <div>Call: {entry.callId}</div>
                <div className="break-all">Cwd: {entry.cwd}</div>
              </div>
              {entry.argumentSummary && (
                <div className="mt-3 text-xs leading-5 text-gray-400">
                  Argument: {entry.argumentSummary}
                </div>
              )}
              {entry.targetPaths.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {entry.targetPaths.map((path) => (
                    <span
                      key={`${entry.id}:target:${path}`}
                      className="rounded-full border border-[#3a3a3a] bg-[#101010] px-2 py-0.5 text-[10px] font-mono text-gray-300"
                    >
                      {path}
                    </span>
                  ))}
                </div>
              )}
              {entry.changes.length > 0 && (
                <div className="mt-3 space-y-1">
                  {entry.changes.map((change, index) => (
                    <div
                      key={`${entry.id}:change:${index}:${change.path}`}
                      className="text-xs leading-5 text-gray-400"
                    >
                      {change.kind}: {change.path}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BundleFileCard({
  title,
  file,
}: {
  title: string;
  file: GoalAssistantRunBundle['context'];
}) {
  return (
    <div className="rounded-xl border border-[#2e2e2e] bg-[#191919] p-4">
      <div className="mb-3">
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-1 text-[11px] text-gray-500 break-all">{file.path}</div>
      </div>
      <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-gray-400 font-mono">
        {file.content ?? 'Bundle file was not recorded for this run.'}
      </pre>
    </div>
  );
}

function buildGoalRunLogs(run: GoalRunDetail): RuntimeLogEntry[] {
  const entries: RuntimeLogEntry[] = [
    {
      id: `${run.runId}:start`,
      timestamp: run.startedAt,
      category: 'run',
      title: 'run_start',
      payload: `${run.taskRef} (${run.taskKind}) started with status ${run.status}`,
      tone: 'info',
    },
  ];

  for (const step of run.steps) {
    entries.push({
      id: `${step.stepId}:start`,
      timestamp: step.startedAt,
      category: 'step',
      title: 'step_start',
      payload: `${step.role} · ${step.statusBefore}`,
      tone: 'info',
    });

    for (const message of step.messages) {
      entries.push(mapRunMessage(step.stepId, message));
    }

    for (const transcript of step.transcript) {
      entries.push(mapTranscriptEntry(step.stepId, transcript));
    }

    if (step.execution?.worktree) {
      const payload = [
        step.execution.worktree.path,
        step.execution.worktree.branch ? `branch=${step.execution.worktree.branch}` : null,
        step.execution.worktree.baseBranch ? `base=${step.execution.worktree.baseBranch}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      entries.push({
        id: `${step.stepId}:worktree`,
        timestamp: step.startedAt,
        category: 'worktree',
        title: 'worktree_prepared',
        payload,
        tone: 'warning',
      });
    }

    for (const artifact of step.execution?.artifacts ?? []) {
      entries.push({
        id: `${step.stepId}:artifact:${artifact.ref}`,
        timestamp: step.endedAt ?? step.startedAt,
        category: 'artifact',
        title: 'artifact',
        payload: `${artifact.label} · ${artifact.ref}`,
        tone: 'success',
      });
    }

    if (step.endedAt) {
      entries.push({
        id: `${step.stepId}:end`,
        timestamp: step.endedAt,
        category: 'step',
        title: 'step_end',
        payload: `${step.role} · ${step.outcome}${step.statusAfter ? ` · ${step.statusAfter}` : ''}`,
        tone: step.outcome === 'success' ? 'success' : step.outcome === 'running' ? 'info' : 'error',
      });
    }
  }

  if (run.endedAt) {
    entries.push({
      id: `${run.runId}:end`,
      timestamp: run.endedAt,
      category: 'run',
      title: 'run_end',
      payload: `${run.status}${run.finalTaskStatus ? ` · ${run.finalTaskStatus}` : ''}${run.terminalOutcome ? ` · ${run.terminalOutcome}` : ''}`,
      tone: run.status === 'completed' ? 'success' : 'error',
    });
  }

  return entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function buildAssistantRunLogs(run: GoalAssistantRunDetail): RuntimeLogEntry[] {
  const entries: RuntimeLogEntry[] = [
    {
      id: `${run.assistantRunId}:request`,
      timestamp: run.startedAt,
      category: 'assistant',
      title: 'assistant_request',
      payload: run.requestContent,
      tone: 'info',
    },
  ];

  for (const event of run.events) {
    entries.push(mapAssistantEvent(run.assistantRunId, run.startedAt, event));
  }

  run.actions.forEach((action, index) => {
    entries.push({
      id: `${run.assistantRunId}:action:${index}`,
      timestamp: run.endedAt,
      category: 'assistant_action',
      title: `action:${action.kind}`,
      payload: formatAssistantActionPayload(action),
      tone: 'warning',
    });
  });

  run.actionResults.forEach((result, index) => {
    entries.push({
      id: `${run.assistantRunId}:result:${index}`,
      timestamp: run.endedAt,
      category: 'assistant_result',
      title: `action_result:${result.kind}`,
      payload: formatAssistantActionResultPayload(result),
      tone:
        result.kind === 'resolve_decision' ||
        result.kind === 'record_answer' ||
        result.kind === 'record_answers' ||
        result.kind === 'request_planning' ||
        result.kind === 'request_planning_batch' ||
        result.kind === 'request_planning_workflows'
          ? 'success'
          : 'default',
    });
  });

  entries.push({
    id: `${run.assistantRunId}:end`,
    timestamp: run.endedAt,
    category: 'assistant',
    title: 'assistant_run_end',
    payload: run.error ? `${run.message}\n${run.error}` : run.message,
    tone: run.status === 'completed' ? 'success' : 'error',
  });

  return entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function mapRunMessage(stepId: string, message: RunStepMessage): RuntimeLogEntry {
  return {
    id: `${stepId}:message:${message.messageId}`,
    timestamp: message.createdAt,
    category: 'message',
    title: `${message.kind}:${message.role}`,
    payload: message.content,
    tone: message.kind === 'error' ? 'error' : message.kind === 'info' ? 'info' : 'default',
  };
}

function mapTranscriptEntry(stepId: string, transcript: RunTranscriptEntry): RuntimeLogEntry {
  const metadata = [
    transcript.toolName ? `tool=${transcript.toolName}` : null,
    transcript.toolInvocationKey ? `invocation=${transcript.toolInvocationKey}` : null,
    transcript.vendorEventType ? `vendor=${transcript.vendorEventType}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `${stepId}:transcript:${transcript.entryId}`,
    timestamp: transcript.createdAt,
    category: 'transcript',
    title: `${transcript.transport}:${transcript.kind}`,
    payload: metadata ? `${transcript.summary}\n${metadata}` : transcript.summary,
    tone: transcript.kind === 'error' ? 'error' : transcript.kind === 'tool_result' ? 'success' : 'default',
  };
}

function mapAssistantEvent(
  assistantRunId: string,
  fallbackTimestamp: string,
  event: AssistantRuntimeEvent,
): RuntimeLogEntry {
  switch (event.kind) {
    case 'message':
      return {
        id: `${assistantRunId}:event:message:${event.role ?? 'system'}:${event.content ?? ''}`,
        timestamp: fallbackTimestamp,
        category: 'assistant',
        title: `${event.level ?? 'info'}:${event.role ?? 'assistant'}`,
        payload: event.content,
        tone: event.level === 'error' ? 'error' : 'info',
      };
    case 'transcript':
      {
        const metadata = [
          event.toolName ? `tool=${event.toolName}` : null,
          event.toolInvocationKey ? `invocation=${event.toolInvocationKey}` : null,
          event.vendorEventType ? `vendor=${event.vendorEventType}` : null,
        ]
          .filter(Boolean)
          .join(' · ');

      return {
        id: `${assistantRunId}:event:transcript:${event.transport ?? 'process'}:${event.summary ?? ''}`,
        timestamp: fallbackTimestamp,
        category: 'transcript',
        title: `${event.transport ?? 'process'}:${event.entryKind ?? 'status'}`,
        payload: metadata && event.summary ? `${event.summary}\n${metadata}` : event.summary ?? metadata,
        tone: event.entryKind === 'error' ? 'error' : event.entryKind === 'tool_result' ? 'success' : 'default',
      };
      }
    case 'worktree_prepared':
      {
        const payload = [
          event.path,
          event.branch ? `branch=${event.branch}` : null,
          event.baseBranch ? `base=${event.baseBranch}` : null,
        ]
          .filter(Boolean)
          .join('\n');

      return {
        id: `${assistantRunId}:event:worktree:${event.path ?? ''}`,
        timestamp: fallbackTimestamp,
        category: 'worktree',
        title: 'worktree_prepared',
        payload,
        tone: 'warning',
      };
      }
    case 'artifact':
      return {
        id: `${assistantRunId}:event:artifact:${event.ref ?? ''}`,
        timestamp: fallbackTimestamp,
        category: 'artifact',
        title: 'artifact',
        payload: [event.label, event.ref].filter(Boolean).join(' · '),
        tone: 'success',
      };
  }
}

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function toneClass(tone?: RuntimeLogEntry['tone']) {
  switch (tone) {
    case 'info':
      return 'text-blue-400';
    case 'success':
      return 'text-green-400';
    case 'warning':
      return 'text-yellow-400';
    case 'error':
      return 'text-red-400';
    default:
      return 'text-gray-200';
  }
}
