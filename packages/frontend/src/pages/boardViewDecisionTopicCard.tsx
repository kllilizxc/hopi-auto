import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import { cn } from '../lib/utils'
import { DecisionFollowThroughEditor } from './boardViewDecisionFollowThroughEditor'
import { isResolveDecisionSubmitDisabled } from './boardViewDecisionSubmitSupport'
import {
  buildDecisionResolutionAnswerSourceSuggestionPatch,
  type DecisionResolutionDraft,
} from './boardViewDraftSupport'
import {
  SourceResponseFormatCompatibilityNotice,
  SourceResponseFormatGuidance,
} from './boardViewInterpretationNoticeSupport'
import {
  listDirectAnswerSourceReferenceIssues,
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
import type { GoalDecisionResolveMutationResult } from './boardViewMutationResultSupport'
import {
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
  DecisionAuthorityDetails,
  DecisionFollowThroughResultCard,
  DecisionMutationAuthorityCard,
  MutationFeedback,
} from './boardViewPresentationSupport'
import {
  buildReusableAnswerSourceRoutingSuggestions,
  createDecisionAnswerSourceRoutingSuggestionFromResolutionDraft,
  mergeReusableAnswerSourceRoutingSuggestions,
} from './boardViewReusableSuggestions'
import {
  SOURCE_RESPONSE_FORMAT_OPTIONS,
  buildDecisionFollowThroughDraftAnswerSourceReferenceGroups,
  buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft,
  buildSourceResponseTemplateConsumersFromDecisionFollowThroughDraft,
  collectSourceResponseTemplateConsumers,
  createExplicitAnswerSourceReferenceGroup,
  createSourceResponseTemplateConsumer,
  formatSourceResponseFormatLabel,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import {
  buildAnswerSourceEditorValueWithRoutingSuggestions,
  buildAnswerSourceEditorValueWithSetupSuggestions,
  buildApplyCurrentAnswerSourceSetup,
  buildApplyCurrentConsumerRouting,
  buildApplyCurrentDecisionFollowThroughAnswerSetup,
  buildDecisionFollowThroughAnswerSetupPatch,
  buildValidTaskBlockerRefSetFromSuggestions,
  ReusableAnswerSourceFieldSuggestions,
  ReusableSingleValueSuggestions,
  StructuredAnswerSourcesEditor,
  StructuredStringListEditor,
} from './boardViewStructuredEditors'
import type {
  DecisionFollowThroughDraft,
  ReusableAnswerSourceRoutingSuggestion,
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusableDecisionWorkflowChildSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
  ReusableWorkflowContextSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'

type DecisionTopicCardProps = {
  decision: GoalDecision
  resolutionDraft: DecisionResolutionDraft
  followThroughDraft: DecisionFollowThroughDraft
  onDecisionResolutionDraftChange: (field: keyof DecisionResolutionDraft, value: string) => void
  onDecisionFollowThroughChange: (
    field: keyof DecisionFollowThroughDraft,
    value: string | boolean,
  ) => void
  onResolveDecision: () => void
  isResolvePending: boolean
  resolveError: Error | null
  resolutionResult?: GoalDecisionResolveMutationResult
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions: ReusablePlanningRequestSuggestion[]
  reusableTaskRefSuggestions: ReusableStringSuggestion[]
  reusableBlockerSuggestions: ReusableBlockerSuggestion[]
  reusablePlanningRequestKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupTaskKeySuggestions: ReusableStringSuggestion[]
  reusableBatchRequestSuggestions: ReusableBatchRequestSuggestion[]
  reusableBatchRequestGroupSuggestions: ReusableBatchRequestGroupSuggestion[]
  reusableWorkflowKeySuggestions: ReusableStringSuggestion[]
  reusableWorkflowContextSuggestions: ReusableWorkflowContextSuggestion[]
  reusableWorkflowGraphSuggestions: ReusableWorkflowGraphSuggestion[]
  reusableDecisionWorkflowChildSuggestions: ReusableDecisionWorkflowChildSuggestion[]
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[]
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[]
}

export function DecisionTopicCard({
  decision,
  resolutionDraft,
  followThroughDraft,
  onDecisionResolutionDraftChange,
  onDecisionFollowThroughChange,
  onResolveDecision,
  isResolvePending,
  resolveError,
  resolutionResult,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusablePlanningRequestSuggestions,
  reusableTaskRefSuggestions,
  reusableBlockerSuggestions,
  reusablePlanningRequestKeySuggestions,
  reusablePlanningGroupKeySuggestions,
  reusablePlanningGroupTaskKeySuggestions,
  reusableBatchRequestSuggestions,
  reusableBatchRequestGroupSuggestions,
  reusableWorkflowKeySuggestions,
  reusableWorkflowContextSuggestions,
  reusableWorkflowGraphSuggestions,
  reusableDecisionWorkflowChildSuggestions,
  reusableWorkflowTaskRefSuggestions,
  reusableWorkflowGroupKeySuggestions,
}: DecisionTopicCardProps) {
  const validTaskBlockerRefs = buildValidTaskBlockerRefSetFromSuggestions(
    reusableBlockerSuggestions,
  )
  const followThroughPlanningAnswerItems =
    buildPlanningAnswerEditorItemsFromDecisionFollowThroughDraft(followThroughDraft)
  const resolutionDecisionAnswer = {
    decisionKey: decision.decisionKey,
    summaryKey: resolutionDraft.summaryKey || decision.summaryKey,
    summary: decision.summary,
    prompt: resolutionDraft.prompt || decision.prompt || '',
    matchHints: resolutionDraft.matchHints || decision.matchHints,
  }
  const resolutionAnswerSourceRoutingSuggestions = mergeReusableAnswerSourceRoutingSuggestions(
    [
      createDecisionAnswerSourceRoutingSuggestionFromResolutionDraft(decision, resolutionDraft),
    ].filter(
      (suggestion): suggestion is ReusableAnswerSourceRoutingSuggestion => suggestion !== null,
    ),
    buildReusableAnswerSourceRoutingSuggestions({
      planningAnswerItems: followThroughPlanningAnswerItems,
    }),
  )
  const resolutionTemplateConsumers = collectSourceResponseTemplateConsumers([
    createSourceResponseTemplateConsumer(
      decision.summary,
      resolutionDraft.prompt || decision.prompt || '',
    ),
    ...buildSourceResponseTemplateConsumersFromDecisionFollowThroughDraft(followThroughDraft),
  ])
  const resolutionResponse = {
    format: resolutionDraft.sourceResponseFormat,
    sourceResponse: resolutionDraft.sourceResponse,
  }
  const resolutionOpenDecisionContext = {
    decisionAnswers: [resolutionDecisionAnswer],
    planningAnswers: followThroughPlanningAnswerItems,
  }
  const resolutionAnswerSourcesAreValid = hasValidAnswerSourcesJsonOrEmpty(
    resolutionDraft.answerSourcesJson,
    'Decision resolve answer sources',
  )
  const resolutionAnswerSources = resolutionAnswerSourcesAreValid
    ? parseAnswerSourcesJsonIfValid(
        resolutionDraft.answerSourcesJson,
        'Decision resolve answer sources',
      )
    : undefined
  const resolutionAnswerSourceReferenceGroups = [
    createExplicitAnswerSourceReferenceGroup('Decision resolve explicit answer', [
      {
        answer: resolutionDraft.answer,
        sourceExcerpt: resolutionDraft.sourceExcerpt,
        answerSourceKey: resolutionDraft.answerSourceKey,
        answerSourceGroupKey: resolutionDraft.answerSourceGroupKey,
      },
    ]),
    ...buildDecisionFollowThroughDraftAnswerSourceReferenceGroups(followThroughDraft),
  ].filter((group): group is ExplicitAnswerSourceReferenceGroup => group !== null)
  const resolutionAnswerSourceReferenceExistenceIssues =
    resolutionAnswerSourcesAreValid && resolutionAnswerSources
      ? listExplicitAnswerSourceReferenceExistenceIssues(
          resolutionAnswerSourceReferenceGroups,
          resolutionAnswerSources,
        )
      : []
  const resolutionCompatibilityIssues = [
    ...listSourceResponseFormatCompatibilityIssues({
      ...resolutionResponse,
      answerSourcesJson: resolutionDraft.answerSourcesJson,
      answerSourcesLabel: 'Decision resolve answer sources',
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
    }),
    ...listDirectAnswerSourceReferenceIssues(
      resolutionDraft.answerSourceKey,
      resolutionDraft.answerSourceGroupKey,
    ),
    ...resolutionAnswerSourceReferenceExistenceIssues,
    ...listLabeledSectionStructureIssues(resolutionResponse),
    ...listLabeledSectionExplicitConsumerMatchIssues({
      ...resolutionResponse,
      ...resolutionOpenDecisionContext,
    }),
    ...listLabeledSectionUnconsumedIssues({
      ...resolutionResponse,
      explicitConsumerCount: 1 + followThroughPlanningAnswerItems.length,
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
    }),
    ...listLabeledSectionStandaloneAuthorityIssues(resolutionResponse),
    ...listOrderedSourceResponseStructureIssues(resolutionResponse),
    ...listOrderedSourceResponseUnconsumedIssues({
      ...resolutionResponse,
      explicitDecisionAnswerCount: 1,
      explicitPlanningAnswerCount: followThroughPlanningAnswerItems.length,
      explicitDecisionKeys: [decision.decisionKey],
    }),
    ...listQuestionBlockStructureIssues(resolutionResponse),
    ...listQuestionBlockUnconsumedIssues({
      ...resolutionResponse,
      explicitDecisionAnswerCount: 1,
      explicitPlanningAnswerCount: followThroughPlanningAnswerItems.length,
      explicitDecisionKeys: [decision.decisionKey],
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
    }),
    ...listInlineTopicStructureIssues(resolutionResponse),
    ...listInlineTopicExplicitConsumerMatchIssues({
      ...resolutionResponse,
      ...resolutionOpenDecisionContext,
    }),
    ...listInlineTopicUnconsumedIssues({
      ...resolutionResponse,
      explicitConsumerCount: 1 + followThroughPlanningAnswerItems.length,
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
    }),
    ...listInlineTopicStandaloneAuthorityIssues({
      ...resolutionResponse,
      ...resolutionOpenDecisionContext,
      inferRemainingAnswers: followThroughDraft.inferRemainingAnswers,
    }),
  ]
  const canApplyCurrentResolutionRoutingSetup =
    resolutionAnswerSourceRoutingSuggestions.length > 0 && resolutionAnswerSourcesAreValid

  const applyFollowThroughPatch = (patch: Partial<DecisionFollowThroughDraft>) => {
    for (const [field, value] of Object.entries(patch)) {
      if (value !== undefined) {
        onDecisionFollowThroughChange(field as keyof DecisionFollowThroughDraft, value)
      }
    }
  }

  const applyCurrentResolutionFollowThroughAnswerSetup =
    buildApplyCurrentDecisionFollowThroughAnswerSetup(
      followThroughDraft,
      reusablePlanningAnswerSuggestions,
      reusableAnswerSourceSuggestions,
      applyFollowThroughPatch,
    )

  const applyResolutionAnswerContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithSetupSuggestions(
      resolutionDraft.answerSourcesJson,
      resolutionAnswerSourceRoutingSuggestions,
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

    if (nextFormat !== undefined) {
      onDecisionResolutionDraftChange('sourceResponseFormat', nextFormat)
    }
    onDecisionResolutionDraftChange('answerSourcesJson', nextAnswerSourcesJson)
    onDecisionResolutionDraftChange('sourceResponse', value)
    applyFollowThroughPatch(nextFollowThroughAnswerPatch)
  }

  const applyResolutionRoutingContextSetup = (
    value: string,
    nextFormat?: GoalSourceResponseFormat,
  ) => {
    const nextAnswerSourcesJson = buildAnswerSourceEditorValueWithRoutingSuggestions(
      resolutionDraft.answerSourcesJson,
      resolutionAnswerSourceRoutingSuggestions,
    )

    if (!nextAnswerSourcesJson) {
      return
    }

    if (nextFormat !== undefined) {
      onDecisionResolutionDraftChange('sourceResponseFormat', nextFormat)
    }
    onDecisionResolutionDraftChange('answerSourcesJson', nextAnswerSourcesJson)
    onDecisionResolutionDraftChange('sourceResponse', value)
  }

  return (
    <div className="rounded-xl border border-[#303030] bg-[#191919] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{decision.summary}</div>
          <div className="mt-1 text-xs text-gray-500 font-mono">{decision.decisionKey}</div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
            decision.status === 'resolved'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
          )}
        >
          {decision.status}
        </span>
      </div>
      <DecisionAuthorityDetails
        decision={decision}
        tone="gray"
        includeDecisionKeyInMeta={false}
      />
      {decision.status === 'open' && (
        <div className="mt-3 border-t border-[#2c2c2c] pt-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Answer</span>
              <textarea
                value={resolutionDraft.answer}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('answer', event.target.value)
                }
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Record the resolved answer."
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Excerpt
              </span>
              <textarea
                value={resolutionDraft.sourceExcerpt}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('sourceExcerpt', event.target.value)
                }
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Optional exact excerpt when the decision answer should be captured from quoted source text."
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Occurrence
              </span>
              <input
                value={resolutionDraft.sourceOccurrence}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('sourceOccurrence', event.target.value)
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional positive integer"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Response Format
              </span>
              <select
                value={resolutionDraft.sourceResponseFormat}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('sourceResponseFormat', event.target.value)
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                {SOURCE_RESPONSE_FORMAT_OPTIONS.map((format) => (
                  <option key={format} value={format}>
                    {formatSourceResponseFormatLabel(format)}
                  </option>
                ))}
              </select>
              <SourceResponseFormatGuidance
                format={resolutionDraft.sourceResponseFormat}
                sourceResponse={resolutionDraft.sourceResponse}
                onApplyTemplate={(value) => onDecisionResolutionDraftChange('sourceResponse', value)}
                onApplyFormatTemplate={(nextFormat, value) => {
                  onDecisionResolutionDraftChange('sourceResponseFormat', nextFormat)
                  onDecisionResolutionDraftChange('sourceResponse', value)
                }}
                onApplyFormatAnswerContextSetup={
                  resolutionAnswerSourcesAreValid
                    ? (nextFormat, value) =>
                        applyResolutionAnswerContextSetup(value, nextFormat)
                    : undefined
                }
                onApplyFormatContextSetup={
                  canApplyCurrentResolutionRoutingSetup
                    ? (nextFormat, value) =>
                        applyResolutionRoutingContextSetup(value, nextFormat)
                    : undefined
                }
                onApplyCurrentContextSetup={
                  canApplyCurrentResolutionRoutingSetup
                    ? (value) => applyResolutionRoutingContextSetup(value)
                    : undefined
                }
                onApplyCurrentAnswerContextSetup={
                  resolutionAnswerSourcesAreValid
                    ? (value) => applyResolutionAnswerContextSetup(value)
                    : undefined
                }
                onApplyCurrentAnswerSetup={applyCurrentResolutionFollowThroughAnswerSetup}
                onApplyCurrentAnswerSourceSetup={buildApplyCurrentAnswerSourceSetup(
                  resolutionDraft.answerSourcesJson,
                  resolutionAnswerSourceRoutingSuggestions,
                  reusableAnswerSourceSuggestions,
                  'Decision resolve answer sources',
                  (value) => onDecisionResolutionDraftChange('answerSourcesJson', value),
                )}
                onApplyCurrentConsumerRouting={buildApplyCurrentConsumerRouting(
                  resolutionDraft.answerSourcesJson,
                  resolutionAnswerSourceRoutingSuggestions,
                  'Decision resolve answer sources',
                  (value) => onDecisionResolutionDraftChange('answerSourcesJson', value),
                )}
                consumers={resolutionTemplateConsumers}
              />
              <SourceResponseFormatCompatibilityNotice issues={resolutionCompatibilityIssues} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Answer Source Key
              </span>
              <input
                value={resolutionDraft.answerSourceKey}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('answerSourceKey', event.target.value)
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Answer Source Group Key
              </span>
              <input
                value={resolutionDraft.answerSourceGroupKey}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('answerSourceGroupKey', event.target.value)
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
            </label>
            <div className="md:col-span-2">
              <ReusableAnswerSourceFieldSuggestions
                label="Reuse current answer sources"
                answerSourceKey={resolutionDraft.answerSourceKey}
                answerSourceGroupKey={resolutionDraft.answerSourceGroupKey}
                onSelect={(suggestion) => {
                  const patch = buildDecisionResolutionAnswerSourceSuggestionPatch(suggestion)

                  for (const [field, value] of Object.entries(patch)) {
                    onDecisionResolutionDraftChange(
                      field as keyof DecisionResolutionDraft,
                      value ?? '',
                    )
                  }
                }}
                suggestions={reusableAnswerSourceSuggestions}
              />
            </div>
            <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Durable matching authority
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Summary Key
                  </span>
                  <input
                    value={resolutionDraft.summaryKey}
                    onChange={(event) =>
                      onDecisionResolutionDraftChange('summaryKey', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Linked Task
                  </span>
                  <input
                    value={resolutionDraft.taskRef}
                    onChange={(event) =>
                      onDecisionResolutionDraftChange('taskRef', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <div className="md:col-span-2">
                  <ReusableSingleValueSuggestions
                    label="Reuse current visible task refs"
                    value={resolutionDraft.taskRef}
                    onSelect={(value) => onDecisionResolutionDraftChange('taskRef', value)}
                    suggestions={reusableTaskRefSuggestions}
                  />
                </div>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Prompt
                  </span>
                  <input
                    value={resolutionDraft.prompt}
                    onChange={(event) =>
                      onDecisionResolutionDraftChange('prompt', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Optional canonical question text"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Match Hints
                  </span>
                  <input
                    value={resolutionDraft.matchHints}
                    onChange={(event) =>
                      onDecisionResolutionDraftChange('matchHints', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="comma or newline separated"
                  />
                  <StructuredStringListEditor
                    label="Structured resolve match hints"
                    value={resolutionDraft.matchHints}
                    onChange={(value) => onDecisionResolutionDraftChange('matchHints', value)}
                    itemLabel="Match hint"
                    addLabel="Add hint"
                    placeholder="auth strategy"
                    emptyLabel="No structured resolve match hints yet."
                  />
                </label>
              </div>
            </details>
            <div className="space-y-1 md:col-span-2">
              <StructuredAnswerSourcesEditor
                label="Structured resolve answer sources"
                value={resolutionDraft.answerSourcesJson}
                onChange={(value) => onDecisionResolutionDraftChange('answerSourcesJson', value)}
                suggestions={reusableAnswerSourceSuggestions}
                routingSuggestions={resolutionAnswerSourceRoutingSuggestions}
              />
            </div>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Shared Source Response
              </span>
              <textarea
                value={resolutionDraft.sourceResponse}
                onChange={(event) =>
                  onDecisionResolutionDraftChange('sourceResponse', event.target.value)
                }
                rows={4}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Optional less-structured reply to interpret directly while resolving this decision."
              />
            </label>
          </div>

          <DecisionFollowThroughEditor
            draft={followThroughDraft}
            supportsInferRemainingAnswers
            reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
            reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
            reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
            reusableBlockerSuggestions={reusableBlockerSuggestions}
            reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
            reusablePlanningGroupKeySuggestions={reusablePlanningGroupKeySuggestions}
            reusablePlanningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
            reusableBatchRequestSuggestions={reusableBatchRequestSuggestions}
            reusableBatchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
            reusableWorkflowKeySuggestions={reusableWorkflowKeySuggestions}
            reusableWorkflowContextSuggestions={reusableWorkflowContextSuggestions}
            reusableWorkflowGraphSuggestions={reusableWorkflowGraphSuggestions}
            reusableDecisionWorkflowChildSuggestions={reusableDecisionWorkflowChildSuggestions}
            reusableWorkflowTaskRefSuggestions={reusableWorkflowTaskRefSuggestions}
            reusableWorkflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
            onChange={onDecisionFollowThroughChange}
          />

          {resolutionResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>
                {resolutionResult.decision.decisionKey} resolved
                {resolutionResult.followThrough ? ` with ${resolutionResult.followThrough.kind}` : ''}
                .
              </div>
              <DecisionMutationAuthorityCard
                decision={resolutionResult.decision}
                extra={
                  <div className="mt-1">
                    Blocker removed: {resolutionResult.blockerRemoved ? 'yes' : 'no'}
                  </div>
                }
              />
              {resolutionResult.resolvedSourceResponseFormat && (
                <div className="mt-1">
                  Resolved source-response format: {resolutionResult.resolvedSourceResponseFormat}
                </div>
              )}
              {resolutionResult.followThrough && (
                <DecisionFollowThroughResultCard followThrough={resolutionResult.followThrough} />
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            {resolveError ? (
              <MutationFeedback error={resolveError} />
            ) : (
              <div className="text-[11px] text-gray-500">
                Resolve directly, or attach planner follow-through on the same decision mutation.
              </div>
            )}
            <button
              onClick={onResolveDecision}
              disabled={
                isResolvePending ||
                isResolveDecisionSubmitDisabled(
                  decision,
                  resolutionDraft,
                  followThroughDraft,
                  reusableWorkflowGraphSuggestions,
                  reusableWorkflowTaskRefSuggestions,
                  reusableWorkflowGroupKeySuggestions,
                  validTaskBlockerRefs,
                )
              }
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolvePending ? 'Resolving...' : 'Resolve Decision'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
