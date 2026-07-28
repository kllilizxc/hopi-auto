export type GoalLifecycle = 'active' | 'paused' | 'done' | 'cancelled'
export type KanbanColumn = 'Plan' | 'Build' | 'Review' | 'Done'
export type WorkBadge =
  | 'Needs you'
  | 'Waiting for Assistant'
  | 'working'
  | 'scheduled'
  | 'queued'
  | 'waiting'
export type Responsibility = 'planner' | 'generator' | 'reviewer'
export type ConfigurableAgentRole = 'assistant' | Responsibility
export type PassResult = 'success' | 'reject' | 'attention' | 'fail' | 'replan'
export type RunAttemptStatus = 'queued' | 'running' | 'finished' | 'interrupted'
export type CodingAgentTransport = 'codex' | 'claude' | 'opencode'
export type CodingReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export type ProjectCodingDefaults =
  | {
      transport: 'codex'
      model: string
      reasoningEffort: CodingReasoningEffort
    }
  | {
      transport: 'claude' | 'opencode'
      model?: string
    }

export interface AgentRoleCodingSettings {
  codingDefaults: ProjectCodingDefaults
  inherited: boolean
  configurable: boolean
}

export interface PreviewFailure {
  kind: 'failed'
  reason: 'missing' | 'not_executable' | 'preparation_failed' | 'startup_failed'
  logs: string
  session: PreviewSession
}

export interface PreviewSurface {
  id: string
  label: string
  url: string
}

export interface PreviewSession {
  sessionId: string
  projectId: string
  releaseHeads: Record<string, string>
  status: 'starting' | 'running' | 'stopped' | 'failed'
  surfaces: PreviewSurface[]
  logPath: string
  manifestPath: string
  startedAt: string
  endedAt: string | null
  processId: number | null
  preparation: {
    kind: 'ready' | 'absent' | 'not_executable' | 'failed' | 'source_changed' | 'skipped_dirty'
    adapterPath: string
    exitCode: number | null
    logPath: string
    reposFile: string
  } | null
  error: string | null
  stoppedReason: 'release_updated' | null
  failureReason: PreviewFailure['reason'] | null
}

export interface GoalSummary {
  id: string
  title: string
  createdAt: string | null
  lifecycle: GoalLifecycle
  priority: number
  currentSummary: string
  nextSummary: string
  openAttentionCount: number
  completion: {
    id: string
    completedAt: string
  } | null
}

export interface ProjectRepoSummary {
  repoId: string
  repoPath: string
  projectPath: string
  integrationRoot: string
  primary: boolean
}

export interface ProjectRebindPlan {
  command: 'project.rebind'
  summary: string
  effects: string[]
  warnings: string[]
}

export interface ProjectSummary {
  projectId: string
  label?: string
  primaryRepoId: string
  repos: ProjectRepoSummary[]
  repoPath: string
  projectPath: string
  guidance: string | null
  preview: PreviewSession | null
  openAttentionCount: number
  needsYouCount: number
  goals: GoalSummary[]
}

export type ProjectDirectorySelection =
  | {
      kind: 'git_repository'
      path: string
      repoPath: string
      projectPath: string
    }
  | {
      kind: 'empty_directory'
      path: string
    }
  | {
      kind: 'non_git_directory'
      path: string
      entryCount: number
    }

export interface InboxEventView {
  id: string
  receivedAt: string
  status: 'pending' | 'handled'
  source: 'user' | 'system' | 'reflection'
  visibility: 'public' | 'internal'
  body: string
  attachments: InboxImageAttachmentView[]
  reply: string | null
  disposition: string | null
  context: {
    projectId?: string
    goalId?: string
    attentionRefs?: string[]
    replyTo?: string
    observedDigest?: string
  } | null
  runtimeStatus: 'queued' | 'running' | 'interrupted' | 'completed' | 'failed'
  runtimeEvents: RunAttemptEvent[]
  runtimeError: string | null
}

export interface InboxImageAttachmentView {
  reference: string
  fileName: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  sizeBytes: number
  url: string
}

export interface ReflectionRunDetail {
  manifest: {
    reflectionId: string
    stateDigest: string
    scope?: { kind: 'home' } | { kind: 'project'; projectId: string }
    status: 'running' | 'completed' | 'interrupted' | 'failed'
    startedAt: string
    endedAt: string | null
    error: string | null
    handoffEventId: string | null
  }
  events: RunAttemptEvent[]
  paths: { prompt: string; transcript: string; events: string }
}

export type ReflectionRunSummary = Omit<ReflectionRunDetail, 'events'>

export interface AssistantDecisionOption {
  id: string
  label: string
  description: string
  recommended?: boolean
  detailPrompt?: string
}

export interface AssistantDecisionQuestion {
  id: string
  header: string
  question: string
  options: AssistantDecisionOption[]
  allowOther: boolean
}

export interface AssistantDecisionPrompt {
  questions: AssistantDecisionQuestion[]
}

export interface AttentionView {
  scope: 'workspace' | 'goal'
  id: string
  target?: string
  createdAt: string
  updatedAt?: string
  resolvedAt: string | null
  refs?: string[]
  summary: string
  decisionPrompt?: AssistantDecisionPrompt | null
  body: string
  projectId?: string
  goalId?: string
}

export type AttentionSummaryView = Omit<AttentionView, 'body'>

export interface GoalCompletionView {
  projectId: string
  goalId: string
  evidenceId: string
  completedAt: string
  body: string
}

export type AssistantFeedEntry =
  | {
      kind: 'event'
      id: string
      occurredAt: string
      event: InboxEventView
    }
  | {
      kind: 'goal_completion'
      id: string
      occurredAt: string
      completion: GoalCompletionView
    }

export interface AssistantFeedActivity {
  phase: 'waiting' | 'working' | 'thinking'
}

export interface AssistantOpenRequest {
  eventId: string
  attentions: AttentionView[]
}

export interface CursorPageInfo {
  oldestCursor: string | null
  newestCursor: string | null
  hasOlder: boolean
  hasNewer: boolean
  totalCount: number
}

export interface CursorPage<T> {
  items: T[]
  pageInfo: CursorPageInfo
}

export interface AssistantFeedPage extends CursorPage<AssistantFeedEntry> {
  requests: AssistantOpenRequest[]
  activity: AssistantFeedActivity | null
  syncCursor: string | null
  streamId: string
}

export interface AssistantFeedChanges {
  items: AssistantFeedEntry[]
  removedIds: string[]
  requests: AssistantOpenRequest[]
  activity: AssistantFeedActivity | null
  syncCursor: string | null
  streamId: string
}

export interface AppSnapshot {
  home: {
    homeId: string
    agentRoleCodingDefaults: Record<ConfigurableAgentRole, AgentRoleCodingSettings>
  }
  projects: ProjectSummary[]
  attentions: AttentionView[]
  activeRuns: Array<{
    key: string
    runId: string
    responsibility: Responsibility
    status: 'queued' | 'running'
    requestedAt: string
    startedAt: string | null
    waitReason: 'capacity' | null
  }>
}

export type AgentRuntimeTransport = 'process' | 'codex' | 'claude' | 'opencode'

export interface AgentPlanItem {
  text: string
  completed: boolean
}

export interface AgentPlanSnapshot {
  transport: AgentRuntimeTransport
  planId: string
  status: 'active' | 'completed'
  items: AgentPlanItem[]
  vendorEventType?: string
}

export interface WorkAgentPlan extends AgentPlanSnapshot {
  runId: string
}

export interface WorkView {
  id: string
  title: string
  kind: 'planning' | 'engineering'
  stage: 'plan' | 'generate' | 'review' | 'done' | 'cancelled'
  notBefore: string | null
  dependsOn: string[]
  contractRevision: number
  evidenceRefs: string[]
  runAttemptCount: number
  completedAt: string | null
  body: string
  agentPlan: WorkAgentPlan | null
  activeAttempt: {
    key: string
    runId: string
    responsibility: Responsibility
    status: 'queued' | 'running'
    requestedAt: string
    startedAt: string | null
    waitReason: 'capacity' | null
  } | null
  blockedBy: string | null
  projection: {
    workId: string
    column: KanbanColumn | null
    cancelled: boolean
    ready: boolean
    responsibility: Responsibility | null
    primaryBadge: WorkBadge | null
    failedPredicates: string[]
  }
}

export type WorkCardView = Omit<WorkView, 'body'>

export interface WorkDocumentView {
  id: string
  body: string
}

export interface GoalDocumentView {
  path: string
  content: string
}

export interface RunAttemptSummary {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  execution: {
    transport: AgentRuntimeTransport
    model: string | null
    reasoningEffort: CodingReasoningEffort | null
  } | null
  requestedAt: string
  startedAt: string | null
  endedAt: string | null
  status: RunAttemptStatus
  result: PassResult | null
  summary: string | null
  exitCode: number | null
  application: string | null
  diagnostics?: RunAttemptDiagnostics | null
}

export interface RunTokenUsage {
  inputTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
}

export interface RunAttemptDiagnostics {
  elapsedMs: number
  modelMessages: number
  toolCalls: number
  commandCalls: number
  observedToolWallTimeMs: number
  observedCommandWallTimeMs: number
  modelAndOverheadWallTimeMs: number
  turns: number | null
  vendorReportedCostUsd: number | null
  tokenUsage: RunTokenUsage | null
}

export interface RunCostSummary {
  runs: number
  elapsedMs: number
  modelMessages: number
  runsWithTurnCount: number
  reportedTurns: number
  toolCalls: number
  commandCalls: number
  observedToolWallTimeMs: number
  observedCommandWallTimeMs: number
  modelAndOverheadWallTimeMs: number
  runsWithTokenUsage: number
  inputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  runsWithVendorReportedCost: number
  vendorReportedCostUsd: number
  outcomes: {
    success: number
    rejected: number
    preparationFailed: number
    failed: number
    interrupted: number
    stale: number
  }
}

export interface GoalExecutionCost {
  projectId: string
  goalId: string
  summary: RunCostSummary
  byWork: Array<{ workId: string; summary: RunCostSummary }>
  byResponsibility: Array<{ responsibility: Responsibility; summary: RunCostSummary }>
  runs: Array<RunAttemptSummary & { diagnostics: RunAttemptDiagnostics }>
}

export type RunAttemptEvent =
  | {
      eventId: string
      createdAt: string
      kind: 'message'
      level: 'info' | 'error'
      role: string
      content: string
      streamIndex?: number
    }
  | {
      eventId: string
      createdAt: string
      kind: 'transcript'
      transport: AgentRuntimeTransport
      entryKind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
      summary: string
      toolName?: string
      toolInvocationKey?: string
      vendorEventType?: string
      streamIndex?: number
    }
  | {
      eventId: string
      createdAt: string
      kind: 'plan'
      transport: AgentRuntimeTransport
      planId: string
      status: 'active' | 'completed'
      items: AgentPlanItem[]
      vendorEventType?: string
      streamIndex?: number
    }

export interface RunAttemptDetail extends RunAttemptSummary {
  runPrompt: string | null
}

export interface EvidenceView {
  id: string
  createdAt: string
  producerRun: string | null
  coordinatorCheck: string | null
  owner: string
  artifacts: string[]
  body: string
}

export interface GoalDetail {
  projectId: string
  goal: {
    id: string
    title: string
    lifecycle: GoalLifecycle
    priority: number
    contractRevision: number
    body: string
  }
  works: WorkView[]
  design: Array<{ path: string; content: string }>
  attentions: AttentionView[]
  projectAttention: AttentionView | null
  evidence: EvidenceView[]
}

export interface GoalBoardDetail {
  projectId: string
  goal: GoalDetail['goal']
  works: WorkCardView[]
  attentions: AttentionSummaryView[]
  projectAttention: AttentionView | null
}

export interface GoalDocsDetail {
  projectId: string
  goal: GoalDetail['goal']
  design: Array<{ path: string; excerpt: string }>
  evidence: Array<
    Pick<EvidenceView, 'id' | 'createdAt' | 'producerRun' | 'owner'> & { excerpt: string }
  >
}

export type PreviewStartResult =
  | { kind: 'starting' | 'started'; session: PreviewSession }
  | PreviewFailure
