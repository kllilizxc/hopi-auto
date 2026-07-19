import { z } from 'zod'
import { inboxEventReferenceSchema } from './inboxEventReference'
import {
  type MarkdownDocument,
  parseMarkdownDocument,
  renderMarkdownDocument,
} from './markdownDocument'
import { stableIdSchema } from './stableId'

export const GOAL_LIFECYCLES = ['active', 'paused', 'done', 'cancelled'] as const
export const WORK_KINDS = ['planning', 'engineering'] as const
export const PLANNING_STAGES = ['plan', 'done', 'cancelled'] as const
export const ENGINEERING_STAGES = ['generate', 'review', 'done', 'cancelled'] as const

const timestampSchema = z.string().datetime({ offset: true })
const canonicalRefSchema = z.string().min(1)
const uniqueStableIdsSchema = z
  .array(stableIdSchema)
  .refine((values) => new Set(values).size === values.length, 'references must be unique')
const nonEmptyUniqueStableIdsSchema = uniqueStableIdsSchema.refine(
  (values) => values.length > 0,
  'references must not be empty',
)

export const goalAttributesSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().trim().min(1),
    lifecycle: z.enum(GOAL_LIFECYCLES),
    priority: z.number().int(),
    contractRevision: z.number().int().positive(),
    completionAttentionId: stableIdSchema.nullable(),
  })
  .strict()
  .superRefine((goal, context) => {
    if ((goal.lifecycle === 'done') !== (goal.completionAttentionId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completionAttentionId'],
        message: 'completionAttentionId must be present exactly while lifecycle is done',
      })
    }
  })

const workBaseSchema = z.object({
  id: stableIdSchema,
  title: z.string().trim().min(1),
  notBefore: timestampSchema.nullable(),
  dependsOn: uniqueStableIdsSchema,
  contractRevision: z.number().int().positive(),
  evidenceRefs: uniqueStableIdsSchema,
  attempts: z.number().int().nonnegative(),
})

export const planningWorkAttributesSchema = workBaseSchema
  .extend({
    kind: z.literal('planning'),
    stage: z.enum(PLANNING_STAGES),
  })
  .strict()
  .superRefine((work, context) => {
    if (work.dependsOn.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependsOn'],
        message: 'Planning Work never participates in dependsOn',
      })
    }
  })

export const engineeringWorkAttributesSchema = workBaseSchema
  .extend({
    kind: z.literal('engineering'),
    stage: z.enum(ENGINEERING_STAGES),
    repos: nonEmptyUniqueStableIdsSchema.optional(),
  })
  .strict()

export const workAttributesSchema = z.union([
  planningWorkAttributesSchema,
  engineeringWorkAttributesSchema,
])

export const attentionAttributesSchema = z
  .object({
    id: stableIdSchema,
    target: canonicalRefSchema.nullable(),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    notifiedAt: timestampSchema.nullable(),
    operatorRequest: inboxEventReferenceSchema.nullable().optional(),
    resolutionInput: canonicalRefSchema.nullable().optional(),
  })
  .strict()
  .superRefine((attention, context) => {
    if (attention.target === null && attention.operatorRequest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operatorRequest'],
        message: 'Completion Attention cannot wait for operator input',
      })
    }
    if (attention.resolvedAt !== null && attention.operatorRequest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['operatorRequest'],
        message: 'Resolved Attention cannot wait for operator input',
      })
    }
  })

export const inputAttributesSchema = z
  .object({
    sourceHomeId: stableIdSchema,
    sourceEventId: stableIdSchema,
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    attachments: z.array(z.string().min(1)),
  })
  .strict()

export const evidenceAttributesSchema = z
  .object({
    id: stableIdSchema,
    createdAt: timestampSchema,
    producerRun: canonicalRefSchema.nullable(),
    coordinatorCheck: z.string().trim().min(1).nullable(),
    owner: canonicalRefSchema,
    artifacts: z.array(z.string().min(1)),
  })
  .strict()
  .superRefine((evidence, context) => {
    if ((evidence.producerRun === null) === (evidence.coordinatorCheck === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evidence requires exactly one producerRun or coordinatorCheck',
      })
    }
  })

export type GoalAttributes = z.infer<typeof goalAttributesSchema>
export type PlanningWorkAttributes = z.infer<typeof planningWorkAttributesSchema>
export type EngineeringWorkAttributes = z.infer<typeof engineeringWorkAttributesSchema>
export type WorkAttributes = z.infer<typeof workAttributesSchema>
export type AttentionAttributes = z.infer<typeof attentionAttributesSchema>
export type InputAttributes = z.infer<typeof inputAttributesSchema>
export type EvidenceAttributes = z.infer<typeof evidenceAttributesSchema>

export type GoalDocument = MarkdownDocument<GoalAttributes>
export type WorkDocument = MarkdownDocument<WorkAttributes>
export type AttentionDocument = MarkdownDocument<AttentionAttributes>
export type InputDocument = MarkdownDocument<InputAttributes>
export type EvidenceDocument = MarkdownDocument<EvidenceAttributes>

export function parseGoalDocument(source: string) {
  return parseMarkdownDocument(source, goalAttributesSchema, 'Goal document')
}

export function parseWorkDocument(source: string) {
  return parseMarkdownDocument(source, workAttributesSchema, 'Work document')
}

export function parseAttentionDocument(source: string) {
  return parseMarkdownDocument(source, attentionAttributesSchema, 'Attention document')
}

export function parseInputDocument(source: string) {
  return parseMarkdownDocument(source, inputAttributesSchema, 'Input document')
}

export function parseEvidenceDocument(source: string) {
  return parseMarkdownDocument(source, evidenceAttributesSchema, 'Evidence document')
}

export const renderGoalDocument = renderMarkdownDocument<GoalAttributes>
export const renderWorkDocument = renderMarkdownDocument<WorkAttributes>
export const renderAttentionDocument = renderMarkdownDocument<AttentionAttributes>
export const renderInputDocument = renderMarkdownDocument<InputAttributes>
export const renderEvidenceDocument = renderMarkdownDocument<EvidenceAttributes>

export function isWorkTerminal(work: WorkAttributes) {
  return work.stage === 'done' || work.stage === 'cancelled'
}

export function isPlanningWork(work: WorkAttributes): work is PlanningWorkAttributes {
  return work.kind === 'planning'
}

export function isEngineeringWork(work: WorkAttributes): work is EngineeringWorkAttributes {
  return work.kind === 'engineering'
}

export function engineeringWorkRepoIds(
  work: EngineeringWorkAttributes,
  primaryRepoId: string,
): readonly string[] {
  return work.repos ?? [primaryRepoId]
}
