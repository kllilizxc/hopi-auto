import type { BoardStore } from '../storage/boardStore'
import type { DecisionStore, GoalDecision } from '../storage/decisionStore'
import type {
  GoalPlanningRequestUpdateTarget,
  PlanningRequestStore,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'
import {
  enrichPlanningRequestsForTaskDecision,
  listGroupedPlanningSinkTaskRefs,
  requestGoalPlanning,
  requestGoalPlanningBatch,
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

export interface GoalDecisionPlanningFollowThroughInput {
  kind: 'planning'
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface GoalDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  requests: GoalPlanningBatchEntryInput[]
}

export type GoalDecisionFollowThroughInput =
  | GoalDecisionPlanningFollowThroughInput
  | GoalDecisionPlanningBatchFollowThroughInput

export interface GoalDecisionFollowThroughResult {
  kind: GoalDecisionFollowThroughInput['kind']
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  groupKey?: string
}

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
    decision,
    input.followThrough,
    input.writer,
    input.reason,
  )
  let blockerRemoved = false

  await stores.boardStore.mutateBoard(
    input.goalKey,
    input.writer ?? 'decision',
    input.reason ?? `resolve decision ${input.decisionKey}`,
    (board) => {
      for (const task of board.items) {
        const nextBlockedBy = task.blockedBy.filter(
          (blocker) => !(blocker.kind === 'decision' && blocker.ref === input.decisionKey),
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
  const result = await resolveGoalDecision(stores, {
    goalKey: input.goalKey,
    decisionKey: decision.decisionKey,
    answer: input.answer,
    followThrough: input.followThrough,
    writer: input.writer,
    reason: input.reason ?? `record answer ${decision.decisionKey}`,
  })

  return {
    created: !existing,
    ...result,
  }
}

async function createDecisionResolutionFollowThrough(
  stores: {
    boardStore: BoardStore
    planningRequests?: PlanningRequestStore
  },
  goalKey: string,
  decision: GoalDecision,
  followThrough: GoalDecisionFollowThroughInput | undefined,
  writer?: string,
  reason?: string,
) {
  if (!stores.planningRequests) {
    return undefined
  }

  const board = await stores.boardStore.readBoard(goalKey)
  const linkedPlanningTask =
    decision.taskRef === undefined
      ? undefined
      : board.items.find(
          (task) =>
            task.ref === decision.taskRef && task.kind === 'planning' && task.status !== 'done',
        )
  const affectedEngineeringTasks = board.items.filter(
    (task) =>
      task.kind === 'engineering' &&
      task.blockedBy.some(
        (blocker) => blocker.kind === 'decision' && blocker.ref === decision.decisionKey,
      ),
  )
  if (!followThrough && affectedEngineeringTasks.length === 0) {
    return undefined
  }
  if (!followThrough && !linkedPlanningTask && affectedEngineeringTasks.length === 0) {
    return undefined
  }

  if (followThrough?.kind === 'planning_batch') {
    const result = await requestGoalPlanningBatch(
      {
        boardStore: stores.boardStore,
        planningRequests: stores.planningRequests,
      },
      {
        goalKey,
        groupKey: followThrough.groupKey,
        decisionRefs: [decision.decisionKey],
        requests: followThrough.requests,
        reuseTaskRefByTaskKey: linkedPlanningTask
          ? {
              [followThrough.requests[0]?.taskKey ?? '']: linkedPlanningTask.ref,
            }
          : undefined,
        writer: writer ?? 'decision',
        reason: reason ?? `decision resolution follow-through ${decision.decisionKey}`,
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
      kind: 'planning_batch' as const,
      groupKey: result.groupKey,
      requestKeys: result.entries.map((entry) => entry.requestKey),
      taskRefs: result.entries.map((entry) => entry.taskRef),
      blockerTaskRefs,
    }
  }

  const explicitPlanning = followThrough?.kind === 'planning' ? followThrough : undefined
  const result = await requestGoalPlanning(
    {
      boardStore: stores.boardStore,
      planningRequests: stores.planningRequests,
    },
    {
      goalKey,
      title: explicitPlanning?.title ?? `Plan follow-through for ${decision.decisionKey}`,
      description:
        explicitPlanning?.description ??
        `Update design.md and todo.yml to reflect the resolved decision "${decision.summary}" before engineering continues.`,
      acceptanceCriteria: explicitPlanning?.acceptanceCriteria ?? [
        `design.md captures the follow-through for ${decision.decisionKey}.`,
        `todo.yml reflects the follow-through for ${decision.decisionKey} before engineering resumes.`,
      ],
      decisionRefs: [decision.decisionKey],
      requestedUpdates: explicitPlanning?.requestedUpdates ?? ['design.md', 'todo.yml'],
      reuseTaskRef: explicitPlanning ? linkedPlanningTask?.ref : undefined,
      writer: writer ?? 'decision',
      reason: reason ?? `decision resolution follow-through ${decision.decisionKey}`,
    },
  )

  return {
    kind: 'planning' as const,
    requestKeys: [result.request.requestKey],
    taskRefs: [result.request.taskRef],
    blockerTaskRefs: [result.request.taskRef],
  }
}
