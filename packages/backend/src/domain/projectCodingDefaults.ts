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
export const providerQualifiedModelSchema = z
  .string()
  .trim()
  .regex(
    /^[^/\s]+\/[^/\s]+$/,
    'OpenCode model must use provider/model format (for example, openai/gpt-5)',
  )

export const projectCodingDefaultsInputSchema = z
  .object({
    transport: codingAgentTransportSchema.optional(),
    model: z.string().optional(),
    reasoningEffort: codingReasoningEffortSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.transport !== 'opencode' || !input.model?.trim()) return
    const parsed = providerQualifiedModelSchema.safeParse(input.model)
    if (parsed.success) return
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['model'],
      message: parsed.error.issues[0]?.message ?? 'Invalid OpenCode model',
    })
  })

const DEFAULT_CODEX_MODEL = 'gpt-5.4'
const DEFAULT_CODEX_REASONING_EFFORT: ProjectCodingReasoningEffort = 'xhigh'

export const DEFAULT_PROJECT_CODING_DEFAULTS: ProjectCodingDefaults = {
  transport: 'codex',
  model: DEFAULT_CODEX_MODEL,
  reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
}

export const projectCodingDefaultsSchema = z.discriminatedUnion('transport', [
  z
    .object({
      transport: z.literal('codex'),
      model: z.string().trim().min(1),
      reasoningEffort: codingReasoningEffortSchema,
    })
    .strict(),
  z
    .object({
      transport: z.literal('claude'),
      model: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      transport: z.literal('opencode'),
      model: providerQualifiedModelSchema.optional(),
    })
    .strict(),
])

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
