import { Plus, Trash2 } from 'lucide-react'
import {
  createEmptyWorkflowChildEditorItem,
  parseWorkflowChildEditorItems,
  serializeWorkflowChildEditorItems,
  updateWorkflowChildEditorItem,
} from './boardViewStructuredEditorCodec'
import {
  buildDraftWorkflowDependencySuggestions,
  mergeReusableStringSuggestionsByValue,
} from './boardViewStructuredEditorSuggestionSupport'
import { buildWorkflowChildPatchFromPlanningRequestSuggestion } from './boardViewStructuredEditorPatchBuilders'
import {
  appendUniqueWorkflowChildEditorItems,
  buildWorkflowChildEditorSuggestionIdentity,
  matchesReusableBatchRequestGroupSuggestionSelection,
} from './boardViewStructuredEditorSetupSupport'
import {
  ReusablePlanningRequestSuggestionList,
  ReusableSingleValueSuggestions,
  ReusableWorkflowChildSuggestionList,
  StructuredBlockersEditor,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import { StructuredBatchRequestsEditor } from './boardViewStructuredBatchRequestsEditor'
import { StructuredPlanningAnswersEditor } from './boardViewStructuredPlanningAnswersEditor'
import type {
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
  ReusableWorkflowChildSuggestion,
  WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'

export function StructuredWorkflowChildrenEditor({
  label,
  value,
  onChange,
  workflowChildSuggestions = [],
  planningAnswerSuggestions = [],
  planningRequestSuggestions = [],
  answerSourceSuggestions = [],
  decisionRefSuggestions = [],
  blockerSuggestions = [],
  planningRequestKeySuggestions = [],
  planningGroupTaskKeySuggestions = [],
  batchRequestSuggestions = [],
  batchRequestGroupSuggestions = [],
  workflowTaskKeySuggestions = [],
  workflowGroupKeySuggestions = [],
  workflowDependencySuggestions = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  workflowChildSuggestions?: ReusableWorkflowChildSuggestion[]
  planningAnswerSuggestions?: ReusablePlanningAnswerSuggestion[]
  planningRequestSuggestions?: ReusablePlanningRequestSuggestion[]
  answerSourceSuggestions?: ReusableAnswerSourceSuggestion[]
  decisionRefSuggestions?: ReusableStringSuggestion[]
  blockerSuggestions?: ReusableBlockerSuggestion[]
  planningRequestKeySuggestions?: ReusableStringSuggestion[]
  planningGroupTaskKeySuggestions?: ReusableStringSuggestion[]
  batchRequestSuggestions?: ReusableBatchRequestSuggestion[]
  batchRequestGroupSuggestions?: ReusableBatchRequestGroupSuggestion[]
  workflowTaskKeySuggestions?: ReusableStringSuggestion[]
  workflowGroupKeySuggestions?: ReusableStringSuggestion[]
  workflowDependencySuggestions?: ReusableStringSuggestion[]
}) {
  const { items, error } = parseWorkflowChildEditorItems(value)
  const existingWorkflowChildIdentities = new Set(
    items
      .map((item) => buildWorkflowChildEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )
  const hasReusableWorkflowChildSuggestions = workflowChildSuggestions.some((suggestion) => {
    const identity = buildWorkflowChildEditorSuggestionIdentity(suggestion.item)
    return identity !== null && !existingWorkflowChildIdentities.has(identity)
  })

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Author advanced workflow children in structured fields instead of one raw JSON blob.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializeWorkflowChildEditorItems([...items, createEmptyWorkflowChildEditorItem()]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add child
        </button>
      </div>

      <ReusableWorkflowChildSuggestionList
        suggestions={workflowChildSuggestions}
        onSelect={(suggestion) =>
          onChange(serializeWorkflowChildEditorItems([...items, suggestion.item]))
        }
        onSelectAll={() =>
          onChange(
            serializeWorkflowChildEditorItems(
              appendUniqueWorkflowChildEditorItems(
                items,
                workflowChildSuggestions.map((suggestion) => suggestion.item),
              ),
            ),
          )
        }
        disableSelectAll={!hasReusableWorkflowChildSuggestions || error !== null}
      />

      {error ? (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs text-red-200">
          <div>{error}</div>
          <button
            type="button"
            onClick={() => onChange('[]')}
            className="mt-2 rounded-lg border border-red-400/30 bg-transparent px-2 py-1 text-[11px] font-medium text-red-100 transition hover:border-red-300/50"
          >
            Reset to empty list
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#313131] bg-[#111] px-3 py-4 text-xs text-gray-500">
          No structured workflow children yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => {
            const workflowDependencySuggestionsForItem = mergeReusableStringSuggestionsByValue(
              buildDraftWorkflowDependencySuggestions(items, index),
              workflowDependencySuggestions,
            )

            return (
              <div
                key={`${label}:workflow-child:${index}`}
                className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-gray-300">
                    Workflow child {index + 1}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        serializeWorkflowChildEditorItems(
                          items.filter((_, itemIndex) => itemIndex !== index),
                        ),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-[#343434] bg-[#161616] px-2 py-1 text-[11px] font-medium text-gray-300 transition hover:border-red-500/40 hover:text-red-200"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">Kind</span>
                    <select
                      value={item.kind}
                      onChange={(event) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              kind: event.target.value as WorkflowChildEditorItem['kind'],
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    >
                      <option value="planning">planning</option>
                      <option value="planning_batch">planning_batch</option>
                    </select>
                  </label>
                  {item.kind === 'planning' && (
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Workflow Task Key
                      </span>
                      <input
                        value={item.workflowTaskKey}
                        onChange={(event) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                workflowTaskKey: event.target.value,
                              }),
                            ),
                          )
                        }
                        className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                        placeholder="optional child key"
                      />
                      <ReusableSingleValueSuggestions
                        label="Reuse current workflow child keys"
                        value={item.workflowTaskKey}
                        onSelect={(value) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                workflowTaskKey: value,
                              }),
                            ),
                          )
                        }
                        suggestions={workflowTaskKeySuggestions}
                      />
                    </label>
                  )}
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Group Key
                    </span>
                    <input
                      value={item.groupKey}
                      onChange={(event) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              groupKey: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional grouped sink"
                    />
                    <ReusableSingleValueSuggestions
                      label="Reuse current planning group keys"
                      value={item.groupKey}
                      onSelect={(value) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              groupKey: value,
                            }),
                          ),
                        )
                      }
                      suggestions={workflowGroupKeySuggestions}
                    />
                  </label>
                  {item.kind === 'planning' && (
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Request Key
                      </span>
                      <input
                        value={item.requestKey}
                        onChange={(event) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                requestKey: event.target.value,
                              }),
                            ),
                          )
                        }
                        className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                        placeholder="optional"
                      />
                      <ReusableSingleValueSuggestions
                        label="Reuse current planning request keys"
                        value={item.requestKey}
                        onSelect={(value) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                requestKey: value,
                              }),
                            ),
                          )
                        }
                        suggestions={planningRequestKeySuggestions}
                      />
                    </label>
                  )}
                  {item.kind === 'planning' && (
                    <ReusablePlanningRequestSuggestionList
                      suggestions={planningRequestSuggestions}
                      onSelect={(suggestion) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              ...buildWorkflowChildPatchFromPlanningRequestSuggestion(suggestion),
                            }),
                          ),
                        )
                      }
                    />
                  )}
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Blocked By Workflow Keys
                    </span>
                    <input
                      value={item.blockedByWorkflowKeys}
                      onChange={(event) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              blockedByWorkflowKeys: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured workflow child dependencies"
                      value={item.blockedByWorkflowKeys}
                      onChange={(value) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              blockedByWorkflowKeys: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Workflow dependency"
                      addLabel="Add dependency"
                      placeholder="rollout-discovery"
                      emptyLabel="No structured workflow child dependencies yet."
                      suggestions={workflowDependencySuggestionsForItem}
                      suggestionSummaryLabel="Reuse current workflow dependency keys"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Decision Refs
                    </span>
                    <input
                      value={item.decisionRefs}
                      onChange={(event) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              decisionRefs: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured workflow child decision refs"
                      value={item.decisionRefs}
                      onChange={(value) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              decisionRefs: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Decision ref"
                      addLabel="Add ref"
                      placeholder="auth-strategy"
                      emptyLabel="No structured workflow child decision refs yet."
                      suggestions={decisionRefSuggestions}
                      suggestionSummaryLabel="Reuse current decisions"
                    />
                  </label>
                  {item.kind === 'planning' ? (
                    <>
                      <div className="space-y-1 md:col-span-2">
                        <StructuredBlockersEditor
                          label="Structured workflow child blockers"
                          value={item.blockedByJson}
                          onChange={(value) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  blockedByJson: value,
                                }),
                              ),
                            )
                          }
                          suggestions={blockerSuggestions}
                        />
                      </div>
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Title
                        </span>
                        <input
                          value={item.title}
                          onChange={(event) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  title: event.target.value,
                                }),
                              ),
                            )
                          }
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder="Plan rollout follow-through"
                        />
                      </label>
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Description
                        </span>
                        <textarea
                          value={item.description}
                          onChange={(event) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  description: event.target.value,
                                }),
                              ),
                            )
                          }
                          rows={2}
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder="Describe the workflow child."
                        />
                      </label>
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Acceptance Criteria
                        </span>
                        <textarea
                          value={item.acceptanceCriteria}
                          onChange={(event) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  acceptanceCriteria: event.target.value,
                                }),
                              ),
                            )
                          }
                          rows={3}
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder={'One item per line\nDesign updated'}
                        />
                        <StructuredStringListEditor
                          label="Structured workflow child acceptance criteria"
                          value={item.acceptanceCriteria}
                          onChange={(value) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  acceptanceCriteria: value,
                                }),
                              ),
                            )
                          }
                          itemLabel="Criterion"
                          addLabel="Add criterion"
                          placeholder="Design updated"
                          emptyLabel="No structured workflow child acceptance criteria yet."
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Requested Updates
                        </span>
                        <input
                          value={item.requestedUpdates}
                          onChange={(event) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  requestedUpdates: event.target.value,
                                }),
                              ),
                            )
                          }
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder="goal.md, design.md, todo.yml"
                        />
                        <StructuredStringListEditor
                          label="Structured workflow child update targets"
                          value={item.requestedUpdates}
                          onChange={(value) =>
                            onChange(
                              serializeWorkflowChildEditorItems(
                                updateWorkflowChildEditorItem(items, index, {
                                  requestedUpdates: value,
                                }),
                              ),
                            )
                          }
                          itemLabel="Update target"
                          addLabel="Add target"
                          placeholder="goal.md"
                          emptyLabel="No structured workflow child update targets yet."
                        />
                      </label>
                    </>
                  ) : (
                    <div className="md:col-span-2 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3 text-[11px] text-gray-500">
                      Batch children use grouped requests instead of title/description/acceptance
                      fields.
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <StructuredPlanningAnswersEditor
                      label="Structured child answers"
                      value={item.answersJson}
                      onChange={(value) =>
                        onChange(
                          serializeWorkflowChildEditorItems(
                            updateWorkflowChildEditorItem(items, index, {
                              answersJson: value,
                            }),
                          ),
                        )
                      }
                      suggestions={planningAnswerSuggestions}
                      answerSourceSuggestions={answerSourceSuggestions}
                    />
                  </div>
                  {item.kind === 'planning_batch' && (
                    <div className="md:col-span-2">
                      <StructuredBatchRequestsEditor
                        label="Structured child batch requests"
                        value={item.batchRequestsJson}
                        onChange={(value) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                batchRequestsJson: value,
                              }),
                            ),
                          )
                        }
                        blockerSuggestions={blockerSuggestions}
                        requestKeySuggestions={planningRequestKeySuggestions}
                        groupedTaskKeySuggestions={planningGroupTaskKeySuggestions}
                        requestSuggestions={batchRequestSuggestions}
                        groupSuggestions={batchRequestGroupSuggestions}
                        isGroupSuggestionSelected={(suggestion) =>
                          matchesReusableBatchRequestGroupSuggestionSelection(suggestion, {
                            groupKey: item.groupKey,
                            blockedByWorkflowKeys: item.blockedByWorkflowKeys,
                            decisionRefs: item.decisionRefs,
                            answersJson: item.answersJson,
                            batchRequestsJson: item.batchRequestsJson,
                          })
                        }
                        onReuseGroupSuggestion={(suggestion) =>
                          onChange(
                            serializeWorkflowChildEditorItems(
                              updateWorkflowChildEditorItem(items, index, {
                                groupKey: suggestion.item.groupKey,
                                blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
                                decisionRefs: suggestion.item.decisionRefs,
                                answersJson: suggestion.item.answersJson,
                                batchRequestsJson: suggestion.item.batchRequestsJson,
                              }),
                            ),
                          )
                        }
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
