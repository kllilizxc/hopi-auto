import { z } from 'zod'

export const CODING_AGENT_TRANSPORTS = ['codex', 'claude', 'opencode'] as const
export const CODING_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

export type ProjectCodingAgentTransport = (typeof CODING_AGENT_TRANSPORTS)[number]
export type ProjectCodingReasoningEffort = (typeof CODING_REASONING_EFFORTS)[number]

export interface ProjectCodingDefaultsInput {
  transport?: ProjectCodingAgentTransport
  model?: string
  reasoningEffort?: ProjectCodingReasoningEffort
}

export type ProjectCodingDefaults =
  | {
      transport: 'codex'
      model: string
      reasoningEffort: ProjectCodingReasoningEffort
    }
  | {
      transport: 'claude' | 'opencode'
      model?: string
    }

const codingAgentTransportSchema = z.enum(CODING_AGENT_TRANSPORTS)
export const codingReasoningEffortSchema = z.enum(CODING_REASONING_EFFORTS)

export const projectCodingDefaultsInputSchema = z
  .object({
    transport: codingAgentTransportSchema.optional(),
    model: z.string().optional(),
    reasoningEffort: codingReasoningEffortSchema.optional(),
  })
  .strict()

const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CODEX_REASONING_EFFORT: ProjectCodingReasoningEffort = 'xhigh'

export const DEFAULT_PROJECT_CODING_DEFAULTS: ProjectCodingDefaults = {
  transport: 'codex',
  model: DEFAULT_CODEX_MODEL,
  reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
}

export const projectCodingDefaultsSchema = z.custom<ProjectCodingDefaults>((input) => {
  try {
    normalizeProjectCodingDefaults(input as ProjectCodingDefaultsInput | undefined)
    return true
  } catch {
    return false
  }
})

export function normalizeProjectCodingDefaults(
  input?: ProjectCodingDefaultsInput,
): ProjectCodingDefaults {
  const parsed = projectCodingDefaultsInputSchema.parse(input ?? {})
  const transport = parsed.transport ?? DEFAULT_PROJECT_CODING_DEFAULTS.transport
  const model = parsed.model?.trim()

  if (transport === 'codex') {
    return {
      transport,
      model: model || DEFAULT_CODEX_MODEL,
      reasoningEffort: parsed.reasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT,
    }
  }

  return {
    transport,
    ...(model ? { model } : {}),
  }
}
