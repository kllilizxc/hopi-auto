import { isPresentableAgentRuntimeEvent } from '../agent/runtimeEvents'
import { readAssistantConversationEpoch } from '../assistant/assistantConversationEpoch'
import {
  type AssistantConversationScope,
  assistantConversationScopeKey,
  assistantEventBelongsToScope,
} from '../assistant/assistantConversationScope'
import {
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  isInternalInboxSource,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import { goalAttentionReference, workspaceAttentionReference } from '../domain/attentionReference'
import type { AttentionDocument } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { type CursorPageRequest, paginateItems } from '../presentation/cursorPage'
import { type MvpRuntime, requireProject } from '../runtime/mvpRuntime'

const ASSISTANT_FEED_PROJECTION_VERSION = 2

export async function presentAssistantFeed(
  runtime: MvpRuntime,
  request: CursorPageRequest,
  scope: AssistantConversationScope,
) {
  const projection = await readAssistantFeedProjection(runtime, scope)
  const page = paginateItems(projection.entries, request, {
    scope: `assistant-feed:${assistantConversationScopeKey(scope)}`,
    getId: (entry) => entry.id,
  })

  return {
    ...page,
    items: await Promise.all(page.items.map((entry) => presentAssistantFeedEntry(runtime, entry))),
    requests: projection.requests,
    activity: projection.activity,
    syncCursor: projection.syncCursor,
    streamId: projection.streamId,
  }
}

export async function presentAssistantFeedChanges(
  runtime: MvpRuntime,
  cursor: string | null,
  scope: AssistantConversationScope,
  clientStreamId: string | null,
) {
  const projection = await readAssistantFeedProjection(runtime, scope)
  const replayFrom =
    cursor && (!clientStreamId || clientStreamId === projection.streamId)
      ? Date.parse(cursor) - 1
      : null
  const changed =
    replayFrom !== null
      ? projection.entries.filter((entry) => Date.parse(entry.updatedAt) >= replayFrom)
      : projection.entries
  const removedIds = projection.removals
    .filter((removal) => replayFrom === null || Date.parse(removal.updatedAt) >= replayFrom)
    .map((removal) => removal.id)
  return {
    items: await Promise.all(changed.map((entry) => presentAssistantFeedEntry(runtime, entry))),
    removedIds,
    requests: projection.requests,
    activity: projection.activity,
    syncCursor: projection.syncCursor,
    streamId: projection.streamId,
  }
}

export interface ScopedAssistantAttentionBase {
  id: string
  createdAt: string
  resolvedAt: string | null
  summary: string
  decisionPrompt: WorkspaceAttentionDocument['attributes']['decisionPrompt']
  body: string
}

export type ScopedAssistantAttention =
  | (ScopedAssistantAttentionBase & {
      scope: 'workspace'
      projectId?: string
      updatedAt: string
      refs: string[]
    })
  | (ScopedAssistantAttentionBase & {
      scope: 'goal'
      projectId: string
      goalId: string
      target: string
    })

export function presentWorkspaceAttention(
  attention: WorkspaceAttentionDocument,
  projectId = workspaceAttentionProjectId(attention) ?? undefined,
): ScopedAssistantAttention {
  return {
    scope: 'workspace',
    ...(projectId ? { projectId } : {}),
    ...attention.attributes,
    summary: attention.attributes.summary,
    decisionPrompt: attention.attributes.decisionPrompt ?? null,
    body: attention.body,
  }
}

export function presentGoalAttention(
  attention: AttentionDocument,
  projectId: string,
  goalId: string,
): ScopedAssistantAttention {
  return {
    scope: 'goal',
    projectId,
    goalId,
    id: attention.attributes.id,
    target: attention.attributes.target,
    createdAt: attention.attributes.createdAt,
    resolvedAt: attention.attributes.resolvedAt,
    summary: attention.attributes.summary,
    decisionPrompt: attention.attributes.decisionPrompt ?? null,
    body: attention.body,
  }
}

export function presentGoalAttentions(projectId: string, goalId: string, goalPackage: GoalPackage) {
  return [...goalPackage.attentions.values()].map((attention) =>
    presentGoalAttention(attention, projectId, goalId),
  )
}

export interface ScopedGoalCompletion {
  projectId: string
  goalId: string
  evidenceId: string
  completedAt: string
  body: string
}

export function goalCompletionProjection(
  projectId: string,
  goalId: string,
  goalPackage: GoalPackage,
): ScopedGoalCompletion | null {
  const goal = goalPackage.goal.attributes
  if (goal.lifecycle !== 'done') return null

  const evidence = [...goalPackage.works.values()]
    .filter(
      (work) =>
        work.attributes.status === 'done' &&
        work.attributes.contractRevision === goal.contractRevision,
    )
    .flatMap((work) =>
      work.attributes.evidenceRefs.flatMap((evidenceId) => {
        const candidate = goalPackage.evidence.get(evidenceId)
        return candidate ? [candidate] : []
      }),
    )
    .toSorted(
      (left, right) =>
        left.attributes.createdAt.localeCompare(right.attributes.createdAt) ||
        left.attributes.id.localeCompare(right.attributes.id),
    )
    .at(-1)
  if (!evidence) return null

  const summary = evidence.body.trim()
  if (!summary) return null
  return {
    projectId,
    goalId,
    evidenceId: evidence.attributes.id,
    completedAt: evidence.attributes.createdAt,
    body: `## ${goal.title}\n\n${summary}`,
  }
}

export function projectAssistantOpenRequests(
  homeId: string,
  events: ReadonlyMap<string, InboxEventDocument>,
  attentions: readonly ScopedAssistantAttention[],
) {
  type OpenAttention = (typeof attentions)[number]
  const openByReference = new Map<string, OpenAttention>()
  for (const attention of attentions) {
    if (attention.resolvedAt !== null) continue
    const reference =
      attention.scope === 'goal'
        ? goalAttentionReference(attention.projectId, attention.goalId, attention.id)
        : workspaceAttentionReference(homeId, attention.id)
    openByReference.set(reference, attention)
  }
  const latestByAttention = new Map<
    string,
    { eventId: string; occurredAt: string; attention: OpenAttention }
  >()
  for (const event of [...events.values()].toSorted((left, right) =>
    left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
  )) {
    if (
      event.attributes.status !== 'handled' ||
      event.attributes.visibility !== 'public' ||
      !event.attributes.reply
    ) {
      continue
    }
    for (const reference of event.attributes.attentionRequest?.attentionRefs ?? []) {
      const attention = openByReference.get(reference)
      if (!attention) continue
      latestByAttention.set(reference, {
        eventId: event.attributes.id,
        occurredAt: event.attributes.receivedAt,
        attention,
      })
    }
  }

  const grouped = new Map<
    string,
    { eventId: string; occurredAt: string; attentions: OpenAttention[] }
  >()
  for (const entry of latestByAttention.values()) {
    const existing = grouped.get(entry.eventId)
    if (existing) {
      existing.attentions.push(entry.attention)
    } else {
      grouped.set(entry.eventId, {
        eventId: entry.eventId,
        occurredAt: entry.occurredAt,
        attentions: [entry.attention],
      })
    }
  }

  return [...grouped.values()]
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    )
    .map(({ eventId, attentions: groupedAttentions }) => ({
      eventId,
      attentions: groupedAttentions,
    }))
}

export type AssistantFeedRuntimeStatus =
  | 'queued'
  | 'running'
  | 'interrupted'
  | 'completed'
  | 'failed'

export function deriveAssistantFeedActivity(input: {
  publicStatuses: readonly AssistantFeedRuntimeStatus[]
  internalSpeakingRunning: boolean
  wakeRunning: boolean
}) {
  if (input.publicStatuses.includes('running')) return { phase: 'working' as const }
  if (input.internalSpeakingRunning || input.wakeRunning) {
    return { phase: 'thinking' as const }
  }
  if (input.publicStatuses.some((status) => status === 'queued' || status === 'interrupted')) {
    return { phase: 'waiting' as const }
  }
  return null
}

async function readAssistantFeedProjection(runtime: MvpRuntime, scope: AssistantConversationScope) {
  const [workspace, conversationEpoch] = await Promise.all([
    runtime.workspace.readWorkspace(),
    readAssistantConversationEpoch(runtime.homeRoot, scope),
  ])
  const { attentions, goalCompletions } = await readScopedAssistantProjection(
    runtime,
    scope,
    workspace,
  )
  const requests = projectAssistantOpenRequests(workspace.homeId, workspace.events, attentions)
  const workspaceEvents = [...workspace.events.values()]
  const requestEventIds = new Set(requests.map((request) => request.eventId))
  const publicEvents = workspaceEvents.filter(
    (event) =>
      event.attributes.visibility === 'public' &&
      (assistantEventBelongsToScope(event, scope) || requestEventIds.has(event.attributes.id)),
  )
  const internalSpeakingEvents = workspaceEvents.filter(
    (event) =>
      isInternalInboxSource(event.attributes.source) &&
      event.attributes.visibility === 'internal' &&
      event.attributes.status === 'pending' &&
      assistantEventBelongsToScope(event, scope),
  )
  const [eventStates, internalSpeakingTurns] = await Promise.all([
    Promise.all(
      publicEvents.map(async (event) => {
        if (event.attributes.status === 'handled') {
          return {
            event,
            turn: null,
            runtimeStatus: 'completed' as const,
            updatedAt: maxTimestamp(event.attributes.receivedAt, event.attributes.handledAt),
          }
        }
        const turn = await runtime.assistantConversation.readTurn(event.attributes.id)
        return {
          event,
          turn,
          runtimeStatus: turn?.manifest.status ?? ('queued' as const),
          updatedAt: maxTimestamp(
            event.attributes.receivedAt,
            turn?.manifest.updatedAt,
            turn?.events.at(-1)?.createdAt,
          ),
        }
      }),
    ),
    Promise.all(
      internalSpeakingEvents.map((event) =>
        runtime.assistantConversation.readTurn(event.attributes.id),
      ),
    ),
  ])
  const eventEntries = eventStates.map((state) => ({
    kind: 'event' as const,
    id: `event:${state.event.attributes.id}`,
    occurredAt: state.event.attributes.receivedAt,
    updatedAt: state.updatedAt,
    event: state.event,
    turn: state.turn,
    runtimeStatus: state.runtimeStatus,
  }))
  const removals = conversationEpoch.resetAt
    ? conversationEpoch.removedFeedEntryIds.map((id) => ({
        id,
        updatedAt: conversationEpoch.resetAt as string,
      }))
    : []
  const allEntries = [
    ...eventEntries,
    ...goalCompletions.map((completion) => ({
      kind: 'goal_completion' as const,
      id: `goal-completion:project:${completion.projectId}/goal:${completion.goalId}/evidence:${completion.evidenceId}`,
      occurredAt: completion.completedAt,
      updatedAt: completion.completedAt,
      completion,
    })),
  ].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id),
  )
  return {
    entries: allEntries,
    removals,
    requests,
    activity: deriveAssistantFeedActivity({
      publicStatuses: eventStates.map((state) => state.runtimeStatus),
      internalSpeakingRunning: internalSpeakingTurns.some(
        (turn) => turn?.manifest.status === 'running',
      ),
      wakeRunning: scope.kind === 'home' && runtime.wake.isActive(),
    }),
    syncCursor: [
      ...allEntries.map(({ updatedAt }) => updatedAt),
      ...(conversationEpoch.resetAt ? [conversationEpoch.resetAt] : []),
    ].reduce<string | null>(
      (latest, timestamp) =>
        !latest || Date.parse(timestamp) > Date.parse(latest) ? timestamp : latest,
      null,
    ),
    streamId: `${conversationEpoch.streamId}:projection:${ASSISTANT_FEED_PROJECTION_VERSION}`,
  }
}

async function readScopedAssistantProjection(
  runtime: MvpRuntime,
  scope: AssistantConversationScope,
  workspace: Awaited<ReturnType<MvpRuntime['workspace']['readWorkspace']>>,
): Promise<{
  attentions: ScopedAssistantAttention[]
  goalCompletions: ScopedGoalCompletion[]
}> {
  if (scope.kind === 'home') {
    return {
      attentions: [...workspace.attentions.values()]
        .filter((attention) => workspaceAttentionProjectId(attention) === null)
        .map((attention) => presentWorkspaceAttention(attention)),
      goalCompletions: [],
    }
  }

  const project = requireProject(runtime.projects, scope.projectId)
  const attentions: ScopedAssistantAttention[] = [...workspace.attentions.values()]
    .filter((attention) => workspaceAttentionProjectId(attention) === scope.projectId)
    .map((attention) => presentWorkspaceAttention(attention, scope.projectId))
  const goalCompletions: ScopedGoalCompletion[] = []
  for (const goalId of await project.store.listGoalIds()) {
    try {
      const goalPackage = await project.store.readPackage(goalId)
      attentions.push(...presentGoalAttentions(project.projectId, goalId, goalPackage))
      const completion = goalCompletionProjection(project.projectId, goalId, goalPackage)
      if (completion) goalCompletions.push(completion)
    } catch (error) {
      console.error(`[assistant projection failed] ${project.projectId}/${goalId}`, error)
    }
  }
  return { attentions, goalCompletions }
}

type AssistantFeedProjectionEntry = Awaited<
  ReturnType<typeof readAssistantFeedProjection>
>['entries'][number]

async function presentAssistantFeedEntry(runtime: MvpRuntime, entry: AssistantFeedProjectionEntry) {
  if (entry.kind === 'goal_completion') {
    return {
      kind: entry.kind,
      id: entry.id,
      occurredAt: entry.occurredAt,
      completion: entry.completion,
    }
  }
  const turn =
    entry.turn ?? (await runtime.assistantConversation.readTurn(entry.event.attributes.id))
  return {
    kind: entry.kind,
    id: entry.id,
    occurredAt: entry.occurredAt,
    event: {
      ...entry.event.attributes,
      attachments: await presentInboxAttachments(runtime, entry.event.attributes.attachments),
      context: entry.event.attributes.context ?? null,
      body: entry.event.body,
      runtimeStatus: entry.runtimeStatus,
      runtimeEvents: (turn?.events ?? []).filter(isPresentableAgentRuntimeEvent),
      runtimeError: turn?.manifest.error ?? null,
    },
  }
}

async function presentInboxAttachments(runtime: MvpRuntime, references: readonly string[]) {
  const attachments = []
  for (const reference of references) {
    const attachment = await runtime.workspace.resolveAttachment(reference)
    if (!attachment) continue
    attachments.push({
      reference,
      fileName: attachment.fileName,
      mediaType: attachment.mediaType,
      sizeBytes: attachment.sizeBytes,
      url: `/api/assistant/attachments/${encodeURIComponent(attachment.contentHash)}/${encodeURIComponent(attachment.fileName)}`,
    })
  }
  return attachments
}

function maxTimestamp(...values: Array<string | null | undefined>) {
  const present = values.filter((value): value is string => Boolean(value))
  if (present.length === 0) throw new Error('Assistant feed entry has no timestamp')
  return present.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  )
}
