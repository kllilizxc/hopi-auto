import type { GoalSourceResponseFormat, TaskKind, TaskStatus } from '../lib/api'
import type {
  DecisionFollowThroughDraft,
  ReusableAnswerSourceSuggestion,
  ReusableDecisionAnswerSuggestion,
} from './boardViewStructuredEditorTypes'

export type AnswerBundleDraft = {
  mode: 'single' | 'batch'
  summary: string
  summaryKey: string
  decisionKey: string
  prompt: string
  matchHints: string
  taskRef: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  answerSourceKey: string
  answerSourceGroupKey: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
  inferOpenDecisions: boolean
  inferDecisionTopics: boolean
  answersJson: string
}

export type DecisionResolutionDraft = {
  summaryKey: string
  prompt: string
  matchHints: string
  taskRef: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  answerSourceKey: string
  answerSourceGroupKey: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
}

export type TaskCreateDraft = {
  ref: string
  kind: TaskKind
  title: string
  description: string
  acceptanceCriteria: string
  blockedByJson: string
}

export type TaskMoveDraft = {
  taskRef: string
  status: TaskStatus
  reason: string
}

export const DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT: DecisionFollowThroughDraft = {
  kind: 'none',
  inferRemainingAnswers: false,
  workflowChildKind: 'planning',
  workflowTaskKey: '',
  blockedByWorkflowKeys: '',
  title: '',
  description: '',
  acceptanceCriteria: '',
  answersJson: '',
  requestedUpdates: '',
  groupKey: '',
  batchRequestsJson: '',
  workflowKey: '',
  reuseTaskRef: '',
  reuseGroupKey: '',
  workflowAnswersJson: '',
  workflowChildrenJson: '',
}

export const DEFAULT_DECISION_RESOLUTION_DRAFT: DecisionResolutionDraft = {
  summaryKey: '',
  prompt: '',
  matchHints: '',
  taskRef: '',
  answer: '',
  sourceExcerpt: '',
  sourceOccurrence: '',
  answerSourceKey: '',
  answerSourceGroupKey: '',
  answerSourcesJson: '',
  sourceResponse: '',
  sourceResponseFormat: 'auto',
}

export const DEFAULT_TASK_CREATE_DRAFT: TaskCreateDraft = {
  ref: '',
  kind: 'planning',
  title: '',
  description: '',
  acceptanceCriteria: '',
  blockedByJson: '',
}

export const DEFAULT_TASK_MOVE_DRAFT: TaskMoveDraft = {
  taskRef: '',
  status: 'planned',
  reason: 'manual transition',
}

export const DEFAULT_ANSWER_BUNDLE_DRAFT: AnswerBundleDraft = {
  mode: 'single',
  summary: '',
  summaryKey: '',
  decisionKey: '',
  prompt: '',
  matchHints: '',
  taskRef: '',
  answer: '',
  sourceExcerpt: '',
  sourceOccurrence: '',
  answerSourceKey: '',
  answerSourceGroupKey: '',
  answerSourcesJson: '',
  sourceResponse: '',
  sourceResponseFormat: 'auto',
  inferOpenDecisions: false,
  inferDecisionTopics: false,
  answersJson: '',
}

export function buildAnswerBundleSingleSuggestionPatch(
  suggestion: ReusableDecisionAnswerSuggestion,
): Partial<AnswerBundleDraft> {
  return {
    summary: suggestion.item.summary,
    decisionKey: suggestion.item.decisionKey,
    summaryKey: suggestion.item.summaryKey,
    prompt: suggestion.item.prompt,
    matchHints: suggestion.item.matchHints,
    taskRef: suggestion.item.taskRef,
    answerSourceKey: suggestion.item.answerSourceKey,
    answerSourceGroupKey: suggestion.item.answerSourceGroupKey,
  }
}

export function buildAnswerBundleSingleAnswerSourceSuggestionPatch(
  suggestion: ReusableAnswerSourceSuggestion,
): Partial<AnswerBundleDraft> {
  return {
    summary: suggestion.item.summary,
    summaryKey: suggestion.item.summaryKey,
    prompt: suggestion.item.prompt,
    matchHints: suggestion.item.matchHints,
    answer: suggestion.item.answer,
    sourceExcerpt: suggestion.item.sourceExcerpt,
    sourceOccurrence: suggestion.item.sourceOccurrence,
    answerSourceKey: suggestion.item.answerSourceKey,
    answerSourceGroupKey: suggestion.item.sourceGroupKey,
  }
}

export function buildDecisionResolutionAnswerSourceSuggestionPatch(
  suggestion: ReusableAnswerSourceSuggestion,
): Partial<DecisionResolutionDraft> {
  return {
    summaryKey: suggestion.item.summaryKey,
    prompt: suggestion.item.prompt,
    matchHints: suggestion.item.matchHints,
    answer: suggestion.item.answer,
    sourceExcerpt: suggestion.item.sourceExcerpt,
    sourceOccurrence: suggestion.item.sourceOccurrence,
    answerSourceKey: suggestion.item.answerSourceKey,
    answerSourceGroupKey: suggestion.item.sourceGroupKey,
  }
}
