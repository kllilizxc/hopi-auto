import { Plus, Trash2 } from 'lucide-react'
import {
  createEmptyAnswerSourceEditorItem,
  parseAnswerSourceEditorItems,
  serializeAnswerSourceEditorItems,
  updateAnswerSourceEditorItem,
} from './boardViewStructuredEditorCodec'
import { buildEditorAnswerSourceIdentity } from './boardViewStructuredEditorSuggestionSupport'
import {
  appendUniqueAnswerSourceEditorItems,
  buildAnswerSourceEditorValueWithSetupSuggestions,
} from './boardViewStructuredEditorSetupSupport'
import { StructuredStringListEditor } from './boardViewStructuredEditorPresentationSupport'
import type {
  AnswerSourceEditorItem,
  ReusableAnswerSourceRoutingSuggestion,
  ReusableAnswerSourceSuggestion,
} from './boardViewStructuredEditorTypes'

export function StructuredAnswerSourcesEditor({
  label,
  value,
  onChange,
  suggestions = [],
  routingSuggestions = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suggestions?: ReusableAnswerSourceSuggestion[]
  routingSuggestions?: ReusableAnswerSourceRoutingSuggestion[]
}) {
  const { items, error } = parseAnswerSourceEditorItems(value)
  const existingAnswerSourceIdentities = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((item): item is string => Boolean(item && item.length > 0)),
  )
  const hasReusableRoutingSuggestions = routingSuggestions.some((suggestion) => {
    const identity = buildEditorAnswerSourceIdentity(suggestion.item)
    return identity !== null && !existingAnswerSourceIdentities.has(identity)
  })
  const hasReusableAnswerSuggestions = suggestions.some((suggestion) => {
    const identity = buildEditorAnswerSourceIdentity(suggestion.item)
    return identity !== null && !existingAnswerSourceIdentities.has(identity)
  })
  const hasReusableAnswerSourceSetupSuggestions =
    hasReusableRoutingSuggestions || hasReusableAnswerSuggestions

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Capture reusable answer sources without hand-editing every JSON object.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(
              serializeAnswerSourceEditorItems([...items, createEmptyAnswerSourceEditorItem()]),
            )
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="w-3.5 h-3.5" />
          Add source
        </button>
      </div>

      {(routingSuggestions.length > 0 || suggestions.length > 0) && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <div className="text-[11px] text-gray-500">
            Apply current consumer routing and reusable durable answers together.
          </div>
          <button
            type="button"
            disabled={!hasReusableAnswerSourceSetupSuggestions || error !== null}
            onClick={() => {
              const nextValue = buildAnswerSourceEditorValueWithSetupSuggestions(
                value,
                routingSuggestions,
                suggestions,
              )
              if (!nextValue) {
                return
              }
              onChange(nextValue)
            }}
            className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Set up current answer sources
          </button>
        </div>
      )}

      {routingSuggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Route remaining sources to current consumers
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusableRoutingSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeAnswerSourceEditorItems(
                    appendUniqueAnswerSourceEditorItems(
                      items,
                      routingSuggestions.map((suggestion) => suggestion.item),
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Route all current consumers
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {routingSuggestions.map((suggestion) => {
              const suggestionIdentity = buildEditorAnswerSourceIdentity(suggestion.item)
              const alreadyAdded =
                suggestionIdentity !== null &&
                existingAnswerSourceIdentities.has(suggestionIdentity)

              return (
                <div
                  key={`${label}:routing-suggestion:${suggestion.suggestionKey}`}
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
                      onChange(serializeAnswerSourceEditorItems([...items, suggestion.item]))
                    }
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyAdded ? 'Added' : 'Route'}
                  </button>
                </div>
              )
            })}
          </div>
          {error && (
            <div className="mt-3 text-[11px] text-red-300">
              Fix the current JSON before routing remaining sources here.
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
              disabled={!hasReusableAnswerSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeAnswerSourceEditorItems(
                    appendUniqueAnswerSourceEditorItems(
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
              const suggestionIdentity = buildEditorAnswerSourceIdentity(suggestion.item)
              const alreadyAdded =
                suggestionIdentity !== null &&
                existingAnswerSourceIdentities.has(suggestionIdentity)

              return (
                <div
                  key={`${label}:suggestion:${suggestion.suggestionKey}`}
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
                      onChange(serializeAnswerSourceEditorItems([...items, suggestion.item]))
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
          No structured answer sources yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:source:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">Source {index + 1}</div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializeAnswerSourceEditorItems(
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
                    Answer Source Key
                  </span>
                  <input
                    value={item.answerSourceKey}
                    onChange={(event) =>
                      onChange(
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
                            answerSourceKey: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="rollout-shape-source"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Route</span>
                  <select
                    value={item.route}
                    onChange={(event) =>
                      onChange(
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
                            route: event.target.value as AnswerSourceEditorItem['route'],
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  >
                    <option value="">unspecified</option>
                    <option value="decision">decision</option>
                    <option value="planning">planning</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Summary</span>
                  <input
                    value={item.summary}
                    onChange={(event) =>
                      onChange(
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
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
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
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
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
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
                        serializeAnswerSourceEditorItems(
                          updateAnswerSourceEditorItem(items, index, {
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
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
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
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
                              matchHints: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="comma or newline separated"
                    />
                    <StructuredStringListEditor
                      label="Structured answer-source match hints"
                      value={item.matchHints}
                      onChange={(value) =>
                        onChange(
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
                              matchHints: value,
                            }),
                          ),
                        )
                      }
                      itemLabel="Match hint"
                      addLabel="Add hint"
                      placeholder="launch shape"
                      emptyLabel="No structured answer-source match hints yet."
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
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
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
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
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
                      Decision Key
                    </span>
                    <input
                      value={item.decisionKey}
                      onChange={(event) =>
                        onChange(
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
                              decisionKey: event.target.value,
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
                      Source Group Key
                    </span>
                    <input
                      value={item.sourceGroupKey}
                      onChange={(event) =>
                        onChange(
                          serializeAnswerSourceEditorItems(
                            updateAnswerSourceEditorItem(items, index, {
                              sourceGroupKey: event.target.value,
                            }),
                          ),
                        )
                      }
                      className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                      placeholder="optional"
                    />
                  </label>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
