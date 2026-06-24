import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import {
  type AutomationStatus,
  type GoalEvent,
  type GoalRunDetail,
  type GoalRunSummary,
  openGoalEventStream,
  readGoalAutomation,
  readGoalBoard,
  readGoalRun,
  readGoalRuns,
  reconcileGoal,
  startGoalAutomation,
  stopGoalAutomation,
  type TodoBoard,
} from '../lib/api'
import { goalScopedQueryKey } from '../lib/goalScope'
import { pickPreferredTaskRun, sortGoalRunsForRecency } from '../lib/runSelection'

type UseBoardViewModelArgs = { goalKeyProp?: string; projectKeyProp?: string }

export function useBoardViewModel({ goalKeyProp, projectKeyProp }: UseBoardViewModelArgs) {
  const routeParams = useParams<{ goalKey: string; projectKey: string }>()
  const goalKey = goalKeyProp ?? routeParams.goalKey
  const projectKey = projectKeyProp ?? routeParams.projectKey
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [isTaskHistoryModalOpen, setIsTaskHistoryModalOpen] = useState(false)
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(null)
  const [selectedTaskRunId, setSelectedTaskRunId] = useState<string | null>(null)
  const [selectedTaskRunStepId, setSelectedTaskRunStepId] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const goalQueryKey = (key: string, ...rest: Array<string | number | null>) =>
    goalScopedQueryKey(key, goalKey, projectKey, ...rest)

  const invalidateGoalKey = (key: string, ...rest: Array<string | number | null>) =>
    queryClient.invalidateQueries({ queryKey: goalQueryKey(key, ...rest) })

  const {
    data: board,
    isLoading,
    error,
    refetch,
  } = useQuery<TodoBoard>({
    queryKey: goalQueryKey('board'),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalBoard(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  const automationQuery = useQuery<{ status: AutomationStatus }>({
    queryKey: goalQueryKey('automation'),
    queryFn: async () => {
      if (!goalKey || !projectKey) {
        throw new Error('Missing project or goal key')
      }

      return readGoalAutomation(projectKey, goalKey)
    },
    enabled: Boolean(projectKey && goalKey),
    refetchOnWindowFocus: false,
  })

  const taskRunsQuery = useQuery<{ goalKey: string; runs: GoalRunSummary[] }>({
    queryKey: goalQueryKey('goal-runs'),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalRuns(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  const taskRunDetailQuery = useQuery<GoalRunDetail>({
    queryKey: goalQueryKey('goal-run-detail', selectedTaskRunId),
    queryFn: async () => {
      if (!goalKey || !selectedTaskRunId) {
        throw new Error('Missing task run selection')
      }

      return readGoalRun(goalKey, selectedTaskRunId, projectKey)
    },
    enabled: Boolean(goalKey && selectedTaskRunId),
  })

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return reconcileGoal(goalKey, projectKey)
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateGoalKey('board'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('goal-runs'),
        invalidateGoalKey('goal-run-detail'),
      ])
    },
  })

  const startAutomationMutation = useMutation({
    mutationFn: async () => {
      if (!projectKey || !goalKey) {
        throw new Error('Missing project or goal key')
      }

      return startGoalAutomation(projectKey, goalKey)
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateGoalKey('automation'),
        invalidateGoalKey('board'),
        invalidateGoalKey('goal-runs'),
        invalidateGoalKey('goal-run-detail'),
      ])
    },
  })

  const stopAutomationMutation = useMutation({
    mutationFn: async () => {
      if (!projectKey || !goalKey) {
        throw new Error('Missing project or goal key')
      }

      return stopGoalAutomation(projectKey, goalKey)
    },
    onSuccess: async () => {
      await invalidateGoalKey('automation')
    },
  })

  useEffect(() => {
    const boardItems = board?.items ?? []
    if (boardItems.length === 0) {
      if (selectedTaskRef !== null) {
        setSelectedTaskRef(null)
      }
      return
    }

    if (!selectedTaskRef) {
      setSelectedTaskRef(boardItems[0]?.ref ?? null)
      return
    }

    if (!boardItems.some((item) => item.ref === selectedTaskRef)) {
      setSelectedTaskRef(boardItems[0]?.ref ?? null)
    }
  }, [board?.items, selectedTaskRef])

  useEffect(() => {
    if (!selectedTaskRef) {
      if (selectedTaskRunId !== null) {
        setSelectedTaskRunId(null)
      }
      return
    }

    const runsForTask = sortGoalRunsForRecency(
      (taskRunsQuery.data?.runs ?? []).filter((run) => run.taskRef === selectedTaskRef),
    )
    const selectedTaskStatus =
      (board?.items ?? []).find((item) => item.ref === selectedTaskRef)?.status ?? null

    if (runsForTask.length === 0) {
      if (selectedTaskRunId !== null) {
        setSelectedTaskRunId(null)
      }
      return
    }

    const preferredRunId =
      pickPreferredTaskRun(
        taskRunsQuery.data?.runs ?? [],
        selectedTaskRef,
        null,
        selectedTaskStatus,
      )?.runId ?? null

    if (!selectedTaskRunId) {
      setSelectedTaskRunId(preferredRunId)
      return
    }

    if (!runsForTask.some((run) => run.runId === selectedTaskRunId)) {
      setSelectedTaskRunId(preferredRunId)
    }
  }, [board?.items, selectedTaskRef, selectedTaskRunId, taskRunsQuery.data?.runs])

  useEffect(() => {
    if (selectedTaskRunStepId !== null) {
      setSelectedTaskRunStepId(null)
    }
  }, [selectedTaskRunId, selectedTaskRunStepId])

  useEffect(() => {
    if (!goalKey) {
      return undefined
    }

    const matchesGoalEvent = (event: GoalEvent) =>
      event.goalKey === goalKey && (projectKey ? event.projectKey === projectKey : !event.projectKey)

    const eventSource = openGoalEventStream()
    eventSource.onmessage = (message) => {
      const data = JSON.parse(message.data) as GoalEvent

      if (data.type === 'board_changed' && matchesGoalEvent(data)) {
        refetch()
        void queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-runs') })
        void queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-run-detail') })
        void queryClient.invalidateQueries({ queryKey: goalQueryKey('goal-docs') })
      }

      if (data.type === 'automation_changed' && matchesGoalEvent(data)) {
        void queryClient.invalidateQueries({ queryKey: goalQueryKey('automation') })
      }

      if (data.type === 'assistant_changed' && matchesGoalEvent(data)) {
        void queryClient.invalidateQueries({ queryKey: goalQueryKey('assistant-feed') })
      }
    }

    return () => eventSource.close()
  }, [goalKey, projectKey, queryClient, refetch])

  return {
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
  }
}
