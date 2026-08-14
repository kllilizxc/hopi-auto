import { workspaceAttentionProjectId } from '../domain/assistantWorkspaceDocuments'
import type { WorkDocument } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { WorkProjection } from '../domain/workProjection'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import { type MvpProjectRuntime, type MvpRuntime, requireProject } from '../runtime/mvpRuntime'
import type { RunAttemptSummary } from '../runtime/runAttemptStore'
import { type RunCostEntry, summarizeRunCosts } from '../runtime/runCostProjection'
import { currentSettledWorkIds } from '../runtime/workAssignment'
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
  return {
    key: `${attempt.projectId}/${attempt.goalId}/${attempt.workId}`,
    runId: attempt.runId,
    status: attempt.status === 'queued' ? ('queued' as const) : ('running' as const),
    requestedAt: attempt.requestedAt,
    startedAt: attempt.startedAt,
    waitReason:
      attempt.status === 'queued' && runningAttempts.length >= concurrency
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
  const open = projections.filter((projection) => {
    const work = goalPackage.works.get(projection.workId)
    return work?.attributes.status === 'open'
  })
  const focus =
    open.find((projection) => projection.state === 'needs_user') ??
    open.find((projection) => projection.state === 'running') ??
    open.find((projection) => projection.state === 'queued') ??
    open.find((projection) => projection.state === 'waiting_assistant') ??
    open.find((projection) => projection.state === 'ready') ??
    open[0]
  if (lifecycle === 'paused') {
    return {
      currentSummary: focus
        ? `Paused at ${goalPackage.works.get(focus.workId)?.attributes.title ?? focus.workId}`
        : 'Paused',
      nextSummary: 'Resume to continue',
    }
  }
  if (!focus) return { currentSummary: 'Assess destination', nextSummary: 'Assistant' }
  const work = goalPackage.works.get(focus.workId)
  return {
    currentSummary: work?.attributes.title ?? focus.workId,
    nextSummary: routeStateLabel(focus.state),
  }
}

export function deriveWorkCompletedAt(
  work: Pick<WorkDocument['attributes'], 'status'>,
  attempts: readonly Pick<RunAttemptSummary, 'status' | 'endedAt'>[],
): string | null {
  if (work.status !== 'done') return null
  return attempts
    .filter((attempt) => attempt.status === 'settled')
    .reduce<string | null>(
      (latest, attempt) =>
        attempt.endedAt && (!latest || attempt.endedAt > latest) ? attempt.endedAt : latest,
      null,
    )
}

export async function presentGoal(
  runtime: MvpRuntime,
  projectId: string,
  goalId: string,
  view: 'full' | 'route' | 'docs' = 'full',
) {
  const project = requireProject(runtime.projects, projectId)
  const goalPackage = (await project.store.readReconciliationSnapshot()).get(goalId)
  if (!goalPackage) throw new ApiError(404, `Goal not found: ${goalId}`)
  if (view === 'docs') return presentGoalDocs(runtime, project, projectId, goalId, goalPackage)

  const [workspace, designSnapshot, attemptSnapshot] = await Promise.all([
    runtime.workspace.readWorkspace(),
    view === 'full'
      ? runtime.publisher.snapshotTree(
          project.store.paths.publicationRoot,
          project.store.paths.designRoot(goalId),
        )
      : view === 'route'
        ? runtime.publisher.snapshot(project.store.paths.publicationRoot, [
            project.store.paths.designIndex(goalId),
          ])
        : null,
    runtime.attempts.snapshot(),
  ])
  const attemptsByWork = attemptSnapshot.listGoal(projectId, goalId)
  const runningAttempts = attemptSnapshot.running()
  const queuedAttempts = attemptSnapshot.queued()
  const activeAttemptByWork = new Map(
    [...runningAttempts, ...queuedAttempts]
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => [attempt.workId, attempt] as const),
  )
  const runningWorkIds = new Set(
    runningAttempts
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => attempt.workId),
  )
  const queuedWorkIds = new Set(
    queuedAttempts
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => attempt.workId),
  )
  const settledWorkIds = await currentSettledWorkIds(goalPackage.works.values(), attemptsByWork)
  const projections = deriveGoalWorkProjections(projectId, goalId, goalPackage, {
    projectEligible: true,
    runningWorkIds,
    queuedWorkIds,
    settledWorkIds,
  })
  const projectionByWork = new Map(projections.map((projection) => [projection.workId, projection]))
  const works = [...goalPackage.works.values()].map((work) => {
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
      runAttemptCount: workAttempts.length,
      completedAt: deriveWorkCompletedAt(work.attributes, workAttempts),
    }
  })
  const projectAttention = [...workspace.attentions.values()].find(
    (attention) =>
      workspaceAttentionProjectId(attention) === projectId &&
      attention.attributes.resolvedAt === null,
  )
  const mapFile = (designSnapshot?.files ?? []).find(
    (file) => file.path === project.store.paths.designIndex(goalId),
  )
  const hasMap = Boolean(mapFile?.hash && mapFile.content)
  const route = {
    destination: {
      goalId,
      title: goalPackage.goal.attributes.title,
      lifecycle: goalPackage.goal.attributes.lifecycle,
    },
    nodes: works,
    edges: works.flatMap((work) =>
      work.dependsOn.map((dependencyId) => ({ from: dependencyId, to: work.id })),
    ),
    completedDecisionCount: works.filter(
      (work) => work.kind === 'decision' && work.status === 'done',
    ).length,
    completedEngineeringCount: works.filter(
      (work) => work.kind === 'engineering' && work.status === 'done',
    ).length,
    focusWorkId: focusWorkId(projections),
    mapPath: hasMap ? project.store.paths.designIndex(goalId) : null,
    fogSummary:
      hasMap && mapFile?.content
        ? presentExcerpt(
            markdownSection(new TextDecoder().decode(mapFile.content), 'Not yet specified'),
            180,
          ) || null
        : null,
  }
  const projection = {
    projectId,
    goal: { ...goalPackage.goal.attributes, body: goalPackage.goal.body },
    works,
    route,
    attentions: [...goalPackage.attentions.values()]
      .filter((attention) => view === 'full' || attention.attributes.resolvedAt === null)
      .map((attention) => presentGoalAttention(attention, projectId, goalId)),
    projectAttention: projectAttention
      ? presentWorkspaceAttention(projectAttention, projectId)
      : null,
  }
  if (view === 'route') return projection
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

async function presentGoalDocs(
  runtime: MvpRuntime,
  project: MvpProjectRuntime,
  projectId: string,
  goalId: string,
  goalPackage: GoalPackage,
) {
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
  return {
    projectId,
    goalId,
    summary: summarizeRunCosts(entries),
    byWork: [...attemptsByWork.keys()].map((workId) => ({
      workId,
      summary: summarizeRunCosts(entries.filter((entry) => entry.workId === workId)),
    })),
    runs: entries,
  }
}

function presentWorkBlocker(
  work: WorkDocument,
  projections: ReadonlyMap<string, WorkProjection>,
  goalPackage: GoalPackage,
) {
  const projection = projections.get(work.attributes.id)
  if (!projection || work.attributes.status !== 'open' || projection.state !== 'blocked')
    return null
  const reasons = new Set(projection.failedPredicates)
  if (reasons.has('project_ineligible')) return 'Project unavailable'
  if (reasons.has('goal_not_active')) return 'Goal inactive'
  if (reasons.has('stale_contract_revision')) return 'Contract changed'
  if (reasons.has('dependency_cancelled')) return 'Dependency cancelled'
  if (reasons.has('dependency_incomplete')) {
    const dependencies = work.attributes.dependsOn
      .map((dependencyId) => goalPackage.works.get(dependencyId))
      .filter((dependency): dependency is WorkDocument => dependency?.attributes.status !== 'done')
    if (dependencies.length === 1) return dependencies[0]?.attributes.title ?? 'Dependency'
    return dependencies.length > 1 ? `${dependencies.length} dependencies` : 'Dependency'
  }
  if (reasons.has('not_before')) return 'Scheduled'
  return null
}

function focusWorkId(projections: readonly WorkProjection[]) {
  const order = [
    'running',
    'queued',
    'needs_user',
    'waiting_assistant',
    'ready',
    'blocked',
  ] as const
  for (const state of order) {
    const match = projections.find((projection) => projection.state === state)
    if (match) return match.workId
  }
  return null
}

function routeStateLabel(state: WorkProjection['state']) {
  const labels: Record<WorkProjection['state'], string> = {
    done: 'Done',
    cancelled: 'Cancelled',
    needs_user: 'Needs you',
    running: 'Working',
    queued: 'Queued',
    scheduled: 'Scheduled',
    waiting_assistant: 'Waiting for Assistant',
    blocked: 'Blocked',
    ready: 'Ready',
  }
  return labels[state]
}

function presentExcerpt(value: string, maxLength: number) {
  const plain = value
    .replace(/^#+\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain
}

function markdownSection(source: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^## ${escaped}\\s*$\\n([\\s\\S]*?)(?=^## |$)`, 'm').exec(source)
  return match?.[1]?.trim() ?? ''
}
