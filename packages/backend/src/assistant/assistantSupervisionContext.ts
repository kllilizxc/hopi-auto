import type { AssistantStateSnapshot } from './assistantState'

export function assistantMaterialWakeKeys(snapshot: AssistantStateSnapshot) {
  const keys: string[] = []
  for (const attention of snapshot.workspaceAttentions) {
    if (!isRecord(attention)) continue
    const attributes = isRecord(attention.attributes) ? attention.attributes : attention
    if (attributes.resolvedAt !== null) continue
    keys.push(
      `workspace-attention:${String(attributes.id ?? '')}:${String(attributes.updatedAt ?? attributes.createdAt ?? '')}`,
    )
  }

  for (const project of snapshot.projects) {
    if (!isRecord(project)) continue
    const projectId = String(project.projectId ?? '')
    if (project.available === false) {
      keys.push(`project-unavailable:${projectId}:${String(project.error ?? '')}`)
    }
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalDocument = isRecord(goal.goal) ? goal.goal : null
      const goalAttributes =
        goalDocument && isRecord(goalDocument.attributes) ? goalDocument.attributes : null
      const goalId = String(goalAttributes?.id ?? '')
      const lifecycle = String(goalAttributes?.lifecycle ?? '')
      if (lifecycle && lifecycle !== 'active') {
        keys.push(
          `goal:${projectId}:${goalId}:${lifecycle}:${String(goalAttributes?.contractRevision ?? '')}`,
        )
      }
      if (Array.isArray(goal.attentions)) {
        for (const attention of goal.attentions) {
          if (!isRecord(attention)) continue
          const attributes = isRecord(attention.attributes) ? attention.attributes : attention
          if (attributes.resolvedAt !== null) continue
          keys.push(
            `goal-attention:${projectId}:${goalId}:${String(attributes.id ?? '')}:${String(attributes.updatedAt ?? attributes.createdAt ?? '')}`,
          )
        }
      }
      collectRuntimeWakeKeys(keys, projectId, goalId, goal.latestPlanningOutcome)
      if (!Array.isArray(goal.works)) continue
      for (const work of goal.works) {
        if (!isRecord(work)) continue
        const attributes = isRecord(work.attributes) ? work.attributes : null
        const workId = String(attributes?.id ?? '')
        collectRuntimeWakeKeys(keys, projectId, goalId, work, workId)
        const stage = String(attributes?.stage ?? '')
        if (stage === 'done' || stage === 'cancelled') {
          keys.push(`work-terminal:${projectId}:${goalId}:${workId}:${stage}`)
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
    projects: snapshot.projects.map((project) => {
      if (!isRecord(project)) return project
      return {
        projectId: project.projectId,
        available: project.available,
        releaseHead: project.releaseHead,
        ...(project.error ? { error: project.error } : {}),
        ...(Array.isArray(project.goals)
          ? {
              goals: project.goals.map((goal) => {
                if (!isRecord(goal)) return goal
                return {
                  goal: compactDocument(goal.goal, 4_000),
                  design: Array.isArray(goal.design)
                    ? goal.design.map((document) => compactDocument(document, 4_000))
                    : [],
                  attentions: goal.attentions,
                  latestPlanningOutcome: compactWork(goal.latestPlanningOutcome),
                  works: Array.isArray(goal.works) ? goal.works.map(compactWork) : [],
                }
              }),
            }
          : { goals: [] }),
      }
    }),
  }
}

function collectRuntimeWakeKeys(
  keys: string[],
  projectId: string,
  goalId: string,
  value: unknown,
  workId = 'planning',
) {
  if (!isRecord(value) || !isRecord(value.runtime)) return
  const runtime = value.runtime
  const attempts = Array.isArray(runtime.recentAttempts) ? runtime.recentAttempts : []
  const latestTerminal = attempts.find(
    (attempt) => isRecord(attempt) && attempt.status === 'finished' && attempt.result !== null,
  )
  if (isRecord(latestTerminal) && typeof latestTerminal.runId === 'string') {
    keys.push(
      `attempt:${projectId}:${goalId}:${workId}:${latestTerminal.runId}:${String(latestTerminal.result ?? '')}:${String(latestTerminal.application ?? '')}`,
    )
  }
  if (runtime.stale === true) {
    const latest = isRecord(runtime.latestAttempt) ? runtime.latestAttempt : null
    keys.push(`stale:${projectId}:${goalId}:${workId}:${String(latest?.runId ?? '')}`)
  }
}

function compactDocument(value: unknown, bodyLimit: number) {
  if (!isRecord(value)) return value
  return {
    ...(value.attributes ? { attributes: value.attributes } : {}),
    ...(value.path ? { path: value.path } : {}),
    ...(typeof value.body === 'string' ? { body: boundedText(value.body, bodyLimit) } : {}),
    ...(typeof value.content === 'string'
      ? { content: boundedText(value.content, bodyLimit) }
      : {}),
  }
}

function compactWork(value: unknown) {
  if (!isRecord(value)) return value
  const runtime = isRecord(value.runtime) ? value.runtime : null
  const projection = isRecord(value.projection) ? value.projection : null
  const failedPredicates = Array.isArray(projection?.failedPredicates)
    ? projection.failedPredicates
    : []
  return {
    attributes: value.attributes,
    path: value.path,
    ...(projection ? { projection } : {}),
    ...(failedPredicates.includes('failed_attempt')
      ? {
          schedulingEffect: {
            state: 'waiting_for_assistant',
            unchangedWorkRedispatch: 'blocked',
          },
        }
      : {}),
    ...(value.candidateIntegration ? { candidateIntegration: value.candidateIntegration } : {}),
    ...(runtime
      ? {
          runtime: {
            activeResponsibility: runtime.activeResponsibility,
            attemptCount: runtime.attemptCount,
            stale: runtime.stale,
            lastActivityAt: runtime.lastActivityAt,
            latestAttempt: runtime.latestAttempt,
            recentAttempts: runtime.recentAttempts,
            paths: runtime.paths,
          },
        }
      : {}),
  }
}

function boundedText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit).trimEnd()}\n[content omitted; inspect the canonical path for the full document]`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
