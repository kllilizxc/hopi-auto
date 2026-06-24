import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import {
  materializeDecisionAnswerBatchInput,
  materializeDecisionFollowThroughInput,
  materializeDecisionResolutionInput,
  materializeSingleDecisionAnswerInput,
} from './boardViewDecisionMutationSupport'
import {
  isDecisionFollowThroughDraftIncomplete,
} from './boardViewWorkflowDependencySupport'
import type {
  DecisionFollowThroughDraft,
  ReusableStringSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'

type AnswerBundleDraftLike = {
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

type DecisionResolutionDraftLike = {
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

export function isAnswerBundleSubmitDisabled(
  draft: AnswerBundleDraftLike,
  followThroughDraft: DecisionFollowThroughDraft,
  workflowGraphs: ReusableWorkflowGraphSuggestion[] = [],
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[] = [],
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[] = [],
  validTaskBlockerRefs?: Set<string>,
  decisions: GoalDecision[] = [],
) {
  if (
    isDecisionFollowThroughDraftIncomplete(
      followThroughDraft,
      workflowGraphs,
      reusableWorkflowTaskRefSuggestions,
      reusableWorkflowGroupKeySuggestions,
      validTaskBlockerRefs,
    )
  ) {
    return true
  }

  try {
    const followThrough = materializeDecisionFollowThroughInput(followThroughDraft)

    if (draft.mode === 'single') {
      materializeSingleDecisionAnswerInput(draft, followThrough)
      return false
    }

    materializeDecisionAnswerBatchInput(draft, followThrough, decisions)
    return false
  } catch {
    return true
  }
}

export function isResolveDecisionSubmitDisabled(
  decision: GoalDecision,
  draft: DecisionResolutionDraftLike,
  followThroughDraft: DecisionFollowThroughDraft,
  workflowGraphs: ReusableWorkflowGraphSuggestion[] = [],
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[] = [],
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[] = [],
  validTaskBlockerRefs?: Set<string>,
) {
  if (
    isDecisionFollowThroughDraftIncomplete(
      followThroughDraft,
      workflowGraphs,
      reusableWorkflowTaskRefSuggestions,
      reusableWorkflowGroupKeySuggestions,
      validTaskBlockerRefs,
    )
  ) {
    return true
  }

  try {
    const followThrough = materializeDecisionFollowThroughInput(followThroughDraft)
    materializeDecisionResolutionInput(decision, draft, followThrough)
    return false
  } catch {
    return true
  }
}
