import { createHash } from 'node:crypto'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import { workspaceAttentionProjectId } from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  parseAttentionReference,
  workspaceAttentionReference,
} from '../domain/attentionReference'
import { parseProjectAttentionTarget, parseWorkAttentionTarget } from '../domain/attentionTarget'
import type { AssistantStateSnapshot } from './assistantState'

export type AssistantResponsibilityScope = { kind: 'home' } | { kind: 'project'; projectId: string }

export interface AssistantResponsibilityState {
  assistantOwned: boolean
  hasDurableSuccessor: boolean
  fingerprint: string
}

export function actionableAssistantAttentionReferences(
  scope: AssistantResponsibilityScope,
  state: AssistantStateSnapshot,
  workspace: AssistantWorkspace,
  currentTime: number,
) {
  const references: string[] = []
  for (const attention of workspace.attentions.values()) {
    const projectId = workspaceAttentionProjectId(attention)
    if (
      attention.attributes.resolvedAt !== null ||
      (attention.attributes.operatorRequest ?? null) !== null ||
      hasFutureRevisit(attention.attributes.revisitAt ?? null, currentTime) ||
      (scope.kind === 'home' ? projectId !== null : projectId !== scope.projectId)
    ) {
      continue
    }
    references.push(workspaceAttentionReference(workspace.homeId, attention.attributes.id))
  }
  if (scope.kind === 'project') {
    for (const project of state.projects) {
      if (
        !isRecord(project) ||
        project.projectId !== scope.projectId ||
        !Array.isArray(project.goals)
      ) {
        continue
      }
      for (const goal of project.goals) {
        if (!isRecord(goal) || !Array.isArray(goal.attentions)) continue
        const goalId = goalStateId(goal)
        if (!goalId) continue
        for (const attention of goal.attentions) {
          if (!isRecord(attention) || !isRecord(attention.attributes)) continue
          const attributes = attention.attributes
          const attentionId = typeof attributes.id === 'string' ? attributes.id : null
          if (
            !attentionId ||
            attributes.resolvedAt !== null ||
            (attributes.operatorRequest ?? null) !== null ||
            hasFutureRevisit(
              typeof attributes.revisitAt === 'string' ? attributes.revisitAt : null,
              currentTime,
            )
          ) {
            continue
          }
          references.push(goalAttentionReference(scope.projectId, goalId, attentionId))
        }
      }
    }
  }
  return [...new Set(references)]
    .filter((reference) => {
      const responsibility = assistantResponsibilityState(reference, state, workspace)
      return responsibility?.assistantOwned && !responsibility.hasDurableSuccessor
    })
    .toSorted()
}

export function assistantResponsibilityState(
  reference: string,
  state: AssistantStateSnapshot,
  workspace: AssistantWorkspace,
): AssistantResponsibilityState | null {
  const parsed = parseAttentionReference(reference)
  if (!parsed) return null
  if (parsed.scope === 'workspace') {
    if (parsed.homeId !== workspace.homeId) return null
    const attention = workspace.attentions.get(parsed.attentionId)
    if (!attention) return null
    const projectTarget = parseProjectAttentionTarget(attention.attributes.target)
    const project = projectTarget
      ? state.projects.find(
          (candidate) => isRecord(candidate) && candidate.projectId === projectTarget.projectId,
        )
      : null
    const hasProjectSuccessor = Boolean(
      projectTarget &&
        (state.activeRuns.some((run) => run.projectId === projectTarget.projectId) ||
          projectHasQueuedOrRunningWork(project)),
    )
    return {
      assistantOwned:
        attention.attributes.resolvedAt === null &&
        (attention.attributes.operatorRequest ?? null) === null,
      hasDurableSuccessor: hasProjectSuccessor,
      fingerprint: responsibilityFingerprint({
        attention: {
          attributes: responsibilityAttentionAttributes(attention.attributes),
          body: attention.body,
        },
        project,
      }),
    }
  }

  const project = state.projects.find(
    (candidate) => isRecord(candidate) && candidate.projectId === parsed.projectId,
  )
  if (!isRecord(project) || !Array.isArray(project.goals)) return null
  const goal = project.goals.find(
    (candidate) => isRecord(candidate) && goalStateId(candidate) === parsed.goalId,
  )
  if (!isRecord(goal) || !Array.isArray(goal.attentions)) return null
  const attention = goal.attentions.find(
    (candidate) =>
      isRecord(candidate) &&
      ((typeof candidate.reference === 'string' && candidate.reference === reference) ||
        (isRecord(candidate.attributes) && candidate.attributes.id === parsed.attentionId)),
  )
  if (!isRecord(attention) || !isRecord(attention.attributes)) return null
  const target =
    typeof attention.attributes.target === 'string'
      ? parseWorkAttentionTarget(attention.attributes.target)
      : null
  const work =
    target &&
    target.projectId === parsed.projectId &&
    target.goalId === parsed.goalId &&
    Array.isArray(goal.works)
      ? goal.works.find(
          (candidate) =>
            isRecord(candidate) &&
            isRecord(candidate.attributes) &&
            candidate.attributes.id === target.workId,
        )
      : null
  const latestAttempt =
    isRecord(work) && isRecord(work.runtime) && isRecord(work.runtime.latestAttempt)
      ? work.runtime.latestAttempt
      : null
  return {
    assistantOwned:
      attention.attributes.resolvedAt === null &&
      (attention.attributes.operatorRequest ?? null) === null,
    hasDurableSuccessor:
      Boolean(
        target &&
          state.activeRuns.some(
            (run) =>
              run.projectId === target.projectId &&
              run.goalId === target.goalId &&
              run.workId === target.workId,
          ),
      ) ||
      state.delegations.some(
        (delegation) =>
          delegation.sourceAttentionRefs.includes(reference) && delegation.activeRun !== null,
      ) ||
      latestAttempt?.status === 'queued' ||
      latestAttempt?.status === 'running',
    fingerprint: responsibilityFingerprint({
      attention: {
        ...attention,
        attributes: responsibilityAttentionAttributes(attention.attributes),
      },
      subject: work ?? goal,
    }),
  }
}

function projectHasQueuedOrRunningWork(project: unknown) {
  if (!isRecord(project) || !Array.isArray(project.goals)) return false
  return project.goals.some(
    (goal) =>
      isRecord(goal) &&
      Array.isArray(goal.works) &&
      goal.works.some((work) => {
        if (!isRecord(work) || !isRecord(work.runtime) || !isRecord(work.runtime.latestAttempt)) {
          return false
        }
        return (
          work.runtime.latestAttempt.status === 'queued' ||
          work.runtime.latestAttempt.status === 'running'
        )
      }),
  )
}

function responsibilityAttentionAttributes(attributes: Record<string, unknown>) {
  const { notifiedAt: _notifiedAt, updatedAt: _updatedAt, ...responsibilityAttributes } = attributes
  return responsibilityAttributes
}

function responsibilityFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function goalStateId(goal: Record<string, unknown>) {
  if (typeof goal.goalId === 'string') return goal.goalId
  if (!isRecord(goal.goal) || !isRecord(goal.goal.attributes)) return null
  return typeof goal.goal.attributes.id === 'string' ? goal.goal.attributes.id : null
}

function hasFutureRevisit(revisitAt: string | null, currentTime: number) {
  if (!revisitAt) return false
  const timestamp = Date.parse(revisitAt)
  return !Number.isNaN(timestamp) && timestamp > currentTime
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
