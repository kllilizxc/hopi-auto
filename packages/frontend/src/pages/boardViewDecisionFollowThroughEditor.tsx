import {
  buildDecisionPlanningFollowThroughPatchFromPlanningRequestSuggestion,
  buildDecisionWorkflowChildPatchFromPlanningRequestSuggestion,
  buildDecisionWorkflowFollowThroughPatchFromWorkflowChildSuggestion,
  buildDecisionWorkflowFollowThroughPatchFromWorkflowContextSuggestion,
  buildDecisionWorkflowFollowThroughPatchFromWorkflowGraphSuggestion,
  buildValidTaskBlockerRefSetFromSuggestions,
  matchesReusableBatchRequestGroupSuggestionSelection,
  ReusableDecisionWorkflowChildSuggestionList,
  ReusablePlanningRequestSuggestionList,
  ReusableSingleValueSuggestions,
  ReusableWorkflowContextSuggestionList,
  ReusableWorkflowGraphSuggestionList,
  StructuredBatchRequestsEditor,
  StructuredDecisionWorkflowChildrenEditor,
  StructuredPlanningAnswersEditor,
  StructuredStringListEditor,
} from './boardViewStructuredEditors'
import type {
  DecisionFollowThroughDraft,
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
import {
  buildReusableWorkflowDependencyKeySuggestions,
  buildReusableWorkflowTaskKeySuggestions,
} from './boardViewReusableSuggestions'
import { WorkflowAuthoringConstraintNotice } from './boardViewInterpretationNoticeSupport'
import { listDecisionWorkflowChildDependencyIssues } from './boardViewWorkflowDependencySupport'

export function DecisionFollowThroughEditor({
  draft,
  onChange,
  supportsInferRemainingAnswers = false,
  reusablePlanningAnswerSuggestions = [],
  reusablePlanningRequestSuggestions = [],
  reusableAnswerSourceSuggestions = [],
  reusableBlockerSuggestions = [],
  reusablePlanningRequestKeySuggestions = [],
  reusablePlanningGroupKeySuggestions = [],
  reusablePlanningGroupTaskKeySuggestions = [],
  reusableBatchRequestSuggestions = [],
  reusableBatchRequestGroupSuggestions = [],
  reusableWorkflowKeySuggestions = [],
  reusableWorkflowContextSuggestions = [],
  reusableWorkflowGraphSuggestions = [],
  reusableDecisionWorkflowChildSuggestions = [],
  reusableWorkflowTaskRefSuggestions = [],
  reusableWorkflowGroupKeySuggestions = [],
}: {
  draft: DecisionFollowThroughDraft
  onChange: (field: keyof DecisionFollowThroughDraft, value: string | boolean) => void
  supportsInferRemainingAnswers?: boolean
  reusablePlanningAnswerSuggestions?: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions?: ReusablePlanningRequestSuggestion[]
  reusableAnswerSourceSuggestions?: ReusableAnswerSourceSuggestion[]
  reusableBlockerSuggestions?: ReusableBlockerSuggestion[]
  reusablePlanningRequestKeySuggestions?: ReusableStringSuggestion[]
  reusablePlanningGroupKeySuggestions?: ReusableStringSuggestion[]
  reusablePlanningGroupTaskKeySuggestions?: ReusableStringSuggestion[]
  reusableBatchRequestSuggestions?: ReusableBatchRequestSuggestion[]
  reusableBatchRequestGroupSuggestions?: ReusableBatchRequestGroupSuggestion[]
  reusableWorkflowKeySuggestions?: ReusableStringSuggestion[]
  reusableWorkflowContextSuggestions?: ReusableWorkflowContextSuggestion[]
  reusableWorkflowGraphSuggestions?: ReusableWorkflowGraphSuggestion[]
  reusableDecisionWorkflowChildSuggestions?: ReusableDecisionWorkflowChildSuggestion[]
  reusableWorkflowTaskRefSuggestions?: ReusableStringSuggestion[]
  reusableWorkflowGroupKeySuggestions?: ReusableStringSuggestion[]
}) {
  const hasAdvancedWorkflowChildrenOverride = draft.workflowChildrenJson.trim().length > 0
  const validTaskBlockerRefs = buildValidTaskBlockerRefSetFromSuggestions(
    reusableBlockerSuggestions,
  )
  const reusableCurrentWorkflowTaskKeySuggestions = buildReusableWorkflowTaskKeySuggestions(
    reusableWorkflowGraphSuggestions,
    draft.workflowKey,
  )
  const reusableCurrentWorkflowDependencyKeySuggestions =
    buildReusableWorkflowDependencyKeySuggestions(
      reusableWorkflowGraphSuggestions,
      draft.workflowKey,
    )
  const workflowAuthoringIssues = listDecisionWorkflowChildDependencyIssues(
    draft,
    reusableWorkflowGraphSuggestions,
    reusableWorkflowTaskRefSuggestions,
    reusableWorkflowGroupKeySuggestions,
    validTaskBlockerRefs,
  )

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Follow-through</span>
          <select
            value={draft.kind}
            onChange={(event) => onChange('kind', event.target.value)}
            className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
          >
            <option value="none">none</option>
            <option value="planning">planning</option>
            <option value="planning_batch">planning_batch</option>
            <option value="workflow_batch">workflow_batch</option>
          </select>
        </label>
      </div>

      {draft.kind === 'planning' && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {supportsInferRemainingAnswers && (
            <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={draft.inferRemainingAnswers}
                  onChange={(event) => onChange('inferRemainingAnswers', event.target.checked)}
                  className="h-4 w-4 rounded border-[#444] bg-[#111] text-purple-500 focus:ring-purple-500/40"
                />
                infer remaining planner answers
              </label>
            </div>
          )}
          <ReusablePlanningRequestSuggestionList
            suggestions={reusablePlanningRequestSuggestions}
            onSelect={(suggestion) => {
              const patch =
                buildDecisionPlanningFollowThroughPatchFromPlanningRequestSuggestion(suggestion)

              if (patch.title !== undefined) {
                onChange('title', patch.title)
              }
              if (patch.description !== undefined) {
                onChange('description', patch.description)
              }
              if (patch.acceptanceCriteria !== undefined) {
                onChange('acceptanceCriteria', patch.acceptanceCriteria)
              }
              if (patch.answersJson !== undefined) {
                onChange('answersJson', patch.answersJson)
              }
              if (patch.requestedUpdates !== undefined) {
                onChange('requestedUpdates', patch.requestedUpdates)
              }
            }}
          />
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
            <input
              value={draft.title}
              onChange={(event) => onChange('title', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="Plan the follow-through"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              Requested Updates
            </span>
            <input
              value={draft.requestedUpdates}
              onChange={(event) => onChange('requestedUpdates', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="design.md, todo.yml"
            />
            <StructuredStringListEditor
              label="Structured requested updates"
              value={draft.requestedUpdates}
              onChange={(value) => onChange('requestedUpdates', value)}
              itemLabel="Update target"
              addLabel="Add target"
              placeholder="design.md"
              emptyLabel="No structured update targets yet."
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => onChange('description', event.target.value)}
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
              value={draft.acceptanceCriteria}
              onChange={(event) => onChange('acceptanceCriteria', event.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder={'One item per line\nDesign updated\nTodo updated'}
            />
            <StructuredStringListEditor
              label="Structured follow-through acceptance criteria"
              value={draft.acceptanceCriteria}
              onChange={(value) => onChange('acceptanceCriteria', value)}
              itemLabel="Criterion"
              addLabel="Add criterion"
              placeholder="Todo updated"
              emptyLabel="No structured follow-through acceptance criteria yet."
            />
          </label>
          <div className="space-y-1 md:col-span-2">
            <StructuredPlanningAnswersEditor
              label="Structured follow-through answers"
              value={draft.answersJson}
              onChange={(value) => onChange('answersJson', value)}
              suggestions={reusablePlanningAnswerSuggestions}
              answerSourceSuggestions={reusableAnswerSourceSuggestions}
            />
          </div>
        </div>
      )}

      {draft.kind === 'planning_batch' && (
        <div className="mt-3 grid gap-3">
          {supportsInferRemainingAnswers && (
            <div className="flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={draft.inferRemainingAnswers}
                  onChange={(event) => onChange('inferRemainingAnswers', event.target.checked)}
                  className="h-4 w-4 rounded border-[#444] bg-[#111] text-purple-500 focus:ring-purple-500/40"
                />
                infer remaining planner answers
              </label>
            </div>
          )}
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Group Key</span>
            <input
              value={draft.groupKey}
              onChange={(event) => onChange('groupKey', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="auth-rollout"
            />
            <ReusableSingleValueSuggestions
              label="Reuse current planning group keys"
              value={draft.groupKey}
              onSelect={(value) => onChange('groupKey', value)}
              suggestions={reusablePlanningGroupKeySuggestions}
            />
          </label>
          <div className="space-y-1">
            <StructuredBatchRequestsEditor
              label="Structured batch requests"
              value={draft.batchRequestsJson}
              onChange={(value) => onChange('batchRequestsJson', value)}
              blockerSuggestions={reusableBlockerSuggestions}
              requestKeySuggestions={reusablePlanningRequestKeySuggestions}
              groupedTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
              requestSuggestions={reusableBatchRequestSuggestions}
              groupSuggestions={reusableBatchRequestGroupSuggestions}
              isGroupSuggestionSelected={(suggestion) =>
                matchesReusableBatchRequestGroupSuggestionSelection(suggestion, {
                  groupKey: draft.groupKey,
                  answersJson: draft.answersJson,
                  batchRequestsJson: draft.batchRequestsJson,
                })
              }
              onReuseGroupSuggestion={(suggestion) => {
                onChange('groupKey', suggestion.item.groupKey)
                onChange('answersJson', suggestion.item.answersJson)
                onChange('batchRequestsJson', suggestion.item.batchRequestsJson)
              }}
            />
            <div className="text-[11px] text-gray-500">
              Answer-driven `planning_batch` follow-through needs at least one grouped request.
            </div>
          </div>
          <div className="space-y-1">
            <StructuredPlanningAnswersEditor
              label="Structured follow-through answers"
              value={draft.answersJson}
              onChange={(value) => onChange('answersJson', value)}
              suggestions={reusablePlanningAnswerSuggestions}
              answerSourceSuggestions={reusableAnswerSourceSuggestions}
            />
          </div>
        </div>
      )}

      {draft.kind === 'workflow_batch' && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {supportsInferRemainingAnswers && (
            <div className="md:col-span-2 flex flex-wrap gap-4 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={draft.inferRemainingAnswers}
                  onChange={(event) => onChange('inferRemainingAnswers', event.target.checked)}
                  className="h-4 w-4 rounded border-[#444] bg-[#111] text-purple-500 focus:ring-purple-500/40"
                />
                infer remaining planner answers
              </label>
            </div>
          )}
          <ReusableWorkflowContextSuggestionList
            suggestions={reusableWorkflowContextSuggestions}
            onSelect={(suggestion) => {
              const patch =
                buildDecisionWorkflowFollowThroughPatchFromWorkflowContextSuggestion(suggestion)
              for (const [field, value] of Object.entries(patch)) {
                if (value !== undefined) {
                  onChange(field as keyof DecisionFollowThroughDraft, value)
                }
              }
            }}
          />
          <ReusableWorkflowGraphSuggestionList
            suggestions={reusableWorkflowGraphSuggestions}
            onSelect={(suggestion) => {
              const patch =
                buildDecisionWorkflowFollowThroughPatchFromWorkflowGraphSuggestion(suggestion)
              for (const [field, value] of Object.entries(patch)) {
                if (value !== undefined) {
                  onChange(field as keyof DecisionFollowThroughDraft, value)
                }
              }
            }}
          />
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">Workflow Key</span>
            <input
              value={draft.workflowKey}
              onChange={(event) => onChange('workflowKey', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="optional stable workflow key"
            />
            <ReusableSingleValueSuggestions
              label="Reuse current workflow keys"
              value={draft.workflowKey}
              onSelect={(value) => onChange('workflowKey', value)}
              suggestions={reusableWorkflowKeySuggestions}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              Reuse Task Ref
            </span>
            <input
              value={draft.reuseTaskRef}
              onChange={(event) => onChange('reuseTaskRef', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="optional current planning task"
            />
            <ReusableSingleValueSuggestions
              label="Reuse current planning task refs"
              value={draft.reuseTaskRef}
              onSelect={(value) => onChange('reuseTaskRef', value)}
              suggestions={reusableWorkflowTaskRefSuggestions}
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-gray-500">
              Reuse Group Key
            </span>
            <input
              value={draft.reuseGroupKey}
              onChange={(event) => onChange('reuseGroupKey', event.target.value)}
              className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              placeholder="optional current planning group"
            />
            <ReusableSingleValueSuggestions
              label="Reuse current planning group keys"
              value={draft.reuseGroupKey}
              onSelect={(value) => onChange('reuseGroupKey', value)}
              suggestions={reusableWorkflowGroupKeySuggestions}
            />
          </label>
          <div className="space-y-1 md:col-span-2">
            <StructuredPlanningAnswersEditor
              label="Structured workflow root answers"
              value={draft.workflowAnswersJson}
              onChange={(value) => onChange('workflowAnswersJson', value)}
              suggestions={reusablePlanningAnswerSuggestions}
              answerSourceSuggestions={reusableAnswerSourceSuggestions}
            />
          </div>
          {hasAdvancedWorkflowChildrenOverride ? (
            <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
              Structured workflow children are active, so the simple workflow-child draft fields
              stay inactive until you clear the advanced child override below.
            </div>
          ) : (
            <>
              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                  Child Kind
                </span>
                <select
                  value={draft.workflowChildKind}
                  onChange={(event) => onChange('workflowChildKind', event.target.value)}
                  className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                >
                  <option value="planning">planning</option>
                  <option value="planning_batch">planning_batch</option>
                </select>
              </label>
              <div className="md:col-span-2">
                <ReusableDecisionWorkflowChildSuggestionList
                  suggestions={reusableDecisionWorkflowChildSuggestions}
                  onSelect={(suggestion) => {
                    const patch =
                      buildDecisionWorkflowFollowThroughPatchFromWorkflowChildSuggestion(suggestion)
                    for (const [field, value] of Object.entries(patch)) {
                      if (value !== undefined) {
                        onChange(field as keyof DecisionFollowThroughDraft, value)
                      }
                    }
                  }}
                />
              </div>
              {draft.workflowChildKind === 'planning' && (
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Workflow Task Key
                  </span>
                  <input
                    value={draft.workflowTaskKey}
                    onChange={(event) => onChange('workflowTaskKey', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional child key"
                  />
                  <ReusableSingleValueSuggestions
                    label="Reuse current workflow child keys"
                    value={draft.workflowTaskKey}
                    onSelect={(value) => onChange('workflowTaskKey', value)}
                    suggestions={reusableCurrentWorkflowTaskKeySuggestions}
                  />
                </label>
              )}
              {draft.workflowChildKind === 'planning' && (
                <ReusablePlanningRequestSuggestionList
                  suggestions={reusablePlanningRequestSuggestions}
                  onSelect={(suggestion) => {
                    const patch =
                      buildDecisionWorkflowChildPatchFromPlanningRequestSuggestion(suggestion)
                    if (patch.workflowTaskKey !== undefined) {
                      onChange('workflowTaskKey', patch.workflowTaskKey)
                    }
                    if (patch.groupKey !== undefined) {
                      onChange('groupKey', patch.groupKey)
                    }
                    if (patch.blockedByWorkflowKeys !== undefined) {
                      onChange('blockedByWorkflowKeys', patch.blockedByWorkflowKeys)
                    }
                    if (patch.title !== undefined) {
                      onChange('title', patch.title)
                    }
                    if (patch.description !== undefined) {
                      onChange('description', patch.description)
                    }
                    if (patch.acceptanceCriteria !== undefined) {
                      onChange('acceptanceCriteria', patch.acceptanceCriteria)
                    }
                    if (patch.answersJson !== undefined) {
                      onChange('answersJson', patch.answersJson)
                    }
                    if (patch.requestedUpdates !== undefined) {
                      onChange('requestedUpdates', patch.requestedUpdates)
                    }
                  }}
                />
              )}
              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
                {draft.workflowChildKind === 'planning' ? (
                  <input
                    value={draft.title}
                    onChange={(event) => onChange('title', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Plan rollout follow-through"
                  />
                ) : (
                  <div className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-2 text-sm text-gray-500">
                    Grouped answer-driven workflow children derive request titles from the
                    structured batch requests below.
                  </div>
                )}
              </label>
              {draft.workflowChildKind === 'planning_batch' && (
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Group Key
                  </span>
                  <input
                    value={draft.groupKey}
                    onChange={(event) => onChange('groupKey', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="required grouped planning sink"
                  />
                  <ReusableSingleValueSuggestions
                    label="Reuse current planning group keys"
                    value={draft.groupKey}
                    onSelect={(value) => onChange('groupKey', value)}
                    suggestions={reusableWorkflowGroupKeySuggestions}
                  />
                  <div className="text-[11px] text-gray-500">
                    `planning_batch` children need a stable group key because the backend uses it as
                    the durable grouped-request sink.
                  </div>
                </label>
              )}
              {draft.workflowChildKind === 'planning' ? (
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Description
                  </span>
                  <textarea
                    value={draft.description}
                    onChange={(event) => onChange('description', event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Describe the workflow child follow-through."
                  />
                </label>
              ) : (
                <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                  Grouped answer-driven workflow children derive request descriptions from the
                  structured batch requests below.
                </div>
              )}
              {draft.workflowChildKind === 'planning' ? (
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Acceptance Criteria
                  </span>
                  <textarea
                    value={draft.acceptanceCriteria}
                    onChange={(event) => onChange('acceptanceCriteria', event.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder={'One item per line\nDesign updated\nTodo updated'}
                  />
                  <StructuredStringListEditor
                    label="Structured workflow child acceptance criteria"
                    value={draft.acceptanceCriteria}
                    onChange={(value) => onChange('acceptanceCriteria', value)}
                    itemLabel="Criterion"
                    addLabel="Add criterion"
                    placeholder="Todo updated"
                    emptyLabel="No structured workflow child acceptance criteria yet."
                  />
                </label>
              ) : (
                <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                  Grouped answer-driven workflow children derive acceptance criteria from the
                  structured batch requests below.
                </div>
              )}
              {draft.workflowChildKind === 'planning' ? (
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Requested Updates
                  </span>
                  <input
                    value={draft.requestedUpdates}
                    onChange={(event) => onChange('requestedUpdates', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="goal.md, design.md, todo.yml"
                  />
                  <StructuredStringListEditor
                    label="Structured workflow child requested updates"
                    value={draft.requestedUpdates}
                    onChange={(value) => onChange('requestedUpdates', value)}
                    itemLabel="Update target"
                    addLabel="Add target"
                    placeholder="goal.md"
                    emptyLabel="No structured workflow child update targets yet."
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                  Grouped answer-driven workflow children derive update targets from the structured
                  batch requests below.
                </div>
              )}
              <label className="space-y-1 md:col-span-2">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                  Blocked By Workflow Keys
                </span>
                <input
                  value={draft.blockedByWorkflowKeys}
                  onChange={(event) => onChange('blockedByWorkflowKeys', event.target.value)}
                  className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  placeholder="comma or newline separated"
                />
                <StructuredStringListEditor
                  label="Structured workflow child dependencies"
                  value={draft.blockedByWorkflowKeys}
                  onChange={(value) => onChange('blockedByWorkflowKeys', value)}
                  itemLabel="Workflow dependency"
                  addLabel="Add dependency"
                  placeholder="rollout-discovery"
                  emptyLabel="No structured workflow child dependencies yet."
                  suggestions={reusableCurrentWorkflowDependencyKeySuggestions}
                  suggestionSummaryLabel="Reuse current workflow dependency keys"
                />
              </label>
              <div className="space-y-1 md:col-span-2">
                <StructuredPlanningAnswersEditor
                  label="Structured child answers"
                  value={draft.answersJson}
                  onChange={(value) => onChange('answersJson', value)}
                  suggestions={reusablePlanningAnswerSuggestions}
                  answerSourceSuggestions={reusableAnswerSourceSuggestions}
                />
              </div>
              {draft.workflowChildKind === 'planning_batch' && (
                <div className="space-y-1 md:col-span-2">
                  <StructuredBatchRequestsEditor
                    label="Structured batch requests"
                    value={draft.batchRequestsJson}
                    onChange={(value) => onChange('batchRequestsJson', value)}
                    blockerSuggestions={reusableBlockerSuggestions}
                    requestKeySuggestions={reusablePlanningRequestKeySuggestions}
                    groupedTaskKeySuggestions={reusablePlanningGroupTaskKeySuggestions}
                    requestSuggestions={reusableBatchRequestSuggestions}
                    groupSuggestions={reusableBatchRequestGroupSuggestions}
                    isGroupSuggestionSelected={(suggestion) =>
                      matchesReusableBatchRequestGroupSuggestionSelection(suggestion, {
                        groupKey: draft.groupKey,
                        blockedByWorkflowKeys: draft.blockedByWorkflowKeys,
                        answersJson: draft.answersJson,
                        batchRequestsJson: draft.batchRequestsJson,
                      })
                    }
                    onReuseGroupSuggestion={(suggestion) => {
                      onChange('groupKey', suggestion.item.groupKey)
                      onChange('blockedByWorkflowKeys', suggestion.item.blockedByWorkflowKeys)
                      onChange('answersJson', suggestion.item.answersJson)
                      onChange('batchRequestsJson', suggestion.item.batchRequestsJson)
                    }}
                  />
                  <div className="text-[11px] text-gray-500">
                    Leave this empty only when root reuseGroupKey is adopting an existing grouped
                    planning sink inside the answer-driven workflow follow-through.
                  </div>
                </div>
              )}
            </>
          )}
          <div className="space-y-1 md:col-span-2">
            <StructuredDecisionWorkflowChildrenEditor
              label="Structured workflow children"
              value={draft.workflowChildrenJson}
              onChange={(value) => onChange('workflowChildrenJson', value)}
              workflowChildSuggestions={reusableDecisionWorkflowChildSuggestions}
              planningAnswerSuggestions={reusablePlanningAnswerSuggestions}
              planningRequestSuggestions={reusablePlanningRequestSuggestions}
              answerSourceSuggestions={reusableAnswerSourceSuggestions}
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
      )}
    </div>
  )
}
