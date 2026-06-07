import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare,
  X,
  Send,
  Bot,
  User,
  AlertTriangle,
  Loader2,
  Wrench,
  Plus,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  formatAssistantActionCountSummary,
  formatAssistantActionDetails,
  formatAssistantActionResultDetails,
  formatAssistantRuntimeEventDetails,
  summarizeAssistantAction,
  summarizeAssistantRuntimeEvent,
} from '../lib/assistantPresentation';
import {
  appendGoalAssistantMessage,
  type GoalAssistantActionResult,
  type AssistantRunSummary,
  type AssistantThreadEntry,
  type GoalEvent,
  type GoalAssistantRunBundle,
  type GoalAssistantRunDetail,
  openGoalEventStream,
  readGoalAssistantRun,
  readGoalAssistantRunBundle,
  readGoalAssistantRuns,
  readGoalAssistantThread,
  runGoalAssistant,
} from '../lib/api';

interface PanelMessage {
  id: string;
  role: 'user' | 'assistant' | 'action' | 'action_result';
  content: string;
  details?: string[];
  label?: string;
  taskRef?: string;
  timestamp: string;
}

interface AssistantPanelProps {
  goalKey: string;
  isOpen: boolean;
  onClose: () => void;
}

function hasAssistantDecisionMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'request_decision' ||
      actionResult.kind === 'resolve_decision' ||
      actionResult.kind === 'record_answer' ||
      actionResult.kind === 'record_answers',
  );
}

function hasAssistantPlanningMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'request_planning' ||
      actionResult.kind === 'request_planning_batch' ||
      actionResult.kind === 'request_planning_workflows' ||
      ((actionResult.kind === 'resolve_decision' ||
        actionResult.kind === 'record_answer' ||
        actionResult.kind === 'record_answers') &&
        (actionResult.followThrough?.requestKeys.length ?? 0) > 0),
  );
}

function hasAssistantPreferenceMutations(actionResults: GoalAssistantActionResult[]) {
  return actionResults.some(
    (actionResult) =>
      actionResult.kind === 'record_preference' ||
      actionResult.kind === 'retire_preference' ||
      actionResult.kind === 'update_preference',
  );
}

export function AssistantPanel({ goalKey, isOpen, onClose }: AssistantPanelProps) {
  const [input, setInput] = useState('');
  const [selectedAssistantRunId, setSelectedAssistantRunId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: thread,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['assistant-thread', goalKey],
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return readGoalAssistantThread(goalKey);
    },
    enabled: isOpen && Boolean(goalKey),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const assistantRunsQuery = useQuery({
    queryKey: ['assistant-runs', goalKey],
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return readGoalAssistantRuns(goalKey);
    },
    enabled: isOpen && Boolean(goalKey),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const assistantRunDetailQuery = useQuery({
    queryKey: ['assistant-run-detail', goalKey, selectedAssistantRunId],
    queryFn: async () => {
      if (!goalKey || !selectedAssistantRunId) {
        throw new Error('Missing assistant run selection');
      }

      return readGoalAssistantRun(goalKey, selectedAssistantRunId);
    },
    enabled: isOpen && Boolean(goalKey && selectedAssistantRunId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const assistantRunBundleQuery = useQuery({
    queryKey: ['assistant-run-bundle', goalKey, selectedAssistantRunId],
    queryFn: async () => {
      if (!goalKey || !selectedAssistantRunId) {
        throw new Error('Missing assistant run selection');
      }

      return readGoalAssistantRunBundle(goalKey, selectedAssistantRunId);
    },
    enabled: isOpen && Boolean(goalKey && selectedAssistantRunId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const runAssistantMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return runGoalAssistant(goalKey, content);
    },
    onSuccess: async (run) => {
      const actionResults = run.actionResults ?? [];
      setInput('');
      setSelectedAssistantRunId(run.assistantRunId);
      queryClient.setQueryData(
        ['assistant-run-detail', goalKey, run.assistantRunId],
        run,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['assistant-thread', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['assistant-runs', goalKey] }),
        queryClient.invalidateQueries({
          queryKey: ['assistant-run-bundle', goalKey, run.assistantRunId],
        }),
        queryClient.invalidateQueries({ queryKey: ['board', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['goal-docs', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['goal-runs', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['goal-run-detail', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['planning-workflows', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['planning-workflow-detail', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['task-write-traces', goalKey] }),
        queryClient.invalidateQueries({ queryKey: ['task-run-write-traces', goalKey] }),
        ...(hasAssistantDecisionMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: ['goal-decisions', goalKey] })]
          : []),
        ...(hasAssistantPlanningMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: ['planning-requests', goalKey] })]
          : []),
        ...(hasAssistantPreferenceMutations(actionResults)
          ? [queryClient.invalidateQueries({ queryKey: ['preferences'] })]
          : []),
      ]);
    },
  });

  const appendMessageMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!goalKey) {
        throw new Error('Missing goal key');
      }

      return appendGoalAssistantMessage(goalKey, content);
    },
    onSuccess: async () => {
      setInput('');
      await queryClient.invalidateQueries({ queryKey: ['assistant-thread', goalKey] });
    },
  });

  const assistantRuns = assistantRunsQuery.data?.runs ?? [];
  const messages = (thread?.entries ?? []).map(mapThreadEntryToMessage);
  const displayError =
    appendMessageMutation.error ??
    runAssistantMutation.error ??
    assistantRunsQuery.error ??
    assistantRunDetailQuery.error ??
    error;

  useEffect(() => {
    if (assistantRuns.length === 0) {
      setSelectedAssistantRunId(null);
      return;
    }

    if (!selectedAssistantRunId || !assistantRuns.some((run) => run.assistantRunId === selectedAssistantRunId)) {
      setSelectedAssistantRunId(assistantRuns[0]?.assistantRunId ?? null);
    }
  }, [assistantRuns, selectedAssistantRunId]);

  useEffect(() => {
    if (!isOpen || !goalKey) {
      return undefined;
    }

    const evtSource = openGoalEventStream();
    evtSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as GoalEvent;
      if (payload.goalKey !== goalKey) {
        return;
      }

      if (payload.type === 'assistant_changed') {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['assistant-thread', goalKey] }),
          queryClient.invalidateQueries({ queryKey: ['assistant-runs', goalKey] }),
          queryClient.invalidateQueries({ queryKey: ['assistant-run-detail', goalKey] }),
          queryClient.invalidateQueries({ queryKey: ['assistant-run-bundle', goalKey] }),
        ]);
      }
    };

    return () => evtSource.close();
  }, [goalKey, isOpen, queryClient]);

  const handleRunAssistant = () => {
    const trimmed = input.trim();
    if (!trimmed || runAssistantMutation.isPending || appendMessageMutation.isPending) {
      return;
    }

    runAssistantMutation.mutate(trimmed);
  };

  const handleAppendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || appendMessageMutation.isPending || runAssistantMutation.isPending) {
      return;
    }

    appendMessageMutation.mutate(trimmed);
  };

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 w-96 bg-[#1A1A1A] border-l border-[#333] shadow-2xl transform transition-transform duration-300 ease-in-out z-50 flex flex-col',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="px-4 py-3 border-b border-[#333] flex items-center justify-between bg-[#141414]">
        <div className="flex items-center gap-2 text-white font-medium">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          Goal Assistant
          <span className="rounded-full border border-[#3a3a3a] bg-[#1d1d1d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {thread?.entries.length ?? 0} entries
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[#333] rounded text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {displayError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {(displayError as Error).message}
          </div>
        )}

        {!assistantRunsQuery.isLoading && assistantRuns.length > 0 && (
          <AssistantRunInspector
            runs={assistantRuns}
            selectedAssistantRunId={selectedAssistantRunId}
            onSelectAssistantRunId={setSelectedAssistantRunId}
            selectedRun={assistantRunDetailQuery.data}
            selectedRunLoading={assistantRunDetailQuery.isLoading}
            selectedBundle={assistantRunBundleQuery.data}
            selectedBundleLoading={assistantRunBundleQuery.isLoading}
          />
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!isLoading && messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#3A3A3A] bg-[#202020] px-4 py-6 text-sm text-gray-400">
            The assistant thread is empty for{' '}
            <code className="text-purple-300">{goalKey}</code>. Send a message to open a real
            assistant run.
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'user' ? 'flex-row-reverse' : '')}>
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
                msg.role === 'assistant'
                  ? 'bg-purple-500/20 text-purple-400'
                  : msg.role === 'user'
                    ? 'bg-blue-500/20 text-blue-400'
                    : msg.role === 'action'
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-red-500/20 text-red-400',
              )}
            >
              {msg.role === 'user' ? (
                <User className="w-4 h-4" />
              ) : msg.role === 'assistant' ? (
                <Bot className="w-4 h-4" />
              ) : msg.role === 'action' ? (
                <Wrench className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>

            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2 text-sm',
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-sm'
                  : msg.role === 'action_result'
                    ? 'bg-red-500/10 border border-red-500/20 text-red-200 rounded-tl-sm'
                    : msg.role === 'action'
                      ? 'bg-amber-500/10 border border-amber-500/20 text-amber-100 rounded-tl-sm'
                      : 'bg-[#2A2A2A] text-gray-200 rounded-tl-sm',
              )}
            >
              <div
                className={cn(
                  'mb-2 flex items-center gap-2',
                  msg.label ? 'justify-between' : 'justify-end',
                )}
              >
                {msg.label && (
                  <div
                    className={cn(
                      'text-xs font-bold uppercase tracking-wider',
                      msg.role === 'action_result'
                        ? 'text-red-400'
                        : msg.role === 'action'
                          ? 'text-amber-300'
                          : 'text-gray-400',
                    )}
                  >
                    {msg.label}
                  </div>
                )}
                <div
                  className={cn(
                    'text-[10px] font-mono',
                    msg.role === 'user'
                      ? 'text-blue-200/70'
                      : msg.role === 'action_result'
                        ? 'text-red-300/70'
                        : msg.role === 'action'
                          ? 'text-amber-200/70'
                          : 'text-gray-500',
                  )}
                >
                  {formatThreadTimestamp(msg.timestamp)}
                </div>
              </div>
              {msg.taskRef && (
                <div className="mb-2">
                  <span className="text-xs font-mono bg-black/30 px-1.5 py-0.5 rounded text-gray-300">
                    {msg.taskRef}
                  </span>
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.details && msg.details.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {msg.details.map((detail, index) => (
                    <div
                      key={`${msg.id}:detail:${index}`}
                      className={cn(
                        'whitespace-pre-wrap text-xs leading-5',
                        msg.role === 'action_result'
                          ? 'text-red-300/90'
                          : msg.role === 'action'
                            ? 'text-amber-200/90'
                            : 'text-gray-400',
                      )}
                    >
                      {detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-[#333] bg-[#141414]">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunAssistant()}
            placeholder="Ask assistant to plan, fix tasks, or leave a thread note..."
            className="w-full bg-[#222] border border-[#444] rounded-lg pl-4 pr-10 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <button
            onClick={handleRunAssistant}
            disabled={!input.trim() || runAssistantMutation.isPending || appendMessageMutation.isPending}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-purple-400 hover:text-purple-300 disabled:opacity-50 disabled:hover:text-purple-400 transition-colors"
            title="Run assistant"
          >
            {runAssistantMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500">
            Enter runs the assistant. Add to thread stores a durable user message without starting a run.
          </div>
          <button
            onClick={handleAppendMessage}
            disabled={!input.trim() || appendMessageMutation.isPending || runAssistantMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg border border-[#3a3a3a] bg-[#1d1d1d] px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {appendMessageMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Add to Thread
          </button>
        </div>
      </div>
    </div>
  );
}

function mapThreadEntryToMessage(entry: AssistantThreadEntry): PanelMessage {
  switch (entry.kind) {
    case 'user_message':
      return {
        id: entry.entryId,
        role: 'user',
        content: entry.content,
        timestamp: entry.createdAt,
      };
    case 'assistant_message':
      return {
        id: entry.entryId,
        role: 'assistant',
        content: entry.content,
        timestamp: entry.createdAt,
      };
    case 'action':
      return {
        id: entry.entryId,
        role: 'action',
        label: `Action · ${entry.actionType}`,
        content: entry.summary,
        details: entry.action ? formatAssistantActionDetails(entry.action) : undefined,
        taskRef: entry.action?.taskRef,
        timestamp: entry.createdAt,
      };
    case 'action_result':
      return {
        id: entry.entryId,
        role: 'action_result',
        label: `Result · ${entry.actionType}`,
        content: entry.summary,
        details: entry.result ? formatAssistantActionResultDetails(entry.result) : undefined,
        taskRef: entry.result?.taskRef,
        timestamp: entry.createdAt,
      };
  }
}

function AssistantRunInspector({
  runs,
  selectedAssistantRunId,
  onSelectAssistantRunId,
  selectedRun,
  selectedRunLoading,
  selectedBundle,
  selectedBundleLoading,
}: {
  runs: AssistantRunSummary[];
  selectedAssistantRunId: string | null;
  onSelectAssistantRunId: (assistantRunId: string) => void;
  selectedRun?: GoalAssistantRunDetail;
  selectedRunLoading: boolean;
  selectedBundle?: GoalAssistantRunBundle;
  selectedBundleLoading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#333] bg-[#161616] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-white font-medium">
          <Bot className="w-4 h-4 text-purple-400" />
          Assistant Runs
        </div>
        <span className="rounded-full border border-[#3a3a3a] bg-[#1d1d1d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {runs.length}
        </span>
      </div>

      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {runs.map((run) => (
          <button
            key={run.assistantRunId}
            onClick={() => onSelectAssistantRunId(run.assistantRunId)}
            className={cn(
              'w-full rounded-xl border px-3 py-3 text-left transition-colors',
              run.assistantRunId === selectedAssistantRunId
                ? 'border-purple-500/30 bg-purple-500/10'
                : 'border-[#303030] bg-[#1B1B1B] hover:bg-[#232323]',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-mono text-gray-500">
                {formatThreadTimestamp(run.startedAt)}
              </div>
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                  run.status === 'completed'
                    ? 'border-green-500/20 bg-green-500/10 text-green-300'
                    : 'border-red-500/20 bg-red-500/10 text-red-300',
                )}
              >
                {run.status}
              </span>
            </div>
            <div className="mt-2 line-clamp-2 text-sm text-gray-200">
              {run.message || 'Assistant run'}
            </div>
            <div className="mt-2 text-[11px] text-gray-500">
              {formatAssistantActionCountSummary(run.actionCount)}
            </div>
          </button>
        ))}
      </div>

      {selectedRunLoading ? (
        <div className="mt-4 flex items-center justify-center rounded-xl border border-[#2e2e2e] bg-[#191919] px-4 py-5 text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : selectedRun ? (
        <div className="mt-4 rounded-xl border border-[#2e2e2e] bg-[#191919] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white">Selected Run</div>
              <div className="mt-1 text-[11px] text-gray-500">
                {selectedRun.assistantRunId}
              </div>
            </div>
            <span
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                selectedRun.status === 'completed'
                  ? 'border-green-500/20 bg-green-500/10 text-green-300'
                  : 'border-red-500/20 bg-red-500/10 text-red-300',
              )}
            >
              {selectedRun.status}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-[11px] text-gray-500 md:grid-cols-2">
            <div>Started: {formatThreadTimestamp(selectedRun.startedAt)}</div>
            <div>Ended: {formatThreadTimestamp(selectedRun.endedAt)}</div>
            <div>Actions: {selectedRun.actions.length}</div>
            <div>Action results: {selectedRun.actionResults.length}</div>
            <div>Events: {selectedRun.events.length}</div>
          </div>

          <AssistantRunDetailTextCard
            className="mt-4"
            title="Request"
            content={selectedRun.requestContent}
          />
          <AssistantRunDetailTextCard
            className="mt-4"
            title="Reply"
            content={selectedRun.message || 'No assistant reply recorded.'}
          />
          {selectedRun.error && (
            <AssistantRunDetailTextCard
              className="mt-4"
              title="Assistant Error"
              content={selectedRun.error}
              tone="error"
            />
          )}
          {(selectedRun.actions.length > 0 ||
            selectedRun.actionResults.length > 0 ||
            selectedRun.events.length > 0) && (
            <div className="mt-4 space-y-4">
              {selectedRun.actions.length > 0 && (
                <AssistantRunDetailEntriesSection
                  title="Actions"
                  entries={selectedRun.actions.map((action, index) => ({
                    key: `${selectedRun.assistantRunId}:action:${index}`,
                    kind: action.kind,
                    summary: summarizeAssistantAction(action),
                    details: formatAssistantActionDetails(action),
                  }))}
                />
              )}
              {selectedRun.actionResults.length > 0 && (
                <AssistantRunDetailEntriesSection
                  title="Action Results"
                  entries={selectedRun.actionResults.map((result, index) => ({
                    key: `${selectedRun.assistantRunId}:result:${index}`,
                    kind: result.kind,
                    summary: result.summary,
                    details: formatAssistantActionResultDetails(result),
                  }))}
                />
              )}
              {selectedRun.events.length > 0 && (
                <AssistantRunDetailEntriesSection
                  title="Runtime Events"
                  entries={selectedRun.events.map((event, index) => ({
                    key: `${selectedRun.assistantRunId}:event:${event.kind}:${index}`,
                    kind: event.kind,
                    summary: summarizeAssistantRuntimeEvent(event),
                    details: formatAssistantRuntimeEventDetails(event),
                  }))}
                />
              )}
            </div>
          )}
          {selectedBundleLoading ? (
            <div className="mt-4 flex items-center justify-center rounded-xl border border-[#2d2d2d] bg-[#141414] px-4 py-5 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : selectedBundle ? (
            <AssistantRunBundleSection bundle={selectedBundle} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AssistantRunBundleSection({ bundle }: { bundle: GoalAssistantRunBundle }) {
  return (
    <div className="mt-4 rounded-xl border border-[#2d2d2d] bg-[#141414] p-3">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
        Assistant Bundle Files
      </div>
      <div className="grid gap-3">
        <AssistantRunBundleFileCard title="context.md" file={bundle.context} />
        <AssistantRunBundleFileCard title="prompt.md" file={bundle.prompt} />
        <AssistantRunBundleFileCard title="outcome.json" file={bundle.outcome} />
        <AssistantRunBundleFileCard title="result.json" file={bundle.result} />
      </div>
    </div>
  );
}

function AssistantRunBundleFileCard({
  title,
  file,
}: {
  title: string;
  file: GoalAssistantRunBundle['context'];
}) {
  return (
    <div className="rounded-lg border border-[#2d2d2d] bg-[#101010] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
          {title}
        </div>
        <div className="text-[10px] font-mono text-gray-600">{file.path}</div>
      </div>
      <div className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-gray-300">
        {file.content?.trim().length ? file.content : 'No bundle content recorded.'}
      </div>
    </div>
  );
}

function AssistantRunDetailEntriesSection({
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
    <div className="rounded-xl border border-[#2d2d2d] bg-[#141414] p-3">
      <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
        {title}
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="rounded-lg border border-[#2d2d2d] bg-[#101010] px-3 py-3"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300">
                {entry.kind}
              </span>
            </div>
            <div className="mt-2 text-xs leading-5 text-gray-300">{entry.summary}</div>
            {entry.details.length > 0 && (
              <div className="mt-2 space-y-1">
                {entry.details.map((detail, index) => (
                  <div
                    key={`${entry.key}:detail:${index}`}
                    className="text-[11px] leading-5 text-gray-500"
                  >
                    {detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantRunDetailTextCard({
  title,
  content,
  className,
  tone = 'default',
}: {
  title: string;
  content: string;
  className?: string;
  tone?: 'default' | 'error';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-[#141414] p-3',
        tone === 'error' ? 'border-red-500/20 text-red-200' : 'border-[#2d2d2d]',
        className,
      )}
    >
      <div
        className={cn(
          'mb-2 text-xs font-bold uppercase tracking-wider',
          tone === 'error' ? 'text-red-400' : 'text-gray-400',
        )}
      >
        {title}
      </div>
      <div
        className={cn(
          'max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs leading-6',
          tone === 'error' ? 'text-red-200' : 'text-gray-300',
        )}
      >
        {content}
      </div>
    </div>
  );
}

function formatThreadTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString([], {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
