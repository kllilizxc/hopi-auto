import type { BlockerRef } from '../domain/board'
import type { BoardStore } from '../storage/boardStore'
import type {
  GoalPlanningRequest,
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
  PlanningRequestStore,
} from '../storage/planningRequestStore'

export interface GoalPlanningRequestInput {
  goalKey: string
  requestKey?: string
  workflowKey?: string
  workflowTaskKey?: string
  workflowSharedDecisionRefs?: string[]
  workflowSharedAnswers?: GoalPlanningRequestAnswer[]
  blockedByWorkflowKeys?: string[]
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  decisionRefs?: string[]
  answers?: GoalPlanningRequestAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
  blockedBy?: BlockerRef[]
  reuseTaskRef?: string
  writer?: string
  reason?: string
}

export interface GoalPlanningRequestResult {
  request: GoalPlanningRequest
  created: boolean
  taskCreated: boolean
}

export interface GoalPlanningBatchEntryInput {
  taskKey: string
  requestKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
  blockedBy?: BlockerRef[]
  blockedByTaskKeys?: string[]
}

export interface GoalPlanningBatchResult {
  groupKey: string
  entries: Array<{
    taskKey: string
    requestKey: string
    taskRef: string
    created: boolean
    taskCreated: boolean
  }>
}

export interface GoalPlanningWorkflowInput {
  kind: 'planning'
  requestKey?: string
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  groupKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  decisionRefs?: string[]
  answers?: GoalPlanningRequestAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
  blockedBy?: BlockerRef[]
}

export interface GoalPlanningWorkflowBatchInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  decisionRefs?: string[]
  answers?: GoalPlanningRequestAnswer[]
  requests?: GoalPlanningBatchEntryInput[]
}

export type GoalPlanningWorkflowLeafInput =
  | GoalPlanningWorkflowInput
  | GoalPlanningWorkflowBatchInput

export interface GoalPlanningWorkflowResult {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export interface GoalPlanningWorkflowBatchResult {
  kind: 'planning_batch'
  groupKey: string
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export type GoalPlanningWorkflowLeafResult =
  | GoalPlanningWorkflowResult
  | GoalPlanningWorkflowBatchResult

export interface GoalPlanningWorkflowPlanningState {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  blockedByWorkflowKeys: string[]
  request: GoalPlanningRequest
  blockerTaskRefs: string[]
}

export interface GoalPlanningWorkflowPlanningBatchState {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys: string[]
  requests: GoalPlanningRequest[]
  blockerTaskRefs: string[]
}

export type GoalPlanningWorkflowLeafState =
  | GoalPlanningWorkflowPlanningState
  | GoalPlanningWorkflowPlanningBatchState

export interface GoalPlanningWorkflowsResult {
  kind: 'workflow_batch'
  workflowKey?: string
  workflows: GoalPlanningWorkflowLeafResult[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export interface GoalPlanningWorkflowState {
  kind: 'workflow_batch'
  workflowKey: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: GoalPlanningRequestAnswer[]
  workflows: GoalPlanningWorkflowLeafState[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export async function requestGoalPlanning(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: GoalPlanningRequestInput,
): Promise<GoalPlanningRequestResult> {
  return requestGoalPlanningInternal(stores, input, true)
}

async function requestGoalPlanningInternal(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: GoalPlanningRequestInput,
  syncGroupedBlockers: boolean,
): Promise<GoalPlanningRequestResult> {
  const currentRequests = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const currentBoard = await stores.boardStore.readBoard(input.goalKey)
  const reusablePlanningTask = input.reuseTaskRef
    ? currentBoard.items.find(
        (task) =>
          task.ref === input.reuseTaskRef && task.kind === 'planning' && task.status !== 'done',
      )
    : undefined
  if (input.reuseTaskRef && !reusablePlanningTask) {
    throw new Error(`Planning task not found for reuse: ${input.reuseTaskRef}`)
  }

  const existingByKey = input.requestKey
    ? currentRequests.requests.find((request) => request.requestKey === input.requestKey)
    : undefined
  const existingByReuseTaskRef = reusablePlanningTask
    ? currentRequests.requests.find(
        (request) => request.status === 'open' && request.taskRef === reusablePlanningTask.ref,
      )
    : undefined
  const existingByGroupTaskKey =
    input.groupKey && input.groupTaskKey
      ? currentRequests.requests.find(
          (request) =>
            request.status === 'open' &&
            request.groupKey === input.groupKey &&
            request.groupTaskKey === input.groupTaskKey &&
            currentBoard.items.some(
              (task) => task.ref === request.taskRef && task.status !== 'done',
            ),
        )
      : undefined
  const existingByWorkflowTaskKey =
    input.workflowKey && input.workflowTaskKey
      ? currentRequests.requests.find(
          (request) =>
            request.status === 'open' &&
            request.workflowKey === input.workflowKey &&
            request.workflowTaskKey === input.workflowTaskKey &&
            currentBoard.items.some(
              (task) => task.ref === request.taskRef && task.status !== 'done',
            ),
        )
      : undefined
  if (existingByKey) {
    const enriched = await stores.planningRequests.mergeRequestMetadata(
      input.goalKey,
      existingByKey.requestKey,
      {
        workflowKey: input.workflowKey,
        workflowTaskKey: input.workflowTaskKey,
        workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
        workflowSharedAnswers: input.workflowSharedAnswers,
        blockedByWorkflowKeys: input.blockedByWorkflowKeys,
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        decisionRefs: input.decisionRefs,
        answers: input.answers,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: enriched,
      created: false,
      taskCreated: false,
    })
  }

  if (existingByReuseTaskRef) {
    const updated = await updateExistingPlanningRequest(
      stores,
      input,
      existingByReuseTaskRef.requestKey,
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: updated,
      created: false,
      taskCreated: false,
    })
  }

  if (existingByGroupTaskKey) {
    const enriched = await stores.planningRequests.mergeRequestMetadata(
      input.goalKey,
      existingByGroupTaskKey.requestKey,
      {
        workflowKey: input.workflowKey,
        workflowTaskKey: input.workflowTaskKey,
        workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
        workflowSharedAnswers: input.workflowSharedAnswers,
        blockedByWorkflowKeys: input.blockedByWorkflowKeys,
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        decisionRefs: input.decisionRefs,
        answers: input.answers,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: enriched,
      created: false,
      taskCreated: false,
    })
  }

  if (existingByWorkflowTaskKey) {
    const updated = await updateExistingPlanningRequest(
      stores,
      input,
      existingByWorkflowTaskKey.requestKey,
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: updated,
      created: false,
      taskCreated: false,
    })
  }

  if (!input.workflowTaskKey) {
    const existingOpen = currentRequests.requests.find(
      (request) =>
        request.status === 'open' &&
        request.title === input.title &&
        currentBoard.items.some((task) => task.ref === request.taskRef && task.status !== 'done'),
    )
    if (existingOpen) {
      const enriched = await stores.planningRequests.mergeRequestMetadata(
        input.goalKey,
        existingOpen.requestKey,
        {
          workflowKey: input.workflowKey,
          workflowTaskKey: input.workflowTaskKey,
          workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
          workflowSharedAnswers: input.workflowSharedAnswers,
          blockedByWorkflowKeys: input.blockedByWorkflowKeys,
          groupKey: input.groupKey,
          groupTaskKey: input.groupTaskKey,
          decisionRefs: input.decisionRefs,
          answers: input.answers,
          requestedUpdates: input.requestedUpdates,
        },
      )
      return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
        request: enriched,
        created: false,
        taskCreated: false,
      })
    }

    const upgradeableGeneric = findUpgradeableGenericFollowThrough(
      currentRequests.requests,
      currentBoard.items,
      input,
    )
    if (upgradeableGeneric) {
      const upgraded = await updateExistingPlanningRequest(
        stores,
        input,
        upgradeableGeneric.requestKey,
      )

      return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
        request: upgraded,
        created: false,
        taskCreated: false,
      })
    }
  }

  let taskRef = ''
  let taskCreated = false
  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `request planning ${input.title}`,
    (board) => {
      if (reusablePlanningTask) {
        const task = board.items.find((item) => item.ref === reusablePlanningTask.ref)
        if (!task) {
          throw new Error(`Task not found: ${reusablePlanningTask.ref}`)
        }
        taskRef = task.ref
        task.title = input.title
        task.description = input.description
        task.acceptanceCriteria = [...input.acceptanceCriteria]
        return
      }

      const existingTask = input.workflowTaskKey
        ? undefined
        : board.items.find(
            (item) =>
              item.kind === 'planning' && item.title === input.title && item.status !== 'done',
          )
      if (existingTask) {
        taskRef = existingTask.ref
        return
      }

      taskRef = nextPlanningTaskRef(board.items.map((item) => item.ref))
      taskCreated = true
      board.items.push({
        ref: taskRef,
        kind: 'planning',
        status: 'planned',
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        blockedBy: input.blockedBy ?? [],
      })
    },
  )

  const request = await stores.planningRequests.createRequest(input.goalKey, {
    requestKey: input.requestKey,
    workflowKey: input.workflowKey,
    workflowTaskKey: input.workflowTaskKey,
    workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
    workflowSharedAnswers: input.workflowSharedAnswers,
    blockedByWorkflowKeys: input.blockedByWorkflowKeys,
    groupKey: input.groupKey,
    groupTaskKey: input.groupTaskKey,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    taskRef,
    decisionRefs: input.decisionRefs,
    answers: input.answers,
    requestedUpdates: input.requestedUpdates,
  })

  return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
    request,
    created: true,
    taskCreated,
  })
}

async function updateExistingPlanningRequest(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: GoalPlanningRequestInput,
  requestKey: string,
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const request = requestSet.requests.find((entry) => entry.requestKey === requestKey)
  if (!request) {
    throw new Error(`Planning request not found: ${requestKey}`)
  }

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `upgrade planning ${input.title}`,
    (board) => {
      const task = board.items.find((item) => item.ref === request.taskRef)
      if (!task) {
        throw new Error(`Task not found: ${request.taskRef}`)
      }
      task.title = input.title
      task.description = input.description
      task.acceptanceCriteria = [...input.acceptanceCriteria]
    },
  )

  return stores.planningRequests.updateRequest(input.goalKey, request.requestKey, {
    workflowKey: input.workflowKey,
    workflowTaskKey: input.workflowTaskKey,
    workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
    workflowSharedAnswers: input.workflowSharedAnswers,
    blockedByWorkflowKeys: input.blockedByWorkflowKeys,
    groupKey: input.groupKey,
    groupTaskKey: input.groupTaskKey,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    decisionRefs: input.decisionRefs,
    answers: input.answers,
    requestedUpdates: input.requestedUpdates,
  })
}

export async function requestGoalPlanningBatch(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey?: string
    groupKey: string
    workflowSharedDecisionRefs?: string[]
    workflowSharedAnswers?: GoalPlanningRequestAnswer[]
    blockedByWorkflowKeys?: string[]
    decisionRefs?: string[]
    answers?: GoalPlanningRequestAnswer[]
    requests: GoalPlanningBatchEntryInput[]
    reuseTaskRefByTaskKey?: Record<string, string>
    writer?: string
    reason?: string
  },
): Promise<GoalPlanningBatchResult> {
  validatePlanningBatchInput(input.requests)
  await validateExistingTaskBlockers(stores.boardStore, input.goalKey, input.requests)

  const entries: GoalPlanningBatchResult['entries'] = []
  for (const request of input.requests) {
    const result = await requestGoalPlanningInternal(
      stores,
      {
        goalKey: input.goalKey,
        workflowKey: input.workflowKey,
        workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
        workflowSharedAnswers: input.workflowSharedAnswers,
        requestKey: request.requestKey,
        groupKey: input.groupKey,
        groupTaskKey: request.taskKey,
        blockedByWorkflowKeys: isPlanningBatchRootRequest(request)
          ? input.blockedByWorkflowKeys
          : undefined,
        title: request.title,
        description: request.description,
        acceptanceCriteria: request.acceptanceCriteria,
        decisionRefs: input.decisionRefs,
        answers: input.answers,
        requestedUpdates: request.requestedUpdates,
        reuseTaskRef: input.reuseTaskRefByTaskKey?.[request.taskKey],
        writer: input.writer,
        reason: input.reason,
      },
      false,
    )
    entries.push({
      taskKey: request.taskKey,
      requestKey: result.request.requestKey,
      taskRef: result.request.taskRef,
      created: result.created,
      taskCreated: result.taskCreated,
    })
  }

  const taskRefByKey = new Map(entries.map((entry) => [entry.taskKey, entry.taskRef]))
  const currentRequestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const existingGroupedTaskRefByKey = mapExistingGroupedTaskRefs(
    currentRequestSet.requests,
    input.groupKey,
    taskRefByKey,
  )
  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `request planning batch ${input.groupKey}`,
    (board) => {
      for (const request of input.requests) {
        const taskRef = taskRefByKey.get(request.taskKey)
        if (!taskRef) {
          throw new Error(`Planning batch task mapping missing: ${request.taskKey}`)
        }
        const task = board.items.find((item) => item.ref === taskRef)
        if (!task) {
          throw new Error(`Task not found: ${taskRef}`)
        }
        const requestedBlockers = [
          ...(request.blockedBy ?? []),
          ...(request.blockedByTaskKeys ?? []).map((taskKey) => {
            const ref = taskRefByKey.get(taskKey) ?? existingGroupedTaskRefByKey.get(taskKey)
            if (!ref) {
              throw new Error(`Unknown planning batch dependency: ${taskKey}`)
            }
            return {
              kind: 'task' as const,
              ref,
            }
          }),
        ]

        for (const blocker of requestedBlockers) {
          if (
            !task.blockedBy.some(
              (existing) => existing.kind === blocker.kind && existing.ref === blocker.ref,
            )
          ) {
            task.blockedBy.push(blocker)
          }
        }
      }
    },
  )
  await syncGroupedPlanningEngineeringBlockers(stores, {
    goalKey: input.goalKey,
    groupKey: input.groupKey,
    writer: input.writer,
    reason: input.reason,
  })

  return {
    groupKey: input.groupKey,
    entries,
  }
}

export async function requestGoalPlanningWorkflows(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey?: string
    reuseTaskRef?: string
    reuseGroupKey?: string
    decisionRefs?: string[]
    answers?: GoalPlanningRequestAnswer[]
    workflows: GoalPlanningWorkflowLeafInput[]
    writer?: string
    reason?: string
  },
): Promise<GoalPlanningWorkflowsResult> {
  const workflowKey = await resolvePlanningWorkflowKey(
    stores.planningRequests,
    input.goalKey,
    input.workflowKey,
  )

  if (input.reuseTaskRef && input.reuseGroupKey) {
    throw new Error('Direct workflow reuse can target only one existing surface at a time')
  }
  if (input.reuseGroupKey) {
    const firstWorkflow = input.workflows[0]
    if (!firstWorkflow || firstWorkflow.kind !== 'planning_batch') {
      throw new Error('Grouped workflow reuse requires the first child to be planning_batch')
    }
    if (firstWorkflow.groupKey !== input.reuseGroupKey) {
      throw new Error(
        `Grouped workflow reuse mismatch: ${input.reuseGroupKey} != ${firstWorkflow.groupKey}`,
      )
    }
  }

  const workflows: GoalPlanningWorkflowLeafResult[] = []
  let currentReusablePlanningTaskRef = input.reuseTaskRef
  let currentReusablePlanningGroupKey = input.reuseGroupKey
  const persistedWorkflowSharedContext = await readPersistedWorkflowSharedContext(stores, {
    goalKey: input.goalKey,
    workflowKey,
  })
  const workflowDecisionRefs = uniqueStringValues([
    ...(persistedWorkflowSharedContext?.decisionRefs ?? []),
    ...(input.decisionRefs ?? []),
  ])
  const workflowAnswers = mergePlanningRequestAnswers(
    persistedWorkflowSharedContext?.answers ?? [],
    input.answers ?? [],
  )
  const persistedWorkflowDecisionRefs = workflowDecisionRefs
  const persistedWorkflowAnswers = workflowAnswers
  const reusableGroupedSourceBlockerTaskRefs = currentReusablePlanningGroupKey
    ? await listGroupedPlanningSinkTaskRefs(stores, {
        goalKey: input.goalKey,
        groupKey: currentReusablePlanningGroupKey,
      })
    : []
  let currentWorkflowChildren = await describeOpenPlanningWorkflowChildren(stores, {
    goalKey: input.goalKey,
    workflowKey,
  })

  for (const workflow of input.workflows) {
    const blockedByWorkflowKeys = workflow.blockedByWorkflowKeys ?? []
    const childDependencyKey =
      workflow.kind === 'planning' ? workflow.workflowTaskKey : workflow.groupKey
    const workflowDependencyBlockers =
      blockedByWorkflowKeys.length > 0
        ? resolveWorkflowDependencyBlockers(currentWorkflowChildren, {
            workflowKey,
            dependencyKey: childDependencyKey,
            blockedByWorkflowKeys,
          })
        : []

    if (workflow.kind === 'planning_batch') {
      const result =
        currentReusablePlanningGroupKey && currentReusablePlanningGroupKey === workflow.groupKey
          ? await reuseGoalPlanningBatchWorkflow(stores, {
              goalKey: input.goalKey,
              workflowKey,
              workflowSharedDecisionRefs: persistedWorkflowDecisionRefs,
              workflowSharedAnswers: persistedWorkflowAnswers,
              groupKey: workflow.groupKey,
              blockedByWorkflowKeys,
              decisionRefs: uniqueStringValues([
                ...workflowDecisionRefs,
                ...(workflow.decisionRefs ?? []),
              ]),
              answers: mergePlanningRequestAnswers(workflowAnswers, workflow.answers ?? []),
              requests: (workflow.requests ?? []).map((request) => ({
                ...request,
                blockedBy: isPlanningBatchRootRequest(request)
                  ? mergeBlockerRefs(request.blockedBy ?? [], workflowDependencyBlockers)
                  : request.blockedBy,
              })),
              writer: input.writer,
              reason: input.reason,
            })
          : await requestGoalPlanningBatch(stores, {
              goalKey: input.goalKey,
              workflowKey,
              workflowSharedDecisionRefs: persistedWorkflowDecisionRefs,
              workflowSharedAnswers: persistedWorkflowAnswers,
              groupKey: workflow.groupKey,
              blockedByWorkflowKeys,
              decisionRefs: uniqueStringValues([
                ...workflowDecisionRefs,
                ...(workflow.decisionRefs ?? []),
              ]),
              answers: mergePlanningRequestAnswers(workflowAnswers, workflow.answers ?? []),
              requests: (workflow.requests ?? []).map((request) => ({
                ...request,
                blockedBy: isPlanningBatchRootRequest(request)
                  ? mergeBlockerRefs(request.blockedBy ?? [], workflowDependencyBlockers)
                  : request.blockedBy,
              })),
              reuseTaskRefByTaskKey: currentReusablePlanningTaskRef
                ? {
                    [workflow.requests?.[0]?.taskKey ?? '']: currentReusablePlanningTaskRef,
                  }
                : undefined,
              writer: input.writer,
              reason: input.reason,
            })
      const blockerTaskRefs = await listGroupedPlanningSinkTaskRefs(stores, {
        goalKey: input.goalKey,
        groupKey: result.groupKey,
      })
      const workflowResult = {
        kind: 'planning_batch',
        groupKey: result.groupKey,
        requestKeys: result.entries.map((entry) => entry.requestKey),
        taskRefs: result.entries.map((entry) => entry.taskRef),
        blockerTaskRefs,
        createdRequestKeys: result.entries
          .filter((entry) => entry.created)
          .map((entry) => entry.requestKey),
        createdTaskRefs: result.entries
          .filter((entry) => entry.taskCreated)
          .map((entry) => entry.taskRef),
      } satisfies GoalPlanningWorkflowBatchResult
      workflows.push(workflowResult)
      currentWorkflowChildren = replaceWorkflowChildState(currentWorkflowChildren, {
        kind: 'planning_batch',
        dependencyKey: workflow.groupKey,
        blockedByWorkflowKeys,
        requestKeys: workflowResult.requestKeys,
        taskRefs: workflowResult.taskRefs,
        blockerTaskRefs: workflowResult.blockerTaskRefs,
        workflowResult,
      })
      currentReusablePlanningTaskRef = undefined
      currentReusablePlanningGroupKey = undefined
      continue
    }

    const result = await requestGoalPlanning(stores, {
      goalKey: input.goalKey,
      workflowKey,
      workflowTaskKey: workflow.workflowTaskKey,
      workflowSharedDecisionRefs: persistedWorkflowDecisionRefs,
      workflowSharedAnswers: persistedWorkflowAnswers,
      blockedByWorkflowKeys,
      requestKey: workflow.requestKey,
      groupKey: workflow.groupKey,
      title: workflow.title,
      description: workflow.description,
      acceptanceCriteria: workflow.acceptanceCriteria,
      decisionRefs: uniqueStringValues([...workflowDecisionRefs, ...(workflow.decisionRefs ?? [])]),
      answers: mergePlanningRequestAnswers(workflowAnswers, workflow.answers ?? []),
      requestedUpdates: workflow.requestedUpdates,
      blockedBy: mergeBlockerRefs(workflow.blockedBy ?? [], workflowDependencyBlockers),
      reuseTaskRef: currentReusablePlanningTaskRef,
      writer: input.writer,
      reason: input.reason,
    })
    const blockerTaskRefs = workflow.groupKey
      ? await listGroupedPlanningSinkTaskRefs(stores, {
          goalKey: input.goalKey,
          groupKey: workflow.groupKey,
        })
      : [result.request.taskRef]
    const workflowResult = {
      kind: 'planning',
      workflowTaskKey: workflow.workflowTaskKey,
      groupKey: workflow.groupKey,
      requestKeys: [result.request.requestKey],
      taskRefs: [result.request.taskRef],
      blockerTaskRefs,
      createdRequestKeys: result.created ? [result.request.requestKey] : [],
      createdTaskRefs: result.taskCreated ? [result.request.taskRef] : [],
    } satisfies GoalPlanningWorkflowResult
    workflows.push(workflowResult)
    currentWorkflowChildren = replaceWorkflowChildState(currentWorkflowChildren, {
      kind: 'planning',
      dependencyKey: workflow.workflowTaskKey,
      blockedByWorkflowKeys,
      requestKeys: workflowResult.requestKeys,
      taskRefs: workflowResult.taskRefs,
      blockerTaskRefs: workflowResult.blockerTaskRefs,
      workflowResult,
    })
    currentReusablePlanningTaskRef = undefined
  }

  const createdRequestKeys = uniqueStringValues(
    workflows.flatMap((workflow) => workflow.createdRequestKeys),
  )
  const createdTaskRefs = uniqueStringValues(
    workflows.flatMap((workflow) => workflow.createdTaskRefs),
  )
  await stores.planningRequests.syncWorkflowSharedContext(input.goalKey, workflowKey, {
    workflowSharedDecisionRefs: workflowDecisionRefs,
    workflowSharedAnswers: workflowAnswers,
  })

  await syncWorkflowPlanningChildDependenciesForWorkflow(stores, {
    goalKey: input.goalKey,
    workflowKey,
    writer: input.writer,
    reason: input.reason,
  })

  await syncWorkflowPlanningEngineeringBlockersForWorkflow(stores, {
    goalKey: input.goalKey,
    workflowKey,
    writer: input.writer,
    reason: input.reason,
  })

  const current = await describeOpenPlanningWorkflowState(stores, {
    goalKey: input.goalKey,
    workflowKey,
  })
  const result = {
    ...current,
    createdRequestKeys,
    createdTaskRefs,
  }

  if (input.reuseTaskRef) {
    await syncPlanningWorkflowEngineeringBlockers(stores, {
      goalKey: input.goalKey,
      sourceBlockerTaskRefs: workflows[0]?.blockerTaskRefs ?? [input.reuseTaskRef],
      blockerTaskRefs: result.blockerTaskRefs,
      writer: input.writer,
      reason: input.reason,
    })
  }
  if (input.reuseGroupKey) {
    await syncPlanningWorkflowEngineeringBlockers(stores, {
      goalKey: input.goalKey,
      sourceBlockerTaskRefs: reusableGroupedSourceBlockerTaskRefs,
      blockerTaskRefs: result.blockerTaskRefs,
      writer: input.writer,
      reason: input.reason,
    })
  }

  return result
}

export async function listGoalPlanningWorkflows(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
  },
): Promise<GoalPlanningWorkflowState[]> {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const openTaskRefSet = new Set(
    board.items.filter((task) => task.status !== 'done').map((task) => task.ref),
  )
  const workflowKeys = uniqueStringValues(
    requestSet.requests
      .filter(
        (request) =>
          request.status === 'open' && request.workflowKey && openTaskRefSet.has(request.taskRef),
      )
      .map((request) => request.workflowKey as string),
  )

  const workflows = await Promise.all(
    workflowKeys.map((workflowKey) =>
      readGoalPlanningWorkflow(stores, {
        goalKey: input.goalKey,
        workflowKey,
      }),
    ),
  )

  return workflows.filter((workflow): workflow is GoalPlanningWorkflowState => Boolean(workflow))
}

export async function readGoalPlanningWorkflow(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
): Promise<GoalPlanningWorkflowState | undefined> {
  const detail = await describeOpenPlanningWorkflowDetail(stores, input)
  if (!detail) {
    return undefined
  }

  return detail
}

async function reuseGoalPlanningBatchWorkflow(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey?: string
    workflowSharedDecisionRefs?: string[]
    workflowSharedAnswers?: GoalPlanningRequestAnswer[]
    groupKey: string
    blockedByWorkflowKeys?: string[]
    decisionRefs?: string[]
    answers?: GoalPlanningRequestAnswer[]
    requests: GoalPlanningBatchEntryInput[]
    writer?: string
    reason?: string
  },
): Promise<GoalPlanningBatchResult> {
  const current = await describeReusableGroupedPlanningSurface(stores, {
    goalKey: input.goalKey,
    groupKey: input.groupKey,
  })
  const rootTaskRefSet = new Set(
    findOpenGroupedPlanningRootTaskRefs(current.requests, current.tasks),
  )

  for (const request of current.requests) {
    await stores.planningRequests.mergeRequestMetadata(input.goalKey, request.requestKey, {
      workflowKey: input.workflowKey,
      workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
      workflowSharedAnswers: input.workflowSharedAnswers,
      blockedByWorkflowKeys: rootTaskRefSet.has(request.taskRef) ? input.blockedByWorkflowKeys : [],
      decisionRefs: input.decisionRefs,
      answers: input.answers,
    })
  }

  let extension: GoalPlanningBatchResult | undefined
  if (input.requests.length > 0) {
    extension = await requestGoalPlanningBatch(stores, {
      goalKey: input.goalKey,
      workflowKey: input.workflowKey,
      workflowSharedDecisionRefs: input.workflowSharedDecisionRefs,
      workflowSharedAnswers: input.workflowSharedAnswers,
      groupKey: input.groupKey,
      blockedByWorkflowKeys: input.blockedByWorkflowKeys,
      decisionRefs: input.decisionRefs,
      answers: input.answers,
      requests: input.requests,
      writer: input.writer,
      reason: input.reason,
    })
  }

  const next = await describeReusableGroupedPlanningSurface(stores, {
    goalKey: input.goalKey,
    groupKey: input.groupKey,
  })

  return {
    groupKey: input.groupKey,
    entries: next.requests.map((request) => ({
      taskKey: request.groupTaskKey ?? '',
      requestKey: request.requestKey,
      taskRef: request.taskRef,
      created:
        extension?.entries.find((entry) => entry.requestKey === request.requestKey)?.created ??
        false,
      taskCreated:
        extension?.entries.find((entry) => entry.requestKey === request.requestKey)?.taskCreated ??
        false,
    })),
  }
}

async function readPersistedWorkflowSharedContext(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const openTaskRefSet = new Set(
    board.items.filter((task) => task.status !== 'done').map((task) => task.ref),
  )
  const openRequests = requestSet.requests.filter(
    (request) =>
      request.status === 'open' &&
      request.workflowKey === input.workflowKey &&
      openTaskRefSet.has(request.taskRef),
  )

  return {
    decisionRefs: uniqueStringValues(
      openRequests.flatMap((request) => request.workflowSharedDecisionRefs),
    ),
    answers: mergePlanningRequestAnswers(
      [],
      openRequests.flatMap((request) => request.workflowSharedAnswers),
    ),
  }
}

export async function syncGroupedPlanningEngineeringBlockers(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    groupKey?: string
    writer?: string
    reason?: string
  },
) {
  const current = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const groupKeys = input.groupKey
    ? [input.groupKey]
    : findGroupedPlanningKeysBlockingEngineering(
        current.requests,
        (await stores.boardStore.readBoard(input.goalKey)).items,
      )

  let changed = false
  for (const groupKey of groupKeys) {
    if (
      await syncGroupedPlanningEngineeringBlockersForGroup(
        stores,
        current.requests,
        input.goalKey,
        groupKey,
        input.writer,
        input.reason,
      )
    ) {
      changed = true
    }
  }

  return changed
}

export async function listGroupedPlanningSinkTaskRefs(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    groupKey: string
  },
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  return findOpenGroupedPlanningSinkTaskRefs(
    requestSet.requests.filter((request) => request.groupKey === input.groupKey),
    board.items,
  )
}

export async function resolveGoalPlanningRequest(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    requestKey: string
    resolution: string
    writer?: string
    reason?: string
  },
) {
  const request = await stores.planningRequests.resolveRequest(input.goalKey, input.requestKey, {
    resolution: input.resolution,
  })
  await stores.boardStore.appendEvent(input.goalKey, {
    writer: input.writer ?? 'planning_request',
    action: 'planning_request_resolved',
    goalKey: input.goalKey,
    taskRef: request.taskRef,
    reason: input.reason ?? `planning_request:${request.requestKey}`,
  })
  return request
}

export async function resolvePlanningRequestsForTask(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    taskRef: string
    resolution: string
    writer?: string
  },
) {
  const current = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const openRequests = current.requests.filter(
    (request) => request.status === 'open' && request.taskRef === input.taskRef,
  )

  const resolved: GoalPlanningRequest[] = []
  for (const request of openRequests) {
    resolved.push(
      await resolveGoalPlanningRequest(stores, {
        goalKey: input.goalKey,
        requestKey: request.requestKey,
        resolution: input.resolution,
        writer: input.writer,
      }),
    )
  }

  return resolved
}

export async function enrichPlanningRequestsForTaskDecision(
  stores: {
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    taskRef: string
    decisionKey: string
  },
) {
  const current = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const openRequests = current.requests.filter(
    (request) => request.status === 'open' && request.taskRef === input.taskRef,
  )
  const groupKeys = mergeUniqueGroupKeys(
    openRequests
      .map((request) => request.groupKey)
      .filter((groupKey): groupKey is string => Boolean(groupKey)),
  )
  const groupedRequests = current.requests.filter(
    (request) =>
      request.status === 'open' &&
      request.taskRef !== input.taskRef &&
      request.groupKey !== undefined &&
      groupKeys.includes(request.groupKey),
  )

  const enriched = []
  for (const request of [...openRequests, ...groupedRequests]) {
    enriched.push(
      await stores.planningRequests.mergeRequestMetadata(input.goalKey, request.requestKey, {
        decisionRefs: [input.decisionKey],
        requestedUpdates: request.requestedUpdates.length === 0 ? ['design.md', 'todo.yml'] : [],
      }),
    )
  }

  return enriched
}

async function finalizeGoalPlanningRequestResult(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: GoalPlanningRequestInput,
  syncGroupedBlockers: boolean,
  result: GoalPlanningRequestResult,
) {
  if (syncGroupedBlockers && input.groupKey) {
    await syncGroupedPlanningEngineeringBlockers(stores, {
      goalKey: input.goalKey,
      groupKey: input.groupKey,
      writer: input.writer,
      reason: input.reason,
    })
  }

  return result
}

function nextPlanningTaskRef(existingRefs: string[]) {
  const nextNumber =
    existingRefs.reduce((max, ref) => {
      const match = /^P-(\d+)$/.exec(ref)
      if (!match) {
        return max
      }
      return Math.max(max, Number.parseInt(match[1] ?? '0', 10))
    }, 0) + 1

  return `P-${nextNumber}`
}

async function resolvePlanningWorkflowKey(
  planningRequests: PlanningRequestStore,
  goalKey: string,
  workflowKey: string | undefined,
) {
  if (workflowKey) {
    return workflowKey
  }

  const requestSet = await planningRequests.readGoalPlanningRequests(goalKey)
  return nextPlanningWorkflowKey(requestSet.requests.map((request) => request.workflowKey))
}

function nextPlanningWorkflowKey(existingWorkflowKeys: Array<string | undefined>) {
  const nextNumber =
    existingWorkflowKeys.reduce((max, workflowKey) => {
      const match = /^W-(\d+)$/.exec(workflowKey ?? '')
      if (!match) {
        return max
      }
      return Math.max(max, Number.parseInt(match[1] ?? '0', 10))
    }, 0) + 1

  return `W-${nextNumber}`
}

async function validateExistingTaskBlockers(
  boardStore: BoardStore,
  goalKey: string,
  requests: GoalPlanningBatchEntryInput[],
) {
  const board = await boardStore.readBoard(goalKey)
  const existingRefs = new Set(board.items.map((item) => item.ref))
  for (const request of requests) {
    for (const blocker of request.blockedBy ?? []) {
      if (blocker.kind === 'task' && !existingRefs.has(blocker.ref)) {
        throw new Error(`Task blocker not found: ${blocker.ref}`)
      }
    }
  }
}

function validatePlanningBatchInput(requests: GoalPlanningBatchEntryInput[]) {
  if (requests.length === 0) {
    throw new Error('Planning batch must include at least one request')
  }

  const taskKeys = requests.map((request) => request.taskKey)
  if (new Set(taskKeys).size !== taskKeys.length) {
    throw new Error('Planning batch taskKey values must be unique')
  }

  const requestByKey = new Map(requests.map((request) => [request.taskKey, request]))
  for (const request of requests) {
    if (request.blockedByTaskKeys?.includes(request.taskKey)) {
      throw new Error(`Planning batch task cannot depend on itself: ${request.taskKey}`)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (taskKey: string) => {
    if (visited.has(taskKey)) {
      return
    }
    if (visiting.has(taskKey)) {
      throw new Error(`Planning batch dependency cycle detected at: ${taskKey}`)
    }
    visiting.add(taskKey)
    for (const dependencyKey of requestByKey.get(taskKey)?.blockedByTaskKeys ?? []) {
      if (requestByKey.has(dependencyKey)) {
        visit(dependencyKey)
      }
    }
    visiting.delete(taskKey)
    visited.add(taskKey)
  }

  for (const taskKey of taskKeys) {
    visit(taskKey)
  }
}

function mergeUniqueGroupKeys(values: string[]) {
  const merged: string[] = []
  for (const value of values) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

function findGroupedPlanningKeysBlockingEngineering(
  requests: GoalPlanningRequest[],
  tasks: Array<{ kind: string; blockedBy: BlockerRef[] }>,
) {
  const taskRefToGroupKey = new Map<string, string>()
  for (const request of requests) {
    if (request.groupKey) {
      taskRefToGroupKey.set(request.taskRef, request.groupKey)
    }
  }

  const groupKeys: string[] = []
  for (const task of tasks) {
    if (task.kind !== 'engineering') {
      continue
    }
    for (const blocker of task.blockedBy) {
      if (blocker.kind !== 'task') {
        continue
      }
      const groupKey = taskRefToGroupKey.get(blocker.ref)
      if (groupKey && !groupKeys.includes(groupKey)) {
        groupKeys.push(groupKey)
      }
    }
  }

  return groupKeys
}

function mapExistingGroupedTaskRefs(
  requests: GoalPlanningRequest[],
  groupKey: string,
  currentTaskRefByKey: Map<string, string>,
) {
  const refs = new Map<string, string>()
  for (const request of requests) {
    if (
      request.status === 'open' &&
      request.groupKey === groupKey &&
      request.groupTaskKey &&
      !currentTaskRefByKey.has(request.groupTaskKey)
    ) {
      refs.set(request.groupTaskKey, request.taskRef)
    }
  }
  return refs
}

async function syncGroupedPlanningEngineeringBlockersForGroup(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  requests: GoalPlanningRequest[],
  goalKey: string,
  groupKey: string,
  writer?: string,
  reason?: string,
) {
  const groupedRequests = requests.filter((request) => request.groupKey === groupKey)
  if (groupedRequests.length === 0) {
    return false
  }

  const board = await stores.boardStore.readBoard(goalKey)
  const groupTaskRefs = uniqueStringValues(groupedRequests.map((request) => request.taskRef))
  const groupTaskRefSet = new Set(groupTaskRefs)
  const sinkTaskRefs = findOpenGroupedPlanningSinkTaskRefs(groupedRequests, board.items)
  const nextBlockedByByTaskRef = new Map<string, BlockerRef[]>()

  for (const task of board.items) {
    if (
      task.kind !== 'engineering' ||
      !task.blockedBy.some((blocker) => blocker.kind === 'task' && groupTaskRefSet.has(blocker.ref))
    ) {
      continue
    }

    const nextBlockedBy = task.blockedBy.filter(
      (blocker) => !(blocker.kind === 'task' && groupTaskRefSet.has(blocker.ref)),
    )
    for (const sinkTaskRef of sinkTaskRefs) {
      nextBlockedBy.push({
        kind: 'task',
        ref: sinkTaskRef,
      })
    }

    if (!sameBlockerList(task.blockedBy, nextBlockedBy)) {
      nextBlockedByByTaskRef.set(task.ref, nextBlockedBy)
    }
  }

  if (nextBlockedByByTaskRef.size === 0) {
    return false
  }

  await stores.boardStore.mutateBoard(
    goalKey,
    writer ?? 'planning_request',
    reason ?? `sync grouped planning blockers ${groupKey}`,
    (nextBoard) => {
      for (const task of nextBoard.items) {
        const nextBlockedBy = nextBlockedByByTaskRef.get(task.ref)
        if (nextBlockedBy) {
          task.blockedBy = [...nextBlockedBy]
        }
      }
    },
  )

  return true
}

async function syncPlanningWorkflowEngineeringBlockers(
  stores: {
    boardStore: BoardStore
  },
  input: {
    goalKey: string
    sourceBlockerTaskRefs: string[]
    blockerTaskRefs: string[]
    writer?: string
    reason?: string
  },
) {
  const sourceBlockerTaskRefs = uniqueStringValues(input.sourceBlockerTaskRefs)
  const blockerTaskRefs = uniqueStringValues(input.blockerTaskRefs)
  if (sourceBlockerTaskRefs.length === 0 || blockerTaskRefs.length === 0) {
    return false
  }

  const sourceBlockerTaskRefSet = new Set(sourceBlockerTaskRefs)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const nextBlockedByByTaskRef = new Map<string, BlockerRef[]>()

  for (const task of board.items) {
    if (
      task.kind !== 'engineering' ||
      !task.blockedBy.some(
        (blocker) => blocker.kind === 'task' && sourceBlockerTaskRefSet.has(blocker.ref),
      )
    ) {
      continue
    }

    const nextBlockedBy = task.blockedBy.filter(
      (blocker) => !(blocker.kind === 'task' && sourceBlockerTaskRefSet.has(blocker.ref)),
    )
    for (const blockerTaskRef of blockerTaskRefs) {
      if (
        !nextBlockedBy.some(
          (existing) => existing.kind === 'task' && existing.ref === blockerTaskRef,
        )
      ) {
        nextBlockedBy.push({
          kind: 'task',
          ref: blockerTaskRef,
        })
      }
    }

    if (!sameBlockerList(task.blockedBy, nextBlockedBy)) {
      nextBlockedByByTaskRef.set(task.ref, nextBlockedBy)
    }
  }

  if (nextBlockedByByTaskRef.size === 0) {
    return false
  }

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? 'sync workflow planning blockers',
    (nextBoard) => {
      for (const task of nextBoard.items) {
        const nextBlockedBy = nextBlockedByByTaskRef.get(task.ref)
        if (nextBlockedBy) {
          task.blockedBy = [...nextBlockedBy]
        }
      }
    },
  )

  return true
}

async function syncWorkflowPlanningEngineeringBlockersForWorkflow(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
    writer?: string
    reason?: string
  },
) {
  const current = await describeOpenPlanningWorkflowState(stores, {
    goalKey: input.goalKey,
    workflowKey: input.workflowKey,
  })
  if (current.taskRefs.length === 0 || current.blockerTaskRefs.length === 0) {
    return false
  }

  const workflowTaskRefSet = new Set(current.taskRefs)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const nextBlockedByByTaskRef = new Map<string, BlockerRef[]>()

  for (const task of board.items) {
    if (
      task.kind !== 'engineering' ||
      !task.blockedBy.some(
        (blocker) => blocker.kind === 'task' && workflowTaskRefSet.has(blocker.ref),
      )
    ) {
      continue
    }

    const nextBlockedBy = task.blockedBy.filter(
      (blocker) => !(blocker.kind === 'task' && workflowTaskRefSet.has(blocker.ref)),
    )
    for (const blockerTaskRef of current.blockerTaskRefs) {
      if (
        !nextBlockedBy.some(
          (existing) => existing.kind === 'task' && existing.ref === blockerTaskRef,
        )
      ) {
        nextBlockedBy.push({
          kind: 'task',
          ref: blockerTaskRef,
        })
      }
    }

    if (!sameBlockerList(task.blockedBy, nextBlockedBy)) {
      nextBlockedByByTaskRef.set(task.ref, nextBlockedBy)
    }
  }

  if (nextBlockedByByTaskRef.size === 0) {
    return false
  }

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `sync workflow planning blockers ${input.workflowKey}`,
    (nextBoard) => {
      for (const task of nextBoard.items) {
        const nextBlockedBy = nextBlockedByByTaskRef.get(task.ref)
        if (nextBlockedBy) {
          task.blockedBy = [...nextBlockedBy]
        }
      }
    },
  )

  return true
}

interface WorkflowChildState {
  kind: GoalPlanningWorkflowLeafResult['kind']
  dependencyKey?: string
  blockedByWorkflowKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  workflowResult: GoalPlanningWorkflowLeafResult
}

async function syncWorkflowPlanningChildDependenciesForWorkflow(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
    writer?: string
    reason?: string
  },
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const taskByRef = new Map(board.items.map((task) => [task.ref, task]))
  const children = await describeOpenPlanningWorkflowChildren(stores, {
    goalKey: input.goalKey,
    workflowKey: input.workflowKey,
  })
  const currentBlockerTaskRefsByKey = new Map<string, string[]>()
  for (const child of children) {
    if (child.dependencyKey) {
      currentBlockerTaskRefsByKey.set(child.dependencyKey, child.blockerTaskRefs)
    }
  }

  const allTaskRefsByKey = new Map<string, string[]>()
  for (const request of requestSet.requests) {
    if (request.workflowKey !== input.workflowKey) {
      continue
    }
    const dependencyKey = workflowDependencyKeyForRequest(request)
    if (!dependencyKey) {
      continue
    }
    allTaskRefsByKey.set(
      dependencyKey,
      uniqueStringValues([...(allTaskRefsByKey.get(dependencyKey) ?? []), request.taskRef]),
    )
  }

  const nextBlockedByByTaskRef = new Map<string, BlockerRef[]>()
  for (const request of requestSet.requests) {
    const task = taskByRef.get(request.taskRef)
    if (
      request.status !== 'open' ||
      request.workflowKey !== input.workflowKey ||
      request.blockedByWorkflowKeys.length === 0 ||
      !task ||
      task.status === 'done'
    ) {
      continue
    }

    const removableTaskRefs = uniqueStringValues(
      request.blockedByWorkflowKeys.flatMap((key) => allTaskRefsByKey.get(key) ?? []),
    )
    const nextBlockedBy = task.blockedBy.filter(
      (blocker) => !(blocker.kind === 'task' && removableTaskRefs.includes(blocker.ref)),
    )
    const desiredBlockerTaskRefs = uniqueStringValues(
      request.blockedByWorkflowKeys.flatMap((key) => currentBlockerTaskRefsByKey.get(key) ?? []),
    )
    for (const blockerTaskRef of desiredBlockerTaskRefs) {
      if (
        !nextBlockedBy.some(
          (existing) => existing.kind === 'task' && existing.ref === blockerTaskRef,
        )
      ) {
        nextBlockedBy.push({
          kind: 'task',
          ref: blockerTaskRef,
        })
      }
    }

    if (!sameBlockerList(task.blockedBy, nextBlockedBy)) {
      nextBlockedByByTaskRef.set(task.ref, nextBlockedBy)
    }
  }

  if (nextBlockedByByTaskRef.size === 0) {
    return false
  }

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `sync workflow child dependencies ${input.workflowKey}`,
    (nextBoard) => {
      for (const task of nextBoard.items) {
        const nextBlockedBy = nextBlockedByByTaskRef.get(task.ref)
        if (nextBlockedBy) {
          task.blockedBy = [...nextBlockedBy]
        }
      }
    },
  )

  return true
}

async function describeOpenPlanningWorkflowChildren(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
): Promise<WorkflowChildState[]> {
  const { openRequests, tasks } = await readOpenPlanningWorkflowRequests(stores, input)
  const children: WorkflowChildState[] = []
  const seenGroupedChildren = new Set<string>()

  for (const request of openRequests) {
    if (request.groupKey && request.groupTaskKey) {
      if (seenGroupedChildren.has(request.groupKey)) {
        continue
      }
      const groupedRequests = openRequests.filter(
        (entry) => entry.groupKey === request.groupKey && entry.groupTaskKey,
      )
      const workflowResult = {
        kind: 'planning_batch' as const,
        groupKey: request.groupKey,
        requestKeys: groupedRequests.map((entry) => entry.requestKey),
        taskRefs: groupedRequests.map((entry) => entry.taskRef),
        blockerTaskRefs: findOpenGroupedPlanningSinkTaskRefs(groupedRequests, tasks),
        createdRequestKeys: [],
        createdTaskRefs: [],
      }
      children.push({
        kind: 'planning_batch',
        dependencyKey: request.groupKey,
        blockedByWorkflowKeys: uniqueStringValues(
          groupedRequests.flatMap((entry) => entry.blockedByWorkflowKeys),
        ),
        requestKeys: workflowResult.requestKeys,
        taskRefs: workflowResult.taskRefs,
        blockerTaskRefs: workflowResult.blockerTaskRefs,
        workflowResult,
      })
      seenGroupedChildren.add(request.groupKey)
      continue
    }

    const workflowResult = {
      kind: 'planning' as const,
      workflowTaskKey: request.workflowTaskKey,
      groupKey: request.groupKey,
      requestKeys: [request.requestKey],
      taskRefs: [request.taskRef],
      blockerTaskRefs: [request.taskRef],
      createdRequestKeys: [],
      createdTaskRefs: [],
    }
    children.push({
      kind: 'planning',
      dependencyKey: request.workflowTaskKey,
      blockedByWorkflowKeys: request.blockedByWorkflowKeys,
      requestKeys: workflowResult.requestKeys,
      taskRefs: workflowResult.taskRefs,
      blockerTaskRefs: workflowResult.blockerTaskRefs,
      workflowResult,
    })
  }

  return children
}

async function readOpenPlanningWorkflowRequests(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const taskByRef = new Map(board.items.map((task) => [task.ref, task]))
  const openRequests = requestSet.requests.filter((request) => {
    const task = taskByRef.get(request.taskRef)
    return (
      request.status === 'open' &&
      request.workflowKey === input.workflowKey &&
      task?.status !== 'done'
    )
  })

  return {
    openRequests,
    tasks: board.items,
  }
}

async function describeReusableGroupedPlanningSurface(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    groupKey: string
  },
) {
  const requestSet = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const board = await stores.boardStore.readBoard(input.goalKey)
  const taskByRef = new Map(board.items.map((task) => [task.ref, task]))
  const requests = requestSet.requests.filter((request) => {
    const task = taskByRef.get(request.taskRef)
    return (
      request.status === 'open' &&
      request.groupKey === input.groupKey &&
      request.groupTaskKey &&
      task?.status !== 'done'
    )
  })

  if (requests.length === 0) {
    throw new Error(`Planning group not found for reuse: ${input.groupKey}`)
  }

  return {
    requests,
    tasks: board.items,
  }
}

async function describeOpenPlanningWorkflowState(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
): Promise<GoalPlanningWorkflowsResult> {
  const children = await describeOpenPlanningWorkflowChildren(stores, input)
  const workflows = children.map((child) => child.workflowResult)

  return {
    kind: 'workflow_batch',
    workflowKey: input.workflowKey,
    workflows,
    groupKeys: uniqueStringValues(
      workflows.flatMap((workflow) =>
        workflow.kind === 'planning_batch'
          ? [workflow.groupKey]
          : workflow.groupKey
            ? [workflow.groupKey]
            : [],
      ),
    ),
    requestKeys: uniqueStringValues(workflows.flatMap((workflow) => workflow.requestKeys)),
    taskRefs: uniqueStringValues(workflows.flatMap((workflow) => workflow.taskRefs)),
    blockerTaskRefs: computeWorkflowChildSinkBlockerTaskRefs(children),
    createdRequestKeys: [],
    createdTaskRefs: [],
  }
}

async function describeOpenPlanningWorkflowDetail(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    workflowKey: string
  },
): Promise<GoalPlanningWorkflowState | undefined> {
  const { openRequests, tasks } = await readOpenPlanningWorkflowRequests(stores, input)
  if (openRequests.length === 0) {
    return undefined
  }

  const workflows: GoalPlanningWorkflowLeafState[] = []
  const seenGroupedChildren = new Set<string>()

  for (const request of openRequests) {
    if (request.groupKey && request.groupTaskKey) {
      if (seenGroupedChildren.has(request.groupKey)) {
        continue
      }
      const groupedRequests = openRequests.filter(
        (entry) => entry.groupKey === request.groupKey && entry.groupTaskKey,
      )
      workflows.push({
        kind: 'planning_batch',
        groupKey: request.groupKey,
        blockedByWorkflowKeys: uniqueStringValues(
          groupedRequests.flatMap((entry) => entry.blockedByWorkflowKeys),
        ),
        requests: groupedRequests,
        blockerTaskRefs: findOpenGroupedPlanningSinkTaskRefs(groupedRequests, tasks),
      })
      seenGroupedChildren.add(request.groupKey)
      continue
    }

    workflows.push({
      kind: 'planning',
      workflowTaskKey: request.workflowTaskKey,
      groupKey: request.groupKey,
      blockedByWorkflowKeys: request.blockedByWorkflowKeys,
      request,
      blockerTaskRefs: [request.taskRef],
    })
  }

  return {
    kind: 'workflow_batch',
    workflowKey: input.workflowKey,
    workflowSharedDecisionRefs: uniqueStringValues(
      openRequests.flatMap((request) => request.workflowSharedDecisionRefs),
    ),
    workflowSharedAnswers: mergePlanningRequestAnswers(
      [],
      openRequests.flatMap((request) => request.workflowSharedAnswers),
    ),
    workflows,
    groupKeys: uniqueStringValues(
      workflows.flatMap((workflow) =>
        workflow.kind === 'planning_batch' ? [workflow.groupKey] : [],
      ),
    ),
    requestKeys: uniqueStringValues(
      workflows.flatMap((workflow) =>
        workflow.kind === 'planning_batch'
          ? workflow.requests.map((request) => request.requestKey)
          : [workflow.request.requestKey],
      ),
    ),
    taskRefs: uniqueStringValues(
      workflows.flatMap((workflow) =>
        workflow.kind === 'planning_batch'
          ? workflow.requests.map((request) => request.taskRef)
          : [workflow.request.taskRef],
      ),
    ),
    blockerTaskRefs: computeWorkflowLeafStateSinkBlockerTaskRefs(workflows),
  }
}

function findOpenGroupedPlanningSinkTaskRefs(
  requests: GoalPlanningRequest[],
  tasks: Array<{ ref: string; status: string; blockedBy: BlockerRef[] }>,
) {
  const taskByRef = new Map(tasks.map((task) => [task.ref, task]))
  const openTaskRefs = uniqueStringValues(
    requests
      .filter((request) => {
        const task = taskByRef.get(request.taskRef)
        return request.status === 'open' && task?.status !== 'done'
      })
      .map((request) => request.taskRef),
  )
  const openTaskRefSet = new Set(openTaskRefs)
  const prerequisiteRefs = new Set<string>()

  for (const taskRef of openTaskRefs) {
    const task = taskByRef.get(taskRef)
    if (!task) {
      continue
    }
    for (const blocker of task.blockedBy) {
      if (blocker.kind === 'task' && openTaskRefSet.has(blocker.ref)) {
        prerequisiteRefs.add(blocker.ref)
      }
    }
  }

  const sinkTaskRefs = openTaskRefs.filter((taskRef) => !prerequisiteRefs.has(taskRef))
  return sinkTaskRefs.length > 0 ? sinkTaskRefs : openTaskRefs
}

function findOpenGroupedPlanningRootTaskRefs(
  requests: GoalPlanningRequest[],
  tasks: Array<{ ref: string; status: string; blockedBy: BlockerRef[] }>,
) {
  const taskByRef = new Map(tasks.map((task) => [task.ref, task]))
  const openTaskRefs = uniqueStringValues(
    requests
      .filter((request) => {
        const task = taskByRef.get(request.taskRef)
        return request.status === 'open' && task?.status !== 'done'
      })
      .map((request) => request.taskRef),
  )
  const openTaskRefSet = new Set(openTaskRefs)

  const rootTaskRefs = openTaskRefs.filter((taskRef) => {
    const task = taskByRef.get(taskRef)
    if (!task) {
      return false
    }
    return !task.blockedBy.some(
      (blocker) => blocker.kind === 'task' && openTaskRefSet.has(blocker.ref),
    )
  })

  return rootTaskRefs.length > 0 ? rootTaskRefs : openTaskRefs
}

function workflowDependencyKeyForRequest(request: GoalPlanningRequest) {
  if (request.groupKey && request.groupTaskKey) {
    return request.groupKey
  }
  return request.workflowTaskKey
}

function computeWorkflowChildSinkBlockerTaskRefs(children: WorkflowChildState[]) {
  const prerequisiteKeys = new Set(children.flatMap((child) => child.blockedByWorkflowKeys))
  const sinkChildren = children.filter(
    (child) => !child.dependencyKey || !prerequisiteKeys.has(child.dependencyKey),
  )
  const relevantChildren = sinkChildren.length > 0 ? sinkChildren : children
  return uniqueStringValues(relevantChildren.flatMap((child) => child.blockerTaskRefs))
}

function workflowLeafDependencyKey(workflow: GoalPlanningWorkflowLeafState) {
  return workflow.kind === 'planning_batch' ? workflow.groupKey : workflow.workflowTaskKey
}

function computeWorkflowLeafStateSinkBlockerTaskRefs(workflows: GoalPlanningWorkflowLeafState[]) {
  const prerequisiteKeys = new Set(workflows.flatMap((workflow) => workflow.blockedByWorkflowKeys))
  const sinkWorkflows = workflows.filter((workflow) => {
    const dependencyKey = workflowLeafDependencyKey(workflow)
    return !dependencyKey || !prerequisiteKeys.has(dependencyKey)
  })
  const relevantWorkflows = sinkWorkflows.length > 0 ? sinkWorkflows : workflows
  return uniqueStringValues(relevantWorkflows.flatMap((workflow) => workflow.blockerTaskRefs))
}

function buildWorkflowChildStateMap(children: WorkflowChildState[]) {
  const childByKey = new Map<string, WorkflowChildState>()
  for (const child of children) {
    if (!child.dependencyKey) {
      continue
    }
    const existing = childByKey.get(child.dependencyKey)
    if (existing) {
      throw new Error(`Workflow child key conflict: ${child.dependencyKey}`)
    }
    childByKey.set(child.dependencyKey, child)
  }
  return childByKey
}

function resolveWorkflowDependencyBlockers(
  children: WorkflowChildState[],
  input: {
    workflowKey: string
    dependencyKey?: string
    blockedByWorkflowKeys: string[]
  },
) {
  if (!input.dependencyKey) {
    throw new Error('Direct workflow child dependencies require a stable child key')
  }
  if (input.blockedByWorkflowKeys.includes(input.dependencyKey)) {
    throw new Error(`Workflow child cannot depend on itself: ${input.dependencyKey}`)
  }

  const childByKey = buildWorkflowChildStateMap(children)
  for (const blockedByWorkflowKey of input.blockedByWorkflowKeys) {
    if (!childByKey.has(blockedByWorkflowKey)) {
      throw new Error(
        `Workflow dependency key not found in ${input.workflowKey}: ${blockedByWorkflowKey}`,
      )
    }
  }

  const blockedByWorkflowKeysByKey = new Map<string, string[]>()
  for (const child of children) {
    if (child.dependencyKey) {
      blockedByWorkflowKeysByKey.set(child.dependencyKey, child.blockedByWorkflowKeys)
    }
  }
  blockedByWorkflowKeysByKey.set(
    input.dependencyKey,
    uniqueStringValues(input.blockedByWorkflowKeys),
  )
  assertWorkflowDependencyGraphIsAcyclic(blockedByWorkflowKeysByKey)

  return mergeBlockerRefs(
    [],
    input.blockedByWorkflowKeys.flatMap((key) =>
      (childByKey.get(key)?.blockerTaskRefs ?? []).map((ref) => ({
        kind: 'task' as const,
        ref,
      })),
    ),
  )
}

function assertWorkflowDependencyGraphIsAcyclic(blockedByWorkflowKeysByKey: Map<string, string[]>) {
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (dependencyKey: string) => {
    if (visited.has(dependencyKey)) {
      return
    }
    if (visiting.has(dependencyKey)) {
      throw new Error(`Workflow dependency cycle detected at: ${dependencyKey}`)
    }
    visiting.add(dependencyKey)
    for (const blockedByWorkflowKey of blockedByWorkflowKeysByKey.get(dependencyKey) ?? []) {
      if (blockedByWorkflowKeysByKey.has(blockedByWorkflowKey)) {
        visit(blockedByWorkflowKey)
      }
    }
    visiting.delete(dependencyKey)
    visited.add(dependencyKey)
  }

  for (const dependencyKey of blockedByWorkflowKeysByKey.keys()) {
    visit(dependencyKey)
  }
}

function replaceWorkflowChildState(children: WorkflowChildState[], next: WorkflowChildState) {
  if (!next.dependencyKey) {
    return [...children, next]
  }

  const withoutCurrent = children.filter((child) => child.dependencyKey !== next.dependencyKey)
  return [...withoutCurrent, next]
}

function uniqueStringValues(values: string[]) {
  const unique: string[] = []
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value)
    }
  }
  return unique
}

function mergePlanningRequestAnswers(
  existing: GoalPlanningRequestAnswer[],
  incoming: GoalPlanningRequestAnswer[],
) {
  const merged = [...existing]
  const seen = new Set(existing.map((value) => `${value.summary}\u0000${value.answer}`))
  for (const value of incoming) {
    const key = `${value.summary}\u0000${value.answer}`
    if (!seen.has(key)) {
      merged.push(value)
      seen.add(key)
    }
  }
  return merged
}

function sameBlockerList(left: BlockerRef[], right: BlockerRef[]) {
  return (
    left.length === right.length &&
    left.every(
      (blocker, index) => blocker.kind === right[index]?.kind && blocker.ref === right[index]?.ref,
    )
  )
}

function mergeBlockerRefs(existing: BlockerRef[], incoming: BlockerRef[]) {
  const merged = [...existing]
  for (const blocker of incoming) {
    if (!merged.some((current) => current.kind === blocker.kind && current.ref === blocker.ref)) {
      merged.push(blocker)
    }
  }
  return merged
}

function isPlanningBatchRootRequest(request: GoalPlanningBatchEntryInput) {
  return (request.blockedByTaskKeys?.length ?? 0) === 0
}

function findUpgradeableGenericFollowThrough(
  requests: GoalPlanningRequest[],
  tasks: { ref: string; status: string }[],
  input: GoalPlanningRequestInput,
) {
  if (!input.decisionRefs || input.decisionRefs.length === 0) {
    return undefined
  }

  return requests.find(
    (request) =>
      request.status === 'open' &&
      request.title.startsWith('Plan follow-through for ') &&
      request.decisionRefs.some((decisionRef) => input.decisionRefs?.includes(decisionRef)) &&
      tasks.some((task) => task.ref === request.taskRef && task.status !== 'done'),
  )
}
