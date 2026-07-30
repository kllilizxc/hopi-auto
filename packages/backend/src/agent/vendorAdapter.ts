import type { AgentTranscriptTransport } from './runtimeEvents'
import type { ProcessTranscriptFormat } from './vendorTranscript'

export type AssistantTransport = Exclude<AgentTranscriptTransport, 'process'>

export interface VendorSession {
  transport: AssistantTransport
  sessionId: string
  executionKey?: string
}

export interface VendorAdapterDefinition {
  transport: AssistantTransport
  displayName: string
  transcriptFormat: Exclude<ProcessTranscriptFormat, 'plain'>
  autoCompactionDisableKeys: readonly string[]
}

export const VENDOR_ADAPTERS = {
  codex: {
    transport: 'codex',
    displayName: 'Codex',
    transcriptFormat: 'codex_jsonl',
    autoCompactionDisableKeys: [],
  },
  claude: {
    transport: 'claude',
    displayName: 'Claude',
    transcriptFormat: 'claude_stream_json',
    autoCompactionDisableKeys: ['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT'],
  },
  opencode: {
    transport: 'opencode',
    displayName: 'OpenCode',
    transcriptFormat: 'opencode_json',
    autoCompactionDisableKeys: ['OPENCODE_DISABLE_AUTOCOMPACT'],
  },
} as const satisfies Record<AssistantTransport, VendorAdapterDefinition>

export function vendorAdapterFor(transport: AssistantTransport): VendorAdapterDefinition {
  return VENDOR_ADAPTERS[transport]
}

export function transportForTranscriptFormat(
  format: Exclude<ProcessTranscriptFormat, 'plain'>,
): AssistantTransport {
  for (const adapter of Object.values(VENDOR_ADAPTERS)) {
    if (adapter.transcriptFormat === format) return adapter.transport
  }
  throw new Error(`Unsupported vendor transcript format: ${format}`)
}
