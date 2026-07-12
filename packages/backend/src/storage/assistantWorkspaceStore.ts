import {
  type AssistantWorkspace,
  type AssistantWorkspacePaths,
  createAssistantWorkspacePaths,
  readAndValidateAssistantWorkspace,
  validateAssistantWorkspaceTransition,
} from '../domain/assistantWorkspace'
import {
  type InboxContext,
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  inboxSourceDigest,
  parseInboxEventDocument,
  parseWorkspaceAttentionDocument,
  renderInboxEventDocument,
  renderWorkspaceAttentionDocument,
} from '../domain/assistantWorkspaceDocuments'
import type { PublicationCoordinator } from '../publication/publisher'
import { hashBytes } from '../publication/publisher'
import { publicationCandidateFromSnapshot } from '../publication/snapshotCandidate'
import type { PublicationRoot, PublicationWrite } from '../publication/types'
import {
  type AssistantImageAttachment,
  prepareAssistantImages,
  resolveAssistantImage,
} from './assistantImageAttachments'

export interface ReceiveInboxEventInput {
  eventId?: string
  content: string
  attachments?: string[]
  images?: File[]
  context?: InboxContext
  receivedAt?: Date
}

export interface ReceiveReflectionEventInput {
  eventId?: string
  content: string
  context?: InboxContext
  receivedAt?: Date
}

export interface AssistantWorkspaceStore {
  root: PublicationRoot
  paths: AssistantWorkspacePaths
  readWorkspace(): Promise<AssistantWorkspace>
  readEvent(eventId: string): Promise<InboxEventDocument | null>
  resolveAttachment(reference: string): Promise<AssistantImageAttachment | null>
  receiveEvent(input: ReceiveInboxEventInput): Promise<InboxEventDocument>
  receiveReflectionEvent(input: ReceiveReflectionEventInput): Promise<InboxEventDocument>
  exposeEvent(eventId: string): Promise<InboxEventDocument>
  handleEvent(
    eventId: string,
    input: { reply: string; disposition: string; handledAt?: Date },
  ): Promise<InboxEventDocument>
  createAttention(attention: WorkspaceAttentionDocument): Promise<WorkspaceAttentionDocument>
  markAttentionNotified(attentionId: string, notifiedAt?: Date): Promise<WorkspaceAttentionDocument>
  resolveAttention(
    attentionId: string,
    resolution: string,
    resolvedAt?: Date,
  ): Promise<WorkspaceAttentionDocument>
}

export class AssistantWorkspaceStoreError extends Error {}

export function createAssistantWorkspaceStore(
  homeRoot: string,
  publisher: PublicationCoordinator,
): AssistantWorkspaceStore {
  const paths = createAssistantWorkspacePaths()
  const root: PublicationRoot = { id: 'assistant-home', path: homeRoot }

  return {
    root,
    paths,
    async readWorkspace() {
      const snapshot = await publisher.snapshotSelection(root, {
        paths: [paths.homeDocument, paths.projectLinks],
        prefixes: [paths.inboxRoot, paths.attentionRoot],
      })
      return readAndValidateAssistantWorkspace(publicationCandidateFromSnapshot(snapshot), paths)
    },
    async readEvent(eventId) {
      const snapshot = await publisher.snapshot(root, [paths.inboxEvent(eventId)])
      const content = snapshot.files[0]?.content
      return content ? parseInboxEventDocument(new TextDecoder().decode(content)) : null
    },
    async resolveAttachment(reference) {
      return resolveAssistantImage(homeRoot, paths.attachmentRoot, reference)
    },
    async receiveEvent(input) {
      const prepared = await prepareAssistantImages(
        homeRoot,
        paths.attachmentRoot,
        input.images ?? [],
      )
      return receiveEvent(
        root,
        paths,
        publisher,
        input,
        'user',
        'public',
        [...(input.attachments ?? []), ...prepared.attachments.map(({ reference }) => reference)],
        prepared.writes,
      )
    },
    async receiveReflectionEvent(input) {
      return receiveEvent(root, paths, publisher, input, 'reflection', 'internal', [], [])
    },
    async exposeEvent(eventId) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.source !== 'reflection') {
        throw new AssistantWorkspaceStoreError('Only Reflection turns can be exposed')
      }
      if (event.attributes.status !== 'pending') {
        throw new AssistantWorkspaceStoreError('Handled Reflection turns cannot be exposed')
      }
      if (event.attributes.visibility === 'public') return event
      event.attributes.visibility = 'public'
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async handleEvent(eventId, input) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status === 'handled') return event
      event.attributes.status = 'handled'
      event.attributes.handledAt = (input.handledAt ?? new Date()).toISOString()
      event.attributes.reply = input.reply.trim()
      event.attributes.disposition = input.disposition.trim()
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async createAttention(attention) {
      await publisher.publish({
        root,
        supportingWrites: [],
        gateWrite: {
          path: paths.attention(attention.attributes.id),
          expectedHash: null,
          content: renderWorkspaceAttentionDocument(attention),
        },
        validateCandidate: (candidate, current) =>
          validateAssistantWorkspaceTransition(current, candidate, paths).then(() => undefined),
      })
      return attention
    },
    async markAttentionNotified(attentionId, notifiedAt = new Date()) {
      return mutateAttention(this, publisher, homeRoot, attentionId, (attention) => {
        if (attention.attributes.resolvedAt !== null) {
          throw new AssistantWorkspaceStoreError('Resolved Attention cannot be newly notified')
        }
        attention.attributes.notifiedAt ??= notifiedAt.toISOString()
      })
    },
    async resolveAttention(attentionId, resolution, resolvedAt = new Date()) {
      return mutateAttention(this, publisher, homeRoot, attentionId, (attention) => {
        attention.attributes.resolvedAt ??= resolvedAt.toISOString()
        if (!attention.body.includes('\n## Resolution\n')) {
          attention.body += `\n## Resolution\n\n${resolution.trim()}\n`
        }
      })
    },
  }
}

async function receiveEvent(
  root: PublicationRoot,
  paths: AssistantWorkspacePaths,
  publisher: PublicationCoordinator,
  input: ReceiveInboxEventInput | ReceiveReflectionEventInput,
  source: 'user' | 'reflection',
  visibility: 'public' | 'internal',
  attachments: string[],
  supportingWrites: PublicationWrite[],
) {
  const eventId = input.eventId ?? `EV-${crypto.randomUUID()}`
  const body = normalizeReceivedContent(input.content)
  const event: InboxEventDocument = {
    attributes: {
      id: eventId,
      receivedAt: (input.receivedAt ?? new Date()).toISOString(),
      status: 'pending',
      source,
      visibility,
      sourceDigest: await inboxSourceDigest(body, attachments),
      attachments,
      ...(input.context ? { context: { ...input.context } } : {}),
      handledAt: null,
      reply: null,
      disposition: null,
    },
    body,
  }
  await publisher.publishDurableReceipt({
    root,
    supportingWrites,
    gateWrite: {
      path: paths.inboxEvent(eventId),
      expectedHash: null,
      content: renderInboxEventDocument(event),
    },
    validateCandidate: (candidate, current) =>
      validateAssistantWorkspaceTransition(current, candidate, paths).then(() => undefined),
  })
  return event
}

async function publishEvent(
  store: AssistantWorkspaceStore,
  publisher: PublicationCoordinator,
  eventId: string,
  source: string,
  event: InboxEventDocument,
) {
  await publisher.publish({
    root: store.root,
    supportingWrites: [],
    gateWrite: {
      path: store.paths.inboxEvent(eventId),
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderInboxEventDocument(event),
    },
    validateCandidate: (candidate, current) =>
      validateAssistantWorkspaceTransition(current, candidate, store.paths).then(() => undefined),
  })
}

async function requireEvent(store: AssistantWorkspaceStore, homeRoot: string, eventId: string) {
  const path = store.paths.inboxEvent(eventId)
  const file = Bun.file(`${homeRoot}/${path}`)
  if (!(await file.exists()))
    throw new AssistantWorkspaceStoreError(`Inbox event not found: ${eventId}`)
  const source = await file.text()
  return { source, event: parseInboxEventDocument(source) }
}

async function mutateAttention(
  store: AssistantWorkspaceStore,
  publisher: PublicationCoordinator,
  homeRoot: string,
  attentionId: string,
  mutate: (attention: WorkspaceAttentionDocument) => void,
) {
  const path = store.paths.attention(attentionId)
  const file = Bun.file(`${homeRoot}/${path}`)
  if (!(await file.exists())) {
    throw new AssistantWorkspaceStoreError(`Workspace Attention not found: ${attentionId}`)
  }
  const source = await file.text()
  const attention = parseWorkspaceAttentionDocument(source)
  mutate(attention)
  await publisher.publish({
    root: store.root,
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkspaceAttentionDocument(attention),
    },
    validateCandidate: (candidate, current) =>
      validateAssistantWorkspaceTransition(current, candidate, store.paths).then(() => undefined),
  })
  return attention
}

function normalizeReceivedContent(content: string) {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}
