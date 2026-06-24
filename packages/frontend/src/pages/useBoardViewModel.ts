import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import {
  answerGoalDecision,
  answerGoalDecisions,
  type AutomationStatus,
  type BlockerRef,
  createGoalDecision,
  createGoalPlanningRequest,
  createGoalPlanningWorkflow,
  createGoalTask,
  type GoalAnswerSourceInput,
  type GoalDecision,
  type GoalDecisionSet,
  type GoalEvent,
  type GoalPlanningRequestSet,
  type GoalPlanningWorkflowCreateInput,
  type GoalPlanningWorkflowState,
  type GoalRunDetail,
  type GoalRunSummary,
  type GoalSourceResponseFormat,
  moveGoalTask,
  openGoalEventStream,
  type PreferenceDocument,
  readGoalAutomation,
  readGoalBoard,
  readGoalDecisions,
  readGoalPlanningRequests,
  readGoalPlanningWorkflow,
  readGoalPlanningWorkflows,
  readGoalRun,
  readGoalRuns,
  readPreferences,
  reconcileGoal,
  recordPreference,
  resolveGoalDecision,
  retirePreference,
  startGoalAutomation,
  stopGoalAutomation,
  type TodoBoard,
  type InterpretablePlanningAnswerInput,
  updatePreferences,
} from '../lib/api'
import { pickPreferredTaskRun, sortGoalRunsForRecency } from '../lib/runSelection'
import { parseListInput } from './boardViewStructuredEditors'
import type { DecisionFollowThroughDraft } from './boardViewStructuredEditorTypes'
import {
  type ExistingPlanningMutationAuthoritySnapshot,
  type GoalDecisionAnswerBatchResultWithReuse,
  type GoalDecisionAnswerResultWithReuse,
  type GoalDecisionResolveMutationResult,
  type GoalPlanningWorkflowCreateResultWithReuse,
  buildExistingPlanningMutationAuthoritySnapshot,
  enrichDecisionFollowThroughResultWithReuse,
  enrichWorkflowCreateResultWithReuse,
} from './boardViewMutationResultSupport'
import { parseBlockerRefsJson } from './boardViewJsonInputSupport'
import { materializeDecisionAnswerBatchInput, materializeDecisionFollowThroughInput, materializeDecisionResolutionInput, materializeSingleDecisionAnswerInput } from './boardViewDecisionMutationSupport'
import { extractWorkflowKeyFromDecisionMutationResult } from './boardViewWorkflowMutationSupport'
import {
  type AnswerBundleDraft,
  type DecisionResolutionDraft,
  DEFAULT_ANSWER_BUNDLE_DRAFT,
  DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT,
  DEFAULT_DECISION_RESOLUTION_DRAFT,
  DEFAULT_TASK_CREATE_DRAFT,
  DEFAULT_TASK_MOVE_DRAFT,
  type TaskCreateDraft,
  type TaskMoveDraft,
} from './boardViewDraftSupport'

type UseBoardViewModelArgs = { goalKeyProp?: string; projectKeyProp?: string; mvpMode: boolean }

export function useBoardViewModel({ goalKeyProp, projectKeyProp, mvpMode }: UseBoardViewModelArgs) {
  const routeParams = useParams<{ goalKey: string; projectKey: string }>()
  const goalKey = goalKeyProp ?? routeParams.goalKey
  const projectKey = projectKeyProp ?? routeParams.projectKey
  const goalScope = projectKey ?? '__legacy__'
  const [isAssistantOpen, setIsAssistantOpen] = useState(false)
  const [isTaskHistoryModalOpen, setIsTaskHistoryModalOpen] = useState(false)
  const [selectedTaskRef, setSelectedTaskRef] = useState<string | null>(null)
  const [selectedTaskRunId, setSelectedTaskRunId] = useState<string | null>(null)
  const [selectedTaskRunStepId, setSelectedTaskRunStepId] = useState<string | null>(null)
  const [decisionDraft, setDecisionDraft] = useState({
    decisionKey: '',
    summary: '',
    summaryKey: '',
    prompt: '',
    matchHints: '',
    taskRef: '',
  })
  const [decisionResolutionDrafts, setDecisionResolutionDrafts] = useState<
    Record<string, DecisionResolutionDraft>
  >({})
  const [decisionFollowThroughDrafts, setDecisionFollowThroughDrafts] = useState<
    Record<string, DecisionFollowThroughDraft>
  >({})
  const [answerBundleDraft, setAnswerBundleDraft] = useState<AnswerBundleDraft>({
    ...DEFAULT_ANSWER_BUNDLE_DRAFT,
  })
  const [answerBundleFollowThroughDraft, setAnswerBundleFollowThroughDraft] =
    useState<DecisionFollowThroughDraft>({
      ...DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT,
    })
  const [planningDraft, setPlanningDraft] = useState({
    requestKey: '',
    groupKey: '',
    groupTaskKey: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    decisionRefs: '',
    answersJson: '',
    answerSourcesJson: '',
    sourceResponse: '',
    sourceResponseFormat: 'auto' as GoalSourceResponseFormat,
    inferRemainingAnswers: false,
    requestedUpdates: '',
    blockedByJson: '',
  })
  const [workflowDraft, setWorkflowDraft] = useState({
    workflowKey: '',
    reuseTaskRef: '',
    reuseGroupKey: '',
    sharedDecisionRefs: '',
    sharedAnswersJson: '',
    answerSourcesJson: '',
    sourceResponse: '',
    sourceResponseFormat: 'auto' as GoalSourceResponseFormat,
    inferRemainingAnswers: false,
    childKind: 'planning' as 'planning' | 'planning_batch',
    requestKey: '',
    workflowTaskKey: '',
    groupKey: '',
    blockedByWorkflowKeys: '',
    childBlockedByJson: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    requestedUpdates: '',
    childDecisionRefs: '',
    childAnswersJson: '',
    batchRequestsJson: '',
    childrenJson: '',
  })
  const [selectedWorkflowKey, setSelectedWorkflowKey] = useState<string | null>(null)
  const [pendingWorkflowSelectionKey, setPendingWorkflowSelectionKey] = useState<string | null>(
    null,
  )
  const [taskCreateDraft, setTaskCreateDraft] = useState<TaskCreateDraft>({
    ...DEFAULT_TASK_CREATE_DRAFT,
  })
  const [taskMoveDraft, setTaskMoveDraft] = useState<TaskMoveDraft>({
    ...DEFAULT_TASK_MOVE_DRAFT,
  })
  const [preferenceEditor, setPreferenceEditor] = useState('')
  const [preferenceEditorDirty, setPreferenceEditorDirty] = useState(false)
  const [preferenceDraft, setPreferenceDraft] = useState({
    preferenceKey: '',
    summary: '',
    rationale: '',
    supersedes: '',
  })
  const [retireDraft, setRetireDraft] = useState({
    preferenceKey: '',
    reason: '',
    supersededBy: '',
  })
  const queryClient = useQueryClient()
  const goalQueryKey = (key: string, ...rest: Array<string | number | null>) => [
    key,
    goalScope,
    goalKey,
    ...rest,
  ]
  const invalidateGoalKey = (key: string, ...rest: Array<string | number | null>) =>
    queryClient.invalidateQueries({ queryKey: goalQueryKey(key, ...rest) })

  const queueWorkflowSelection = (workflowKey?: string | null) => {
    const nextWorkflowKey = workflowKey?.trim() ?? ''
    if (!nextWorkflowKey) {
      return
    }

    setPendingWorkflowSelectionKey(nextWorkflowKey)
  }

  const handleSelectWorkflow = (workflowKey: string | null) => {
    setPendingWorkflowSelectionKey(null)
    setSelectedWorkflowKey(workflowKey)
  }

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

  const { data: decisions } = useQuery<GoalDecisionSet>({
    queryKey: goalQueryKey('goal-decisions'),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalDecisions(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  const { data: planningRequests } = useQuery<GoalPlanningRequestSet>({
    queryKey: goalQueryKey('planning-requests'),
    queryFn: async () => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return readGoalPlanningRequests(goalKey, projectKey)
    },
    enabled: Boolean(goalKey),
  })

  const { data: workflows } = useQuery<{ goalKey: string; workflows: GoalPlanningWorkflowState[] }>(
    {
      queryKey: goalQueryKey('planning-workflows'),
      queryFn: async () => {
        if (!goalKey) {
          throw new Error('Missing goal key')
        }

        return readGoalPlanningWorkflows(goalKey, projectKey)
      },
      enabled: Boolean(goalKey),
    },
  )

  const currentPlanningMutationAuthoritySnapshot = buildExistingPlanningMutationAuthoritySnapshot(
    board,
    planningRequests,
    workflows,
  )

  const {
    data: selectedWorkflowDetail,
    isLoading: isSelectedWorkflowLoading,
    error: selectedWorkflowError,
  } = useQuery<GoalPlanningWorkflowState>({
    queryKey: goalQueryKey('planning-workflow-detail', selectedWorkflowKey),
    queryFn: async () => {
      if (!goalKey || !selectedWorkflowKey) {
        throw new Error('Missing workflow selection')
      }

      return readGoalPlanningWorkflow(goalKey, selectedWorkflowKey, projectKey)
    },
    enabled: Boolean(goalKey && selectedWorkflowKey),
  })

  const { data: preferences } = useQuery<PreferenceDocument>({
    queryKey: ['preferences'],
    queryFn: readPreferences,
    enabled: !mvpMode,
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
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
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

  const createDecisionMutation = useMutation({
    mutationFn: async (input: {
      decisionKey?: string
      summary: string
      summaryKey?: string
      prompt?: string
      matchHints?: string[]
      taskRef?: string
    }) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return createGoalDecision(goalKey, input, projectKey)
    },
    onSuccess: async () => {
      setDecisionDraft({
        decisionKey: '',
        summary: '',
        summaryKey: '',
        prompt: '',
        matchHints: '',
        taskRef: '',
      })
      await Promise.all([
        invalidateGoalKey('goal-decisions'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('board'),
      ])
    },
  })

  const resolveDecisionMutation = useMutation({
    mutationFn: async (input: {
      decision: GoalDecision
      resolutionDraft: DecisionResolutionDraft
      followThroughDraft?: DecisionFollowThroughDraft
      existingState: ExistingPlanningMutationAuthoritySnapshot
    }): Promise<GoalDecisionResolveMutationResult> => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      const followThrough = input.followThroughDraft
        ? materializeDecisionFollowThroughInput(input.followThroughDraft)
        : undefined

      const result = await resolveGoalDecision(
        goalKey,
        input.decision.decisionKey,
        materializeDecisionResolutionInput(input.decision, input.resolutionDraft, followThrough),
        projectKey,
      )

      return result.followThrough
        ? {
            ...result,
            followThrough: enrichDecisionFollowThroughResultWithReuse(
              result.followThrough,
              input.existingState,
            ),
          }
        : {
            ...result,
            followThrough: undefined,
          }
    },
    onSuccess: async (result, variables) => {
      queueWorkflowSelection(extractWorkflowKeyFromDecisionMutationResult(result))
      setDecisionResolutionDrafts((current) => ({
        ...current,
        [variables.decision.decisionKey]: { ...DEFAULT_DECISION_RESOLUTION_DRAFT },
      }))
      setDecisionFollowThroughDrafts((current) => ({
        ...current,
        [variables.decision.decisionKey]: { ...DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT },
      }))
      await Promise.all([
        invalidateGoalKey('goal-decisions'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-requests'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('board'),
      ])
    },
  })

  const answerBundleMutation = useMutation({
    mutationFn: async (input: {
      draft: AnswerBundleDraft
      followThroughDraft: DecisionFollowThroughDraft
      existingState: ExistingPlanningMutationAuthoritySnapshot
    }): Promise<GoalDecisionAnswerResultWithReuse | GoalDecisionAnswerBatchResultWithReuse> => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      const followThrough = materializeDecisionFollowThroughInput(input.followThroughDraft)
      if (input.draft.mode === 'single') {
        const result = await answerGoalDecision(
          goalKey,
          materializeSingleDecisionAnswerInput(input.draft, followThrough),
          projectKey,
        )
        return result.followThrough
          ? {
              ...result,
              followThrough: enrichDecisionFollowThroughResultWithReuse(
                result.followThrough,
                input.existingState,
              ),
            }
          : {
              ...result,
              followThrough: undefined,
            }
      }

      const result = await answerGoalDecisions(
        goalKey,
        materializeDecisionAnswerBatchInput(input.draft, followThrough, decisions?.decisions ?? []),
        projectKey,
      )
      return result.followThrough
        ? {
            ...result,
            followThrough: enrichDecisionFollowThroughResultWithReuse(
              result.followThrough,
              input.existingState,
            ),
          }
        : {
            ...result,
            followThrough: undefined,
          }
    },
    onSuccess: async (result) => {
      queueWorkflowSelection(extractWorkflowKeyFromDecisionMutationResult(result))
      setAnswerBundleDraft({ ...DEFAULT_ANSWER_BUNDLE_DRAFT })
      setAnswerBundleFollowThroughDraft({ ...DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT })
      await Promise.all([
        invalidateGoalKey('goal-decisions'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-requests'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('board'),
      ])
    },
  })

  const createPlanningRequestMutation = useMutation({
    mutationFn: async (input: {
      requestKey?: string
      groupKey?: string
      groupTaskKey?: string
      title: string
      description: string
      acceptanceCriteria: string[]
      decisionRefs?: string[]
      answers?: InterpretablePlanningAnswerInput[]
      answerSources?: GoalAnswerSourceInput[]
      sourceResponse?: string
      sourceResponseFormat?: GoalSourceResponseFormat
      inferRemainingAnswers?: boolean
      requestedUpdates?: string[]
      blockedBy?: BlockerRef[]
      existingTaskRefs: string[]
    }) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      const { existingTaskRefs, ...requestInput } = input
      const result = await createGoalPlanningRequest(goalKey, requestInput, projectKey)
      return {
        ...result,
        taskCreated: !existingTaskRefs.includes(result.taskRef),
      }
    },
    onSuccess: async () => {
      setPlanningDraft({
        requestKey: '',
        groupKey: '',
        groupTaskKey: '',
        title: '',
        description: '',
        acceptanceCriteria: '',
        decisionRefs: '',
        answersJson: '',
        answerSourcesJson: '',
        sourceResponse: '',
        sourceResponseFormat: 'auto',
        inferRemainingAnswers: false,
        requestedUpdates: '',
        blockedByJson: '',
      })
      await Promise.all([
        invalidateGoalKey('planning-requests'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('board'),
      ])
    },
  })

  const createWorkflowMutation = useMutation({
    mutationFn: async (input: {
      workflow: GoalPlanningWorkflowCreateInput
      existingState: ExistingPlanningMutationAuthoritySnapshot
    }): Promise<GoalPlanningWorkflowCreateResultWithReuse> => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      const result = await createGoalPlanningWorkflow(goalKey, input.workflow, projectKey)
      return enrichWorkflowCreateResultWithReuse(result, input.existingState)
    },
    onSuccess: async (result) => {
      const nextWorkflowKey = result.workflowKey ?? null
      setWorkflowDraft({
        workflowKey: '',
        reuseTaskRef: '',
        reuseGroupKey: '',
        sharedDecisionRefs: '',
        sharedAnswersJson: '',
        answerSourcesJson: '',
        sourceResponse: '',
        sourceResponseFormat: 'auto',
        inferRemainingAnswers: false,
        childKind: 'planning',
        requestKey: '',
        workflowTaskKey: '',
        groupKey: '',
        blockedByWorkflowKeys: '',
        childBlockedByJson: '',
        title: '',
        description: '',
        acceptanceCriteria: '',
        requestedUpdates: '',
        childDecisionRefs: '',
        childAnswersJson: '',
        batchRequestsJson: '',
        childrenJson: '',
      })
      queueWorkflowSelection(nextWorkflowKey)
      await Promise.all([
        invalidateGoalKey('planning-requests'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('board'),
      ])
    },
  })

  const createTaskMutation = useMutation({
    mutationFn: async (input: TaskCreateDraft) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return createGoalTask(
        goalKey,
        {
          ref: input.ref.trim(),
          kind: input.kind,
          title: input.title.trim(),
          description: input.description.trim(),
          acceptanceCriteria: parseListInput(input.acceptanceCriteria),
          blockedBy: input.blockedByJson.trim()
            ? parseBlockerRefsJson(input.blockedByJson, 'Task blockers')
            : undefined,
        },
        projectKey,
      )
    },
    onSuccess: async (result, variables) => {
      setTaskCreateDraft({ ...DEFAULT_TASK_CREATE_DRAFT })
      const createdTask = result.items.find((item) => item.ref === variables.ref.trim())
      setTaskMoveDraft({
        taskRef: createdTask?.ref ?? variables.ref.trim(),
        status: createdTask?.status ?? 'planned',
        reason: 'manual transition',
      })
      await Promise.all([
        invalidateGoalKey('board'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('goal-runs'),
        invalidateGoalKey('goal-run-detail'),
      ])
    },
  })

  const moveTaskMutation = useMutation({
    mutationFn: async (input: TaskMoveDraft) => {
      if (!goalKey) {
        throw new Error('Missing goal key')
      }

      return moveGoalTask(
        goalKey,
        input.taskRef,
        {
          status: input.status,
          reason: input.reason.trim() || 'manual transition',
        },
        projectKey,
      )
    },
    onSuccess: async (result, variables) => {
      const movedTask = result.items.find((item) => item.ref === variables.taskRef)
      setTaskMoveDraft((current) => ({
        taskRef: movedTask?.ref ?? current.taskRef,
        status: movedTask?.status ?? current.status,
        reason: 'manual transition',
      }))
      await Promise.all([
        invalidateGoalKey('board'),
        invalidateGoalKey('goal-docs'),
        invalidateGoalKey('planning-workflows'),
        invalidateGoalKey('planning-workflow-detail'),
        invalidateGoalKey('goal-runs'),
        invalidateGoalKey('goal-run-detail'),
      ])
    },
  })

  const savePreferencesMutation = useMutation({
    mutationFn: async (content: string) => updatePreferences(content),
    onSuccess: async (document) => {
      setPreferenceEditor(document.content)
      setPreferenceEditorDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const recordPreferenceMutation = useMutation({
    mutationFn: async (input: {
      preferenceKey?: string
      summary: string
      rationale?: string
      supersedes?: string[]
    }) => recordPreference(input),
    onSuccess: async () => {
      setPreferenceDraft({
        preferenceKey: '',
        summary: '',
        rationale: '',
        supersedes: '',
      })
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  const retirePreferenceMutation = useMutation({
    mutationFn: async (input: {
      preferenceKey: string
      reason: string
      supersededBy?: string
    }) => retirePreference(input),
    onSuccess: async () => {
      setRetireDraft((current) => ({
        preferenceKey: current.preferenceKey,
        reason: '',
        supersededBy: '',
      }))
      await queryClient.invalidateQueries({ queryKey: ['preferences'] })
    },
  })

  useEffect(() => {
    if (!preferenceEditorDirty && preferences?.content !== undefined) {
      setPreferenceEditor(preferences.content)
    }
  }, [preferenceEditorDirty, preferences?.content])

  useEffect(() => {
    const activeEntries = preferences?.entries.filter((entry) => entry.status === 'active') ?? []
    const activeKeys = activeEntries.map((entry) => entry.preferenceKey)
    setRetireDraft((current) => {
      if (current.preferenceKey && activeKeys.includes(current.preferenceKey)) {
        return current
      }
      return {
        ...current,
        preferenceKey: activeKeys[0] ?? '',
      }
    })
  }, [preferences?.entries])

  useEffect(() => {
    const workflowItems = workflows?.workflows ?? []
    if (workflowItems.length === 0) {
      if (selectedWorkflowKey !== null) {
        setSelectedWorkflowKey(null)
      }
      return
    }

    if (pendingWorkflowSelectionKey) {
      if (workflowItems.some((workflow) => workflow.workflowKey === pendingWorkflowSelectionKey)) {
        if (selectedWorkflowKey !== pendingWorkflowSelectionKey) {
          setSelectedWorkflowKey(pendingWorkflowSelectionKey)
        }
        setPendingWorkflowSelectionKey(null)
      }
      return
    }

    if (!selectedWorkflowKey) {
      setSelectedWorkflowKey(workflowItems[0]?.workflowKey ?? null)
      return
    }

    if (!workflowItems.some((workflow) => workflow.workflowKey === selectedWorkflowKey)) {
      setSelectedWorkflowKey(workflowItems[0]?.workflowKey ?? null)
    }
  }, [pendingWorkflowSelectionKey, selectedWorkflowKey, workflows?.workflows])

  useEffect(() => {
    const boardItems = board?.items ?? []
    if (boardItems.length === 0) {
      if (selectedTaskRef !== null) {
        setSelectedTaskRef(null)
      }
      if (taskMoveDraft.taskRef || taskMoveDraft.status !== 'planned') {
        setTaskMoveDraft({ ...DEFAULT_TASK_MOVE_DRAFT })
      }
      return
    }

    if (!selectedTaskRef) {
      setSelectedTaskRef(boardItems[0]?.ref ?? null)
    } else if (!boardItems.some((item) => item.ref === selectedTaskRef)) {
      setSelectedTaskRef(boardItems[0]?.ref ?? null)
    }

    if (!taskMoveDraft.taskRef) {
      setTaskMoveDraft({
        taskRef: boardItems[0].ref,
        status: boardItems[0].status,
        reason: 'manual transition',
      })
      return
    }

    if (!boardItems.some((item) => item.ref === taskMoveDraft.taskRef)) {
      setTaskMoveDraft({
        taskRef: boardItems[0].ref,
        status: boardItems[0].status,
        reason: 'manual transition',
      })
    }
  }, [board?.items, selectedTaskRef, taskMoveDraft.taskRef, taskMoveDraft.status])

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

    if (!selectedTaskRunId) {
      setSelectedTaskRunId(
        pickPreferredTaskRun(
          taskRunsQuery.data?.runs ?? [],
          selectedTaskRef,
          null,
          selectedTaskStatus,
        )?.runId ?? null,
      )
      return
    }

    if (!runsForTask.some((run) => run.runId === selectedTaskRunId)) {
      setSelectedTaskRunId(
        pickPreferredTaskRun(
          taskRunsQuery.data?.runs ?? [],
          selectedTaskRef,
          null,
          selectedTaskStatus,
        )?.runId ?? null,
      )
    }
  }, [board?.items, selectedTaskRef, selectedTaskRunId, taskRunsQuery.data?.runs])

  useEffect(() => {
    if (selectedTaskRunStepId !== null) {
      setSelectedTaskRunStepId(null)
    }
  }, [selectedTaskRunId])

  useEffect(() => {
    if (!goalKey) {
      return undefined
    }

    const matchesGoalEvent = (data: GoalEvent) =>
      data.goalKey === goalKey && (projectKey ? data.projectKey === projectKey : !data.projectKey)
    const scopedGoalQueryKey = (key: string, ...rest: Array<string | number | null>) => [
      key,
      goalScope,
      goalKey,
      ...rest,
    ]

    const evtSource = openGoalEventStream()
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data) as GoalEvent
      if (data.type === 'board_changed' && matchesGoalEvent(data)) {
        refetch()
        void queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-runs') })
        void queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-run-detail') })
        void queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-docs') })
        void queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('planning-workflows') })
        void queryClient.invalidateQueries({
          queryKey: scopedGoalQueryKey('planning-workflow-detail'),
        })
      }
      if (data.type === 'decisions_changed' && matchesGoalEvent(data)) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-decisions') }),
          queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-docs') }),
        ])
      }
      if (data.type === 'planning_requests_changed' && matchesGoalEvent(data)) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('planning-requests') }),
          queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('planning-workflows') }),
          queryClient.invalidateQueries({
            queryKey: scopedGoalQueryKey('planning-workflow-detail'),
          }),
          queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('goal-docs') }),
        ])
      }
      if (data.type === 'automation_changed' && matchesGoalEvent(data)) {
        void queryClient.invalidateQueries({ queryKey: scopedGoalQueryKey('automation') })
      }
      if (data.type === 'preferences_changed') {
        void queryClient.invalidateQueries({ queryKey: ['preferences'] })
      }
    }
    return () => evtSource.close()
  }, [goalKey, goalScope, projectKey, queryClient, refetch])

  return {
    goalKey, projectKey,
    isAssistantOpen, setIsAssistantOpen,
    isTaskHistoryModalOpen, setIsTaskHistoryModalOpen,
    selectedTaskRef, setSelectedTaskRef,
    selectedTaskRunId, setSelectedTaskRunId,
    selectedTaskRunStepId, setSelectedTaskRunStepId,
    decisionDraft, setDecisionDraft,
    decisionResolutionDrafts, setDecisionResolutionDrafts,
    decisionFollowThroughDrafts, setDecisionFollowThroughDrafts,
    answerBundleDraft, setAnswerBundleDraft,
    answerBundleFollowThroughDraft, setAnswerBundleFollowThroughDraft,
    planningDraft, setPlanningDraft,
    workflowDraft, setWorkflowDraft,
    selectedWorkflowKey,
    taskCreateDraft, setTaskCreateDraft,
    taskMoveDraft, setTaskMoveDraft,
    preferenceEditor, setPreferenceEditor,
    preferenceEditorDirty, setPreferenceEditorDirty,
    preferenceDraft, setPreferenceDraft,
    retireDraft, setRetireDraft,
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
  }
}
