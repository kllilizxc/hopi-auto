import { z } from 'zod'

const stableId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
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
      projectId: stableId
        .describe(
          'Exact canonical Project ID, including its P- prefix. Omit to use current page context.',
        )
        .optional(),
      goalId: stableId
        .describe(
          'Exact canonical Goal ID, including its G- prefix. Omit to use current page context.',
        )
        .optional(),
    })
    .strict(),
  hopi_create_goal: z
    .object({
      projectId: stableId,
      goalId: stableId.optional(),
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      priority: z.number().int().optional(),
      references: goalReferences,
    })
    .strict(),
  hopi_write_design: z
    .object({
      projectId: stableId,
      goalId: stableId,
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
      projectId: stableId,
      goalId: stableId,
      materialContractChange: z.boolean().default(false),
      references: goalReferences,
    })
    .strict(),
  hopi_control_goal: z
    .object({
      projectId: stableId,
      goalId: stableId,
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
      projectId: stableId,
      goalId: stableId,
      workId: stableId,
      operation: z.enum(['retry', 'cancel', 'set_not_before']),
      notBefore: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  hopi_resolve_attention: z
    .object({
      scope: z.enum(['workspace', 'goal']),
      attentionId: stableId,
      projectId: stableId.optional(),
      goalId: stableId.optional(),
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
      projectId: stableId,
      operation: z.enum(['start', 'stop', 'request_repair']),
      failure: z.string().optional(),
    })
    .strict(),
  hopi_notify_user: z.object({}).strict(),
  hopi_handoff_to_main: z
    .object({
      brief: z.string().trim().min(1).max(12_000),
      context: z
        .object({
          projectId: stableId,
          goalId: stableId,
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
