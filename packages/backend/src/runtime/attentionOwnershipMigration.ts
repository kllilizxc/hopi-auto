import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { needsYouRequests } from '../assistant/assistantNeedsYou'
import {
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from '../domain/attentionReference'
import { inboxEventReference } from '../domain/inboxEventReference'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { acknowledgeGoalAttention, clearGoalAttentionOperatorRequest } from './attentionDelivery'

export async function migrateLegacyAttentionOwnership(input: {
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, { store: GoalPackageStore }>
  acknowledgeEvent?(eventId: string): Promise<readonly string[]>
}) {
  const workspace = await input.workspace.readWorkspace()
  const acknowledgeEvent =
    input.acknowledgeEvent ?? ((eventId: string) => acknowledgeRequestEvent(input, eventId))
  let migrated = 0
  for (const event of workspace.events.values()) {
    if (
      event.attributes.status === 'handled' &&
      event.attributes.visibility === 'public' &&
      event.attributes.attentionRequest
    ) {
      await acknowledgeEvent(event.attributes.id)
    }
  }
  const ownershipWorkspace = await input.workspace.readWorkspace()
  for (const event of ownershipWorkspace.events.values()) {
    const replyTo = event.attributes.source === 'user' ? event.attributes.context?.replyTo : null
    if (!replyTo) continue
    for (const reference of normalizeInboxAttentionReferences(event.attributes.context ?? {})) {
      const parsed = parseAttentionReference(reference)
      if (!parsed) continue
      if (parsed.scope === 'workspace') {
        const attention =
          parsed.homeId === ownershipWorkspace.homeId
            ? ownershipWorkspace.attentions.get(parsed.attentionId)
            : undefined
        if ((attention?.attributes.operatorRequest ?? null) !== replyTo) continue
        await input.workspace.updateAttention(parsed.attentionId, {
          operatorRequest: null,
          updatedAt: new Date(event.attributes.receivedAt),
        })
        migrated += 1
        continue
      }
      const project = input.projects.get(parsed.projectId)
      if (
        project &&
        (await clearGoalAttentionOperatorRequest(
          project.store,
          parsed.goalId,
          parsed.attentionId,
          replyTo,
        ))
      ) {
        migrated += 1
      }
    }
  }
  const migrationWorkspace = await input.workspace.readWorkspace()
  const diagnostics: string[] = []
  const orderedEvents = [...migrationWorkspace.events.values()].sort((left, right) =>
    left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
  )
  for (const event of orderedEvents) {
    if (
      event.attributes.visibility !== 'public' ||
      event.attributes.status !== 'handled' ||
      event.attributes.attentionRequest ||
      !event.attributes.reply ||
      !event.attributes.context
    ) {
      continue
    }
    const legacyRequests = needsYouRequests(event.attributes.reply)
    if (legacyRequests.length === 0) continue
    const contextReferences = normalizeInboxAttentionReferences(event.attributes.context)
    const eventReference = inboxEventReference(migrationWorkspace.homeId, event.attributes.id)
    const references: string[] = []
    const prompts: unknown[] = []
    for (const request of legacyRequests) {
      const candidates = contextReferences.filter(
        (reference) => parseAttentionReference(reference)?.attentionId === request.attentionId,
      )
      if (candidates.length !== 1) {
        diagnostics.push(
          `${event.attributes.id}: Attention ${request.attentionId} has ${candidates.length} canonical context matches`,
        )
        continue
      }
      const reference = candidates[0] as string
      const laterExactReply = orderedEvents.some(
        (candidate) =>
          candidate.attributes.source === 'user' &&
          candidate.attributes.context?.replyTo === eventReference &&
          normalizeInboxAttentionReferences(candidate.attributes.context).includes(reference),
      )
      if (laterExactReply) continue
      if (!(await openAttentionExists(input, migrationWorkspace.homeId, reference))) {
        diagnostics.push(
          `${event.attributes.id}: Attention ${request.attentionId} is missing, resolved, or already transferred`,
        )
        continue
      }
      references.push(reference)
      if (request.decisionPrompt) prompts.push(request.decisionPrompt)
    }
    if (references.length === 0) continue
    const referenceProjects = new Set(
      (
        await Promise.all(
          references.map((reference) =>
            attentionReferenceProject(input.workspace, migrationWorkspace.homeId, reference),
          ),
        )
      ).map((projectId) => projectId ?? 'home'),
    )
    if (referenceProjects.size !== 1) {
      diagnostics.push(`${event.attributes.id}: legacy request spans multiple conversations`)
      continue
    }
    const distinctPrompts = [...new Set(prompts.map((prompt) => JSON.stringify(prompt)))]
    const decisionPrompt =
      distinctPrompts.length === 1 && prompts.length === references.length
        ? JSON.parse(distinctPrompts[0] as string)
        : undefined
    if (prompts.length > 0 && !decisionPrompt) {
      diagnostics.push(`${event.attributes.id}: legacy DecisionPrompt ownership is ambiguous`)
    }
    await input.workspace.migrateHandledAttentionRequest(event.attributes.id, {
      attentionRefs: [...new Set(references)],
      ...(decisionPrompt ? { decisionPrompt } : {}),
    })
    await acknowledgeEvent(event.attributes.id)
    migrated += references.length
  }
  if (diagnostics.length > 0) {
    const diagnosticRoot = join(input.workspace.root.path, '.hopi', 'runtime', 'migrations')
    await mkdir(diagnosticRoot, { recursive: true })
    await appendFile(
      join(diagnosticRoot, 'attention-ownership.jsonl'),
      `${diagnostics
        .map((message) =>
          JSON.stringify({
            recordedAt: new Date().toISOString(),
            migration: 'legacy-needs-you',
            message,
          }),
        )
        .join('\n')}\n`,
    )
  }
  return migrated
}

async function attentionReferenceProject(
  workspace: AssistantWorkspaceStore,
  homeId: string,
  reference: string,
) {
  const parsed = parseAttentionReference(reference)
  if (!parsed) return null
  if (parsed.scope === 'goal') return parsed.projectId
  if (parsed.homeId !== homeId) return null
  const attention = (await workspace.readWorkspace()).attentions.get(parsed.attentionId)
  if (!attention) return null
  for (const candidate of attention.attributes.refs) {
    if (!candidate.startsWith('project:')) continue
    const projectId = candidate.slice('project:'.length)
    if (projectId && !projectId.includes('/')) return projectId
  }
  return null
}

async function acknowledgeRequestEvent(
  input: {
    workspace: AssistantWorkspaceStore
    projects: ReadonlyMap<string, { store: GoalPackageStore }>
  },
  eventId: string,
) {
  const event = await input.workspace.readEvent(eventId)
  if (
    !event?.attributes.attentionRequest ||
    event.attributes.status !== 'handled' ||
    event.attributes.visibility !== 'public'
  ) {
    return []
  }
  const workspace = await input.workspace.readWorkspace()
  const requestReference = inboxEventReference(workspace.homeId, eventId)
  const acknowledgedAt = new Date(event.attributes.handledAt ?? event.attributes.receivedAt)
  const acknowledged: string[] = []
  for (const reference of event.attributes.attentionRequest.attentionRefs) {
    const parsed = parseAttentionReference(reference)
    if (!parsed) continue
    if (parsed.scope === 'workspace') {
      if (parsed.homeId !== workspace.homeId) continue
      const attention = workspace.attentions.get(parsed.attentionId)
      if (!attention || attention.attributes.resolvedAt !== null) continue
      if ((attention.attributes.operatorRequest ?? null) !== requestReference) {
        await input.workspace.updateAttention(parsed.attentionId, {
          notifiedAt: attention.attributes.notifiedAt ?? acknowledgedAt.toISOString(),
          operatorRequest: requestReference,
          revisitAt: null,
          updatedAt: acknowledgedAt,
        })
      }
      acknowledged.push(reference)
      continue
    }
    const project = input.projects.get(parsed.projectId)
    if (
      project &&
      ((await acknowledgeGoalAttention(
        project.store,
        parsed.goalId,
        parsed.attentionId,
        acknowledgedAt,
        requestReference,
      )) ||
        (await project.store.readPackage(parsed.goalId)).attentions.get(parsed.attentionId)
          ?.attributes.operatorRequest === requestReference)
    ) {
      acknowledged.push(reference)
    }
  }
  return acknowledged
}

async function openAttentionExists(
  input: {
    workspace: AssistantWorkspaceStore
    projects: ReadonlyMap<string, { store: GoalPackageStore }>
  },
  homeId: string,
  reference: string,
) {
  const parsed = parseAttentionReference(reference)
  if (!parsed) return false
  if (parsed.scope === 'workspace') {
    if (parsed.homeId !== homeId) return false
    const attention = (await input.workspace.readWorkspace()).attentions.get(parsed.attentionId)
    return (
      Boolean(attention) &&
      attention?.attributes.resolvedAt === null &&
      (attention.attributes.operatorRequest ?? null) === null
    )
  }
  const project = input.projects.get(parsed.projectId)
  if (!project) return false
  const attention = (await project.store.readPackage(parsed.goalId)).attentions.get(
    parsed.attentionId,
  )
  return (
    Boolean(attention) &&
    attention?.attributes.target !== null &&
    attention?.attributes.resolvedAt === null &&
    (attention.attributes.operatorRequest ?? null) === null
  )
}
