import type {
  DecisionAnswerEntryEditorItem,
  DecisionFollowThroughDraft,
  DecisionWorkflowChildEditorItem,
  PlanningAnswerEditorItem,
  ReusableAnswerSourceSuggestion,
  ReusableDecisionWorkflowChildSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableWorkflowChildSuggestion,
  ReusableWorkflowContextSuggestion,
  ReusableWorkflowGraphSuggestion,
  WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'

export function buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion(
  suggestion: ReusableAnswerSourceSuggestion,
): Partial<PlanningAnswerEditorItem> {
  return {
    summary: suggestion.item.summary,
    answer: suggestion.item.answer,
    sourceExcerpt: suggestion.item.sourceExcerpt,
    sourceOccurrence: suggestion.item.sourceOccurrence,
    prompt: suggestion.item.prompt,
    summaryKey: suggestion.item.summaryKey,
    answerKey: suggestion.item.answerKey,
    matchHints: suggestion.item.matchHints,
    answerSourceKey: suggestion.item.answerSourceKey,
    answerSourceGroupKey: suggestion.item.sourceGroupKey,
  }
}

export function buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion(
  suggestion: ReusableAnswerSourceSuggestion,
): Partial<DecisionAnswerEntryEditorItem> {
  return {
    summary: suggestion.item.summary,
    answer: suggestion.item.answer,
    sourceExcerpt: suggestion.item.sourceExcerpt,
    sourceOccurrence: suggestion.item.sourceOccurrence,
    prompt: suggestion.item.prompt,
    summaryKey: suggestion.item.summaryKey,
    matchHints: suggestion.item.matchHints,
    answerSourceKey: suggestion.item.answerSourceKey,
    answerSourceGroupKey: suggestion.item.sourceGroupKey,
  }
}

export function buildPlanningDraftPatchFromPlanningRequestSuggestion(
  suggestion: ReusablePlanningRequestSuggestion,
): Partial<{
  requestKey: string
  groupKey: string
  groupTaskKey: string
  title: string
  description: string
  acceptanceCriteria: string
  decisionRefs: string
  answersJson: string
  requestedUpdates: string
  blockedByJson: string
}> {
  return {
    requestKey: suggestion.item.requestKey,
    groupKey: suggestion.item.groupKey,
    groupTaskKey: suggestion.item.groupTaskKey,
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    decisionRefs: suggestion.item.decisionRefs,
    answersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
    blockedByJson: suggestion.item.blockedByJson,
  }
}

export function buildWorkflowChildPatchFromPlanningRequestSuggestion(
  suggestion: ReusablePlanningRequestSuggestion,
): Partial<WorkflowChildEditorItem> {
  return {
    requestKey: suggestion.item.requestKey,
    workflowTaskKey: suggestion.item.workflowTaskKey,
    groupKey: suggestion.item.groupKey,
    blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
    blockedByJson: suggestion.item.blockedByJson,
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    decisionRefs: suggestion.item.decisionRefs,
    answersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
  }
}

export function buildDecisionWorkflowChildPatchFromPlanningRequestSuggestion(
  suggestion: ReusablePlanningRequestSuggestion,
): Partial<DecisionWorkflowChildEditorItem> {
  return {
    workflowTaskKey: suggestion.item.workflowTaskKey,
    groupKey: suggestion.item.groupKey,
    blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    answersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
  }
}

export function buildDecisionPlanningFollowThroughPatchFromPlanningRequestSuggestion(
  suggestion: ReusablePlanningRequestSuggestion,
): Partial<DecisionFollowThroughDraft> {
  return {
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    answersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
  }
}

export function buildWorkflowDraftPatchFromWorkflowContextSuggestion(
  suggestion: ReusableWorkflowContextSuggestion,
): Partial<{
  workflowKey: string
  sharedDecisionRefs: string
  sharedAnswersJson: string
  reuseTaskRef: string
  reuseGroupKey: string
}> {
  return {
    workflowKey: suggestion.item.workflowKey,
    sharedDecisionRefs: suggestion.item.sharedDecisionRefs,
    sharedAnswersJson: suggestion.item.sharedAnswersJson,
    reuseTaskRef: suggestion.item.reuseTaskRef,
    reuseGroupKey: suggestion.item.reuseGroupKey,
  }
}

export function buildDecisionWorkflowFollowThroughPatchFromWorkflowContextSuggestion(
  suggestion: ReusableWorkflowContextSuggestion,
): Partial<DecisionFollowThroughDraft> {
  return {
    workflowKey: suggestion.item.workflowKey,
    workflowAnswersJson: suggestion.item.sharedAnswersJson,
    reuseTaskRef: suggestion.item.reuseTaskRef,
    reuseGroupKey: suggestion.item.reuseGroupKey,
  }
}

export function buildWorkflowDraftPatchFromWorkflowGraphSuggestion(
  suggestion: ReusableWorkflowGraphSuggestion,
): Partial<{
  workflowKey: string
  sharedDecisionRefs: string
  sharedAnswersJson: string
  reuseTaskRef: string
  reuseGroupKey: string
  childrenJson: string
}> {
  return {
    workflowKey: suggestion.item.workflowKey,
    sharedDecisionRefs: suggestion.item.sharedDecisionRefs,
    sharedAnswersJson: suggestion.item.sharedAnswersJson,
    reuseTaskRef: suggestion.item.reuseTaskRef,
    reuseGroupKey: suggestion.item.reuseGroupKey,
    childrenJson: suggestion.item.childrenJson,
  }
}

export function buildWorkflowDraftPatchFromWorkflowChildSuggestion(
  suggestion: ReusableWorkflowChildSuggestion,
): Partial<{
  childKind: 'planning' | 'planning_batch'
  requestKey: string
  workflowTaskKey: string
  groupKey: string
  blockedByWorkflowKeys: string
  childBlockedByJson: string
  title: string
  description: string
  acceptanceCriteria: string
  childDecisionRefs: string
  childAnswersJson: string
  requestedUpdates: string
  batchRequestsJson: string
}> {
  return {
    childKind: suggestion.item.kind,
    requestKey: suggestion.item.requestKey,
    workflowTaskKey: suggestion.item.workflowTaskKey,
    groupKey: suggestion.item.groupKey,
    blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
    childBlockedByJson: suggestion.item.blockedByJson,
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    childDecisionRefs: suggestion.item.decisionRefs,
    childAnswersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
    batchRequestsJson: suggestion.item.batchRequestsJson,
  }
}

export function buildDecisionWorkflowFollowThroughPatchFromWorkflowChildSuggestion(
  suggestion: ReusableDecisionWorkflowChildSuggestion,
): Partial<DecisionFollowThroughDraft> {
  return {
    workflowChildKind: suggestion.item.kind,
    workflowTaskKey: suggestion.item.workflowTaskKey,
    groupKey: suggestion.item.groupKey,
    blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
    title: suggestion.item.title,
    description: suggestion.item.description,
    acceptanceCriteria: suggestion.item.acceptanceCriteria,
    answersJson: suggestion.item.answersJson,
    requestedUpdates: suggestion.item.requestedUpdates,
    batchRequestsJson: suggestion.item.batchRequestsJson,
  }
}

export function buildDecisionWorkflowFollowThroughPatchFromWorkflowGraphSuggestion(
  suggestion: ReusableWorkflowGraphSuggestion,
): Partial<DecisionFollowThroughDraft> {
  return {
    workflowKey: suggestion.item.workflowKey,
    workflowAnswersJson: suggestion.item.sharedAnswersJson,
    reuseTaskRef: suggestion.item.reuseTaskRef,
    reuseGroupKey: suggestion.item.reuseGroupKey,
    workflowChildrenJson: suggestion.item.workflowChildrenJson,
  }
}
