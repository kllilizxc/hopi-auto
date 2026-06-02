import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}

export type InterpretableAnswerSource =
  | {
      answerSourceKey: string
      answer: string
    }
  | {
      answerSourceKey: string
      sourceExcerpt: string
    }

export interface InterpretablePlanningAnswer {
  summary: string
  answer?: string
  sourceExcerpt?: string
  answerSourceKey?: string
}

export interface InterpretableDecisionAnswerEntryInput {
  summary: string
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  answerSourceKey?: string
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
  reuseTaskRef?: string
  reuseGroupKey?: string
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
  answerSources?: InterpretableAnswerSource[],
) {
  const answerSourcesByKey = createAnswerSourceLookup(answerSources, sourceResponse)
  return answers.map((answer) => ({
    summary: answer.summary,
    decisionKey: answer.decisionKey,
    taskRef: answer.taskRef,
    answer: resolveAnswerText(
      answer.answer,
      answer.sourceExcerpt,
      answer.answerSourceKey,
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
      answerSourcesByKey,
    ),
  }))
}

export function materializeInterpretedDecisionFollowThrough(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
) {
  if (!followThrough) {
    return undefined
  }
  const answerSourcesByKey = createAnswerSourceLookup(answerSources, sourceResponse)

  if (followThrough.kind === 'planning') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
      ),
    }
  }

  if (followThrough.kind === 'planning_batch') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
      ),
    }
  }

  return {
    kind: 'workflow_batch' as const,
    workflowKey: followThrough.workflowKey,
    reuseTaskRef: followThrough.reuseTaskRef,
    reuseGroupKey: followThrough.reuseGroupKey,
    answers: materializeInterpretedPlanningAnswers(
      followThrough.answers,
      sourceResponse,
      answerSourcesByKey,
    ),
    workflows: followThrough.workflows.map((workflow) => {
      if (workflow.kind === 'planning') {
        return {
          ...workflow,
          answers: materializeInterpretedPlanningAnswers(
            workflow.answers,
            sourceResponse,
            answerSourcesByKey,
          ),
        }
      }

      return {
        ...workflow,
        answers: materializeInterpretedPlanningAnswers(
          workflow.answers,
          sourceResponse,
          answerSourcesByKey,
        ),
      }
    }),
  }
}

function materializeInterpretedPlanningAnswers(
  answers: InterpretablePlanningAnswer[] | undefined,
  sourceResponse?: string,
  answerSourcesByKey?: Map<string, string>,
): GoalPlanningRequestAnswer[] | undefined {
  if (!answers || answers.length === 0) {
    return answers ? [] : undefined
  }

  return answers.map((answer) => ({
    summary: answer.summary,
    answer: resolveAnswerText(
      answer.answer,
      answer.sourceExcerpt,
      answer.answerSourceKey,
      sourceResponse,
      `planner answer ${answer.summary}`,
      answerSourcesByKey,
    ),
  }))
}

function resolveAnswerText(
  answer: string | undefined,
  sourceExcerpt: string | undefined,
  answerSourceKey: string | undefined,
  sourceResponse: string | undefined,
  label: string,
  answerSourcesByKey?: Map<string, string>,
) {
  const explicit = answer?.trim()
  if (explicit) {
    return explicit
  }

  const directExcerpt = resolveSourceExcerpt(sourceExcerpt, sourceResponse, label)
  if (directExcerpt) {
    return directExcerpt
  }

  const referencedSourceKey = answerSourceKey?.trim()
  if (referencedSourceKey) {
    const sourced = answerSourcesByKey?.get(referencedSourceKey)
    if (!sourced) {
      throw new AnswerInterpretationError(
        `Unknown answerSourceKey "${referencedSourceKey}" for ${label}.`,
      )
    }
    return sourced
  }

  const shared = sourceResponse?.trim()
  if (shared) {
    return shared
  }

  throw new AnswerInterpretationError(
    `Missing answer text for ${label}. Provide item.answer, answerSourceKey, or sourceResponse.`,
  )
}

function resolveSourceExcerpt(
  sourceExcerpt: string | undefined,
  sourceResponse: string | undefined,
  label: string,
) {
  const excerpt = sourceExcerpt?.trim()
  if (!excerpt) {
    return undefined
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(`sourceExcerpt for ${label} requires sourceResponse.`)
  }
  if (!shared.includes(excerpt)) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} was not found in sourceResponse.`,
    )
  }
  return excerpt
}

function createAnswerSourceLookup(
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponse: string | undefined,
) {
  if (!answerSources || answerSources.length === 0) {
    return undefined
  }

  const answerSourcesByKey = new Map<string, string>()
  for (const source of answerSources) {
    const key = source.answerSourceKey.trim()
    if (answerSourcesByKey.has(key)) {
      throw new AnswerInterpretationError(`Duplicate answerSourceKey: ${key}`)
    }
    if ('answer' in source) {
      answerSourcesByKey.set(key, source.answer.trim())
      continue
    }

    const sourceExcerpt = source.sourceExcerpt.trim()
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for answerSourceKey "${key}" requires sourceResponse.`,
      )
    }
    if (!shared.includes(sourceExcerpt)) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for answerSourceKey "${key}" was not found in sourceResponse.`,
      )
    }
    answerSourcesByKey.set(key, sourceExcerpt)
  }
  return answerSourcesByKey
}
