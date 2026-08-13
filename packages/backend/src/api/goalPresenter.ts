import type { AgentPlanEvent, AgentRuntimeEvent } from '../agent/runtimeEvents'
import { workspaceAttentionProjectId } from '../domain/assistantWorkspaceDocuments'
import { workAttentionTarget } from '../domain/attentionTarget'
import type { WorkDocument } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { WorkProjection } from '../domain/workProjection'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import { type MvpProjectRuntime, type MvpRuntime, requireProject } from '../runtime/mvpRuntime'
import { type RunAttemptSummary, deriveRunSchedulingFacts } from '../runtime/runAttemptStore'
import { type RunCostEntry, summarizeRunCosts } from '../runtime/runCostProjection'
import { settledFailureWorkIds } from '../runtime/settledAttemptFailure'
import { presentGoalAttention, presentWorkspaceAttention } from './assistantFeedPresenter'
import { ApiError } from './http'

export function attemptWorkIds(
  attempts: readonly RunAttemptSummary[],
  projectId: string,
  goalId: string,
) {
  return new Set(
    attempts
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => attempt.workId),
  )
}

export function presentActiveAttempt(
  attempt: RunAttemptSummary,
  runningAttempts: readonly RunAttemptSummary[],
  concurrency: MvpRuntime['concurrency'],
) {
  const runningCount = runningAttempts.filter(
    (running) => running.responsibility === attempt.responsibility,
  ).length
  return {
    key: `${attempt.projectId}/${attempt.goalId}/${attempt.workId}`,
    runId: attempt.runId,
    responsibility: attempt.responsibility,
    status: attempt.status === 'queued' ? ('queued' as const) : ('running' as const),
    requestedAt: attempt.requestedAt,
    startedAt: attempt.startedAt,
    waitReason:
      attempt.status === 'queued' && runningCount >= concurrency[attempt.responsibility]
        ? ('capacity' as const)
        : null,
  }
}

export function deriveGoalSummaries(
  goalPackage: Awaited<ReturnType<MvpProjectRuntime['store']['readPackage']>>,
  projections: ReturnType<typeof deriveGoalWorkProjections>,
) {
  const lifecycle = goalPackage.goal.attributes.lifecycle
  if (lifecycle === 'done') return { currentSummary: 'Outcome delivered', nextSummary: 'Complete' }
  if (lifecycle === 'cancelled') {
    return { currentSummary: 'Preserved history', nextSummary: 'Cancelled' }
  }
  const ordered = projections
    .filter((projection) => {
      const work = goalPackage.works.get(projection.workId)
      return work && work.attributes.stage !== 'done' && work.attributes.stage !== 'cancelled'
    })
    .toSorted((left, right) => {
      const columns = ['Plan', 'Build', 'Review', 'Done']
      return columns.indexOf(left.column ?? 'Done') - columns.indexOf(right.column ?? 'Done')
    })
  const focus =
    ordered.find((projection) => projection.primaryBadge === 'Needs you') ??
    ordered.find((projection) => projection.primaryBadge === 'Waiting for Assistant') ??
    ordered.find((projection) => projection.primaryBadge === 'working') ??
    ordered[0]
  if (lifecycle === 'paused') {
    return {
      currentSummary: focus
        ? `Paused at ${goalPackage.works.get(focus.workId)?.attributes.title ?? focus.workId}`
        : 'Paused',
      nextSummary: 'Resume to continue',
    }
  }
  if (!focus) return { currentSummary: 'Final assessment', nextSummary: 'Planner' }
  const work = goalPackage.works.get(focus.workId)
  return {
    currentSummary: `${focus.column ?? 'Waiting'}: ${work?.attributes.title ?? focus.workId}`,
    nextSummary: focus.primaryBadge
      ? `${focus.primaryBadge}${focus.responsibility ? ` · ${focus.responsibility}` : ''}`
      : (focus.responsibility ?? 'Waiting for prerequisites'),
  }
}

export function presentAttempt<
  T extends {
    runId: string
    workId: string
    result: string | null
    summary: string | null
    application: string | null
  },
>(
  attempt: T,
  goalPackage: Awaited<ReturnType<MvpProjectRuntime['store']['readPackage']>>,
  projectId: string,
  goalId: string,
) {
  const producerRun = `${workAttentionTarget(projectId, goalId, attempt.workId)}/run:${attempt.runId}`
  const evidence = [...goalPackage.evidence.values()].find(
    (document) => document.attributes.producerRun === producerRun,
  )
  if (!evidence) return attempt
  const consumed = [...goalPackage.works.values()].some((work) =>
    work.attributes.evidenceRefs.includes(evidence.attributes.id),
  )
  return {
    ...attempt,
    result: attempt.result,
    summary: attempt.summary,
    application: attempt.application ?? (consumed ? 'published' : 'evidence_preserved'),
  }
}

export function deriveWorkCompletedAt(
  work: Pick<WorkDocument['attributes'], 'kind' | 'stage'>,
  attempts: readonly Pick<
    RunAttemptSummary,
    'responsibility' | 'status' | 'result' | 'endedAt' | 'application'
  >[],
): string | null {
  if (work.stage !== 'done') return null

  const terminalResponsibility = work.kind === 'planning' ? 'planner' : 'reviewer'
  const terminalApplications =
    work.kind === 'planning'
      ? new Set(['published'])
      : new Set(['integrated', 'already_integrated'])
  const successfulTerminalAttempts = attempts.filter(
    (attempt) =>
      attempt.responsibility === terminalResponsibility &&
      attempt.status === 'finished' &&
      attempt.result === 'success' &&
      attempt.endedAt !== null,
  )
  const appliedAttempts = successfulTerminalAttempts.filter((attempt) =>
    terminalApplications.has(attempt.application ?? ''),
  )
  return appliedAttempts.reduce<string | null>(
    (latest, attempt) =>
      attempt.endedAt && (!latest || attempt.endedAt > latest) ? attempt.endedAt : latest,
    null,
  )
}

export async function presentGoal(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
  view: 'full' | 'board' | 'docs' = 'full',
) {
  const project = requireProject(runtime.projects, projectId)
  const goalPackage = (await project.store.readReconciliationSnapshot()).get(goalId)
  if (!goalPackage) throw new ApiError(404, `Goal not found: ${goalId}`)
  if (view === 'docs') {
    const designSnapshot = await runtime.publisher.snapshotTree(
      project.store.paths.publicationRoot,
      project.store.paths.designRoot(goalId),
    )
    return {
      projectId,
      goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
      design: designSnapshot.files.map((file) => ({
        path: file.path,
        excerpt: presentExcerpt(file.content ? new TextDecoder().decode(file.content) : '', 60),
      })),
      evidence: [...goalPackage.evidence.values()].map((evidence) => ({
        id: evidence.attributes.id,
        createdAt: evidence.attributes.createdAt,
        producerRun: evidence.attributes.producerRun,
        owner: evidence.attributes.owner,
        excerpt: presentExcerpt(evidence.body, 150),
      })),
    }
  }
  const [workspace, designSnapshot, attemptSnapshot, operations] = await Promise.all([
    runtime.workspace.readWorkspace(),
    view === 'full'
      ? runtime.publisher.snapshotTree(
          project.store.paths.publicationRoot,
          project.store.paths.designRoot(goalId),
        )
      : null,
    runtime.attempts.snapshot(),
    project.reconciler.listGoalOperations(goalId),
  ])
  const attemptsByWork = attemptSnapshot.listGoal(projectId, goalId)
  const runningAttempts = attemptSnapshot.running()
  const activeAttemptByWork = new Map(
    [...runningAttempts, ...attemptSnapshot.queued()]
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => [attempt.workId, attempt] as const),
  )
  const liveWorkIds = new Set(
    [...attemptsByWork.entries()].flatMap(([workId, attempts]) =>
      attempts.some((attempt) => attempt.status === 'running') ? [workId] : [],
    ),
  )
  const projectAttention = [...workspace.attentions.values()].find(
    (attention) =>
      workspaceAttentionProjectId(attention) === projectId &&
      attention.attributes.resolvedAt === null,
  )
  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, {
    projectEligible: true,
    liveRunWorkIds: liveWorkIds,
    settledFailureWorkIds: await settledFailureWorkIds(
      goalPackage,
      attemptsByWork,
      attemptWorkIds(attemptSnapshot.queued(), projectId, goalId),
    ),
    passCapacity: { planner: true, generator: true, reviewer: true },
    ...deriveRunSchedulingFacts([...attemptsByWork.values()].flat()),
  })
  const projectionByWork = new Map(projections.map((projection) => [projection.workId, projection]))
  const agentPlanByWork = await readLiveAgentPlans(
    runtime,
    projectId,
    goalId,
    liveWorkIds,
    attemptsByWork,
  )
  const projection = {
    projectId,
    goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
    works: [...goalPackage.works.values()].map((work) => {
      const workAttempts = attemptsByWork.get(work.attributes.id) ?? []
      const activeAttempt = activeAttemptByWork.get(work.attributes.id) ?? null
      return {
        ...work.attributes,
        ...(view === 'full' ? { body: work.body } : {}),
        projection: projectionByWork.get(work.attributes.id),
        blockedBy: presentWorkBlocker(work, projectionByWork, goalPackage),
        activeAttempt: activeAttempt
          ? presentActiveAttempt(activeAttempt, runningAttempts, runtime.concurrency)
          : null,
        agentPlan: agentPlanByWork.get(work.attributes.id) ?? null,
        runAttemptCount: workAttempts.length,
        completedAt: deriveWorkCompletedAt(work.attributes, workAttempts),
      }
    }),
    attentions: [...goalPackage.attentions.values()]
      .filter((attention) => view === 'full' || attention.attributes.resolvedAt === null)
      .map((attention) => {
        const presented = presentGoalAttention(attention, projectId, goalId)
        if (view === 'full') return presented
        const { body: _body, ...summary } = presented
        return summary
      }),
    projectAttention: projectAttention
      ? presentWorkspaceAttention(projectAttention, projectId)
      : null,
    operations,
  }
  if (view === 'board') return projection
  return {
    ...projection,
    design: (designSnapshot?.files ?? []).map((file) => ({
      path: file.path,
      content: file.content ? new TextDecoder().decode(file.content) : '',
    })),
    evidence: [...goalPackage.evidence.values()].map((evidence) => ({
      ...evidence.attributes,
      body: evidence.body,
    })),
  }
}

export async function presentGoalExecutionCost(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
) {
  const project = requireProject(runtime.projects, projectId)
  if (!(await project.store.readReconciliationSnapshot()).has(goalId)) {
    throw new ApiError(404, `Goal not found: ${goalId}`)
  }
  const attemptsByWork = await runtime.attempts.listGoal(projectId, goalId)
  const entries: RunCostEntry[] = []
  for (const [workId, attempts] of attemptsByWork) {
    for (const attempt of attempts) {
      const diagnostics = await runtime.attempts.readDiagnostics(
        projectId,
        goalId,
        workId,
        attempt.runId,
      )
      if (diagnostics) entries.push({ ...attempt, diagnostics })
    }
  }
  const byWork = [...attemptsByWork.keys()].map((workId) => {
    const scoped = entries.filter((entry) => entry.workId === workId)
    return { workId, summary: summarizeRunCosts(scoped) }
  })
  const byResponsibility = (['planner', 'generator', 'reviewer'] as const).map(
    (responsibility) => ({
      responsibility,
      summary: summarizeRunCosts(
        entries.filter((entry) => entry.responsibility === responsibility),
      ),
    }),
  )
  return {
    projectId,
    goalId,
    summary: summarizeRunCosts(entries),
    byWork,
    byResponsibility,
    runs: entries,
  }
}

function presentWorkBlocker(
  work: WorkDocument,
  projections: ReadonlyMap<string, WorkProjection>,
  goalPackage: GoalPackage,
) {
  const projection = projections.get(work.attributes.id)
  if (
    !projection ||
    work.attributes.stage === 'done' ||
    work.attributes.stage === 'cancelled' ||
    projection.ready ||
    projection.primaryBadge === 'working'
  ) {
    return null
  }

  const reasons = new Set(projection.failedPredicates)
  if (reasons.has('project_ineligible')) return 'Project'
  if (reasons.has('goal_not_active')) return 'Goal'
  if (reasons.has('stale_contract_revision')) return 'Planner'
  if (reasons.has('dependency_incomplete')) {
    const dependencies = work.attributes.dependsOn
      .map((dependencyId) => goalPackage.works.get(dependencyId))
      .filter((dependency): dependency is WorkDocument =>
        Boolean(dependency && dependency.attributes.stage !== 'done'),
      )
    if (dependencies.length === 1) return dependencies[0]?.attributes.title ?? 'dependency'
    return dependencies.length > 1 ? `${dependencies.length} dependencies` : 'dependency'
  }
  if (reasons.has('not_before')) return 'schedule'
  if (reasons.has('capacity')) {
    return projection.responsibility
      ? `${capitalize(projection.responsibility)} capacity`
      : 'Agent capacity'
  }
  if (reasons.has('no_responsibility')) return 'unsupported work stage'
  if (reasons.has('awaiting_supervisor')) return 'Supervisor'
  return null
}

async function readLiveAgentPlans(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
  liveWorkIds: ReadonlySet<string>,
  attemptsByWork: ReadonlyMap<string, readonly RunAttemptSummary[]>,
) {
  const plans = await Promise.all(
    [...liveWorkIds].map(async (workId) => {
      const attempt = attemptsByWork
        .get(workId)
        ?.find((candidate) => candidate.status === 'running')
      if (!attempt) return null
      const events = await runtime.attempts.readEvents(projectId, goalId, workId, attempt.runId)
      const plan = latestAgentPlan(events ?? [])
      return plan
        ? ([
            workId,
            {
              runId: attempt.runId,
              transport: plan.transport,
              planId: plan.planId,
              status: plan.status,
              items: plan.items,
              vendorEventType: plan.vendorEventType,
            },
          ] as const)
        : null
    }),
  )
  return new Map(plans.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
}

export function latestAgentPlan(events: readonly AgentRuntimeEvent[]): AgentPlanEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'plan') return event
  }
  return null
}

function presentExcerpt(value: string, maxLength: number) {
  const plain = value
    .replace(/^#+\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}

function capitalize(value: string) {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`
}
