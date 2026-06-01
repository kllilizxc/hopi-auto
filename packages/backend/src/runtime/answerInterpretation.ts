import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}

export interface InterpretablePlanningAnswer {
  summary: string
  answer?: string
}

export interface InterpretableDecisionAnswerEntryInput {
  summary: string
  decisionKey?: string
  taskRef?: string
  answer?: string
}

export interface InterpretableDecisionPlanningFollowThroughInput {
  kind: 'planning'
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  answers?: InterpretablePlanningAnswer[]
  requests: GoalPlanningBatchEntryInput[]
}

export interface InterpretableDecisionWorkflowPlanningFollowThroughInput {
  kind: 'planning'
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionWorkflowPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  answers?: InterpretablePlanningAnswer[]
  requests?: GoalPlanningBatchEntryInput[]
}

export type InterpretableDecisionWorkflowLeafFollowThroughInput =
  | InterpretableDecisionWorkflowPlanningFollowThroughInput
  | InterpretableDecisionWorkflowPlanningBatchFollowThroughInput

export interface InterpretableDecisionWorkflowBatchFollowThroughInput {
  kind: 'workflow_batch'
  workflowKey?: string
  answers?: InterpretablePlanningAnswer[]
  workflows: InterpretableDecisionWorkflowLeafFollowThroughInput[]
}

export type InterpretableDecisionLeafFollowThroughInput =
  | InterpretableDecisionPlanningFollowThroughInput
  | InterpretableDecisionPlanningBatchFollowThroughInput

export type InterpretableDecisionFollowThroughInput =
  | InterpretableDecisionLeafFollowThroughInput
  | InterpretableDecisionWorkflowBatchFollowThroughInput

export function materializeInterpretedDecisionAnswers(
  answers: InterpretableDecisionAnswerEntryInput[],
  sourceResponse?: string,
) {
  return answers.map((answer) => ({
    summary: answer.summary,
    decisionKey: answer.decisionKey,
    taskRef: answer.taskRef,
    answer: resolveAnswerText(
      answer.answer,
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
    ),
  }))
}

export function materializeInterpretedDecisionFollowThrough(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
  sourceResponse?: string,
) {
  if (!followThrough) {
    return undefined
  }

  if (followThrough.kind === 'planning') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(followThrough.answers, sourceResponse),
    }
  }

  if (followThrough.kind === 'planning_batch') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(followThrough.answers, sourceResponse),
    }
  }

  return {
    kind: 'workflow_batch' as const,
    workflowKey: followThrough.workflowKey,
    answers: materializeInterpretedPlanningAnswers(followThrough.answers, sourceResponse),
    workflows: followThrough.workflows.map((workflow) => {
      if (workflow.kind === 'planning') {
        return {
          ...workflow,
          answers: materializeInterpretedPlanningAnswers(workflow.answers, sourceResponse),
        }
      }

      return {
        ...workflow,
        answers: materializeInterpretedPlanningAnswers(workflow.answers, sourceResponse),
      }
    }),
  }
}

function materializeInterpretedPlanningAnswers(
  answers: InterpretablePlanningAnswer[] | undefined,
  sourceResponse?: string,
): GoalPlanningRequestAnswer[] | undefined {
  if (!answers || answers.length === 0) {
    return answers ? [] : undefined
  }

  return answers.map((answer) => ({
    summary: answer.summary,
    answer: resolveAnswerText(answer.answer, sourceResponse, `planner answer ${answer.summary}`),
  }))
}

function resolveAnswerText(
  answer: string | undefined,
  sourceResponse: string | undefined,
  label: string,
) {
  const explicit = answer?.trim()
  if (explicit) {
    return explicit
  }

  const shared = sourceResponse?.trim()
  if (shared) {
    return shared
  }

  throw new AnswerInterpretationError(
    `Missing answer text for ${label}. Provide item.answer or sourceResponse.`,
  )
}
