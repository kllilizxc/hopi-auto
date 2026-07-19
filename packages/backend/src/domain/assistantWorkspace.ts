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
  parseInboxEventDocument,
  parseWorkspaceAttentionDocument,
} from './assistantWorkspaceDocuments'
import {
  normalizeInboxAttentionReferences,
  parseAttentionReference,
  workspaceAttentionReference,
} from './attentionReference'
import { parseInboxEventReference } from './inboxEventReference'
import { DEFAULT_PRIMARY_REPO_ID, type ProjectLink } from './project'
import {
  normalizeProjectCodingDefaults,
  projectCodingDefaultsInputSchema,
} from './projectCodingDefaults'
import { isNormalizedProjectPath } from './projectPath'
import { STABLE_ID_PATTERN, stableIdSchema } from './stableId'

const homeSchema = z.object({ version: z.literal(1), homeId: stableIdSchema }).strict()
const legacyLinksSchema = z
  .object({
    version: z.literal(1),
    projects: z.array(
      z
        .object({
          projectId: stableIdSchema,
          repoPath: z.string().min(1),
          codingDefaults: projectCodingDefaultsInputSchema
            .transform((value) => normalizeProjectCodingDefaults(value))
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()
const legacyMultiRepoLinksSchema = z
  .object({
    version: z.literal(2),
    projects: z.array(
      z
        .object({
          projectId: stableIdSchema,
          primaryRepoId: stableIdSchema,
          repos: z
            .array(
              z
                .object({
                  repoId: stableIdSchema,
                  repoPath: z.string().min(1),
                  projectPath: z.string().refine(isNormalizedProjectPath).optional(),
                })
                .strict(),
            )
            .min(1),
          codingDefaults: projectCodingDefaultsInputSchema
            .transform((value) => normalizeProjectCodingDefaults(value))
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()
const linksSchema = z
  .object({
    version: z.literal(3),
    projects: z.array(
      z
        .object({
          projectId: stableIdSchema,
          primaryRepoId: stableIdSchema,
          repos: z
            .array(
              z
                .object({
                  repoId: stableIdSchema,
                  repoPath: z.string().min(1),
                  projectPath: z.string().refine(isNormalizedProjectPath).optional(),
                  deliveryBranch: z.string().min(1),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
  })
  .strict()
const legacyConfiguredLinksSchema = z
  .object({
    version: z.literal(3),
    projects: z.array(
      linksSchema.shape.projects.element
        .extend({
          codingDefaults: projectCodingDefaultsInputSchema
            .transform((value) => normalizeProjectCodingDefaults(value))
            .optional(),
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
  const rawLinks = parseYaml(
    await requiredText(candidate, paths.projectLinks),
    z.union([
      linksSchema,
      legacyConfiguredLinksSchema,
      legacyMultiRepoLinksSchema,
      legacyLinksSchema,
    ]),
    'projects.yml',
  )
  const links: { projects: ProjectLink[] } = {
    projects:
      rawLinks.version === 1
        ? rawLinks.projects.map((project) => ({
            projectId: project.projectId,
            primaryRepoId: DEFAULT_PRIMARY_REPO_ID,
            repos: [{ repoId: DEFAULT_PRIMARY_REPO_ID, repoPath: project.repoPath }],
          }))
        : rawLinks.projects.map((project) => ({
            projectId: project.projectId,
            primaryRepoId: project.primaryRepoId,
            repos: project.repos,
          })),
  }
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
    if (
      event.attributes.status !== 'pending' ||
      event.attributes.routeClaim != null ||
      event.attributes.handledAt !== null
    ) {
      throw invalid(`New Inbox event must be an unclaimed pending receipt: ${eventId}`)
    }
    if (
      (event.attributes.source === 'user' && event.attributes.visibility !== 'public') ||
      (event.attributes.source === 'reflection' && event.attributes.visibility !== 'internal')
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
      before.source !== 'reflection' ||
      before.status !== 'pending' ||
      before.visibility !== 'internal' ||
      after.visibility !== 'public'
    ) {
      throw invalid(`Inbox visibility transition is invalid: ${before.id}`)
    }
  }
  if (before.routeClaim && JSON.stringify(before.routeClaim) !== JSON.stringify(after.routeClaim)) {
    throw invalid(`Inbox route claim is immutable: ${before.id}`)
  }
  if (before.status === 'handled' && JSON.stringify(previous) !== JSON.stringify(next)) {
    const previousWithoutDelivery = {
      ...previous,
      attributes: { ...before, webhookDeliveredAt: null },
    }
    const nextWithoutDelivery = {
      ...next,
      attributes: { ...after, webhookDeliveredAt: null },
    }
    if (
      JSON.stringify(previousWithoutDelivery) !== JSON.stringify(nextWithoutDelivery) ||
      before.webhookDeliveredAt != null ||
      after.webhookDeliveredAt == null
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
  if (
    before.id !== after.id ||
    before.target !== after.target ||
    before.createdAt !== after.createdAt
  ) {
    throw invalid(`Workspace Attention identity or target changed: ${before.id}`)
  }
  if (before.resolvedAt !== null && before.resolvedAt !== after.resolvedAt) {
    throw invalid(`Workspace Attention resolution changed: ${before.id}`)
  }
  if (before.notifiedAt !== null && before.notifiedAt !== after.notifiedAt) {
    throw invalid(`Workspace Attention notification changed: ${before.id}`)
  }
  const beforeOperatorRequest = before.operatorRequest ?? null
  const afterOperatorRequest = after.operatorRequest ?? null
  if (before.resolvedAt !== null && beforeOperatorRequest !== afterOperatorRequest) {
    throw invalid(`Resolved Workspace Attention ownership changed: ${before.id}`)
  }
  if (
    beforeOperatorRequest !== null &&
    afterOperatorRequest !== null &&
    beforeOperatorRequest !== afterOperatorRequest
  ) {
    throw invalid(`Workspace Attention operator request changed without a reply: ${before.id}`)
  }
  if (!next.body.startsWith(previous.body)) {
    throw invalid(`Workspace Attention body was rewritten: ${before.id}`)
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
    const claim = event.attributes.routeClaim
    if (claim && !projectIds.has(claim.projectId)) {
      throw invalid(`Inbox event ${event.attributes.id} claims an unlinked Project`)
    }
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
        repliedEvent.attributes.source !== 'reflection' ||
        repliedEvent.attributes.visibility !== 'public' ||
        repliedEvent.attributes.status !== 'handled'
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
  const openProjectTargets = new Set<string>()
  for (const attention of attentions.values()) {
    const { target, resolvedAt } = attention.attributes
    const operatorRequest = attention.attributes.operatorRequest ?? null
    if (operatorRequest) {
      const parsedRequest = parseInboxEventReference(operatorRequest)
      const requestEvent = parsedRequest ? events.get(parsedRequest.eventId) : null
      const attentionReference = workspaceAttentionReference(homeId, attention.attributes.id)
      if (
        !parsedRequest ||
        parsedRequest.homeId !== homeId ||
        !requestEvent ||
        requestEvent.attributes.source !== 'reflection' ||
        requestEvent.attributes.visibility !== 'public' ||
        requestEvent.attributes.status !== 'handled' ||
        !requestEvent.attributes.context ||
        !normalizeInboxAttentionReferences(requestEvent.attributes.context).includes(
          attentionReference,
        )
      ) {
        throw invalid(
          `Workspace Attention ${attention.attributes.id} has an invalid operator request`,
        )
      }
    }
    const eventPrefix = `home:${homeId}/event:`
    const projectPrefix = 'project:'
    if (target.startsWith(eventPrefix)) {
      if (!events.has(target.slice(eventPrefix.length))) {
        throw invalid(`Workspace Attention ${attention.attributes.id} targets a missing event`)
      }
      continue
    }
    if (target.startsWith(projectPrefix)) {
      const projectId = target.slice(projectPrefix.length)
      if (!projectIds.has(projectId)) {
        throw invalid(`Workspace Attention ${attention.attributes.id} targets an unlinked Project`)
      }
      if (resolvedAt === null && openProjectTargets.has(projectId)) {
        throw invalid(`More than one open Workspace Attention targets Project ${projectId}`)
      }
      if (resolvedAt === null) openProjectTargets.add(projectId)
      continue
    }
    throw invalid(`Workspace Attention ${attention.attributes.id} has an invalid target`)
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
