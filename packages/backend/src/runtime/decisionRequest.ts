import type { BoardStore } from '../storage/boardStore'
import type { DecisionStore, GoalDecision } from '../storage/decisionStore'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
  PlanningRequestStore,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'
import {
  enrichPlanningRequestsForTaskDecision,
  listGroupedPlanningSinkTaskRefs,
  requestGoalPlanning,
  requestGoalPlanningBatch,
  requestGoalPlanningWorkflows,
} from './planningRequest'

export interface GoalDecisionRequestInput {
  goalKey: string
  summary: string
  decisionKey?: string
  taskRef?: string
  writer?: string
  reason?: string
}

export interface GoalDecisionRequestResult {
  decision: GoalDecision
  created: boolean
  blockerAdded: boolean
}

export interface GoalDecisionResolveResult {
  decision: GoalDecision
  blockerRemoved: boolean
  followThrough?: GoalDecisionFollowThroughResult
}

export interface GoalDecisionAnswerResult extends GoalDecisionResolveResult {
  created: boolean
}

export interface GoalDecisionAnswerEntryInput {
  summary: string
  decisionKey?: string
  taskRef?: string
  answer: string
}

export interface GoalDecisionAnswerBatchResult {
  decisions: GoalDecision[]
  createdDecisionKeys: string[]
  blockerRemoved: boolean
  followThrough?: GoalDecisionFollowThroughResult
}

export interface GoalDecisionPlanningFollowThroughInput {
  kind: 'planning'
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: GoalPlanningRequestAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface GoalDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  answers?: GoalPlanningRequestAnswer[]
  requests: GoalPlanningBatchEntryInput[]
}

export interface GoalDecisionWorkflowPlanningFollowThroughInput {
  kind: 'planning'
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: GoalPlanningRequestAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface GoalDecisionWorkflowPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  answers?: GoalPlanningRequestAnswer[]
  requests: GoalPlanningBatchEntryInput[]
}

export type GoalDecisionWorkflowLeafFollowThroughInput =
  | GoalDecisionWorkflowPlanningFollowThroughInput
  | GoalDecisionWorkflowPlanningBatchFollowThroughInput

export interface GoalDecisionWorkflowBatchFollowThroughInput {
  kind: 'workflow_batch'
  workflowKey?: string
  workflows: GoalDecisionWorkflowLeafFollowThroughInput[]
}

export type GoalDecisionLeafFollowThroughInput =
  | GoalDecisionPlanningFollowThroughInput
  | GoalDecisionPlanningBatchFollowThroughInput

export type GoalDecisionFollowThroughInput =
  | GoalDecisionLeafFollowThroughInput
  | GoalDecisionWorkflowBatchFollowThroughInput

export interface GoalDecisionPlanningFollowThroughResult {
  kind: 'planning'
  workflowTaskKey?: string
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export interface GoalDecisionPlanningBatchFollowThroughResult {
  kind: 'planning_batch'
  groupKey: string
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export type GoalDecisionLeafFollowThroughResult =
  | GoalDecisionPlanningFollowThroughResult
  | GoalDecisionPlanningBatchFollowThroughResult

export interface GoalDecisionWorkflowBatchFollowThroughResult {
  kind: 'workflow_batch'
  workflowKey?: string
  workflows: GoalDecisionLeafFollowThroughResult[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export type GoalDecisionFollowThroughResult =
  | GoalDecisionLeafFollowThroughResult
  | GoalDecisionWorkflowBatchFollowThroughResult

export async function requestGoalDecision(
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    planningRequests?: PlanningRequestStore
  },
  input: GoalDecisionRequestInput,
): Promise<GoalDecisionRequestResult> {
  const current = await stores.decisions.readGoalDecisions(input.goalKey)
  const existing = input.decisionKey
    ? current.decisions.find((decision) => decision.decisionKey === input.decisionKey)
    : undefined

  const decision =
    existing ??
    (await stores.decisions.createDecision(input.goalKey, {
      decisionKey: input.decisionKey,
      summary: input.summary,
      taskRef: input.taskRef,
    }))
  let blockerAdded = false

  if (input.taskRef && decision.status === 'open') {
    await stores.boardStore.mutateBoard(
      input.goalKey,
      input.writer ?? 'decision',
      input.reason ?? `request decision ${decision.decisionKey}`,
      (board) => {
        const task = board.items.find((item) => item.ref === input.taskRef)
        if (!task) {
          throw new Error(`Task not found: ${input.taskRef}`)
        }
        if (
          !task.blockedBy.some(
            (blocker) => blocker.kind === 'decision' && blocker.ref === decision.decisionKey,
          )
        ) {
          task.blockedBy.push({
            kind: 'decision',
            ref: decision.decisionKey,
          })
          blockerAdded = true
        }
      },
    )
  }

  const linkedTaskRef = input.taskRef ?? decision.taskRef
  if (linkedTaskRef && stores.planningRequests) {
    const board = await stores.boardStore.readBoard(input.goalKey)
    const task = board.items.find((item) => item.ref === linkedTaskRef)
    if (task?.kind === 'planning') {
      await enrichPlanningRequestsForTaskDecision(
        {
          planningRequests: stores.planningRequests,
        },
        {
          goalKey: input.goalKey,
          taskRef: linkedTaskRef,
          decisionKey: decision.decisionKey,
        },
      )
    }
  }

  return {
    decision,
    created: !existing,
    blockerAdded,
  }
}

export async function resolveGoalDecision(
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    planningRequests?: PlanningRequestStore
  },
  input: {
    goalKey: string
    decisionKey: string
    answer: string
    followThrough?: GoalDecisionFollowThroughInput
    writer?: string
    reason?: string
  },
): Promise<GoalDecisionResolveResult> {
  const decision = await stores.decisions.resolveDecision(input.goalKey, input.decisionKey, {
    answer: input.answer,
  })
  const followThrough = await createDecisionResolutionFollowThrough(
    stores,
    input.goalKey,
    [decision],
    input.followThrough,
    input.writer,
    input.reason,
  )
  let blockerRemoved = false
  const resolvedDecisionKeys = new Set([input.decisionKey])

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'decision',
    input.reason ?? `resolve decision ${input.decisionKey}`,
    (board) => {
      for (const task of board.items) {
        const nextBlockedBy = task.blockedBy.filter(
          (blocker) => !(blocker.kind === 'decision' && resolvedDecisionKeys.has(blocker.ref)),
        )
        if (nextBlockedBy.length !== task.blockedBy.length) {
          if (followThrough && task.kind === 'engineering') {
            for (const blockerTaskRef of followThrough.blockerTaskRefs) {
              if (
                !nextBlockedBy.some(
                  (blocker) => blocker.kind === 'task' && blocker.ref === blockerTaskRef,
                )
              ) {
                nextBlockedBy.push({
                  kind: 'task',
                  ref: blockerTaskRef,
                })
              }
            }
          }
          task.blockedBy = nextBlockedBy
          blockerRemoved = true
        }
      }
    },
  )

  return {
    decision,
    blockerRemoved,
    followThrough,
  }
}

export async function answerGoalDecision(
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    planningRequests?: PlanningRequestStore
  },
  input: {
    goalKey: string
    summary: string
    decisionKey?: string
    taskRef?: string
    answer: string
    followThrough?: GoalDecisionFollowThroughInput
    writer?: string
    reason?: string
  },
): Promise<GoalDecisionAnswerResult> {
  const result = await answerGoalDecisions(stores, {
    goalKey: input.goalKey,
    answers: [
      {
        summary: input.summary,
        decisionKey: input.decisionKey,
        taskRef: input.taskRef,
        answer: input.answer,
      },
    ],
    followThrough: input.followThrough,
    writer: input.writer,
    reason: input.reason,
  })
  const decision = result.decisions[0]
  if (!decision) {
    throw new Error('Expected one resolved decision.')
  }

  return {
    decision,
    created: result.createdDecisionKeys.includes(decision.decisionKey),
    blockerRemoved: result.blockerRemoved,
    followThrough: result.followThrough,
  }
}

export async function answerGoalDecisions(
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
    planningRequests?: PlanningRequestStore
  },
  input: {
    goalKey: string
    answers: GoalDecisionAnswerEntryInput[]
    followThrough?: GoalDecisionFollowThroughInput
    writer?: string
    reason?: string
  },
): Promise<GoalDecisionAnswerBatchResult> {
  validateDecisionAnswerBatch(input.answers)

  const current = await stores.decisions.readGoalDecisions(input.goalKey)
  const existingByKey = new Map(
    current.decisions.map((decision) => [decision.decisionKey, decision] as const),
  )
  const decisions: GoalDecision[] = []
  const createdDecisionKeys: string[] = []

  for (const answer of input.answers) {
    const existing = answer.decisionKey ? existingByKey.get(answer.decisionKey) : undefined
    const decision =
      existing ??
      (await stores.decisions.createDecision(input.goalKey, {
        decisionKey: answer.decisionKey,
        summary: answer.summary,
        taskRef: answer.taskRef,
      }))
    const resolved = await stores.decisions.resolveDecision(input.goalKey, decision.decisionKey, {
      answer: answer.answer,
    })
    if (!existing) {
      createdDecisionKeys.push(resolved.decisionKey)
      existingByKey.set(resolved.decisionKey, resolved)
    }
    decisions.push(resolved)
  }

  const followThrough = await createDecisionResolutionFollowThrough(
    stores,
    input.goalKey,
    decisions,
    input.followThrough,
    input.writer,
    input.reason ??
      `record answers ${decisions.map((decision) => decision.decisionKey).join(', ')}`,
  )
  let blockerRemoved = false
  const resolvedDecisionKeys = new Set(decisions.map((decision) => decision.decisionKey))

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'decision',
    input.reason ??
      `record answers ${decisions.map((decision) => decision.decisionKey).join(', ')}`,
    (board) => {
      for (const task of board.items) {
        const nextBlockedBy = task.blockedBy.filter(
          (blocker) => !(blocker.kind === 'decision' && resolvedDecisionKeys.has(blocker.ref)),
        )
        if (nextBlockedBy.length !== task.blockedBy.length) {
          if (followThrough && task.kind === 'engineering') {
            for (const blockerTaskRef of followThrough.blockerTaskRefs) {
              if (
                !nextBlockedBy.some(
                  (blocker) => blocker.kind === 'task' && blocker.ref === blockerTaskRef,
                )
              ) {
                nextBlockedBy.push({
                  kind: 'task',
                  ref: blockerTaskRef,
                })
              }
            }
          }
          task.blockedBy = nextBlockedBy
          blockerRemoved = true
        }
      }
    },
  )

  return {
    decisions,
    createdDecisionKeys,
    blockerRemoved,
    followThrough,
  }
}

async function createDecisionResolutionFollowThrough(
  stores: {
    boardStore: BoardStore
    planningRequests?: PlanningRequestStore
  },
  goalKey: string,
  decisions: GoalDecision[],
  followThrough: GoalDecisionFollowThroughInput | undefined,
  writer?: string,
  reason?: string,
) {
  if (!stores.planningRequests) {
    return undefined
  }

  const primaryDecision = decisions[0]
  if (!primaryDecision) {
    return undefined
  }

  const board = await stores.boardStore.readBoard(goalKey)
  const decisionRefs = mergeOrderedStrings(decisions.map((decision) => decision.decisionKey))
  const linkedPlanningTaskRefs = mergeOrderedStrings(
    decisions.flatMap((decision) => {
      if (!decision.taskRef) {
        return []
      }
      const task = board.items.find(
        (item) =>
          item.ref === decision.taskRef && item.kind === 'planning' && item.status !== 'done',
      )
      return task ? [task.ref] : []
    }),
  )
  const reusablePlanningTaskRef =
    linkedPlanningTaskRefs.length === 1 ? linkedPlanningTaskRefs[0] : undefined
  const resolvedDecisionKeySet = new Set(decisionRefs)
  const affectedEngineeringTasks = board.items.filter(
    (task) =>
      task.kind === 'engineering' &&
      task.blockedBy.some(
        (blocker) => blocker.kind === 'decision' && resolvedDecisionKeySet.has(blocker.ref),
      ),
  )
  if (!followThrough && affectedEngineeringTasks.length === 0) {
    return undefined
  }
  if (followThrough?.kind === 'workflow_batch') {
    const result = await requestGoalPlanningWorkflows(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        workflowKey: followThrough.workflowKey,
        reuseTaskRef: reusablePlanningTaskRef,
        workflows: followThrough.workflows.map((workflow) => {
          if (workflow.kind === 'planning_batch') {
            return {
              kind: 'planning_batch' as const,
              groupKey: workflow.groupKey,
              blockedByWorkflowKeys: workflow.blockedByWorkflowKeys,
              decisionRefs,
              answers: workflow.answers,
              requests: workflow.requests,
            }
          }

          return {
            kind: 'planning' as const,
            workflowTaskKey: workflow.workflowTaskKey,
            blockedByWorkflowKeys: workflow.blockedByWorkflowKeys,
            title: workflow.title,
            description: workflow.description,
            acceptanceCriteria: workflow.acceptanceCriteria,
            decisionRefs,
            answers: workflow.answers,
            requestedUpdates: workflow.requestedUpdates,
          }
        }),
        writer: writer ?? 'decision',
        reason: reason ?? `decision resolution follow-through ${primaryDecision.decisionKey}`,
      },
    )

    return {
      kind: 'workflow_batch' as const,
      workflowKey: result.workflowKey,
      workflows: result.workflows.map((workflow) => {
        if (workflow.kind === 'planning_batch') {
          return {
            kind: 'planning_batch' as const,
            groupKey: workflow.groupKey,
            requestKeys: workflow.requestKeys,
            taskRefs: workflow.taskRefs,
            blockerTaskRefs: workflow.blockerTaskRefs,
          }
        }

        return {
          kind: 'planning' as const,
          workflowTaskKey: workflow.workflowTaskKey,
          requestKeys: workflow.requestKeys,
          taskRefs: workflow.taskRefs,
          blockerTaskRefs: workflow.blockerTaskRefs,
        }
      }),
      groupKeys: result.groupKeys,
      requestKeys: result.requestKeys,
      taskRefs: result.taskRefs,
      blockerTaskRefs: result.blockerTaskRefs,
    }
  }

  if (followThrough) {
    return materializeExplicitDecisionFollowThrough(
      stores,
      goalKey,
      decisionRefs,
      primaryDecision,
      followThrough,
      reusablePlanningTaskRef,
      writer,
      reason,
    )
  }

  const result = await requestGoalPlanning(
    {
      boardStore: stores.boardStore,
      planningRequests: stores.planningRequests,
    },
    {
      goalKey,
      title: defaultDecisionFollowThroughTitle(decisions),
      description: defaultDecisionFollowThroughDescription(decisions),
      acceptanceCriteria: [
        `design.md captures the follow-through for ${describeDecisionKeys(decisions)}.`,
        `todo.yml reflects the follow-through for ${describeDecisionKeys(decisions)} before engineering resumes.`,
      ],
      decisionRefs,
      requestedUpdates: ['design.md', 'todo.yml'],
      writer: writer ?? 'decision',
      reason: reason ?? `decision resolution follow-through ${describeDecisionKeys(decisions)}`,
    },
  )

  return {
    kind: 'planning' as const,
    requestKeys: [result.request.requestKey],
    taskRefs: [result.request.taskRef],
    blockerTaskRefs: [result.request.taskRef],
  }
}

async function materializeExplicitDecisionFollowThrough(
  stores: {
    boardStore: BoardStore
    planningRequests?: PlanningRequestStore
  },
  goalKey: string,
  decisionRefs: string[],
  primaryDecision: GoalDecision,
  followThrough: GoalDecisionLeafFollowThroughInput,
  reusablePlanningTaskRef: string | undefined,
  writer?: string,
  reason?: string,
): Promise<GoalDecisionLeafFollowThroughResult> {
  if (!stores.planningRequests) {
    throw new Error('Planning request store is required for explicit follow-through.')
  }

  if (followThrough.kind === 'planning_batch') {
    const result = await requestGoalPlanningBatch(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        groupKey: followThrough.groupKey,
        decisionRefs,
        answers: followThrough.answers,
        requests: followThrough.requests,
        reuseTaskRefByTaskKey: reusablePlanningTaskRef
          ? {
              [followThrough.requests[0]?.taskKey ?? '']: reusablePlanningTaskRef,
            }
          : undefined,
        writer: writer ?? 'decision',
        reason: reason ?? `decision resolution follow-through ${primaryDecision.decisionKey}`,
      },
    )
    const blockerTaskRefs = await listGroupedPlanningSinkTaskRefs(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        groupKey: result.groupKey,
      },
    )

    return {
      kind: 'planning_batch',
      groupKey: result.groupKey,
      requestKeys: result.entries.map((entry) => entry.requestKey),
      taskRefs: result.entries.map((entry) => entry.taskRef),
      blockerTaskRefs,
    }
  }

  const result = await requestGoalPlanning(
    {
      boardStore: stores.boardStore,
      planningRequests: stores.planningRequests,
    },
    {
      goalKey,
      title: followThrough.title,
      description: followThrough.description,
      acceptanceCriteria: followThrough.acceptanceCriteria,
      decisionRefs,
      answers: followThrough.answers,
      requestedUpdates: followThrough.requestedUpdates,
      reuseTaskRef: reusablePlanningTaskRef,
      writer: writer ?? 'decision',
      reason: reason ?? `decision resolution follow-through ${primaryDecision.decisionKey}`,
    },
  )

  return {
    kind: 'planning',
    requestKeys: [result.request.requestKey],
    taskRefs: [result.request.taskRef],
    blockerTaskRefs: [result.request.taskRef],
  }
}

function mergeOrderedStrings(values: string[]) {
  return [...new Set(values)]
}

function validateDecisionAnswerBatch(answers: GoalDecisionAnswerEntryInput[]) {
  const seen = new Set<string>()
  for (const answer of answers) {
    if (!answer.decisionKey) {
      continue
    }
    if (seen.has(answer.decisionKey)) {
      throw new Error(`Duplicate decision key in answer batch: ${answer.decisionKey}`)
    }
    seen.add(answer.decisionKey)
  }
}

function describeDecisionKeys(decisions: GoalDecision[]) {
  return decisions.map((decision) => decision.decisionKey).join(', ')
}

function defaultDecisionFollowThroughTitle(decisions: GoalDecision[]) {
  return decisions.length === 1
    ? `Plan follow-through for ${decisions[0]?.decisionKey}`
    : `Plan follow-through for ${decisions.length} resolved decisions`
}

function defaultDecisionFollowThroughDescription(decisions: GoalDecision[]) {
  if (decisions.length === 1) {
    const decision = decisions[0]
    return `Update design.md and todo.yml to reflect the resolved decision "${decision?.summary}" before engineering continues.`
  }

  return `Update design.md and todo.yml to reflect the resolved decisions ${describeDecisionKeys(decisions)} before engineering continues.`
}
