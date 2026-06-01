import type { BlockerRef } from '../domain/board'
import type { BoardStore } from '../storage/boardStore'
import type {
  GoalPlanningRequest,
  GoalPlanningRequestUpdateTarget,
  PlanningRequestStore,
} from '../storage/planningRequestStore'

export interface GoalPlanningRequestInput {
  goalKey: string
  requestKey?: string
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  decisionRefs?: string[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
  blockedBy?: BlockerRef[]
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
  const existingByKey = input.requestKey
    ? currentRequests.requests.find((request) => request.requestKey === input.requestKey)
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
  if (existingByKey) {
    const enriched = await stores.planningRequests.mergeRequestMetadata(
      input.goalKey,
      existingByKey.requestKey,
      {
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: enriched,
      created: false,
      taskCreated: false,
    })
  }

  if (existingByGroupTaskKey) {
    const enriched = await stores.planningRequests.mergeRequestMetadata(
      input.goalKey,
      existingByGroupTaskKey.requestKey,
      {
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: enriched,
      created: false,
      taskCreated: false,
    })
  }

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
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        decisionRefs: input.decisionRefs,
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
    await stores.boardStore.mutateBoard(
      input.goalKey,
      input.writer ?? 'planning_request',
      input.reason ?? `upgrade planning ${input.title}`,
      (board) => {
        const task = board.items.find((item) => item.ref === upgradeableGeneric.taskRef)
        if (!task) {
          throw new Error(`Task not found: ${upgradeableGeneric.taskRef}`)
        }
        task.title = input.title
        task.description = input.description
        task.acceptanceCriteria = [...input.acceptanceCriteria]
      },
    )

    const upgraded = await stores.planningRequests.updateRequest(
      input.goalKey,
      upgradeableGeneric.requestKey,
      {
        groupKey: input.groupKey,
        groupTaskKey: input.groupTaskKey,
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )

    return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
      request: upgraded,
      created: false,
      taskCreated: false,
    })
  }

  let taskRef = ''
  let taskCreated = false
  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `request planning ${input.title}`,
    (board) => {
      const existingTask = board.items.find(
        (item) => item.kind === 'planning' && item.title === input.title && item.status !== 'done',
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
    groupKey: input.groupKey,
    groupTaskKey: input.groupTaskKey,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    taskRef,
    decisionRefs: input.decisionRefs,
    requestedUpdates: input.requestedUpdates,
  })

  return finalizeGoalPlanningRequestResult(stores, input, syncGroupedBlockers, {
    request,
    created: true,
    taskCreated,
  })
}

export async function requestGoalPlanningBatch(
  stores: {
    boardStore: BoardStore
    planningRequests: PlanningRequestStore
  },
  input: {
    goalKey: string
    groupKey: string
    decisionRefs?: string[]
    requests: GoalPlanningBatchEntryInput[]
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
        requestKey: request.requestKey,
        groupKey: input.groupKey,
        groupTaskKey: request.taskKey,
        title: request.title,
        description: request.description,
        acceptanceCriteria: request.acceptanceCriteria,
        decisionRefs: input.decisionRefs,
        requestedUpdates: request.requestedUpdates,
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

function uniqueStringValues(values: string[]) {
  const unique: string[] = []
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value)
    }
  }
  return unique
}

function sameBlockerList(left: BlockerRef[], right: BlockerRef[]) {
  return (
    left.length === right.length &&
    left.every(
      (blocker, index) => blocker.kind === right[index]?.kind && blocker.ref === right[index]?.ref,
    )
  )
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
