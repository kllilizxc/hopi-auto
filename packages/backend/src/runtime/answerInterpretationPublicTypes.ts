import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { RemainingAnswerSourceRoute } from './answerInterpretationAnswerSourceSupport'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

type ConcreteInterpretableSourceResponseFormat = AnswerCaptureFormat

type InterpretableAnswerSourceMetadata = {
  answerSourceKey: string
  sourceGroupKey?: string
  route?: RemainingAnswerSourceRoute
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
}

export type InterpretableAnswerSource =
  | (InterpretableAnswerSourceMetadata & {
      answer: string
    })
  | (InterpretableAnswerSourceMetadata & {
      sourceExcerpt: string
      sourceOccurrence?: number
    })

export interface InterpretablePlanningAnswer {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface InterpretableDecisionAnswerEntryInput {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface InterpretableOpenDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  taskRef?: string
}

export interface InterpretableKnownDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  taskRef?: string
}

export interface MaterializedInterpretedDecisionAnswer {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: AnswerCaptureFormat
  decisionKey?: string
  taskRef?: string
  answer: string
}

export interface InterpretableDecisionPlanningFollowThroughInput {
  kind: 'planning'
  inferRemainingAnswers?: boolean
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  inferRemainingAnswers?: boolean
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
  reuseTaskRef?: string
  reuseGroupKey?: string
  inferRemainingAnswers?: boolean
  answers?: InterpretablePlanningAnswer[]
  workflows: InterpretableDecisionWorkflowLeafFollowThroughInput[]
}

export type InterpretableDecisionLeafFollowThroughInput =
  | InterpretableDecisionPlanningFollowThroughInput
  | InterpretableDecisionPlanningBatchFollowThroughInput

export type InterpretableDecisionFollowThroughInput =
  | InterpretableDecisionLeafFollowThroughInput
  | InterpretableDecisionWorkflowBatchFollowThroughInput

export type InterpretablePlanningAnswerCarrier = {
  answers?: InterpretablePlanningAnswer[]
}

export type MaterializedPlanningAnswerCarrier<T extends InterpretablePlanningAnswerCarrier> = Omit<
  T,
  'answers'
> & {
  answers: GoalPlanningRequestAnswer[] | undefined
  resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
}

export type InterpretablePlanningWorkflowLeafCarrier = {
  kind: 'planning' | 'planning_batch'
  answers?: InterpretablePlanningAnswer[]
}

export type MaterializedPlanningWorkflowLeafCarrier<
  T extends InterpretablePlanningWorkflowLeafCarrier,
> = Omit<T, 'answers'> & {
  answers: GoalPlanningRequestAnswer[] | undefined
}

export type MaterializedPlanningWorkflowBatchCarrier<
  T extends {
    answers?: InterpretablePlanningAnswer[]
    workflows: readonly InterpretablePlanningWorkflowLeafCarrier[]
  },
> = Omit<T, 'answers' | 'workflows'> & {
  answers: GoalPlanningRequestAnswer[] | undefined
  resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
  workflows: {
    [K in keyof T['workflows']]: T['workflows'][K] extends InterpretablePlanningWorkflowLeafCarrier
      ? MaterializedPlanningWorkflowLeafCarrier<T['workflows'][K]>
      : never
  }
}
