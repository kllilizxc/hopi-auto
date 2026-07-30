import {
  type InboxEventDocument,
  isInternalInboxSource,
} from '../domain/assistantWorkspaceDocuments'
import type { LinkedProject } from '../domain/project'
import {
  type AssistantConversationScope,
  assistantEventBelongsToScope,
} from './assistantConversationScope'
import type {
  AssistantStateEvidenceDetail,
  AssistantStateGoalSnapshot,
  AssistantStatePlanningOutcome,
  AssistantStateProjectSnapshot,
  AssistantStateRuntime,
  AssistantStateSnapshot,
  AssistantStateWorkSnapshot,
  AssistantStateWorkspaceAttention,
} from './assistantState'

export function assistantStateProjection(
  snapshot: AssistantStateSnapshot,
  scope: { projectId?: string; goalId?: string } = {},
) {
  const { conversationDigests: _conversationDigests, ...publicSnapshot } = snapshot
  return {
    ...publicSnapshot,
    workspaceAttentions: scope.projectId
      ? snapshot.workspaceAttentions.filter((attention) => attention.projectId === scope.projectId)
      : snapshot.workspaceAttentions.map(compactWorkspaceAttentionIndex),
    projects: snapshot.projects.map(compactProjectStateIndex),
  }
}

export function readPublicConversationPage(
  events: readonly InboxEventDocument[],
  scope: AssistantConversationScope,
  input: { query?: string; before?: string; limit: number },
) {
  const query = input.query?.toLocaleLowerCase()
  const matching = events
    .filter(
      (event) =>
        event.attributes.status === 'handled' &&
        event.attributes.visibility === 'public' &&
        assistantEventBelongsToScope(event, scope),
    )
    .map((event) => ({ event, cursor: conversationCursor(event) }))
    .filter(({ cursor }) => !input.before || cursor < input.before)
    .filter(({ event }) => {
      if (!query) return true
      const text = isInternalInboxSource(event.attributes.source)
        ? (event.attributes.reply ?? '')
        : `${event.body}\n${event.attributes.reply ?? ''}`
      return text.toLocaleLowerCase().includes(query)
    })
    .toSorted((left, right) => left.cursor.localeCompare(right.cursor))
  const selected = matching.slice(-input.limit)
  return {
    exchanges: selected.map(({ event, cursor }) => ({
      cursor,
      eventId: event.attributes.id,
      receivedAt: event.attributes.receivedAt,
      source: event.attributes.source,
      ...(event.attributes.source === 'user' ? { user: boundedConversationText(event.body) } : {}),
      assistant: boundedConversationText(event.attributes.reply ?? ''),
    })),
    nextBefore: matching.length > selected.length && selected[0] ? selected[0].cursor : null,
  }
}

export function presentProjectTopology(project: LinkedProject) {
  return {
    projectId: project.projectId,
    ...(project.label ? { label: project.label } : {}),
    ...projectTopology(project),
  }
}

export function sameProjectTopology(left: LinkedProject | undefined, right: LinkedProject) {
  return Boolean(left && sameValue(projectTopology(left), projectTopology(right)))
}

function compactWorkspaceAttentionIndex(value: AssistantStateWorkspaceAttention) {
  const { body, ...rest } = value
  return { ...rest, creationRationale: boundedStateText(body, 320) }
}

function compactProjectStateIndex(value: AssistantStateProjectSnapshot) {
  return {
    projectId: value.projectId,
    ...(value.label ? { label: value.label } : {}),
    primaryRepoId: value.primaryRepoId,
    available: value.available,
    releaseHead: value.releaseHead,
    repos: value.repos.map(compactRepoStateIndex),
    goals: value.goals.map(compactGoalStateIndex),
  }
}

function compactRepoStateIndex(value: AssistantStateProjectSnapshot['repos'][number]) {
  return {
    repoId: value.repoId,
    projectPath: value.projectPath,
    primary: value.primary,
  }
}

function compactGoalStateIndex(value: AssistantStateGoalSnapshot) {
  return {
    goal: compactDocumentStateIndex(value.goal),
    design: value.design.map(compactDesignStateIndex),
    attentions: value.attentions.map(compactGoalAttentionStateIndex),
    latestPlanningOutcome:
      value.latestPlanningOutcome === null
        ? null
        : compactWorkStateIndex(value.latestPlanningOutcome, false),
    works: value.works.map((work) => compactWorkStateIndex(work, true)),
  }
}

function compactDesignStateIndex(value: AssistantStateGoalSnapshot['design'][number]) {
  return {
    canonicalPath: value.canonicalPath,
    path: value.path,
    hash: value.hash,
    excerpt: boundedStateText(value.excerpt, 4_000),
  }
}

function compactDocumentStateIndex(value: AssistantStateGoalSnapshot['goal']) {
  return {
    attributes: value.attributes,
    path: value.path,
  }
}

function compactGoalAttentionStateIndex(value: AssistantStateGoalSnapshot['attentions'][number]) {
  return {
    reference: value.reference,
    attributes: value.attributes,
    creationRationale: boundedStateText(value.body, 600),
    path: value.path,
  }
}

function compactWorkStateIndex(
  value: AssistantStateWorkSnapshot | AssistantStatePlanningOutcome,
  includeSummary: boolean,
) {
  return {
    attributes: value.attributes,
    path: value.path,
    ...('projection' in value && value.projection ? { projection: value.projection } : {}),
    ...('candidateIntegration' in value && value.candidateIntegration
      ? { currentCandidateIntegration: value.candidateIntegration }
      : {}),
    ...(Array.isArray(value.evidence)
      ? { evidence: value.evidence.map(compactEvidenceStateIndex) }
      : value.evidence
        ? { evidence: value.evidence }
        : {}),
    runtime: compactRuntimeStateIndex(value.runtime, includeSummary),
  }
}

function compactEvidenceStateIndex(value: AssistantStateEvidenceDetail) {
  const { body, ...rest } = value
  return { ...rest, historicalResult: body }
}

function compactRuntimeStateIndex(value: AssistantStateRuntime, includeSummary: boolean) {
  const latestAttempt = value.latestAttempt
    ? {
        runId: value.latestAttempt.runId,
        responsibility: value.latestAttempt.responsibility,
        status: value.latestAttempt.status,
        result: value.latestAttempt.result,
        application: value.latestAttempt.application,
        ...(includeSummary && value.latestAttempt.summary
          ? { summary: boundedStateText(value.latestAttempt.summary, 500) }
          : {}),
      }
    : null
  return {
    activeResponsibility: value.activeResponsibility,
    latestAttempt,
    attemptCount: value.attemptCount,
    recentAttempts: value.recentAttempts.slice(0, 3).map((attempt) => ({
      runId: attempt.runId,
      responsibility: attempt.responsibility,
      status: attempt.status,
      result: attempt.result,
      application: attempt.application,
      startedAt: attempt.startedAt,
      endedAt: attempt.endedAt,
      ...(includeSummary && attempt.summary
        ? { summary: boundedStateText(attempt.summary, 240) }
        : {}),
      artifactPreservation: attempt.artifactPreservation,
    })),
    lastActivityAt: value.lastActivityAt,
    stale: value.stale,
    paths: value.paths,
  }
}

function conversationCursor(event: InboxEventDocument) {
  return `${event.attributes.receivedAt}|${event.attributes.id}`
}

function boundedConversationText(value: string) {
  const limit = 2_000
  return value.length <= limit ? value : `${value.slice(0, limit)}\n[…truncated]`
}

function boundedStateText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

function projectTopology(project: LinkedProject) {
  return {
    primaryRepoId: project.primaryRepoId,
    repos: project.repos
      .map((repo) => ({
        repoId: repo.repoId,
        repoPath: repo.repoPath,
        projectPath: repo.projectPath,
        primary: repo.primary,
      }))
      .toSorted((left, right) => left.repoId.localeCompare(right.repoId)),
  }
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
