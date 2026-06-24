import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AssistantPanel } from '../components/AssistantPanel'
import { ScrollContainer } from '../components/ScrollContainer'
import { TaskRunHistoryModal } from '../components/TaskRunHistoryModal'
import {
  readProjectGoals,
  readProjects,
  type ProjectGoalSummary,
  type ProjectRecord,
  type TaskStatus,
  type TodoTaskItem,
} from '../lib/api'
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
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [switchingProjectKey, setSwitchingProjectKey] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
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
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: readProjects,
  })
  const projectGoalsQuery = useQuery({
    queryKey: ['project-goals', projectKey],
    queryFn: async () => {
      if (!projectKey) {
        throw new Error('Missing project key')
      }

      return readProjectGoals(projectKey)
    },
    enabled: Boolean(projectKey),
  })

  const projects = projectsQuery.data?.projects ?? []
  const projectGoalsPayload = projectGoalsQuery.data
  const projectGoals =
    projectGoalsPayload && projectGoalsPayload.projectKey === projectKey
      ? projectGoalsPayload.goals
      : []
  const selectableGoals = buildSelectableGoals(
    projectGoals,
    board?.goal.goalKey ?? goalKey ?? null,
    board?.goal.title,
  )
  const currentProject = projectKey
    ? projects.find((project) => project.projectKey === projectKey) ?? null
    : null

  const handleGoalSwitch = (nextGoalKey: string) => {
    if (!projectKey || !nextGoalKey || nextGoalKey === goalKey) {
      return
    }

    setSwitchError(null)
    navigate(buildBoardRoute(projectKey, nextGoalKey))
  }

  const handleProjectSwitch = async (nextProject: ProjectRecord) => {
    if (nextProject.projectKey === projectKey) {
      return
    }

    setSwitchingProjectKey(nextProject.projectKey)
    setSwitchError(null)

    try {
      const fallbackGoalKey =
        nextProject.lastOpenedGoalKey ??
        (await queryClient.fetchQuery({
          queryKey: ['project-goals', nextProject.projectKey],
          queryFn: () => readProjectGoals(nextProject.projectKey),
        })).goals[0]?.goalKey ??
        null

      if (fallbackGoalKey) {
        navigate(buildBoardRoute(nextProject.projectKey, fallbackGoalKey))
        return
      }

      navigate(`/projects/${encodeURIComponent(nextProject.projectKey)}/goals/new`)
    } catch (switchFailure) {
      setSwitchError((switchFailure as Error).message)
    } finally {
      setSwitchingProjectKey((current) =>
        current === nextProject.projectKey ? null : current,
      )
    }
  }

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
      <header className="border-b border-[#333] shrink-0">
        {projectKey && projects.length > 0 && (
          <div className="border-b border-[#2a2a2a] px-6 py-2.5">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
                Projects
              </div>
              <div className="min-w-0 flex-1 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                  {projects.map((project) => {
                    const isActive = project.projectKey === projectKey
                    const isSwitching = switchingProjectKey === project.projectKey
                    return (
                      <button
                        key={project.projectKey}
                        type="button"
                        onClick={() => void handleProjectSwitch(project)}
                        disabled={isSwitching || projectsQuery.isLoading}
                        className={cn(
                          'group flex min-w-[11rem] items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-70',
                          isActive
                            ? 'border-amber-400/50 bg-amber-500/12 text-amber-100'
                            : 'border-[#333] bg-[#161616] text-gray-200 hover:border-[#444] hover:bg-[#1d1d1d]',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-semibold">{project.name}</div>
                            {isActive && (
                              <span className="shrink-0 rounded-full border border-amber-300/35 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                                current
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400">
                            <code
                              className={cn(
                                'rounded px-1.5 py-0.5',
                                isActive
                                  ? 'bg-amber-500/10 text-amber-200'
                                  : 'bg-[#222] text-gray-300',
                              )}
                            >
                              {project.projectKey}
                            </code>
                            <span className="truncate">
                              {project.lastOpenedGoalKey
                                ? `Last goal: ${project.lastOpenedGoalKey}`
                                : 'No goal opened yet'}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {isSwitching ? (
                            <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                          ) : (
                            <span
                              className={cn(
                                'text-[11px] font-medium',
                                isActive
                                  ? 'text-amber-300'
                                  : 'text-gray-500 group-hover:text-gray-300',
                              )}
                            >
                              {isActive ? 'Live' : 'Open'}
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="shrink-0 text-[11px] text-gray-500">
                {projects.length} linked
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-3.5 flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-6">
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

            {projectKey && (
              <label className="min-w-[18rem] max-w-full flex-1 sm:max-w-sm">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-500">
                  Goal Quick Switch
                  {currentProject ? ` · ${currentProject.name}` : ''}
                </span>
                <select
                  value={selectableGoals.length > 0 ? (board?.goal.goalKey ?? goalKey ?? '') : ''}
                  onChange={(event) => handleGoalSwitch(event.target.value)}
                  disabled={projectGoalsQuery.isLoading || selectableGoals.length === 0}
                  className="w-full rounded-xl border border-[#333] bg-[#161616] px-4 py-3 text-sm text-white outline-none transition-colors focus:border-purple-400 disabled:cursor-not-allowed disabled:text-gray-500"
                >
                  {selectableGoals.length === 0 ? (
                    <option value="">
                      {projectGoalsQuery.isLoading ? 'Loading goals...' : 'No goals in this project yet'}
                    </option>
                  ) : null}
                  {selectableGoals.map((goal) => (
                    <option key={goal.goalKey} value={goal.goalKey}>
                      {formatGoalOptionLabel(goal)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {switchError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              Failed to switch board: {switchError}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
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

function buildBoardRoute(projectKey: string, goalKey: string) {
  return `/projects/${encodeURIComponent(projectKey)}/board/${encodeURIComponent(goalKey)}`
}

function formatGoalOptionLabel(goal: ProjectGoalSummary) {
  const trimmedTitle = goal.title.trim()
  return trimmedTitle && trimmedTitle !== goal.goalKey
    ? `${trimmedTitle} (${goal.goalKey})`
    : goal.goalKey
}

function buildSelectableGoals(
  projectGoals: ProjectGoalSummary[],
  currentGoalKey: string | null,
  currentGoalTitle?: string,
) {
  const goalsByKey = new Map(projectGoals.map((goal) => [goal.goalKey, goal] as const))
  if (!currentGoalKey || goalsByKey.has(currentGoalKey)) {
    return projectGoals
  }

  return [
    {
      goalKey: currentGoalKey,
      title: currentGoalTitle?.trim() || currentGoalKey,
    },
    ...projectGoals,
  ]
}
