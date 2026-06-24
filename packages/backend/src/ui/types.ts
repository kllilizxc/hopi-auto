import type {
  GoalAssistantAction,
  GoalAssistantActionResult,
  GoalAssistantRunRecord,
} from '../assistant/assistantRun'
import type { AssistantThreadEntry as RuntimeAssistantThreadEntry } from '../runtime/assistantThreadStore'

export type TaskStatus = 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
export type RunStatus = 'active' | 'retryable' | 'completed' | 'blocked' | 'system_error'
export type StepOutcome =
  | 'running'
  | 'success'
  | 'reject'
  | 'fail'
  | 'timeout'
  | 'merge_conflict'
  | 'system_error'

export interface BlockerRef {
  kind: string
  ref: string
}

export interface TaskItem {
  ref: string
  kind: 'planning' | 'engineering'
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

export interface GoalDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: string
  status: 'open' | 'resolved'
  taskRef?: string
  answer?: string
  createdAt: string
  resolvedAt?: string
}

export interface CapturedAnswer {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: string
  answer: string
}

export interface GoalPlanningRequest {
  requestKey: string
  workflowKey?: string
  workflowSharedDecisionRefs?: string[]
  workflowSharedAnswers?: CapturedAnswer[]
  workflowTaskKey?: string
  blockedByWorkflowKeys: string[]
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  taskRef: string
  decisionRefs: string[]
  answers: CapturedAnswer[]
  requestedUpdates: string[]
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt?: string
  resolution?: string
}

export interface GoalPlanningWorkflowPlanningState {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  blockedByWorkflowKeys: string[]
  request: GoalPlanningRequest
  blockerTaskRefs: string[]
}

export interface GoalPlanningWorkflowPlanningBatchState {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys: string[]
  requests: GoalPlanningRequest[]
  blockerTaskRefs: string[]
}

export type GoalPlanningWorkflowLeafState =
  | GoalPlanningWorkflowPlanningState
  | GoalPlanningWorkflowPlanningBatchState

export interface GoalPlanningWorkflowState {
  kind: 'workflow_batch'
  workflowKey: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: CapturedAnswer[]
  workflows: GoalPlanningWorkflowLeafState[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export interface GoalDocSnapshot {
  path: string
  content: string
  status: 'bootstrapped' | 'curated'
}

export interface GoalDocsSnapshot {
  goalKey: string
  goal: GoalDocSnapshot
  design: GoalDocSnapshot
}

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

export interface RunSummary {
  runId: string
  taskRef: string
  taskKind: 'planning' | 'engineering'
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: StepOutcome
  stepCount: number
}

export interface RunStepMessage {
  messageId: string
  createdAt: string
  kind: 'system' | 'info' | 'error'
  role: string
  content: string
}

export interface RunTranscriptEntry {
  entryId: string
  createdAt: string
  transport: 'process' | 'codex' | 'claude' | 'opencode'
  kind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
  summary: string
  toolName?: string
  toolInvocationKey?: string
  vendorEventType?: string
}

export interface RunArtifactRef {
  ref: string
  label: string
}

export interface RunWorktreeRef {
  path: string
  branch?: string
  baseBranch?: string
}

export interface RunStepExecution {
  worktree?: RunWorktreeRef
  artifacts: RunArtifactRef[]
}

export interface WriteTraceChange {
  path: string
  kind: 'added' | 'modified' | 'deleted'
}

export interface WriteTraceEntry {
  id: string
  timestamp: string
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  role: 'planner' | 'generator' | 'reviewer' | 'merger'
  agent: string
  cwd: string
  toolName: string
  callId: string
  targetPaths: string[]
  changes: WriteTraceChange[]
  argumentSummary: string
  resultSummary: string
}

export interface RunStep {
  stepId: string
  role: 'planner' | 'generator' | 'reviewer' | 'merger'
  statusBefore: TaskStatus
  statusAfter?: TaskStatus
  startedAt: string
  endedAt?: string
  outcome: StepOutcome
  transcript: RunTranscriptEntry[]
  messages: RunStepMessage[]
  execution?: RunStepExecution
}

export interface RunDetail {
  runId: string
  taskRef: string
  taskKind: 'planning' | 'engineering'
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: StepOutcome
  steps: RunStep[]
}

export type AssistantThreadEntry = RuntimeAssistantThreadEntry

export interface AssistantRunSummary {
  assistantRunId: string
  startedAt: string
  endedAt: string
  status: 'completed' | 'failed'
  message: string
  actionCount: number
}

export type AssistantAction = GoalAssistantAction
export type AssistantActionResult = GoalAssistantActionResult
export type AssistantEvent = GoalAssistantRunRecord['events'][number]
export type AssistantRunDetail = GoalAssistantRunRecord

export interface AssistantRunBundleFile {
  path: string
  content: string | null
}

export interface AssistantRunBundle {
  goalKey: string
  assistantRunId: string
  context: AssistantRunBundleFile
  prompt: AssistantRunBundleFile
  outcome: AssistantRunBundleFile
  result: AssistantRunBundleFile
}

export interface AppState {
  goalKey: string
  goalKeyInput: string
  assistantInput: string
  preferenceEditor: string
  preferenceContent: string
  preferenceEntries: PreferenceEntry[]
  preferenceDirty: boolean
  goalDocs: GoalDocsSnapshot | null
  planningWorkflows: GoalPlanningWorkflowState[]
  planningRequests: GoalPlanningRequest[]
  board: TodoBoard | null
  decisions: GoalDecision[]
  assistantThread: AssistantThreadEntry[]
  assistantRuns: AssistantRunSummary[]
  runs: RunSummary[]
  selectedRunId: string | null
  selectedRun: RunDetail | null
  selectedStepId: string | null
  selectedAssistantRunId: string | null
  selectedAssistantRun: AssistantRunDetail | null
  selectedAssistantBundle: AssistantRunBundle | null
  selectedRunWriteTraces: WriteTraceEntry[]
  loadingBoard: boolean
  loadingRun: boolean
  loadingAssistantRun: boolean
  runningAssistant: boolean
  savingPreferences: boolean
  reconcilingGoal: boolean
  lastReconcileSummary: string | null
  error: string | null
}

export const STATUS_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'planned', label: 'Planned' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'in_review', label: 'In Review' },
  { status: 'merging', label: 'Merging' },
  { status: 'done', label: 'Done' },
]
