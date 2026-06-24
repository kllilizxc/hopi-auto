import type { ReactNode } from 'react'
import type {
  BlockerRef,
  GoalDecision,
  GoalPlanningRequest,
  GoalSourceResponseFormat,
  PreferenceEntry,
} from '../lib/api'
import { cn } from '../lib/utils'
import type {
  GoalDecisionFollowThroughResultWithReuse,
  GoalPlanningWorkflowCreateResultWithReuse,
} from './boardViewMutationResultSupport'
import {
  formatTimestamp,
  listReusedMutationRefs,
  summarizeDecisionFollowThroughResult,
} from './boardViewMutationResultSupport'
import { summarizeCapturedAnswer } from './boardViewReusableSuggestions'

export function SurfaceCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="rounded-2xl border border-[#2f2f2f] bg-[#1D1D1D] p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-white font-medium">
            {icon}
            {title}
          </div>
          <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

export function SurfaceEmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#313131] bg-[#191919] px-4 py-6 text-center text-sm text-gray-500">
      {label}
    </div>
  )
}

export function MutationFeedback({ error }: { error: Error | null }) {
  if (!error) {
    return <div className="text-[11px] text-gray-500">Writes go through the current Bun API.</div>
  }

  return <div className="text-[11px] text-red-300">{error.message}</div>
}

export function DecisionMutationAuthorityCard({
  decision,
  extra,
}: {
  decision: GoalDecision & {
    created?: boolean
  }
  extra?: ReactNode
}) {
  return (
    <div className="mt-2 rounded-lg border border-violet-500/15 bg-[#161616] px-3 py-2 text-[11px] text-violet-100">
      <div className="font-medium text-violet-100">{decision.summary}</div>
      <div className="mt-1 font-mono text-violet-300">{decision.decisionKey}</div>
      <DecisionAuthorityDetails
        decision={decision}
        tone="violet"
        prefixLines={
          <>
            {typeof decision.created === 'boolean' && (
              <div>Created decision topic: {decision.created ? 'yes' : 'no'}</div>
            )}
            <div>Status: {decision.status}</div>
          </>
        }
        suffixLines={extra}
      />
    </div>
  )
}

export function DecisionAuthorityDetails({
  decision,
  tone = 'violet',
  includeDecisionKeyInMeta = false,
  prefixLines,
  suffixLines,
}: {
  decision: GoalDecision
  tone?: 'violet' | 'gray'
  includeDecisionKeyInMeta?: boolean
  prefixLines?: ReactNode
  suffixLines?: ReactNode
}) {
  const metaLine = [
    includeDecisionKeyInMeta ? decision.decisionKey : null,
    decision.taskRef ? `task:${decision.taskRef}` : null,
  ]
    .filter((item) => item && item.length > 0)
    .join(' · ')

  const detailLines = (
    <>
      {decision.summaryKey && <div>Summary key: {decision.summaryKey}</div>}
      {decision.matchHints && decision.matchHints.length > 0 && (
        <div>Match hints: {decision.matchHints.join(', ')}</div>
      )}
      {decision.captureFormat && <div>Capture format: {decision.captureFormat}</div>}
      {decision.taskRef && <div>Linked task: {decision.taskRef}</div>}
      <div>Created: {formatTimestamp(decision.createdAt)}</div>
      {decision.resolvedAt && <div>Resolved: {formatTimestamp(decision.resolvedAt)}</div>}
    </>
  )

  if (tone === 'gray') {
    return (
      <>
        <div className="mt-2 space-y-1 text-xs text-gray-400">
          {prefixLines}
          {metaLine && <div className="font-mono text-gray-500">{metaLine}</div>}
          {detailLines}
          {suffixLines}
        </div>
        {decision.prompt && (
          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-400">
            {decision.prompt}
          </div>
        )}
        {decision.answer && (
          <div className="mt-2 whitespace-pre-wrap text-xs text-emerald-200">{decision.answer}</div>
        )}
      </>
    )
  }

  return (
    <>
      {metaLine && <div className="mt-1 font-mono text-violet-300">{metaLine}</div>}
      <div className="mt-1 space-y-1 text-violet-100">
        {prefixLines}
        {detailLines}
        {suffixLines}
      </div>
      {decision.prompt && (
        <div className="mt-1 whitespace-pre-wrap text-violet-100">{decision.prompt}</div>
      )}
      {decision.answer && (
        <div className="mt-1 whitespace-pre-wrap text-violet-100">{decision.answer}</div>
      )}
    </>
  )
}

export function PlanningRequestAuthorityDetails({
  request,
  tone = 'violet',
  includeRequestKeyInMeta = false,
  prefixLines,
  suffixLines,
}: {
  request: GoalPlanningRequest & { resolvedSourceResponseFormat?: GoalSourceResponseFormat }
  tone?: 'violet' | 'gray'
  includeRequestKeyInMeta?: boolean
  prefixLines?: ReactNode
  suffixLines?: ReactNode
}) {
  const metaLine = [
    includeRequestKeyInMeta ? request.requestKey : null,
    request.taskRef,
    request.workflowKey ? `workflow:${request.workflowKey}` : null,
    request.workflowTaskKey ? `child:${request.workflowTaskKey}` : null,
    request.groupKey ? `group:${request.groupKey}` : null,
    request.groupTaskKey ? `grouped-task:${request.groupTaskKey}` : null,
  ]
    .filter((item) => item && item.length > 0)
    .join(' · ')

  const detailLines = (
    <>
      {request.acceptanceCriteria.length > 0 && (
        <div>Acceptance criteria: {request.acceptanceCriteria.join(' | ')}</div>
      )}
      {request.blockedByWorkflowKeys.length > 0 && (
        <div>Workflow dependencies: {request.blockedByWorkflowKeys.join(', ')}</div>
      )}
      {request.decisionRefs.length > 0 && (
        <div>Decision refs: {request.decisionRefs.join(', ')}</div>
      )}
      {request.workflowSharedDecisionRefs.length > 0 && (
        <div>Workflow-shared decisions: {request.workflowSharedDecisionRefs.join(', ')}</div>
      )}
      {request.answers.length > 0 && (
        <div>Answers: {request.answers.map(summarizeCapturedAnswer).join(' | ')}</div>
      )}
      {request.workflowSharedAnswers.length > 0 && (
        <div>
          Workflow-shared answers:{' '}
          {request.workflowSharedAnswers.map(summarizeCapturedAnswer).join(' | ')}
        </div>
      )}
      {request.requestedUpdates.length > 0 && (
        <div>Requested updates: {request.requestedUpdates.join(', ')}</div>
      )}
      <div>Created: {formatTimestamp(request.createdAt)}</div>
      {request.resolvedSourceResponseFormat && (
        <div>Resolved source-response format: {request.resolvedSourceResponseFormat}</div>
      )}
      {request.resolution && <div>Resolution: {request.resolution}</div>}
      {request.resolvedAt && <div>Resolved: {formatTimestamp(request.resolvedAt)}</div>}
    </>
  )

  if (tone === 'gray') {
    return (
      <>
        {request.description.trim().length > 0 && (
          <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-gray-400">
            {request.description}
          </div>
        )}
        <div className="mt-2 space-y-1 text-xs text-gray-400">
          {prefixLines}
          <div className="font-mono text-gray-500">{metaLine}</div>
          {detailLines}
          {suffixLines}
        </div>
      </>
    )
  }

  return (
    <>
      {request.description.trim().length > 0 && (
        <div className="mt-1 whitespace-pre-wrap text-violet-200/80">{request.description}</div>
      )}
      <div className="mt-1 font-mono text-violet-200/80">{metaLine}</div>
      {prefixLines}
      {detailLines}
      {suffixLines}
    </>
  )
}

export function MutationPlanningRequestAuthorityCard({
  request,
  extra,
}: {
  request: GoalPlanningRequest
  extra?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-violet-500/15 bg-[#111] px-3 py-2 text-[11px] text-violet-100">
      <div>
        {request.requestKey} [{request.status}] {request.title}
      </div>
      <PlanningRequestAuthorityDetails request={request} tone="violet" suffixLines={extra} />
    </div>
  )
}

export function DecisionFollowThroughResultCard({
  followThrough,
}: {
  followThrough: GoalDecisionFollowThroughResultWithReuse
}) {
  return (
    <div className="mt-2 rounded-lg border border-violet-500/15 bg-[#161616] px-3 py-2 text-[11px] text-violet-100">
      <div className="font-medium text-violet-100">Follow-through result</div>
      <div className="mt-1">{summarizeDecisionFollowThroughResult(followThrough)}</div>
      {'workflowKey' in followThrough && followThrough.workflowKey && (
        <div className="mt-1">Workflow key: {followThrough.workflowKey}</div>
      )}
      {typeof followThrough.workflowCreated === 'boolean' && (
        <div className="mt-1">
          Created workflow graph: {followThrough.workflowCreated ? 'yes' : 'no'}
        </div>
      )}
      {'workflowSharedDecisionRefs' in followThrough &&
        followThrough.workflowSharedDecisionRefs.length > 0 && (
          <div className="mt-1">
            Shared decision refs: {followThrough.workflowSharedDecisionRefs.join(', ')}
          </div>
        )}
      {'workflowSharedAnswers' in followThrough && followThrough.workflowSharedAnswers.length > 0 && (
        <div className="mt-1">
          Shared answers:{' '}
          {followThrough.workflowSharedAnswers.map(summarizeCapturedAnswer).join(' | ')}
        </div>
      )}
      {'groupKey' in followThrough && followThrough.groupKey && (
        <div className="mt-1">Group key: {followThrough.groupKey}</div>
      )}
      {'groupKeys' in followThrough && followThrough.groupKeys.length > 0 && (
        <div className="mt-1">Group keys: {followThrough.groupKeys.join(', ')}</div>
      )}
      {followThrough.createdGroupKeys.length > 0 && (
        <div className="mt-1">Created group keys: {followThrough.createdGroupKeys.join(', ')}</div>
      )}
      {followThrough.reusedGroupKeys.length > 0 && (
        <div className="mt-1">Reused group keys: {followThrough.reusedGroupKeys.join(', ')}</div>
      )}
      {followThrough.requestKeys.length > 0 && (
        <div className="mt-1">Request keys: {followThrough.requestKeys.join(', ')}</div>
      )}
      {followThrough.createdRequestKeys.length > 0 && (
        <div className="mt-1">Created request keys: {followThrough.createdRequestKeys.join(', ')}</div>
      )}
      {followThrough.reusedRequestKeys.length > 0 && (
        <div className="mt-1">Reused request keys: {followThrough.reusedRequestKeys.join(', ')}</div>
      )}
      {followThrough.taskRefs.length > 0 && (
        <div className="mt-1">Task refs: {followThrough.taskRefs.join(', ')}</div>
      )}
      {followThrough.createdTaskRefs.length > 0 && (
        <div className="mt-1">Created task refs: {followThrough.createdTaskRefs.join(', ')}</div>
      )}
      {followThrough.reusedTaskRefs.length > 0 && (
        <div className="mt-1">Reused task refs: {followThrough.reusedTaskRefs.join(', ')}</div>
      )}
      {followThrough.blockerTaskRefs.length > 0 && (
        <div className="mt-1">Blocker task refs: {followThrough.blockerTaskRefs.join(', ')}</div>
      )}
      {'workflows' in followThrough && followThrough.workflows.length > 0 && (
        <div className="mt-2 space-y-2">
          <div className="font-medium text-violet-100">Workflow children</div>
          {followThrough.workflows.map((workflow, index) => (
            <div
              key={`follow-through-workflow:${followThrough.workflowKey ?? 'new'}:${index}`}
              className="rounded-lg border border-violet-500/15 bg-[#111] px-3 py-2 text-[11px] text-violet-100"
            >
              <div>
                Child {index + 1}: {workflow.kind}
                {'workflowTaskKey' in workflow && workflow.workflowTaskKey
                  ? ` · ${workflow.workflowTaskKey}`
                  : ''}
                {'groupKey' in workflow && workflow.groupKey ? ` · ${workflow.groupKey}` : ''}
              </div>
              {workflow.createdGroupKeys.length > 0 && (
                <div className="mt-1">Created groups: {workflow.createdGroupKeys.join(', ')}</div>
              )}
              {workflow.reusedGroupKeys.length > 0 && (
                <div className="mt-1">Reused groups: {workflow.reusedGroupKeys.join(', ')}</div>
              )}
              {workflow.requestKeys.length > 0 && (
                <div className="mt-1">Requests: {workflow.requestKeys.join(', ')}</div>
              )}
              {workflow.createdRequestKeys.length > 0 && (
                <div className="mt-1">Created requests: {workflow.createdRequestKeys.join(', ')}</div>
              )}
              {workflow.reusedRequestKeys.length > 0 && (
                <div className="mt-1">Reused requests: {workflow.reusedRequestKeys.join(', ')}</div>
              )}
              {workflow.taskRefs.length > 0 && (
                <div className="mt-1">Tasks: {workflow.taskRefs.join(', ')}</div>
              )}
              {workflow.createdTaskRefs.length > 0 && (
                <div className="mt-1">Created tasks: {workflow.createdTaskRefs.join(', ')}</div>
              )}
              {workflow.reusedTaskRefs.length > 0 && (
                <div className="mt-1">Reused tasks: {workflow.reusedTaskRefs.join(', ')}</div>
              )}
              {workflow.blockerTaskRefs.length > 0 && (
                <div className="mt-1">Blockers: {workflow.blockerTaskRefs.join(', ')}</div>
              )}
              {workflow.requests.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="font-medium text-violet-100">Child requests</div>
                  {workflow.requests.map((request) => (
                    <MutationPlanningRequestAuthorityCard
                      key={`follow-through-child-request:${request.requestKey}`}
                      request={request}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {'requests' in followThrough &&
        followThrough.requests.length > 0 &&
        !('workflows' in followThrough && followThrough.workflows.length > 0) && (
          <div className="mt-2 space-y-2">
            <div className="font-medium text-violet-100">Follow-through requests</div>
            {followThrough.requests.map((request) => (
              <MutationPlanningRequestAuthorityCard
                key={`follow-through-request:${request.requestKey}`}
                request={request}
              />
            ))}
          </div>
        )}
    </div>
  )
}

export function WorkflowCreateResultCard({
  result,
}: {
  result: GoalPlanningWorkflowCreateResultWithReuse
}) {
  if (result.workflows.length === 0 && result.requests.length === 0) {
    return null
  }

  const reusedRequestKeys = listReusedMutationRefs(result.requestKeys, result.createdRequestKeys)
  const reusedTaskRefs = listReusedMutationRefs(result.taskRefs, result.createdTaskRefs)

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-violet-500/15 bg-[#161616] px-3 py-2 text-[11px] text-violet-100">
      <div className="space-y-1 rounded-lg border border-violet-500/15 bg-[#111] px-3 py-2">
        <div className="font-medium text-violet-100">Workflow root</div>
        <div>Created workflow graph: {result.workflowCreated ? 'yes' : 'no'}</div>
        <div>Created workflow requests: {result.createdRequestKeys.length > 0 ? 'yes' : 'no'}</div>
        <div>Created workflow tasks: {result.createdTaskRefs.length > 0 ? 'yes' : 'no'}</div>
        {result.workflowKey && <div>Workflow key: {result.workflowKey}</div>}
        {result.groupKeys.length > 0 && <div>Group keys: {result.groupKeys.join(', ')}</div>}
        {result.createdGroupKeys.length > 0 && (
          <div>Created group keys: {result.createdGroupKeys.join(', ')}</div>
        )}
        {result.reusedGroupKeys.length > 0 && (
          <div>Reused group keys: {result.reusedGroupKeys.join(', ')}</div>
        )}
        {result.requestKeys.length > 0 && <div>Request keys: {result.requestKeys.join(', ')}</div>}
        {result.taskRefs.length > 0 && <div>Task refs: {result.taskRefs.join(', ')}</div>}
        {result.createdRequestKeys.length > 0 && (
          <div>Created request keys: {result.createdRequestKeys.join(', ')}</div>
        )}
        {reusedRequestKeys.length > 0 && (
          <div>Reused request keys: {reusedRequestKeys.join(', ')}</div>
        )}
        {result.createdTaskRefs.length > 0 && (
          <div>Created task refs: {result.createdTaskRefs.join(', ')}</div>
        )}
        {reusedTaskRefs.length > 0 && <div>Reused task refs: {reusedTaskRefs.join(', ')}</div>}
        {result.blockerTaskRefs.length > 0 && (
          <div>Blocker task refs: {result.blockerTaskRefs.join(', ')}</div>
        )}
      </div>
      {(result.workflowSharedDecisionRefs.length > 0 || result.workflowSharedAnswers.length > 0) && (
        <div className="space-y-1 rounded-lg border border-violet-500/15 bg-[#111] px-3 py-2">
          <div className="font-medium text-violet-100">Shared Context</div>
          {result.workflowSharedDecisionRefs.length > 0 && (
            <div>Shared decision refs: {result.workflowSharedDecisionRefs.join(', ')}</div>
          )}
          {result.workflowSharedAnswers.length > 0 && (
            <div>
              Shared answers: {result.workflowSharedAnswers.map(summarizeCapturedAnswer).join(' | ')}
            </div>
          )}
        </div>
      )}
      {result.workflows.length > 0 && (
        <div className="space-y-2">
          <div className="font-medium text-violet-100">Workflow children</div>
          {result.workflows.map((workflow, index) => {
            const reusedRequestKeys = listReusedMutationRefs(
              workflow.requestKeys,
              workflow.createdRequestKeys,
            )
            const reusedTaskRefs = listReusedMutationRefs(
              workflow.taskRefs,
              workflow.createdTaskRefs,
            )

            return (
              <div
                key={`workflow-create-child:${result.workflowKey ?? 'new'}:${index}`}
                className="rounded-lg border border-violet-500/15 bg-[#111] px-3 py-2 text-[11px] text-violet-100"
              >
                <div>
                  Child {index + 1}: {workflow.kind}
                  {'workflowTaskKey' in workflow && workflow.workflowTaskKey
                    ? ` · ${workflow.workflowTaskKey}`
                    : ''}
                  {'groupKey' in workflow && workflow.groupKey ? ` · ${workflow.groupKey}` : ''}
                </div>
                {workflow.createdGroupKeys.length > 0 && (
                  <div className="mt-1">Created groups: {workflow.createdGroupKeys.join(', ')}</div>
                )}
                {workflow.reusedGroupKeys.length > 0 && (
                  <div className="mt-1">Reused groups: {workflow.reusedGroupKeys.join(', ')}</div>
                )}
                {workflow.requestKeys.length > 0 && (
                  <div className="mt-1">Requests: {workflow.requestKeys.join(', ')}</div>
                )}
                {workflow.taskRefs.length > 0 && (
                  <div className="mt-1">Tasks: {workflow.taskRefs.join(', ')}</div>
                )}
                {workflow.createdRequestKeys.length > 0 && (
                  <div className="mt-1">Created requests: {workflow.createdRequestKeys.join(', ')}</div>
                )}
                {reusedRequestKeys.length > 0 && (
                  <div className="mt-1">Reused requests: {reusedRequestKeys.join(', ')}</div>
                )}
                {workflow.createdTaskRefs.length > 0 && (
                  <div className="mt-1">Created tasks: {workflow.createdTaskRefs.join(', ')}</div>
                )}
                {reusedTaskRefs.length > 0 && (
                  <div className="mt-1">Reused tasks: {reusedTaskRefs.join(', ')}</div>
                )}
                {workflow.blockerTaskRefs.length > 0 && (
                  <div className="mt-1">Blockers: {workflow.blockerTaskRefs.join(', ')}</div>
                )}
                {workflow.requests.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="font-medium text-violet-100">Child requests</div>
                    {workflow.requests.map((request) => (
                      <MutationPlanningRequestAuthorityCard
                        key={`workflow-create-child-request:${request.requestKey}`}
                        request={request}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {result.requests.length > 0 && result.workflows.length === 0 && (
        <div className="space-y-2">
          <div className="font-medium text-violet-100">Workflow requests</div>
          {result.requests.map((request) => (
            <MutationPlanningRequestAuthorityCard
              key={`workflow-create-request:${request.requestKey}`}
              request={request}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskBlockerSummary({ blockers }: { blockers: BlockerRef[] }) {
  if (blockers.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {blockers.map((blocker) => (
        <span
          key={`${blocker.kind}:${blocker.ref}`}
          className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 text-[10px] font-mono text-blue-300"
        >
          {blocker.kind}: {blocker.ref}
        </span>
      ))}
    </div>
  )
}

export function PreferenceAuthorityDetails({
  entry,
  allEntries = [],
  className,
}: {
  entry: PreferenceEntry
  allEntries?: PreferenceEntry[]
  className?: string
}) {
  const supersededEntries = allEntries.filter(
    (candidate) => candidate.supersededBy === entry.preferenceKey,
  )

  return (
    <div className={cn('rounded-xl border border-[#303030] bg-[#191919] px-4 py-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">{entry.summary}</div>
          <div className="mt-1 break-words text-xs font-mono text-gray-500">
            {entry.preferenceKey}
          </div>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
            entry.status === 'active'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-gray-500/20 bg-gray-500/10 text-gray-300',
          )}
        >
          {entry.status}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs text-gray-400">
        {supersededEntries.length > 0 && (
          <div>Supersedes: {supersededEntries.map((item) => item.preferenceKey).join(', ')}</div>
        )}
        {entry.supersededBy && <div>Superseded by: {entry.supersededBy}</div>}
      </div>

      {entry.rationale && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Rationale
          </div>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-300">
            {entry.rationale}
          </div>
        </div>
      )}

      {entry.retiredReason && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Retired Reason
          </div>
          <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-gray-300">
            {entry.retiredReason}
          </div>
        </div>
      )}
    </div>
  )
}
