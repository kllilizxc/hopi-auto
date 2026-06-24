import { SlidersHorizontal } from 'lucide-react'
import type { PreferenceDocument } from '../lib/api'
import {
  MutationFeedback,
  PreferenceAuthorityDetails,
  SurfaceCard,
  SurfaceEmptyState,
} from './boardViewPresentationSupport'
import { summarizePreferenceDocumentMutationResult } from './boardViewMutationResultSupport'
import {
  ReusableSingleValueSuggestions,
  StructuredStringListEditor,
} from './boardViewStructuredEditorPresentationSupport'
import { parseListInput } from './boardViewStructuredEditorCodec'
import type { ReusableStringSuggestion } from './boardViewStructuredEditorTypes'

const PREFERENCE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function PreferencePanel({
  document,
  reusablePreferenceKeySuggestions,
  preferenceEditor,
  preferenceEditorDirty,
  onPreferenceEditorChange,
  onSavePreferences,
  savePending,
  saveError,
  saveResult,
  preferenceDraft,
  onPreferenceDraftChange,
  onRecordPreference,
  recordPending,
  recordError,
  recordResult,
  recordResultPreferenceKey,
  recordResultSummary,
  retireDraft,
  onRetireDraftChange,
  onRetirePreference,
  retirePending,
  retireError,
  retireResult,
  retireResultPreferenceKey,
}: {
  document?: PreferenceDocument
  reusablePreferenceKeySuggestions?: ReusableStringSuggestion[]
  preferenceEditor: string
  preferenceEditorDirty: boolean
  onPreferenceEditorChange: (value: string) => void
  onSavePreferences: () => void
  savePending: boolean
  saveError: Error | null
  saveResult?: PreferenceDocument
  preferenceDraft: {
    preferenceKey: string
    summary: string
    rationale: string
    supersedes: string
  }
  onPreferenceDraftChange: (
    field: 'preferenceKey' | 'summary' | 'rationale' | 'supersedes',
    value: string,
  ) => void
  onRecordPreference: () => void
  recordPending: boolean
  recordError: Error | null
  recordResult?: PreferenceDocument
  recordResultPreferenceKey?: string | null
  recordResultSummary?: string | null
  retireDraft: {
    preferenceKey: string
    reason: string
    supersededBy: string
  }
  onRetireDraftChange: (field: 'preferenceKey' | 'reason' | 'supersededBy', value: string) => void
  onRetirePreference: () => void
  retirePending: boolean
  retireError: Error | null
  retireResult?: PreferenceDocument
  retireResultPreferenceKey?: string | null
}) {
  const entries = document?.entries ?? []
  const active = entries.filter((entry) => entry.status === 'active')
  const retired = entries.filter((entry) => entry.status === 'retired')
  const activePreferenceKeys = new Set(active.map((entry) => entry.preferenceKey))
  const reusableRecordPreferenceKeySuggestions = reusablePreferenceKeySuggestions ?? []
  const reusableSupersedesSuggestions = (reusablePreferenceKeySuggestions ?? []).filter(
    (suggestion) =>
      activePreferenceKeys.has(suggestion.value.trim()) &&
      suggestion.value.trim() !== preferenceDraft.preferenceKey.trim(),
  )
  const reusableRetireReplacementSuggestions = (reusablePreferenceKeySuggestions ?? []).filter(
    (suggestion) =>
      activePreferenceKeys.has(suggestion.value.trim()) &&
      suggestion.value.trim() !== retireDraft.preferenceKey.trim(),
  )
  const recordedEntry =
    recordResult && recordResultPreferenceKey
      ? recordResult.entries.find((entry) => entry.preferenceKey === recordResultPreferenceKey)
      : null
  const retiredEntry =
    retireResult && retireResultPreferenceKey
      ? retireResult.entries.find((entry) => entry.preferenceKey === retireResultPreferenceKey)
      : null

  return (
    <SurfaceCard
      icon={<SlidersHorizontal className="w-4 h-4 text-purple-400" />}
      title="Preferences"
      subtitle={`${active.length} active · ${retired.length} retired`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Preference Document</div>
          <textarea
            value={preferenceEditor}
            onChange={(event) => onPreferenceEditorChange(event.target.value)}
            rows={8}
            className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-xs leading-6 text-gray-100 outline-none transition focus:border-purple-500/50 font-mono"
            placeholder="```yaml ... ```"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-[11px] text-gray-500">
              {preferenceEditorDirty
                ? 'Preference document has unsaved edits.'
                : 'Preference document is in sync.'}
            </div>
            <button
              onClick={onSavePreferences}
              disabled={
                savePending || preferenceEditor.trim().length === 0 || !preferenceEditorDirty
              }
              className="rounded-lg bg-[#2a2a2a] px-3 py-2 text-sm font-medium text-gray-100 transition hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savePending ? 'Saving...' : 'Save Preference Document'}
            </button>
          </div>
          {saveError && <div className="mt-2 text-[11px] text-red-300">{saveError.message}</div>}
          {saveResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizePreferenceDocumentMutationResult(saveResult)}</div>
              {saveResult.entries.length > 0 && (
                <div className="mt-2 space-y-2">
                  {saveResult.entries.map((entry) => (
                    <PreferenceAuthorityDetails
                      key={`save-result:${entry.preferenceKey}`}
                      entry={entry}
                      allEntries={saveResult.entries}
                      className="border-violet-500/15 bg-[#111]"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Record Preference</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Summary</span>
              <input
                value={preferenceDraft.summary}
                onChange={(event) => onPreferenceDraftChange('summary', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Prefer Bun-first tooling"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Preference Key
              </span>
              <input
                value={preferenceDraft.preferenceKey}
                onChange={(event) => onPreferenceDraftChange('preferenceKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional stable key"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current preference keys"
                value={preferenceDraft.preferenceKey}
                onSelect={(value) => onPreferenceDraftChange('preferenceKey', value)}
                suggestions={reusableRecordPreferenceKeySuggestions}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Rationale</span>
              <textarea
                value={preferenceDraft.rationale}
                onChange={(event) => onPreferenceDraftChange('rationale', event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Why this should be durable project policy."
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Supersedes</span>
              <input
                value={preferenceDraft.supersedes}
                onChange={(event) => onPreferenceDraftChange('supersedes', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="comma or newline separated preference keys"
              />
              <StructuredStringListEditor
                label="Structured superseded preferences"
                value={preferenceDraft.supersedes}
                onChange={(value) => onPreferenceDraftChange('supersedes', value)}
                itemLabel="Preference key"
                addLabel="Add key"
                placeholder="bun-first-tooling"
                emptyLabel="No structured superseded preference keys yet."
                suggestions={reusableSupersedesSuggestions}
                suggestionSummaryLabel="Reuse current preference keys"
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={recordError} />
            <button
              onClick={onRecordPreference}
              disabled={
                recordPending ||
                preferenceDraft.summary.trim().length === 0 ||
                !hasValidOptionalPreferenceKey(preferenceDraft.preferenceKey) ||
                !hasValidPreferenceKeyListOrEmpty(preferenceDraft.supersedes)
              }
              className="rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recordPending ? 'Recording...' : 'Record Preference'}
            </button>
          </div>
          {recordResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>
                {recordedEntry
                  ? `Recorded ${recordedEntry.preferenceKey} (${recordedEntry.status}).`
                  : recordResultSummary
                    ? `Recorded preference: ${recordResultSummary}.`
                    : summarizePreferenceDocumentMutationResult(recordResult)}
              </div>
              {recordedEntry && (
                <PreferenceAuthorityDetails
                  entry={recordedEntry}
                  allEntries={recordResult.entries}
                  className="mt-2 border-violet-500/15 bg-[#111]"
                />
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Retire Preference</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Preference Key
              </span>
              <select
                value={retireDraft.preferenceKey}
                onChange={(event) => onRetireDraftChange('preferenceKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                {active.length === 0 ? (
                  <option value="">No active preferences</option>
                ) : (
                  active.map((entry) => (
                    <option key={entry.preferenceKey} value={entry.preferenceKey}>
                      {entry.preferenceKey}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Superseded By
              </span>
              <input
                value={retireDraft.supersededBy}
                onChange={(event) => onRetireDraftChange('supersededBy', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional preference key"
              />
              <ReusableSingleValueSuggestions
                label="Reuse current preference keys"
                value={retireDraft.supersededBy}
                onSelect={(value) => onRetireDraftChange('supersededBy', value)}
                suggestions={reusableRetireReplacementSuggestions}
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Reason</span>
              <textarea
                value={retireDraft.reason}
                onChange={(event) => onRetireDraftChange('reason', event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Why this preference should retire."
              />
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={retireError} />
            <button
              onClick={onRetirePreference}
              disabled={
                retirePending ||
                retireDraft.preferenceKey.trim().length === 0 ||
                retireDraft.reason.trim().length === 0 ||
                !hasValidOptionalPreferenceKey(retireDraft.supersededBy)
              }
              className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retirePending ? 'Retiring...' : 'Retire Preference'}
            </button>
          </div>
          {retireResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>
                {retireResultPreferenceKey
                  ? `Retired ${retireResultPreferenceKey}.`
                  : summarizePreferenceDocumentMutationResult(retireResult)}
              </div>
              {retiredEntry && (
                <PreferenceAuthorityDetails
                  entry={retiredEntry}
                  allEntries={retireResult.entries}
                  className="mt-2 border-violet-500/15 bg-[#111]"
                />
              )}
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <SurfaceEmptyState label="No durable preferences yet." />
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <PreferenceAuthorityDetails
                key={entry.preferenceKey}
                entry={entry}
                allEntries={entries}
              />
            ))}
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}

function hasValidOptionalPreferenceKey(value: string) {
  const normalized = value.trim()
  return normalized.length === 0 || PREFERENCE_KEY_PATTERN.test(normalized)
}

function hasValidPreferenceKeyListOrEmpty(source: string) {
  return parseListInput(source).every((entry) => PREFERENCE_KEY_PATTERN.test(entry))
}
