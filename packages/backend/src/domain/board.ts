export const TASK_KINDS = ['planning', 'engineering'] as const
export const TASK_STATUSES = ['planned', 'in_progress', 'in_review', 'merging', 'done'] as const
export const BLOCKER_KINDS = ['task', 'decision', 'merge_conflict', 'intervention'] as const
export const FAILURE_KINDS = [
  'agent_failed',
  'reviewer_rejected',
  'merge_conflict',
  'planning_follow_through_missing',
  'timeout',
] as const

export type TaskKind = (typeof TASK_KINDS)[number]
export type TaskStatus = (typeof TASK_STATUSES)[number]
export type BlockerKind = (typeof BLOCKER_KINDS)[number]
export type FailureKind = (typeof FAILURE_KINDS)[number]

export interface BlockerRef {
  kind: BlockerKind
  ref: string
}

export interface TaskItem {
  ref: string
  kind: TaskKind
  status: TaskStatus
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy: BlockerRef[]
}

export interface TodoBoard {
  version: 1
  goal: {
    goalKey: string
    title: string
  }
  items: TaskItem[]
}

export interface BoardEvent {
  id: string
  timestamp: string
  writer: string
  action: string
  goalKey: string
  taskRef?: string
  reason?: string
  beforeStatus?: TaskStatus
  afterStatus?: TaskStatus
  systemError?: {
    kind: string
    message: string
    correlationId: string
  }
}
