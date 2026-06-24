import type { BlockerRef, TaskStatus } from './apiGoalTypes'

export interface PreferenceEntry {
  preferenceKey: string
  status: 'active' | 'retired'
  summary: string
  rationale?: string
  retiredReason?: string
  supersededBy?: string
}

export interface PreferenceDocument {
  path: string
  content: string
  entries: PreferenceEntry[]
}

export type CodingAgentTransport = 'codex' | 'claude' | 'opencode'
export type CodingReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export interface ProjectCodingDefaults {
  transport: CodingAgentTransport
  model?: string
  reasoningEffort?: CodingReasoningEffort
}

export interface ProjectRecord {
  projectKey: string
  name: string
  rootDir: string
  createdAt: string
  lastOpenedGoalKey?: string
  codingDefaults: ProjectCodingDefaults
}

export interface ProjectGoalSummary {
  goalKey: string
  title: string
  objective?: string
  createdAt?: string
}

export type AutomationState = 'idle' | 'running' | 'blocked' | 'failed'

export interface LaneParallelism {
  in_progress: number
  in_review: number
  merging: number
}

export interface AutomationStatus {
  projectKey: string
  goalKey: string
  state: AutomationState
  startedAt?: string
  endedAt?: string
  stepCount: number
  maxSteps: number
  maxParallel: number
  laneParallelism: LaneParallelism
  lastResult?: ReconcileResult
  error?: string
  reconcileEnabled: boolean
  updatedAt: string
}

export interface GoalEvent {
  type?: string
  projectKey?: string
  goalKey?: string
  status?: AutomationStatus
}

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }
