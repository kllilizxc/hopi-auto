import { z } from 'zod'
import { parseAttentionReference } from '../domain/attentionReference'
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
  .default([])

const canonicalAttentionReferenceSchema = z
  .string()
  .refine((value) => parseAttentionReference(value) !== null, {
    message: 'value must be one complete canonical Attention reference',
  })

const directEngineeringWorkObjectSchema = z
  .object({
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1),
    acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
    dependsOn: z
      .array(stableIdSchema)
      .refine((values) => new Set(values).size === values.length, 'dependsOn must be unique')
      .default([]),
  })
  .strict()

const firstWorkSchema = z.preprocess(
  stripLegacyWorkRepos,
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('planning') }).strict(),
    directEngineeringWorkObjectSchema
      .omit({ dependsOn: true })
      .extend({ kind: z.literal('engineering') })
      .strict(),
  ]),
)

export const publicAssistantToolNames = [
  'hopi_read_state',
  'hopi_read_conversation',
  'hopi_manage_project',
  'hopi_write_preferences',
  'hopi_create_goal',
  'hopi_create_work',
  'hopi_write_design',
  'hopi_control_goal',
  'hopi_control_work',
  'hopi_resolve_attention',
  'hopi_control_preview',
] as const

export const internalAssistantToolNames = [
  'hopi_read_state',
  'hopi_read_conversation',
  'hopi_create_goal',
  'hopi_create_work',
  'hopi_write_design',
  'hopi_control_goal',
  'hopi_control_work',
  'hopi_resolve_attention',
  'hopi_control_preview',
  'hopi_request_user',
] as const

export const mainAssistantToolNames = [
  'hopi_read_state',
  'hopi_read_conversation',
  'hopi_manage_project',
  'hopi_write_preferences',
  'hopi_create_goal',
  'hopi_create_work',
  'hopi_write_design',
  'hopi_control_goal',
  'hopi_control_work',
  'hopi_resolve_attention',
  'hopi_control_preview',
  'hopi_request_user',
] as const

const projectRepoSchema = z
  .object({
    repoId: stableIdSchema,
    repoPath: z.string().trim().min(1),
    projectPath: z.string().refine(isNormalizedProjectPath).optional(),
  })
  .strict()

const planningWorkSchema = z.discriminatedUnion('mode', [
  z.object({ kind: z.literal('planning'), mode: z.literal('same_contract') }).strict(),
  z
    .object({
      kind: z.literal('planning'),
      mode: z.literal('new_contract_revision'),
      contractChange: z.string().trim().min(1),
    })
    .strict(),
])

const engineeringWorkSchema = z.preprocess(
  stripLegacyWorkRepos,
  directEngineeringWorkObjectSchema.extend({ kind: z.literal('engineering') }).strict(),
)

function stripLegacyWorkRepos(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const work = value as Record<string, unknown>
  if (work.kind !== 'engineering' || !Object.hasOwn(work, 'repos')) return value
  const { repos: _legacyRepos, ...current } = work
  return current
}

const goalActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pause') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
  z
    .object({
      kind: z.literal('reopen'),
      contractChange: z.string().trim().min(1).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('set_priority'), priority: z.number().int() }).strict(),
])

const workActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('retry'),
      notBefore: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('defer'),
      notBefore: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
])

export const reflectionAssistantToolNames = ['hopi_read_state', 'hopi_handoff_to_main'] as const

export const assistantToolNames = [...mainAssistantToolNames, 'hopi_handoff_to_main'] as const

export type AssistantToolName = (typeof assistantToolNames)[number]
export type MainAssistantToolName = (typeof mainAssistantToolNames)[number]
export type ReflectionAssistantToolName = (typeof reflectionAssistantToolNames)[number]

export const assistantToolSchemas = {
  hopi_read_state: z
    .object({
      projectId: stableIdSchema.describe('Project ID; omit for the current scope.').optional(),
      goalId: stableIdSchema.describe('Goal ID; omit for the current scope.').optional(),
      includeEvidence: z
        .boolean()
        .describe('Include bounded Evidence bodies and resolved artifact locations.')
        .optional(),
    })
    .strict(),
  hopi_read_conversation: z
    .object({
      projectId: stableIdSchema
        .describe('Exact Project ID to read. Omit to read the Home conversation.')
        .optional(),
      query: z.string().trim().min(1).max(200).optional(),
      before: z.string().trim().min(1).max(300).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  hopi_manage_project: z
    .object({
      change: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('create'),
            projectId: stableIdSchema.optional(),
            primaryRepoId: stableIdSchema,
            repos: z.array(projectRepoSchema).min(1),
          })
          .strict(),
        z
          .object({
            kind: z.literal('add_repo'),
            projectId: stableIdSchema,
            repo: projectRepoSchema,
          })
          .strict(),
        z
          .object({
            kind: z.literal('rebind_repos'),
            projectId: stableIdSchema,
            repos: z.array(projectRepoSchema).min(1),
          })
          .strict(),
      ]),
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
        .describe('Optional explicit Goal ID; otherwise Coordinator derives one from title.')
        .optional(),
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      priority: z.number().int().optional(),
      firstWork: firstWorkSchema.describe(
        'The first Planning or Engineering Work published with the Goal.',
      ),
      references: goalReferences,
    })
    .strict(),
  hopi_create_work: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      work: z.union([planningWorkSchema, engineeringWorkSchema]),
      references: goalReferences,
    })
    .strict(),
  hopi_write_design: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      changes: z
        .array(
          z.discriminatedUnion('kind', [
            z
              .object({
                kind: z.literal('document'),
                path: z.string().min(1),
                content: z.string(),
              })
              .strict(),
            z
              .object({
                kind: z.literal('attachment'),
                attachmentRef: z.string().min(1),
                purpose: z.string().trim().min(1),
              })
              .strict(),
          ]),
        )
        .min(1),
    })
    .strict(),
  hopi_control_goal: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      action: goalActionSchema,
    })
    .strict(),
  hopi_control_work: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      workId: stableIdSchema,
      action: workActionSchema,
    })
    .strict(),
  hopi_resolve_attention: z
    .object({
      attentionRef: z
        .string()
        .refine((value) => parseAttentionReference(value) !== null, {
          message: 'attentionRef must be one complete canonical Attention reference',
        })
        .describe('Canonical Attention reference returned by current state.'),
      resolution: z.string().trim().min(1).max(2_000),
    })
    .strict(),
  hopi_control_preview: z
    .object({
      projectId: stableIdSchema,
      operation: z.enum(['start', 'stop']),
    })
    .strict(),
  hopi_request_user: z
    .object({
      attentionRefs: z
        .array(canonicalAttentionReferenceSchema)
        .min(1)
        .refine((values) => new Set(values).size === values.length, 'attentionRefs must be unique')
        .describe('Canonical Attention references returned by current state.'),
    })
    .strict(),
  hopi_handoff_to_main: z
    .object({
      brief: z.string().trim().min(1).max(12_000),
      context: z
        .object({
          projectId: stableIdSchema.describe('Project ID.').optional(),
          goalId: stableIdSchema.describe('Goal ID.').optional(),
          attentionRefs: z
            .array(canonicalAttentionReferenceSchema)
            .min(1)
            .refine(
              (values) => new Set(values).size === values.length,
              'attentionRefs must be unique',
            )
            .describe('Canonical Attention references from this context.')
            .optional(),
        })
        .strict()
        .superRefine((value, refinement) => {
          if (Boolean(value.projectId) !== Boolean(value.goalId)) {
            refinement.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'projectId and goalId must appear together',
            })
          }
          if (!value.projectId && !value.attentionRefs?.length) {
            refinement.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'context requires a Goal location or Attention references',
            })
          }
          const parsedReferences = (value.attentionRefs ?? [])
            .map(parseAttentionReference)
            .filter((reference) => reference !== null)
          const goalReferences = parsedReferences.filter((reference) => reference.scope === 'goal')
          const workspaceReferences = parsedReferences.filter(
            (reference) => reference.scope === 'workspace',
          )
          if (
            goalReferences.some(
              (reference) =>
                reference.projectId !== value.projectId || reference.goalId !== value.goalId,
            )
          ) {
            refinement.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Goal Attention references require their exact projectId and goalId',
            })
          }
          if (workspaceReferences.length > 0 && (value.projectId || goalReferences.length > 0)) {
            refinement.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Workspace Attention references require workspace context',
            })
          }
        })
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
const mcpProjectRepoSchema = z
  .object({
    repoId: z.string().min(1),
    repoPath: z.string().min(1),
    projectPath: z.string().optional(),
  })
  .strict()
const mcpManageProjectSchema = z
  .object({
    change: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('create'),
          projectId: z.string().optional(),
          primaryRepoId: z.string().min(1),
          repos: z.array(mcpProjectRepoSchema).min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal('add_repo'),
          projectId: z.string().min(1),
          repo: mcpProjectRepoSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('rebind_repos'),
          projectId: z.string().min(1),
          repos: z.array(mcpProjectRepoSchema).min(1),
        })
        .strict(),
    ]),
  })
  .strict()
const mcpCreateGoalSchema = z
  .object({
    projectId: z.string().min(1),
    goalId: z.string().optional(),
    title: z.string().min(1),
    objective: z.string().min(1),
    priority: z.number().int().optional(),
    firstWork: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('planning') }).strict(),
      z
        .object({
          kind: z.literal('engineering'),
          title: z.string().min(1),
          objective: z.string().min(1),
          acceptanceCriteria: z.array(z.string().min(1)).min(1),
        })
        .strict(),
    ]),
    references: goalReferences.optional(),
  })
  .strict()
const mcpCreateWorkSchema = z
  .object({
    projectId: z.string().min(1),
    goalId: z.string().min(1),
    work: z.union([
      z.discriminatedUnion('mode', [
        z.object({ kind: z.literal('planning'), mode: z.literal('same_contract') }).strict(),
        z
          .object({
            kind: z.literal('planning'),
            mode: z.literal('new_contract_revision'),
            contractChange: z.string().min(1),
          })
          .strict(),
      ]),
      z
        .object({
          kind: z.literal('engineering'),
          title: z.string().min(1),
          objective: z.string().min(1),
          acceptanceCriteria: z.array(z.string().min(1)).min(1),
          dependsOn: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    ]),
    references: goalReferences.optional(),
  })
  .strict()
const mcpWriteDesignSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    changes: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({ kind: z.literal('document'), path: z.string().min(1), content: z.string() })
            .strict(),
          z
            .object({
              kind: z.literal('attachment'),
              attachmentRef: z.string().min(1),
              purpose: z.string().min(1),
            })
            .strict(),
        ]),
      )
      .min(1),
  })
  .strict()
const mcpControlGoalSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    action: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pause') }).strict(),
      z.object({ kind: z.literal('resume') }).strict(),
      z.object({ kind: z.literal('cancel') }).strict(),
      z.object({ kind: z.literal('reopen') }).strict(),
      z.object({ kind: z.literal('set_priority'), priority: z.number().int() }).strict(),
    ]),
  })
  .strict()
const mcpControlWorkSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema,
    action: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('retry'),
          notBefore: z.string().datetime({ offset: true }).nullable().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('defer'),
          notBefore: z.string().datetime({ offset: true }).nullable(),
        })
        .strict(),
      z.object({ kind: z.literal('cancel') }).strict(),
    ]),
  })
  .strict()
const mcpResolveAttentionSchema = z
  .object({ attentionRef: z.string().min(1), resolution: z.string().trim().min(1).max(2_000) })
  .strict()
export const assistantMcpToolSchemas = {
  ...assistantToolSchemas,
  hopi_manage_project: mcpManageProjectSchema,
  hopi_create_goal: mcpCreateGoalSchema,
  hopi_create_work: mcpCreateWorkSchema,
  hopi_write_design: mcpWriteDesignSchema,
  hopi_control_goal: mcpControlGoalSchema,
  hopi_control_work: mcpControlWorkSchema,
  hopi_resolve_attention: mcpResolveAttentionSchema,
} as const

export function parseAssistantToolArguments<Name extends AssistantToolName>(
  name: Name,
  input: unknown,
): z.infer<(typeof assistantToolSchemas)[Name]> {
  return assistantToolSchemas[name].parse(input) as z.infer<(typeof assistantToolSchemas)[Name]>
}
