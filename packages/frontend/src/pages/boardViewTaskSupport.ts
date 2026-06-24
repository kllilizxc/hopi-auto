import type { AgentRole, TaskKind, TodoTaskItem } from '../lib/api'
import type { AssistantPanelProactiveMessage } from '../components/AssistantPanel'

export function runningRoleForTask(task: TodoTaskItem): AgentRole {
  if (task.status === 'in_review') {
    return 'reviewer'
  }
  if (task.status === 'merging') {
    return 'merger'
  }
  if (task.kind === 'planning') {
    return 'planner'
  }
  return 'generator'
}

export function buildTaskDisplayIdMap(tasks: TodoTaskItem[]) {
  const displayIdByRef = new Map<string, string>()
  const planningSlots = new Set<number>()
  const engineeringSlots = new Set<number>()

  for (const task of tasks) {
    const explicit = parseExplicitTaskDisplayId(task.ref, task.kind)
    if (!explicit) {
      continue
    }
    displayIdByRef.set(task.ref, explicit.id)
    explicit.kind === 'planning'
      ? planningSlots.add(explicit.index)
      : engineeringSlots.add(explicit.index)
  }

  let nextPlanningIndex = 1
  let nextEngineeringIndex = 1

  for (const task of tasks) {
    if (displayIdByRef.has(task.ref)) {
      continue
    }

    if (task.kind === 'planning') {
      while (planningSlots.has(nextPlanningIndex)) {
        nextPlanningIndex += 1
      }
      displayIdByRef.set(task.ref, `P-${nextPlanningIndex}`)
      planningSlots.add(nextPlanningIndex)
      nextPlanningIndex += 1
      continue
    }

    while (engineeringSlots.has(nextEngineeringIndex)) {
      nextEngineeringIndex += 1
    }
    displayIdByRef.set(task.ref, `E-${nextEngineeringIndex}`)
    engineeringSlots.add(nextEngineeringIndex)
    nextEngineeringIndex += 1
  }

  return displayIdByRef
}

function parseExplicitTaskDisplayId(ref: string, kind: TaskKind) {
  const match = ref
    .trim()
    .toUpperCase()
    .match(/^([A-Z])-(\d+)$/)
  if (!match) {
    return null
  }

  const prefix = match[1]
  const index = Number.parseInt(match[2], 10)
  if (!Number.isFinite(index) || index <= 0) {
    return null
  }

  if (kind === 'planning' && prefix === 'P') {
    return { id: `P-${index}`, index, kind: 'planning' as const }
  }
  if (kind === 'engineering' && prefix === 'E') {
    return { id: `E-${index}`, index, kind: 'engineering' as const }
  }

  return null
}

export function hasActionRequiredBlocker(task: TodoTaskItem) {
  return task.blockedBy.some(
    (blocker) =>
      blocker.kind === 'decision' ||
      blocker.kind === 'merge_conflict' ||
      blocker.kind === 'intervention',
  )
}

export function hasDependencyOnlyBlocker(task: TodoTaskItem) {
  return task.blockedBy.length > 0 && task.blockedBy.every((blocker) => blocker.kind === 'task')
}

export function isRunnableTask(task: TodoTaskItem) {
  return (
    task.blockedBy.length === 0 &&
    (task.status === 'planned' ||
      task.status === 'in_progress' ||
      task.status === 'in_review' ||
      task.status === 'merging')
  )
}

export function buildAssistantProactiveMessage(input: {
  goalKey: string
  automationDisplayState: 'paused' | 'running' | 'blocked' | 'failed'
  reconcileEnabled: boolean
  automationError?: string
  totalTaskCount: number
  doneTaskCount: number
  blockedTaskCount: number
  blockedTasks: TodoTaskItem[]
  runnableTaskCount: number
  runningTaskCount: number
  timestamp: string
}): AssistantPanelProactiveMessage | null {
  const blockedSummary = summarizeBlockedTasks(input.blockedTasks)
  const baseId = [
    input.goalKey,
    input.automationDisplayState,
    input.totalTaskCount,
    input.doneTaskCount,
    input.blockedTaskCount,
    blockedSummary.join('|'),
    input.runnableTaskCount,
    input.runningTaskCount,
    input.automationError ?? '',
    input.timestamp,
  ].join(':')

  if (input.automationDisplayState === 'running') {
    if (!input.reconcileEnabled) {
      return {
        id: `assistant-status:${baseId}`,
        label: 'Status update',
        content: `Current status: running. Active session work is still finishing, but reconcile is paused for new steps.`,
        details: [
          ...(blockedSummary.length > 0
            ? [`Blocked tasks waiting for attention: ${blockedSummary.join(' | ')}`]
            : []),
          'Wait for the current reviewer or merger session to finish, or press Start to resume reconcile immediately.',
        ],
        timestamp: input.timestamp,
      }
    }

    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content: `Current status: running. ${input.runningTaskCount || input.runnableTaskCount} task(s) are actively moving through the workflow.`,
      details: [
        ...(blockedSummary.length > 0
          ? [`Blocked tasks waiting for attention: ${blockedSummary.join(' | ')}`]
          : []),
        'Open a task card to inspect the latest generator, reviewer, or merger history.',
        'Use Stop if you want to pause the loop before the current steps finish.',
      ],
      timestamp: input.timestamp,
    }
  }

  if (input.automationDisplayState === 'blocked') {
    return null
  }

  if (input.automationDisplayState === 'failed') {
    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content: `Current status: failed. The automation loop stopped on a system error.`,
      details: [
        input.automationError
          ? `Latest error: ${input.automationError}`
          : 'Open the latest task run to inspect the failure details.',
        'After the error is fixed, press Start to retry from the current task state.',
      ],
      timestamp: input.timestamp,
    }
  }

  if (input.totalTaskCount === 0) {
    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content: 'Current status: paused. This goal does not have any tasks yet.',
      details: ['Create or seed a task before starting automation.'],
      timestamp: input.timestamp,
    }
  }

  if (input.doneTaskCount === input.totalTaskCount) {
    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content: `Current status: paused. All ${input.totalTaskCount} task(s) are done, so nothing is runnable right now.`,
      details: [
        'Review the completed session history from the task cards.',
        'If more work is needed, move a task back to planned or create a new engineering task.',
      ],
      timestamp: input.timestamp,
    }
  }

  if (input.runnableTaskCount > 0) {
    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content:
        input.blockedTaskCount > 0
          ? `Current status: paused. ${input.runnableTaskCount} task(s) are ready to run, and ${input.blockedTaskCount} task(s) are blocked.`
          : `Current status: paused. ${input.runnableTaskCount} task(s) are ready to run.`,
      details: [
        ...blockedSummary,
        'Press Start to resume automation.',
        'Open a task card first if you want to inspect the latest session history before resuming.',
      ],
      timestamp: input.timestamp,
    }
  }

  if (input.blockedTaskCount > 0) {
    return {
      id: `assistant-status:${baseId}`,
      label: 'Status update',
      content: `Current status: paused. ${input.blockedTaskCount} task(s) are blocked, so nothing is runnable right now.`,
      details: [
        ...blockedSummary,
        'Resolve the blocker refs on those cards first.',
        'After the blockers clear, press Start to resume automation.',
      ],
      timestamp: input.timestamp,
    }
  }

  return {
    id: `assistant-status:${baseId}`,
    label: 'Status update',
    content: 'Current status: paused. Nothing is runnable at the moment.',
    details: ['Review task states and reopen or create work before starting automation.'],
    timestamp: input.timestamp,
  }
}

function summarizeBlockedTasks(tasks: TodoTaskItem[]) {
  return tasks.slice(0, 3).map((task) => {
    const blockers = task.blockedBy
      .slice(0, 2)
      .map((blocker) => `${blocker.kind}:${blocker.ref}`)
      .join(', ')
    return `${task.title} [${blockers}]`
  })
}
