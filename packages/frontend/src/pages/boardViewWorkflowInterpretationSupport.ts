import type { GoalSourceResponseFormat } from '../lib/api'
import {
  listExplicitAnswerSourceReferenceExistenceIssues,
  listLabeledSectionStandaloneAuthorityIssues,
  listSourceResponseFormatCompatibilityIssues,
  parseAnswerSourcesJsonIfValid,
} from './boardViewInterpretationSupport'
import { hasValidAnswerSourcesJsonOrEmpty } from './boardViewJsonInputSupport'
import {
  listLabeledSectionExplicitConsumerMatchIssues,
  listLabeledSectionStructureIssues,
  listLabeledSectionUnconsumedIssues,
} from './boardViewLabeledSectionSupport'
import {
  listAutoInlineTopicMixedAuthorityIssues,
  listInlineTopicExplicitConsumerMatchIssues,
  listInlineTopicStandaloneAuthorityIssues,
  listInlineTopicStructureIssues,
  listInlineTopicUnconsumedIssues,
} from './boardViewInlineTopicSupport'
import {
  listOrderedSourceResponseStructureIssues,
  listOrderedSourceResponseUnconsumedIssues,
  listQuestionBlockStructureIssues,
  listQuestionBlockUnconsumedIssues,
} from './boardViewOrderedQuestionBlockSupport'
import {
  listPlanningRemainingAnswerSourceAuthorityIssues,
  listPlanningRemainingAnswerSourceContiguityIssues,
  listPlanningRemainingAnswerSourceMergeConflictIssues,
} from './boardViewRemainingAnswerSourceSupport'
import { buildReusableAnswerSourceRoutingSuggestions } from './boardViewReusableSuggestions'
import {
  buildPlanningAnswerEditorItemsFromWorkflowDraft,
  buildSourceResponseTemplateConsumersFromWorkflowDraft,
  buildWorkflowDraftAnswerSourceReferenceGroups,
} from './boardViewSourceResponseSupport'
import {
  buildAnswerSourceEditorValueWithRoutingSuggestions,
  buildAnswerSourceEditorValueWithSetupSuggestions,
  buildApplyCurrentAnswerSourceSetup,
  buildApplyCurrentConsumerRouting,
  buildApplyCurrentWorkflowDraftAnswerSetup,
  buildWorkflowDraftVisibleAnswerSetupPatch,
} from './boardViewStructuredEditors'
import type {
  ReusableAnswerSourceSuggestion,
  ReusablePlanningAnswerSuggestion,
} from './boardViewStructuredEditorTypes'

type WorkflowDraftLike = {
  workflowKey: string
  reuseTaskRef: string
  reuseGroupKey: string
  sharedDecisionRefs: string
  sharedAnswersJson: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
  inferRemainingAnswers: boolean
  childKind: 'planning' | 'planning_batch'
  requestKey: string
  workflowTaskKey: string
  groupKey: string
  blockedByWorkflowKeys: string
  childBlockedByJson: string
  title: string
  description: string
  acceptanceCriteria: string
  requestedUpdates: string
  childDecisionRefs: string
  childAnswersJson: string
  batchRequestsJson: string
  childrenJson: string
}

type BuildWorkflowInterpretationModelArgs = {
  workflowDraft: WorkflowDraftLike
  onWorkflowDraftChange: (field: keyof WorkflowDraftLike, value: string | boolean) => void
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
}

export function buildWorkflowInterpretationModel({
  workflowDraft,
  onWorkflowDraftChange,
  reusablePlanningAnswerSuggestions,
  reusableAnswerSourceSuggestions,
}: BuildWorkflowInterpretationModelArgs) {
  const planningAnswerItems = buildPlanningAnswerEditorItemsFromWorkflowDraft(workflowDraft)
  const templateConsumers = buildSourceResponseTemplateConsumersFromWorkflowDraft(workflowDraft)
  const answerSourceRoutingSuggestions = buildReusableAnswerSourceRoutingSuggestions({
    planningAnswerItems,
  })
  const answerSourcesAreValid = hasValidAnswerSourcesJsonOrEmpty(
    workflowDraft.answerSourcesJson,
    'Workflow answer sources',
  )
  const answerSources = answerSourcesAreValid
    ? parseAnswerSourcesJsonIfValid(workflowDraft.answerSourcesJson, 'Workflow answer sources')
    : undefined
  const answerSourceReferenceIssues =
    answerSourcesAreValid && answerSources
      ? listExplicitAnswerSourceReferenceExistenceIssues(
          buildWorkflowDraftAnswerSourceReferenceGroups(workflowDraft),
          answerSources,
        )
      : []
  const remainingAnswerSourceAuthorityIssues = listPlanningRemainingAnswerSourceAuthorityIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    answerSources,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
    explicitPlanningAnswerCount: planningAnswerItems.length,
  })
  const remainingAnswerSourceContiguityIssues = listPlanningRemainingAnswerSourceContiguityIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    answerSources,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
    explicitPlanningAnswerCount: planningAnswerItems.length,
  })
  const remainingAnswerSourceMergeConflictIssues =
    listPlanningRemainingAnswerSourceMergeConflictIssues({
      format: workflowDraft.sourceResponseFormat,
      sourceResponse: workflowDraft.sourceResponse,
      answerSources,
      inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
      explicitPlanningAnswerCount: planningAnswerItems.length,
    })
  const labeledSectionStructureIssues = listLabeledSectionStructureIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const labeledSectionExplicitMatchIssues = listLabeledSectionExplicitConsumerMatchIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
  })
  const labeledSectionUnconsumedIssues = listLabeledSectionUnconsumedIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    explicitConsumerCount: planningAnswerItems.length,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
  })
  const labeledSectionStandaloneAuthorityIssues = listLabeledSectionStandaloneAuthorityIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const orderedStructureIssues = listOrderedSourceResponseStructureIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const orderedUnconsumedIssues = listOrderedSourceResponseUnconsumedIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    explicitPlanningAnswerCount: planningAnswerItems.length,
  })
  const questionBlockStructureIssues = listQuestionBlockStructureIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const questionBlockUnconsumedIssues = listQuestionBlockUnconsumedIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    explicitPlanningAnswerCount: planningAnswerItems.length,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
  })
  const inlineTopicStructureIssues = listInlineTopicStructureIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const inlineTopicExplicitMatchIssues = listInlineTopicExplicitConsumerMatchIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
  })
  const inlineTopicUnconsumedIssues = listInlineTopicUnconsumedIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    explicitConsumerCount: planningAnswerItems.length,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
  })
  const inlineTopicStandaloneAuthorityIssues = listInlineTopicStandaloneAuthorityIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
    inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
  })
  const autoInlineTopicMixedAuthorityIssues = listAutoInlineTopicMixedAuthorityIssues({
    format: workflowDraft.sourceResponseFormat,
    sourceResponse: workflowDraft.sourceResponse,
  })
  const compatibilityIssues = [
    ...listSourceResponseFormatCompatibilityIssues({
      format: workflowDraft.sourceResponseFormat,
      sourceResponse: workflowDraft.sourceResponse,
      answerSourcesJson: workflowDraft.answerSourcesJson,
      answerSourcesLabel: 'Workflow answer sources',
      inferRemainingAnswers: workflowDraft.inferRemainingAnswers,
    }),
    ...answerSourceReferenceIssues,
    ...labeledSectionStructureIssues,
    ...labeledSectionExplicitMatchIssues,
    ...labeledSectionUnconsumedIssues,
    ...labeledSectionStandaloneAuthorityIssues,
    ...orderedStructureIssues,
    ...orderedUnconsumedIssues,
    ...questionBlockStructureIssues,
    ...questionBlockUnconsumedIssues,
    ...inlineTopicStructureIssues,
    ...inlineTopicExplicitMatchIssues,
    ...inlineTopicUnconsumedIssues,
    ...inlineTopicStandaloneAuthorityIssues,
    ...autoInlineTopicMixedAuthorityIssues,
    ...remainingAnswerSourceAuthorityIssues,
    ...remainingAnswerSourceContiguityIssues,
    ...remainingAnswerSourceMergeConflictIssues,
  ]
  const applyCurrentWorkflowAnswerSetup = buildApplyCurrentWorkflowDraftAnswerSetup(
    workflowDraft,
    reusablePlanningAnswerSuggestions,
    reusableAnswerSourceSuggestions,
    (patch) => {
      if (patch.sharedAnswersJson !== undefined) {
        onWorkflowDraftChange('sharedAnswersJson', patch.sharedAnswersJson)
      }
      if (patch.childAnswersJson !== undefined) {
        onWorkflowDraftChange('childAnswersJson', patch.childAnswersJson)
      }
      if (patch.childrenJson !== undefined) {
        onWorkflowDraftChange('childrenJson', patch.childrenJson)
      }
    },
  )
  const canApplyRoutingContextSetup =
    answerSourceRoutingSuggestions.length > 0 && answerSourcesAreValid

  const applyAnswerContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithSetupSuggestions(
      workflowDraft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      reusableAnswerSourceSuggestions,
    )
    const nextAnswerSetupPatch = buildWorkflowDraftVisibleAnswerSetupPatch(
      workflowDraft,
      reusablePlanningAnswerSuggestions,
      reusableAnswerSourceSuggestions,
    )
    if (!nextAnswerSourcesJson || !nextAnswerSetupPatch) {
      return
    }

    if (nextFormat !== undefined) {
      onWorkflowDraftChange('sourceResponseFormat', nextFormat)
    }
    onWorkflowDraftChange('answerSourcesJson', nextAnswerSourcesJson)
    if (nextAnswerSetupPatch.sharedAnswersJson !== undefined) {
      onWorkflowDraftChange('sharedAnswersJson', nextAnswerSetupPatch.sharedAnswersJson)
    }
    if (nextAnswerSetupPatch.childAnswersJson !== undefined) {
      onWorkflowDraftChange('childAnswersJson', nextAnswerSetupPatch.childAnswersJson)
    }
    if (nextAnswerSetupPatch.childrenJson !== undefined) {
      onWorkflowDraftChange('childrenJson', nextAnswerSetupPatch.childrenJson)
    }
    onWorkflowDraftChange('sourceResponse', value)
  }

  const applyRoutingContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithRoutingSuggestions(
      workflowDraft.answerSourcesJson,
      answerSourceRoutingSuggestions,
    )
    if (!nextAnswerSourcesJson) {
      return
    }

    if (nextFormat !== undefined) {
      onWorkflowDraftChange('sourceResponseFormat', nextFormat)
    }
    onWorkflowDraftChange('answerSourcesJson', nextAnswerSourcesJson)
    onWorkflowDraftChange('sourceResponse', value)
  }

  return {
    answerSourceRoutingSuggestions,
    compatibilityIssues,
    templateConsumers,
    isInterpretationInvalid: !answerSourcesAreValid || compatibilityIssues.length > 0,
    onApplyFormatAnswerContextSetup:
      applyCurrentWorkflowAnswerSetup && answerSourcesAreValid
        ? (nextFormat: GoalSourceResponseFormat, value: string) =>
            applyAnswerContextSetup(value, nextFormat)
        : undefined,
    onApplyFormatContextSetup: canApplyRoutingContextSetup
      ? (nextFormat: GoalSourceResponseFormat, value: string) =>
          applyRoutingContextSetup(value, nextFormat)
      : undefined,
    onApplyCurrentContextSetup: canApplyRoutingContextSetup
      ? (value: string) => applyRoutingContextSetup(value)
      : undefined,
    onApplyCurrentAnswerContextSetup:
      applyCurrentWorkflowAnswerSetup && answerSourcesAreValid
        ? (value: string) => applyAnswerContextSetup(value)
        : undefined,
    onApplyCurrentAnswerSetup: applyCurrentWorkflowAnswerSetup,
    onApplyCurrentAnswerSourceSetup: buildApplyCurrentAnswerSourceSetup(
      workflowDraft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      reusableAnswerSourceSuggestions,
      'Workflow answer sources',
      (value) => onWorkflowDraftChange('answerSourcesJson', value),
    ),
    onApplyCurrentConsumerRouting: buildApplyCurrentConsumerRouting(
      workflowDraft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      'Workflow answer sources',
      (value) => onWorkflowDraftChange('answerSourcesJson', value),
    ),
  }
}
