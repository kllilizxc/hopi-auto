import { z } from 'zod'
import { assistantDecisionPromptSchema } from './assistantDecisionPrompt'
import { parseWorkAttentionTarget } from './attentionTarget'
import { inboxEventReferenceSchema } from './inboxEventReference'
import {
  type MarkdownDocument,
  parseMarkdownDocument,
  renderMarkdownDocument,
} from './markdownDocument'
import { STABLE_ID_SOURCE, stableIdSchema } from './stableId'

export const INBOX_STATUSES = ['pending', 'handled'] as const
export const INBOX_SOURCES = ['user', 'system'] as const
export const INBOX_VISIBILITIES = ['public', 'internal'] as const

const attentionReferenceSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:project:${STABLE_ID_SOURCE}/goal:${STABLE_ID_SOURCE}/attention:${STABLE_ID_SOURCE}|home:${STABLE_ID_SOURCE}/attention:${STABLE_ID_SOURCE})$`,
      'u',
    ),
  )
const timestampSchema = z.string().datetime({ offset: true })

export const inboxAttentionRequestSchema = z
  .object({
    attentionRefs: z.array(attentionReferenceSchema).min(1),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.attentionRefs).size !== request.attentionRefs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attentionRefs'],
        message: 'Attention request references must be unique',
      })
    }
  })

export const inboxContextSchema = z
  .object({
    projectId: stableIdSchema.optional(),
    goalId: stableIdSchema.optional(),
    attentionRefs: z.array(attentionReferenceSchema).optional(),
    workRefs: z
      .array(
        z.string().refine((value) => parseWorkAttentionTarget(value) !== null, {
          message: 'Invalid canonical Work reference',
        }),
      )
      .optional(),
    replyTo: inboxEventReferenceSchema.optional(),
    observedDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (context.goalId && !context.projectId) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox context goalId requires projectId',
      })
    }
    if (!context.projectId && !context.attentionRefs?.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox context requires a Project location or canonical Attention reference',
      })
    }
    if (context.replyTo && !context.attentionRefs?.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox replyTo requires exact Attention references',
      })
    }
    if (context.workRefs?.length && !context.projectId) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox Work references require a Project location',
      })
    }
    if (
      context.projectId &&
      context.workRefs?.some(
        (reference) => parseWorkAttentionTarget(reference)?.projectId !== context.projectId,
      )
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox Work references must belong to the located Project',
      })
    }
  })

export const inboxEventAttributesSchema = z
  .object({
    id: stableIdSchema,
    receivedAt: timestampSchema,
    status: z.enum(INBOX_STATUSES),
    source: z.enum(INBOX_SOURCES),
    visibility: z.enum(INBOX_VISIBILITIES),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    attachments: z.array(z.string().min(1)),
    context: inboxContextSchema.nullable().optional(),
    attentionRequest: inboxAttentionRequestSchema.nullable().optional(),
    handledAt: timestampSchema.nullable(),
    reply: z.string().min(1).nullable(),
    disposition: z.string().min(1).nullable(),
    webhookDeliveredAt: timestampSchema.nullable().optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.source === 'user' && event.visibility !== 'public') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'User Inbox events must remain public',
      })
    }
    const handlingFacts = [event.handledAt, event.disposition]
    const handledFacts = handlingFacts.every((value) => value !== null)
    if ((event.status === 'handled') !== handledFacts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'handledAt and disposition must be present exactly when status is handled',
      })
    }
    if (event.status === 'handled' && event.visibility === 'public' && !event.reply?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'handled public Inbox event requires a reply',
      })
    }
    if (
      event.status === 'pending' &&
      [...handlingFacts, event.reply].some((value) => value !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pending Inbox event cannot contain partial handling facts',
      })
    }
    if (event.webhookDeliveredAt && (event.status !== 'handled' || event.visibility !== 'public')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'webhook delivery requires a handled public Inbox event',
      })
    }
  })

export const workspaceAttentionAttributesSchema = z
  .object({
    id: stableIdSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    refs: z.array(z.string().trim().min(1)),
    summary: z.string().trim().min(1).max(600),
    decisionPrompt: assistantDecisionPromptSchema.nullable().optional(),
  })
  .strict()

export type InboxContext = z.infer<typeof inboxContextSchema>
export type InboxAttentionRequest = z.infer<typeof inboxAttentionRequestSchema>
export type InboxEventAttributes = z.infer<typeof inboxEventAttributesSchema>
export type WorkspaceAttentionAttributes = z.infer<typeof workspaceAttentionAttributesSchema>
export type InboxEventDocument = MarkdownDocument<InboxEventAttributes>
export type WorkspaceAttentionDocument = MarkdownDocument<WorkspaceAttentionAttributes>

export function isInternalInboxSource(source: InboxEventAttributes['source']) {
  return source === 'system'
}

export function parseInboxEventDocument(source: string) {
  return parseMarkdownDocument(source, inboxEventAttributesSchema, 'Inbox event')
}

export function parseWorkspaceAttentionDocument(source: string) {
  return parseMarkdownDocument(source, workspaceAttentionAttributesSchema, 'Workspace Attention')
}

export const renderInboxEventDocument = renderMarkdownDocument<InboxEventAttributes>
export const renderWorkspaceAttentionDocument = renderMarkdownDocument<WorkspaceAttentionAttributes>

export function workspaceAttentionProjectId(
  attention: Pick<WorkspaceAttentionDocument, 'attributes'>,
) {
  for (const reference of attention.attributes.refs) {
    if (!reference.startsWith('project:')) continue
    const projectId = reference.slice('project:'.length)
    if (projectId && !projectId.includes('/')) return projectId
  }
  return null
}

export async function inboxSourceDigest(content: string, attachments: readonly string[]) {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const payload = new TextEncoder().encode(
    `${normalized}\n\u0000${JSON.stringify([...attachments])}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}
