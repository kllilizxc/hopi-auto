import type { AssistantTransport } from './vendorAssistantOutput'

export const EXECUTION_ENVELOPE_MARKER = '__HOPI_EXECUTION_ENVELOPE__'
const EXECUTION_ENVELOPE_BEGIN = '<!-- HOPI_EXECUTION_ENVELOPE_BEGIN -->'
const EXECUTION_ENVELOPE_END = '<!-- HOPI_EXECUTION_ENVELOPE_END -->'

export interface ExecutionEnvelope {
  transport: AssistantTransport | 'process'
  mode: 'unrestricted' | 'bounded' | 'read-only' | 'provider-managed'
  runtimeWorkspace: string
  runtimeWorkspaceRole: 'provider scratch space' | 'responsibility workspace'
  runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable'
  readableRoots: string[] | null
  writableRoots: string[] | null
  networkAccess: boolean | null
  subprocessAccess: boolean | null
  privilegeEscalation: boolean
  hostEnvironmentMutation: boolean | null
  linkedSourceAccess: 'none' | 'read-only' | 'read-write' | 'provider-managed'
  canonicalMutation: 'hopi-tools-only' | 'coordinator-publication-only'
  hopiToolMode?: 'main' | 'internal' | 'reflection'
  runScratch?: string
  cacheDirectory?: string
}

export function injectExecutionEnvelope(prompt: string, envelope: ExecutionEnvelope) {
  const rendered = [
    EXECUTION_ENVELOPE_BEGIN,
    JSON.stringify(envelope, null, 2),
    EXECUTION_ENVELOPE_END,
  ].join('\n')
  if (prompt.includes(EXECUTION_ENVELOPE_MARKER)) {
    return prompt.replace(EXECUTION_ENVELOPE_MARKER, rendered)
  }
  const start = prompt.indexOf(EXECUTION_ENVELOPE_BEGIN)
  const end = prompt.indexOf(EXECUTION_ENVELOPE_END, start)
  if (start < 0 || end < 0) return prompt
  return `${prompt.slice(0, start)}${rendered}${prompt.slice(end + EXECUTION_ENVELOPE_END.length)}`
}

export function unreportedExecutionEnvelope(input: {
  transport?: ExecutionEnvelope['transport']
  runtimeWorkspace: string
  runtimeWorkspaceRole: ExecutionEnvelope['runtimeWorkspaceRole']
  canonicalMutation: ExecutionEnvelope['canonicalMutation']
  toolMode?: ExecutionEnvelope['hopiToolMode']
}): ExecutionEnvelope {
  return {
    transport: input.transport ?? 'process',
    mode: 'provider-managed',
    runtimeWorkspace: input.runtimeWorkspace,
    runtimeWorkspaceRole: input.runtimeWorkspaceRole,
    runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable',
    readableRoots: null,
    writableRoots: null,
    networkAccess: null,
    subprocessAccess: null,
    privilegeEscalation: false,
    hostEnvironmentMutation: null,
    linkedSourceAccess: 'provider-managed',
    canonicalMutation: input.canonicalMutation,
    ...(input.toolMode ? { hopiToolMode: input.toolMode } : {}),
  }
}
