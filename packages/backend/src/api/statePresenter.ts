import { join } from 'node:path'
import type { ConfigurableAgentRole } from '../agent/adapterConfig'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import { workspaceAttentionProjectId } from '../domain/assistantWorkspaceDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import type { MvpRuntime } from '../runtime/mvpRuntime'
import { deriveRunSchedulingFacts } from '../runtime/runAttemptStore'
import { settledFailureWorkIds } from '../runtime/settledAttemptFailure'
import {
  type ScopedAssistantAttention,
  goalCompletionProjection,
  presentGoalAttentions,
  presentWorkspaceAttention,
  projectAssistantOpenRequests,
} from './assistantFeedPresenter'
import { attemptWorkIds, deriveGoalSummaries, presentActiveAttempt } from './goalPresenter'
import { CONFIGURABLE_AGENT_ROLES } from './requestSchemas'

export async function presentState(
  runtime: MvpRuntime,
  options: { includeAttentions?: boolean } = {},
) {
  const includeAttentions = options.includeAttentions ?? true
  const [home, workspace, agentRoleSettingEntries, attemptSnapshot] = await Promise.all([
    runtime.home.readHome(),
    runtime.workspace.readWorkspaceForControl(),
    Promise.all(
      CONFIGURABLE_AGENT_ROLES.map(
        async (role) => [role, await runtime.readAgentRoleCodingDefaults(role)] as const,
      ),
    ),
    runtime.attempts.snapshot(),
  ])
  const runningAttempts = attemptSnapshot.running()
  const queuedAttempts = attemptSnapshot.queued()
  const agentRoleSettings = Object.fromEntries(agentRoleSettingEntries) as Record<
    ConfigurableAgentRole,
    Awaited<ReturnType<MvpRuntime['readAgentRoleCodingDefaults']>>
  >
  const projects = []
  const goalAttentions = []
  for (const project of runtime.projects.values()) {
    const projectAttentions = [...workspace.attentions.values()].filter(
      (attention) =>
        workspaceAttentionProjectId(attention) === project.projectId &&
        attention.attributes.resolvedAt === null,
    )
    const projectAssistantAttentions: ScopedAssistantAttention[] = projectAttentions.map(
      (attention) => presentWorkspaceAttention(attention, project.projectId),
    )
    const goals = []
    let goalOpenAttentionCount = 0
    const readableGoalPackages: Array<{
      goalId: string
      goalPackage: GoalPackage
    }> = []
    let validationError: string | null = null
    try {
      for (const [goalId, goalPackage] of await project.store.readReconciliationSnapshot()) {
        readableGoalPackages.push({ goalId, goalPackage })
      }
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error)
      console.error(`[state projection failed] ${project.projectId}`, error)
    }
    for (const { goalId, goalPackage } of readableGoalPackages) {
      const relatedProjectAttentions = projectAttentions.filter((attention) =>
        attentionReferencesGoal(attention.attributes.refs, goalId),
      )
      const liveWorkIds = new Set(
        runningAttempts
          .filter((attempt) => attempt.projectId === project.projectId && attempt.goalId === goalId)
          .map((attempt) => attempt.workId),
      )
      const projections = deriveGoalWorkProjections(project.projectId, goalId, goalPackage, {
        projectEligible: true,
        liveRunWorkIds: liveWorkIds,
        settledFailureWorkIds: await settledFailureWorkIds(
          goalPackage,
          attemptSnapshot.listGoal(project.projectId, goalId),
          attemptWorkIds(queuedAttempts, project.projectId, goalId),
        ),
        passCapacity: { planner: true, generator: true, reviewer: true },
        ...deriveRunSchedulingFacts(
          [...attemptSnapshot.listGoal(project.projectId, goalId).values()].flat(),
        ),
      })
      const summaries = deriveGoalSummaries(goalPackage, projections)
      const goalAttentionCount = [...goalPackage.attentions.values()].filter(
        (attention) => attention.attributes.resolvedAt === null,
      ).length
      const openAttentionCount = goalAttentionCount + relatedProjectAttentions.length
      goalOpenAttentionCount += goalAttentionCount
      const completion = goalCompletionProjection(project.projectId, goalId, goalPackage)
      goals.push({
        id: goalId,
        title: goalPackage.goal.attributes.title,
        createdAt: goalCreatedAt(goalPackage, workspace.events),
        lifecycle: goalPackage.goal.attributes.lifecycle,
        priority: goalPackage.goal.attributes.priority,
        ...summaries,
        openAttentionCount,
        completion: completion
          ? { id: completion.evidenceId, completedAt: completion.completedAt }
          : null,
      })
      if (includeAttentions) {
        goalAttentions.push(...presentGoalAttentions(project.projectId, goalId, goalPackage))
      }
    }
    const needsYouCount = projectAssistantOpenRequests(
      workspace.homeId,
      workspace.events,
      projectAssistantAttentions,
    ).reduce((count, request) => count + request.attentions.length, 0)
    projects.push({
      projectId: project.projectId,
      ...(project.label ? { label: project.label } : {}),
      primaryRepoId: project.primaryRepoId,
      repos: project.repos.map((repo) => ({
        repoId: repo.repoId,
        repoPath: repo.repoPath,
        projectPath: repo.projectPath,
        integrationRoot: repo.integrationRoot,
        primary: repo.primary,
      })),
      repoPath: project.repoPath,
      projectPath: project.projectPath,
      guidance: await readProjectGuidance(project.sourceRoot),
      preview: runtime.preview.inspect(project.projectId),
      validationError,
      openAttentionCount: goalOpenAttentionCount + projectAttentions.length,
      needsYouCount,
      goals,
    })
  }
  return {
    home: {
      ...home,
      agentRoleCodingDefaults: agentRoleSettings,
    },
    projects,
    attentions: includeAttentions
      ? [
          ...[...workspace.attentions.values()].map((attention) =>
            presentWorkspaceAttention(attention),
          ),
          ...goalAttentions,
        ]
      : [],
    activeRuns: [...runningAttempts, ...queuedAttempts].map((attempt) =>
      presentActiveAttempt(attempt, runningAttempts, runtime.concurrency),
    ),
  }
}

function attentionReferencesGoal(refs: readonly string[], goalId: string) {
  return refs.some(
    (reference) =>
      reference === goalId ||
      reference.split('/').includes(`goal:${goalId}`) ||
      reference.includes(`/goals/${goalId}/`),
  )
}

function goalCreatedAt(goalPackage: GoalPackage, events: ReadonlyMap<string, InboxEventDocument>) {
  let earliest: { value: string; timestamp: number } | null = null
  for (const input of goalPackage.inputs.values()) {
    const receivedAt = events.get(input.attributes.sourceEventId)?.attributes.receivedAt
    const inputTimestamp = receivedAt ? Date.parse(receivedAt) : Number.NaN
    if (
      receivedAt &&
      Number.isFinite(inputTimestamp) &&
      (!earliest || inputTimestamp < earliest.timestamp)
    ) {
      earliest = { value: receivedAt, timestamp: inputTimestamp }
    }
  }
  return earliest?.value ?? null
}

async function readProjectGuidance(projectRoot: string) {
  const file = Bun.file(join(projectRoot, 'AGENTS.md'))
  return (await file.exists()) ? await file.text() : null
}
