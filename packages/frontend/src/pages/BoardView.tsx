import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { AssistantPanel } from '../components/AssistantPanel'
import { ScrollContainer } from '../components/ScrollContainer'
import { TaskRunHistoryModal } from '../components/TaskRunHistoryModal'
import type { TaskStatus, TodoTaskItem } from '../lib/api'
import {
  pickPreferredTaskRun,
  sortTaskRunsForPresentation,
} from '../lib/runSelection'
import { cn } from '../lib/utils'
import { TaskCard } from './boardViewTaskPanelSupport'
import {
  buildAssistantProactiveMessage,
  buildTaskDisplayIdMap,
  hasActionRequiredBlocker,
  isRunnableTask,
} from './boardViewTaskSupport'
import { useBoardViewModel } from './useBoardViewModel'

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
}

export function BoardView({
  goalKey: goalKeyProp,
  projectKey: projectKeyProp,
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
    board,
    isLoading,
    error,
    automationQuery,
    taskRunsQuery,
    taskRunDetailQuery,
    reconcileMutation,
    startAutomationMutation,
    stopAutomationMutation,
  } = useBoardViewModel({ goalKeyProp, projectKeyProp })

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

  const selectedTask = selectedTaskRef
    ? ((board?.items ?? []).find((item) => item.ref === selectedTaskRef) ?? null)
    : null
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

    if (!goalKey) {
      return
    }

    setIsTaskHistoryModalOpen(true)
  }

  const selectedTaskRunDetail =
    selectedTaskRunId && taskRunDetailQuery.data?.runId === selectedTaskRunId
      ? taskRunDetailQuery.data
      : null
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
