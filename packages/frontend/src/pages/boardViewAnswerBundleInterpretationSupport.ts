import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import type { AnswerBundleDraft } from './boardViewDraftSupport'
import {
  listDirectAnswerSourceReferenceIssues,
  listExplicitAnswerSourceReferenceExistenceIssues,
  listInferOpenDecisionExplicitAnswerIssues,
  listLabeledSectionStandaloneAuthorityIssues,
  listSourceResponseFormatCompatibilityIssues,
  parseAnswerSourcesJsonIfValid,
} from './boardViewInterpretationSupport'
import { hasValidAnswerSourcesJsonOrEmpty } from './boardViewJsonInputSupport'
import {
  listLabeledSectionDecisionTopicIssues,
  listLabeledSectionExplicitConsumerMatchIssues,
  listLabeledSectionOpenDecisionIssues,
  listLabeledSectionStructureIssues,
  listLabeledSectionUnconsumedIssues,
} from './boardViewLabeledSectionSupport'
import {
  listInlineTopicDecisionTopicIssues,
  listInlineTopicExplicitConsumerMatchIssues,
  listInlineTopicOpenDecisionIssues,
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
  listDecisionTopicRemainingKnownDecisionAmbiguityIssues,
  listDecisionTopicRemainingAnswerSourceAuthorityIssues,
  listDecisionTopicRemainingAnswerSourceContiguityIssues,
  listDecisionTopicRemainingAnswerSourceMergeConflictIssues,
} from './boardViewRemainingAnswerSourceSupport'
import {
  buildReusableAnswerSourceRoutingSuggestions,
  createDecisionAnswerSourceRoutingSuggestionFromSingleAnswerBundleDraft,
  mergeReusableAnswerSourceRoutingSuggestions,
} from './boardViewReusableSuggestions'
import {
  buildDecisionFollowThroughDraftAnswerSourceReferenceGroups,
  buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft,
  buildSourceResponseTemplateConsumersFromDecisionAnswerItems,
  buildSourceResponseTemplateConsumersFromPlanningAnswerItems,
  collectSourceResponseTemplateConsumers,
  createExplicitAnswerSourceReferenceGroup,
  createSourceResponseTemplateConsumer,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import {
  buildAnswerSourceEditorValueWithRoutingSuggestions,
  buildAnswerSourceEditorValueWithSetupSuggestions,
  buildApplyCurrentAnswerSourceSetup,
  buildApplyCurrentConsumerRouting,
  buildApplyCurrentDecisionAnswerSetup,
  buildApplyCurrentDecisionFollowThroughAnswerSetup,
  buildDecisionAnswerEntryEditorValueWithSetupSuggestions,
  buildDecisionFollowThroughAnswerSetupPatch,
  parseDecisionAnswerEntryEditorItems,
} from './boardViewStructuredEditors'
import type {
  DecisionFollowThroughDraft,
  ReusableAnswerSourceRoutingSuggestion,
  ReusableAnswerSourceSuggestion,
  ReusableDecisionAnswerSuggestion,
  ReusablePlanningAnswerSuggestion,
} from './boardViewStructuredEditorTypes'

type BuildAnswerBundleInterpretationModelArgs = {
  draft: AnswerBundleDraft
  decisions: GoalDecision[]
  followThroughDraft: DecisionFollowThroughDraft
  onDraftChange: (patch: Partial<AnswerBundleDraft>) => void
  onFollowThroughChange: (field: keyof DecisionFollowThroughDraft, value: string | boolean) => void
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusableDecisionAnswerSuggestions: ReusableDecisionAnswerSuggestion[]
}

export function buildAnswerBundleInterpretationModel({
  draft,
  decisions,
  followThroughDraft,
  onDraftChange,
  onFollowThroughChange,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusableDecisionAnswerSuggestions,
}: BuildAnswerBundleInterpretationModelArgs) {
  const batchDecisionAnswerItems = parseDecisionAnswerEntryEditorItems(draft.answersJson).items
  const openDecisionKeys = decisions
    .filter((decision) => decision.status === 'open')
    .map((decision) => decision.decisionKey)
  const answerSourcesAreValid = hasValidAnswerSourcesJsonOrEmpty(
    draft.answerSourcesJson,
    'Decision answer sources',
  )
  const answerSources = answerSourcesAreValid
    ? parseAnswerSourcesJsonIfValid(draft.answerSourcesJson, 'Decision answer sources')
    : undefined
  const followThroughPlanningAnswerItems =
    buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft(followThroughDraft)
  const explicitPlanningAnswerCount = followThroughPlanningAnswerItems.length
  const explicitDecisionKeys = batchDecisionAnswerItems
    .map((item) => item.decisionKey?.trim())
    .filter((value): value is string => Boolean(value))
  const singleDecisionAnswer = {
    decisionKey: draft.decisionKey,
    summaryKey: draft.summaryKey,
    summary: draft.summary,
    prompt: draft.prompt,
    matchHints: draft.matchHints,
  }
  const answerSourceReferenceGroups = [
    draft.mode === 'single'
      ? createExplicitAnswerSourceReferenceGroup('Single decision answer', [
          {
            answer: draft.answer,
            sourceExcerpt: draft.sourceExcerpt,
            answerSourceKey: draft.answerSourceKey,
            answerSourceGroupKey: draft.answerSourceGroupKey,
          },
        ])
      : createExplicitAnswerSourceReferenceGroup('Decision answer batch', batchDecisionAnswerItems),
    ...buildDecisionFollowThroughDraftAnswerSourceReferenceGroups(followThroughDraft),
  ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  const answerSourceReferenceExistenceIssues =
    answerSourcesAreValid && answerSources
      ? listExplicitAnswerSourceReferenceExistenceIssues(
          answerSourceReferenceGroups,
          answerSources,
        )
      : []
  const batchInferOpenDecisionIssues =
    draft.mode === 'batch'
      ? listInferOpenDecisionExplicitAnswerIssues(
          batchDecisionAnswerItems,
          draft.inferOpenDecisions,
        )
      : []
  const singleAnswerSourceReferenceIssues =
    draft.mode === 'single'
      ? listDirectAnswerSourceReferenceIssues(draft.answerSourceKey, draft.answerSourceGroupKey)
      : []
  const batchRemainingAnswerSourceAuthorityIssues =
    draft.mode === 'batch'
      ? listDecisionTopicRemainingAnswerSourceAuthorityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          answerSources,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchRemainingAnswerSourceContiguityIssues =
    draft.mode === 'batch'
      ? listDecisionTopicRemainingAnswerSourceContiguityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          answerSources,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchRemainingAnswerSourceMergeConflictIssues =
    draft.mode === 'batch'
      ? listDecisionTopicRemainingAnswerSourceMergeConflictIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          answerSources,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchRemainingKnownDecisionAmbiguityIssues =
    draft.mode === 'batch'
      ? listDecisionTopicRemainingKnownDecisionAmbiguityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          answerSources,
          decisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchLabeledSectionDecisionTopicIssues =
    draft.mode === 'batch'
      ? listLabeledSectionDecisionTopicIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchLabeledSectionOpenDecisionIssues =
    draft.mode === 'batch'
      ? listLabeledSectionOpenDecisionIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisions,
          inferOpenDecisions: draft.inferOpenDecisions,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
        })
      : []
  const batchLabeledSectionStructureIssues =
    draft.mode === 'batch'
      ? listLabeledSectionStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const batchLabeledSectionExplicitMatchIssues =
    draft.mode === 'batch'
      ? listLabeledSectionExplicitConsumerMatchIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics ? batchDecisionAnswerItems : [],
          planningAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics
              ? followThroughPlanningAnswerItems
              : [],
        })
      : []
  const batchLabeledSectionUnconsumedIssues =
    draft.mode === 'batch'
      ? listLabeledSectionUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitConsumerCount: batchDecisionAnswerItems.length + explicitPlanningAnswerCount,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const batchLabeledSectionStandaloneAuthorityIssues =
    draft.mode === 'batch'
      ? listLabeledSectionStandaloneAuthorityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const batchOrderedStructureIssues =
    draft.mode === 'batch'
      ? listOrderedSourceResponseStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const batchOrderedUnconsumedIssues =
    draft.mode === 'batch'
      ? listOrderedSourceResponseUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
          explicitDecisionKeys,
          inferOpenDecisions: draft.inferOpenDecisions,
          openDecisionKeys,
        })
      : []
  const batchQuestionBlockStructureIssues =
    draft.mode === 'batch'
      ? listQuestionBlockStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const batchQuestionBlockUnconsumedIssues =
    draft.mode === 'batch'
      ? listQuestionBlockUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
          explicitDecisionKeys,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          openDecisionKeys,
        })
      : []
  const batchInlineTopicStructureIssues =
    draft.mode === 'batch'
      ? listInlineTopicStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const batchInlineTopicExplicitMatchIssues =
    draft.mode === 'batch'
      ? listInlineTopicExplicitConsumerMatchIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics ? batchDecisionAnswerItems : [],
          planningAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics
              ? followThroughPlanningAnswerItems
              : [],
        })
      : []
  const batchInlineTopicUnconsumedIssues =
    draft.mode === 'batch'
      ? listInlineTopicUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitConsumerCount: batchDecisionAnswerItems.length + explicitPlanningAnswerCount,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const batchInlineTopicStandaloneAuthorityIssues =
    draft.mode === 'batch'
      ? listInlineTopicStandaloneAuthorityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics ? batchDecisionAnswerItems : [],
          planningAnswers:
            !draft.inferOpenDecisions && !draft.inferDecisionTopics
              ? followThroughPlanningAnswerItems
              : [],
          decisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const batchInlineTopicDecisionTopicIssues =
    draft.mode === 'batch'
      ? listInlineTopicDecisionTopicIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisions,
          inferDecisionTopics: draft.inferDecisionTopics,
          inferOpenDecisions: draft.inferOpenDecisions,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
          explicitPlanningAnswerCount,
        })
      : []
  const batchInlineTopicOpenDecisionIssues =
    draft.mode === 'batch'
      ? listInlineTopicOpenDecisionIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisions,
          inferOpenDecisions: draft.inferOpenDecisions,
          explicitDecisionAnswerCount: batchDecisionAnswerItems.length,
        })
      : []
  const singleLabeledSectionStructureIssues =
    draft.mode === 'single'
      ? listLabeledSectionStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const singleLabeledSectionExplicitMatchIssues =
    draft.mode === 'single'
      ? listLabeledSectionExplicitConsumerMatchIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers: [singleDecisionAnswer],
          planningAnswers: followThroughPlanningAnswerItems,
        })
      : []
  const singleLabeledSectionUnconsumedIssues =
    draft.mode === 'single'
      ? listLabeledSectionUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitConsumerCount: 1 + explicitPlanningAnswerCount,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const singleLabeledSectionStandaloneAuthorityIssues =
    draft.mode === 'single'
      ? listLabeledSectionStandaloneAuthorityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const singleOrderedStructureIssues =
    draft.mode === 'single'
      ? listOrderedSourceResponseStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const singleOrderedUnconsumedIssues =
    draft.mode === 'single'
      ? listOrderedSourceResponseUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitDecisionAnswerCount: 1,
          explicitPlanningAnswerCount,
          explicitDecisionKeys: [draft.decisionKey].filter(Boolean),
        })
      : []
  const singleQuestionBlockStructureIssues =
    draft.mode === 'single'
      ? listQuestionBlockStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const singleQuestionBlockUnconsumedIssues =
    draft.mode === 'single'
      ? listQuestionBlockUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitDecisionAnswerCount: 1,
          explicitPlanningAnswerCount,
          explicitDecisionKeys: [draft.decisionKey].filter(Boolean),
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const singleInlineTopicStructureIssues =
    draft.mode === 'single'
      ? listInlineTopicStructureIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
        })
      : []
  const singleInlineTopicExplicitMatchIssues =
    draft.mode === 'single'
      ? listInlineTopicExplicitConsumerMatchIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers: [singleDecisionAnswer],
          planningAnswers: followThroughPlanningAnswerItems,
        })
      : []
  const singleInlineTopicUnconsumedIssues =
    draft.mode === 'single'
      ? listInlineTopicUnconsumedIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          explicitConsumerCount: 1 + explicitPlanningAnswerCount,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const singleInlineTopicStandaloneAuthorityIssues =
    draft.mode === 'single'
      ? listInlineTopicStandaloneAuthorityIssues({
          format: draft.sourceResponseFormat,
          sourceResponse: draft.sourceResponse,
          decisionAnswers: [singleDecisionAnswer],
          planningAnswers: followThroughPlanningAnswerItems,
          inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
        })
      : []
  const batchAnswerTemplateConsumers =
    buildSourceResponseTemplateConsumersFromDecisionAnswerItems(batchDecisionAnswerItems)
  const answerSourceRoutingSuggestions =
    draft.mode === 'single'
      ? mergeReusableAnswerSourceRoutingSuggestions(
          [createDecisionAnswerSourceRoutingSuggestionFromSingleAnswerBundleDraft(draft)].filter(
            (suggestion): suggestion is ReusableAnswerSourceRoutingSuggestion =>
              suggestion !== null,
          ),
          buildReusableAnswerSourceRoutingSuggestions({
            planningAnswerItems: followThroughPlanningAnswerItems,
          }),
        )
      : buildReusableAnswerSourceRoutingSuggestions({
          decisionAnswerItems: [
            ...reusableDecisionAnswerSuggestions.map((suggestion) => suggestion.item),
            ...batchDecisionAnswerItems,
          ],
          planningAnswerItems: followThroughPlanningAnswerItems,
        })
  const followThroughTemplateConsumers = buildSourceResponseTemplateConsumersFromPlanningAnswerItems(
    followThroughPlanningAnswerItems,
  )
  const inferredOpenDecisionTemplateConsumers =
    draft.inferOpenDecisions && batchAnswerTemplateConsumers.length === 0
      ? buildSourceResponseTemplateConsumersFromDecisionAnswerItems(
          reusableDecisionAnswerSuggestions.map((suggestion) => suggestion.item),
        )
      : []
  const templateConsumers = collectSourceResponseTemplateConsumers([
    ...(draft.mode === 'single'
      ? [
          createSourceResponseTemplateConsumer(draft.summary, draft.prompt),
          ...followThroughTemplateConsumers,
        ]
      : batchAnswerTemplateConsumers.length > 0
        ? [...batchAnswerTemplateConsumers, ...followThroughTemplateConsumers]
        : [...inferredOpenDecisionTemplateConsumers, ...followThroughTemplateConsumers]),
  ])
  const compatibilityIssues = [
    ...listSourceResponseFormatCompatibilityIssues({
      format: draft.sourceResponseFormat,
      sourceResponse: draft.sourceResponse,
      answerSourcesJson: draft.answerSourcesJson,
      answerSourcesLabel: 'Decision answer sources',
      inferOpenDecisions: draft.inferOpenDecisions,
      inferDecisionTopics: draft.inferDecisionTopics,
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
      mixedRemainingAnswerInference: followThroughDraft.inferRemainingAnswers,
    }),
    ...batchInferOpenDecisionIssues,
    ...singleAnswerSourceReferenceIssues,
    ...answerSourceReferenceExistenceIssues,
    ...singleLabeledSectionStructureIssues,
    ...singleLabeledSectionExplicitMatchIssues,
    ...singleLabeledSectionUnconsumedIssues,
    ...singleLabeledSectionStandaloneAuthorityIssues,
    ...singleOrderedStructureIssues,
    ...singleOrderedUnconsumedIssues,
    ...singleQuestionBlockStructureIssues,
    ...singleQuestionBlockUnconsumedIssues,
    ...singleInlineTopicStructureIssues,
    ...singleInlineTopicExplicitMatchIssues,
    ...singleInlineTopicUnconsumedIssues,
    ...singleInlineTopicStandaloneAuthorityIssues,
    ...batchRemainingAnswerSourceAuthorityIssues,
    ...batchRemainingAnswerSourceContiguityIssues,
    ...batchRemainingAnswerSourceMergeConflictIssues,
    ...batchRemainingKnownDecisionAmbiguityIssues,
    ...batchLabeledSectionDecisionTopicIssues,
    ...batchLabeledSectionOpenDecisionIssues,
    ...batchLabeledSectionStructureIssues,
    ...batchLabeledSectionExplicitMatchIssues,
    ...batchLabeledSectionUnconsumedIssues,
    ...batchLabeledSectionStandaloneAuthorityIssues,
    ...batchOrderedStructureIssues,
    ...batchOrderedUnconsumedIssues,
    ...batchQuestionBlockStructureIssues,
    ...batchQuestionBlockUnconsumedIssues,
    ...batchInlineTopicStructureIssues,
    ...batchInlineTopicExplicitMatchIssues,
    ...batchInlineTopicUnconsumedIssues,
    ...batchInlineTopicStandaloneAuthorityIssues,
    ...batchInlineTopicDecisionTopicIssues,
    ...batchInlineTopicOpenDecisionIssues,
  ]

  const applyFollowThroughPatch = (patch: Partial<DecisionFollowThroughDraft>) => {
    for (const [field, value] of Object.entries(patch)) {
      if (value !== undefined) {
        onFollowThroughChange(field as keyof DecisionFollowThroughDraft, value)
      }
    }
  }

  const applyCurrentFollowThroughAnswerSetup =
    buildApplyCurrentDecisionFollowThroughAnswerSetup(
      followThroughDraft,
      reusablePlanningAnswerSuggestions,
      reusableAnswerSourceSuggestions,
      applyFollowThroughPatch,
    )
  const applyCurrentBatchDecisionAnswerSetup =
    draft.mode === 'batch'
      ? buildApplyCurrentDecisionAnswerSetup(
          draft.answersJson,
          reusableDecisionAnswerSuggestions,
          reusableAnswerSourceSuggestions,
          (value) => onDraftChange({ answersJson: value }),
        )
      : undefined
  const canApplyRoutingContextSetup =
    answerSourceRoutingSuggestions.length > 0 && answerSourcesAreValid

  const applySingleAnswerContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithSetupSuggestions(
      draft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      reusableAnswerSourceSuggestions,
    )
    const nextFollowThroughAnswerPatch = buildDecisionFollowThroughAnswerSetupPatch(
      followThroughDraft,
      reusablePlanningAnswerSuggestions,
      reusableAnswerSourceSuggestions,
    )
    if (!nextAnswerSourcesJson || !nextFollowThroughAnswerPatch) {
      return
    }

    onDraftChange({
      ...(nextFormat !== undefined ? { sourceResponseFormat: nextFormat } : {}),
      answerSourcesJson: nextAnswerSourcesJson,
      sourceResponse: value,
    })
    applyFollowThroughPatch(nextFollowThroughAnswerPatch)
  }

  const applyBatchAnswerContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithSetupSuggestions(
      draft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      reusableAnswerSourceSuggestions,
    )
    const nextAnswersJson = buildDecisionAnswerEntryEditorValueWithSetupSuggestions(
      draft.answersJson,
      reusableDecisionAnswerSuggestions,
      reusableAnswerSourceSuggestions,
    )
    const nextFollowThroughAnswerPatch = buildDecisionFollowThroughAnswerSetupPatch(
      followThroughDraft,
      reusablePlanningAnswerSuggestions,
      reusableAnswerSourceSuggestions,
    )
    if (!nextAnswerSourcesJson || !nextAnswersJson || !nextFollowThroughAnswerPatch) {
      return
    }

    onDraftChange({
      ...(nextFormat !== undefined ? { sourceResponseFormat: nextFormat } : {}),
      answerSourcesJson: nextAnswerSourcesJson,
      answersJson: nextAnswersJson,
      sourceResponse: value,
    })
    applyFollowThroughPatch(nextFollowThroughAnswerPatch)
  }

  const applyRoutingContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithRoutingSuggestions(
      draft.answerSourcesJson,
      answerSourceRoutingSuggestions,
    )
    if (!nextAnswerSourcesJson) {
      return
    }

    onDraftChange({
      ...(nextFormat !== undefined ? { sourceResponseFormat: nextFormat } : {}),
      answerSourcesJson: nextAnswerSourcesJson,
      sourceResponse: value,
    })
  }

  return {
    answerSourceRoutingSuggestions,
    compatibilityIssues,
    templateConsumers,
    onApplyFormatAnswerContextSetup:
      draft.mode === 'batch'
        ? applyCurrentBatchDecisionAnswerSetup && answerSourcesAreValid
          ? (nextFormat: GoalSourceResponseFormat, value: string) =>
              applyBatchAnswerContextSetup(value, nextFormat)
          : undefined
        : answerSourcesAreValid
          ? (nextFormat: GoalSourceResponseFormat, value: string) =>
              applySingleAnswerContextSetup(value, nextFormat)
          : undefined,
    onApplyFormatContextSetup: canApplyRoutingContextSetup
      ? (nextFormat: GoalSourceResponseFormat, value: string) =>
          applyRoutingContextSetup(value, nextFormat)
      : undefined,
    onApplyCurrentContextSetup: canApplyRoutingContextSetup
      ? (value: string) => applyRoutingContextSetup(value)
      : undefined,
    onApplyCurrentAnswerContextSetup:
      draft.mode === 'batch'
        ? applyCurrentBatchDecisionAnswerSetup && answerSourcesAreValid
          ? (value: string) => applyBatchAnswerContextSetup(value)
          : undefined
        : answerSourcesAreValid
          ? (value: string) => applySingleAnswerContextSetup(value)
          : undefined,
    onApplyCurrentAnswerSetup:
      draft.mode === 'batch'
        ? applyCurrentBatchDecisionAnswerSetup && applyCurrentFollowThroughAnswerSetup
          ? () => {
              applyCurrentBatchDecisionAnswerSetup()
              applyCurrentFollowThroughAnswerSetup()
            }
          : (applyCurrentBatchDecisionAnswerSetup ?? applyCurrentFollowThroughAnswerSetup)
        : applyCurrentFollowThroughAnswerSetup,
    onApplyCurrentAnswerSourceSetup: buildApplyCurrentAnswerSourceSetup(
      draft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      reusableAnswerSourceSuggestions,
      'Decision answer sources',
      (value) => onDraftChange({ answerSourcesJson: value }),
    ),
    onApplyCurrentConsumerRouting: buildApplyCurrentConsumerRouting(
      draft.answerSourcesJson,
      answerSourceRoutingSuggestions,
      'Decision answer sources',
      (value) => onDraftChange({ answerSourcesJson: value }),
    ),
  }
}
