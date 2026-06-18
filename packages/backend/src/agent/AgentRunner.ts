import type { TaskKind } from '../domain/board'

export type AgentRole = 'planner' | 'generator' | 'reviewer' | 'merger'
export const AGENT_TRANSCRIPT_TRANSPORTS = ['process', 'codex', 'claude', 'opencode'] as const
export const AGENT_TRANSCRIPT_ENTRY_KINDS = [
  'status',
  'assistant',
  'tool_call',
  'tool_result',
  'error',
] as const

export type AgentTranscriptTransport = (typeof AGENT_TRANSCRIPT_TRANSPORTS)[number]
export type AgentTranscriptEntryKind = (typeof AGENT_TRANSCRIPT_ENTRY_KINDS)[number]

export type AgentRuntimeEvent =
  | {
      kind: 'message'
      level: 'info' | 'error'
      role: string
      content: string
    }
  | {
      kind: 'transcript'
      transport: AgentTranscriptTransport
      entryKind: AgentTranscriptEntryKind
      summary: string
      toolName?: string
      toolInvocationKey?: string
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

export type AgentOutcome =
  | { kind: 'success'; artifactRef?: string }
  | { kind: 'reject'; artifactRef?: string; reason: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'timeout'; reason: string }
  | { kind: 'merge_conflict'; artifactRef: string }

export interface AgentStepInput {
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  taskKind: TaskKind
  role: AgentRole
}

export interface AgentRunObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onHeartbeat?(): Promise<void> | void
}

export interface AgentRunner {
  run(input: AgentStepInput, observer?: AgentRunObserver): Promise<AgentOutcome>
}

export class MockAgentRunner implements AgentRunner {
  private readonly plan: Record<string, MockAgentScriptEntry[]>

  constructor(plan: Record<string, MockAgentScriptEntry[]> = {}) {
    this.plan = Object.fromEntries(
      Object.entries(plan).map(([key, entries]) => [key, [...entries]]),
    )
  }

  async run(input: AgentStepInput, observer?: AgentRunObserver): Promise<AgentOutcome> {
    const key = outcomeKey(input.taskRef, input.role)
    const entry = this.plan[key]?.shift() ?? { outcome: { kind: 'success' } }

    for (const event of entry.events ?? []) {
      await observer?.onEvent?.(event)
    }

    return entry.outcome
  }
}

export interface MockAgentScriptEntry {
  events?: AgentRuntimeEvent[]
  outcome: AgentOutcome
}

function outcomeKey(taskRef: string, role: AgentRole) {
  return `${taskRef}:${role}`
}
