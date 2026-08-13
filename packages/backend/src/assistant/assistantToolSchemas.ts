import { z } from 'zod'
import { assistantDecisionPromptSchema } from '../domain/assistantDecisionPrompt'
import { parseAttentionReference } from '../domain/attentionReference'
import { PROJECT_LABEL_MAX_LENGTH, optionalProjectLabelSchema } from '../domain/projectLabel'
import { isNormalizedProjectPath } from '../domain/projectPath'
import { stableIdSchema } from '../domain/stableId'
import {
  PREVIEW_RUNTIME_INPUT_MAX_ENTRIES,
  PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES,
  previewRuntimeInputsSchema,
  previewRuntimeInputsShapeSchema,
} from '../runtime/previewRuntimeInputs'
import { RESPONSIBILITIES } from '../runtime/roleContextStager'
import { RUN_WORKSPACE_MODES } from '../runtime/runDirective'

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

const firstWorkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('planning') }).strict(),
  directEngineeringWorkObjectSchema
    .omit({ dependsOn: true })
    .extend({ kind: z.literal('engineering') })
    .strict(),
])

const assistantToolNames = [
  'hopi_read_state',
  'hopi_read_conversation',
  'hopi_manage_project',
  'hopi_write_preferences',
  'hopi_create_goal',
  'hopi_create_work',
  'hopi_write_design',
  'hopi_control_goal',
  'hopi_control_work',
  'hopi_control_operation',
  'hopi_manage_attention',
  'hopi_control_preview',
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

const engineeringWorkSchema = directEngineeringWorkObjectSchema
  .extend({ kind: z.literal('engineering') })
  .strict()

const attentionReferenceSchema = z
  .string()
  .refine((reference) => parseAttentionReference(reference) !== null, 'Invalid Attention reference')

const goalActionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('complete'), decision: z.string().trim().min(1).max(16_000) })
    .strict(),
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
    .object({ kind: z.literal('complete'), decision: z.string().trim().min(1).max(16_000) })
    .strict(),
  z
    .object({
      kind: z.literal('run'),
      profile: z.enum(RESPONSIBILITIES),
      workspaceMode: z.enum(RUN_WORKSPACE_MODES),
      instructionMarkdown: z.string().trim().min(1).max(64_000),
      refs: z.array(z.string().trim().min(1).max(1_000)).max(128).default([]),
      baseChangeSetId: stableIdSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal('continue'),
      message: z.string().trim().min(1).max(16_000).optional(),
      at: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('set_dependencies'),
      dependsOn: z
        .array(stableIdSchema)
        .refine((values) => new Set(values).size === values.length, 'dependsOn must be unique'),
    })
    .strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
])

const deliveryOperationIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('baseline_integration'), changeSetId: stableIdSchema }).strict(),
  z
    .object({
      kind: z.literal('archive'),
      changeSetId: stableIdSchema,
      outputName: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.zip$/),
    })
    .strict(),
])

const operationActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('propose'),
      operationId: stableIdSchema.optional(),
      workId: stableIdSchema.nullable().default(null),
      idempotencyKey: z.string().trim().min(1).max(256),
      requiredForGoal: z.boolean(),
      intent: deliveryOperationIntentSchema,
    })
    .strict(),
  z.object({ kind: z.literal('execute'), operationId: stableIdSchema }).strict(),
  z.object({ kind: z.literal('cancel'), operationId: stableIdSchema }).strict(),
])

export type AssistantToolName = (typeof assistantToolNames)[number]

export const assistantToolSchemas = {
  hopi_read_state: z
    .object({
      projectId: stableIdSchema.describe('Project ID; omit for the current scope.').optional(),
      goalId: stableIdSchema.describe('Goal ID; omit for the current scope.').optional(),
      includeEvidence: z
        .boolean()
        .describe(
          'Include bounded Evidence and resolved artifacts. operatorUrl is user-addressable; inspectionPath is diagnostic only.',
        )
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
            label: optionalProjectLabelSchema.describe(
              'Optional display label. Project identity remains projectId.',
            ),
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
        z.object({ kind: z.literal('recover'), projectId: stableIdSchema }).strict(),
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
  hopi_control_operation: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      action: operationActionSchema,
    })
    .strict(),
  hopi_manage_attention: z
    .object({
      projectId: stableIdSchema,
      change: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('create'),
            attentionId: stableIdSchema.optional(),
            summary: z.string().trim().min(1).max(600),
            decisionPrompt: assistantDecisionPromptSchema.nullable().optional(),
            body: z.string().trim().min(1).max(16_000),
            refs: z.array(z.string().trim().min(1)).default([]),
          })
          .strict(),
        z
          .object({
            kind: z.literal('update'),
            attentionId: stableIdSchema,
            summary: z.string().trim().min(1).max(600).optional(),
            decisionPrompt: assistantDecisionPromptSchema.nullable().optional(),
            body: z.string().trim().min(1).max(16_000).optional(),
            refs: z.array(z.string().trim().min(1)).optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal('resolve'),
            attentionRef: attentionReferenceSchema,
            resolution: z.string().trim().min(1).max(2_000),
          })
          .strict(),
        z
          .object({
            kind: z.literal('present_attention_to_user'),
            attentionRefs: z.array(attentionReferenceSchema).min(1),
          })
          .strict(),
      ]),
    })
    .strict(),
  hopi_control_preview: z
    .object({
      projectId: stableIdSchema,
      operation: z.enum(['start', 'stop']),
      runtimeInputs: previewRuntimeInputsSchema
        .describe(
          `Optional non-secret Preview inputs. Assistant tool arguments are durable transcript data. At most ${PREVIEW_RUNTIME_INPUT_MAX_ENTRIES} entries and ${PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES} serialized bytes.`,
        )
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
    change: z
      .object({
        kind: z.enum(['create', 'add_repo', 'rebind_repos', 'recover']),
        projectId: z.string().optional(),
        label: z
          .string()
          .min(1)
          .max(PROJECT_LABEL_MAX_LENGTH)
          .describe('Optional display label for create. Project identity remains projectId.')
          .optional(),
        primaryRepoId: z.string().optional(),
        repos: z.array(mcpProjectRepoSchema).optional(),
        repo: mcpProjectRepoSchema.optional(),
      })
      .strict(),
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
      z.object({ kind: z.literal('complete'), decision: z.string().min(1).max(16_000) }).strict(),
      z.object({ kind: z.literal('pause') }).strict(),
      z.object({ kind: z.literal('resume') }).strict(),
      z.object({ kind: z.literal('cancel') }).strict(),
      z
        .object({
          kind: z.literal('reopen'),
          contractChange: z.string().min(1).optional(),
        })
        .strict(),
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
      z.object({ kind: z.literal('complete'), decision: z.string().min(1).max(16_000) }).strict(),
      z
        .object({
          kind: z.literal('run'),
          profile: z.enum(RESPONSIBILITIES),
          workspaceMode: z.enum(RUN_WORKSPACE_MODES),
          instructionMarkdown: z.string().min(1).max(64_000),
          refs: z.array(z.string().min(1).max(1_000)).max(128).optional(),
          baseChangeSetId: stableIdSchema.nullable().optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('continue'),
          message: z.string().min(1).max(16_000).optional(),
          at: z.string().datetime({ offset: true }).optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('set_dependencies'),
          dependsOn: z.array(z.string().min(1)),
        })
        .strict(),
      z.object({ kind: z.literal('cancel') }).strict(),
    ]),
  })
  .strict()
const mcpControlPreviewSchema = z
  .object({
    projectId: stableIdSchema,
    operation: z.enum(['start', 'stop']),
    runtimeInputs: previewRuntimeInputsShapeSchema
      .describe(
        `Optional non-secret Preview inputs. Assistant tool arguments are durable transcript data. At most ${PREVIEW_RUNTIME_INPUT_MAX_ENTRIES} entries and ${PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES} serialized bytes.`,
      )
      .optional(),
  })
  .strict()
export const assistantMcpToolSchemas = {
  ...assistantToolSchemas,
  hopi_manage_project: mcpManageProjectSchema,
  hopi_create_goal: mcpCreateGoalSchema,
  hopi_create_work: mcpCreateWorkSchema,
  hopi_write_design: mcpWriteDesignSchema,
  hopi_control_goal: mcpControlGoalSchema,
  hopi_control_work: mcpControlWorkSchema,
  hopi_control_preview: mcpControlPreviewSchema,
} as const

export function parseAssistantToolArguments<Name extends AssistantToolName>(
  name: Name,
  input: unknown,
): z.infer<(typeof assistantToolSchemas)[Name]> {
  return assistantToolSchemas[name].parse(input) as z.infer<(typeof assistantToolSchemas)[Name]>
}
