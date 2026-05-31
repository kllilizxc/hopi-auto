import type { BoardStore } from '../storage/boardStore'
import type { DecisionStore, GoalDecision } from '../storage/decisionStore'

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
}

export async function requestGoalDecision(
  stores: {
    boardStore: BoardStore
    decisions: DecisionStore
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
  },
  input: {
    goalKey: string
    decisionKey: string
    answer: string
    writer?: string
    reason?: string
  },
): Promise<GoalDecisionResolveResult> {
  const decision = await stores.decisions.resolveDecision(input.goalKey, input.decisionKey, {
    answer: input.answer,
  })
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
          task.blockedBy = nextBlockedBy
          blockerRemoved = true
        }
      }
    },
  )

  return {
    decision,
    blockerRemoved,
  }
}
