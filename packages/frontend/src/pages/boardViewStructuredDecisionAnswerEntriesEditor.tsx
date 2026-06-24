import { Plus, Trash2 } from 'lucide-react'
import {
  createEmptyDecisionAnswerEntryEditorItem,
  parseDecisionAnswerEntryEditorItems,
  serializeDecisionAnswerEntryEditorItems,
  updateDecisionAnswerEntryEditorItem,
} from './boardViewStructuredEditorCodec'
import {
  buildDecisionAnswerEntrySuggestionIdentity,
  buildEditorAnswerSourceIdentity,
} from './boardViewStructuredEditorSuggestionSupport'
import { buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion } from './boardViewStructuredEditorPatchBuilders'
import {
  appendDecisionAnswerEntryItemsFromAnswerSourceSuggestions,
  appendDecisionAnswerEntryItemsWithSetupSuggestions,
  appendUniqueDecisionAnswerEntryEditorItems,
} from './boardViewStructuredEditorSetupSupport'
import {
  ReusableAnswerSourceFieldSuggestions,
  ReusableSingleValueSuggestions,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import type {
  ReusableAnswerSourceSuggestion,
  ReusableDecisionAnswerSuggestion,
  ReusableStringSuggestion,
} from './boardViewStructuredEditorTypes'

export function StructuredDecisionAnswerEntriesEditor({
  label,
  value,
  onChange,
  suggestions = [],
  taskRefSuggestions = [],
  answerSourceSuggestions = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suggestions?: ReusableDecisionAnswerSuggestion[]
  taskRefSuggestions?: ReusableStringSuggestion[]
  answerSourceSuggestions?: ReusableAnswerSourceSuggestion[]
}) {
  const { items, error } = parseDecisionAnswerEntryEditorItems(value)
  const existingDecisionKeys = new Set(
    items
      .map((item) => buildDecisionAnswerEntrySuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )
  const existingAnswerSourceKeys = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((entry): entry is string => Boolean(entry && entry.length > 0)),
  )
  const hasReusableDecisionSuggestions = suggestions.some(
    (suggestion) =>
      !existingDecisionKeys.has(
        buildDecisionAnswerEntrySuggestionIdentity(suggestion.item) ?? suggestion.suggestionKey,
      ),
  )
  const hasReusableDecisionAnswerSourceSuggestions = answerSourceSuggestions.some((suggestion) => {
    const suggestionIdentity = buildEditorAnswerSourceIdentity(suggestion.item)
    return suggestionIdentity !== null && !existingAnswerSourceKeys.has(suggestionIdentity)
  })
  const hasDecisionAnswerSetupSuggestions =
    hasReusableDecisionSuggestions || hasReusableDecisionAnswerSourceSuggestions

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Build batch decision answers without hand-editing every JSON object.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializeDecisionAnswerEntryEditorItems([
                ...items,
                createEmptyDecisionAnswerEntryEditorItem(),
              ]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add decision answer
        </button>
      </div>

      {(suggestions.length > 0 || answerSourceSuggestions.length > 0) && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Set up current decision answers
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasDecisionAnswerSetupSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeDecisionAnswerEntryEditorItems(
                    appendDecisionAnswerEntryItemsWithSetupSuggestions(
                      items,
                      suggestions,
                      answerSourceSuggestions,
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Set up all current decision answers
            </button>
          </div>
          <div className="mt-3 text-[11px] text-gray-500">
            Combine reusable open decisions with answer-source-backed decision patches in one step.
          </div>
          {error && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current JSON before setting up decision answers here.
            </div>
          )}
        </details>
      )}

      {suggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current open decisions
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusableDecisionSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeDecisionAnswerEntryEditorItems(
                    appendUniqueDecisionAnswerEntryEditorItems(
                      items,
                      suggestions.map((suggestion) => suggestion.item),
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current open decisions
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {suggestions.map((suggestion) => {
              const alreadyAdded = existingDecisionKeys.has(
                buildDecisionAnswerEntrySuggestionIdentity(suggestion.item) ??
                  suggestion.suggestionKey,
              )

              return (
                <div
                  key={`${label}:decision-suggestion:${suggestion.suggestionKey}`}
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
                      onChange(serializeDecisionAnswerEntryEditorItems([...items, suggestion.item]))
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
              Fix the current JSON before reusing open decisions here.
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
              disabled={!hasReusableDecisionAnswerSourceSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeDecisionAnswerEntryEditorItems(
                    appendDecisionAnswerEntryItemsFromAnswerSourceSuggestions(
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
                  key={`${label}:decision-answer-source:${suggestion.suggestionKey}`}
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
                        serializeDecisionAnswerEntryEditorItems([
                          ...items,
                          {
                            ...createEmptyDecisionAnswerEntryEditorItem(),
                            ...buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion(suggestion),
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
          No structured decision answers yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:decision-answer:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">Decision answer {index + 1}</div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializeDecisionAnswerEntryEditorItems(
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
                        serializeDecisionAnswerEntryEditorItems(
                          updateDecisionAnswerEntryEditorItem(items, index, {
                            summary: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Auth strategy"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Decision Key
                  </span>
                  <input
                    value={item.decisionKey}
                    onChange={(event) =>
                      onChange(
                        serializeDecisionAnswerEntryEditorItems(
                          updateDecisionAnswerEntryEditorItem(items, index, {
                            decisionKey: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Answer</span>
                  <textarea
                    value={item.answer}
                    onChange={(event) =>
                      onChange(
                        serializeDecisionAnswerEntryEditorItems(
                          updateDecisionAnswerEntryEditorItem(items, index, {
                            answer: event.target.value,
                          }),
                        ),
                      )
                    }
                    rows={2}
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="Use Bun-native auth."
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
                        serializeDecisionAnswerEntryEditorItems(
                          updateDecisionAnswerEntryEditorItem(items, index, {
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              prompt: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="What should auth strategy be?"
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              matchHints: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured decision-answer match hints"
                      value={item.matchHints}
                      onChange={(value) =>
                        onChange(
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              matchHints: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Match hint"
                      addLabel="Add hint"
                      placeholder="auth strategy"
                      emptyLabel="No structured decision-answer match hints yet."
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
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
                      Linked Task Ref
                    </span>
                    <input
                      value={item.taskRef}
                      onChange={(event) =>
                        onChange(
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              taskRef: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <ReusableSingleValueSuggestions
                      label="Reuse current visible task refs"
                      value={item.taskRef}
                      onSelect={(value) =>
                        onChange(
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              taskRef: value,
                            }),
                          ),
                        )
                      }
                      suggestions={taskRefSuggestions}
                    />
                  </div>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-gray-500">
                      Source Occurrence
                    </span>
                    <input
                      value={item.sourceOccurrence}
                      onChange={(event) =>
                        onChange(
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              sourceOccurrence: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional positive integer"
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
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
                          serializeDecisionAnswerEntryEditorItems(
                            updateDecisionAnswerEntryEditorItem(items, index, {
                              ...buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion(
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
