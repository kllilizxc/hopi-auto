import {
  Loader2,
  AlertCircle,
  MessageSquare,
  RefreshCw,
  Play,
  Square,
} from 'lucide-react'
import { cn } from '../lib/utils'
import {
  pickPreferredTaskRun,
  sortTaskRunsForPresentation,
} from '../lib/runSelection'
import { AssistantPanel } from '../components/AssistantPanel'
import { ScrollContainer } from '../components/ScrollContainer'
import { TaskRunHistoryModal } from '../components/TaskRunHistoryModal'
import type { TaskStatus, TodoTaskItem } from '../lib/api'
import { parseListInput } from './boardViewStructuredEditors'
import {
  buildReusableAnswerSourceSuggestions,
  buildReusablePlanningAnswerSuggestions,
  buildReusableDecisionAnswerSuggestions,
  buildReusablePlanningRequestSuggestions,
  buildReusableDecisionRefSuggestions,
  buildReusablePlanningRequestKeySuggestions,
  buildReusablePlanningGroupKeySuggestions,
  buildReusablePlanningGroupTaskKeySuggestions,
  buildReusableBatchRequestSuggestions,
  buildReusableBatchRequestGroupSuggestions,
  buildReusableWorkflowGraphSuggestions,
  buildReusableWorkflowChildSuggestions,
  buildReusableDecisionWorkflowChildSuggestions,
  buildReusableWorkflowContextSuggestions,
  buildReusableWorkflowKeySuggestions,
  buildReusableTaskRefSuggestions,
  buildReusableWorkflowTaskRefSuggestions,
  buildReusableWorkflowGroupKeySuggestions,
  buildReusablePreferenceKeySuggestions,
  buildReusableBlockerSuggestions,
} from './boardViewReusableSuggestions'
import {
  buildAssistantProactiveMessage,
  buildTaskDisplayIdMap,
  hasActionRequiredBlocker,
  isRunnableTask,
} from './boardViewTaskSupport'
import {
  TaskActionsPanel,
  TaskAuthorityPanel,
  TaskCard,
} from './boardViewTaskPanelSupport'
import {
  materializePlanningRequestInput,
  materializeWorkflowMutationInput,
} from './boardViewPlanningMutationSupport'
import { PreferencePanel } from './boardViewPreferencePanelSupport'
import { AnswerBundlePanel } from './boardViewAnswerBundlePanel'
import { DecisionPanel } from './boardViewDecisionPanel'
import { PlanningRequestPanel } from './boardViewPlanningRequestPanel'
import { useBoardViewModel } from './useBoardViewModel'
import { WorkflowPanel } from './boardViewWorkflowPanel'
import {
  DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT,
  DEFAULT_DECISION_RESOLUTION_DRAFT,
} from './boardViewDraftSupport'

const STATUS_COLUMNS: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'planned', label: 'Planned', color: 'border-blue-500/30 bg-blue-500/5 text-blue-400' },
  {
    id: 'in_progress',
    label: 'In Progress',
    color: 'border-yellow-500/30 bg-yellow-500/5 text-yellow-400',
  },
  {
    id: 'in_review',
    label: 'In Review',
    color: 'border-purple-500/30 bg-purple-500/5 text-purple-400',
  },
  {
    id: 'merging',
    label: 'Merging',
    color: 'border-orange-500/30 bg-orange-500/5 text-orange-400',
  },
  { id: 'done', label: 'Done', color: 'border-green-500/30 bg-green-500/5 text-green-400' },
]

interface BoardViewProps {
  goalKey?: string
  projectKey?: string
  mvpMode?: boolean
}

export function BoardView({
  goalKey: goalKeyProp,
  projectKey: projectKeyProp,
  mvpMode = false,
}: BoardViewProps = {}) {
  const {
    goalKey,
    projectKey,
    isAssistantOpen,
    setIsAssistantOpen,
    isTaskHistoryModalOpen,
    setIsTaskHistoryModalOpen,
    selectedTaskRef,
    setSelectedTaskRef,
    selectedTaskRunId,
    setSelectedTaskRunId,
    selectedTaskRunStepId,
    setSelectedTaskRunStepId,
    decisionDraft,
    setDecisionDraft,
    decisionResolutionDrafts,
    setDecisionResolutionDrafts,
    decisionFollowThroughDrafts,
    setDecisionFollowThroughDrafts,
    answerBundleDraft,
    setAnswerBundleDraft,
    answerBundleFollowThroughDraft,
    setAnswerBundleFollowThroughDraft,
    planningDraft,
    setPlanningDraft,
    workflowDraft,
    setWorkflowDraft,
    selectedWorkflowKey,
    taskCreateDraft,
    setTaskCreateDraft,
    taskMoveDraft,
    setTaskMoveDraft,
    preferenceEditor,
    setPreferenceEditor,
    preferenceEditorDirty,
    setPreferenceEditorDirty,
    preferenceDraft,
    setPreferenceDraft,
    retireDraft,
    setRetireDraft,
    board,
    isLoading,
    error,
    decisions,
    planningRequests,
    workflows,
    currentPlanningMutationAuthoritySnapshot,
    selectedWorkflowDetail,
    isSelectedWorkflowLoading,
    selectedWorkflowError,
    preferences,
    automationQuery,
    taskRunsQuery,
    taskRunDetailQuery,
    reconcileMutation,
    startAutomationMutation,
    stopAutomationMutation,
    createDecisionMutation,
    resolveDecisionMutation,
    answerBundleMutation,
    createPlanningRequestMutation,
    createWorkflowMutation,
    createTaskMutation,
    moveTaskMutation,
    savePreferencesMutation,
    recordPreferenceMutation,
    retirePreferenceMutation,
    handleSelectWorkflow,
  } = useBoardViewModel({ goalKeyProp, projectKeyProp, mvpMode })

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-red-400 gap-4">
        <AlertCircle className="w-12 h-12" />
        <p className="text-lg">Failed to load board: {(error as Error).message}</p>
      </div>
    )
  }

  const itemsByStatus: Record<TaskStatus, TodoTaskItem[]> = {
    planned: [],
    in_progress: [],
    in_review: [],
    merging: [],
    done: [],
  }

  for (const item of board?.items ?? []) {
    itemsByStatus[item.status].push(item)
  }

  const createdTaskResult =
    createTaskMutation.data && createTaskMutation.variables
      ? (createTaskMutation.data.items.find(
          (item) => item.ref === createTaskMutation.variables.ref.trim(),
        ) ?? null)
      : null

  const movedTaskResult =
    moveTaskMutation.data && moveTaskMutation.variables
      ? (moveTaskMutation.data.items.find(
          (item) => item.ref === moveTaskMutation.variables.taskRef,
        ) ?? null)
      : null
  const selectedTask = selectedTaskRef
    ? ((board?.items ?? []).find((item) => item.ref === selectedTaskRef) ?? null)
    : null
  const selectedTaskDecisions = selectedTask
    ? (decisions?.decisions ?? []).filter((decision) => decision.taskRef === selectedTask.ref)
    : []
  const selectedTaskPlanningRequests = selectedTask
    ? (planningRequests?.requests ?? []).filter((request) => request.taskRef === selectedTask.ref)
    : []
  const selectedTaskWorkflows = selectedTask
    ? (workflows?.workflows ?? []).filter(
        (workflow) =>
          workflow.taskRefs.includes(selectedTask.ref) ||
          workflow.blockerTaskRefs.includes(selectedTask.ref),
      )
    : []
  const selectedTaskDependents = selectedTask
    ? (board?.items ?? []).filter(
        (item) =>
          item.ref !== selectedTask.ref &&
          item.blockedBy.some(
            (blocker) => blocker.kind === 'task' && blocker.ref === selectedTask.ref,
          ),
      )
    : []
  const selectedTaskRuns = selectedTask
    ? sortTaskRunsForPresentation(
        (taskRunsQuery.data?.runs ?? []).filter((run) => run.taskRef === selectedTask.ref),
        selectedTask.status,
      )
    : []

  const handleTaskCardClick = (task: TodoTaskItem) => {
    setSelectedTaskRef(task.ref)

    const preferredRun = pickPreferredTaskRun(
      taskRunsQuery.data?.runs ?? [],
      task.ref,
      null,
      task.status,
    )
    setSelectedTaskRunId(preferredRun?.runId ?? null)
    setSelectedTaskRunStepId(null)

    if (!mvpMode) {
      return
    }

    if (!goalKey) {
      return
    }

    setIsTaskHistoryModalOpen(true)
  }
  const selectedTaskRunDetail =
    selectedTaskRunId && taskRunDetailQuery.data?.runId === selectedTaskRunId
      ? taskRunDetailQuery.data
      : null
  const reusableAnswerSourceSuggestions = buildReusableAnswerSourceSuggestions(
    decisions?.decisions ?? [],
    planningRequests?.requests ?? [],
  )
  const reusablePlanningAnswerSuggestions = buildReusablePlanningAnswerSuggestions(
    decisions?.decisions ?? [],
    planningRequests?.requests ?? [],
  )
  const reusableDecisionAnswerSuggestions = buildReusableDecisionAnswerSuggestions(
    decisions?.decisions ?? [],
  )
  const reusableDecisionRefSuggestions = buildReusableDecisionRefSuggestions(
    decisions?.decisions ?? [],
  )
  const reusablePlanningRequestSuggestions = buildReusablePlanningRequestSuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusableTaskRefSuggestions = buildReusableTaskRefSuggestions(board?.items ?? [])
  const reusablePlanningRequestKeySuggestions = buildReusablePlanningRequestKeySuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusablePlanningGroupKeySuggestions = buildReusablePlanningGroupKeySuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusablePlanningGroupTaskKeySuggestions = buildReusablePlanningGroupTaskKeySuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusableBatchRequestSuggestions = buildReusableBatchRequestSuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusableBatchRequestGroupSuggestions = buildReusableBatchRequestGroupSuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
  )
  const reusableBlockerSuggestions = buildReusableBlockerSuggestions(
    board?.items ?? [],
    decisions?.decisions ?? [],
  )
  const reusableWorkflowKeySuggestions = buildReusableWorkflowKeySuggestions(
    workflows?.workflows ?? [],
  )
  const reusableWorkflowContextSuggestions = buildReusableWorkflowContextSuggestions(
    workflows?.workflows ?? [],
  )
  const reusableWorkflowGraphSuggestions = buildReusableWorkflowGraphSuggestions(
    workflows?.workflows ?? [],
    board?.items ?? [],
  )
  const reusableWorkflowChildSuggestions = buildReusableWorkflowChildSuggestions(
    workflows?.workflows ?? [],
    board?.items ?? [],
  )
  const reusableDecisionWorkflowChildSuggestions = buildReusableDecisionWorkflowChildSuggestions(
    workflows?.workflows ?? [],
    board?.items ?? [],
  )
  const reusableWorkflowTaskRefSuggestions = buildReusableWorkflowTaskRefSuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
    workflows?.workflows ?? [],
  )
  const reusableWorkflowGroupKeySuggestions = buildReusableWorkflowGroupKeySuggestions(
    planningRequests?.requests ?? [],
    board?.items ?? [],
    workflows?.workflows ?? [],
  )
  const reusablePreferenceKeySuggestions = buildReusablePreferenceKeySuggestions(
    preferences?.entries ?? [],
  )
  const totalTaskCount = board?.items.length ?? 0
  const doneTaskCount = (board?.items ?? []).filter((item) => item.status === 'done').length
  const blockedTasks = (board?.items ?? []).filter((item) => item.blockedBy.length > 0)
  const attentionBlockedTasks = blockedTasks.filter(hasActionRequiredBlocker)
  const blockedTaskCount = attentionBlockedTasks.length
  const runningTaskCount = (board?.items ?? []).filter((item) => item.running).length
  const runnableTaskCount = (board?.items ?? []).filter(isRunnableTask).length
  const taskDisplayIdByRef = buildTaskDisplayIdMap(board?.items ?? [])
  const taskByRef = new Map((board?.items ?? []).map((task) => [task.ref, task] as const))
  const automationStatus = automationQuery.data?.status
  const automationState = automationStatus?.state ?? 'idle'
  const reconcileEnabled = automationStatus?.reconcileEnabled ?? false
  const automationDisplayState = automationState === 'idle' ? 'paused' : automationState
  const automationStateLabel =
    automationState === 'running' && !reconcileEnabled
      ? 'running · reconcile off'
      : automationDisplayState
  const automationStateClass =
    automationDisplayState === 'running'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : automationDisplayState === 'blocked' || automationDisplayState === 'failed'
        ? 'border-red-500/30 bg-red-500/10 text-red-200'
        : 'border-[#444] bg-[#202020] text-gray-200'
  const canStartAutomation =
    Boolean(projectKey) &&
    runnableTaskCount > 0 &&
    (automationState !== 'running' || !reconcileEnabled)
  const canStopAutomation = automationState === 'running' && reconcileEnabled
  const assistantProactiveMessage = buildAssistantProactiveMessage({
    goalKey: board?.goal.goalKey ?? goalKey ?? 'goal',
    automationDisplayState,
    reconcileEnabled,
    automationError: automationStatus?.error,
    totalTaskCount,
    doneTaskCount,
    blockedTaskCount,
    blockedTasks: attentionBlockedTasks,
    runnableTaskCount,
    runningTaskCount,
    timestamp: automationStatus?.endedAt ?? automationStatus?.startedAt ?? new Date().toISOString(),
  })

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#1A1A1A] relative">
      <header className="px-6 py-4 border-b border-[#333] shrink-0 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">{board?.goal.title}</h2>
          <p className="text-sm text-gray-400 mt-1">
            Goal Key:{' '}
            <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-purple-400">
              {board?.goal.goalKey}
            </code>
            {projectKey && (
              <>
                {' '}
                · Project:{' '}
                <code className="bg-[#2A2A2A] px-1.5 py-0.5 rounded text-amber-300">
                  {projectKey}
                </code>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {projectKey && (
            <>
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide',
                  automationStateClass,
                )}
              >
                {automationStateLabel}
                {automationStatus?.stepCount ? ` · ${automationStatus.stepCount} step(s)` : ''}
              </div>
              <button
                onClick={() => startAutomationMutation.mutate()}
                disabled={startAutomationMutation.isPending || !canStartAutomation}
                title={canStartAutomation ? 'Resume automation' : 'No runnable tasks'}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors font-medium disabled:opacity-60"
              >
                {startAutomationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                Start
              </button>
              <button
                onClick={() => stopAutomationMutation.mutate()}
                disabled={stopAutomationMutation.isPending || !canStopAutomation}
                className="flex items-center gap-2 px-4 py-2 bg-[#252525] hover:bg-[#2f2f2f] text-gray-200 rounded-lg transition-colors font-medium disabled:opacity-60"
              >
                {stopAutomationMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
                Stop
              </button>
            </>
          )}
          <button
            onClick={() => reconcileMutation.mutate()}
            disabled={reconcileMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-[#252525] hover:bg-[#2f2f2f] text-gray-200 rounded-lg transition-colors font-medium disabled:opacity-60"
          >
            {reconcileMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reconcile Once
          </button>
          <button
            onClick={() => setIsAssistantOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors font-medium shadow-lg shadow-purple-900/20"
          >
            <MessageSquare className="w-4 h-4" />
            Goal Assistant
          </button>
        </div>
      </header>

      <ScrollContainer axis="horizontal" className="flex-1" viewportClassName="h-full p-6">
        <div className="flex h-full min-h-0 min-w-max gap-6">
          {STATUS_COLUMNS.map((col) => (
            <div
              key={col.id}
              className="w-80 h-full min-h-0 shrink-0 overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <h3
                  className={cn(
                    'text-sm font-semibold px-3 py-1 border rounded-full uppercase tracking-wider',
                    col.color,
                  )}
                >
                  {col.label}
                </h3>
                <span className="text-xs text-gray-500 font-mono bg-[#2A2A2A] px-2 py-0.5 rounded-full">
                  {itemsByStatus[col.id]?.length || 0}
                </span>
              </div>

              <ScrollContainer
                axis="vertical"
                className="flex-1 min-h-0 overflow-hidden"
                viewportClassName="h-full pr-2"
              >
                <div className="flex flex-col gap-3">
                  {itemsByStatus[col.id]?.map((task) => (
                    <TaskCard
                      key={task.ref}
                      task={task}
                      displayId={taskDisplayIdByRef.get(task.ref) ?? task.ref}
                      taskDisplayIdByRef={taskDisplayIdByRef}
                      taskByRef={taskByRef}
                      selected={task.ref === selectedTaskRef}
                      onClick={() => handleTaskCardClick(task)}
                    />
                  ))}
                </div>
              </ScrollContainer>
            </div>
          ))}
        </div>
      </ScrollContainer>

      {!mvpMode && (
        <div className="border-t border-[#333] bg-[#151515] px-6 py-5 space-y-4 shrink-0 overflow-y-auto">
          <div className="grid gap-4 xl:grid-cols-2">
            <DecisionPanel
              decisions={decisions?.decisions ?? []}
              decisionDraft={decisionDraft}
              onDecisionDraftChange={(field, value) =>
                setDecisionDraft((current) => ({ ...current, [field]: value }))
              }
              onCreateDecision={() =>
                createDecisionMutation.mutate({
                  decisionKey: decisionDraft.decisionKey || undefined,
                  summary: decisionDraft.summary.trim(),
                  summaryKey: decisionDraft.summaryKey.trim() || undefined,
                  prompt: decisionDraft.prompt.trim() || undefined,
                  matchHints: parseListInput(decisionDraft.matchHints),
                  taskRef: decisionDraft.taskRef.trim() || undefined,
                })
              }
              createPending={createDecisionMutation.isPending}
              createError={createDecisionMutation.error}
              decisionResolutionDrafts={decisionResolutionDrafts}
              decisionFollowThroughDrafts={decisionFollowThroughDrafts}
              onDecisionResolutionDraftChange={(decisionKey, field, value) =>
                setDecisionResolutionDrafts((current) => ({
                  ...current,
                  [decisionKey]: {
                    ...(current[decisionKey] ?? DEFAULT_DECISION_RESOLUTION_DRAFT),
                    [field]: value,
                  },
                }))
              }
              onDecisionFollowThroughChange={(decisionKey, field, value) =>
                setDecisionFollowThroughDrafts((current) => ({
                  ...current,
                  [decisionKey]: {
                    ...(current[decisionKey] ?? DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT),
                    [field]: value,
                  },
                }))
              }
              onResolveDecision={(decision) =>
                resolveDecisionMutation.mutate({
                  decision,
                  resolutionDraft:
                    decisionResolutionDrafts[decision.decisionKey] ??
                    DEFAULT_DECISION_RESOLUTION_DRAFT,
                  followThroughDraft:
                    decisionFollowThroughDrafts[decision.decisionKey] ??
                    DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT,
                  existingState: currentPlanningMutationAuthoritySnapshot,
                })
              }
              resolvePendingDecisionKey={
                resolveDecisionMutation.isPending
                  ? (resolveDecisionMutation.variables?.decision.decisionKey ?? null)
                  : null
              }
              resolveError={resolveDecisionMutation.error}
              createResult={createDecisionMutation.data}
              resolveResultDecisionKey={
                resolveDecisionMutation.variables?.decision.decisionKey ?? null
              }
              resolveResult={resolveDecisionMutation.data}
              reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
              reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
              reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
              reusableTaskRefSuggestions={reusableTaskRefSuggestions}
              reusableBlockerSuggestions={reusableBlockerSuggestions}
              reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
              reusablePlanningGroupKeySuggestions={reusablePlanningGroupKeySuggestions}
              reusablePlanningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
              reusableBatchRequestSuggestions={reusableBatchRequestSuggestions}
              reusableBatchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
              reusableWorkflowKeySuggestions={reusableWorkflowKeySuggestions}
              reusableWorkflowContextSuggestions={reusableWorkflowContextSuggestions}
              reusableWorkflowGraphSuggestions={reusableWorkflowGraphSuggestions}
              reusableDecisionWorkflowChildSuggestions={reusableDecisionWorkflowChildSuggestions}
              reusableWorkflowTaskRefSuggestions={reusableWorkflowTaskRefSuggestions}
              reusableWorkflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
            />
            <PlanningRequestPanel
              requests={planningRequests?.requests ?? []}
              tasks={board?.items ?? []}
              planningDraft={planningDraft}
              onPlanningDraftChange={(field, value) =>
                setPlanningDraft((current) => ({ ...current, [field]: value }))
              }
              onPlanningDraftPrefill={(patch) =>
                setPlanningDraft((current) => ({ ...current, ...patch }))
              }
              onCreatePlanningRequest={() =>
                createPlanningRequestMutation.mutate({
                  ...materializePlanningRequestInput(planningDraft),
                  existingTaskRefs: (board?.items ?? []).map((task) => task.ref),
                })
              }
              createPending={createPlanningRequestMutation.isPending}
              createError={createPlanningRequestMutation.error}
              createResult={createPlanningRequestMutation.data}
              reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
              reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
              reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
              reusableDecisionRefSuggestions={reusableDecisionRefSuggestions}
              reusableBlockerSuggestions={reusableBlockerSuggestions}
              reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
              reusablePlanningGroupKeySuggestions={reusablePlanningGroupKeySuggestions}
              reusablePlanningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
            />
          </div>

          <div className="grid gap-4">
            <AnswerBundlePanel
              draft={answerBundleDraft}
              decisions={decisions?.decisions ?? []}
              onDraftChange={(patch) =>
                setAnswerBundleDraft((current) => ({
                  ...current,
                  ...patch,
                }))
              }
              followThroughDraft={answerBundleFollowThroughDraft}
              onFollowThroughChange={(field, value) =>
                setAnswerBundleFollowThroughDraft((current) => ({
                  ...current,
                  [field]: value,
                }))
              }
              onSubmit={() =>
                answerBundleMutation.mutate({
                  draft: answerBundleDraft,
                  followThroughDraft: answerBundleFollowThroughDraft,
                  existingState: currentPlanningMutationAuthoritySnapshot,
                })
              }
              submitPending={answerBundleMutation.isPending}
              submitError={answerBundleMutation.error}
              submitResult={answerBundleMutation.data}
              reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
              reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
              reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
              reusableDecisionAnswerSuggestions={reusableDecisionAnswerSuggestions}
              reusableTaskRefSuggestions={reusableTaskRefSuggestions}
              reusableBlockerSuggestions={reusableBlockerSuggestions}
              reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
              reusablePlanningGroupKeySuggestions={reusablePlanningGroupKeySuggestions}
              reusablePlanningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
              reusableBatchRequestSuggestions={reusableBatchRequestSuggestions}
              reusableBatchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
              reusableWorkflowKeySuggestions={reusableWorkflowKeySuggestions}
              reusableWorkflowContextSuggestions={reusableWorkflowContextSuggestions}
              reusableWorkflowGraphSuggestions={reusableWorkflowGraphSuggestions}
              reusableDecisionWorkflowChildSuggestions={reusableDecisionWorkflowChildSuggestions}
              reusableWorkflowTaskRefSuggestions={reusableWorkflowTaskRefSuggestions}
              reusableWorkflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <WorkflowPanel
              workflows={workflows?.workflows ?? []}
              tasks={board?.items ?? []}
              selectedWorkflowKey={selectedWorkflowKey}
              selectedWorkflow={selectedWorkflowDetail ?? null}
              workflowDetailLoading={isSelectedWorkflowLoading}
              workflowDetailError={selectedWorkflowError as Error | null}
              workflowDraft={workflowDraft}
              onWorkflowDraftChange={(field, value) =>
                setWorkflowDraft((current) => ({ ...current, [field]: value }))
              }
              onCreateWorkflow={() =>
                createWorkflowMutation.mutate({
                  workflow: materializeWorkflowMutationInput(workflowDraft),
                  existingState: currentPlanningMutationAuthoritySnapshot,
                })
              }
              createPending={createWorkflowMutation.isPending}
              createError={createWorkflowMutation.error}
              createResult={createWorkflowMutation.data}
              reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
              reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
              reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
              reusableDecisionRefSuggestions={reusableDecisionRefSuggestions}
              reusableBlockerSuggestions={reusableBlockerSuggestions}
              reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
              reusablePlanningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
              reusableBatchRequestSuggestions={reusableBatchRequestSuggestions}
              reusableBatchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
              reusableWorkflowKeySuggestions={reusableWorkflowKeySuggestions}
              reusableWorkflowContextSuggestions={reusableWorkflowContextSuggestions}
              reusableWorkflowGraphSuggestions={reusableWorkflowGraphSuggestions}
              reusableWorkflowChildSuggestions={reusableWorkflowChildSuggestions}
              reusableWorkflowTaskRefSuggestions={reusableWorkflowTaskRefSuggestions}
              reusableWorkflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
              onPrefillWorkflowKey={(workflowKey) =>
                setWorkflowDraft((current) => ({ ...current, workflowKey }))
              }
              onSelectWorkflow={handleSelectWorkflow}
              onPrefillReuseTaskRef={(taskRef, workflowKey) =>
                setWorkflowDraft((current) => ({
                  ...current,
                  workflowKey,
                  reuseTaskRef: taskRef,
                  reuseGroupKey: '',
                }))
              }
              onPrefillReuseGroupKey={(groupKey, workflowKey) =>
                setWorkflowDraft((current) => ({
                  ...current,
                  workflowKey,
                  reuseTaskRef: '',
                  reuseGroupKey: groupKey,
                  childKind: 'planning_batch',
                  groupKey,
                }))
              }
            />
            <PreferencePanel
              document={preferences}
              reusablePreferenceKeySuggestions={reusablePreferenceKeySuggestions}
              preferenceEditor={preferenceEditor}
              preferenceEditorDirty={preferenceEditorDirty}
              onPreferenceEditorChange={(value) => {
                setPreferenceEditor(value)
                setPreferenceEditorDirty(true)
              }}
              onSavePreferences={() => savePreferencesMutation.mutate(preferenceEditor)}
              savePending={savePreferencesMutation.isPending}
              saveError={savePreferencesMutation.error}
              preferenceDraft={preferenceDraft}
              onPreferenceDraftChange={(field, value) =>
                setPreferenceDraft((current) => ({ ...current, [field]: value }))
              }
              onRecordPreference={() =>
                recordPreferenceMutation.mutate({
                  preferenceKey: preferenceDraft.preferenceKey.trim() || undefined,
                  summary: preferenceDraft.summary.trim(),
                  rationale: preferenceDraft.rationale.trim() || undefined,
                  supersedes: parseListInput(preferenceDraft.supersedes),
                })
              }
              recordPending={recordPreferenceMutation.isPending}
              recordError={recordPreferenceMutation.error}
              saveResult={savePreferencesMutation.data}
              recordResult={recordPreferenceMutation.data}
              recordResultPreferenceKey={
                recordPreferenceMutation.variables?.preferenceKey?.trim() || null
              }
              recordResultSummary={recordPreferenceMutation.variables?.summary?.trim() || null}
              retireDraft={retireDraft}
              onRetireDraftChange={(field, value) =>
                setRetireDraft((current) => ({ ...current, [field]: value }))
              }
              onRetirePreference={() =>
                retirePreferenceMutation.mutate({
                  preferenceKey: retireDraft.preferenceKey,
                  reason: retireDraft.reason.trim(),
                  supersededBy: retireDraft.supersededBy.trim() || undefined,
                })
              }
              retirePending={retirePreferenceMutation.isPending}
              retireError={retirePreferenceMutation.error}
              retireResult={retirePreferenceMutation.data}
              retireResultPreferenceKey={retirePreferenceMutation.variables?.preferenceKey ?? null}
            />
          </div>

          <div className="grid gap-4">
            <TaskActionsPanel
              tasks={board?.items ?? []}
              createDraft={taskCreateDraft}
              onCreateDraftChange={(field, value) =>
                setTaskCreateDraft((current) => ({ ...current, [field]: value }))
              }
              onCreateTask={() => createTaskMutation.mutate(taskCreateDraft)}
              createPending={createTaskMutation.isPending}
              createError={createTaskMutation.error}
              createResult={createdTaskResult}
              moveDraft={taskMoveDraft}
              onMoveDraftChange={(field, value) =>
                setTaskMoveDraft((current) => ({ ...current, [field]: value }))
              }
              onSelectMoveTask={(taskRef) => {
                const selectedTask = (board?.items ?? []).find((item) => item.ref === taskRef)
                setTaskMoveDraft((current) => ({
                  ...current,
                  taskRef,
                  status: selectedTask?.status ?? current.status,
                }))
              }}
              onMoveTask={() => moveTaskMutation.mutate(taskMoveDraft)}
              movePending={moveTaskMutation.isPending}
              moveError={moveTaskMutation.error}
              moveResult={movedTaskResult}
              reusableBlockerSuggestions={reusableBlockerSuggestions}
              statusColumns={STATUS_COLUMNS}
            />
            <TaskAuthorityPanel
              task={selectedTask}
              showSessionDiagnostics={!mvpMode}
              linkedDecisions={selectedTaskDecisions}
              linkedPlanningRequests={selectedTaskPlanningRequests}
              linkedWorkflows={selectedTaskWorkflows}
              dependentTasks={selectedTaskDependents}
            />
          </div>
        </div>
      )}

      <AssistantPanel
        goalKey={board?.goal.goalKey || ''}
        projectKey={projectKey}
        isOpen={isAssistantOpen}
        onClose={() => setIsAssistantOpen(false)}
        proactiveMessage={assistantProactiveMessage}
      />
      <TaskRunHistoryModal
        goalKey={board?.goal.goalKey || ''}
        projectKey={projectKey}
        isOpen={isTaskHistoryModalOpen}
        task={selectedTask}
        runs={selectedTaskRuns}
        selectedRunId={selectedTaskRunId}
        onSelectRunId={setSelectedTaskRunId}
        runDetail={selectedTaskRunDetail}
        runDetailLoading={taskRunDetailQuery.isLoading}
        runDetailError={taskRunDetailQuery.error as Error | null}
        selectedStepId={selectedTaskRunStepId}
        onSelectStepId={setSelectedTaskRunStepId}
        onClose={() => setIsTaskHistoryModalOpen(false)}
      />
    </div>
  )
}
