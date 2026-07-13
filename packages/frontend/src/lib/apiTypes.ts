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
export type PassResult = 'success' | 'reject' | 'attention' | 'fail' | 'replan'
export type RunAttemptStatus = 'running' | 'finished' | 'interrupted'
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

export interface PreviewSession {
  sessionId: string
  projectId: string
  status: 'starting' | 'running' | 'stopped' | 'failed'
  endpoint: string | null
  logPath: string
  startedAt: string
  endedAt: string | null
  error: string | null
  stoppedReason: 'release_updated' | null
}

export interface GoalSummary {
  id: string
  title: string
  lifecycle: GoalLifecycle
  priority: number
  currentSummary: string
  nextSummary: string
  openAttentionCount: number
}

export interface ProjectRepoSummary {
  repoId: string
  repoPath: string
  integrationRoot: string
  primary: boolean
}

export interface ProjectSummary {
  projectId: string
  primaryRepoId: string
  repos: ProjectRepoSummary[]
  repoPath: string
  guidance: string | null
  codingDefaults: ProjectCodingDefaults
  codingDefaultsInherited: boolean
  preview: PreviewSession | null
  openAttentionCount: number
  goals: GoalSummary[]
}

export interface InboxEventView {
  id: string
  receivedAt: string
  status: 'pending' | 'handled'
  source: 'user' | 'reflection'
  visibility: 'public' | 'internal'
  body: string
  attachments: InboxImageAttachmentView[]
  reply: string | null
  disposition: string | null
  context: {
    projectId?: string
    goalId?: string
    attentionId?: string
    attentionRefs?: string[]
    observedDigest?: string
  } | null
  routeClaim: { projectId: string; goalId: string; mode: 'existing' | 'create' } | null
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
    version: 1
    reflectionId: string
    stateDigest: string
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

export interface AttentionView {
  scope: 'workspace' | 'goal'
  id: string
  target: string | null
  createdAt: string
  resolvedAt: string | null
  notifiedAt: string | null
  body: string
  projectId?: string
  goalId?: string
}

export type AssistantFeedEntry =
  | {
      kind: 'event'
      id: string
      occurredAt: string
      event: InboxEventView
      completion: AttentionView | null
    }
  | {
      kind: 'completion'
      id: string
      occurredAt: string
      attention: AttentionView
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

export interface AppSnapshot {
  home: { homeId: string }
  projects: ProjectSummary[]
  attentions: AttentionView[]
  activeRuns: Array<{ key: string; responsibility: Responsibility }>
}

export interface WorkView {
  id: string
  title: string
  kind: 'planning' | 'engineering'
  stage: 'plan' | 'generate' | 'review' | 'done' | 'cancelled'
  notBefore: string | null
  dependsOn: string[]
  repos?: string[]
  contractRevision: number
  evidenceRefs: string[]
  attempts: number
  body: string
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

export interface RunAttemptSummary {
  version: 1
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  startedAt: string
  endedAt: string | null
  status: RunAttemptStatus
  result: PassResult | null
  summary: string | null
  exitCode: number | null
  application: string | null
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
      transport: 'process' | 'codex' | 'claude' | 'opencode'
      entryKind: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
      summary: string
      toolName?: string
      toolInvocationKey?: string
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
    completionAttentionId: string | null
    body: string
  }
  works: WorkView[]
  design: Array<{ path: string; content: string }>
  attentions: AttentionView[]
  evidence: EvidenceView[]
}

export type PreviewStartResult =
  | { kind: 'started'; session: PreviewSession }
  | {
      kind: 'repair_required'
      reason: 'missing' | 'not_executable' | 'startup_failed'
      prompt: string
      logs: string
    }
