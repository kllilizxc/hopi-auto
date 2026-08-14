import { z } from 'zod'
import { assistantDecisionPromptSchema } from '../domain/assistantDecisionPrompt'
import { parseAttentionReference } from '../domain/attentionReference'
import { DECISION_TYPES, TASK_MODES } from '../domain/canonicalDocuments'
import { PROJECT_LABEL_MAX_LENGTH, optionalProjectLabelSchema } from '../domain/projectLabel'
import { isNormalizedProjectPath } from '../domain/projectPath'
import { stableIdSchema } from '../domain/stableId'
import {
  PREVIEW_RUNTIME_INPUT_MAX_ENTRIES,
  PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES,
  previewRuntimeInputsSchema,
  previewRuntimeInputsShapeSchema,
} from '../runtime/previewRuntimeInputs'
import { runRequestSchema } from '../runtime/runRequest'

const uniqueIds = z
  .array(stableIdSchema)
  .refine((values) => new Set(values).size === values.length, 'IDs must be unique')

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

const decisionFields = {
  title: z.string().trim().min(1),
  decisionType: z.enum(DECISION_TYPES),
  taskMode: z.enum(TASK_MODES).optional(),
  question: z.string().trim().min(1),
}

const engineeringFields = {
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
}

const firstWorkSchema = z.union([
  z
    .object({ kind: z.literal('decision'), ...decisionFields })
    .strict()
    .superRefine(validateDecisionMode),
  z.object({ kind: z.literal('engineering'), ...engineeringFields }).strict(),
])

const workSchema = z.union([
  z
    .object({ kind: z.literal('decision'), ...decisionFields, dependsOn: uniqueIds.default([]) })
    .strict()
    .superRefine(validateDecisionMode),
  z
    .object({
      kind: z.literal('engineering'),
      ...engineeringFields,
      dependsOn: uniqueIds.default([]),
    })
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

const goalActionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('complete'), decision: z.string().trim().min(1).max(16_000) })
    .strict(),
  z
    .object({
      kind: z.literal('revise_contract'),
      contractMarkdown: z.string().trim().min(1).max(64_000),
    })
    .strict(),
  z.object({ kind: z.literal('pause') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
  z
    .object({
      kind: z.literal('reopen'),
      contractMarkdown: z.string().trim().min(1).max(64_000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('set_priority'), priority: z.number().int() }).strict(),
])

const workActionSchema = z.discriminatedUnion('kind', [
  runRequestSchema.extend({ kind: z.literal('run') }).strict(),
  z
    .object({
      kind: z.literal('complete'),
      decision: z.string().trim().min(1).max(16_000),
      mapMarkdown: z.string().max(64_000).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('set_dependencies'), dependsOn: uniqueIds }).strict(),
  z
    .object({
      kind: z.literal('set_not_before'),
      notBefore: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('cancel') }).strict(),
])

const attentionReferenceSchema = z
  .string()
  .refine((reference) => parseAttentionReference(reference) !== null, 'Invalid Attention reference')

export type AssistantToolName = (typeof assistantToolNames)[number]

export const assistantToolSchemas = {
  hopi_read_state: z
    .object({
      projectId: stableIdSchema.optional(),
      goalId: stableIdSchema.optional(),
      includeEvidence: z.boolean().optional(),
    })
    .strict(),
  hopi_read_conversation: z
    .object({
      projectId: stableIdSchema.optional(),
      query: z.string().trim().min(1).max(200).optional(),
      before: z.string().trim().min(1).max(300).optional(),
      limit: z.number().int().min(1).max(20).default(10),
    })
    .strict(),
  hopi_manage_project: z
    .object({
      change: z.union([
        z
          .object({
            kind: z.literal('create'),
            projectId: stableIdSchema.optional(),
            label: optionalProjectLabelSchema,
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
    .object({ content: z.string().max(16_000), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict(),
  hopi_create_goal: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema.optional(),
      title: z.string().trim().min(1),
      objective: z.string().trim().min(1),
      constraints: z.array(z.string().trim().min(1)).optional(),
      nonGoals: z.array(z.string().trim().min(1)).optional(),
      successCriteria: z.array(z.string().trim().min(1)).optional(),
      priority: z.number().int().optional(),
      mapMarkdown: z.string().max(64_000).optional(),
      firstWork: firstWorkSchema,
      references: goalReferences,
    })
    .strict()
    .superRefine((goal, context) => {
      if (goal.firstWork.kind === 'decision' && !goal.mapMarkdown?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['mapMarkdown'],
          message: 'Decision-first Goal requires a Wayfinder Map',
        })
      }
      if (goal.firstWork.kind === 'engineering' && goal.mapMarkdown !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['mapMarkdown'],
          message: 'Engineering-first Goal must not create a Map',
        })
      }
    }),
  hopi_create_work: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      work: workSchema,
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
              .object({ kind: z.literal('document'), path: z.string().min(1), content: z.string() })
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
    .object({ projectId: stableIdSchema, goalId: stableIdSchema, action: goalActionSchema })
    .strict(),
  hopi_control_work: z
    .object({
      projectId: stableIdSchema,
      goalId: stableIdSchema,
      workId: stableIdSchema,
      action: workActionSchema,
    })
    .strict(),
  hopi_manage_attention: z
    .object({
      projectId: stableIdSchema,
      change: z.union([
        z
          .object({
            kind: z.literal('create'),
            attentionId: stableIdSchema.optional(),
            goalId: stableIdSchema.optional(),
            workId: stableIdSchema.optional(),
            summary: z.string().trim().min(1).max(600),
            decisionPrompt: assistantDecisionPromptSchema.nullable().optional(),
            body: z.string().trim().min(1).max(16_000),
            refs: z.array(z.string().trim().min(1)).default([]),
          })
          .strict()
          .superRefine((value, context) => {
            if (Boolean(value.goalId) !== Boolean(value.workId)) {
              context.addIssue({
                code: 'custom',
                message: 'goalId and workId must be provided together',
              })
            }
          }),
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
      runtimeInputs: previewRuntimeInputsSchema.optional(),
    })
    .strict(),
} as const

export const assistantToolRequestSchema = z
  .object({ token: z.string().min(1), name: z.enum(assistantToolNames), arguments: z.unknown() })
  .strict()

// MCP schemas cannot contain Zod effects. The canonical schemas above parse the request again.
const mcpRepoSchema = z
  .object({
    repoId: z.string().min(1),
    repoPath: z.string().min(1),
    projectPath: z.string().optional(),
  })
  .strict()
const mcpDecisionWorkSchema = z
  .object({
    kind: z.literal('decision'),
    title: z.string().min(1),
    decisionType: z.enum(DECISION_TYPES),
    taskMode: z.enum(TASK_MODES).optional(),
    question: z.string().min(1),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .strict()
const mcpEngineeringWorkSchema = z
  .object({
    kind: z.literal('engineering'),
    title: z.string().min(1),
    objective: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    dependsOn: z.array(z.string().min(1)).optional(),
  })
  .strict()

export const assistantMcpToolSchemas = {
  ...assistantToolSchemas,
  hopi_manage_project: z
    .object({
      change: z
        .object({
          kind: z.enum(['create', 'add_repo', 'rebind_repos', 'recover']),
          projectId: z.string().optional(),
          label: z.string().min(1).max(PROJECT_LABEL_MAX_LENGTH).optional(),
          primaryRepoId: z.string().optional(),
          repos: z.array(mcpRepoSchema).optional(),
          repo: mcpRepoSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  hopi_create_goal: z
    .object({
      projectId: z.string().min(1),
      goalId: z.string().optional(),
      title: z.string().min(1),
      objective: z.string().min(1),
      constraints: z.array(z.string().min(1)).optional(),
      nonGoals: z.array(z.string().min(1)).optional(),
      successCriteria: z.array(z.string().min(1)).optional(),
      priority: z.number().int().optional(),
      mapMarkdown: z.string().optional(),
      firstWork: z.union([
        mcpDecisionWorkSchema.omit({ dependsOn: true }),
        mcpEngineeringWorkSchema.omit({ dependsOn: true }),
      ]),
      references: goalReferences.optional(),
    })
    .strict(),
  hopi_create_work: z
    .object({
      projectId: z.string().min(1),
      goalId: z.string().min(1),
      work: z.union([mcpDecisionWorkSchema, mcpEngineeringWorkSchema]),
      references: goalReferences.optional(),
    })
    .strict(),
  hopi_control_goal: z
    .object({
      projectId: z.string().min(1),
      goalId: z.string().min(1),
      action: z
        .object({
          kind: z.enum([
            'complete',
            'revise_contract',
            'pause',
            'resume',
            'cancel',
            'reopen',
            'set_priority',
          ]),
          decision: z.string().optional(),
          contractMarkdown: z.string().optional(),
          priority: z.number().int().optional(),
        })
        .strict(),
    })
    .strict(),
  hopi_control_work: z
    .object({
      projectId: z.string().min(1),
      goalId: z.string().min(1),
      workId: z.string().min(1),
      action: z
        .object({
          kind: z.enum(['run', 'complete', 'set_dependencies', 'set_not_before', 'cancel']),
          workspaceMode: z.enum(['none', 'read_only', 'isolated_write']).optional(),
          instructionMarkdown: z.string().optional(),
          refs: z.array(z.string()).optional(),
          decision: z.string().optional(),
          mapMarkdown: z.string().optional(),
          dependsOn: z.array(z.string()).optional(),
          notBefore: z.string().nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  hopi_control_preview: z
    .object({
      projectId: z.string().min(1),
      operation: z.enum(['start', 'stop']),
      runtimeInputs: previewRuntimeInputsShapeSchema
        .describe(
          `Optional non-secret Preview inputs; at most ${PREVIEW_RUNTIME_INPUT_MAX_ENTRIES} entries and ${PREVIEW_RUNTIME_INPUT_MAX_SERIALIZED_BYTES} bytes.`,
        )
        .optional(),
    })
    .strict(),
} as const

export function parseAssistantToolArguments<Name extends AssistantToolName>(
  name: Name,
  input: unknown,
): z.infer<(typeof assistantToolSchemas)[Name]> {
  return assistantToolSchemas[name].parse(input) as z.infer<(typeof assistantToolSchemas)[Name]>
}

function validateDecisionMode(
  value: { decisionType: (typeof DECISION_TYPES)[number]; taskMode?: (typeof TASK_MODES)[number] },
  context: z.RefinementCtx,
) {
  if (value.decisionType === 'task' && !value.taskMode) {
    context.addIssue({
      code: 'custom',
      path: ['taskMode'],
      message: 'Task Decision requires taskMode',
    })
  }
  if (value.decisionType !== 'task' && value.taskMode) {
    context.addIssue({
      code: 'custom',
      path: ['taskMode'],
      message: 'Only Task Decision accepts taskMode',
    })
  }
}
