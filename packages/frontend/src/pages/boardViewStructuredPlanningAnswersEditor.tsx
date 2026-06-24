import { Plus, Trash2 } from 'lucide-react'
import {
  createEmptyPlanningAnswerEditorItem,
  parsePlanningAnswerEditorItems,
  serializePlanningAnswerEditorItems,
  updatePlanningAnswerEditorItem,
} from './boardViewStructuredEditorCodec'
import {
  buildEditorAnswerSourceIdentity,
  buildPlanningAnswerEditorSuggestionIdentity,
} from './boardViewStructuredEditorSuggestionSupport'
import { buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion } from './boardViewStructuredEditorPatchBuilders'
import {
  appendPlanningAnswerEditorItemsFromAnswerSourceSuggestions,
  appendPlanningAnswerEditorItemsWithSetupSuggestions,
  appendUniquePlanningAnswerEditorItems,
} from './boardViewStructuredEditorSetupSupport'
import {
  ReusableAnswerSourceFieldSuggestions,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import type {
  ReusableAnswerSourceSuggestion,
  ReusablePlanningAnswerSuggestion,
} from './boardViewStructuredEditorTypes'

export function StructuredPlanningAnswersEditor({
  label,
  value,
  onChange,
  suggestions = [],
  answerSourceSuggestions = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suggestions?: ReusablePlanningAnswerSuggestion[]
  answerSourceSuggestions?: ReusableAnswerSourceSuggestion[]
}) {
  const { items, error } = parsePlanningAnswerEditorItems(value)
  const existingAnswerKeys = new Set(
    items
      .map((item) =>
        [item.answerKey.trim(), item.summaryKey.trim(), item.summary.trim()]
          .filter((entry) => entry.length > 0)
          .join('::'),
      )
      .filter((entry) => entry.length > 0),
  )
  const existingAnswerSourceKeys = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((entry): entry is string => Boolean(entry && entry.length > 0)),
  )
  const hasReusablePlanningAnswerSuggestions = suggestions.some(
    (suggestion) =>
      !existingAnswerKeys.has(
        buildPlanningAnswerEditorSuggestionIdentity(suggestion.item) ?? suggestion.suggestionKey,
      ),
  )
  const hasReusablePlanningAnswerSourceSuggestions = answerSourceSuggestions.some((suggestion) => {
    const suggestionIdentity = buildEditorAnswerSourceIdentity(suggestion.item)
    return suggestionIdentity !== null && !existingAnswerSourceKeys.has(suggestionIdentity)
  })
  const hasPlanningAnswerSetupSuggestions =
    hasReusablePlanningAnswerSuggestions || hasReusablePlanningAnswerSourceSuggestions

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Use the structured editor instead of hand-writing every JSON field.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializePlanningAnswerEditorItems([...items, createEmptyPlanningAnswerEditorItem()]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add answer
        </button>
      </div>

      {(suggestions.length > 0 || answerSourceSuggestions.length > 0) && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Set up current answers
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasPlanningAnswerSetupSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializePlanningAnswerEditorItems(
                    appendPlanningAnswerEditorItemsWithSetupSuggestions(
                      items,
                      suggestions,
                      answerSourceSuggestions,
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Set up all current answers
            </button>
          </div>
          <div className="mt-3 text-[11px] text-gray-500">
            Combine reusable durable answers with answer-source-backed answer patches in one step.
          </div>
          {error && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current JSON before setting up answers here.
            </div>
          )}
        </details>
      )}

      {suggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current durable answers
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusablePlanningAnswerSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializePlanningAnswerEditorItems(
                    appendUniquePlanningAnswerEditorItems(
                      items,
                      suggestions.map((suggestion) => suggestion.item),
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current durable answers
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {suggestions.map((suggestion) => {
              const alreadyAdded = existingAnswerKeys.has(
                buildPlanningAnswerEditorSuggestionIdentity(suggestion.item) ??
                  suggestion.suggestionKey,
              )

              return (
                <div
                  key={`${label}:planning-suggestion:${suggestion.suggestionKey}`}
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
                    disabled={alreadyAdded || error !== null}
                    onClick={() =>
                      onChange(serializePlanningAnswerEditorItems([...items, suggestion.item]))
                    }
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyAdded ? 'Added' : 'Reuse'}
                  </button>
                </div>
              )
            })}
          </div>
          {error && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current JSON before reusing durable answers here.
            </div>
          )}
        </details>
      )}

      {answerSourceSuggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current answer sources
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusablePlanningAnswerSourceSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializePlanningAnswerEditorItems(
                    appendPlanningAnswerEditorItemsFromAnswerSourceSuggestions(
                      items,
                      answerSourceSuggestions,
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current answer sources
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {answerSourceSuggestions.map((suggestion) => {
              const suggestionIdentity = buildEditorAnswerSourceIdentity(suggestion.item)
              const alreadyAdded =
                suggestionIdentity !== null && existingAnswerSourceKeys.has(suggestionIdentity)

              return (
                <div
                  key={`${label}:planning-answer-source:${suggestion.suggestionKey}`}
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
                    disabled={alreadyAdded || error !== null}
                    onClick={() =>
                      onChange(
                        serializePlanningAnswerEditorItems([
                          ...items,
                          {
                            ...createEmptyPlanningAnswerEditorItem(),
                            ...buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion(suggestion),
                          },
                        ]),
                      )
                    }
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyAdded ? 'Added' : 'Reuse'}
                  </button>
                </div>
              )
            })}
          </div>
          {error && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current JSON before reusing answer sources here.
            </div>
          )}
        </details>
      )}

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
          No structured answers yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:answer:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">Answer {index + 1}</div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializePlanningAnswerEditorItems(
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
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Summary</span>
                  <input
                    value={item.summary}
                    onChange={(event) =>
                      onChange(
                        serializePlanningAnswerEditorItems(
                          updatePlanningAnswerEditorItem(items, index, {
                            summary: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Rollout shape"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Source Occurrence
                  </span>
                  <input
                    value={item.sourceOccurrence}
                    onChange={(event) =>
                      onChange(
                        serializePlanningAnswerEditorItems(
                          updatePlanningAnswerEditorItem(items, index, {
                            sourceOccurrence: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional positive integer"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Answer</span>
                  <textarea
                    value={item.answer}
                    onChange={(event) =>
                      onChange(
                        serializePlanningAnswerEditorItems(
                          updatePlanningAnswerEditorItem(items, index, {
                            answer: event.target.value,
                          }),
                        ),
                      )
                    }
                    rows={2}
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Stage the rollout."
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Source Excerpt
                  </span>
                  <textarea
                    value={item.sourceExcerpt}
                    onChange={(event) =>
                      onChange(
                        serializePlanningAnswerEditorItems(
                          updatePlanningAnswerEditorItem(items, index, {
                            sourceExcerpt: event.target.value,
                          }),
                        ),
                      )
                    }
                    rows={2}
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Optional exact excerpt from the shared reply."
                  />
                </label>
              </div>

              <details className="mt-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3">
                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Advanced matching fields
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Prompt
                    </span>
                    <input
                      value={item.prompt}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              prompt: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="What should rollout shape be?"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Match Hints
                    </span>
                    <input
                      value={item.matchHints}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              matchHints: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured planning answer match hints"
                      value={item.matchHints}
                      onChange={(value) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              matchHints: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Match hint"
                      addLabel="Add hint"
                      placeholder="rollout shape"
                      emptyLabel="No structured planning-answer match hints yet."
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Summary Key
                    </span>
                    <input
                      value={item.summaryKey}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              summaryKey: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Answer Key
                    </span>
                    <input
                      value={item.answerKey}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              answerKey: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Answer Source Key
                    </span>
                    <input
                      value={item.answerSourceKey}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              answerSourceKey: event.target.value,
                            }),
                          ),
                        )
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
                      value={item.answerSourceGroupKey}
                      onChange={(event) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              answerSourceGroupKey: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <ReusableAnswerSourceFieldSuggestions
                      label="Reuse current answer sources"
                      answerSourceKey={item.answerSourceKey}
                      answerSourceGroupKey={item.answerSourceGroupKey}
                      onSelect={(suggestion) =>
                        onChange(
                          serializePlanningAnswerEditorItems(
                            updatePlanningAnswerEditorItem(items, index, {
                              ...buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion(
                                suggestion,
                              ),
                            }),
                          ),
                        )
                      }
                      suggestions={answerSourceSuggestions}
                    />
                  </div>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
