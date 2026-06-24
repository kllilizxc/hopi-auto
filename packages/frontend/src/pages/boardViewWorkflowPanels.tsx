import type { GoalPlanningWorkflowState, TodoTaskItem } from '../lib/api'
import { cn } from '../lib/utils'
import {
  summarizeCapturedAnswer,
  summarizeWorkflowLeafCapturedAnswers,
  summarizeWorkflowLeafCardTail,
  summarizeWorkflowLeafCardTitle,
  summarizeWorkflowLeafDecisionRefs,
  summarizeWorkflowLeafGroupedRequests,
  summarizeWorkflowLeafRequestStatus,
} from './boardViewReusableSuggestions'
import {
  PlanningRequestAuthorityDetails,
  TaskBlockerSummary,
} from './boardViewPresentationSupport'

export function WorkflowSummaryCard({
  workflow,
  selectedWorkflowKey,
  onSelectWorkflow,
  onPrefillWorkflowKey,
  onPrefillReuseTaskRef,
  onPrefillReuseGroupKey,
}: {
  workflow: GoalPlanningWorkflowState
  selectedWorkflowKey: string | null
  onSelectWorkflow: (workflowKey: string) => void
  onPrefillWorkflowKey: (workflowKey: string) => void
  onPrefillReuseTaskRef: (taskRef: string, workflowKey: string) => void
  onPrefillReuseGroupKey: (groupKey: string, workflowKey: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-[#191919] px-4 py-3',
        selectedWorkflowKey === workflow.workflowKey
          ? 'border-violet-500/30'
          : 'border-[#303030]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{workflow.workflowKey}</div>
          <div className="mt-1 text-xs text-gray-500">
            {workflow.workflows.length} children · {workflow.requestKeys.length} requests
          </div>
        </div>
        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-300">
          workflow
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-400">
        {workflow.taskRefs.map((taskRef) => (
          <span key={taskRef} className="rounded-full bg-[#232323] px-2 py-1 font-mono">
            {taskRef}
          </span>
        ))}
        {workflow.groupKeys.map((groupKey) => (
          <span
            key={groupKey}
            className="rounded-full bg-[#232323] px-2 py-1 font-mono text-violet-300"
          >
            {groupKey}
          </span>
        ))}
      </div>
      {(workflow.workflowSharedDecisionRefs.length > 0 ||
        workflow.workflowSharedAnswers.length > 0 ||
        workflow.groupKeys.length > 0 ||
        workflow.blockerTaskRefs.length > 0 ||
        workflow.workflows.length > 0) && (
        <div className="mt-3 space-y-2 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
          {(workflow.workflowSharedDecisionRefs.length > 0 ||
            workflow.workflowSharedAnswers.length > 0) && (
            <div className="space-y-1 text-xs text-gray-400">
              {workflow.workflowSharedDecisionRefs.length > 0 && (
                <div>
                  Workflow-shared decisions: {workflow.workflowSharedDecisionRefs.join(', ')}
                </div>
              )}
              {workflow.workflowSharedAnswers.length > 0 && (
                <div>
                  Workflow-shared answers:{' '}
                  {workflow.workflowSharedAnswers.map(summarizeCapturedAnswer).join(' | ')}
                </div>
              )}
            </div>
          )}
          {(workflow.groupKeys.length > 0 || workflow.blockerTaskRefs.length > 0) && (
            <div className="space-y-1 text-xs text-gray-400">
              {workflow.groupKeys.length > 0 && (
                <div>Grouped children: {workflow.groupKeys.join(', ')}</div>
              )}
              <div>
                Current tail blockers:{' '}
                {workflow.blockerTaskRefs.length > 0
                  ? workflow.blockerTaskRefs.join(', ')
                  : 'none'}
              </div>
            </div>
          )}
          {workflow.workflows.length > 0 && (
            <div className="space-y-1 text-xs text-gray-400">
              {workflow.workflows.map((workflowChild, index) => {
                const requestStatusSummary = summarizeWorkflowLeafRequestStatus(workflowChild)
                const decisionRefSummary = summarizeWorkflowLeafDecisionRefs(workflowChild)
                const capturedAnswerSummary = summarizeWorkflowLeafCapturedAnswers(workflowChild)
                const groupedRequestSummary =
                  workflowChild.kind === 'planning_batch'
                    ? summarizeWorkflowLeafGroupedRequests(workflowChild)
                    : null

                return (
                  <div key={`${workflow.workflowKey}:card-child:${index}`}>
                    <div>
                      {summarizeWorkflowLeafCardTitle(workflowChild)}
                      {' -> tail '}
                      {summarizeWorkflowLeafCardTail(workflowChild)}
                    </div>
                    {requestStatusSummary && <div>{requestStatusSummary}</div>}
                    {workflowChild.kind === 'planning' && workflowChild.groupKey && (
                      <div>Group key: {workflowChild.groupKey}</div>
                    )}
                    {decisionRefSummary && <div>Decision refs: {decisionRefSummary}</div>}
                    {capturedAnswerSummary && <div>Captured answers: {capturedAnswerSummary}</div>}
                    {workflowChild.blockedByWorkflowKeys.length > 0 && (
                      <div>
                        Depends on workflow children:{' '}
                        {workflowChild.blockedByWorkflowKeys.join(', ')}
                      </div>
                    )}
                    {groupedRequestSummary && <div>Grouped requests: {groupedRequestSummary}</div>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onSelectWorkflow(workflow.workflowKey)}
          className="rounded-lg bg-[#242424] px-3 py-1.5 text-[11px] font-medium text-gray-200 transition hover:bg-[#2d2d2d]"
        >
          {selectedWorkflowKey === workflow.workflowKey ? 'Inspecting' : 'Inspect'}
        </button>
        <button
          onClick={() => onPrefillWorkflowKey(workflow.workflowKey)}
          className="rounded-lg bg-[#242424] px-3 py-1.5 text-[11px] font-medium text-gray-200 transition hover:bg-[#2d2d2d]"
        >
          Extend Workflow
        </button>
        {workflow.taskRefs[0] && (
          <button
            onClick={() =>
              onPrefillReuseTaskRef(workflow.taskRefs[0] as string, workflow.workflowKey)
            }
            className="rounded-lg bg-[#242424] px-3 py-1.5 text-[11px] font-medium text-gray-200 transition hover:bg-[#2d2d2d]"
          >
            Reuse Task
          </button>
        )}
        {workflow.groupKeys[0] && (
          <button
            onClick={() =>
              onPrefillReuseGroupKey(workflow.groupKeys[0] as string, workflow.workflowKey)
            }
            className="rounded-lg bg-[#242424] px-3 py-1.5 text-[11px] font-medium text-gray-200 transition hover:bg-[#2d2d2d]"
          >
            Reuse Group
          </button>
        )}
      </div>
    </div>
  )
}

export function WorkflowDetailPanel({
  workflow,
  tasksByRef,
}: {
  workflow: GoalPlanningWorkflowState
  tasksByRef: Map<string, TodoTaskItem>
}) {
  return (
    <div className="rounded-xl border border-violet-500/20 bg-[#161616] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{workflow.workflowKey}</div>
          <div className="mt-1 text-xs text-gray-500">
            {workflow.workflows.length} children · {workflow.requestKeys.length} requests ·{' '}
            {workflow.taskRefs.length} tasks
          </div>
        </div>
        <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-300">
          detail
        </span>
      </div>

      {(workflow.requestKeys.length > 0 ||
        workflow.taskRefs.length > 0 ||
        workflow.groupKeys.length > 0 ||
        workflow.blockerTaskRefs.length > 0) && (
        <div className="mt-4 space-y-2 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Workflow Authority
          </div>
          {workflow.requestKeys.length > 0 && (
            <div className="text-xs text-gray-300">
              Request keys: {workflow.requestKeys.join(', ')}
            </div>
          )}
          {workflow.taskRefs.length > 0 && (
            <div className="text-xs text-gray-300">Task refs: {workflow.taskRefs.join(', ')}</div>
          )}
          {workflow.groupKeys.length > 0 && (
            <div className="text-xs text-gray-300">
              Group keys: {workflow.groupKeys.join(', ')}
            </div>
          )}
          {workflow.blockerTaskRefs.length > 0 && (
            <div className="text-xs text-gray-300">
              Blocker task refs: {workflow.blockerTaskRefs.join(', ')}
            </div>
          )}
        </div>
      )}

      {(workflow.workflowSharedDecisionRefs.length > 0 ||
        workflow.workflowSharedAnswers.length > 0) && (
        <div className="mt-4 space-y-2 rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Shared Context
          </div>
          {workflow.workflowSharedDecisionRefs.length > 0 && (
            <div className="text-xs text-gray-300">
              Decision refs: {workflow.workflowSharedDecisionRefs.join(', ')}
            </div>
          )}
          {workflow.workflowSharedAnswers.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-gray-300">
                Shared answers: {workflow.workflowSharedAnswers.length}
              </div>
              {workflow.workflowSharedAnswers.map((answer, index) => (
                <div
                  key={`${workflow.workflowKey}:shared:${index}`}
                  className="text-xs leading-5 text-gray-400"
                >
                  {summarizeCapturedAnswer(answer)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3">
        {workflow.workflows.map((workflowChild, index) => {
          const linkedTask =
            workflowChild.kind === 'planning' ? tasksByRef.get(workflowChild.request.taskRef) : null

          return (
            <div
              key={`${workflow.workflowKey}:child:${index}`}
              className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">
                    {workflowChild.kind === 'planning'
                      ? workflowChild.request.title
                      : workflowChild.groupKey}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {workflowChild.kind}
                    {workflowChild.kind === 'planning' && workflowChild.workflowTaskKey
                      ? ` · ${workflowChild.workflowTaskKey}`
                      : ''}
                  </div>
                </div>
                <span className="rounded-full border border-[#3a3a3a] bg-[#191919] px-2 py-0.5 text-[10px] font-mono text-gray-300">
                  {workflowChild.blockerTaskRefs.length} blockers
                </span>
              </div>

              {workflowChild.blockedByWorkflowKeys.length > 0 && (
                <div className="mt-3 text-xs text-gray-400">
                  Depends on workflow keys: {workflowChild.blockedByWorkflowKeys.join(', ')}
                </div>
              )}

              {workflowChild.kind === 'planning' ? (
                <PlanningRequestAuthorityDetails
                  request={workflowChild.request}
                  tone="gray"
                  includeRequestKeyInMeta
                  prefixLines={
                    <>
                      <div>Status: {workflowChild.request.status}</div>
                      {linkedTask && <div>Task status: {linkedTask.status}</div>}
                      {workflowChild.blockerTaskRefs.length > 0 && (
                        <div>Blocker task refs: {workflowChild.blockerTaskRefs.join(', ')}</div>
                      )}
                    </>
                  }
                  suffixLines={
                    linkedTask && linkedTask.blockedBy.length > 0 ? (
                      <TaskBlockerSummary blockers={linkedTask.blockedBy} />
                    ) : undefined
                  }
                />
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="space-y-1 text-xs text-gray-400">
                    <div>Group key: {workflowChild.groupKey}</div>
                    {workflowChild.blockerTaskRefs.length > 0 && (
                      <div>Blocker task refs: {workflowChild.blockerTaskRefs.join(', ')}</div>
                    )}
                  </div>
                  {workflowChild.requests.map((request) => {
                    const linkedBatchTask = tasksByRef.get(request.taskRef)

                    return (
                      <div
                        key={request.requestKey}
                        className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-2 text-xs text-gray-400"
                      >
                        <div className="text-sm text-gray-200">{request.title}</div>
                        <PlanningRequestAuthorityDetails
                          request={request}
                          tone="gray"
                          includeRequestKeyInMeta
                          prefixLines={
                            <>
                              <div>Status: {request.status}</div>
                              {linkedBatchTask && <div>Task status: {linkedBatchTask.status}</div>}
                            </>
                          }
                          suffixLines={
                            linkedBatchTask && linkedBatchTask.blockedBy.length > 0 ? (
                              <TaskBlockerSummary blockers={linkedBatchTask.blockedBy} />
                            ) : undefined
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
