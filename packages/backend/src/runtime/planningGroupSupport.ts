import type { BlockerRef } from '../domain/board'
import type { BoardStore } from '../storage/boardStore'
import type { GoalPlanningRequest, PlanningRequestStore } from '../storage/planningRequestStore'
import {
  findOpenGroupedPlanningSinkTaskRefs,
  sameBlockerList,
  uniqueStringValues,
} from './planningWorkflowSupport'

type BoardItems = Awaited<ReturnType<BoardStore['readBoard']>>['items']

export function mapExistingGroupedTaskRefs(
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
  tasks: BoardItems,
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
