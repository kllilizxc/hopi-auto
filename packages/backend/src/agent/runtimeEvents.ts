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
