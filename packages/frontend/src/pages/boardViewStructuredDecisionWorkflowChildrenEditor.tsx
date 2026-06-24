import { Plus, Trash2 } from 'lucide-react'
import {
  createEmptyDecisionWorkflowChildEditorItem,
  parseDecisionWorkflowChildEditorItems,
  serializeDecisionWorkflowChildEditorItems,
  updateDecisionWorkflowChildEditorItem,
} from './boardViewStructuredEditorCodec'
import {
  buildDraftDecisionWorkflowDependencySuggestions,
  mergeReusableStringSuggestionsByValue,
} from './boardViewStructuredEditorSuggestionSupport'
import { buildDecisionWorkflowChildPatchFromPlanningRequestSuggestion } from './boardViewStructuredEditorPatchBuilders'
import {
  appendUniqueDecisionWorkflowChildEditorItems,
  buildDecisionWorkflowChildEditorSuggestionIdentity,
  matchesReusableBatchRequestGroupSuggestionSelection,
} from './boardViewStructuredEditorSetupSupport'
import {
  ReusableDecisionWorkflowChildSuggestionList,
  ReusablePlanningRequestSuggestionList,
  ReusableSingleValueSuggestions,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import { StructuredBatchRequestsEditor } from './boardViewStructuredBatchRequestsEditor'
import { StructuredPlanningAnswersEditor } from './boardViewStructuredPlanningAnswersEditor'
import type {
  DecisionWorkflowChildEditorItem,
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusableDecisionWorkflowChildSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
} from './boardViewStructuredEditorTypes'

export function StructuredDecisionWorkflowChildrenEditor({
  label,
  value,
  onChange,
  workflowChildSuggestions = [],
  planningAnswerSuggestions = [],
  planningRequestSuggestions = [],
  answerSourceSuggestions = [],
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
  workflowChildSuggestions?: ReusableDecisionWorkflowChildSuggestion[]
  planningAnswerSuggestions?: ReusablePlanningAnswerSuggestion[]
  planningRequestSuggestions?: ReusablePlanningRequestSuggestion[]
  answerSourceSuggestions?: ReusableAnswerSourceSuggestion[]
  blockerSuggestions?: ReusableBlockerSuggestion[]
  planningRequestKeySuggestions?: ReusableStringSuggestion[]
  planningGroupTaskKeySuggestions?: ReusableStringSuggestion[]
  batchRequestSuggestions?: ReusableBatchRequestSuggestion[]
  batchRequestGroupSuggestions?: ReusableBatchRequestGroupSuggestion[]
  workflowTaskKeySuggestions?: ReusableStringSuggestion[]
  workflowGroupKeySuggestions?: ReusableStringSuggestion[]
  workflowDependencySuggestions?: ReusableStringSuggestion[]
}) {
  const { items, error } = parseDecisionWorkflowChildEditorItems(value)
  const existingWorkflowChildIdentities = new Set(
    items
      .map((item) => buildDecisionWorkflowChildEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )
  const hasReusableWorkflowChildSuggestions = workflowChildSuggestions.some((suggestion) => {
    const identity = buildDecisionWorkflowChildEditorSuggestionIdentity(suggestion.item)
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
            Author answer-driven workflow children in structured fields instead of one raw JSON
            blob.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializeDecisionWorkflowChildEditorItems([
                ...items,
                createEmptyDecisionWorkflowChildEditorItem(),
              ]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add child
        </button>
      </div>

      <ReusableDecisionWorkflowChildSuggestionList
        suggestions={workflowChildSuggestions}
        onSelect={(suggestion) =>
          onChange(serializeDecisionWorkflowChildEditorItems([...items, suggestion.item]))
        }
        onSelectAll={() =>
          onChange(
            serializeDecisionWorkflowChildEditorItems(
              appendUniqueDecisionWorkflowChildEditorItems(
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
              buildDraftDecisionWorkflowDependencySuggestions(items, index),
              workflowDependencySuggestions,
            )

            return (
              <div
                key={`${label}:decision-workflow-child:${index}`}
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
                        serializeDecisionWorkflowChildEditorItems(
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
                          serializeDecisionWorkflowChildEditorItems(
                            updateDecisionWorkflowChildEditorItem(items, index, {
                              kind: event.target.value as DecisionWorkflowChildEditorItem['kind'],
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
                  {item.kind === 'planning' ? (
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Workflow Task Key
                      </span>
                      <input
                        value={item.workflowTaskKey}
                        onChange={(event) =>
                          onChange(
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
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
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
                                workflowTaskKey: value,
                              }),
                            ),
                          )
                        }
                        suggestions={workflowTaskKeySuggestions}
                      />
                    </label>
                  ) : (
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-gray-500">
                        Group Key
                      </span>
                      <input
                        value={item.groupKey}
                        onChange={(event) =>
                          onChange(
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
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
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
                                groupKey: value,
                              }),
                            ),
                          )
                        }
                        suggestions={workflowGroupKeySuggestions}
                      />
                    </label>
                  )}
                  {item.kind === 'planning' && (
                    <ReusablePlanningRequestSuggestionList
                      suggestions={planningRequestSuggestions}
                      onSelect={(suggestion) =>
                        onChange(
                          serializeDecisionWorkflowChildEditorItems(
                            updateDecisionWorkflowChildEditorItem(items, index, {
                              ...buildDecisionWorkflowChildPatchFromPlanningRequestSuggestion(
                                suggestion,
                              ),
                            }),
                          ),
                        )
                      }
                    />
                  )}
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Blocked By Workflow Keys
                    </span>
                    <input
                      value={item.blockedByWorkflowKeys}
                      onChange={(event) =>
                        onChange(
                          serializeDecisionWorkflowChildEditorItems(
                            updateDecisionWorkflowChildEditorItem(items, index, {
                              blockedByWorkflowKeys: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured follow-through workflow dependencies"
                      value={item.blockedByWorkflowKeys}
                      onChange={(value) =>
                        onChange(
                          serializeDecisionWorkflowChildEditorItems(
                            updateDecisionWorkflowChildEditorItem(items, index, {
                              blockedByWorkflowKeys: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Workflow dependency"
                      addLabel="Add dependency"
                      placeholder="rollout-discovery"
                      emptyLabel="No structured follow-through workflow dependencies yet."
                      suggestions={workflowDependencySuggestionsForItem}
                      suggestionSummaryLabel="Reuse current workflow dependency keys"
                    />
                  </label>
                  {item.kind === 'planning' ? (
                    <>
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Title
                        </span>
                        <input
                          value={item.title}
                          onChange={(event) =>
                            onChange(
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
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
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
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
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
                                  acceptanceCriteria: event.target.value,
                                }),
                              ),
                            )
                          }
                          rows={3}
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder={'One item per line\nTodo updated'}
                        />
                        <StructuredStringListEditor
                          label="Structured follow-through acceptance criteria"
                          value={item.acceptanceCriteria}
                          onChange={(value) =>
                            onChange(
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
                                  acceptanceCriteria: value,
                                }),
                              ),
                            )
                          }
                          itemLabel="Criterion"
                          addLabel="Add criterion"
                          placeholder="Todo updated"
                          emptyLabel="No structured follow-through acceptance criteria yet."
                        />
                      </label>
                      <label className="space-y-1 md:col-span-2">
                        <span className="text-[11px] uppercase tracking-wide text-gray-500">
                          Requested Updates
                        </span>
                        <input
                          value={item.requestedUpdates}
                          onChange={(event) =>
                            onChange(
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
                                  requestedUpdates: event.target.value,
                                }),
                              ),
                            )
                          }
                          className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                          placeholder="goal.md, design.md, todo.yml"
                        />
                        <StructuredStringListEditor
                          label="Structured follow-through update targets"
                          value={item.requestedUpdates}
                          onChange={(value) =>
                            onChange(
                              serializeDecisionWorkflowChildEditorItems(
                                updateDecisionWorkflowChildEditorItem(items, index, {
                                  requestedUpdates: value,
                                }),
                              ),
                            )
                          }
                          itemLabel="Update target"
                          addLabel="Add target"
                          placeholder="goal.md"
                          emptyLabel="No structured follow-through update targets yet."
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
                          serializeDecisionWorkflowChildEditorItems(
                            updateDecisionWorkflowChildEditorItem(items, index, {
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
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
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
                            answersJson: item.answersJson,
                            batchRequestsJson: item.batchRequestsJson,
                          })
                        }
                        onReuseGroupSuggestion={(suggestion) =>
                          onChange(
                            serializeDecisionWorkflowChildEditorItems(
                              updateDecisionWorkflowChildEditorItem(items, index, {
                                groupKey: suggestion.item.groupKey,
                                blockedByWorkflowKeys: suggestion.item.blockedByWorkflowKeys,
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
