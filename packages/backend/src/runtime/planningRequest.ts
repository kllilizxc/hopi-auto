import type { BlockerRef } from '../domain/board'
import type { BoardStore } from '../storage/boardStore'
import type { GoalPlanningRequest, PlanningRequestStore } from '../storage/planningRequestStore'

export interface GoalPlanningRequestInput {
  goalKey: string
  requestKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy?: BlockerRef[]
  writer?: string
  reason?: string
}

export interface GoalPlanningRequestResult {
  request: GoalPlanningRequest
  created: boolean
  taskCreated: boolean
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
    return {
      request: existingByKey,
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
    return {
      request: existingOpen,
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
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    taskRef,
  })

  return {
    request,
    created: true,
    taskCreated,
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
