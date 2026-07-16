import { z } from 'zod'
import { parseAttentionReference } from './attentionReference'
import {
  type MarkdownDocument,
  parseMarkdownDocument,
  renderMarkdownDocument,
} from './markdownDocument'
import { STABLE_ID_SOURCE, stableIdSchema } from './stableId'

export const INBOX_STATUSES = ['pending', 'handled'] as const
export const INBOX_SOURCES = ['user', 'reflection'] as const
export const INBOX_VISIBILITIES = ['public', 'internal'] as const
export const ROUTE_MODES = ['existing', 'create'] as const

const attentionReferenceSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:project:${STABLE_ID_SOURCE}/goal:${STABLE_ID_SOURCE}/attention:${STABLE_ID_SOURCE}|home:${STABLE_ID_SOURCE}/attention:${STABLE_ID_SOURCE})$`,
      'u',
    ),
  )
const timestampSchema = z.string().datetime({ offset: true })

export const inboxRouteClaimSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    mode: z.enum(ROUTE_MODES),
  })
  .strict()

export const inboxContextSchema = z
  .object({
    projectId: stableIdSchema.optional(),
    goalId: stableIdSchema.optional(),
    attentionId: stableIdSchema.optional(),
    attentionRefs: z.array(z.union([stableIdSchema, attentionReferenceSchema])).optional(),
    observedDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (Boolean(context.projectId) !== Boolean(context.goalId)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox context projectId and goalId must appear together',
      })
    }
    if (!context.projectId && !context.attentionRefs?.length) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Inbox context requires a Goal location or canonical Attention reference',
      })
    }
    if (
      !context.projectId &&
      context.attentionRefs?.some((reference) => !parseAttentionReference(reference))
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Workspace Inbox context requires canonical Attention references',
      })
    }
  })

export const inboxEventAttributesSchema = z
  .object({
    id: stableIdSchema,
    receivedAt: timestampSchema,
    status: z.enum(INBOX_STATUSES),
    source: z.enum(INBOX_SOURCES).default('user'),
    visibility: z.enum(INBOX_VISIBILITIES).default('public'),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    attachments: z.array(z.string().min(1)),
    context: inboxContextSchema.nullable().optional(),
    routeClaim: inboxRouteClaimSchema.nullable().optional(),
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
    const handlingFacts = [event.handledAt, event.reply, event.disposition]
    const handledFacts = handlingFacts.every((value) => value !== null)
    if ((event.status === 'handled') !== handledFacts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'handledAt, reply, and disposition must be present exactly when status is handled',
      })
    }
    if (event.status === 'pending' && handlingFacts.some((value) => value !== null)) {
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
    target: z.string().min(1),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
    notifiedAt: timestampSchema.nullable(),
  })
  .strict()

export type InboxRouteClaim = z.infer<typeof inboxRouteClaimSchema>
export type InboxContext = z.infer<typeof inboxContextSchema>
export type InboxEventAttributes = z.infer<typeof inboxEventAttributesSchema>
export type WorkspaceAttentionAttributes = z.infer<typeof workspaceAttentionAttributesSchema>
export type InboxEventDocument = MarkdownDocument<InboxEventAttributes>
export type WorkspaceAttentionDocument = MarkdownDocument<WorkspaceAttentionAttributes>

export function parseInboxEventDocument(source: string) {
  return parseMarkdownDocument(source, inboxEventAttributesSchema, 'Inbox event')
}

export function parseWorkspaceAttentionDocument(source: string) {
  return parseMarkdownDocument(source, workspaceAttentionAttributesSchema, 'Workspace Attention')
}

export const renderInboxEventDocument = renderMarkdownDocument<InboxEventAttributes>
export const renderWorkspaceAttentionDocument = renderMarkdownDocument<WorkspaceAttentionAttributes>

export async function inboxSourceDigest(content: string, attachments: readonly string[]) {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const payload = new TextEncoder().encode(
    `${normalized}\n\u0000${JSON.stringify([...attachments])}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}
