import type { BlockerRef } from '../domain/board'
import { mergePlanningRequestAnswers } from '../planningRequestAnswerSupport'
import type { BoardStore } from '../storage/boardStore'
import type {
  GoalPlanningRequest,
  GoalPlanningRequestAnswer,
  PlanningRequestStore,
} from '../storage/planningRequestStore'

type BoardItems = Awaited<ReturnType<BoardStore['readBoard']>>['items']

export interface GoalPlanningWorkflowResult {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  requests: GoalPlanningRequest[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export interface GoalPlanningWorkflowBatchResult {
  kind: 'planning_batch'
  groupKey: string
  requests: GoalPlanningRequest[]
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
  requests: GoalPlanningRequest[]
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

export interface WorkflowChildState {
  kind: GoalPlanningWorkflowLeafResult['kind']
  dependencyKey?: string
  blockedByWorkflowKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  workflowResult: GoalPlanningWorkflowLeafResult
}

export function sameBlockerList(left: BlockerRef[], right: BlockerRef[]) {
  return (
    left.length === right.length &&
    left.every(
      (blocker, index) => blocker.kind === right[index]?.kind && blocker.ref === right[index]?.ref,
    )
  )
}

export function mergeBlockerRefs(existing: BlockerRef[], incoming: BlockerRef[]) {
  const merged = [...existing]
  for (const blocker of incoming) {
    if (!merged.some((current) => current.kind === blocker.kind && current.ref === blocker.ref)) {
      merged.push(blocker)
    }
  }
  return merged
}

export async function syncPlanningWorkflowEngineeringBlockers(
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

export async function syncWorkflowPlanningEngineeringBlockersForWorkflow(
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

export async function syncWorkflowPlanningChildDependenciesForWorkflow(
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

export async function describeOpenPlanningWorkflowChildren(
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
        requests: groupedRequests,
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
      requests: [request],
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

export async function describeReusableGroupedPlanningSurface(
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

export async function readPersistedWorkflowSharedContext(
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

export async function describeOpenPlanningWorkflowState(
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
    requests: uniqueRequestsByKey(workflows.flatMap((workflow) => workflow.requests)),
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

export async function describeOpenPlanningWorkflowDetail(
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

export function findOpenGroupedPlanningSinkTaskRefs(
  requests: GoalPlanningRequest[],
  tasks: BoardItems,
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

export function findOpenGroupedPlanningRootTaskRefs(
  requests: GoalPlanningRequest[],
  tasks: BoardItems,
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

export function resolveWorkflowDependencyBlockers(
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

export function replaceWorkflowChildState(
  children: WorkflowChildState[],
  next: WorkflowChildState,
) {
  if (!next.dependencyKey) {
    return [...children, next]
  }

  const withoutCurrent = children.filter((child) => child.dependencyKey !== next.dependencyKey)
  return [...withoutCurrent, next]
}

export function uniqueStringValues(values: string[]) {
  const unique: string[] = []
  for (const value of values) {
    if (!unique.includes(value)) {
      unique.push(value)
    }
  }
  return unique
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

function uniqueRequestsByKey(requests: GoalPlanningRequest[]) {
  const unique: GoalPlanningRequest[] = []
  const seen = new Set<string>()
  for (const request of requests) {
    if (seen.has(request.requestKey)) {
      continue
    }
    seen.add(request.requestKey)
    unique.push(request)
  }
  return unique
}
