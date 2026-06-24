import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { type BlockerKind } from '../lib/api'
import {
  buildStringListEditorIdentity,
  createEmptyBlockerEditorItem,
  parseBlockerEditorItems,
  parseListInput,
  serializeBlockerEditorItems,
  serializeStringListEditorItems,
  updateBlockerEditorItem,
  updateStringListEditorItems,
} from './boardViewStructuredEditorCodec'
import {
  appendUniqueBlockerEditorItems,
  buildBlockerSuggestionIdentity,
} from './boardViewStructuredEditorSuggestionSupport'
import type {
  BlockerEditorItem,
  ReusableAnswerSourceSuggestion,
  ReusableBlockerSuggestion,
  ReusableDecisionAnswerSuggestion,
  ReusableDecisionWorkflowChildSuggestion,
  ReusablePlanningRequestSuggestion,
  ReusableStringSuggestion,
  ReusableWorkflowChildSuggestion,
  ReusableWorkflowContextSuggestion,
  ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'

const BLOCKER_KIND_OPTIONS: BlockerKind[] = ['task', 'decision', 'merge_conflict', 'intervention']

export function ReusableDecisionAnswerSuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: ReusableDecisionAnswerSuggestion[]
  onSelect: (suggestion: ReusableDecisionAnswerSuggestion) => void
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Reuse current open decisions
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={`single-answer-bundle-suggestion:${suggestion.suggestionKey}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#161616] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Prefill
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ReusableWorkflowContextSuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: ReusableWorkflowContextSuggestion[]
  onSelect: (suggestion: ReusableWorkflowContextSuggestion) => void
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Reuse current workflow root context
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.suggestionKey}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Reuse
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ReusableWorkflowGraphSuggestionList({
  suggestions,
  onSelect,
}: {
  suggestions: ReusableWorkflowGraphSuggestion[]
  onSelect: (suggestion: ReusableWorkflowGraphSuggestion) => void
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Reuse current workflow graph
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.suggestionKey}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Reuse
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ReusableWorkflowChildSuggestionList({
  suggestions,
  onSelect,
  onSelectAll,
  disableSelectAll = false,
}: {
  suggestions: ReusableWorkflowChildSuggestion[]
  onSelect: (suggestion: ReusableWorkflowChildSuggestion) => void
  onSelectAll?: () => void
  disableSelectAll?: boolean
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Reuse current workflow children
      </summary>
      {onSelectAll ? (
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            disabled={disableSelectAll}
            onClick={() => onSelectAll()}
            className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Append all current workflow children
          </button>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.suggestionKey}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Append
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ReusableDecisionWorkflowChildSuggestionList({
  suggestions,
  onSelect,
  onSelectAll,
  disableSelectAll = false,
}: {
  suggestions: ReusableDecisionWorkflowChildSuggestion[]
  onSelect: (suggestion: ReusableDecisionWorkflowChildSuggestion) => void
  onSelectAll?: () => void
  disableSelectAll?: boolean
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        Reuse current workflow children
      </summary>
      {onSelectAll ? (
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            disabled={disableSelectAll}
            onClick={() => onSelectAll()}
            className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Append all current workflow children
          </button>
        </div>
      ) : null}
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.suggestionKey}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Append
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function ReusablePlanningRequestSuggestionList({
  label = 'Reuse current planning requests',
  suggestions,
  onSelect,
}: {
  label?: string
  suggestions: ReusablePlanningRequestSuggestion[]
  onSelect: (suggestion: ReusablePlanningRequestSuggestion) => void
}) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={`planning-request-suggestion:${suggestion.suggestionKey}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
          >
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
              <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
              <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
            </div>
            <button
              type="button"
              onClick={() => onSelect(suggestion)}
              className="shrink-0 rounded-lg border border-[#343434] bg-[#161616] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
            >
              Prefill
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

export function StructuredBlockersEditor({
  label,
  value,
  onChange,
  suggestions = [],
}: {
  label: string
  value: string
  onChange: (value: string) => void
  suggestions?: ReusableBlockerSuggestion[]
}) {
  const { items, error } = parseBlockerEditorItems(value)
  const existingBlockerKeys = new Set(
    items
      .map((item) => buildBlockerSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )
  const hasReusableBlockerSuggestions = suggestions.some((suggestion) => {
    const identity = buildBlockerSuggestionIdentity(suggestion.item)
    return identity !== null && !existingBlockerKeys.has(identity)
  })

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">
            Edit blocker refs through fields instead of hand-writing every JSON object.
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange(serializeBlockerEditorItems([...items, createEmptyBlockerEditorItem()]))
          }
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add blocker
        </button>
      </div>

      {suggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Reuse current blockers
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusableBlockerSuggestions || error !== null}
              onClick={() =>
                onChange(
                  serializeBlockerEditorItems(
                    appendUniqueBlockerEditorItems(
                      items,
                      suggestions.map((suggestion) => suggestion.item),
                    ),
                  ),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current blockers
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {suggestions.map((suggestion) => {
              const alreadyAdded = existingBlockerKeys.has(
                buildBlockerSuggestionIdentity(suggestion.item) ?? suggestion.suggestionKey,
              )

              return (
                <div
                  key={`${label}:blocker-suggestion:${suggestion.suggestionKey}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                    <div className="mt-2 break-words text-xs text-gray-400">
                      {suggestion.preview}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAdded || error !== null}
                    onClick={() =>
                      onChange(serializeBlockerEditorItems([...items, suggestion.item]))
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
              Fix the current JSON before reusing blockers here.
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
          No structured blockers yet.
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:blocker:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">Blocker {index + 1}</div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializeBlockerEditorItems(
                        items.filter((_, itemIndex) => itemIndex !== index),
                      ),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#343434] bg-[#161616] px-2 py-1 text-[11px] font-medium text-gray-300 transition hover:border-red-500/40 hover:text-red-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
                        serializeBlockerEditorItems(
                          updateBlockerEditorItem(items, index, {
                            kind: event.target.value as BlockerEditorItem['kind'],
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                  >
                    <option value="">select kind</option>
                    {BLOCKER_KIND_OPTIONS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">Ref</span>
                  <input
                    value={item.ref}
                    onChange={(event) =>
                      onChange(
                        serializeBlockerEditorItems(
                          updateBlockerEditorItem(items, index, {
                            ref: event.target.value,
                          }),
                        ),
                      )
                    }
                    className="w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="auth-strategy"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function StructuredStringListEditor({
  label,
  value,
  onChange,
  itemLabel,
  addLabel,
  placeholder,
  emptyLabel,
  description = 'Edit list values through fields instead of one comma/newline string.',
  suggestions = [],
  suggestionSummaryLabel = 'Reuse current durable values',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  itemLabel: string
  addLabel: string
  placeholder: string
  emptyLabel: string
  description?: string
  suggestions?: ReusableStringSuggestion[]
  suggestionSummaryLabel?: string
}) {
  const items = parseListInput(value)
  const [draft, setDraft] = useState('')
  const normalizedItems = new Set(
    items.map((item) => buildStringListEditorIdentity(item)).filter((item) => item.length > 0),
  )
  const hasReusableSuggestions = suggestions.some(
    (suggestion) => !normalizedItems.has(buildStringListEditorIdentity(suggestion.value)),
  )
  const normalizedDraft = buildStringListEditorIdentity(draft)

  return (
    <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {label}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">{description}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = draft.trim()
            if (!next || normalizedItems.has(normalizedDraft)) {
              return
            }
            onChange(serializeStringListEditorItems([...items, next]))
            setDraft('')
          }}
          disabled={normalizedDraft.length === 0 || normalizedItems.has(normalizedDraft)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {addLabel}
        </button>
      </div>

      <div className="mt-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
          placeholder={placeholder}
        />
      </div>

      {suggestions.length > 0 && (
        <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {suggestionSummaryLabel}
          </summary>
          <div className="mt-3 flex items-center justify-end">
            <button
              type="button"
              disabled={!hasReusableSuggestions}
              onClick={() =>
                onChange(
                  serializeStringListEditorItems([
                    ...items,
                    ...suggestions
                      .map((suggestion) => suggestion.value)
                      .filter((suggestionValue) => {
                        const normalizedValue = buildStringListEditorIdentity(suggestionValue)
                        return normalizedValue.length > 0 && !normalizedItems.has(normalizedValue)
                      }),
                  ]),
                )
              }
              className="rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reuse all current values
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {suggestions.map((suggestion) => {
              const alreadyAdded = normalizedItems.has(
                buildStringListEditorIdentity(suggestion.value),
              )

              return (
                <div
                  key={`${label}:string-suggestion:${suggestion.suggestionKey}`}
                  className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                    <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                    <div className="mt-2 break-words text-xs text-gray-400">
                      {suggestion.preview}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAdded}
                    onClick={() =>
                      onChange(serializeStringListEditorItems([...items, suggestion.value]))
                    }
                    className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {alreadyAdded ? 'Added' : 'Reuse'}
                  </button>
                </div>
              )
            })}
          </div>
        </details>
      )}

      {items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-[#313131] bg-[#111] px-3 py-4 text-xs text-gray-500">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {items.map((item, index) => (
            <div
              key={`${label}:string-item:${index}`}
              className="rounded-lg border border-[#252525] bg-[#111] px-3 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-gray-300">
                  {itemLabel} {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(
                      serializeStringListEditorItems(
                        items.filter((_, itemIndex) => itemIndex !== index),
                      ),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#343434] bg-[#161616] px-2 py-1 text-[11px] font-medium text-gray-300 transition hover:border-red-500/40 hover:text-red-200"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              </div>
              <input
                value={item}
                onChange={(event) =>
                  onChange(
                    serializeStringListEditorItems(
                      updateStringListEditorItems(items, index, event.target.value),
                    ),
                  )
                }
                className="mt-3 w-full rounded-lg border border-[#343434] bg-[#161616] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder={placeholder}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ReusableSingleValueSuggestions({
  label,
  value,
  onSelect,
  suggestions = [],
}: {
  label: string
  value: string
  onSelect: (value: string) => void
  suggestions?: ReusableStringSuggestion[]
}) {
  if (suggestions.length === 0) {
    return null
  }

  const normalizedValue = value.trim()

  return (
    <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => {
          const alreadySelected = normalizedValue === suggestion.value.trim()

          return (
            <div
              key={`${label}:single-suggestion:${suggestion.suggestionKey}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
              </div>
              <button
                type="button"
                disabled={alreadySelected}
                onClick={() => onSelect(suggestion.value)}
                className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {alreadySelected ? 'Selected' : 'Reuse'}
              </button>
            </div>
          )
        })}
      </div>
    </details>
  )
}

export function ReusableAnswerSourceFieldSuggestions({
  label,
  answerSourceKey,
  answerSourceGroupKey,
  onSelect,
  suggestions = [],
}: {
  label: string
  answerSourceKey: string
  answerSourceGroupKey: string
  onSelect: (suggestion: ReusableAnswerSourceSuggestion) => void
  suggestions?: ReusableAnswerSourceSuggestion[]
}) {
  if (suggestions.length === 0) {
    return null
  }

  const normalizedKey = answerSourceKey.trim()
  const normalizedGroupKey = answerSourceGroupKey.trim()

  return (
    <details className="mt-3 rounded-lg border border-[#252525] bg-[#111] px-3 py-3">
      <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </summary>
      <div className="mt-3 space-y-2">
        {suggestions.map((suggestion) => {
          const suggestionKey = suggestion.item.answerSourceKey.trim()
          const suggestionGroupKey = suggestion.item.sourceGroupKey.trim()
          const alreadySelected =
            normalizedKey === suggestionKey && normalizedGroupKey === suggestionGroupKey

          return (
            <div
              key={`${label}:answer-source-suggestion:${suggestion.suggestionKey}`}
              className="flex items-start justify-between gap-3 rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-200">{suggestion.title}</div>
                <div className="mt-1 text-[11px] text-gray-500">{suggestion.subtitle}</div>
                <div className="mt-2 break-words text-xs text-gray-400">{suggestion.preview}</div>
              </div>
              <button
                type="button"
                disabled={alreadySelected}
                onClick={() => onSelect(suggestion)}
                className="shrink-0 rounded-lg border border-[#343434] bg-[#111] px-2 py-1 text-[11px] font-medium text-gray-200 transition hover:border-purple-500/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {alreadySelected ? 'Selected' : 'Reuse'}
              </button>
            </div>
          )
        })}
      </div>
    </details>
  )
}
