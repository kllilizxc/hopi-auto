import { Plus, Trash2 } from 'lucide-react'
import {
  buildValidTaskBlockerRefSetFromSuggestions,
  createEmptyBatchRequestEditorItem,
  parseBatchRequestEditorItems,
  serializeBatchRequestEditorItems,
  updateBatchRequestEditorItem,
  validateBatchRequestBlockers,
} from './boardViewStructuredEditorCodec'
import {
  appendUniqueBatchRequestEditorItems,
  buildBatchRequestEditorSuggestionIdentity,
} from './boardViewStructuredEditorSetupSupport'
import {
  ReusableSingleValueSuggestions,
  StructuredBlockersEditor,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import type {
  ReusableBatchRequestGroupSuggestion,
  ReusableBatchRequestSuggestion,
  ReusableBlockerSuggestion,
  ReusableStringSuggestion,
} from './boardViewStructuredEditorTypes'

export function StructuredBatchRequestsEditor({
  label,
  value,
  onChange,
  blockerSuggestions = [],
  requestKeySuggestions = [],
  groupedTaskKeySuggestions = [],
  requestSuggestions = [],
  groupSuggestions = [],
  onReuseGroupSuggestion,
  isGroupSuggestionSelected,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  blockerSuggestions?: ReusableBlockerSuggestion[]
  requestKeySuggestions?: ReusableStringSuggestion[]
  groupedTaskKeySuggestions?: ReusableStringSuggestion[]
  requestSuggestions?: ReusableBatchRequestSuggestion[]
  groupSuggestions?: ReusableBatchRequestGroupSuggestion[]
  onReuseGroupSuggestion?: (suggestion: ReusableBatchRequestGroupSuggestion) => void
  isGroupSuggestionSelected?: (suggestion: ReusableBatchRequestGroupSuggestion) => boolean
}) {
  const { items, error } = parseBatchRequestEditorItems(value)
  const taskBlockerValidationError =
    error ??
    validateBatchRequestBlockers(
      items.map((item, index) => ({
        label: `Batch request ${index + 1} blockers`,
        blockedByJson: item.blockedByJson,
      })),
      buildValidTaskBlockerRefSetFromSuggestions(blockerSuggestions),
    )
  const existingRequestIdentities = new Set(
    items
      .map((item) => buildBatchRequestEditorSuggestionIdentity(item))
      .filter((entry): entry is string => entry !== null),
  )
  const hasReusableBatchRequestSuggestions = requestSuggestions.some((suggestion) => {
    const identity = buildBatchRequestEditorSuggestionIdentity(suggestion.item)
    return identity !== null && !existingRequestIdentities.has(identity)
  })

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Edit grouped planning requests through fields instead of raw JSON objects.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializeBatchRequestEditorItems([...items, createEmptyBatchRequestEditorItem()]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add request
        </button>
      </div>

      {groupSuggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current grouped planning sinks
          </summary>
          <div className="mt-3 space-y-2">
            {groupSuggestions.map((suggestion) => {
              const alreadySelected = isGroupSuggestionSelected
                ? isGroupSuggestionSelected(suggestion)
                : suggestion.item.batchRequestsJson.trim() === value.trim()

              return (
                <div
                  key={`${label}:batch-request-group:${suggestion.suggestionKey}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                    <div className="mt-2 text-xs text-gray-400 break-words">
                      {suggestion.preview}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadySelected || taskBlockerValidationError !== null}
                    onClick={() => {
                      if (onReuseGroupSuggestion) {
                        onReuseGroupSuggestion(suggestion)
                        return
                      }
                      onChange(suggestion.item.batchRequestsJson)
                    }}
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadySelected ? 'Selected' : 'Reuse all'}
                  </button>
                </div>
              )
            })}
          </div>
          {taskBlockerValidationError && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current batch requests before reusing grouped planning sinks here.
            </div>
          )}
        </details>
      )}

      {requestSuggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current grouped planning requests
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusableBatchRequestSuggestions || taskBlockerValidationError !== null}
              onClick={() =>
                onChange(
                  serializeBatchRequestEditorItems(
                    appendUniqueBatchRequestEditorItems(
                      items,
                      requestSuggestions.map((suggestion) => suggestion.item),
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current grouped planning requests
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {requestSuggestions.map((suggestion) => {
              const suggestionIdentity = buildBatchRequestEditorSuggestionIdentity(suggestion.item)
              const alreadyAdded =
                suggestionIdentity !== null && existingRequestIdentities.has(suggestionIdentity)

              return (
                <div
                  key={`${label}:batch-request-suggestion:${suggestion.suggestionKey}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                    <div className="mt-2 text-xs text-gray-400 break-words">
                      {suggestion.preview}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAdded || taskBlockerValidationError !== null}
                    onClick={() =>
                      onChange(serializeBatchRequestEditorItems([...items, suggestion.item]))
                    }
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyAdded ? 'Added' : 'Reuse'}
                  </button>
                </div>
              )
            })}
          </div>
          {taskBlockerValidationError && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current batch requests before reusing grouped planning requests here.
            </div>
          )}
        </details>
      )}

      {taskBlockerValidationError ? (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-3 text-xs text-red-200">
          <div>{taskBlockerValidationError}</div>
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
          No structured batch requests yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:batch-request:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">Batch request {index + 1}</div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializeBatchRequestEditorItems(
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
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Task Key
                  </span>
                  <input
                    value={item.taskKey}
                    onChange={(event) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            taskKey: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="auth-rollout-plan"
                  />
                  <ReusableSingleValueSuggestions
                    label="Reuse current grouped task keys"
                    value={item.taskKey}
                    onSelect={(value) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            taskKey: value,
                          }),
                        ),
                      )
                    }
                    suggestions={groupedTaskKeySuggestions}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Request Key
                  </span>
                  <input
                    value={item.requestKey}
                    onChange={(event) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
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
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            requestKey: value,
                          }),
                        ),
                      )
                    }
                    suggestions={requestKeySuggestions}
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
                  <input
                    value={item.title}
                    onChange={(event) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            title: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Design auth rollout"
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
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            description: event.target.value,
                          }),
                        ),
                      )
                    }
                    rows={2}
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Describe the grouped planning request."
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
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
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
                    label="Structured batch acceptance criteria"
                    value={item.acceptanceCriteria}
                    onChange={(value) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            acceptanceCriteria: value,
                          }),
                        ),
                      )
                    }
                    itemLabel="Criterion"
                    addLabel="Add criterion"
                    placeholder="Design updated"
                    emptyLabel="No structured batch acceptance criteria yet."
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
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            requestedUpdates: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="design.md, todo.yml"
                  />
                  <StructuredStringListEditor
                    label="Structured batch requested updates"
                    value={item.requestedUpdates}
                    onChange={(value) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            requestedUpdates: value,
                          }),
                        ),
                      )
                    }
                    itemLabel="Update target"
                    addLabel="Add target"
                    placeholder="design.md"
                    emptyLabel="No structured batch update targets yet."
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Blocked By Task Keys
                  </span>
                  <input
                    value={item.blockedByTaskKeys}
                    onChange={(event) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            blockedByTaskKeys: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="comma or newline separated"
                  />
                  <StructuredStringListEditor
                    label="Structured batch task dependencies"
                    value={item.blockedByTaskKeys}
                    onChange={(value) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            blockedByTaskKeys: value,
                          }),
                        ),
                      )
                    }
                    itemLabel="Task dependency"
                    addLabel="Add dependency"
                    placeholder="design-auth-rollout"
                    emptyLabel="No structured batch task dependencies yet."
                    suggestions={groupedTaskKeySuggestions}
                    suggestionSummaryLabel="Reuse current grouped task keys"
                  />
                </label>
                <div className="space-y-1 md:col-span-2">
                  <StructuredBlockersEditor
                    label="Structured batch request blockers"
                    value={item.blockedByJson}
                    onChange={(value) =>
                      onChange(
                        serializeBatchRequestEditorItems(
                          updateBatchRequestEditorItem(items, index, {
                            blockedByJson: value,
                          }),
                        ),
                      )
                    }
                    suggestions={blockerSuggestions}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
