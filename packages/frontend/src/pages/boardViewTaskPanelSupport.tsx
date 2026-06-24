import { AlertCircle, GitBranch, Loader2 } from 'lucide-react'
import type { BlockerRef, TodoTaskItem } from '../lib/api'
import { cn } from '../lib/utils'
import {
  hasActionRequiredBlocker,
  hasDependencyOnlyBlocker,
  runningRoleForTask,
} from './boardViewTaskSupport'

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
