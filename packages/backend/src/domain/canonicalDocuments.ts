import { z } from 'zod'
import { assistantDecisionPromptSchema } from './assistantDecisionPrompt'
import {
  type MarkdownDocument,
  parseMarkdownDocument,
  renderMarkdownDocument,
} from './markdownDocument'
import { stableIdSchema } from './stableId'

export const GOAL_LIFECYCLES = ['active', 'paused', 'done', 'cancelled'] as const
export const WORK_KINDS = ['decision', 'engineering'] as const
export const WORK_STATUSES = ['open', 'done', 'cancelled'] as const
export const DECISION_TYPES = ['research', 'prototype', 'grilling', 'task'] as const
export const TASK_MODES = ['afk', 'hitl'] as const

const timestampSchema = z.string().datetime({ offset: true })
const canonicalRefSchema = z.string().min(1)
const uniqueStableIdsSchema = z
  .array(stableIdSchema)
  .refine((values) => new Set(values).size === values.length, 'references must be unique')
export const workContextRefSchema = z
  .object({
    path: canonicalRefSchema,
    purpose: z.string().trim().min(1),
  })
  .strict()
const uniqueWorkContextRefsSchema = z
  .array(workContextRefSchema)
  .refine(
    (values) => new Set(values.map((reference) => reference.path)).size === values.length,
    'context reference paths must be unique',
  )
export const workOwnerMessageSchema = z
  .object({
    recordedAt: timestampSchema,
    sourceEventId: z.string().trim().min(1),
    content: z.string().trim().min(1),
  })
  .strict()
const uniqueWorkOwnerMessagesSchema = z
  .array(workOwnerMessageSchema)
  .refine(
    (values) => new Set(values.map((message) => message.sourceEventId)).size === values.length,
    'owner message source events must be unique',
  )

export const goalAttributesSchema = z
  .object({
    id: stableIdSchema,
    title: z.string().trim().min(1),
    lifecycle: z.enum(GOAL_LIFECYCLES),
    priority: z.number().int(),
    contractRevision: z.number().int().positive(),
  })
  .strict()

const workBaseSchema = z.object({
  id: stableIdSchema,
  title: z.string().trim().min(1),
  status: z.enum(WORK_STATUSES),
  createdAt: timestampSchema,
  notBefore: timestampSchema.nullable(),
  dependsOn: uniqueStableIdsSchema,
  contractRevision: z.number().int().positive(),
  evidenceRefs: uniqueStableIdsSchema,
  contextRefs: uniqueWorkContextRefsSchema,
  ownerMessages: uniqueWorkOwnerMessagesSchema,
})

const decisionWorkAttributesObjectSchema = workBaseSchema
  .extend({
    kind: z.literal('decision'),
    decisionType: z.enum(DECISION_TYPES),
    taskMode: z.enum(TASK_MODES).optional(),
  })
  .strict()

export const decisionWorkAttributesSchema =
  decisionWorkAttributesObjectSchema.superRefine(validateDecisionMode)

export const engineeringWorkAttributesSchema = workBaseSchema
  .extend({
    kind: z.literal('engineering'),
  })
  .strict()

const workAttributesByKindSchema = z
  .discriminatedUnion('kind', [decisionWorkAttributesObjectSchema, engineeringWorkAttributesSchema])
  .superRefine((work, context) => {
    if (work.kind === 'decision') validateDecisionMode(work, context)
  })

export const workAttributesSchema = workAttributesByKindSchema
const historicalWorkAttributesSchema = z.preprocess((raw) => {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    !Object.hasOwn(raw, 'contextRefs') &&
    !Object.hasOwn(raw, 'ownerMessages')
  ) {
    return { ...raw, contextRefs: [], ownerMessages: [] }
  }
  return raw
}, workAttributesSchema)

export const attentionAttributesSchema = z
  .object({
    id: stableIdSchema,
    target: canonicalRefSchema,
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    resolutionInput: canonicalRefSchema.nullable().optional(),
    summary: z.string().trim().min(1).max(600),
    decisionPrompt: assistantDecisionPromptSchema.nullable().optional(),
  })
  .strict()

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
export type DecisionWorkAttributes = z.infer<typeof decisionWorkAttributesSchema>
export type EngineeringWorkAttributes = z.infer<typeof engineeringWorkAttributesSchema>
export type WorkAttributes = z.infer<typeof workAttributesSchema>
export type AttentionAttributes = z.infer<typeof attentionAttributesSchema>
export type InputAttributes = z.infer<typeof inputAttributesSchema>
export type EvidenceAttributes = z.infer<typeof evidenceAttributesSchema>
export type WorkContextRef = z.infer<typeof workContextRefSchema>
export type WorkOwnerMessage = z.infer<typeof workOwnerMessageSchema>

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

export function parseHistoricalWorkDocument(source: string) {
  return parseMarkdownDocument(source, historicalWorkAttributesSchema, 'Historical Work document')
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
  return work.status === 'done' || work.status === 'cancelled'
}

export function isAttentionBlocking(attention: AttentionAttributes) {
  return attention.resolvedAt === null
}

export function isDecisionWork(work: WorkAttributes): work is DecisionWorkAttributes {
  return work.kind === 'decision'
}

export function isEngineeringWork(work: WorkAttributes): work is EngineeringWorkAttributes {
  return work.kind === 'engineering'
}

function validateDecisionMode(
  work: { decisionType: (typeof DECISION_TYPES)[number]; taskMode?: (typeof TASK_MODES)[number] },
  context: z.RefinementCtx,
) {
  if (work.decisionType === 'task' && work.taskMode === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taskMode'],
      message: 'Task Decision requires taskMode',
    })
  }
  if (work.decisionType !== 'task' && work.taskMode !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taskMode'],
      message: 'Only Task Decision may define taskMode',
    })
  }
}
