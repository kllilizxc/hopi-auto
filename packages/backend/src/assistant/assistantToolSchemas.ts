import { z } from 'zod'
import { stableIdSchema } from '../domain/stableId'

const goalReferences = z
  .array(
    z
      .object({
        attachmentRef: z.string().min(1),
        purpose: z.string().trim().min(1),
      })
      .strict(),
  )
  .max(4)
  .default([])

export const mainAssistantToolNames = [
  'hopi_read_state',
  'hopi_write_preferences',
  'hopi_create_goal',
  'hopi_write_design',
  'hopi_request_planning',
  'hopi_control_goal',
  'hopi_control_work',
  'hopi_resolve_attention',
  'hopi_control_preview',
  'hopi_notify_user',
] as const

export const reflectionAssistantToolNames = ['hopi_read_state', 'hopi_handoff_to_main'] as const

export const assistantToolNames = [...mainAssistantToolNames, 'hopi_handoff_to_main'] as const

export type AssistantToolName = (typeof assistantToolNames)[number]
export type MainAssistantToolName = (typeof mainAssistantToolNames)[number]
export type ReflectionAssistantToolName = (typeof reflectionAssistantToolNames)[number]

export const assistantToolSchemas = {
  hopi_read_state: z
    .object({
      projectId: stableIdSchema
        .describe(
          'Exact canonical Project ID, including its P- prefix. Omit to use current page context.',
        )
        .optional(),
      goalId: stableIdSchema
        .describe(
          'Exact canonical Goal ID, including its G- prefix. Omit to use current page context.',
        )
        .optional(),
    })
    .strict(),
  hopi_write_preferences: z
    .object({
      content: z.string().max(16_000),
      expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  hopi_create_goal: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema
        .describe(
          'Explicit canonical Goal ID for compatibility or deterministic automation. Omit during ordinary creation so Coordinator derives a readable ID from title.',
        )
        .optional(),
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      priority: z.number().int().optional(),
      references: goalReferences,
    })
    .strict(),
  hopi_write_design: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      writes: z
        .array(
          z
            .object({
              path: z.string().min(1),
              content: z.string(),
            })
            .strict(),
        )
        .default([]),
      references: goalReferences,
    })
    .strict()
    .superRefine((value, context) => {
      if (value.writes.length === 0 && value.references.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'write_design requires a Markdown write or an adopted image reference',
        })
      }
    }),
  hopi_request_planning: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      materialContractChange: z.boolean().default(false),
      references: goalReferences,
    })
    .strict(),
  hopi_control_goal: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      operation: z.enum(['pause', 'resume', 'cancel', 'reopen', 'set_priority']),
      priority: z.number().int().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.operation === 'set_priority' && value.priority === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'set_priority requires priority' })
      }
    }),
  hopi_control_work: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      workId: stableIdSchema,
      operation: z.enum(['retry', 'cancel', 'set_not_before']),
      notBefore: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  hopi_resolve_attention: z
    .object({
      scope: z.enum(['workspace', 'goal']),
      attentionId: stableIdSchema,
      projectId: stableIdSchema.optional(),
      goalId: stableIdSchema.optional(),
      resolution: z.string().trim().min(1),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.scope === 'goal' && (!value.projectId || !value.goalId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Goal Attention requires projectId and goalId',
        })
      }
    }),
  hopi_control_preview: z
    .object({
      projectId: stableIdSchema,
      operation: z.enum(['start', 'stop', 'request_repair']),
      failure: z.string().optional(),
    })
    .strict(),
  hopi_notify_user: z.object({ message: z.string().trim().min(1).max(12_000) }).strict(),
  hopi_handoff_to_main: z
    .object({
      brief: z.string().trim().min(1).max(12_000),
      context: z
        .object({
          projectId: stableIdSchema,
          goalId: stableIdSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
} as const

export const assistantToolRequestSchema = z
  .object({
    token: z.string().min(1),
    name: z.enum(assistantToolNames),
    arguments: z.unknown(),
  })
  .strict()

export function parseAssistantToolArguments<Name extends AssistantToolName>(
  name: Name,
  input: unknown,
): z.infer<(typeof assistantToolSchemas)[Name]> {
  return assistantToolSchemas[name].parse(input) as z.infer<(typeof assistantToolSchemas)[Name]>
}
