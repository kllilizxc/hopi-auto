import type { BoardStore } from '../storage/boardStore'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type {
  GoalPlanningRequestAnswer,
  PlanningRequestStore,
} from '../storage/planningRequestStore'
import {
  listGroupedPlanningSinkTaskRefs,
  mapExistingGroupedTaskRefs,
  syncGroupedPlanningEngineeringBlockers,
} from './planningGroupSupport'
import {
  type GoalPlanningBatchEntryInput,
  type GoalPlanningBatchResult,
  type GoalPlanningRequestInput,
  type GoalPlanningRequestResult,
  type GoalPlanningWorkflowLeafInput,
  finalizeGoalPlanningRequestResult,
  findUpgradeableGenericFollowThrough,
  isPlanningBatchRootRequest,
  mergePlanningRequestAnswers,
  mergeTaskAttachmentAssetPaths,
  nextPlanningTaskRef,
  resolvePlanningWorkflowKey,
  syncPlanningTaskAttachmentLineage,
  validateExistingTaskBlockers,
  validatePlanningBatchInput,
} from './planningRequestSupport'
import {
  type GoalPlanningWorkflowBatchResult,
  type GoalPlanningWorkflowLeafResult,
  type GoalPlanningWorkflowResult,
  type GoalPlanningWorkflowState,
  type GoalPlanningWorkflowsResult,
  describeOpenPlanningWorkflowChildren,
  describeOpenPlanningWorkflowDetail,
  describeOpenPlanningWorkflowState,
  describeReusableGroupedPlanningSurface,
  findOpenGroupedPlanningRootTaskRefs,
  mergeBlockerRefs,
  readPersistedWorkflowSharedContext,
  replaceWorkflowChildState,
  resolveWorkflowDependencyBlockers,
  syncPlanningWorkflowEngineeringBlockers,
  syncWorkflowPlanningChildDependenciesForWorkflow,
  syncWorkflowPlanningEngineeringBlockersForWorkflow,
  uniqueStringValues,
} from './planningWorkflowSupport'

export type {
  GoalPlanningWorkflowBatchResult,
  GoalPlanningWorkflowLeafResult,
  GoalPlanningWorkflowLeafState,
  GoalPlanningWorkflowPlanningBatchState,
  GoalPlanningWorkflowPlanningState,
  GoalPlanningWorkflowResult,
  GoalPlanningWorkflowState,
  GoalPlanningWorkflowsResult,
} from './planningWorkflowSupport'
export type {
  GoalPlanningBatchEntryInput,
  GoalPlanningBatchResult,
  GoalPlanningRequestInput,
  GoalPlanningRequestResult,
  GoalPlanningWorkflowBatchInput,
  GoalPlanningWorkflowInput,
  GoalPlanningWorkflowLeafInput,
} from './planningRequestSupport'
export {
  enrichPlanningRequestsForTaskDecision,
  listGroupedPlanningSinkTaskRefs,
  resolveGoalPlanningRequest,
  resolvePlanningRequestsForTask,
  syncGroupedPlanningEngineeringBlockers,
} from './planningGroupSupport'

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
        attachments: input.attachments,
        requestedUpdates: input.requestedUpdates,
      },
    )
    await syncPlanningTaskAttachmentLineage(stores.boardStore, {
      goalKey: input.goalKey,
      taskRef: enriched.taskRef,
      attachments: input.attachments,
      writer: input.writer,
      reason: input.reason,
    })
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
        attachments: input.attachments,
        requestedUpdates: input.requestedUpdates,
      },
    )
    await syncPlanningTaskAttachmentLineage(stores.boardStore, {
      goalKey: input.goalKey,
      taskRef: enriched.taskRef,
      attachments: input.attachments,
      writer: input.writer,
      reason: input.reason,
    })
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
          attachments: input.attachments,
          requestedUpdates: input.requestedUpdates,
        },
      )
      await syncPlanningTaskAttachmentLineage(stores.boardStore, {
        goalKey: input.goalKey,
        taskRef: enriched.taskRef,
        attachments: input.attachments,
        writer: input.writer,
        reason: input.reason,
      })
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
        task.attachmentAssetPaths = mergeTaskAttachmentAssetPaths(
          task.attachmentAssetPaths,
          input.attachments,
        )
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
        existingTask.attachmentAssetPaths = mergeTaskAttachmentAssetPaths(
          existingTask.attachmentAssetPaths,
          input.attachments,
        )
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
        attachmentAssetPaths: mergeTaskAttachmentAssetPaths(undefined, input.attachments),
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
    attachments: input.attachments,
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
      task.attachmentAssetPaths = mergeTaskAttachmentAssetPaths(
        task.attachmentAssetPaths,
        input.attachments,
      )
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
    attachments: input.attachments,
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
    attachments?: GoalAttachmentRef[]
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
        attachments: input.attachments,
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
      request: result.request,
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
    requests: entries.map((entry) => entry.request),
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
    attachments?: GoalAttachmentRef[]
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
              attachments: workflow.attachments ?? input.attachments,
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
              attachments: workflow.attachments ?? input.attachments,
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
        requests: result.requests,
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
      attachments: workflow.attachments ?? input.attachments,
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
      requests: [result.request],
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
    attachments?: GoalAttachmentRef[]
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
      attachments: input.attachments,
    })
    await syncPlanningTaskAttachmentLineage(stores.boardStore, {
      goalKey: input.goalKey,
      taskRef: request.taskRef,
      attachments: input.attachments,
      writer: input.writer,
      reason: input.reason,
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
      attachments: input.attachments,
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
      request,
      created:
        extension?.entries.find((entry) => entry.requestKey === request.requestKey)?.created ??
        false,
      taskCreated:
        extension?.entries.find((entry) => entry.requestKey === request.requestKey)?.taskCreated ??
        false,
    })),
    requests: next.requests,
  }
}
