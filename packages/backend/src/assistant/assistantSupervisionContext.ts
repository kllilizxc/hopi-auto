import type {
  AssistantStateGoalSnapshot,
  AssistantStateRuntime,
  AssistantStateSnapshot,
  AssistantStateWorkSnapshot,
} from './assistantState'

export function assistantMaterialWakeKeys(snapshot: AssistantStateSnapshot) {
  const keys: string[] = []
  for (const attention of snapshot.workspaceAttentions) {
    if (attention.resolvedAt !== null) continue
    keys.push(`workspace-attention:${attention.id}:${attention.updatedAt}`)
  }

  for (const project of snapshot.projects) {
    const projectId = project.projectId
    if (project.available === false) {
      keys.push(`project-unavailable:${projectId}:${project.error ?? ''}`)
    }
    for (const goal of project.goals) {
      const goalId = goal.goal.attributes.id
      const lifecycle = goal.goal.attributes.lifecycle
      if (lifecycle !== 'active') {
        keys.push(
          `goal:${projectId}:${goalId}:${lifecycle}:${goal.goal.attributes.contractRevision}`,
        )
      }
      for (const attention of goal.attentions) {
        if (attention.attributes.resolvedAt !== null) continue
        keys.push(
          `goal-attention:${projectId}:${goalId}:${attention.attributes.id}:${attention.attributes.createdAt}`,
        )
      }
      for (const work of goal.works) {
        const workId = work.attributes.id
        collectRuntimeWakeKeys(keys, projectId, goalId, work, workId)
        const status = work.attributes.status
        if (status === 'done' || status === 'cancelled') {
          keys.push(`work-terminal:${projectId}:${goalId}:${workId}:${status}`)
        }
      }
    }
  }
  return [...new Set(keys)].toSorted()
}

export function assistantSupervisionProjection(snapshot: AssistantStateSnapshot) {
  return {
    observedAt: snapshot.observedAt,
    observedDigest: snapshot.stateDigest,
    materialFacts: assistantMaterialWakeKeys(snapshot),
    unresolvedAttention: snapshot.workspaceAttentions,
    activeRuns: snapshot.activeRuns,
    projects: snapshot.projects.map((project) => ({
      projectId: project.projectId,
      available: project.available,
      releaseHead: project.releaseHead,
      ...(project.error ? { error: project.error } : {}),
      goals: project.goals.map(compactGoal),
    })),
  }
}

function collectRuntimeWakeKeys(
  keys: string[],
  projectId: string,
  goalId: string,
  value: { runtime: AssistantStateRuntime } | null,
  workId: string,
) {
  if (!value) return
  const latestTerminal = value.runtime.recentAttempts.find(
    (attempt) => attempt.status === 'settled' && attempt.termination !== null,
  )
  if (latestTerminal) {
    keys.push(
      `attempt:${projectId}:${goalId}:${workId}:${latestTerminal.runId}:${latestTerminal.termination ?? ''}`,
    )
  }
  if (value.runtime.stale) {
    keys.push(`stale:${projectId}:${goalId}:${workId}:${value.runtime.latestAttempt?.runId ?? ''}`)
  }
}

function compactGoal(goal: AssistantStateGoalSnapshot) {
  return {
    goal: {
      attributes: goal.goal.attributes,
      path: goal.goal.path,
      body: boundedText(goal.goal.body, 4_000),
    },
    acceptedInputs: goal.acceptedInputs.map((acceptedInput) => ({
      attributes: acceptedInput.attributes,
      path: acceptedInput.path,
      acceptedInput: boundedText(acceptedInput.body, 4_000),
    })),
    design: goal.design.map((document) => ({
      ...document,
      excerpt: boundedText(document.excerpt, 4_000),
    })),
    attentions: goal.attentions,
    works: goal.works.map(compactWork),
  }
}

function compactWork(value: AssistantStateWorkSnapshot) {
  return {
    attributes: value.attributes,
    path: value.path,
    ...('projection' in value && value.projection ? { projection: value.projection } : {}),
    ...('candidateIntegration' in value && value.candidateIntegration
      ? { candidateIntegration: value.candidateIntegration }
      : {}),
    runtime: {
      active: value.runtime.active,
      attemptCount: value.runtime.attemptCount,
      stale: value.runtime.stale,
      lastActivityAt: value.runtime.lastActivityAt,
      latestAttempt: value.runtime.latestAttempt,
      recentAttempts: value.runtime.recentAttempts,
      paths: value.runtime.paths,
    },
  }
}

function boundedText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}\n[content omitted; inspect the canonical path for the full document]`
}
