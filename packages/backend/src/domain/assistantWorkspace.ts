import { parse } from 'yaml'
import { z } from 'zod'
import type { PublicationCandidate } from '../publication/types'
import {
  ASSISTANT_PREFERENCE_PATH,
  type AssistantPreferenceDocument,
  readAssistantPreference,
} from './assistantPreference'
import {
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  inboxSourceDigest,
  isInternalInboxSource,
  parseInboxEventDocument,
  parseWorkspaceAttentionDocument,
} from './assistantWorkspaceDocuments'
import { parseAttentionReference } from './attentionReference'
import { parseInboxEventReference } from './inboxEventReference'
import type { ProjectLink } from './project'
import { projectLabelSchema } from './projectLabel'
import { isNormalizedProjectPath } from './projectPath'
import { STABLE_ID_PATTERN, stableIdSchema } from './stableId'

const homeSchema = z.object({ homeId: stableIdSchema }).strict()
const linksSchema = z
  .object({
    projects: z.array(
      z
        .object({
          projectId: stableIdSchema,
          label: projectLabelSchema.optional(),
          primaryRepoId: stableIdSchema,
          repos: z.array(
            z
              .object({
                repoId: stableIdSchema,
                repoPath: z.string().min(1),
                projectPath: z.string().refine(isNormalizedProjectPath).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()

export interface AssistantWorkspace {
  homeId: string
  projects: readonly ProjectLink[]
  preference: AssistantPreferenceDocument
  events: ReadonlyMap<string, InboxEventDocument>
  attentions: ReadonlyMap<string, WorkspaceAttentionDocument>
}

export interface AssistantWorkspacePaths {
  homeDocument: string
  projectLinks: string
  preference: string
  attachmentRoot: string
  inboxRoot: string
  attentionRoot: string
  inboxEvent(eventId: string): string
  attention(attentionId: string): string
}

export class AssistantWorkspaceValidationError extends Error {}

export function createAssistantWorkspacePaths(): AssistantWorkspacePaths {
  return {
    homeDocument: '.hopi/home.yml',
    projectLinks: '.hopi/projects.yml',
    preference: ASSISTANT_PREFERENCE_PATH,
    attachmentRoot: '.hopi/docs/assistant/attachments',
    inboxRoot: '.hopi/docs/assistant/inbox',
    attentionRoot: '.hopi/docs/attention',
    inboxEvent(eventId) {
      assertStableId(eventId, 'eventId')
      return `${this.inboxRoot}/${eventId}.md`
    },
    attention(attentionId) {
      assertStableId(attentionId, 'attentionId')
      return `${this.attentionRoot}/${attentionId}.md`
    },
  }
}

export async function readAndValidateAssistantWorkspace(
  candidate: PublicationCandidate,
  paths: AssistantWorkspacePaths,
): Promise<AssistantWorkspace> {
  const home = parseYaml(await requiredText(candidate, paths.homeDocument), homeSchema, 'home.yml')
  const links = parseYaml(
    await requiredText(candidate, paths.projectLinks),
    linksSchema,
    'projects.yml',
  )
  if (new Set(links.projects.map((project) => project.projectId)).size !== links.projects.length) {
    throw invalid('projects.yml contains duplicate projectId values')
  }
  const events = new Map<string, InboxEventDocument>()
  const attentions = new Map<string, WorkspaceAttentionDocument>()
  const preference = await readAssistantPreference(await candidate.readText(paths.preference))

  for (const path of await candidate.listFiles(paths.inboxRoot)) {
    const eventId = localMarkdownId(path, paths.inboxRoot)
    if (!eventId) continue
    const source = await requiredText(candidate, path)
    const event = parseInboxEventDocument(source)
    if (event.attributes.id !== eventId) throw invalid(`Inbox identity mismatch: ${path}`)
    const digest = await inboxSourceDigest(event.body, event.attributes.attachments)
    if (digest !== event.attributes.sourceDigest) {
      throw invalid(`Inbox source digest mismatch: ${eventId}`)
    }
    events.set(eventId, event)
  }

  for (const path of await candidate.listFiles(paths.attentionRoot)) {
    const attentionId = localMarkdownId(path, paths.attentionRoot)
    if (!attentionId) continue
    const source = await requiredText(candidate, path)
    const attention = parseWorkspaceAttentionDocument(source)
    if (attention.attributes.id !== attentionId) {
      throw invalid(`Workspace Attention identity mismatch: ${path}`)
    }
    attentions.set(attentionId, attention)
  }

  validateReferences(home.homeId, links.projects, events, attentions)
  return { homeId: home.homeId, projects: links.projects, preference, events, attentions }
}

async function validateImageAttachment(
  candidate: PublicationCandidate,
  attachmentRoot: string,
  reference: string,
) {
  const prefix = `${attachmentRoot}/`
  if (!reference.startsWith(prefix)) return
  const parts = reference.slice(prefix.length).split('/')
  const [contentHash, fileName] = parts
  if (
    parts.length !== 2 ||
    !contentHash?.match(/^[a-f0-9]{64}$/) ||
    !fileName?.match(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  ) {
    throw invalid(`Invalid Assistant image attachment reference: ${reference}`)
  }
  const bytes = await candidate.readBytes(reference)
  if (!bytes) throw invalid(`Assistant image attachment is missing: ${reference}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))
  const actual = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
  if (actual !== contentHash) {
    throw invalid(`Assistant image attachment hash mismatch: ${reference}`)
  }
}

export async function validateAssistantWorkspaceTransition(
  current: PublicationCandidate,
  candidate: PublicationCandidate,
  paths: AssistantWorkspacePaths,
) {
  const before = await readAndValidateAssistantWorkspace(current, paths)
  const after = await readAndValidateAssistantWorkspace(candidate, paths)
  if (before.homeId !== after.homeId) throw invalid('homeId is immutable')
  if (JSON.stringify(before.projects) !== JSON.stringify(after.projects)) {
    throw invalid('Workspace document publication may not change project links')
  }

  for (const [eventId, previous] of before.events) {
    const next = after.events.get(eventId)
    if (!next) throw invalid(`Historical Inbox event was removed: ${eventId}`)
    validateEventTransition(previous, next)
  }
  for (const [eventId, event] of after.events) {
    if (before.events.has(eventId)) continue
    if (event.attributes.status !== 'pending' || event.attributes.handledAt !== null) {
      throw invalid(`New Inbox event must be an unclaimed pending receipt: ${eventId}`)
    }
    if (
      (event.attributes.source === 'user' && event.attributes.visibility !== 'public') ||
      (isInternalInboxSource(event.attributes.source) && event.attributes.visibility !== 'internal')
    ) {
      throw invalid(`New Inbox event has invalid source visibility: ${eventId}`)
    }
    for (const reference of event.attributes.attachments) {
      await validateImageAttachment(candidate, paths.attachmentRoot, reference)
    }
  }

  for (const [attentionId, previous] of before.attentions) {
    const next = after.attentions.get(attentionId)
    if (!next) throw invalid(`Historical Workspace Attention was removed: ${attentionId}`)
    validateAttentionTransition(previous, next)
  }
  return after
}

function validateEventTransition(previous: InboxEventDocument, next: InboxEventDocument) {
  const before = previous.attributes
  const after = next.attributes
  if (
    before.id !== after.id ||
    before.receivedAt !== after.receivedAt ||
    before.source !== after.source ||
    before.sourceDigest !== after.sourceDigest ||
    JSON.stringify(before.attachments) !== JSON.stringify(after.attachments) ||
    JSON.stringify(before.context ?? null) !== JSON.stringify(after.context ?? null) ||
    previous.body !== next.body
  ) {
    throw invalid(`Inbox receipt is immutable: ${before.id}`)
  }
  if (before.visibility !== after.visibility) {
    if (
      !isInternalInboxSource(before.source) ||
      before.status !== 'pending' ||
      before.visibility !== 'internal' ||
      after.visibility !== 'public'
    ) {
      throw invalid(`Inbox visibility transition is invalid: ${before.id}`)
    }
  }
  if (before.attentionRequest) {
    const nextReferences = new Set(after.attentionRequest?.attentionRefs ?? [])
    if (before.attentionRequest.attentionRefs.some((reference) => !nextReferences.has(reference))) {
      throw invalid(`Inbox Attention request references are append-only: ${before.id}`)
    }
  }
  if (after.status === 'handled' && after.attentionRequest && after.visibility !== 'public') {
    throw invalid(`Handled Inbox Attention request must be public: ${before.id}`)
  }
  if (before.status === 'handled' && JSON.stringify(previous) !== JSON.stringify(next)) {
    const { webhookDeliveredAt: _previousWebhookDeliveredAt, ...previousStableAttributes } = before
    const { webhookDeliveredAt: _nextWebhookDeliveredAt, ...nextStableAttributes } = after
    const previousWithoutMutableMetadata = {
      ...previous,
      attributes: previousStableAttributes,
    }
    const nextWithoutMutableMetadata = {
      ...next,
      attributes: nextStableAttributes,
    }
    const deliveryChanged = before.webhookDeliveredAt !== after.webhookDeliveredAt
    if (
      JSON.stringify(previousWithoutMutableMetadata) !==
        JSON.stringify(nextWithoutMutableMetadata) ||
      (deliveryChanged &&
        (before.webhookDeliveredAt != null || after.webhookDeliveredAt == null)) ||
      !deliveryChanged
    ) {
      throw invalid(`Handled Inbox event is immutable: ${before.id}`)
    }
  }
  if (before.status === 'pending' && after.status === 'handled' && !after.reply?.trim()) {
    throw invalid(`Handled Inbox event requires a reply: ${before.id}`)
  }
}

function validateAttentionTransition(
  previous: WorkspaceAttentionDocument,
  next: WorkspaceAttentionDocument,
) {
  const before = previous.attributes
  const after = next.attributes
  if (before.id !== after.id || before.createdAt !== after.createdAt) {
    throw invalid(`Workspace Attention identity changed: ${before.id}`)
  }
  if (before.resolvedAt !== null && JSON.stringify(previous) !== JSON.stringify(next)) {
    throw invalid(`Resolved Workspace Attention changed: ${before.id}`)
  }
}

function validateReferences(
  homeId: string,
  projects: readonly ProjectLink[],
  events: ReadonlyMap<string, InboxEventDocument>,
  attentions: ReadonlyMap<string, WorkspaceAttentionDocument>,
) {
  const projectIds = new Set(projects.map((project) => project.projectId))
  for (const event of events.values()) {
    const context = event.attributes.context
    if (context?.projectId && !projectIds.has(context.projectId)) {
      throw invalid(`Inbox event ${event.attributes.id} has context for an unlinked Project`)
    }
    if (context?.replyTo) {
      const parsedReply = parseInboxEventReference(context.replyTo)
      const repliedEvent = parsedReply ? events.get(parsedReply.eventId) : null
      if (
        !parsedReply ||
        parsedReply.homeId !== homeId ||
        !repliedEvent ||
        repliedEvent.attributes.visibility !== 'public' ||
        repliedEvent.attributes.status !== 'handled' ||
        (repliedEvent.attributes.context?.projectId ?? null) !== (context.projectId ?? null)
      ) {
        throw invalid(`Inbox event ${event.attributes.id} replies to an invalid Assistant request`)
      }
    }
    for (const reference of context?.attentionRefs ?? []) {
      const parsed = parseAttentionReference(reference)
      if (!parsed) continue
      if (parsed.scope === 'workspace' && parsed.homeId !== homeId) {
        throw invalid(`Inbox event ${event.attributes.id} references another Assistant home`)
      }
      if (parsed.scope === 'goal' && !projectIds.has(parsed.projectId)) {
        throw invalid(`Inbox event ${event.attributes.id} references an unlinked Project`)
      }
    }
  }
  for (const attention of attentions.values()) {
    for (const reference of attention.attributes.refs) {
      if (!reference.startsWith('project:')) continue
      const projectId = reference.slice('project:'.length)
      if (!projectId.includes('/') && !projectIds.has(projectId)) {
        throw invalid(
          `Workspace Attention ${attention.attributes.id} references an unlinked Project`,
        )
      }
    }
  }
}

function localMarkdownId(path: string, root: string) {
  const prefix = `${root}/`
  if (!path.startsWith(prefix) || !path.endsWith('.md')) return null
  const id = path.slice(prefix.length, -3)
  return id && !id.includes('/') ? id : null
}

async function requiredText(candidate: PublicationCandidate, path: string) {
  const source = await candidate.readText(path)
  if (source === null) throw invalid(`Required Assistant workspace file is missing: ${path}`)
  return source
}

function parseYaml<T>(source: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, label: string) {
  const parsed = schema.safeParse(parse(source))
  if (!parsed.success) {
    throw invalid(
      `${label} is invalid: ${parsed.error.issues.map((issue) => issue.message).join(', ')}`,
    )
  }
  return parsed.data
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) throw invalid(`Invalid ${label}: ${value}`)
}

function invalid(message: string) {
  return new AssistantWorkspaceValidationError(message)
}
