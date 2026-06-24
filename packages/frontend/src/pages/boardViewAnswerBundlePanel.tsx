import { MessageSquare } from 'lucide-react'
import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import {
  ReusableAnswerSourceFieldSuggestions,
  ReusableDecisionAnswerSuggestionList,
  ReusableSingleValueSuggestions,
  StructuredAnswerSourcesEditor,
  StructuredDecisionAnswerEntriesEditor,
  StructuredStringListEditor,
  buildValidTaskBlockerRefSetFromSuggestions,
} from './boardViewStructuredEditors'
import type {
  DecisionFollowThroughDraft,
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusableDecisionAnswerSuggestion,
  ReusableDecisionWorkflowChildSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
  ReusableWorkflowContextSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'
import type {
  GoalDecisionAnswerBatchResultWithReuse,
  GoalDecisionAnswerResultWithReuse,
} from './boardViewMutationResultSupport'
import {
  SOURCE_RESPONSE_FORMAT_OPTIONS,
  formatSourceResponseFormatLabel,
} from './boardViewSourceResponseSupport'
import {
  DecisionFollowThroughResultCard,
  DecisionMutationAuthorityCard,
  MutationFeedback,
  SurfaceCard,
} from './boardViewPresentationSupport'
import { isAnswerBundleSubmitDisabled } from './boardViewDecisionSubmitSupport'
import { DecisionFollowThroughEditor } from './boardViewDecisionFollowThroughEditor'
import { buildAnswerBundleInterpretationModel } from './boardViewAnswerBundleInterpretationSupport'
import {
  type AnswerBundleDraft,
  buildAnswerBundleSingleAnswerSourceSuggestionPatch,
  buildAnswerBundleSingleSuggestionPatch,
} from './boardViewDraftSupport'
import {
  SourceResponseFormatCompatibilityNotice,
  SourceResponseFormatGuidance,
} from './boardViewInterpretationNoticeSupport'

export function AnswerBundlePanel({
  draft,
  decisions,
  onDraftChange,
  followThroughDraft,
  onFollowThroughChange,
  onSubmit,
  submitPending,
  submitError,
  submitResult,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusablePlanningRequestSuggestions,
  reusableDecisionAnswerSuggestions,
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
}: {
  draft: AnswerBundleDraft
  decisions: GoalDecision[]
  onDraftChange: (patch: Partial<AnswerBundleDraft>) => void
  followThroughDraft: DecisionFollowThroughDraft
  onFollowThroughChange: (field: keyof DecisionFollowThroughDraft, value: string | boolean) => void
  onSubmit: () => void
  submitPending: boolean
  submitError: Error | null
  submitResult?: GoalDecisionAnswerResultWithReuse | GoalDecisionAnswerBatchResultWithReuse
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions: ReusablePlanningRequestSuggestion[]
  reusableDecisionAnswerSuggestions: ReusableDecisionAnswerSuggestion[]
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
}) {
  const answerBundleInterpretation = buildAnswerBundleInterpretationModel({
    draft,
    decisions,
    followThroughDraft,
    onDraftChange,
    onFollowThroughChange,
    reusableAnswerSourceSuggestions,
    reusablePlanningAnswerSuggestions,
    reusableDecisionAnswerSuggestions,
  })

  return (
    <SurfaceCard
      icon={<MessageSquare className="w-4 h-4 text-purple-400" />}
      title="Answer Bundles"
      subtitle="Answer-first decision capture and shared reply interpretation"
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Record Decision Answers</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Mode</span>
              <select
                value={draft.mode}
                onChange={(event) =>
                  onDraftChange({
                    mode: event.target.value as AnswerBundleDraft['mode'],
                  })
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                <option value="single">single decision</option>
                <option value="batch">shared reply bundle</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Response Format
              </span>
              <select
                value={draft.sourceResponseFormat}
                onChange={(event) =>
                  onDraftChange({
                    sourceResponseFormat: event.target.value as GoalSourceResponseFormat,
                  })
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
                format={draft.sourceResponseFormat}
                sourceResponse={draft.sourceResponse}
                onApplyTemplate={(value) => onDraftChange({ sourceResponse: value })}
                onApplyFormatTemplate={(nextFormat, value) =>
                  onDraftChange({
                    sourceResponseFormat: nextFormat,
                    sourceResponse: value,
                  })
                }
                onApplyFormatAnswerContextSetup={
                  answerBundleInterpretation.onApplyFormatAnswerContextSetup
                }
                onApplyFormatContextSetup={answerBundleInterpretation.onApplyFormatContextSetup}
                onApplyCurrentContextSetup={answerBundleInterpretation.onApplyCurrentContextSetup}
                onApplyCurrentAnswerContextSetup={
                  answerBundleInterpretation.onApplyCurrentAnswerContextSetup
                }
                onApplyCurrentAnswerSetup={answerBundleInterpretation.onApplyCurrentAnswerSetup}
                onApplyCurrentAnswerSourceSetup={
                  answerBundleInterpretation.onApplyCurrentAnswerSourceSetup
                }
                onApplyCurrentConsumerRouting={
                  answerBundleInterpretation.onApplyCurrentConsumerRouting
                }
                consumers={answerBundleInterpretation.templateConsumers}
              />
              <SourceResponseFormatCompatibilityNotice
                issues={answerBundleInterpretation.compatibilityIssues}
              />
            </label>

            {draft.mode === 'single' && (
              <>
                <ReusableDecisionAnswerSuggestionList
                  suggestions={reusableDecisionAnswerSuggestions}
                  onSelect={(suggestion) =>
                    onDraftChange(buildAnswerBundleSingleSuggestionPatch(suggestion))
                  }
                />
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Summary</span>
                  <input
                    value={draft.summary}
                    onChange={(event) => onDraftChange({ summary: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Auth strategy"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Decision Key
                  </span>
                  <input
                    value={draft.decisionKey}
                    onChange={(event) => onDraftChange({ decisionKey: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Prompt</span>
                  <input
                    value={draft.prompt}
                    onChange={(event) => onDraftChange({ prompt: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="What should auth strategy be?"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Linked Task
                  </span>
                  <input
                    value={draft.taskRef}
                    onChange={(event) => onDraftChange({ taskRef: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <div className="md:col-span-2">
                  <ReusableSingleValueSuggestions
                    label="Reuse current visible task refs"
                    value={draft.taskRef}
                    onSelect={(value) => onDraftChange({ taskRef: value })}
                    suggestions={reusableTaskRefSuggestions}
                  />
                </div>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Explicit Answer
                  </span>
                  <textarea
                    value={draft.answer}
                    onChange={(event) => onDraftChange({ answer: event.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Use Bun-native auth."
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Source Excerpt
                  </span>
                  <textarea
                    value={draft.sourceExcerpt}
                    onChange={(event) => onDraftChange({ sourceExcerpt: event.target.value })}
                    rows={3}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Optional exact excerpt when the answer should be grounded in shared source text."
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Source Occurrence
                  </span>
                  <input
                    value={draft.sourceOccurrence}
                    onChange={(event) => onDraftChange({ sourceOccurrence: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional positive integer"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Answer Source Key
                  </span>
                  <input
                    value={draft.answerSourceKey}
                    onChange={(event) => onDraftChange({ answerSourceKey: event.target.value })}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Answer Source Group Key
                  </span>
                  <input
                    value={draft.answerSourceGroupKey}
                    onChange={(event) =>
                      onDraftChange({ answerSourceGroupKey: event.target.value })
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <div className="md:col-span-2">
                  <ReusableAnswerSourceFieldSuggestions
                    label="Reuse current answer sources"
                    answerSourceKey={draft.answerSourceKey}
                    answerSourceGroupKey={draft.answerSourceGroupKey}
                    onSelect={(suggestion) =>
                      onDraftChange(buildAnswerBundleSingleAnswerSourceSuggestionPatch(suggestion))
                    }
                    suggestions={reusableAnswerSourceSuggestions}
                  />
                </div>
                <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
                  <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    Advanced matching fields
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Summary Key
                      </span>
                      <input
                        value={draft.summaryKey}
                        onChange={(event) => onDraftChange({ summaryKey: event.target.value })}
                        className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                        placeholder="optional"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Match Hints
                      </span>
                      <input
                        value={draft.matchHints}
                        onChange={(event) => onDraftChange({ matchHints: event.target.value })}
                        className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                        placeholder="comma or newline separated"
                      />
                      <StructuredStringListEditor
                        label="Structured single-answer match hints"
                        value={draft.matchHints}
                        onChange={(value) => onDraftChange({ matchHints: value })}
                        itemLabel="Match hint"
                        addLabel="Add hint"
                        placeholder="auth strategy"
                        emptyLabel="No structured single-answer match hints yet."
                      />
                    </label>
                  </div>
                </details>
              </>
            )}

            {draft.mode === 'batch' && (
              <>
                <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={draft.inferOpenDecisions}
                      onChange={(event) =>
                        onDraftChange({ inferOpenDecisions: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-[#444] bg-[#111] text-purple-500 focus:ring-purple-500/40"
                    />
                    infer open decisions
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={draft.inferDecisionTopics}
                      onChange={(event) =>
                        onDraftChange({ inferDecisionTopics: event.target.checked })
                      }
                      className="h-4 w-4 rounded border-[#444] bg-[#111] text-purple-500 focus:ring-purple-500/40"
                    />
                    infer new decision topics
                  </label>
                </div>
                <div className="space-y-1 md:col-span-2">
                  <StructuredDecisionAnswerEntriesEditor
                    label="Structured decision answers"
                    value={draft.answersJson}
                    onChange={(value) => onDraftChange({ answersJson: value })}
                    suggestions={reusableDecisionAnswerSuggestions}
                    taskRefSuggestions={reusableTaskRefSuggestions}
                    answerSourceSuggestions={reusableAnswerSourceSuggestions}
                  />
                </div>
              </>
            )}

            <div className="space-y-1 md:col-span-2">
              <StructuredAnswerSourcesEditor
                label="Structured answer sources"
                value={draft.answerSourcesJson}
                onChange={(value) => onDraftChange({ answerSourcesJson: value })}
                suggestions={reusableAnswerSourceSuggestions}
                routingSuggestions={answerBundleInterpretation.answerSourceRoutingSuggestions}
              />
            </div>

            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Shared Source Response
              </span>
              <textarea
                value={draft.sourceResponse}
                onChange={(event) => onDraftChange({ sourceResponse: event.target.value })}
                rows={5}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder={
                  draft.mode === 'single'
                    ? 'Optional less-structured reply to interpret for this one decision.'
                    : 'Optional shared reply used across explicit answers or inferred open/new decisions.'
                }
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
            onChange={onFollowThroughChange}
          />

          {submitResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>
                {'decision' in submitResult
                  ? `${submitResult.decision.decisionKey} ${
                      submitResult.created ? 'created and answered' : 'answered'
                    }${submitResult.followThrough ? ` with ${submitResult.followThrough.kind}` : ''}.`
                  : `${submitResult.decisions.length} decision(s) answered, ${submitResult.createdDecisionKeys.length} created${
                      submitResult.followThrough ? `, with ${submitResult.followThrough.kind}` : ''
                    }.`}
              </div>
              {'decision' in submitResult ? (
                <>
                  <DecisionMutationAuthorityCard
                    decision={submitResult.decision}
                    extra={
                      <>
                        <div className="mt-1">Created: {submitResult.created ? 'yes' : 'no'}</div>
                        <div className="mt-1">
                          Blocker removed: {submitResult.blockerRemoved ? 'yes' : 'no'}
                        </div>
                      </>
                    }
                  />
                  {submitResult.resolvedSourceResponseFormat && (
                    <div className="mt-1">
                      Resolved source-response format: {submitResult.resolvedSourceResponseFormat}
                    </div>
                  )}
                  {submitResult.followThrough && (
                    <DecisionFollowThroughResultCard followThrough={submitResult.followThrough} />
                  )}
                </>
              ) : (
                <>
                  <div className="mt-1">
                    Blocker removed: {submitResult.blockerRemoved ? 'yes' : 'no'}
                  </div>
                  {submitResult.createdDecisionKeys.length > 0 && (
                    <div className="mt-1">
                      Created decision keys: {submitResult.createdDecisionKeys.join(', ')}
                    </div>
                  )}
                  {submitResult.resolvedSourceResponseFormat && (
                    <div className="mt-1">
                      Resolved source-response format: {submitResult.resolvedSourceResponseFormat}
                    </div>
                  )}
                  {submitResult.followThrough && (
                    <DecisionFollowThroughResultCard followThrough={submitResult.followThrough} />
                  )}
                  {submitResult.decisions.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {submitResult.decisions.map((decision) => (
                        <DecisionMutationAuthorityCard
                          key={decision.decisionKey}
                          decision={decision}
                          extra={
                            submitResult.createdDecisionKeys.includes(decision.decisionKey) ? (
                              <div className="mt-1">Created in this bundle: yes</div>
                            ) : null
                          }
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-2 text-[11px] text-gray-500">
            Use this surface when one explicit reply should create or answer decision topics
            directly, with optional shared planner follow-through.
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={submitError} />
            <button
              onClick={onSubmit}
              disabled={
                submitPending ||
                isAnswerBundleSubmitDisabled(
                  draft,
                  followThroughDraft,
                  reusableWorkflowGraphSuggestions,
                  reusableWorkflowTaskRefSuggestions,
                  reusableWorkflowGroupKeySuggestions,
                  buildValidTaskBlockerRefSetFromSuggestions(reusableBlockerSuggestions),
                  decisions,
                )
              }
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitPending
                ? 'Recording...'
                : draft.mode === 'single'
                  ? 'Record Answer'
                  : 'Record Answer Bundle'}
            </button>
          </div>
        </div>
      </div>
    </SurfaceCard>
  )
}
