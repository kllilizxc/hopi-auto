export type TaskKind = 'planning' | 'engineering'
export type TaskStatus = 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
export type BlockerKind = 'task' | 'decision' | 'merge_conflict' | 'intervention'

export interface BlockerRef {
  kind: BlockerKind
  ref: string
}

export interface TodoTaskItem {
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
  items: TodoTaskItem[]
}

export interface GoalTaskCreateInput {
  ref: string
  kind: TaskKind
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy?: BlockerRef[]
}

export interface GoalTaskMoveInput {
  status: TaskStatus
  reason?: string
}

export type AssistantThreadEntry =
  | {
      entryId: string
      createdAt: string
      kind: 'user_message' | 'assistant_message'
      content: string
    }
  | {
      entryId: string
      createdAt: string
      kind: 'action'
      actionType: string
      summary: string
      action?: GoalAssistantAction
    }
  | {
      entryId: string
      createdAt: string
      kind: 'action_result'
      actionType: string
      summary: string
      result?: GoalAssistantActionResult
    }

export interface GoalAssistantThread {
  goalKey: string
  entries: AssistantThreadEntry[]
}

export interface AssistantRunSummary {
  assistantRunId: string
  startedAt: string
  endedAt: string
  status: 'completed' | 'failed'
  message: string
  actionCount: number
}

export interface AssistantRunDetail {
  goalKey: string
  assistantRunId: string
  startedAt: string
  endedAt: string
  requestContent: string
  status: 'completed' | 'failed'
  message: string
}

export type RunStatus = 'active' | 'retryable' | 'completed' | 'blocked' | 'system_error'
export type StepOutcome =
  | 'running'
  | 'success'
  | 'reject'
  | 'fail'
  | 'timeout'
  | 'merge_conflict'
  | 'system_error'
export type AgentRole = 'planner' | 'generator' | 'reviewer' | 'merger'
export type TranscriptTransport = 'process' | 'codex' | 'claude' | 'opencode'
export type TranscriptKind = 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'

export interface RunTranscriptEntry {
  entryId: string
  createdAt: string
  transport: TranscriptTransport
  kind: TranscriptKind
  summary: string
  toolName?: string
  toolInvocationKey?: string
  vendorEventType?: string
}

export interface RunStepMessage {
  messageId: string
  createdAt: string
  kind: 'system' | 'info' | 'error'
  role: string
  content: string
}

export interface RunArtifactRef {
  ref: string
  label: string
}

export type WriteTraceChangeKind = 'added' | 'modified' | 'deleted'

export interface GoalWriteTraceChange {
  path: string
  kind: WriteTraceChangeKind
}

export interface GoalWriteTraceEntry {
  id: string
  timestamp: string
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  role: AgentRole
  agent: string
  cwd: string
  toolName: string
  callId: string
  targetPaths: string[]
  changes: GoalWriteTraceChange[]
  argumentSummary: string
  resultSummary: string
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

export interface GoalRunStep {
  stepId: string
  role: AgentRole
  statusBefore: TaskStatus
  statusAfter?: TaskStatus
  startedAt: string
  endedAt?: string
  outcome: StepOutcome
  transcript: RunTranscriptEntry[]
  messages: RunStepMessage[]
  execution?: RunStepExecution
}

export interface GoalRunSummary {
  runId: string
  taskRef: string
  taskKind: TaskKind
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: Exclude<StepOutcome, 'running'>
  stepCount: number
}

export interface GoalRunDetail {
  runId: string
  taskRef: string
  taskKind: TaskKind
  startedAt: string
  endedAt?: string
  status: RunStatus
  finalTaskStatus?: TaskStatus
  terminalOutcome?: Exclude<StepOutcome, 'running'>
  steps: GoalRunStep[]
}

export interface AssistantRuntimeEvent {
  kind: 'message' | 'transcript' | 'worktree_prepared' | 'artifact'
  level?: 'info' | 'error'
  role?: string
  content?: string
  summary?: string
  transport?: TranscriptTransport
  entryKind?: TranscriptKind
  toolName?: string
  toolInvocationKey?: string
  vendorEventType?: string
  path?: string
  branch?: string
  baseBranch?: string
  ref?: string
  label?: string
}

export interface GoalAssistantActionBatchRequestInput {
  taskKey: string
  requestKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: string[]
  blockedBy?: BlockerRef[]
  blockedByTaskKeys?: string[]
}

export interface GoalAssistantActionWorkflowChildInput {
  kind: 'planning' | 'planning_batch'
  requestKey?: string
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  groupKey?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  decisionRefs?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requestedUpdates?: string[]
  blockedBy?: BlockerRef[]
  requests?: GoalAssistantActionBatchRequestInput[]
}

export interface GoalAssistantActionFollowThroughInput {
  kind: 'planning' | 'planning_batch' | 'workflow_batch'
  workflowKey?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  groupKey?: string
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  decisionRefs?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requestedUpdates?: string[]
  requests?: GoalAssistantActionBatchRequestInput[]
  workflows?: GoalAssistantActionWorkflowChildInput[]
  inferRemainingAnswers?: boolean
}

export interface GoalAssistantAction {
  kind: string
  status?: TaskStatus
  taskRef?: string
  taskKey?: string
  requestKey?: string
  workflowKey?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  workflowTaskKey?: string
  groupKey?: string
  decisionKey?: string
  decisionKeys?: string[]
  preferenceKey?: string
  summary?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  title?: string
  description?: string
  acceptanceCriteria?: string[]
  blockedBy?: BlockerRef[]
  blockedByWorkflowKeys?: string[]
  decisionRefs?: string[]
  answers?: Array<InterpretablePlanningAnswerInput | GoalAssistantDecisionAnswerInput>
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
  answerSources?: GoalAnswerSourceInput[]
  sourceResponse?: string
  sourceResponseFormat?: GoalSourceResponseFormat
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
  requestedUpdates?: string[]
  requests?: GoalAssistantActionBatchRequestInput[]
  workflows?: GoalAssistantActionWorkflowChildInput[]
  followThrough?: GoalAssistantActionFollowThroughInput
  content?: string
  rationale?: string
  reason?: string
  supersedes?: string[]
  supersededBy?: string
}

export interface GoalAssistantRunDetail {
  goalKey: string
  assistantRunId: string
  startedAt: string
  endedAt: string
  requestContent: string
  status: 'completed' | 'failed'
  message: string
  actions: GoalAssistantAction[]
  actionResults: GoalAssistantActionResult[]
  events: AssistantRuntimeEvent[]
  error?: string
}

export interface GoalAssistantPlanningRequestResult {
  requestKey: string
  workflowKey?: string
  workflowTaskKey?: string
  workflowSharedDecisionRefs?: string[]
  workflowSharedAnswers?: CapturedAnswer[]
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
  status: string
  createdAt?: string
  resolvedAt?: string
  resolution?: string
}

export interface GoalAssistantWorkflowChildResult {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey?: string
  groupKey?: string
  requests?: GoalAssistantPlanningRequestResult[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export interface GoalAssistantDecisionFollowThroughResult {
  kind: 'planning' | 'planning_batch' | 'workflow_batch'
  workflowKey?: string
  workflowTaskKey?: string
  groupKey?: string
  groupKeys?: string[]
  requests?: GoalAssistantPlanningRequestResult[]
  workflows?: GoalAssistantWorkflowChildResult[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export interface GoalAssistantPreferenceResult {
  preferenceKey: string
  status: string
  summary: string
  rationale?: string
  retiredReason?: string
  supersededBy?: string
}

export interface GoalAssistantActionResult {
  kind: string
  summary: string
  taskRef?: string
  task?: TodoTaskItem
  taskCreated?: boolean
  requestKey?: string
  request?: GoalAssistantPlanningRequestResult
  taskRefs?: string[]
  requestKeys?: string[]
  requests?: GoalAssistantPlanningRequestResult[]
  createdRequestKeys?: string[]
  createdTaskRefs?: string[]
  groupKeys?: string[]
  workflowKey?: string
  workflows?: GoalAssistantWorkflowChildResult[]
  blockerTaskRefs?: string[]
  groupKey?: string
  status?: string
  decisionKey?: string
  decisionKeys?: string[]
  decisionStatus?: string
  preferenceKey?: string
  preferenceSummary?: string
  rationale?: string
  reason?: string
  supersededBy?: string
  content?: string
  preference?: GoalAssistantPreferenceResult
  retiredPreferences?: GoalAssistantPreferenceResult[]
  preferences?: GoalAssistantPreferenceResult[]
  retiredPreferenceKeys?: string[]
  created?: boolean
  previousStatus?: string
  createdDecisionKeys?: string[]
  blockerAdded?: boolean
  blockerRemoved?: boolean
  decision?: GoalDecision
  decisions?: GoalDecision[]
  resolvedSourceResponseFormat?: GoalSourceResponseFormat
  followThrough?: GoalAssistantDecisionFollowThroughResult
}

export interface GoalAssistantRunBundleFile {
  path: string
  content: string | null
}

export interface GoalAssistantRunBundle {
  goalKey: string
  assistantRunId: string
  context: GoalAssistantRunBundleFile
  prompt: GoalAssistantRunBundleFile
  outcome: GoalAssistantRunBundleFile
  result: GoalAssistantRunBundleFile
}

export interface GoalEvent {
  type?: string
  goalKey?: string
}

export type GoalDocStatus = 'bootstrapped' | 'curated'

export interface GoalDocSnapshot {
  path: string
  content: string
  status: GoalDocStatus
}

export interface GoalDocsSnapshot {
  goalKey: string
  goal: GoalDocSnapshot
  design: GoalDocSnapshot
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

export interface GoalDecisionSet {
  version: 1
  goalKey: string
  decisions: GoalDecision[]
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

export interface GoalAnswerSourceInput {
  answerSourceKey: string
  sourceGroupKey?: string
  route?: 'decision' | 'planning'
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
}

export interface InterpretablePlanningAnswerInput {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface GoalAssistantDecisionAnswerInput {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface GoalPlanningRequest {
  requestKey: string
  workflowKey?: string
  workflowTaskKey?: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: CapturedAnswer[]
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

export interface GoalPlanningRequestSet {
  version: 1
  goalKey: string
  requests: GoalPlanningRequest[]
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

export interface GoalPlanningWorkflowCreatePlanningChildResult {
  kind: 'planning'
  workflowTaskKey?: string
  groupKey?: string
  requests: GoalPlanningRequest[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export interface GoalPlanningWorkflowCreatePlanningBatchChildResult {
  kind: 'planning_batch'
  groupKey: string
  requests: GoalPlanningRequest[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export type GoalPlanningWorkflowCreateChildResult =
  | GoalPlanningWorkflowCreatePlanningChildResult
  | GoalPlanningWorkflowCreatePlanningBatchChildResult

export interface GoalPlanningWorkflowCreateResult {
  kind: 'workflow_batch'
  workflowKey?: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: CapturedAnswer[]
  workflows: GoalPlanningWorkflowCreateChildResult[]
  requests: GoalPlanningRequest[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
  createdRequestKeys: string[]
  createdTaskRefs: string[]
}

export interface GoalPlanningWorkflowCreateBatchRequestInput {
  taskKey: string
  requestKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates?: string[]
  blockedBy?: BlockerRef[]
  blockedByTaskKeys?: string[]
}

export interface GoalPlanningWorkflowCreatePlanningChildInput {
  kind: 'planning'
  requestKey?: string
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  blockedBy?: BlockerRef[]
  groupKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  decisionRefs?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requestedUpdates?: string[]
}

export interface GoalPlanningWorkflowCreatePlanningBatchChildInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  decisionRefs?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requests?: GoalPlanningWorkflowCreateBatchRequestInput[]
}

export type GoalPlanningWorkflowCreateChildInput =
  | GoalPlanningWorkflowCreatePlanningChildInput
  | GoalPlanningWorkflowCreatePlanningBatchChildInput

export interface GoalPlanningWorkflowCreateInput {
  workflowKey?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  decisionRefs?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  answerSources?: GoalAnswerSourceInput[]
  sourceResponse?: string
  sourceResponseFormat?: GoalSourceResponseFormat
  inferRemainingAnswers?: boolean
  workflows: GoalPlanningWorkflowCreateChildInput[]
}

export interface GoalDecisionPlanningFollowThroughInput {
  kind: 'planning'
  inferRemainingAnswers?: boolean
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requestedUpdates?: string[]
}

export interface GoalDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  inferRemainingAnswers?: boolean
  answers?: InterpretablePlanningAnswerInput[]
  requests: GoalPlanningWorkflowCreateBatchRequestInput[]
}

export interface GoalDecisionWorkflowBatchPlanningChildInput {
  kind: 'planning'
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requestedUpdates?: string[]
}

export interface GoalDecisionWorkflowBatchPlanningBatchChildInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  answers?: InterpretablePlanningAnswerInput[]
  requests?: GoalPlanningWorkflowCreateBatchRequestInput[]
}

export type GoalDecisionWorkflowBatchChildInput =
  | GoalDecisionWorkflowBatchPlanningChildInput
  | GoalDecisionWorkflowBatchPlanningBatchChildInput

export interface GoalDecisionWorkflowBatchFollowThroughInput {
  kind: 'workflow_batch'
  workflowKey?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  inferRemainingAnswers?: boolean
  answers?: InterpretablePlanningAnswerInput[]
  workflows: GoalDecisionWorkflowBatchChildInput[]
}

export type GoalDecisionFollowThroughInput =
  | GoalDecisionPlanningFollowThroughInput
  | GoalDecisionPlanningBatchFollowThroughInput
  | GoalDecisionWorkflowBatchFollowThroughInput

export interface GoalDecisionPlanningFollowThroughResult {
  kind: 'planning'
  workflowTaskKey?: string
  requests: GoalPlanningRequest[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export interface GoalDecisionPlanningBatchFollowThroughResult {
  kind: 'planning_batch'
  groupKey: string
  requests: GoalPlanningRequest[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export type GoalDecisionLeafFollowThroughResult =
  | GoalDecisionPlanningFollowThroughResult
  | GoalDecisionPlanningBatchFollowThroughResult

export interface GoalDecisionWorkflowBatchFollowThroughResult {
  kind: 'workflow_batch'
  workflowKey?: string
  workflows: GoalDecisionLeafFollowThroughResult[]
  requests: GoalPlanningRequest[]
  groupKeys: string[]
  requestKeys: string[]
  taskRefs: string[]
  blockerTaskRefs: string[]
}

export type GoalDecisionFollowThroughResult =
  | GoalDecisionLeafFollowThroughResult
  | GoalDecisionWorkflowBatchFollowThroughResult

export type GoalSourceResponseFormat =
  | 'auto'
  | 'single_pending'
  | 'labeled_sections'
  | 'inline_topics'
  | 'ordered_items'
  | 'ordered_blocks'
  | 'question_blocks'
  | 'question_clauses'
  | 'question_spans'
  | 'question_middle_spans'
  | 'question_closing_spans'
  | 'question_closing_blocks'
  | 'question_middle_blocks'
  | 'topic_clauses'
  | 'topic_sentences'
  | 'topic_spans'
  | 'topic_middle_spans'
  | 'topic_closing_spans'
  | 'topic_closing_blocks'
  | 'topic_paragraphs'
  | 'topic_middle_blocks'
  | 'topic_blocks'
  | 'pending_clauses'
  | 'pending_paragraphs'
  | 'pending_sentences'
  | 'pending_conjunctions'
  | 'pending_answer_sources'
  | 'matching_answer_sources'
  | 'matching_runs'
  | 'matching_opening_runs'
  | 'matching_closing_runs'
  | 'matching_middle_runs'

export interface GoalDecisionAnswerEntryInput {
  decisionKey?: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface GoalDecisionAnswerInput extends GoalDecisionAnswerEntryInput {
  answerSources?: GoalAnswerSourceInput[]
  sourceResponse?: string
  sourceResponseFormat?: GoalSourceResponseFormat
  followThrough?: GoalDecisionFollowThroughInput
}

export interface GoalDecisionAnswerBatchInput {
  answers?: GoalDecisionAnswerEntryInput[]
  answerSources?: GoalAnswerSourceInput[]
  sourceResponse?: string
  sourceResponseFormat?: GoalSourceResponseFormat
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  followThrough?: GoalDecisionFollowThroughInput
}

export interface GoalDecisionAnswerResult {
  decision: GoalDecision
  created: boolean
  blockerRemoved: boolean
  followThrough?: GoalDecisionFollowThroughResult
  resolvedSourceResponseFormat?: GoalSourceResponseFormat
}

export interface GoalDecisionAnswerBatchResult {
  decisions: GoalDecision[]
  createdDecisionKeys: string[]
  blockerRemoved: boolean
  followThrough?: GoalDecisionFollowThroughResult
  resolvedSourceResponseFormat?: GoalSourceResponseFormat
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

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

function apiUrl(path: string) {
  return configuredApiBase ? `${configuredApiBase}${path}` : path
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init)
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as T
}

export function openGoalEventStream() {
  return new EventSource(apiUrl('/api/events'))
}

export function readGoalBoard(goalKey: string) {
  return apiRequest<TodoBoard>(`/api/goals/${encodeURIComponent(goalKey)}/board`)
}

export function readGoalDocs(goalKey: string) {
  return apiRequest<GoalDocsSnapshot>(`/api/goals/${encodeURIComponent(goalKey)}/docs`)
}

export function readGoalDecisions(goalKey: string) {
  return apiRequest<GoalDecisionSet>(`/api/goals/${encodeURIComponent(goalKey)}/decisions`)
}

export function readGoalPlanningRequests(goalKey: string) {
  return apiRequest<GoalPlanningRequestSet>(
    `/api/goals/${encodeURIComponent(goalKey)}/planning-requests`,
  )
}

export function readGoalPlanningWorkflows(goalKey: string) {
  return apiRequest<{ goalKey: string; workflows: GoalPlanningWorkflowState[] }>(
    `/api/goals/${encodeURIComponent(goalKey)}/planning-requests/workflows`,
  )
}

export function readGoalPlanningWorkflow(goalKey: string, workflowKey: string) {
  return apiRequest<GoalPlanningWorkflowState>(
    `/api/goals/${encodeURIComponent(goalKey)}/planning-requests/workflows/${encodeURIComponent(workflowKey)}`,
  )
}

export function readPreferences() {
  return apiRequest<PreferenceDocument>('/api/preferences')
}

export async function readGoalAssistantThread(goalKey: string) {
  return apiRequest<GoalAssistantThread>(
    `/api/goals/${encodeURIComponent(goalKey)}/assistant/thread`,
  )
}

export async function readGoalAssistantRuns(goalKey: string) {
  return apiRequest<{ goalKey: string; runs: AssistantRunSummary[] }>(
    `/api/goals/${encodeURIComponent(goalKey)}/assistant/runs`,
  )
}

export async function readGoalRuns(goalKey: string) {
  return apiRequest<{ goalKey: string; runs: GoalRunSummary[] }>(
    `/api/goals/${encodeURIComponent(goalKey)}/runs`,
  )
}

export async function readGoalRun(goalKey: string, runId: string) {
  return apiRequest<GoalRunDetail>(
    `/api/goals/${encodeURIComponent(goalKey)}/runs/${encodeURIComponent(runId)}`,
  )
}

export async function readGoalWriteTraces(
  goalKey: string,
  filters?: {
    taskRef?: string
    runId?: string
    stepId?: string
    role?: AgentRole
    limit?: number
  },
) {
  const query = new URLSearchParams()
  if (filters?.taskRef) {
    query.set('taskRef', filters.taskRef)
  }
  if (filters?.runId) {
    query.set('runId', filters.runId)
  }
  if (filters?.stepId) {
    query.set('stepId', filters.stepId)
  }
  if (filters?.role) {
    query.set('role', filters.role)
  }
  if (typeof filters?.limit === 'number') {
    query.set('limit', String(filters.limit))
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''

  return apiRequest<{ goalKey: string; entries: GoalWriteTraceEntry[] }>(
    `/api/goals/${encodeURIComponent(goalKey)}/write-traces${suffix}`,
  )
}

export async function readGoalAssistantRun(goalKey: string, assistantRunId: string) {
  return apiRequest<GoalAssistantRunDetail>(
    `/api/goals/${encodeURIComponent(goalKey)}/assistant/runs/${encodeURIComponent(assistantRunId)}`,
  )
}

export async function readGoalAssistantRunBundle(goalKey: string, assistantRunId: string) {
  return apiRequest<GoalAssistantRunBundle>(
    `/api/goals/${encodeURIComponent(goalKey)}/assistant/runs/${encodeURIComponent(assistantRunId)}/bundle`,
  )
}

export async function appendGoalAssistantMessage(goalKey: string, content: string) {
  return apiRequest<AssistantThreadEntry>(
    `/api/goals/${encodeURIComponent(goalKey)}/assistant/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  )
}

export async function runGoalAssistant(goalKey: string, content: string) {
  return apiRequest<GoalAssistantRunDetail>(`/api/goals/${encodeURIComponent(goalKey)}/assistant/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

export async function reconcileGoal(goalKey: string) {
  return apiRequest<ReconcileResult>(`/api/goals/${encodeURIComponent(goalKey)}/reconcile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

export async function createGoalDecision(
  goalKey: string,
  input: {
    decisionKey?: string
    summary: string
    summaryKey?: string
    prompt?: string
    matchHints?: string[]
    taskRef?: string
  },
) {
  const response = await fetch(apiUrl(`/api/goals/${encodeURIComponent(goalKey)}/decisions`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  const decision = (await response.json()) as GoalDecision
  return {
    ...decision,
    created: response.status === 201,
  }
}

export async function createGoalTask(goalKey: string, input: GoalTaskCreateInput) {
  return apiRequest<TodoBoard>(`/api/goals/${encodeURIComponent(goalKey)}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function moveGoalTask(goalKey: string, taskRef: string, input: GoalTaskMoveInput) {
  return apiRequest<TodoBoard>(
    `/api/goals/${encodeURIComponent(goalKey)}/tasks/${encodeURIComponent(taskRef)}/move`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function resolveGoalDecision(
  goalKey: string,
  decisionKey: string,
  input: {
    summary?: string
    summaryKey?: string
    prompt?: string
    matchHints?: string[]
    taskRef?: string
    answer?: string
    sourceExcerpt?: string
    sourceOccurrence?: number
    answerSourceKey?: string
    answerSourceGroupKey?: string
    answerSources?: GoalAnswerSourceInput[]
    sourceResponse?: string
    sourceResponseFormat?: GoalSourceResponseFormat
    followThrough?: GoalDecisionFollowThroughInput
  },
) {
  return apiRequest<{
    decision: GoalDecision
    blockerRemoved?: boolean
    followThrough?: GoalDecisionFollowThroughResult
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  }>(`/api/goals/${encodeURIComponent(goalKey)}/decisions/${encodeURIComponent(decisionKey)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function answerGoalDecision(goalKey: string, input: GoalDecisionAnswerInput) {
  return apiRequest<GoalDecisionAnswerResult>(
    `/api/goals/${encodeURIComponent(goalKey)}/decisions/answer`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function answerGoalDecisions(goalKey: string, input: GoalDecisionAnswerBatchInput) {
  return apiRequest<GoalDecisionAnswerBatchResult>(
    `/api/goals/${encodeURIComponent(goalKey)}/decisions/answers`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function createGoalPlanningRequest(
  goalKey: string,
  input: {
    requestKey?: string
    groupKey?: string
    groupTaskKey?: string
    title: string
    description: string
    acceptanceCriteria: string[]
    decisionRefs?: string[]
    answers?: InterpretablePlanningAnswerInput[]
    answerSources?: GoalAnswerSourceInput[]
    sourceResponse?: string
    sourceResponseFormat?: GoalSourceResponseFormat
    inferRemainingAnswers?: boolean
    requestedUpdates?: string[]
    blockedBy?: BlockerRef[]
  },
) {
  const response = await fetch(apiUrl(`/api/goals/${encodeURIComponent(goalKey)}/planning-requests`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  const request = (await response.json()) as GoalPlanningRequest & {
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  }
  return {
    ...request,
    created: response.status === 201,
  }
}

export async function createGoalPlanningWorkflow(
  goalKey: string,
  input: GoalPlanningWorkflowCreateInput,
) {
  const response = await fetch(
    apiUrl(`/api/goals/${encodeURIComponent(goalKey)}/planning-requests/workflows`),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  const result = (await response.json()) as GoalPlanningWorkflowCreateResult & {
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  }
  return {
    ...result,
    created: response.status === 201,
  }
}

export async function updatePreferences(content: string) {
  return apiRequest<PreferenceDocument>('/api/preferences', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  })
}

export async function recordPreference(input: {
  preferenceKey?: string
  summary: string
  rationale?: string
  supersedes?: string[]
}) {
  return apiRequest<PreferenceDocument>('/api/preferences/record', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function retirePreference(input: {
  preferenceKey: string
  reason: string
  supersededBy?: string
}) {
  return apiRequest<PreferenceDocument>('/api/preferences/retire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}
