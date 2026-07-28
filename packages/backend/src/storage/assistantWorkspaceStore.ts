import type { AssistantPreferenceDocument } from '../domain/assistantPreference'
import { readAssistantPreference } from '../domain/assistantPreference'
import {
  type AssistantWorkspace,
  type AssistantWorkspacePaths,
  createAssistantWorkspacePaths,
  readAndValidateAssistantWorkspace,
  validateAssistantWorkspaceTransition,
} from '../domain/assistantWorkspace'
import {
  type InboxAttentionRequest,
  type InboxContext,
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  inboxSourceDigest,
  isInternalInboxSource,
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

export interface ReceiveInternalEventInput {
  eventId?: string
  content: string
  context?: InboxContext
  receivedAt?: Date
}

export interface AssistantWorkspaceStore {
  root: PublicationRoot
  paths: AssistantWorkspacePaths
  readWorkspace(): Promise<AssistantWorkspace>
  readWorkspaceForControl(): Promise<AssistantWorkspace>
  writePreference(
    content: string,
    expectedDigest: string,
  ): Promise<{ preference: AssistantPreferenceDocument; changed: boolean }>
  readEvent(eventId: string): Promise<InboxEventDocument | null>
  resolveAttachment(reference: string): Promise<AssistantImageAttachment | null>
  receiveEvent(input: ReceiveInboxEventInput): Promise<InboxEventDocument>
  receiveSystemEvent(input: ReceiveInternalEventInput): Promise<InboxEventDocument>
  receiveReflectionEvent(input: ReceiveInternalEventInput): Promise<InboxEventDocument>
  exposeEvent(eventId: string): Promise<InboxEventDocument>
  stageAttentionRequest(
    eventId: string,
    request: InboxAttentionRequest,
  ): Promise<InboxEventDocument>
  clearPendingAttentionRequest(eventId: string): Promise<InboxEventDocument>
  migrateHandledAttentionRequest(
    eventId: string,
    request: InboxAttentionRequest,
  ): Promise<InboxEventDocument>
  handleEvent(
    eventId: string,
    input: { reply: string; disposition: string; handledAt?: Date; expose?: boolean },
  ): Promise<InboxEventDocument>
  markEventWebhookDelivered(eventId: string, deliveredAt?: Date): Promise<InboxEventDocument>
  createAttention(attention: WorkspaceAttentionDocument): Promise<WorkspaceAttentionDocument>
  updateAttention(
    attentionId: string,
    input: {
      body?: string
      refs?: string[]
      revisitAt?: string | null
      notifiedAt?: string | null
      operatorRequest?: string | null
      updatedAt?: Date
    },
  ): Promise<WorkspaceAttentionDocument>
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
  let controlSnapshot: { generation: number; workspace: AssistantWorkspace } | null = null

  async function readWorkspace() {
    const snapshot = await publisher.snapshotSelection(root, {
      paths: [paths.homeDocument, paths.projectLinks, paths.preference],
      prefixes: [paths.inboxRoot, paths.attentionRoot],
    })
    return readAndValidateAssistantWorkspace(publicationCandidateFromSnapshot(snapshot), paths)
  }

  return {
    root,
    paths,
    readWorkspace,
    async readWorkspaceForControl() {
      const generation = await publisher.generation(root)
      if (controlSnapshot?.generation === generation) return controlSnapshot.workspace
      const snapshot = await publisher.snapshotSelectionAtGeneration(root, {
        paths: [paths.homeDocument, paths.projectLinks, paths.preference],
        prefixes: [paths.inboxRoot, paths.attentionRoot],
      })
      const workspace = await readAndValidateAssistantWorkspace(
        publicationCandidateFromSnapshot(snapshot),
        paths,
      )
      controlSnapshot = { generation: snapshot.generation, workspace }
      return workspace
    },
    async writePreference(content, expectedDigest) {
      const snapshot = await publisher.snapshot(root, [paths.preference])
      const currentFile = snapshot.files[0]
      const current = await readAssistantPreference(
        currentFile?.content ? new TextDecoder().decode(currentFile.content) : null,
      )
      if (current.digest !== expectedDigest) {
        throw new AssistantWorkspaceStoreError(
          'Preference document changed since this Assistant turn; read the current document before retrying',
        )
      }
      const preference = await readAssistantPreference(content)
      if (preference.content === current.content) return { preference: current, changed: false }

      await publisher.publish({
        root,
        supportingWrites: [],
        gateWrite: {
          path: paths.preference,
          expectedHash: currentFile?.hash ?? null,
          content: preference.content,
        },
        validateCandidate: (candidate, before) =>
          validateAssistantWorkspaceTransition(before, candidate, paths).then(() => undefined),
      })
      return { preference, changed: true }
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
    async receiveSystemEvent(input) {
      return receiveEvent(root, paths, publisher, input, 'system', 'internal', [], [])
    },
    async exposeEvent(eventId) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (!isInternalInboxSource(event.attributes.source)) {
        throw new AssistantWorkspaceStoreError('Only internal Assistant turns can be exposed')
      }
      if (event.attributes.status !== 'pending') {
        throw new AssistantWorkspaceStoreError('Handled internal Assistant turns cannot be exposed')
      }
      if (event.attributes.visibility === 'public') return event
      event.attributes.visibility = 'public'
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async stageAttentionRequest(eventId, request) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status !== 'pending') {
        throw new AssistantWorkspaceStoreError('Handled Inbox event cannot stage operator transfer')
      }
      if (JSON.stringify(event.attributes.attentionRequest ?? null) === JSON.stringify(request)) {
        return event
      }
      if (event.attributes.attentionRequest) {
        throw new AssistantWorkspaceStoreError(
          'Inbox event already staged a different Attention transfer',
        )
      }
      event.attributes.attentionRequest = request
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async clearPendingAttentionRequest(eventId) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status !== 'pending') {
        throw new AssistantWorkspaceStoreError(
          'Handled Inbox event cannot clear pending Attention transfer',
        )
      }
      if (!event.attributes.attentionRequest) return event
      event.attributes.attentionRequest = null
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async migrateHandledAttentionRequest(eventId, request) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status !== 'handled' || event.attributes.visibility !== 'public') {
        throw new AssistantWorkspaceStoreError(
          'Only a handled public Inbox event can receive migrated Attention metadata',
        )
      }
      if (JSON.stringify(event.attributes.attentionRequest ?? null) === JSON.stringify(request)) {
        return event
      }
      if (event.attributes.attentionRequest) {
        throw new AssistantWorkspaceStoreError(
          'Handled Inbox event already has different Attention metadata',
        )
      }
      event.attributes.attentionRequest = request
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async handleEvent(eventId, input) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status === 'handled') return event
      if (input.expose) {
        if (!isInternalInboxSource(event.attributes.source)) {
          throw new AssistantWorkspaceStoreError('Only internal Assistant turns can be exposed')
        }
        event.attributes.visibility = 'public'
      }
      event.attributes.status = 'handled'
      event.attributes.handledAt = (input.handledAt ?? new Date()).toISOString()
      event.attributes.reply = input.reply.trim()
      if (event.attributes.attentionRequest && !event.attributes.reply) {
        throw new AssistantWorkspaceStoreError(
          'Attention transfer requires a non-empty public request',
        )
      }
      event.attributes.disposition = input.disposition.trim()
      await publishEvent(this, publisher, eventId, source, event)
      return event
    },
    async markEventWebhookDelivered(eventId, deliveredAt = new Date()) {
      const { source, event } = await requireEvent(this, homeRoot, eventId)
      if (event.attributes.status !== 'handled' || event.attributes.visibility !== 'public') {
        throw new AssistantWorkspaceStoreError('Only handled public events can be delivered')
      }
      if (event.attributes.webhookDeliveredAt) return event
      event.attributes.webhookDeliveredAt = deliveredAt.toISOString()
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
    async updateAttention(attentionId, input) {
      return mutateAttention(this, publisher, homeRoot, attentionId, (attention) => {
        if (attention.attributes.resolvedAt !== null) {
          throw new AssistantWorkspaceStoreError('Resolved Attention cannot be edited')
        }
        if (input.body !== undefined) attention.body = normalizeReceivedContent(input.body)
        if (input.refs !== undefined) attention.attributes.refs = [...new Set(input.refs)]
        if (input.revisitAt !== undefined) attention.attributes.revisitAt = input.revisitAt
        if (input.notifiedAt !== undefined) attention.attributes.notifiedAt = input.notifiedAt
        if (input.operatorRequest !== undefined) {
          attention.attributes.operatorRequest = input.operatorRequest
        }
        attention.attributes.updatedAt = (input.updatedAt ?? new Date()).toISOString()
      })
    },
    async resolveAttention(attentionId, resolution, resolvedAt = new Date()) {
      return mutateAttention(this, publisher, homeRoot, attentionId, (attention) => {
        attention.attributes.resolvedAt ??= resolvedAt.toISOString()
        attention.attributes.revisitAt = null
        attention.attributes.operatorRequest = null
        attention.attributes.updatedAt = resolvedAt.toISOString()
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
  input: ReceiveInboxEventInput | ReceiveInternalEventInput,
  source: 'user' | 'system' | 'reflection',
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
      attentionRequest: null,
      webhookDeliveredAt: null,
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
