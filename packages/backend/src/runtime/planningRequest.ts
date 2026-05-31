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
  const currentRequests = await stores.planningRequests.readGoalPlanningRequests(input.goalKey)
  const currentBoard = await stores.boardStore.readBoard(input.goalKey)
  const existingByKey = input.requestKey
    ? currentRequests.requests.find((request) => request.requestKey === input.requestKey)
    : undefined
  if (existingByKey) {
    const enriched = await stores.planningRequests.mergeRequestMetadata(
      input.goalKey,
      existingByKey.requestKey,
      {
        groupKey: input.groupKey,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return {
      request: enriched,
      created: false,
      taskCreated: false,
    }
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
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )
    return {
      request: enriched,
      created: false,
      taskCreated: false,
    }
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
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        decisionRefs: input.decisionRefs,
        requestedUpdates: input.requestedUpdates,
      },
    )

    return {
      request: upgraded,
      created: false,
      taskCreated: false,
    }
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
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    taskRef,
    decisionRefs: input.decisionRefs,
    requestedUpdates: input.requestedUpdates,
  })

  return {
    request,
    created: true,
    taskCreated,
  }
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
    const result = await requestGoalPlanning(stores, {
      goalKey: input.goalKey,
      requestKey: request.requestKey,
      groupKey: input.groupKey,
      title: request.title,
      description: request.description,
      acceptanceCriteria: request.acceptanceCriteria,
      decisionRefs: input.decisionRefs,
      requestedUpdates: request.requestedUpdates,
      writer: input.writer,
      reason: input.reason,
    })
    entries.push({
      taskKey: request.taskKey,
      requestKey: result.request.requestKey,
      taskRef: result.request.taskRef,
      created: result.created,
      taskCreated: result.taskCreated,
    })
  }

  const taskRefByKey = new Map(entries.map((entry) => [entry.taskKey, entry.taskRef]))
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
            const ref = taskRefByKey.get(taskKey)
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

  return {
    groupKey: input.groupKey,
    entries,
  }
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

  const enriched = []
  for (const request of openRequests) {
    enriched.push(
      await stores.planningRequests.mergeRequestMetadata(input.goalKey, request.requestKey, {
        decisionRefs: [input.decisionKey],
        requestedUpdates: request.requestedUpdates.length === 0 ? ['design.md', 'todo.yml'] : [],
      }),
    )
  }

  return enriched
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
    for (const dependencyKey of request.blockedByTaskKeys ?? []) {
      if (!requestByKey.has(dependencyKey)) {
        throw new Error(`Unknown planning batch dependency: ${dependencyKey}`)
      }
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
      visit(dependencyKey)
    }
    visiting.delete(taskKey)
    visited.add(taskKey)
  }

  for (const taskKey of taskKeys) {
    visit(taskKey)
  }
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
