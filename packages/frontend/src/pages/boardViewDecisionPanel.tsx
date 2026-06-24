import { Scale } from 'lucide-react'
import type {
  GoalDecision,
  GoalDecisionSet,
  GoalSourceResponseFormat,
} from '../lib/api'
import {
  ReusableSingleValueSuggestions,
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
import type { GoalDecisionFollowThroughResultWithReuse } from './boardViewMutationResultSupport'
import { summarizeDecisionMutationResult } from './boardViewMutationResultSupport'
import {
  DecisionMutationAuthorityCard,
  MutationFeedback,
  SurfaceCard,
  SurfaceEmptyState,
} from './boardViewPresentationSupport'
import { DecisionTopicCard } from './boardViewDecisionTopicCard'
import {
  type DecisionResolutionDraft,
  DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT,
  DEFAULT_DECISION_RESOLUTION_DRAFT,
} from './boardViewDraftSupport'

type DecisionDraft = {
  decisionKey: string
  summary: string
  summaryKey: string
  prompt: string
  matchHints: string
  taskRef: string
}

export function DecisionPanel({
  decisions,
  decisionDraft,
  onDecisionDraftChange,
  onCreateDecision,
  createPending,
  createError,
  createResult,
  decisionResolutionDrafts,
  decisionFollowThroughDrafts,
  onDecisionResolutionDraftChange,
  onDecisionFollowThroughChange,
  onResolveDecision,
  resolvePendingDecisionKey,
  resolveError,
  resolveResultDecisionKey,
  resolveResult,
  reusableAnswerSourceSuggestions,
  reusablePlanningAnswerSuggestions,
  reusablePlanningRequestSuggestions,
  reusableTaskRefSuggestions,
  reusableBlockerSuggestions,
  reusablePlanningRequestKeySuggestions,
  reusablePlanningGroupKeySuggestions,
  reusablePlanningGroupTaskKeySuggestions,
  reusableBatchRequestSuggestions,
  reusableBatchRequestGroupSuggestions,
  reusableWorkflowKeySuggestions,
  reusableWorkflowContextSuggestions,
  reusableWorkflowGraphSuggestions,
  reusableDecisionWorkflowChildSuggestions,
  reusableWorkflowTaskRefSuggestions,
  reusableWorkflowGroupKeySuggestions,
}: {
  decisions: GoalDecisionSet['decisions']
  decisionDraft: DecisionDraft
  onDecisionDraftChange: (
    field: 'decisionKey' | 'summary' | 'summaryKey' | 'prompt' | 'matchHints' | 'taskRef',
    value: string,
  ) => void
  onCreateDecision: () => void
  createPending: boolean
  createError: Error | null
  createResult?: GoalDecision & {
    created: boolean
  }
  decisionResolutionDrafts: Record<string, DecisionResolutionDraft>
  decisionFollowThroughDrafts: Record<string, DecisionFollowThroughDraft>
  onDecisionResolutionDraftChange: (
    decisionKey: string,
    field: keyof DecisionResolutionDraft,
    value: string,
  ) => void
  onDecisionFollowThroughChange: (
    decisionKey: string,
    field: keyof DecisionFollowThroughDraft,
    value: string | boolean,
  ) => void
  onResolveDecision: (decision: GoalDecision) => void
  resolvePendingDecisionKey: string | null
  resolveError: Error | null
  resolveResultDecisionKey: string | null
  resolveResult?:
    | {
        decision: GoalDecision
        blockerRemoved?: boolean
        followThrough?: GoalDecisionFollowThroughResultWithReuse
        resolvedSourceResponseFormat?: GoalSourceResponseFormat
      }
    | undefined
  reusableAnswerSourceSuggestions: ReusableAnswerSourceSuggestion[]
  reusablePlanningAnswerSuggestions: ReusablePlanningAnswerSuggestion[]
  reusablePlanningRequestSuggestions: ReusablePlanningRequestSuggestion[]
  reusableTaskRefSuggestions: ReusableStringSuggestion[]
  reusableBlockerSuggestions: ReusableBlockerSuggestion[]
  reusablePlanningRequestKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupKeySuggestions: ReusableStringSuggestion[]
  reusablePlanningGroupTaskKeySuggestions: ReusableStringSuggestion[]
  reusableBatchRequestSuggestions: ReusableBatchRequestSuggestion[]
  reusableBatchRequestGroupSuggestions: ReusableBatchRequestGroupSuggestion[]
  reusableWorkflowKeySuggestions: ReusableStringSuggestion[]
  reusableWorkflowContextSuggestions: ReusableWorkflowContextSuggestion[]
  reusableWorkflowGraphSuggestions: ReusableWorkflowGraphSuggestion[]
  reusableDecisionWorkflowChildSuggestions: ReusableDecisionWorkflowChildSuggestion[]
  reusableWorkflowTaskRefSuggestions: ReusableStringSuggestion[]
  reusableWorkflowGroupKeySuggestions: ReusableStringSuggestion[]
}) {
  const open = decisions.filter((decision) => decision.status === 'open')
  const resolved = decisions.filter((decision) => decision.status === 'resolved')

  return (
    <SurfaceCard
      icon={<Scale className="w-4 h-4 text-purple-400" />}
      title="Decision Topics"
      subtitle={`${open.length} open · ${resolved.length} resolved`}
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Open Decision Topic</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Summary</span>
              <input
                value={decisionDraft.summary}
                onChange={(event) => onDecisionDraftChange('summary', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Auth strategy"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Decision Key
              </span>
              <input
                value={decisionDraft.decisionKey}
                onChange={(event) => onDecisionDraftChange('decisionKey', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Prompt</span>
              <input
                value={decisionDraft.prompt}
                onChange={(event) => onDecisionDraftChange('prompt', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="What should auth strategy be?"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Linked Task</span>
              <input
                value={decisionDraft.taskRef}
                onChange={(event) => onDecisionDraftChange('taskRef', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="optional"
              />
            </label>
            <div className="md:col-span-2">
              <ReusableSingleValueSuggestions
                label="Reuse current visible task refs"
                value={decisionDraft.taskRef}
                onSelect={(value) => onDecisionDraftChange('taskRef', value)}
                suggestions={reusableTaskRefSuggestions}
              />
            </div>
            <details className="md:col-span-2 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3">
              <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Advanced matching fields
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Summary Key
                  </span>
                  <input
                    value={decisionDraft.summaryKey}
                    onChange={(event) => onDecisionDraftChange('summaryKey', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="optional"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-gray-500">
                    Match Hints
                  </span>
                  <input
                    value={decisionDraft.matchHints}
                    onChange={(event) => onDecisionDraftChange('matchHints', event.target.value)}
                    className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                    placeholder="comma or newline separated"
                  />
                  <StructuredStringListEditor
                    label="Structured match hints"
                    value={decisionDraft.matchHints}
                    onChange={(value) => onDecisionDraftChange('matchHints', value)}
                    itemLabel="Match hint"
                    addLabel="Add hint"
                    placeholder="auth strategy"
                    emptyLabel="No structured match hints yet."
                  />
                </label>
              </div>
            </details>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={createError} />
            <button
              onClick={onCreateDecision}
              disabled={createPending || decisionDraft.summary.trim().length === 0}
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createPending ? 'Opening...' : 'Open Decision'}
            </button>
          </div>
          {createResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizeDecisionMutationResult(createResult)}</div>
              <DecisionMutationAuthorityCard decision={createResult} />
            </div>
          )}
        </div>

        {decisions.length === 0 ? (
          <SurfaceEmptyState label="No decision topics yet." />
        ) : (
          <div className="space-y-3">
            {decisions.map((decision) => {
              const resolutionDraft =
                decisionResolutionDrafts[decision.decisionKey] ?? DEFAULT_DECISION_RESOLUTION_DRAFT
              const followThroughDraft =
                decisionFollowThroughDrafts[decision.decisionKey] ??
                DEFAULT_DECISION_FOLLOW_THROUGH_DRAFT

              return (
                <DecisionTopicCard
                  key={decision.decisionKey}
                  decision={decision}
                  resolutionDraft={resolutionDraft}
                  followThroughDraft={followThroughDraft}
                  onDecisionResolutionDraftChange={(field, value) =>
                    onDecisionResolutionDraftChange(decision.decisionKey, field, value)
                  }
                  onDecisionFollowThroughChange={(field, value) =>
                    onDecisionFollowThroughChange(decision.decisionKey, field, value)
                  }
                  onResolveDecision={() => onResolveDecision(decision)}
                  isResolvePending={resolvePendingDecisionKey === decision.decisionKey}
                  resolveError={
                    resolvePendingDecisionKey === decision.decisionKey ? resolveError : null
                  }
                  resolutionResult={
                    resolveResultDecisionKey === decision.decisionKey ? resolveResult : undefined
                  }
                  reusableAnswerSourceSuggestions={reusableAnswerSourceSuggestions}
                  reusablePlanningAnswerSuggestions={reusablePlanningAnswerSuggestions}
                  reusablePlanningRequestSuggestions={reusablePlanningRequestSuggestions}
                  reusableTaskRefSuggestions={reusableTaskRefSuggestions}
                  reusableBlockerSuggestions={reusableBlockerSuggestions}
                  reusablePlanningRequestKeySuggestions={reusablePlanningRequestKeySuggestions}
                  reusablePlanningGroupKeySuggestions={reusablePlanningGroupKeySuggestions}
                  reusablePlanningGroupTaskKeySuggestions={
                    reusablePlanningGroupTaskKeySuggestions
                  }
                  reusableBatchRequestSuggestions={reusableBatchRequestSuggestions}
                  reusableBatchRequestGroupSuggestions={reusableBatchRequestGroupSuggestions}
                  reusableWorkflowKeySuggestions={reusableWorkflowKeySuggestions}
                  reusableWorkflowContextSuggestions={reusableWorkflowContextSuggestions}
                  reusableWorkflowGraphSuggestions={reusableWorkflowGraphSuggestions}
                  reusableDecisionWorkflowChildSuggestions={
                    reusableDecisionWorkflowChildSuggestions
                  }
                  reusableWorkflowTaskRefSuggestions={reusableWorkflowTaskRefSuggestions}
                  reusableWorkflowGroupKeySuggestions={reusableWorkflowGroupKeySuggestions}
                />
              )
            })}
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}
