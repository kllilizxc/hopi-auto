import { FolderKanban } from 'lucide-react'
import type {
  GoalPlanningRequest,
  GoalSourceResponseFormat,
  TodoTaskItem,
} from '../lib/api'
import { cn } from '../lib/utils'
import {
  buildPlanningDraftPatchFromPlanningRequestSuggestion,
  buildAnswerSourceEditorValueWithRoutingSuggestions,
  buildAnswerSourceEditorValueWithSetupSuggestions,
  buildApplyCurrentAnswerSourceSetup,
  buildApplyCurrentConsumerRouting,
  buildPlanningAnswerEditorValueWithSetupSuggestions,
  buildApplyCurrentPlanningAnswerSetup,
  ReusablePlanningRequestSuggestionList,
  ReusableSingleValueSuggestions,
  StructuredBlockersEditor,
  StructuredStringListEditor,
  StructuredPlanningAnswersEditor,
  StructuredAnswerSourcesEditor,
  parsePlanningAnswerEditorItems,
  parseListInput,
} from './boardViewStructuredEditors'
import type {
  ReusableAnswerSourceSuggestion,
  ReusableBlockerSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
} from './boardViewStructuredEditorTypes'
import { buildReusableAnswerSourceRoutingSuggestions } from './boardViewReusableSuggestions'
import { summarizePlanningRequestMutationResult } from './boardViewMutationResultSupport'
import {
  SOURCE_RESPONSE_FORMAT_OPTIONS,
  buildSourceResponseTemplateConsumersFromPlanningAnswerItems,
  createExplicitAnswerSourceReferenceGroup,
  formatSourceResponseFormatLabel,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'
import {
  listAutoInlineTopicMixedAuthorityIssues,
  listInlineTopicExplicitConsumerMatchIssues,
  listInlineTopicStandaloneAuthorityIssues,
  listInlineTopicStructureIssues,
  listInlineTopicUnconsumedIssues,
} from './boardViewInlineTopicSupport'
import {
  formatSupportsInferRemainingAnswers,
  hasInterpretationInputForSelectedFormat,
  listExplicitAnswerSourceReferenceExistenceIssues,
  listLabeledSectionStandaloneAuthorityIssues,
  listSourceResponseFormatCompatibilityIssues,
  parseAnswerSourcesJsonIfValid,
} from './boardViewInterpretationSupport'
import {
  SourceResponseFormatCompatibilityNotice,
  SourceResponseFormatGuidance,
} from './boardViewInterpretationNoticeSupport'
import {
  hasValidAnswerSourcesJsonOrEmpty,
  hasValidBlockersJsonOrEmpty,
  hasValidPlanningAnswersJsonOrEmpty,
  normalizeOptionalString,
  parseAnswerSourcesJson,
} from './boardViewJsonInputSupport'
import {
  listLabeledSectionExplicitConsumerMatchIssues,
  listLabeledSectionStructureIssues,
  listLabeledSectionUnconsumedIssues,
} from './boardViewLabeledSectionSupport'
import {
  listOrderedSourceResponseStructureIssues,
  listOrderedSourceResponseUnconsumedIssues,
  listQuestionBlockStructureIssues,
  listQuestionBlockUnconsumedIssues,
} from './boardViewOrderedQuestionBlockSupport'
import {
  MutationFeedback,
  MutationPlanningRequestAuthorityCard,
  PlanningRequestAuthorityDetails,
  SurfaceCard,
  SurfaceEmptyState,
  TaskBlockerSummary,
} from './boardViewPresentationSupport'
import {
  listPlanningRemainingAnswerSourceAuthorityIssues,
  listPlanningRemainingAnswerSourceContiguityIssues,
  listPlanningRemainingAnswerSourceMergeConflictIssues,
} from './boardViewRemainingAnswerSourceSupport'

type PlanningDraft = {
  requestKey: string
  groupKey: string
  groupTaskKey: string
  title: string
  description: string
  acceptanceCriteria: string
  decisionRefs: string
  answersJson: string
  answerSourcesJson: string
  sourceResponse: string
  sourceResponseFormat: GoalSourceResponseFormat
  inferRemainingAnswers: boolean
  requestedUpdates: string
  blockedByJson: string
}

export function PlanningRequestPanel({
  requests,
  tasks,
  planningDraft,
  onPlanningDraftChange,
  onPlanningDraftPrefill,
  onCreatePlanningRequest,
  createPending,
  createError,
  createResult,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusablePlanningRequestSuggestions,
  reusableDecisionRefSuggestions,
  reusableBlockerSuggestions,
  reusablePlanningRequestKeySuggestions,
  reusablePlanningGroupKeySuggestions,
  reusablePlanningGroupTaskKeySuggestions,
}: {
  requests: GoalPlanningRequest[]
  tasks: TodoTaskItem[]
  planningDraft: PlanningDraft
  onPlanningDraftChange: (field: keyof PlanningDraft, value: string | boolean) => void
  onPlanningDraftPrefill: (patch: Partial<PlanningDraft>) => void
  onCreatePlanningRequest: () => void
  createPending: boolean
  createError: Error | null
  createResult?: GoalPlanningRequest & {
    created: boolean
    taskCreated: boolean
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  }
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions: ReusablePlanningRequestSuggestion[]
  reusableDecisionRefSuggestions: ReusableStringSuggestion[]
  reusableBlockerSuggestions: ReusableBlockerSuggestion[]
  reusablePlanningRequestKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupTaskKeySuggestions: ReusableStringSuggestion[]
}) {
  const open = requests.filter((request) => request.status === 'open')
  const resolved = requests.filter((request) => request.status === 'resolved')
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))
  const planningAnswerItems = parsePlanningAnswerEditorItems(planningDraft.answersJson).items
  const planningAnswerSourcesAreValid = hasValidAnswerSourcesJsonOrEmpty(
    planningDraft.answerSourcesJson,
    'Planning answer sources',
  )
  const planningAnswerSources = planningAnswerSourcesAreValid
    ? parseAnswerSourcesJsonIfValid(planningDraft.answerSourcesJson, 'Planning answer sources')
    : undefined
  const planningAnswerSourceReferenceIssues = planningAnswerSourcesAreValid
    ? listExplicitAnswerSourceReferenceExistenceIssues(
        [createExplicitAnswerSourceReferenceGroup('Planning answers', planningAnswerItems)].filter(
          (group): group is ExplicitAnswerSourceReferenceGroup => group !== null,
        ),
        planningAnswerSources,
      )
    : []
  const planningRemainingAnswerSourceAuthorityIssues =
    listPlanningRemainingAnswerSourceAuthorityIssues({
      format: planningDraft.sourceResponseFormat,
      sourceResponse: planningDraft.sourceResponse,
      answerSources: planningAnswerSources,
      inferRemainingAnswers: planningDraft.inferRemainingAnswers,
      explicitPlanningAnswerCount: planningAnswerItems.length,
    })
  const planningRemainingAnswerSourceContiguityIssues =
    listPlanningRemainingAnswerSourceContiguityIssues({
      format: planningDraft.sourceResponseFormat,
      sourceResponse: planningDraft.sourceResponse,
      answerSources: planningAnswerSources,
      inferRemainingAnswers: planningDraft.inferRemainingAnswers,
      explicitPlanningAnswerCount: planningAnswerItems.length,
    })
  const planningRemainingAnswerSourceMergeConflictIssues =
    listPlanningRemainingAnswerSourceMergeConflictIssues({
      format: planningDraft.sourceResponseFormat,
      sourceResponse: planningDraft.sourceResponse,
      answerSources: planningAnswerSources,
      inferRemainingAnswers: planningDraft.inferRemainingAnswers,
      explicitPlanningAnswerCount: planningAnswerItems.length,
    })
  const planningLabeledSectionStructureIssues = listLabeledSectionStructureIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
  })
  const planningLabeledSectionExplicitMatchIssues = listLabeledSectionExplicitConsumerMatchIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
  })
  const planningLabeledSectionUnconsumedIssues = listLabeledSectionUnconsumedIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    explicitConsumerCount: planningAnswerItems.length,
    inferRemainingAnswers: planningDraft.inferRemainingAnswers,
  })
  const planningLabeledSectionStandaloneAuthorityIssues =
    listLabeledSectionStandaloneAuthorityIssues({
      format: planningDraft.sourceResponseFormat,
      sourceResponse: planningDraft.sourceResponse,
    })
  const planningOrderedStructureIssues = listOrderedSourceResponseStructureIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
  })
  const planningOrderedUnconsumedIssues = listOrderedSourceResponseUnconsumedIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    explicitPlanningAnswerCount: planningAnswerItems.length,
  })
  const planningQuestionBlockStructureIssues = listQuestionBlockStructureIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
  })
  const planningQuestionBlockUnconsumedIssues = listQuestionBlockUnconsumedIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    explicitPlanningAnswerCount: planningAnswerItems.length,
    inferRemainingAnswers: planningDraft.inferRemainingAnswers,
  })
  const planningInlineTopicStructureIssues = listInlineTopicStructureIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
  })
  const planningInlineTopicExplicitMatchIssues = listInlineTopicExplicitConsumerMatchIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
  })
  const planningInlineTopicUnconsumedIssues = listInlineTopicUnconsumedIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    explicitConsumerCount: planningAnswerItems.length,
    inferRemainingAnswers: planningDraft.inferRemainingAnswers,
  })
  const planningInlineTopicStandaloneAuthorityIssues = listInlineTopicStandaloneAuthorityIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
    planningAnswers: planningAnswerItems,
    inferRemainingAnswers: planningDraft.inferRemainingAnswers,
  })
  const planningAutoInlineTopicMixedAuthorityIssues = listAutoInlineTopicMixedAuthorityIssues({
    format: planningDraft.sourceResponseFormat,
    sourceResponse: planningDraft.sourceResponse,
  })
  const planningTemplateConsumers =
    buildSourceResponseTemplateConsumersFromPlanningAnswerItems(planningAnswerItems)
  const planningAnswerSourceRoutingSuggestions = buildReusableAnswerSourceRoutingSuggestions({
    planningAnswerItems,
  })
  const applyCurrentPlanningAnswerSetup = buildApplyCurrentPlanningAnswerSetup(
    planningDraft.answersJson,
    reusablePlanningAnswerSuggestions,
    reusableAnswerSourceSuggestions,
    'Planning answers',
    (value) => onPlanningDraftChange('answersJson', value),
  )

  return (
    <SurfaceCard
      icon={<FolderKanban className="w-4 h-4 text-purple-400" />}
      title="Planning Requests"
      subtitle={`${open.length} open · ${resolved.length} resolved`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Open Planning Request</div>
          <div className="grid gap-3 md:grid-cols-2">
            <ReusablePlanningRequestSuggestionList
              suggestions={reusablePlanningRequestSuggestions}
              onSelect={(suggestion) =>
                onPlanningDraftPrefill(
                  buildPlanningDraftPatchFromPlanningRequestSuggestion(suggestion),
                )
              }
            />
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
              <input
                value={planningDraft.title}
                onChange={(event) => onPlanningDraftChange('title', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Plan follow-through for auth strategy"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Request Key</span>
              <input
                value={planningDraft.requestKey}
                onChange={(event) => onPlanningDraftChange('requestKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current planning request keys"
                value={planningDraft.requestKey}
                onSelect={(value) => onPlanningDraftChange('requestKey', value)}
                suggestions={reusablePlanningRequestKeySuggestions}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Description</span>
              <textarea
                value={planningDraft.description}
                onChange={(event) => onPlanningDraftChange('description', event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Describe the planning follow-through."
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Acceptance Criteria
              </span>
              <textarea
                value={planningDraft.acceptanceCriteria}
                onChange={(event) =>
                  onPlanningDraftChange('acceptanceCriteria', event.target.value)
                }
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder={
                  'One item per line\nDesign reflects the new decision.\nTodo reflects the new plan.'
                }
              />
              <StructuredStringListEditor
                label="Structured planning acceptance criteria"
                value={planningDraft.acceptanceCriteria}
                onChange={(value) => onPlanningDraftChange('acceptanceCriteria', value)}
                itemLabel="Criterion"
                addLabel="Add criterion"
                placeholder="Todo reflects the new plan."
                emptyLabel="No structured planning acceptance criteria yet."
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Decision Refs
              </span>
              <input
                value={planningDraft.decisionRefs}
                onChange={(event) => onPlanningDraftChange('decisionRefs', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="comma or newline separated"
              />
              <StructuredStringListEditor
                label="Structured decision refs"
                value={planningDraft.decisionRefs}
                onChange={(value) => onPlanningDraftChange('decisionRefs', value)}
                itemLabel="Decision ref"
                addLabel="Add ref"
                placeholder="auth-strategy"
                emptyLabel="No structured decision refs yet."
                suggestions={reusableDecisionRefSuggestions}
                suggestionSummaryLabel="Reuse current decisions"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Requested Updates
              </span>
              <input
                value={planningDraft.requestedUpdates}
                onChange={(event) => onPlanningDraftChange('requestedUpdates', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="design.md, todo.yml"
              />
              <StructuredStringListEditor
                label="Structured requested updates"
                value={planningDraft.requestedUpdates}
                onChange={(value) => onPlanningDraftChange('requestedUpdates', value)}
                itemLabel="Update target"
                addLabel="Add target"
                placeholder="design.md"
                emptyLabel="No structured requested updates yet."
              />
            </label>
            <div className="space-y-1 md:col-span-2">
              <StructuredBlockersEditor
                label="Structured planning request blockers"
                value={planningDraft.blockedByJson}
                onChange={(value) => onPlanningDraftChange('blockedByJson', value)}
                suggestions={reusableBlockerSuggestions}
              />
            </div>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Response Format
              </span>
              <select
                value={planningDraft.sourceResponseFormat}
                onChange={(event) =>
                  onPlanningDraftChange('sourceResponseFormat', event.target.value)
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
                format={planningDraft.sourceResponseFormat}
                sourceResponse={planningDraft.sourceResponse}
                onApplyTemplate={(value) => onPlanningDraftChange('sourceResponse', value)}
                onApplyFormatTemplate={(nextFormat, value) => {
                  onPlanningDraftChange('sourceResponseFormat', nextFormat)
                  onPlanningDraftChange('sourceResponse', value)
                }}
                onApplyFormatAnswerContextSetup={
                  applyCurrentPlanningAnswerSetup &&
                  hasValidAnswerSourcesJsonOrEmpty(
                    planningDraft.answerSourcesJson,
                    'Planning answer sources',
                  )
                    ? (nextFormat, value) => {
                        const nextAnswerSourcesJson =
                          buildAnswerSourceEditorValueWithSetupSuggestions(
                            planningDraft.answerSourcesJson,
                            planningAnswerSourceRoutingSuggestions,
                            reusableAnswerSourceSuggestions,
                          )
                        const nextAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
                          planningDraft.answersJson,
                          reusablePlanningAnswerSuggestions,
                          reusableAnswerSourceSuggestions,
                        )
                        if (!nextAnswerSourcesJson || !nextAnswersJson) {
                          return
                        }
                        onPlanningDraftChange('sourceResponseFormat', nextFormat)
                        onPlanningDraftChange('answerSourcesJson', nextAnswerSourcesJson)
                        onPlanningDraftChange('answersJson', nextAnswersJson)
                        onPlanningDraftChange('sourceResponse', value)
                      }
                    : undefined
                }
                onApplyFormatContextSetup={
                  planningAnswerSourceRoutingSuggestions.length > 0 &&
                  hasValidAnswerSourcesJsonOrEmpty(
                    planningDraft.answerSourcesJson,
                    'Planning answer sources',
                  )
                    ? (nextFormat, value) => {
                        const nextAnswerSourcesJson =
                          buildAnswerSourceEditorValueWithRoutingSuggestions(
                            planningDraft.answerSourcesJson,
                            planningAnswerSourceRoutingSuggestions,
                          )
                        if (!nextAnswerSourcesJson) {
                          return
                        }
                        onPlanningDraftChange('sourceResponseFormat', nextFormat)
                        onPlanningDraftChange('answerSourcesJson', nextAnswerSourcesJson)
                        onPlanningDraftChange('sourceResponse', value)
                      }
                    : undefined
                }
                onApplyCurrentContextSetup={
                  planningAnswerSourceRoutingSuggestions.length > 0 &&
                  hasValidAnswerSourcesJsonOrEmpty(
                    planningDraft.answerSourcesJson,
                    'Planning answer sources',
                  )
                    ? (value) => {
                        const nextAnswerSourcesJson =
                          buildAnswerSourceEditorValueWithRoutingSuggestions(
                            planningDraft.answerSourcesJson,
                            planningAnswerSourceRoutingSuggestions,
                          )
                        if (!nextAnswerSourcesJson) {
                          return
                        }
                        onPlanningDraftChange('answerSourcesJson', nextAnswerSourcesJson)
                        onPlanningDraftChange('sourceResponse', value)
                      }
                    : undefined
                }
                onApplyCurrentAnswerContextSetup={
                  applyCurrentPlanningAnswerSetup &&
                  hasValidAnswerSourcesJsonOrEmpty(
                    planningDraft.answerSourcesJson,
                    'Planning answer sources',
                  )
                    ? (value) => {
                        const nextAnswerSourcesJson =
                          buildAnswerSourceEditorValueWithSetupSuggestions(
                            planningDraft.answerSourcesJson,
                            planningAnswerSourceRoutingSuggestions,
                            reusableAnswerSourceSuggestions,
                          )
                        const nextAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
                          planningDraft.answersJson,
                          reusablePlanningAnswerSuggestions,
                          reusableAnswerSourceSuggestions,
                        )
                        if (!nextAnswerSourcesJson || !nextAnswersJson) {
                          return
                        }
                        onPlanningDraftChange('answerSourcesJson', nextAnswerSourcesJson)
                        onPlanningDraftChange('answersJson', nextAnswersJson)
                        onPlanningDraftChange('sourceResponse', value)
                      }
                    : undefined
                }
                onApplyCurrentAnswerSetup={applyCurrentPlanningAnswerSetup}
                onApplyCurrentAnswerSourceSetup={buildApplyCurrentAnswerSourceSetup(
                  planningDraft.answerSourcesJson,
                  planningAnswerSourceRoutingSuggestions,
                  reusableAnswerSourceSuggestions,
                  'Planning answer sources',
                  (value) => onPlanningDraftChange('answerSourcesJson', value),
                )}
                onApplyCurrentConsumerRouting={buildApplyCurrentConsumerRouting(
                  planningDraft.answerSourcesJson,
                  planningAnswerSourceRoutingSuggestions,
                  'Planning answer sources',
                  (value) => onPlanningDraftChange('answerSourcesJson', value),
                )}
                consumers={planningTemplateConsumers}
              />
              <SourceResponseFormatCompatibilityNotice
                issues={[
                  ...listSourceResponseFormatCompatibilityIssues({
                    format: planningDraft.sourceResponseFormat,
                    sourceResponse: planningDraft.sourceResponse,
                    answerSourcesJson: planningDraft.answerSourcesJson,
                    answerSourcesLabel: 'Planning answer sources',
                    inferRemainingAnswers: planningDraft.inferRemainingAnswers,
                  }),
                  ...planningAnswerSourceReferenceIssues,
                  ...planningLabeledSectionStructureIssues,
                  ...planningLabeledSectionExplicitMatchIssues,
                  ...planningLabeledSectionUnconsumedIssues,
                  ...planningLabeledSectionStandaloneAuthorityIssues,
                  ...planningOrderedStructureIssues,
                  ...planningOrderedUnconsumedIssues,
                  ...planningQuestionBlockStructureIssues,
                  ...planningQuestionBlockUnconsumedIssues,
                  ...planningInlineTopicStructureIssues,
                  ...planningInlineTopicExplicitMatchIssues,
                  ...planningInlineTopicUnconsumedIssues,
                  ...planningInlineTopicStandaloneAuthorityIssues,
                  ...planningRemainingAnswerSourceAuthorityIssues,
                  ...planningRemainingAnswerSourceContiguityIssues,
                  ...planningRemainingAnswerSourceMergeConflictIssues,
                ]}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Group Key</span>
              <input
                value={planningDraft.groupKey}
                onChange={(event) => onPlanningDraftChange('groupKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current planning group keys"
                value={planningDraft.groupKey}
                onSelect={(value) => onPlanningDraftChange('groupKey', value)}
                suggestions={reusablePlanningGroupKeySuggestions}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Group Task Key
              </span>
              <input
                value={planningDraft.groupTaskKey}
                onChange={(event) => onPlanningDraftChange('groupTaskKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current grouped task keys"
                value={planningDraft.groupTaskKey}
                onSelect={(value) => onPlanningDraftChange('groupTaskKey', value)}
                suggestions={reusablePlanningGroupTaskKeySuggestions}
              />
            </label>
            <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={planningDraft.inferRemainingAnswers}
                  onChange={(event) =>
                    onPlanningDraftChange('inferRemainingAnswers', event.target.checked)
                  }
                  className="h-4 w-4 rounded border-[#444] bg-[#111] text-sky-500 focus:ring-sky-500/40"
                />
                infer remaining planner answers
              </label>
            </div>
            <div className="space-y-1 md:col-span-2">
              <StructuredPlanningAnswersEditor
                label="Structured planning answers"
                value={planningDraft.answersJson}
                onChange={(value) => onPlanningDraftChange('answersJson', value)}
                suggestions={reusablePlanningAnswerSuggestions}
                answerSourceSuggestions={reusableAnswerSourceSuggestions}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <StructuredAnswerSourcesEditor
                label="Structured answer sources"
                value={planningDraft.answerSourcesJson}
                onChange={(value) => onPlanningDraftChange('answerSourcesJson', value)}
                suggestions={reusableAnswerSourceSuggestions}
                routingSuggestions={planningAnswerSourceRoutingSuggestions}
              />
            </div>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Shared Source Response
              </span>
              <textarea
                value={planningDraft.sourceResponse}
                onChange={(event) => onPlanningDraftChange('sourceResponse', event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Optional less-structured reply used to materialize planner answers directly onto this request."
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={createError} />
            <button
              onClick={onCreatePlanningRequest}
              disabled={
                createPending ||
                planningDraft.title.trim().length === 0 ||
                parseListInput(planningDraft.acceptanceCriteria).length === 0 ||
                !hasValidPlanningAnswersJsonOrEmpty(
                  planningDraft.answersJson,
                  'Planning answers',
                ) ||
                !hasValidAnswerSourcesJsonOrEmpty(
                  planningDraft.answerSourcesJson,
                  'Planning answer sources',
                ) ||
                planningAnswerSourceReferenceIssues.length > 0 ||
                planningLabeledSectionStructureIssues.length > 0 ||
                planningLabeledSectionExplicitMatchIssues.length > 0 ||
                planningLabeledSectionUnconsumedIssues.length > 0 ||
                planningLabeledSectionStandaloneAuthorityIssues.length > 0 ||
                planningOrderedStructureIssues.length > 0 ||
                planningOrderedUnconsumedIssues.length > 0 ||
                planningQuestionBlockStructureIssues.length > 0 ||
                planningQuestionBlockUnconsumedIssues.length > 0 ||
                planningInlineTopicStructureIssues.length > 0 ||
                planningInlineTopicExplicitMatchIssues.length > 0 ||
                planningInlineTopicUnconsumedIssues.length > 0 ||
                planningInlineTopicStandaloneAuthorityIssues.length > 0 ||
                planningAutoInlineTopicMixedAuthorityIssues.length > 0 ||
                planningRemainingAnswerSourceAuthorityIssues.length > 0 ||
                planningRemainingAnswerSourceContiguityIssues.length > 0 ||
                planningRemainingAnswerSourceMergeConflictIssues.length > 0 ||
                !hasValidBlockersJsonOrEmpty(
                  planningDraft.blockedByJson,
                  'Planning request blockers',
                ) ||
                (planningDraft.inferRemainingAnswers &&
                  (!formatSupportsInferRemainingAnswers(planningDraft.sourceResponseFormat) ||
                    !hasInterpretationInputForSelectedFormat(
                      planningDraft.sourceResponseFormat,
                      normalizeOptionalString(planningDraft.sourceResponse),
                      planningDraft.answerSourcesJson.trim()
                        ? parseAnswerSourcesJson(
                            planningDraft.answerSourcesJson,
                            'Planning answer sources',
                          )
                        : undefined,
                    )))
              }
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createPending ? 'Opening...' : 'Open Planning Request'}
            </button>
          </div>
          {createResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizePlanningRequestMutationResult(createResult)}</div>
              <div className="mt-2">
                <MutationPlanningRequestAuthorityCard
                  request={createResult}
                  extra={
                    <>
                      <div className="mt-1">
                        Created planning request: {createResult.created ? 'yes' : 'no'}
                      </div>
                      <div className="mt-1">
                        Created planning task: {createResult.taskCreated ? 'yes' : 'no'}
                      </div>
                    </>
                  }
                />
              </div>
            </div>
          )}
        </div>

        {requests.length === 0 ? (
          <SurfaceEmptyState label="No planning requests yet." />
        ) : (
          <div className="space-y-3">
            {requests.map((request) => {
              const linkedTask = tasksByRef.get(request.taskRef)

              return (
                <div
                  key={request.requestKey}
                  className="rounded-xl border border-[#303030] bg-[#191919] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-white">{request.title}</div>
                      <div className="mt-1 text-xs text-gray-500 font-mono">
                        {request.requestKey}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                        request.status === 'resolved'
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                          : 'border-sky-500/20 bg-sky-500/10 text-sky-300',
                      )}
                    >
                      {request.status}
                    </span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-gray-400">
                    {request.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-400">
                    <span className="rounded-full bg-[#232323] px-2 py-1 font-mono">
                      {request.taskRef}
                    </span>
                    {request.groupKey && (
                      <span className="rounded-full bg-[#232323] px-2 py-1 font-mono text-violet-300">
                        group:{request.groupKey}
                      </span>
                    )}
                    {request.workflowKey && (
                      <span className="rounded-full bg-[#232323] px-2 py-1 font-mono text-violet-300">
                        workflow:{request.workflowKey}
                      </span>
                    )}
                    {request.workflowTaskKey && (
                      <span className="rounded-full bg-[#232323] px-2 py-1 font-mono text-violet-200">
                        child:{request.workflowTaskKey}
                      </span>
                    )}
                    {request.requestedUpdates.map((update) => (
                      <span key={update} className="rounded-full bg-[#232323] px-2 py-1">
                        {update}
                      </span>
                    ))}
                  </div>
                  <PlanningRequestAuthorityDetails
                    request={request}
                    tone="gray"
                    prefixLines={
                      linkedTask ? <div>Task status: {linkedTask.status}</div> : undefined
                    }
                    suffixLines={
                      linkedTask && linkedTask.blockedBy.length > 0 ? (
                        <TaskBlockerSummary blockers={linkedTask.blockedBy} />
                      ) : undefined
                    }
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}
