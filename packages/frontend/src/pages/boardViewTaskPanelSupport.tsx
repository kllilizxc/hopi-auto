import { AlertCircle, FolderKanban, GitBranch, Loader2 } from 'lucide-react'
import type {
  BlockerRef,
  GoalDecision,
  GoalPlanningRequest,
  GoalPlanningWorkflowState,
  TaskKind,
  TaskStatus,
  TodoTaskItem,
} from '../lib/api'
import { cn } from '../lib/utils'
import { hasValidBlockersJsonOrEmpty } from './boardViewJsonInputSupport'
import { summarizeTaskMutationResult } from './boardViewMutationResultSupport'
import {
  DecisionAuthorityDetails,
  MutationFeedback,
  PlanningRequestAuthorityDetails,
  SurfaceCard,
  SurfaceEmptyState,
  TaskBlockerSummary,
} from './boardViewPresentationSupport'
import { summarizeCapturedAnswer } from './boardViewReusableSuggestions'
import {
  StructuredBlockersEditor,
  StructuredStringListEditor,
} from './boardViewStructuredEditors'
import type { ReusableBlockerSuggestion } from './boardViewStructuredEditorTypes'
import {
  hasActionRequiredBlocker,
  hasDependencyOnlyBlocker,
  runningRoleForTask,
} from './boardViewTaskSupport'

export type TaskStatusColumn = {
  id: TaskStatus
  label: string
  color: string
}

type TaskCreateDraftLike = {
  ref: string
  kind: TaskKind
  title: string
  description: string
  acceptanceCriteria: string
  blockedByJson: string
}

type TaskMoveDraftLike = {
  taskRef: string
  status: TaskStatus
  reason: string
}

export function TaskCard({
  task,
  displayId,
  taskDisplayIdByRef,
  taskByRef,
  selected,
  onClick,
}: {
  task: TodoTaskItem
  displayId: string
  taskDisplayIdByRef: Map<string, string>
  taskByRef: Map<string, TodoTaskItem>
  selected: boolean
  onClick: () => void
}) {
  const requiresAttention = hasActionRequiredBlocker(task)
  const waitingOnDependency = hasDependencyOnlyBlocker(task)
  const runningRole = task.running ? runningRoleForTask(task) : null

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl border px-4 py-3.5 text-left shadow-sm transition-all',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40 focus-visible:ring-offset-0',
        requiresAttention
          ? 'border-red-900/50 bg-[#261818] hover:border-red-500/50 hover:bg-[#2b1a1a]'
          : waitingOnDependency
            ? 'border-amber-900/40 bg-[#24211a] hover:border-amber-500/40 hover:bg-[#29241d]'
            : 'border-[#333] bg-[#222] hover:border-purple-500/50 hover:bg-[#252525]',
        selected && 'border-purple-500/50 bg-[#252525] ring-1 ring-purple-500/40',
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h4
            title={task.title}
            className="line-clamp-3 flex-1 text-[15px] font-medium leading-6 text-gray-100 transition-colors group-hover:text-purple-300"
          >
            {task.title}
          </h4>
          <span className="inline-flex shrink-0 items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[10px] leading-none text-gray-300">
            {displayId}
          </span>
        </div>

        {task.description && (
          <p title={task.description} className="line-clamp-4 text-[13px] leading-6 text-gray-400">
            {task.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase leading-none',
              task.kind === 'planning'
                ? 'border-blue-400/20 bg-blue-500/10 text-blue-300'
                : 'border-white/10 bg-white/5 text-gray-300',
            )}
          >
            {task.kind}
          </span>

          {runningRole && (
            <span className="inline-flex items-center gap-1 rounded-full border border-yellow-400/20 bg-yellow-400/10 px-2 py-1 text-[10px] font-semibold uppercase leading-none text-yellow-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              Running {runningRole}
            </span>
          )}

          {requiresAttention && (
            <span className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-400/10 px-2 py-1 text-[10px] font-semibold uppercase leading-none text-red-300">
              <AlertCircle className="h-3 w-3" />
              Attention needed
            </span>
          )}

          {waitingOnDependency && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase leading-none text-amber-300">
              <GitBranch className="h-3 w-3" />
              Waiting on dependency
            </span>
          )}
        </div>
      </div>

      {task.blockedBy.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/5 pt-3">
          {task.blockedBy.map((blocker) => (
            <TaskBlockerPill
              key={`${blocker.kind}:${blocker.ref}`}
              blocker={blocker}
              taskDisplayIdByRef={taskDisplayIdByRef}
              taskByRef={taskByRef}
            />
          ))}
        </div>
      )}
    </button>
  )
}

export function TaskBlockerPill({
  blocker,
  taskDisplayIdByRef,
  taskByRef,
}: {
  blocker: BlockerRef
  taskDisplayIdByRef: Map<string, string>
  taskByRef: Map<string, TodoTaskItem>
}) {
  const blockedTask = blocker.kind === 'task' ? (taskByRef.get(blocker.ref) ?? null) : null
  const blockedTaskDisplayId =
    blocker.kind === 'task' ? (taskDisplayIdByRef.get(blocker.ref) ?? blocker.ref) : null
  const title =
    blocker.kind === 'task' && blockedTask
      ? `${blocker.kind}: ${blockedTaskDisplayId} · ${blockedTask.title}`
      : `${blocker.kind}: ${blocker.ref}`
  const label =
    blocker.kind === 'task'
      ? `task: ${blockedTaskDisplayId}${blockedTask ? ` · ${blockedTask.title}` : ''}`
      : `${blocker.kind}: ${blocker.ref}`

  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center rounded-md border px-2 py-1 font-mono text-[10px] leading-none',
        blocker.kind === 'task'
          ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
          : 'border-red-400/20 bg-red-400/10 text-red-300',
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

export function TaskActionsPanel({
  tasks,
  createDraft,
  onCreateDraftChange,
  onCreateTask,
  createPending,
  createError,
  createResult,
  moveDraft,
  onMoveDraftChange,
  onSelectMoveTask,
  onMoveTask,
  movePending,
  moveError,
  moveResult,
  reusableBlockerSuggestions,
  statusColumns,
}: {
  tasks: TodoTaskItem[]
  createDraft: TaskCreateDraftLike
  onCreateDraftChange: (field: keyof TaskCreateDraftLike, value: string) => void
  onCreateTask: () => void
  createPending: boolean
  createError: Error | null
  createResult?: TodoTaskItem | null
  moveDraft: TaskMoveDraftLike
  onMoveDraftChange: (field: keyof TaskMoveDraftLike, value: string) => void
  onSelectMoveTask: (taskRef: string) => void
  onMoveTask: () => void
  movePending: boolean
  moveError: Error | null
  moveResult?: TodoTaskItem | null
  reusableBlockerSuggestions: ReusableBlockerSuggestion[]
  statusColumns: TaskStatusColumn[]
}) {
  const selectedTask = tasks.find((task) => task.ref === moveDraft.taskRef) ?? null

  return (
    <SurfaceCard
      icon={<FolderKanban className="h-4 w-4 text-purple-400" />}
      title="Task Actions"
      subtitle={`${tasks.length} visible tasks · direct board mutations`}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Create Task</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Task Ref</span>
              <input
                value={createDraft.ref}
                onChange={(event) => onCreateDraftChange('ref', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="T-42"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Kind</span>
              <select
                value={createDraft.kind}
                onChange={(event) => onCreateDraftChange('kind', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                <option value="planning">planning</option>
                <option value="engineering">engineering</option>
              </select>
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Title</span>
              <input
                value={createDraft.title}
                onChange={(event) => onCreateDraftChange('title', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Implement atomic writes"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Description</span>
              <textarea
                value={createDraft.description}
                onChange={(event) => onCreateDraftChange('description', event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="Make writes safe."
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Acceptance Criteria
              </span>
              <textarea
                value={createDraft.acceptanceCriteria}
                onChange={(event) => onCreateDraftChange('acceptanceCriteria', event.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder={'One item per line\nConcurrent writes are safe.'}
              />
              <StructuredStringListEditor
                label="Structured acceptance criteria"
                value={createDraft.acceptanceCriteria}
                onChange={(value) => onCreateDraftChange('acceptanceCriteria', value)}
                itemLabel="Criterion"
                addLabel="Add criterion"
                placeholder="Concurrent writes are safe."
                emptyLabel="No structured acceptance criteria yet."
              />
            </label>
            <div className="space-y-1 md:col-span-2">
              <StructuredBlockersEditor
                label="Structured task blockers"
                value={createDraft.blockedByJson}
                onChange={(value) => onCreateDraftChange('blockedByJson', value)}
                suggestions={reusableBlockerSuggestions}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={createError} />
            <button
              onClick={onCreateTask}
              disabled={
                createPending ||
                createDraft.ref.trim().length === 0 ||
                createDraft.title.trim().length === 0 ||
                !hasValidBlockersJsonOrEmpty(createDraft.blockedByJson, 'Task blockers')
              }
              className="rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createPending ? 'Creating...' : 'Create Task'}
            </button>
          </div>
          {createResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizeTaskMutationResult(createResult)}</div>
              {createResult.blockedBy.length > 0 && (
                <div className="mt-1">
                  <TaskBlockerSummary blockers={createResult.blockedBy} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
          <div className="mb-3 text-sm font-medium text-white">Manual Move</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Task</span>
              <select
                value={moveDraft.taskRef}
                onChange={(event) => onSelectMoveTask(event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                {tasks.length === 0 ? (
                  <option value="">No tasks available</option>
                ) : (
                  tasks.map((task) => (
                    <option key={task.ref} value={task.ref}>
                      {task.ref} · {task.title}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">
                Target Status
              </span>
              <select
                value={moveDraft.status}
                onChange={(event) => onMoveDraftChange('status', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
              >
                {statusColumns.map((statusColumn) => (
                  <option key={statusColumn.id} value={statusColumn.id}>
                    {statusColumn.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-wide text-gray-500">Reason</span>
              <input
                value={moveDraft.reason}
                onChange={(event) => onMoveDraftChange('reason', event.target.value)}
                className="w-full rounded-lg border border-[#343434] bg-[#111] px-3 py-2 text-sm text-gray-100 outline-none transition focus:border-purple-500/50"
                placeholder="manual transition"
              />
            </label>
          </div>

          {selectedTask ? (
            <div className="mt-3 rounded-lg border border-[#2c2c2c] bg-[#161616] px-3 py-3 text-sm text-gray-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-[#111] px-2 py-1 font-mono text-xs text-gray-400">
                  {selectedTask.ref}
                </span>
                <span className="text-white">{selectedTask.title}</span>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                Current status: <span className="text-gray-300">{selectedTask.status}</span> →
                target: <span className="text-gray-300">{moveDraft.status}</span>
              </div>
              {selectedTask.blockedBy.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedTask.blockedBy.map((blocker) => (
                    <span
                      key={`${blocker.kind}:${blocker.ref}`}
                      className="rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-1 font-mono text-[10px] text-blue-300"
                    >
                      {blocker.kind}: {blocker.ref}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-[#313131] bg-[#161616] px-3 py-4 text-sm text-gray-500">
              No task selected for manual move.
            </div>
          )}

          <div className="mt-3 flex items-center justify-between gap-3">
            <MutationFeedback error={moveError} />
            <button
              onClick={onMoveTask}
              disabled={
                movePending ||
                !selectedTask ||
                moveDraft.taskRef.trim().length === 0 ||
                selectedTask.status === moveDraft.status
              }
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {movePending ? 'Moving...' : 'Move Task'}
            </button>
          </div>
          {moveResult && (
            <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              <div>{summarizeTaskMutationResult(moveResult)}</div>
              {moveResult.blockedBy.length > 0 && (
                <div className="mt-1">
                  <TaskBlockerSummary blockers={moveResult.blockedBy} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  )
}

export function TaskAuthorityPanel({
  task,
  showSessionDiagnostics,
  linkedDecisions,
  linkedPlanningRequests,
  linkedWorkflows,
  dependentTasks,
}: {
  task: TodoTaskItem | null
  showSessionDiagnostics: boolean
  linkedDecisions: GoalDecision[]
  linkedPlanningRequests: GoalPlanningRequest[]
  linkedWorkflows: GoalPlanningWorkflowState[]
  dependentTasks: TodoTaskItem[]
}) {
  return (
    <SurfaceCard
      icon={<FolderKanban className="h-4 w-4 text-purple-400" />}
      title="Task Authority"
      subtitle={
        task
          ? `${task.status.replace('_', ' ')} · ${task.kind} · ${linkedPlanningRequests.length} planning refs`
          : 'Select a task from the board to inspect its durable authority'
      }
    >
      {!task ? (
        <SurfaceEmptyState label="Select a task card from the board to inspect full task authority." />
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">{task.title}</div>
                <div className="mt-1 font-mono text-xs text-gray-500">{task.ref}</div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-full border border-[#3a3a3a] bg-[#111] px-2 py-0.5 text-[10px] font-bold uppercase text-gray-300">
                  {task.kind}
                </span>
                <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-purple-200">
                  {task.status}
                </span>
              </div>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-gray-300">
              {task.description}
            </p>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Acceptance Criteria
                </div>
                {task.acceptanceCriteria.length === 0 ? (
                  <div className="mt-2 text-xs text-gray-500">No durable acceptance criteria.</div>
                ) : (
                  <div className="mt-2 space-y-1">
                    {task.acceptanceCriteria.map((criterion, index) => (
                      <div
                        key={`${task.ref}:criterion:${index}`}
                        className="text-xs leading-5 text-gray-300"
                      >
                        {index + 1}. {criterion}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                  Blocking Authority
                </div>
                {task.blockedBy.length === 0 ? (
                  <div className="mt-2 text-xs text-gray-500">No durable blockers.</div>
                ) : (
                  <div className="mt-2">
                    <TaskBlockerSummary blockers={task.blockedBy} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
              <div className="mb-3 text-sm font-medium text-white">Linked Decisions</div>
              {linkedDecisions.length === 0 ? (
                <div className="text-xs text-gray-500">
                  No durable decisions currently point at this task.
                </div>
              ) : (
                <div className="space-y-3">
                  {linkedDecisions.map((decision) => (
                    <div
                      key={decision.decisionKey}
                      className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm text-white">{decision.summary}</div>
                          <div className="mt-1 font-mono text-xs text-gray-500">
                            {decision.decisionKey}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                            decision.status === 'resolved'
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-300',
                          )}
                        >
                          {decision.status}
                        </span>
                      </div>
                      <DecisionAuthorityDetails decision={decision} tone="gray" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
              <div className="mb-3 text-sm font-medium text-white">Linked Planning Requests</div>
              {linkedPlanningRequests.length === 0 ? (
                <div className="text-xs text-gray-500">
                  No durable planning requests currently point at this task.
                </div>
              ) : (
                <div className="space-y-3">
                  {linkedPlanningRequests.map((request) => (
                    <div
                      key={request.requestKey}
                      className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm text-white">{request.title}</div>
                          <div className="mt-1 font-mono text-xs text-gray-500">
                            {request.requestKey}
                          </div>
                        </div>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase',
                            request.status === 'resolved'
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                              : 'border-sky-500/20 bg-sky-500/10 text-sky-300',
                          )}
                        >
                          {request.status}
                        </span>
                      </div>
                      <PlanningRequestAuthorityDetails request={request} tone="gray" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
              <div className="mb-3 text-sm font-medium text-white">Workflow Membership</div>
              {linkedWorkflows.length === 0 ? (
                <div className="text-xs text-gray-500">
                  No visible workflow graph currently references this task.
                </div>
              ) : (
                <div className="space-y-3">
                  {linkedWorkflows.map((workflow) => {
                    const relationship = [
                      workflow.taskRefs.includes(task.ref) ? 'member task' : null,
                      workflow.blockerTaskRefs.includes(task.ref) ? 'workflow blocker' : null,
                    ].filter(Boolean)
                    const matchingPlanningChildren = workflow.workflows.flatMap((child) =>
                      child.kind === 'planning' && child.request.taskRef === task.ref
                        ? [
                            {
                              workflowTaskKey: child.workflowTaskKey,
                              blockedByWorkflowKeys: child.blockedByWorkflowKeys,
                              blockerTaskRefs: child.blockerTaskRefs,
                              request: child.request,
                            },
                          ]
                        : [],
                    )
                    const matchingGroupedRequests = workflow.workflows.flatMap((child) =>
                      child.kind === 'planning_batch'
                        ? child.requests
                            .filter((request) => request.taskRef === task.ref)
                            .map((request) => ({
                              groupKey: child.groupKey,
                              blockedByWorkflowKeys: child.blockedByWorkflowKeys,
                              blockerTaskRefs: child.blockerTaskRefs,
                              request,
                            }))
                        : [],
                    )

                    return (
                      <div
                        key={workflow.workflowKey}
                        className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3"
                      >
                        <div className="text-sm text-white">{workflow.workflowKey}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {relationship.join(' · ') || 'referenced'}
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-gray-400">
                          <div>{workflow.workflows.length} child node(s)</div>
                          {workflow.requestKeys.length > 0 && (
                            <div>Request keys: {workflow.requestKeys.join(', ')}</div>
                          )}
                          {workflow.groupKeys.length > 0 && (
                            <div>Group keys: {workflow.groupKeys.join(', ')}</div>
                          )}
                          {workflow.blockerTaskRefs.length > 0 && (
                            <div>Blocker task refs: {workflow.blockerTaskRefs.join(', ')}</div>
                          )}
                          {workflow.workflowSharedDecisionRefs.length > 0 && (
                            <div>
                              Workflow-shared decisions:{' '}
                              {workflow.workflowSharedDecisionRefs.join(', ')}
                            </div>
                          )}
                          {workflow.workflowSharedAnswers.length > 0 && (
                            <div>
                              Workflow-shared answers:{' '}
                              {workflow.workflowSharedAnswers
                                .map(summarizeCapturedAnswer)
                                .join(' | ')}
                            </div>
                          )}
                        </div>
                        {(matchingPlanningChildren.length > 0 ||
                          matchingGroupedRequests.length > 0) && (
                          <div className="mt-3 space-y-3">
                            {matchingPlanningChildren.map((child) => (
                              <div
                                key={`${workflow.workflowKey}:${child.request.requestKey}`}
                                className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                              >
                                <div className="text-sm text-gray-200">{child.request.title}</div>
                                <PlanningRequestAuthorityDetails
                                  request={child.request}
                                  tone="gray"
                                  includeRequestKeyInMeta
                                  prefixLines={
                                    <>
                                      <div>Status: {child.request.status}</div>
                                      <div>Task status: {task.status}</div>
                                      {child.blockerTaskRefs.length > 0 && (
                                        <div>
                                          Blocker task refs: {child.blockerTaskRefs.join(', ')}
                                        </div>
                                      )}
                                    </>
                                  }
                                  suffixLines={
                                    task.blockedBy.length > 0 ? (
                                      <TaskBlockerSummary blockers={task.blockedBy} />
                                    ) : undefined
                                  }
                                />
                              </div>
                            ))}
                            {matchingGroupedRequests.map(
                              ({ groupKey, blockedByWorkflowKeys, blockerTaskRefs, request }) => (
                                <div
                                  key={`${workflow.workflowKey}:${groupKey}:${request.requestKey}`}
                                  className="rounded-lg border border-[#252525] bg-[#161616] px-3 py-3"
                                >
                                  <div className="text-sm text-gray-200">{request.title}</div>
                                  <PlanningRequestAuthorityDetails
                                    request={request}
                                    tone="gray"
                                    includeRequestKeyInMeta
                                    prefixLines={
                                      <>
                                        <div>Status: {request.status}</div>
                                        <div>Task status: {task.status}</div>
                                        <div>Grouped child: {groupKey}</div>
                                        {blockedByWorkflowKeys.length > 0 && (
                                          <div>
                                            Workflow dependencies:{' '}
                                            {blockedByWorkflowKeys.join(', ')}
                                          </div>
                                        )}
                                        {blockerTaskRefs.length > 0 && (
                                          <div>Blocker task refs: {blockerTaskRefs.join(', ')}</div>
                                        )}
                                      </>
                                    }
                                    suffixLines={
                                      task.blockedBy.length > 0 ? (
                                        <TaskBlockerSummary blockers={task.blockedBy} />
                                      ) : undefined
                                    }
                                  />
                                </div>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
              <div className="mb-3 text-sm font-medium text-white">Dependent Tasks</div>
              {dependentTasks.length === 0 ? (
                <div className="text-xs text-gray-500">
                  No visible tasks are currently blocked by this task ref.
                </div>
              ) : (
                <div className="space-y-3">
                  {dependentTasks.map((dependentTask) => (
                    <div
                      key={dependentTask.ref}
                      className="rounded-lg border border-[#2c2c2c] bg-[#111] px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm text-white">{dependentTask.title}</div>
                          <div className="mt-1 font-mono text-xs text-gray-500">
                            {dependentTask.ref}
                          </div>
                        </div>
                        <span className="rounded-full border border-[#3a3a3a] bg-[#191919] px-2 py-0.5 text-[10px] font-bold uppercase text-gray-300">
                          {dependentTask.status}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-gray-400">
                        {dependentTask.kind} task · {dependentTask.acceptanceCriteria.length}{' '}
                        acceptance item(s)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {showSessionDiagnostics && (
            <div className="rounded-xl border border-[#303030] bg-[#191919] p-4">
              <div className="text-sm font-medium text-white">Run Diagnostics</div>
              <div className="mt-2 text-xs leading-6 text-gray-500">
                Workflow session history is opened from task cards. This authority panel now stays
                focused on durable task state instead of inline run logs.
              </div>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  )
}
