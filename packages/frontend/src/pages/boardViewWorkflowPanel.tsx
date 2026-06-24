import { GitBranch } from 'lucide-react'
import type { GoalPlanningWorkflowState, GoalSourceResponseFormat, TodoTaskItem } from '../lib/api'
import {
  buildWorkflowChildPatchFromPlanningRequestSuggestion,
  buildWorkflowDraftPatchFromWorkflowContextSuggestion,
  buildWorkflowDraftPatchFromWorkflowGraphSuggestion,
  buildWorkflowDraftPatchFromWorkflowChildSuggestion,
  buildValidTaskBlockerRefSetFromSuggestions,
  matchesReusableBatchRequestGroupSuggestionSelection,
  ReusablePlanningRequestSuggestionList,
  ReusableSingleValueSuggestions,
  ReusableWorkflowContextSuggestionList,
  ReusableWorkflowGraphSuggestionList,
  ReusableWorkflowChildSuggestionList,
  StructuredAnswerSourcesEditor,
  StructuredBatchRequestsEditor,
  StructuredBlockersEditor,
  StructuredPlanningAnswersEditor,
  StructuredStringListEditor,
  StructuredWorkflowChildrenEditor,
  parseListInput,
} from './boardViewStructuredEditors'
import type {
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
  ReusableWorkflowChildSuggestion,
  ReusableWorkflowContextSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'
import {
  buildReusableWorkflowDependencyKeySuggestions,
  buildReusableWorkflowTaskKeySuggestions,
} from './boardViewReusableSuggestions'
import type { GoalPlanningWorkflowCreateResultWithReuse } from './boardViewMutationResultSupport'
import { summarizeWorkflowCreateMutationResult } from './boardViewMutationResultSupport'
import { SOURCE_RESPONSE_FORMAT_OPTIONS, formatSourceResponseFormatLabel } from './boardViewSourceResponseSupport'
import {
  formatSupportsInferRemainingAnswers,
  hasInterpretationInputForSelectedFormat,
} from './boardViewInterpretationSupport'
import {
  SourceResponseFormatCompatibilityNotice,
  SourceResponseFormatGuidance,
  WorkflowAuthoringConstraintNotice,
} from './boardViewInterpretationNoticeSupport'
import {
  hasAtLeastOneWorkflowChild,
  hasValidBatchRequestsJsonOrEmpty,
  hasValidBlockersJsonOrEmpty,
  hasValidPlanningAnswersJsonOrEmpty,
  normalizeOptionalString,
  parseAnswerSourcesJson,
} from './boardViewJsonInputSupport'
import {
  MutationFeedback,
  SurfaceCard,
  SurfaceEmptyState,
  WorkflowCreateResultCard,
} from './boardViewPresentationSupport'
import { buildWorkflowInterpretationModel } from './boardViewWorkflowInterpretationSupport'
import { WorkflowDetailPanel, WorkflowSummaryCard } from './boardViewWorkflowPanels'
import { listWorkflowDraftDependencyIssues } from './boardViewWorkflowDependencySupport'

type WorkflowDraft = {
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

export function WorkflowPanel({
  workflows,
  tasks,
  selectedWorkflowKey,
  selectedWorkflow,
  workflowDetailLoading,
  workflowDetailError,
  workflowDraft,
  onWorkflowDraftChange,
  onCreateWorkflow,
  createPending,
  createError,
  createResult,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusablePlanningRequestSuggestions,
  reusableDecisionRefSuggestions,
  reusableBlockerSuggestions,
  reusablePlanningRequestKeySuggestions,
  reusablePlanningGroupTaskKeySuggestions,
  reusableBatchRequestSuggestions,
  reusableBatchRequestGroupSuggestions,
  reusableWorkflowKeySuggestions,
  reusableWorkflowContextSuggestions,
  reusableWorkflowGraphSuggestions,
  reusableWorkflowChildSuggestions,
  reusableWorkflowTaskRefSuggestions,
  reusableWorkflowGroupKeySuggestions,
  onSelectWorkflow,
  onPrefillWorkflowKey,
  onPrefillReuseTaskRef,
  onPrefillReuseGroupKey,
}: {
  workflows: GoalPlanningWorkflowState[]
  tasks: TodoTaskItem[]
  selectedWorkflowKey: string | null
  selectedWorkflow: GoalPlanningWorkflowState | null
  workflowDetailLoading: boolean
  workflowDetailError: Error | null
  workflowDraft: WorkflowDraft
  onWorkflowDraftChange: (field: keyof WorkflowDraft, value: string | boolean) => void
  onCreateWorkflow: () => void
  createPending: boolean
  createError: Error | null
  createResult?: GoalPlanningWorkflowCreateResultWithReuse
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions: ReusablePlanningRequestSuggestion[]
  reusableDecisionRefSuggestions: ReusableStringSuggestion[]
  reusableBlockerSuggestions: ReusableBlockerSuggestion[]
  reusablePlanningRequestKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupTaskKeySuggestions: ReusableStringSuggestion[]
  reusableBatchRequestSuggestions: ReusableBatchRequestSuggestion[]
  reusableBatchRequestGroupSuggestions: ReusableBatchRequestGroupSuggestion[]
  reusableWorkflowKeySuggestions: ReusableStringSuggestion[]
  reusableWorkflowContextSuggestions: ReusableWorkflowContextSuggestion[]
  reusableWorkflowGraphSuggestions: ReusableWorkflowGraphSuggestion[]
  reusableWorkflowChildSuggestions: ReusableWorkflowChildSuggestion[]
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[]
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[]
  onSelectWorkflow: (workflowKey: string) => void
  onPrefillWorkflowKey: (workflowKey: string) => void
  onPrefillReuseTaskRef: (taskRef: string, workflowKey: string) => void
  onPrefillReuseGroupKey: (groupKey: string, workflowKey: string) => void
}) {
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))
  const reusableCurrentWorkflowTaskKeySuggestions = buildReusableWorkflowTaskKeySuggestions(
    reusableWorkflowGraphSuggestions,
    workflowDraft.workflowKey,
  )
  const validTaskBlockerRefs = buildValidTaskBlockerRefSetFromSuggestions(
    reusableBlockerSuggestions,
  )
  const reusableCurrentWorkflowDependencyKeySuggestions =
    buildReusableWorkflowDependencyKeySuggestions(
      reusableWorkflowGraphSuggestions,
      workflowDraft.workflowKey,
    )
  const workflowAuthoringIssues = listWorkflowDraftDependencyIssues(
    workflowDraft,
    reusableWorkflowGraphSuggestions,
    reusableWorkflowTaskRefSuggestions,
    reusableWorkflowGroupKeySuggestions,
    validTaskBlockerRefs,
  )
  const hasAdvancedWorkflowChildrenOverride = workflowDraft.childrenJson.trim().length > 0
  const workflowInterpretation = buildWorkflowInterpretationModel({
    workflowDraft,
    onWorkflowDraftChange,
    reusablePlanningAnswerSuggestions,
    reusableAnswerSourceSuggestions,
  })

  return (
    <SurfaceCard
      icon={<GitBranch className="w-4 h-4 text-purple-400" />}
      title="Workflow Graphs"
      subtitle={`${workflows.length} durable workflow batches`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Open Workflow Batch</div>
          <div className="grid gap-3 md:grid-cols-2">
            <ReusableWorkflowGraphSuggestionList
              suggestions={reusableWorkflowGraphSuggestions}
              onSelect={(suggestion) => {
                const patch = buildWorkflowDraftPatchFromWorkflowGraphSuggestion(suggestion)
                for (const [field, value] of Object.entries(patch)) {
                  if (value !== undefined) {
                    onWorkflowDraftChange(
                      field as
                        | 'workflowKey'
                        | 'sharedDecisionRefs'
                        | 'sharedAnswersJson'
                        | 'reuseTaskRef'
                        | 'reuseGroupKey'
                        | 'childrenJson',
                      value,
                    )
                  }
                }
              }}
            />
            <ReusableWorkflowContextSuggestionList
              suggestions={reusableWorkflowContextSuggestions}
              onSelect={(suggestion) => {
                const patch = buildWorkflowDraftPatchFromWorkflowContextSuggestion(suggestion)
                for (const [field, value] of Object.entries(patch)) {
                  if (value !== undefined) {
                    onWorkflowDraftChange(
                      field as
                        | 'workflowKey'
                        | 'sharedDecisionRefs'
                        | 'sharedAnswersJson'
                        | 'reuseTaskRef'
                        | 'reuseGroupKey',
                      value,
                    )
                  }
                }
              }}
            />
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Workflow Key
              </span>
              <input
                value={workflowDraft.workflowKey}
                onChange={(event) => onWorkflowDraftChange('workflowKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional stable workflow key"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current workflow keys"
                value={workflowDraft.workflowKey}
                onSelect={(value) => onWorkflowDraftChange('workflowKey', value)}
                suggestions={reusableWorkflowKeySuggestions}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Reuse Task Ref
              </span>
              <input
                value={workflowDraft.reuseTaskRef}
                onChange={(event) => onWorkflowDraftChange('reuseTaskRef', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional current planning task"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current planning task refs"
                value={workflowDraft.reuseTaskRef}
                onSelect={(value) => onWorkflowDraftChange('reuseTaskRef', value)}
                suggestions={reusableWorkflowTaskRefSuggestions}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Reuse Group Key
              </span>
              <input
                value={workflowDraft.reuseGroupKey}
                onChange={(event) => onWorkflowDraftChange('reuseGroupKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional current planning group"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current planning group keys"
                value={workflowDraft.reuseGroupKey}
                onSelect={(value) => onWorkflowDraftChange('reuseGroupKey', value)}
                suggestions={reusableWorkflowGroupKeySuggestions}
              />
            </label>
            {hasAdvancedWorkflowChildrenOverride ? (
              <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                Structured advanced children are active, so the simple workflow-child draft fields
                stay inactive until you clear the advanced child override below.
              </div>
            ) : (
              <>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Child Kind
                  </span>
                  <select
                    value={workflowDraft.childKind}
                    onChange={(event) => onWorkflowDraftChange('childKind', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  >
                    <option value="planning">planning</option>
                    <option value="planning_batch">planning_batch</option>
                  </select>
                </label>
                <div className="md:col-span-2">
                  <ReusableWorkflowChildSuggestionList
                    suggestions={reusableWorkflowChildSuggestions}
                    onSelect={(suggestion) => {
                      const patch = buildWorkflowDraftPatchFromWorkflowChildSuggestion(suggestion)
                      for (const [field, value] of Object.entries(patch)) {
                        if (value !== undefined) {
                          onWorkflowDraftChange(
                            field as
                              | 'childKind'
                              | 'requestKey'
                              | 'workflowTaskKey'
                              | 'groupKey'
                              | 'blockedByWorkflowKeys'
                              | 'childBlockedByJson'
                              | 'title'
                              | 'description'
                              | 'acceptanceCriteria'
                              | 'childDecisionRefs'
                              | 'childAnswersJson'
                              | 'requestedUpdates'
                              | 'batchRequestsJson',
                            value,
                          )
                        }
                      }
                    }}
                  />
                </div>
              </>
            )}
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Source Response Format
              </span>
              <select
                value={workflowDraft.sourceResponseFormat}
                onChange={(event) =>
                  onWorkflowDraftChange('sourceResponseFormat', event.target.value)
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
                format={workflowDraft.sourceResponseFormat}
                sourceResponse={workflowDraft.sourceResponse}
                onApplyTemplate={(value) => onWorkflowDraftChange('sourceResponse', value)}
                onApplyFormatTemplate={(nextFormat, value) => {
                  onWorkflowDraftChange('sourceResponseFormat', nextFormat)
                  onWorkflowDraftChange('sourceResponse', value)
                }}
                onApplyFormatAnswerContextSetup={
                  workflowInterpretation.onApplyFormatAnswerContextSetup
                }
                onApplyFormatContextSetup={workflowInterpretation.onApplyFormatContextSetup}
                onApplyCurrentContextSetup={workflowInterpretation.onApplyCurrentContextSetup}
                onApplyCurrentAnswerContextSetup={
                  workflowInterpretation.onApplyCurrentAnswerContextSetup
                }
                onApplyCurrentAnswerSetup={workflowInterpretation.onApplyCurrentAnswerSetup}
                onApplyCurrentAnswerSourceSetup={
                  workflowInterpretation.onApplyCurrentAnswerSourceSetup
                }
                onApplyCurrentConsumerRouting={
                  workflowInterpretation.onApplyCurrentConsumerRouting
                }
                consumers={workflowInterpretation.templateConsumers}
              />
              <SourceResponseFormatCompatibilityNotice
                issues={workflowInterpretation.compatibilityIssues}
              />
            </label>
            {!hasAdvancedWorkflowChildrenOverride && workflowDraft.childKind === 'planning' && (
              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                  Request Key
                </span>
                <input
                  value={workflowDraft.requestKey}
                  onChange={(event) => onWorkflowDraftChange('requestKey', event.target.value)}
                  className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  placeholder="optional stable request key"
                />
                <ReusableSingleValueSuggestions
                  label="Reuse current planning request keys"
                  value={workflowDraft.requestKey}
                  onSelect={(value) => onWorkflowDraftChange('requestKey', value)}
                  suggestions={reusablePlanningRequestKeySuggestions}
                />
              </label>
            )}
            {!hasAdvancedWorkflowChildrenOverride && workflowDraft.childKind === 'planning' && (
              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                  Workflow Task Key
                </span>
                <input
                  value={workflowDraft.workflowTaskKey}
                  onChange={(event) => onWorkflowDraftChange('workflowTaskKey', event.target.value)}
                  className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  placeholder="optional child key"
                />
                <ReusableSingleValueSuggestions
                  label="Reuse current workflow child keys"
                  value={workflowDraft.workflowTaskKey}
                  onSelect={(value) => onWorkflowDraftChange('workflowTaskKey', value)}
                  suggestions={reusableCurrentWorkflowTaskKeySuggestions}
                />
              </label>
            )}
            {!hasAdvancedWorkflowChildrenOverride && workflowDraft.childKind === 'planning' && (
              <ReusablePlanningRequestSuggestionList
                suggestions={reusablePlanningRequestSuggestions}
                onSelect={(suggestion) => {
                  const patch = buildWorkflowChildPatchFromPlanningRequestSuggestion(suggestion)

                  if (patch.requestKey !== undefined) {
                    onWorkflowDraftChange('requestKey', patch.requestKey)
                  }
                  if (patch.workflowTaskKey !== undefined) {
                    onWorkflowDraftChange('workflowTaskKey', patch.workflowTaskKey)
                  }
                  if (patch.groupKey !== undefined) {
                    onWorkflowDraftChange('groupKey', patch.groupKey)
                  }
                  if (patch.blockedByWorkflowKeys !== undefined) {
                    onWorkflowDraftChange('blockedByWorkflowKeys', patch.blockedByWorkflowKeys)
                  }
                  if (patch.blockedByJson !== undefined) {
                    onWorkflowDraftChange('childBlockedByJson', patch.blockedByJson)
                  }
                  if (patch.title !== undefined) {
                    onWorkflowDraftChange('title', patch.title)
                  }
                  if (patch.description !== undefined) {
                    onWorkflowDraftChange('description', patch.description)
                  }
                  if (patch.acceptanceCriteria !== undefined) {
                    onWorkflowDraftChange('acceptanceCriteria', patch.acceptanceCriteria)
                  }
                  if (patch.decisionRefs !== undefined) {
                    onWorkflowDraftChange('childDecisionRefs', patch.decisionRefs)
                  }
                  if (patch.answersJson !== undefined) {
                    onWorkflowDraftChange('childAnswersJson', patch.answersJson)
                  }
                  if (patch.requestedUpdates !== undefined) {
                    onWorkflowDraftChange('requestedUpdates', patch.requestedUpdates)
                  }
                }}
              />
            )}
            {!hasAdvancedWorkflowChildrenOverride && (
              <>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
                  {workflowDraft.childKind === 'planning' ? (
                    <input
                      value={workflowDraft.title}
                      onChange={(event) => onWorkflowDraftChange('title', event.target.value)}
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="Plan rollout follow-through"
                    />
                  ) : (
                    <div className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-2 text-sm text-gray-500">
                      Grouped workflow children derive request titles from the structured batch
                      requests below.
                    </div>
                  )}
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Group Key
                  </span>
                  <input
                    value={workflowDraft.groupKey}
                    onChange={(event) => onWorkflowDraftChange('groupKey', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder={
                      workflowDraft.childKind === 'planning_batch'
                        ? 'required grouped planning sink'
                        : 'optional grouped planning sink'
                    }
                  />
                  <ReusableSingleValueSuggestions
                    label="Reuse current planning group keys"
                    value={workflowDraft.groupKey}
                    onSelect={(value) => onWorkflowDraftChange('groupKey', value)}
                    suggestions={reusableWorkflowGroupKeySuggestions}
                  />
                  {workflowDraft.childKind === 'planning_batch' && (
                    <div className="text-[11px] text-gray-500">
                      `planning_batch` children need a stable group key because the backend uses it
                      as the durable grouped-request sink.
                    </div>
                  )}
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Child Decision Refs
                  </span>
                  <input
                    value={workflowDraft.childDecisionRefs}
                    onChange={(event) =>
                      onWorkflowDraftChange('childDecisionRefs', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="child-scoped refs for this child"
                  />
                  <StructuredStringListEditor
                    label="Structured child decision refs"
                    value={workflowDraft.childDecisionRefs}
                    onChange={(value) => onWorkflowDraftChange('childDecisionRefs', value)}
                    itemLabel="Decision ref"
                    addLabel="Add ref"
                    placeholder="rollout-shape"
                    emptyLabel="No structured child decision refs yet."
                    suggestions={reusableDecisionRefSuggestions}
                    suggestionSummaryLabel="Reuse current decisions"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Description
                  </span>
                  {workflowDraft.childKind === 'planning' ? (
                    <textarea
                      value={workflowDraft.description}
                      onChange={(event) => onWorkflowDraftChange('description', event.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="Describe the workflow child that should become visible planning work."
                    />
                  ) : (
                    <div className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-sm text-gray-500">
                      Grouped workflow children carry per-request descriptions inside the structured
                      batch request editor.
                    </div>
                  )}
                </label>
                {workflowDraft.childKind === 'planning' ? (
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Acceptance Criteria
                    </span>
                    <textarea
                      value={workflowDraft.acceptanceCriteria}
                      onChange={(event) =>
                        onWorkflowDraftChange('acceptanceCriteria', event.target.value)
                      }
                      rows={3}
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder={
                        'One item per line\nDesign reflects the workflow.\nTodo reflects the visible follow-through.'
                      }
                    />
                    <StructuredStringListEditor
                      label="Structured workflow acceptance criteria"
                      value={workflowDraft.acceptanceCriteria}
                      onChange={(value) => onWorkflowDraftChange('acceptanceCriteria', value)}
                      itemLabel="Criterion"
                      addLabel="Add criterion"
                      placeholder="Todo reflects the visible follow-through."
                      emptyLabel="No structured workflow acceptance criteria yet."
                    />
                  </label>
                ) : (
                  <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                    Grouped workflow children derive acceptance criteria from the structured batch
                    requests below.
                  </div>
                )}
              </>
            )}
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Shared Decision Refs
              </span>
              <input
                value={workflowDraft.sharedDecisionRefs}
                onChange={(event) =>
                  onWorkflowDraftChange('sharedDecisionRefs', event.target.value)
                }
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="comma or newline separated"
              />
              <StructuredStringListEditor
                label="Structured shared decision refs"
                value={workflowDraft.sharedDecisionRefs}
                onChange={(value) => onWorkflowDraftChange('sharedDecisionRefs', value)}
                itemLabel="Decision ref"
                addLabel="Add ref"
                placeholder="auth-strategy"
                emptyLabel="No structured shared decision refs yet."
                suggestions={reusableDecisionRefSuggestions}
                suggestionSummaryLabel="Reuse current decisions"
              />
            </label>
            {!hasAdvancedWorkflowChildrenOverride && (
              <>
                <div className="space-y-1 md:col-span-2">
                  <StructuredPlanningAnswersEditor
                    label="Structured child answers"
                    value={workflowDraft.childAnswersJson}
                    onChange={(value) => onWorkflowDraftChange('childAnswersJson', value)}
                    suggestions={reusablePlanningAnswerSuggestions}
                    answerSourceSuggestions={reusableAnswerSourceSuggestions}
                  />
                </div>
                {workflowDraft.childKind === 'planning' ? (
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Requested Updates
                    </span>
                    <input
                      value={workflowDraft.requestedUpdates}
                      onChange={(event) =>
                        onWorkflowDraftChange('requestedUpdates', event.target.value)
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="goal.md, design.md, todo.yml"
                    />
                    <StructuredStringListEditor
                      label="Structured child requested updates"
                      value={workflowDraft.requestedUpdates}
                      onChange={(value) => onWorkflowDraftChange('requestedUpdates', value)}
                      itemLabel="Update target"
                      addLabel="Add target"
                      placeholder="goal.md"
                      emptyLabel="No structured child update targets yet."
                    />
                  </label>
                ) : (
                  <div className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                    Grouped workflow children derive update targets from the structured batch
                    requests below.
                  </div>
                )}
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Blocked By Workflow Keys
                  </span>
                  <input
                    value={workflowDraft.blockedByWorkflowKeys}
                    onChange={(event) =>
                      onWorkflowDraftChange('blockedByWorkflowKeys', event.target.value)
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="comma or newline separated"
                  />
                  <StructuredStringListEditor
                    label="Structured workflow dependencies"
                    value={workflowDraft.blockedByWorkflowKeys}
                    onChange={(value) => onWorkflowDraftChange('blockedByWorkflowKeys', value)}
                    itemLabel="Workflow dependency"
                    addLabel="Add dependency"
                    placeholder="rollout-discovery"
                    emptyLabel="No structured workflow dependencies yet."
                    suggestions={reusableCurrentWorkflowDependencyKeySuggestions}
                    suggestionSummaryLabel="Reuse current workflow dependency keys"
                  />
                </label>
                {workflowDraft.childKind === 'planning' && (
                  <div className="space-y-1 md:col-span-2">
                    <StructuredBlockersEditor
                      label="Structured child blockers"
                      value={workflowDraft.childBlockedByJson}
                      onChange={(value) => onWorkflowDraftChange('childBlockedByJson', value)}
                      suggestions={reusableBlockerSuggestions}
                    />
                  </div>
                )}
              </>
            )}
            <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={workflowDraft.inferRemainingAnswers}
                  onChange={(event) =>
                    onWorkflowDraftChange('inferRemainingAnswers', event.target.checked)
                  }
                  className="h-4 w-4 rounded border-[#444] bg-[#111] text-violet-500 focus:ring-violet-500/40"
                />
                infer remaining shared planner answers
              </label>
            </div>
            <div className="space-y-1 md:col-span-2">
              <StructuredPlanningAnswersEditor
                label="Structured shared answers"
                value={workflowDraft.sharedAnswersJson}
                onChange={(value) => onWorkflowDraftChange('sharedAnswersJson', value)}
                suggestions={reusablePlanningAnswerSuggestions}
                answerSourceSuggestions={reusableAnswerSourceSuggestions}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <StructuredAnswerSourcesEditor
                label="Structured workflow answer sources"
                value={workflowDraft.answerSourcesJson}
                onChange={(value) => onWorkflowDraftChange('answerSourcesJson', value)}
                suggestions={reusableAnswerSourceSuggestions}
                routingSuggestions={workflowInterpretation.answerSourceRoutingSuggestions}
              />
            </div>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Shared Source Response
              </span>
              <textarea
                value={workflowDraft.sourceResponse}
                onChange={(event) => onWorkflowDraftChange('sourceResponse', event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Optional less-structured reply used to materialize shared workflow planner answers."
              />
            </label>
            {!hasAdvancedWorkflowChildrenOverride &&
              workflowDraft.childKind === 'planning_batch' && (
                <div className="space-y-1 md:col-span-2">
                  <StructuredBatchRequestsEditor
                    label="Structured batch requests"
                    value={workflowDraft.batchRequestsJson}
                    onChange={(value) => onWorkflowDraftChange('batchRequestsJson', value)}
                    blockerSuggestions={reusableBlockerSuggestions}
                    requestKeySuggestions={reusablePlanningRequestKeySuggestions}
                    groupedTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
                    requestSuggestions={reusableBatchRequestSuggestions}
                    groupSuggestions={reusableBatchRequestGroupSuggestions}
                    isGroupSuggestionSelected={(suggestion) =>
                      matchesReusableBatchRequestGroupSuggestionSelection(suggestion, {
                        groupKey: workflowDraft.groupKey,
                        blockedByWorkflowKeys: workflowDraft.blockedByWorkflowKeys,
                        decisionRefs: workflowDraft.childDecisionRefs,
                        answersJson: workflowDraft.childAnswersJson,
                        batchRequestsJson: workflowDraft.batchRequestsJson,
                      })
                    }
                    onReuseGroupSuggestion={(suggestion) => {
                      onWorkflowDraftChange('groupKey', suggestion.item.groupKey)
                      onWorkflowDraftChange(
                        'blockedByWorkflowKeys',
                        suggestion.item.blockedByWorkflowKeys,
                      )
                      onWorkflowDraftChange('childDecisionRefs', suggestion.item.decisionRefs)
                      onWorkflowDraftChange('childAnswersJson', suggestion.item.answersJson)
                      onWorkflowDraftChange('batchRequestsJson', suggestion.item.batchRequestsJson)
                    }}
                  />
                  <div className="text-[11px] text-gray-500">
                    Leave this empty only when root reuseGroupKey is adopting an existing grouped
                    planning sink into the workflow graph.
                  </div>
                </div>
              )}
            <div className="space-y-1 md:col-span-2">
              <StructuredWorkflowChildrenEditor
                label="Structured advanced children"
                value={workflowDraft.childrenJson}
                onChange={(value) => onWorkflowDraftChange('childrenJson', value)}
                workflowChildSuggestions={reusableWorkflowChildSuggestions}
                planningAnswerSuggestions={reusablePlanningAnswerSuggestions}
                planningRequestSuggestions={reusablePlanningRequestSuggestions}
                answerSourceSuggestions={reusableAnswerSourceSuggestions}
                decisionRefSuggestions={reusableDecisionRefSuggestions}
                blockerSuggestions={reusableBlockerSuggestions}
                planningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
                planningGroupTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
                batchRequestSuggestions={reusableBatchRequestSuggestions}
                batchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
                workflowTaskKeySuggestions={reusableCurrentWorkflowTaskKeySuggestions}
                workflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
                workflowDependencySuggestions={reusableCurrentWorkflowDependencyKeySuggestions}
              />
              <div className="text-[11px] text-gray-500">
                When this override is present it must still materialize at least one workflow child.
              </div>
            </div>
            <div className="md:col-span-2">
              <WorkflowAuthoringConstraintNotice issues={workflowAuthoringIssues} />
            </div>
          </div>
          {createResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizeWorkflowCreateMutationResult(createResult)}</div>
              {createResult.workflowKey && (
                <div className="mt-1">Workflow key: {createResult.workflowKey}</div>
              )}
              {createResult.groupKeys.length > 0 && (
                <div className="mt-1">Group keys: {createResult.groupKeys.join(', ')}</div>
              )}
              {createResult.requestKeys.length > 0 && (
                <div className="mt-1">Request keys: {createResult.requestKeys.join(', ')}</div>
              )}
              {createResult.taskRefs.length > 0 && (
                <div className="mt-1">Task refs: {createResult.taskRefs.join(', ')}</div>
              )}
              {createResult.createdRequestKeys.length > 0 && (
                <div className="mt-1">
                  Created request keys: {createResult.createdRequestKeys.join(', ')}
                </div>
              )}
              {createResult.createdTaskRefs.length > 0 && (
                <div className="mt-1">
                  Created task refs: {createResult.createdTaskRefs.join(', ')}
                </div>
              )}
              {createResult.blockerTaskRefs.length > 0 && (
                <div className="mt-1">
                  Blocker task refs: {createResult.blockerTaskRefs.join(', ')}
                </div>
              )}
              {createResult.resolvedSourceResponseFormat && (
                <div className="mt-1">
                  Resolved source-response format: {createResult.resolvedSourceResponseFormat}
                </div>
              )}
              <WorkflowCreateResultCard result={createResult} />
            </div>
          )}
          <div className="mt-2 text-[11px] text-gray-500">
            Use `workflowKey` to extend an existing durable workflow graph. Use the structured
            advanced child editor when one mutation should open multiple children.
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={createError} />
            <button
              onClick={onCreateWorkflow}
              disabled={
                createPending ||
                (!workflowDraft.childrenJson.trim() &&
                  workflowDraft.childKind === 'planning' &&
                  workflowDraft.title.trim().length === 0) ||
                (!workflowDraft.childrenJson.trim() &&
                  workflowDraft.childKind === 'planning' &&
                  parseListInput(workflowDraft.acceptanceCriteria).length === 0) ||
                !hasValidPlanningAnswersJsonOrEmpty(
                  workflowDraft.sharedAnswersJson,
                  'Workflow shared answers',
                ) ||
                workflowInterpretation.isInterpretationInvalid ||
                (!workflowDraft.childrenJson.trim() &&
                  !hasValidPlanningAnswersJsonOrEmpty(
                    workflowDraft.childAnswersJson,
                    'Workflow child answers',
                  )) ||
                (!workflowDraft.childrenJson.trim() &&
                  workflowDraft.childKind === 'planning' &&
                  !hasValidBlockersJsonOrEmpty(
                    workflowDraft.childBlockedByJson,
                    'Workflow child blockers',
                  )) ||
                (!workflowDraft.childrenJson.trim() &&
                  workflowDraft.childKind === 'planning_batch' &&
                  workflowDraft.groupKey.trim().length === 0) ||
                (!workflowDraft.childrenJson.trim() &&
                  workflowDraft.childKind === 'planning_batch' &&
                  !hasValidBatchRequestsJsonOrEmpty(workflowDraft.batchRequestsJson)) ||
                (workflowDraft.childrenJson.trim().length > 0 &&
                  !hasAtLeastOneWorkflowChild(workflowDraft.childrenJson)) ||
                workflowAuthoringIssues.length > 0 ||
                (workflowDraft.inferRemainingAnswers &&
                  (!formatSupportsInferRemainingAnswers(workflowDraft.sourceResponseFormat) ||
                    !hasInterpretationInputForSelectedFormat(
                      workflowDraft.sourceResponseFormat,
                      normalizeOptionalString(workflowDraft.sourceResponse),
                      workflowDraft.answerSourcesJson.trim()
                        ? parseAnswerSourcesJson(
                            workflowDraft.answerSourcesJson,
                            'Workflow answer sources',
                          )
                        : undefined,
                    )))
              }
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createPending ? 'Opening...' : 'Open Workflow Batch'}
            </button>
          </div>
        </div>

        {workflows.length === 0 ? (
          <SurfaceEmptyState label="No workflow batches yet." />
        ) : (
          <div className="space-y-3">
            {workflows.map((workflow) => (
              <WorkflowSummaryCard
                key={workflow.workflowKey}
                workflow={workflow}
                selectedWorkflowKey={selectedWorkflowKey}
                onSelectWorkflow={onSelectWorkflow}
                onPrefillWorkflowKey={onPrefillWorkflowKey}
                onPrefillReuseTaskRef={onPrefillReuseTaskRef}
                onPrefillReuseGroupKey={onPrefillReuseGroupKey}
              />
            ))}

            {workflowDetailError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-200">
                {workflowDetailError.message}
              </div>
            )}

            {workflowDetailLoading && selectedWorkflowKey && (
              <div className="rounded-xl border border-[#303030] bg-[#191919] px-4 py-3 text-xs text-gray-400">
                Loading workflow detail for <span className="font-mono">{selectedWorkflowKey}</span>
                ...
              </div>
            )}

            {selectedWorkflow && (
              <WorkflowDetailPanel workflow={selectedWorkflow} tasksByRef={tasksByRef} />
            )}
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}
