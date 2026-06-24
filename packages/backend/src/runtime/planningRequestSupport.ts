import type { BlockerRef } from '../domain/board'
import {
  type PlanningRequestAnswerValue,
  mergePlanningRequestAnswers as mergeSharedPlanningRequestAnswers,
} from '../planningRequestAnswerSupport'
import type { BoardStore } from '../storage/boardStore'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type {
  GoalPlanningRequest,
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
  PlanningRequestStore,
} from '../storage/planningRequestStore'
import { syncGroupedPlanningEngineeringBlockers } from './planningGroupSupport'
import { uniqueStringValues } from './planningWorkflowSupport'

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
  attachments?: GoalAttachmentRef[]
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
    request: GoalPlanningRequest
    created: boolean
    taskCreated: boolean
  }>
  requests: GoalPlanningRequest[]
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
  attachments?: GoalAttachmentRef[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
  blockedBy?: BlockerRef[]
}

export interface GoalPlanningWorkflowBatchInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  decisionRefs?: string[]
  answers?: GoalPlanningRequestAnswer[]
  attachments?: GoalAttachmentRef[]
  requests?: GoalPlanningBatchEntryInput[]
}

export type GoalPlanningWorkflowLeafInput =
  | GoalPlanningWorkflowInput
  | GoalPlanningWorkflowBatchInput

export async function finalizeGoalPlanningRequestResult(
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

export function nextPlanningTaskRef(existingRefs: string[]) {
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

export async function resolvePlanningWorkflowKey(
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

export async function validateExistingTaskBlockers(
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

export function validatePlanningBatchInput(requests: GoalPlanningBatchEntryInput[]) {
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

export function mergeTaskAttachmentAssetPaths(
  existing: string[] | undefined,
  attachments: GoalAttachmentRef[] | undefined,
) {
  const nextAttachmentPaths = uniqueStringValues([
    ...(existing ?? []),
    ...(attachments ?? []).map((attachment) => attachment.assetPath),
  ])
  return nextAttachmentPaths.length > 0 ? nextAttachmentPaths : undefined
}

export async function syncPlanningTaskAttachmentLineage(
  boardStore: BoardStore,
  input: {
    goalKey: string
    taskRef: string
    attachments?: GoalAttachmentRef[]
    writer?: string
    reason?: string
  },
) {
  if (!input.attachments || input.attachments.length === 0) {
    return
  }

  await boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'planning_request',
    input.reason ?? `sync planning task attachments ${input.taskRef}`,
    (board) => {
      const task = board.items.find((item) => item.ref === input.taskRef)
      if (!task) {
        throw new Error(`Task not found: ${input.taskRef}`)
      }
      task.attachmentAssetPaths = mergeTaskAttachmentAssetPaths(
        task.attachmentAssetPaths,
        input.attachments,
      )
    },
  )
}

export function mergePlanningRequestAnswers(
  existing: GoalPlanningRequestAnswer[],
  incoming: GoalPlanningRequestAnswer[],
) {
  return mergeSharedPlanningRequestAnswers(existing, incoming, {
    prepareInsertedMatchHints: preserveInsertedPlanningRequestAnswerMatchHints,
  })
}

export function isPlanningBatchRootRequest(request: GoalPlanningBatchEntryInput) {
  return (request.blockedByTaskKeys?.length ?? 0) === 0
}

export function findUpgradeableGenericFollowThrough(
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

function preserveInsertedPlanningRequestAnswerMatchHints(
  values: PlanningRequestAnswerValue['matchHints'],
) {
  return values?.length ? values : undefined
}
