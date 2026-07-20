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

export interface AgentPlanItem {
  text: string
  completed: boolean
}

export interface AgentPlanEvent {
  kind: 'plan'
  transport: AgentTranscriptTransport
  planId: string
  status: 'active' | 'completed'
  items: AgentPlanItem[]
  vendorEventType?: string
}

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
  | AgentPlanEvent

const NON_PRESENTABLE_STATUS_TELEMETRY = new Set([
  'thread.started',
  'turn.started',
  'turn.completed',
  'system.init',
  'system.thinking_tokens',
  'system.task_progress',
  'result',
  'result.success',
  'step_start',
  'step_finish',
])

export function isPresentableAgentRuntimeEvent(event: AgentRuntimeEvent): boolean {
  return !(
    event.kind === 'transcript' &&
    event.entryKind === 'status' &&
    event.vendorEventType !== undefined &&
    NON_PRESENTABLE_STATUS_TELEMETRY.has(event.vendorEventType)
  )
}
