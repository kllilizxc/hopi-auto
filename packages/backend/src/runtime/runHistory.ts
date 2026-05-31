import { z } from 'zod'
import {
  AGENT_TRANSCRIPT_ENTRY_KINDS,
  AGENT_TRANSCRIPT_TRANSPORTS,
  type AgentRole,
  type AgentTranscriptEntryKind,
  type AgentTranscriptTransport,
} from '../agent/AgentRunner'
import { TASK_KINDS, TASK_STATUSES, type TaskKind, type TaskStatus } from '../domain/board'

export const RUN_STATUSES = ['active', 'retryable', 'completed', 'blocked', 'system_error'] as const

export const STEP_OUTCOMES = [
  'running',
  'success',
  'reject',
  'fail',
  'timeout',
  'merge_conflict',
  'system_error',
] as const

export const TERMINAL_STEP_OUTCOMES = [
  'success',
  'reject',
  'fail',
  'timeout',
  'merge_conflict',
  'system_error',
] as const

export const STEP_MESSAGE_KINDS = ['system', 'info', 'error'] as const

export type RunStatus = (typeof RUN_STATUSES)[number]
export type StepOutcome = (typeof STEP_OUTCOMES)[number]
export type StepMessageKind = (typeof STEP_MESSAGE_KINDS)[number]

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

export interface RunTranscriptEntryInput {
  transport: AgentTranscriptTransport
  kind: AgentTranscriptEntryKind
  summary: string
  toolName?: string
  vendorEventType?: string
}

export interface RunStepMessageInput {
  kind: StepMessageKind
  role: string
  content: string
}

export type RunStepEventInput =
  | {
      kind: 'message'
      level: StepMessageKind
      role: string
      content: string
    }
  | {
      kind: 'transcript'
      transport: AgentTranscriptTransport
      entryKind: AgentTranscriptEntryKind
      summary: string
      toolName?: string
      vendorEventType?: string
    }
  | {
      kind: 'worktree_prepared'
      path: string
      branch?: string
      baseBranch?: string
    }
  | {
      kind: 'artifact'
      ref: string
      label: string
    }

export interface RunStepMessage extends RunStepMessageInput {
  messageId: string
  createdAt: string
}

export interface RunTranscriptEntry extends RunTranscriptEntryInput {
  entryId: string
  createdAt: string
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

export interface GoalRun {
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

export interface GoalRunHistory {
  goalKey: string
  runs: GoalRun[]
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

const RunStepMessageSchema = z.object({
  messageId: z.string().min(1),
  createdAt: z.string().datetime(),
  kind: z.enum(STEP_MESSAGE_KINDS),
  role: z.string().min(1),
  content: z.string(),
})

const RunTranscriptEntrySchema = z.object({
  entryId: z.string().min(1),
  createdAt: z.string().datetime(),
  transport: z.enum(AGENT_TRANSCRIPT_TRANSPORTS),
  kind: z.enum(AGENT_TRANSCRIPT_ENTRY_KINDS),
  summary: z.string().min(1),
  toolName: z.string().min(1).optional(),
  vendorEventType: z.string().min(1).optional(),
})

const RunArtifactRefSchema = z.object({
  ref: z.string().min(1),
  label: z.string().min(1),
})

const RunWorktreeRefSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1).optional(),
  baseBranch: z.string().min(1).optional(),
})

const RunStepExecutionSchema = z.object({
  worktree: RunWorktreeRefSchema.optional(),
  artifacts: z.array(RunArtifactRefSchema).default([]),
})

const GoalRunStepSchema = z.object({
  stepId: z.string().min(1),
  role: z.enum(['planner', 'generator', 'reviewer', 'merger']),
  statusBefore: z.enum(TASK_STATUSES),
  statusAfter: z.enum(TASK_STATUSES).optional(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  outcome: z.enum(STEP_OUTCOMES),
  transcript: z.array(RunTranscriptEntrySchema).default([]),
  messages: z.array(RunStepMessageSchema),
  execution: RunStepExecutionSchema.optional(),
})

const GoalRunSchema = z.object({
  runId: z.string().min(1),
  taskRef: z.string().min(1),
  taskKind: z.enum(TASK_KINDS),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: z.enum(RUN_STATUSES),
  finalTaskStatus: z.enum(TASK_STATUSES).optional(),
  terminalOutcome: z.enum(TERMINAL_STEP_OUTCOMES).optional(),
  steps: z.array(GoalRunStepSchema),
})

const GoalRunHistorySchema = z.object({
  goalKey: z.string().min(1),
  runs: z.array(GoalRunSchema).default([]),
})

export function emptyGoalRunHistory(goalKey: string): GoalRunHistory {
  return {
    goalKey,
    runs: [],
  }
}

export function parseGoalRunHistory(source: string): GoalRunHistory {
  const raw = JSON.parse(source)
  return validateGoalRunHistory(raw)
}

export function validateGoalRunHistory(input: unknown): GoalRunHistory {
  const parsed = GoalRunHistorySchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid run history format: ${issues}`)
  }

  return parsed.data
}

export function toRunSummary(run: GoalRun): GoalRunSummary {
  return {
    runId: run.runId,
    taskRef: run.taskRef,
    taskKind: run.taskKind,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    finalTaskStatus: run.finalTaskStatus,
    terminalOutcome: run.terminalOutcome,
    stepCount: run.steps.length,
  }
}

export function createStoredMessage(
  input: RunStepMessageInput,
  createdAt = new Date().toISOString(),
) {
  return {
    messageId: crypto.randomUUID(),
    createdAt,
    ...input,
  } satisfies RunStepMessage
}

export function createStoredTranscript(
  input: RunTranscriptEntryInput,
  createdAt = new Date().toISOString(),
) {
  return {
    entryId: crypto.randomUUID(),
    createdAt,
    ...input,
  } satisfies RunTranscriptEntry
}
