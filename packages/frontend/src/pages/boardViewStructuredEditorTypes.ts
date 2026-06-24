import type { BlockerKind } from '../lib/api'

export type DecisionFollowThroughDraft = {
  kind: 'none' | 'planning' | 'planning_batch' | 'workflow_batch'
  inferRemainingAnswers: boolean
  workflowChildKind: 'planning' | 'planning_batch'
  workflowTaskKey: string
  blockedByWorkflowKeys: string
  title: string
  description: string
  acceptanceCriteria: string
  answersJson: string
  requestedUpdates: string
  groupKey: string
  batchRequestsJson: string
  workflowKey: string
  reuseTaskRef: string
  reuseGroupKey: string
  workflowAnswersJson: string
  workflowChildrenJson: string
}

export type PlanningAnswerEditorItem = {
  summary: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  prompt: string
  summaryKey: string
  answerKey: string
  matchHints: string
  answerSourceKey: string
  answerSourceGroupKey: string
}

export type DecisionAnswerEntryEditorItem = {
  decisionKey: string
  summary: string
  summaryKey: string
  prompt: string
  matchHints: string
  taskRef: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  answerSourceKey: string
  answerSourceGroupKey: string
}

export type AnswerSourceEditorItem = {
  answerSourceKey: string
  route: '' | 'decision' | 'planning'
  summary: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  sourceGroupKey: string
  decisionKey: string
  prompt: string
  summaryKey: string
  answerKey: string
  matchHints: string
}

export type ReusableAnswerSourceSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: AnswerSourceEditorItem
}

export type ReusableAnswerSourceRoutingSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: AnswerSourceEditorItem
}

export type ReusablePlanningAnswerSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: PlanningAnswerEditorItem
}

export type ReusableDecisionAnswerSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: DecisionAnswerEntryEditorItem
}

export type ReusablePlanningRequestSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: {
    requestKey: string
    groupKey: string
    groupTaskKey: string
    workflowTaskKey: string
    title: string
    description: string
    acceptanceCriteria: string
    decisionRefs: string
    answersJson: string
    requestedUpdates: string
    blockedByJson: string
    blockedByWorkflowKeys: string
  }
}

export type ReusableStringSuggestion = {
  suggestionKey: string
  value: string
  title: string
  subtitle: string
  preview: string
}

export type ReusableBlockerSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: BlockerEditorItem
}

export type ReusableBatchRequestSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: BatchRequestEditorItem
}

export type ReusableBatchRequestGroupSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: {
    groupKey: string
    blockedByWorkflowKeys: string
    decisionRefs: string
    answersJson: string
    batchRequestsJson: string
  }
}

export type ReusableWorkflowContextSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: {
    workflowKey: string
    sharedDecisionRefs: string
    sharedAnswersJson: string
    reuseTaskRef: string
    reuseGroupKey: string
  }
}

export type ReusableWorkflowGraphSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: {
    workflowKey: string
    sharedDecisionRefs: string
    sharedAnswersJson: string
    reuseTaskRef: string
    reuseGroupKey: string
    childrenJson: string
    workflowChildrenJson: string
  }
}

export type ReusableWorkflowChildSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: WorkflowChildEditorItem
}

export type ReusableDecisionWorkflowChildSuggestion = {
  suggestionKey: string
  title: string
  subtitle: string
  preview: string
  item: DecisionWorkflowChildEditorItem
}

export type BlockerEditorItem = {
  kind: '' | BlockerKind
  ref: string
}

export type BatchRequestEditorItem = {
  taskKey: string
  requestKey: string
  title: string
  description: string
  acceptanceCriteria: string
  requestedUpdates: string
  blockedByJson: string
  blockedByTaskKeys: string
}

export type WorkflowChildEditorItem = {
  kind: 'planning' | 'planning_batch'
  requestKey: string
  workflowTaskKey: string
  groupKey: string
  blockedByWorkflowKeys: string
  blockedByJson: string
  title: string
  description: string
  acceptanceCriteria: string
  decisionRefs: string
  answersJson: string
  requestedUpdates: string
  batchRequestsJson: string
}

export type DecisionWorkflowChildEditorItem = {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey: string
  groupKey: string
  blockedByWorkflowKeys: string
  title: string
  description: string
  acceptanceCriteria: string
  answersJson: string
  requestedUpdates: string
  batchRequestsJson: string
}
