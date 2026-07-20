import { z } from 'zod'
import { parseAttentionReference } from '../domain/attentionReference'
import { projectCodingDefaultsInputSchema } from '../domain/projectCodingDefaults'
import { isNormalizedProjectPath } from '../domain/projectPath'
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

const directEngineeringWorkSchema = z
  .object({
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
    repos: z
      .array(stableIdSchema)
      .min(1)
      .refine((values) => new Set(values).size === values.length, 'repos must be unique'),
    dependsOn: z
      .array(stableIdSchema)
      .refine((values) => new Set(values).size === values.length, 'dependsOn must be unique')
      .default([]),
  })
  .strict()

const firstWorkSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('planning'),
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
    })
    .strict(),
  directEngineeringWorkSchema
    .omit({ dependsOn: true })
    .extend({ kind: z.literal('engineering') })
    .strict(),
])

export const mainAssistantToolNames = [
  'hopi_read_state',
  'hopi_manage_project',
  'hopi_configure_model',
  'hopi_write_preferences',
  'hopi_create_goal',
  'hopi_create_engineering_work',
  'hopi_write_design',
  'hopi_start_planning',
  'hopi_control',
  'hopi_resolve_attention',
  'hopi_control_preview',
  'hopi_notify_user',
  'hopi_request_user',
] as const

const projectRepoSchema = z
  .object({
    repoId: stableIdSchema,
    repoPath: z.string().trim().min(1),
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
  })
  .strict()

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
          'Exact Project ID copied from current Project state. Never use the Home ID from a home: reference. Omit to use current page context.',
        )
        .optional(),
      goalId: stableIdSchema
        .describe(
          'Exact Goal ID copied from current Project state. Omit to use current page context.',
        )
        .optional(),
      includeEvidence: z
        .boolean()
        .describe(
          'Include bounded Evidence bodies and resolved artifacts when preparing a completed Goal update or when the current user question requires an exact deliverable, such as locating a report. Each resolved artifact has an internal inspectionPath and an operatorUrl; only operatorUrl may be linked in a user reply. Defaults to false.',
        )
        .optional(),
    })
    .strict(),
  hopi_manage_project: z.discriminatedUnion('operation', [
    z
      .object({
        operation: z.literal('initialize_repository'),
        path: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Operator-supplied repository path. The final directory may be empty or missing; when missing, its parent must already exist and HOPI creates the final directory automatically.',
          ),
      })
      .strict(),
    z
      .object({
        operation: z.literal('link_project'),
        projectId: stableIdSchema.optional(),
        primaryRepoId: stableIdSchema,
        repos: z.array(projectRepoSchema).min(1),
      })
      .strict(),
    projectRepoSchema
      .extend({ operation: z.literal('link_repo'), projectId: stableIdSchema })
      .strict(),
    z
      .object({
        operation: z.literal('rebind_project'),
        projectId: stableIdSchema,
        repoPath: z.string().trim().min(1),
        projectPath: z.string().refine(isNormalizedProjectPath).optional(),
      })
      .strict(),
    projectRepoSchema
      .extend({ operation: z.literal('rebind_repo'), projectId: stableIdSchema })
      .strict(),
    z
      .object({
        operation: z.literal('rebind_repos'),
        projectId: stableIdSchema,
        repos: z.array(projectRepoSchema).min(1),
      })
      .strict(),
  ]),
  hopi_configure_model: z
    .object({
      role: z.enum(['assistant', 'planner', 'generator', 'reviewer']),
      codingDefaults: projectCodingDefaultsInputSchema.nullable(),
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
      firstWork: firstWorkSchema.describe(
        'Required first Work. Choose planning when decisions or decomposition remain; choose engineering only for one complete, verifiable Work that preserves every explicit Goal constraint.',
      ),
      references: goalReferences,
    })
    .strict(),
  hopi_create_engineering_work: directEngineeringWorkSchema
    .extend({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
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
  hopi_start_planning: z
    .object({
      projectId: stableIdSchema.describe('Exact canonical Project ID.'),
      goalId: stableIdSchema.describe('Exact canonical Goal ID.'),
      mode: z
        .enum(['same_contract', 'new_contract_revision'])
        .describe(
          'Use same_contract when Goal outcome and success remain unchanged; use new_contract_revision only when outcome, scope, constraints, success, or behavior changes.',
        )
        .default('same_contract'),
      resolveAttention: z
        .boolean()
        .describe(
          'Defaults to true: atomically resolve current-turn Attention only when it targets the exact Planning Work being started. Pass false to preserve it.',
        )
        .default(true),
      references: goalReferences,
    })
    .strict(),
  hopi_control: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      workId: stableIdSchema.optional(),
      operation: z.enum(['pause', 'resume', 'cancel', 'reopen', 'set_priority', 'retry', 'defer']),
      priority: z.number().int().optional(),
      notBefore: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.operation === 'set_priority' && value.priority === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'set_priority requires priority' })
      }
      const workOperation = ['retry', 'defer'].includes(value.operation)
      if (workOperation && !value.workId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value.operation} requires workId`,
        })
      }
      if (value.operation === 'defer' && value.notBefore === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'defer requires notBefore' })
      }
      if (value.workId && !['retry', 'defer', 'cancel'].includes(value.operation)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value.operation} is a Goal operation`,
        })
      }
      if (!value.workId && ['retry', 'defer'].includes(value.operation)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value.operation} is a Work operation`,
        })
      }
    }),
  hopi_resolve_attention: z
    .object({
      attentionRef: z
        .string()
        .refine((value) => parseAttentionReference(value) !== null, {
          message: 'attentionRef must be one complete canonical Attention reference',
        })
        .describe(
          'Copy one complete canonical Attention reference exactly from Inbox Reply context or hopi_read_state. This is not an Attention ID.',
        ),
      resolution: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  hopi_control_preview: z
    .object({
      projectId: stableIdSchema,
      operation: z.enum(['start', 'stop']),
    })
    .strict(),
  hopi_notify_user: z.object({ message: z.string().trim().min(1).max(12_000) }).strict(),
  hopi_request_user: z.object({ message: z.string().trim().min(1).max(12_000) }).strict(),
  hopi_handoff_to_main: z
    .object({
      brief: z.string().trim().min(1).max(12_000),
      context: z
        .object({
          projectId: stableIdSchema.describe(
            'Exact Project ID from current Project state; never a Home ID.',
          ),
          goalId: stableIdSchema.describe('Exact Goal ID from current Project state.'),
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

// MCP needs a serializable object schema without Zod effects. Keep cross-field
// validation in the canonical schemas above, which are parsed again at the
// mutation boundary.
const mcpObject = z.object({}).passthrough()
const mcpWriteDesignSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    writes: z.array(z.object({ path: z.string().min(1), content: z.string() }).strict()).optional(),
    references: goalReferences.optional(),
  })
  .strict()
const mcpControlSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema.optional(),
    operation: z.enum(['pause', 'resume', 'cancel', 'reopen', 'set_priority', 'retry', 'defer']),
    priority: z.number().int().optional(),
    notBefore: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
const mcpResolveAttentionSchema = z
  .object({ attentionRef: z.string().min(1), resolution: z.string().trim().min(1).max(2_000) })
  .strict()
export const assistantMcpToolSchemas = {
  ...assistantToolSchemas,
  hopi_manage_project: mcpObject,
  hopi_write_design: mcpWriteDesignSchema,
  hopi_control: mcpControlSchema,
  hopi_resolve_attention: mcpResolveAttentionSchema,
} as const

export function parseAssistantToolArguments<Name extends AssistantToolName>(
  name: Name,
  input: unknown,
): z.infer<(typeof assistantToolSchemas)[Name]> {
  return assistantToolSchemas[name].parse(input) as z.infer<(typeof assistantToolSchemas)[Name]>
}
