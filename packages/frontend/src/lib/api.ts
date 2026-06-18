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
  running?: boolean
}

export interface TodoBoard {
  version: 1
  goal: {
    goalKey: string
    title: string
  }
  items: TodoTaskItem[]
}

export interface GoalAttachmentRef {
  assetPath: string
  fileName: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  sizeBytes: number
  createdAt: string
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
      kind: 'user_message'
      content: string
      attachments: GoalAttachmentRef[]
    }
  | {
      entryId: string
      createdAt: string
      kind: 'assistant_message'
      content: string
      mergeKey?: string
    }
  | {
      entryId: string
      createdAt: string
      kind: 'system_message'
      label: string
      content: string
      details: string[]
      dedupeKey?: string
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

export interface GoalAssistantAttachmentUploadResult {
  goalKey: string
  attachments: GoalAttachmentRef[]
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
  attachments?: GoalAttachmentRef[]
  status: 'completed' | 'failed'
  message: string
}

export type MessageFeedItemKind =
  | 'user_message'
  | 'assistant_message'
  | 'assistant_delta'
  | 'system_message'
  | 'tool_call'
  | 'tool_result'
  | 'status'

export type MessageFeedRole = 'user' | 'assistant' | 'system'

export interface MessageFeedItem {
  id: string
  createdAt: string
  kind: MessageFeedItemKind
  role: MessageFeedRole
  text: string
  collapsedByDefault: boolean
  label?: string
  details?: string[]
  attachments?: GoalAttachmentRef[]
  runId?: string
  stepId?: string
  stepRole?: AgentRole
  toolName?: string
  toolInvocationKey?: string
  transport?: TranscriptTransport
  vendorEventType?: string
  mergeKey?: string
  pending?: boolean
  notification?: {
    kind:
      | 'task_blocked_intervention'
      | 'task_blocked_merge_conflict'
      | 'task_blocked_decision'
      | 'open_decision'
      | 'automation_failed'
    taskRef?: string
    blocker?: {
      kind: 'task' | 'decision' | 'merge_conflict' | 'intervention'
      ref: string
    }
    decisionKey?: string
    actions: Array<'retry_task' | 'answer_decision' | 'inspect_task' | 'open_run'>
  }
}

export interface MessageFeedPage {
  items: MessageFeedItem[]
  oldestCursor?: string
  newestCursor?: string
  hasMoreBefore: boolean
}

export interface MessageFeedStreamEvent {
  type: 'connected' | 'item'
  item?: MessageFeedItem
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

export interface GoalRunStepBundleFile {
  path: string
  content: string | null
}

export interface GoalRunStepBundle {
  goalKey: string
  runId: string
  stepId: string
  context: GoalRunStepBundleFile
  prompt: GoalRunStepBundleFile
  outcome: GoalRunStepBundleFile
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
  mode?: 'single' | 'batch' | 'workflow' | 'upsert' | 'retire'
  attachmentAssetPaths?: string[]
  status?: TaskStatus
  taskRef?: string
  clearBlockers?: BlockerRef[]
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
  attachments?: GoalAttachmentRef[]
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
  attachments?: GoalAttachmentRef[]
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
  mode?: 'single' | 'batch' | 'workflow' | 'upsert' | 'retire'
  summary: string
  taskRef?: string
  task?: TodoTaskItem
  clearedBlockers?: BlockerRef[]
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
  attachments?: GoalAttachmentRef[]
  context: GoalAssistantRunBundleFile
  prompt: GoalAssistantRunBundleFile
  outcome: GoalAssistantRunBundleFile
  result: GoalAssistantRunBundleFile
}

export interface GoalEvent {
  type?: string
  projectKey?: string
  goalKey?: string
  status?: AutomationStatus
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
  attachments?: GoalAttachmentRef[]
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
  attachments?: GoalAttachmentRef[]
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

export type ReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: BlockerRef }

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? ''

function apiUrl(path: string) {
  return configuredApiBase ? `${configuredApiBase}${path}` : path
}

function goalApiPath(goalKey: string, projectKey: string | undefined, suffix: string) {
  if (projectKey) {
    return `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}${suffix}`
  }

  return `/api/goals/${encodeURIComponent(goalKey)}${suffix}`
}

export function goalAssetUrl(goalKey: string, assetPath: string, projectKey?: string) {
  const normalized = assetPath.startsWith('assets/') ? assetPath.slice('assets/'.length) : assetPath
  const encodedPath = normalized
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return apiUrl(goalApiPath(goalKey, projectKey, `/assets/${encodedPath}`))
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

export function openGoalAssistantFeedStream(
  goalKey: string,
  projectKey?: string,
  after?: string,
) {
  const query = new URLSearchParams()
  if (after) {
    query.set('after', after)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return new EventSource(apiUrl(`${goalApiPath(goalKey, projectKey, '/assistant/feed/stream')}${suffix}`))
}

export function openGoalRunFeedStream(
  goalKey: string,
  runId: string,
  options?: {
    projectKey?: string
    stepId?: string | null
    after?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.stepId) {
    query.set('stepId', options.stepId)
  }
  if (options?.after) {
    query.set('after', options.after)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return new EventSource(
    apiUrl(
      `${goalApiPath(goalKey, options?.projectKey, `/runs/${encodeURIComponent(runId)}/feed/stream`)}${suffix}`,
    ),
  )
}

export function readProjects() {
  return apiRequest<{ projects: ProjectRecord[] }>('/api/projects')
}

export function createProject(input: {
  projectKey?: string
  name?: string
  rootDir: string
  codingDefaults?: ProjectCodingDefaults
}) {
  return apiRequest<ProjectRecord>('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function updateProjectSettings(
  projectKey: string,
  input: {
    codingDefaults?: ProjectCodingDefaults
  },
) {
  return apiRequest<ProjectRecord>(`/api/projects/${encodeURIComponent(projectKey)}/settings`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function readProjectGoals(projectKey: string) {
  return apiRequest<{ projectKey: string; goals: ProjectGoalSummary[] }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals`,
  )
}

export function createProjectGoal(
  projectKey: string,
  input: {
    goalKey: string
    title: string
    objective: string
    successCriteria?: string[]
  },
) {
  return apiRequest<ProjectGoalSummary>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function readGoalAutomation(projectKey: string, goalKey: string) {
  return apiRequest<{ status: AutomationStatus }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/automation`,
  )
}

export function startGoalAutomation(
  projectKey: string,
  goalKey: string,
  input: {
    maxSteps?: number
    maxParallel?: number
    laneParallelism?: Partial<LaneParallelism>
  } = {},
) {
  return apiRequest<{ status: AutomationStatus; alreadyRunning: boolean }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export function stopGoalAutomation(projectKey: string, goalKey: string) {
  return apiRequest<{ status: AutomationStatus }>(
    `/api/projects/${encodeURIComponent(projectKey)}/goals/${encodeURIComponent(goalKey)}/stop`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  )
}

export function readGoalBoard(goalKey: string, projectKey?: string) {
  return apiRequest<TodoBoard>(goalApiPath(goalKey, projectKey, '/board'))
}

export function readGoalDocs(goalKey: string, projectKey?: string) {
  return apiRequest<GoalDocsSnapshot>(goalApiPath(goalKey, projectKey, '/docs'))
}

export function readGoalDecisions(goalKey: string, projectKey?: string) {
  return apiRequest<GoalDecisionSet>(goalApiPath(goalKey, projectKey, '/decisions'))
}

export function readGoalPlanningRequests(goalKey: string, projectKey?: string) {
  return apiRequest<GoalPlanningRequestSet>(goalApiPath(goalKey, projectKey, '/planning-requests'))
}

export function readGoalPlanningWorkflows(goalKey: string, projectKey?: string) {
  return apiRequest<{ goalKey: string; workflows: GoalPlanningWorkflowState[] }>(
    goalApiPath(goalKey, projectKey, '/planning-requests/workflows'),
  )
}

export function readGoalPlanningWorkflow(
  goalKey: string,
  workflowKey: string,
  projectKey?: string,
) {
  return apiRequest<GoalPlanningWorkflowState>(
    goalApiPath(
      goalKey,
      projectKey,
      `/planning-requests/workflows/${encodeURIComponent(workflowKey)}`,
    ),
  )
}

export function readPreferences() {
  return apiRequest<PreferenceDocument>('/api/preferences')
}

export async function readGoalAssistantThread(goalKey: string, projectKey?: string) {
  return apiRequest<GoalAssistantThread>(goalApiPath(goalKey, projectKey, '/assistant/thread'))
}

export async function readGoalAssistantFeed(
  goalKey: string,
  options?: {
    before?: string
    limit?: number
    projectKey?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.before) {
    query.set('before', options.before)
  }
  if (typeof options?.limit === 'number') {
    query.set('limit', String(options.limit))
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiRequest<MessageFeedPage>(
    `${goalApiPath(goalKey, options?.projectKey, '/assistant/feed')}${suffix}`,
  )
}

export async function readGoalAssistantRuns(goalKey: string, projectKey?: string) {
  return apiRequest<{ goalKey: string; runs: AssistantRunSummary[] }>(
    goalApiPath(goalKey, projectKey, '/assistant/runs'),
  )
}

export async function readGoalRuns(goalKey: string, projectKey?: string) {
  return apiRequest<{ goalKey: string; runs: GoalRunSummary[] }>(
    goalApiPath(goalKey, projectKey, '/runs'),
  )
}

export async function readGoalRun(goalKey: string, runId: string, projectKey?: string) {
  return apiRequest<GoalRunDetail>(
    goalApiPath(goalKey, projectKey, `/runs/${encodeURIComponent(runId)}`),
  )
}

export async function readGoalRunStepBundle(
  goalKey: string,
  runId: string,
  stepId: string,
  projectKey?: string,
) {
  return apiRequest<GoalRunStepBundle>(
    goalApiPath(
      goalKey,
      projectKey,
      `/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/bundle`,
    ),
  )
}

export async function readGoalRunFeed(
  goalKey: string,
  runId: string,
  options?: {
    before?: string
    limit?: number
    stepId?: string | null
    projectKey?: string
  },
) {
  const query = new URLSearchParams()
  if (options?.before) {
    query.set('before', options.before)
  }
  if (typeof options?.limit === 'number') {
    query.set('limit', String(options.limit))
  }
  if (options?.stepId) {
    query.set('stepId', options.stepId)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return apiRequest<MessageFeedPage>(
    `${goalApiPath(goalKey, options?.projectKey, `/runs/${encodeURIComponent(runId)}/feed`)}${suffix}`,
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
  projectKey?: string,
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
    `${goalApiPath(goalKey, projectKey, '/write-traces')}${suffix}`,
  )
}

export async function readGoalAssistantRun(
  goalKey: string,
  assistantRunId: string,
  projectKey?: string,
) {
  return apiRequest<GoalAssistantRunDetail>(
    goalApiPath(
      goalKey,
      projectKey,
      `/assistant/runs/${encodeURIComponent(assistantRunId)}`,
    ),
  )
}

export async function readGoalAssistantRunBundle(
  goalKey: string,
  assistantRunId: string,
  projectKey?: string,
) {
  return apiRequest<GoalAssistantRunBundle>(
    goalApiPath(
      goalKey,
      projectKey,
      `/assistant/runs/${encodeURIComponent(assistantRunId)}/bundle`,
    ),
  )
}

export async function appendGoalAssistantMessage(
  goalKey: string,
  input: { content: string; attachments?: GoalAttachmentRef[] },
  projectKey?: string,
) {
  return apiRequest<AssistantThreadEntry>(goalApiPath(goalKey, projectKey, '/assistant/messages'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      attachments: input.attachments ?? [],
    }),
  })
}

export async function runGoalAssistant(
  goalKey: string,
  input: {
    content: string
    images?: File[]
    attachments?: GoalAttachmentRef[]
    appendUserMessage?: boolean
  },
  projectKey?: string,
) {
  const path = goalApiPath(goalKey, projectKey, '/assistant/run')
  if (!input.images || input.images.length === 0) {
    return apiRequest<GoalAssistantRunDetail>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: input.content,
        attachments: input.attachments ?? [],
        appendUserMessage: input.appendUserMessage ?? true,
      }),
    })
  }

  const formData = new FormData()
  formData.set('content', input.content)
  formData.set('appendUserMessage', String(input.appendUserMessage ?? true))
  for (const image of input.images) {
    formData.append('images[]', image)
  }

  const response = await fetch(apiUrl(path), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as GoalAssistantRunDetail
}

export async function uploadGoalAssistantImages(
  goalKey: string,
  images: File[],
  projectKey?: string,
) {
  const formData = new FormData()
  for (const image of images) {
    formData.append('images[]', image)
  }

  const response = await fetch(apiUrl(goalApiPath(goalKey, projectKey, '/assistant/attachments')), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errorBody?.error ?? `Request failed with ${response.status}`)
  }

  return (await response.json()) as GoalAssistantAttachmentUploadResult
}

export async function reconcileGoal(goalKey: string, projectKey?: string) {
  return apiRequest<ReconcileResult>(goalApiPath(goalKey, projectKey, '/reconcile'), {
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
  projectKey?: string,
) {
  const response = await fetch(apiUrl(goalApiPath(goalKey, projectKey, '/decisions')), {
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

export async function createGoalTask(goalKey: string, input: GoalTaskCreateInput, projectKey?: string) {
  return apiRequest<TodoBoard>(goalApiPath(goalKey, projectKey, '/tasks'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function moveGoalTask(
  goalKey: string,
  taskRef: string,
  input: GoalTaskMoveInput,
  projectKey?: string,
) {
  return apiRequest<TodoBoard>(
    goalApiPath(goalKey, projectKey, `/tasks/${encodeURIComponent(taskRef)}/move`),
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
  projectKey?: string,
) {
  return apiRequest<{
    decision: GoalDecision
    blockerRemoved?: boolean
    followThrough?: GoalDecisionFollowThroughResult
    resolvedSourceResponseFormat?: GoalSourceResponseFormat
  }>(goalApiPath(goalKey, projectKey, `/decisions/${encodeURIComponent(decisionKey)}/resolve`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function answerGoalDecision(
  goalKey: string,
  input: GoalDecisionAnswerInput,
  projectKey?: string,
) {
  return apiRequest<GoalDecisionAnswerResult>(
    goalApiPath(goalKey, projectKey, '/decisions/answer'),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
}

export async function answerGoalDecisions(
  goalKey: string,
  input: GoalDecisionAnswerBatchInput,
  projectKey?: string,
) {
  return apiRequest<GoalDecisionAnswerBatchResult>(
    goalApiPath(goalKey, projectKey, '/decisions/answers'),
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
  projectKey?: string,
) {
  const response = await fetch(apiUrl(goalApiPath(goalKey, projectKey, '/planning-requests')), {
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
  projectKey?: string,
) {
  const response = await fetch(apiUrl(goalApiPath(goalKey, projectKey, '/planning-requests/workflows')), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
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
