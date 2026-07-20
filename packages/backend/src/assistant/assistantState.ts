import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseWorkAttentionTarget } from '../domain/attentionTarget'
import { type WorkDocument, isPlanningWork, isWorkTerminal } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { ProjectCodingDefaults } from '../domain/projectCodingDefaults'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
import { inspectDeliveryProjection } from '../runtime/c1Integrator'
import {
  EvidenceArtifactResolutionError,
  evidenceArtifactUrl,
  resolveEvidenceArtifact,
} from '../runtime/evidenceArtifacts'
import type { Responsibility } from '../runtime/roleContextStager'
import type {
  RunAttemptSnapshot,
  RunAttemptStore,
  RunAttemptSummary,
} from '../runtime/runAttemptStore'
import { legacyRunStoragePath, runStoragePath } from '../runtime/runPaths'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'

export const DEFAULT_ATTEMPT_STALE_AFTER_MS = 10 * 60 * 1_000

export interface AssistantStateProject {
  projectId: string
  projectRoot: string
  sourceRoot?: string
  primaryRepoId?: string
  repos?: readonly {
    repoId?: string
    repoPath?: string
    integrationRoot: string
    projectPath: string
    deliveryBranch?: string
    primary?: boolean
  }[]
  store: GoalPackageStore
  reconciler?: {
    operationallyDeferredWorkIds?(goalId: string, observedAt?: Date): ReadonlySet<string>
  }
}

export interface AssistantStateReader {
  read(input?: {
    projectId?: string
    goalId?: string
    includeEvidence?: boolean
  }): Promise<AssistantStateSnapshot>
}

export interface AssistantStateSnapshot {
  observedAt: string
  stateDigest: string
  activeRuns: AssistantStateActiveRun[]
  workspaceAttentions: unknown[]
  projects: unknown[]
  assistantCodingDefaults?: ProjectCodingDefaults
  assistantCodingDefaultsInherited?: boolean
}

export interface AssistantStateActiveRun {
  projectId: string
  goalId: string
  workId: string
  responsibility: Responsibility
  runId: string | null
}

interface DigestWorkspaceAttention {
  id: string
  target: string
  createdAt: string
  resolvedAt: string | null
  notifiedAt: string | null
  operatorRequest?: string | null
  body: string
}

interface DigestProject {
  projectId: string
  available: boolean
  releaseHead: string | null
  goals: Array<{
    goal: { attributes: unknown }
    latestPlanningOutcome: {
      attributes: unknown
      runtime: { latestAttempt: { status: string } | null; stale: boolean }
    } | null
    works: Array<{
      attributes: unknown
      runtime: {
        latestAttempt: { status: string } | null
        stale: boolean
      }
    }>
    attentions: Array<{ attributes: unknown }>
  }>
}

export function createAssistantStateReader(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantStateProject>
  publisher: PublicationCoordinator
  attempts: RunAttemptStore
  activeRuns?: () => ReadonlyMap<string, Responsibility>
  readAssistantCodingDefaults?: () => Promise<{
    codingDefaults: ProjectCodingDefaults
    inherited: boolean
  }>
  now?: () => Date
  staleAfterMs?: number
}): AssistantStateReader {
  const homeRoot = resolve(options.homeRoot)
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_ATTEMPT_STALE_AFTER_MS

  return {
    async read(input = {}) {
      const observedAt = now()
      const [workspace, assistantModelSettings, attemptSnapshot] = await Promise.all([
        options.workspace.readWorkspace(),
        options.readAssistantCodingDefaults?.(),
        options.attempts.snapshot(),
      ])
      const activeRuns = options.activeRuns?.() ?? new Map<string, Responsibility>()
      const activeCounts = responsibilityCounts(activeRuns)
      const activeRunViews: AssistantStateActiveRun[] = []
      const selected = input.projectId
        ? [requireProject(options.projects, input.projectId)]
        : [...options.projects.values()].sort((left, right) =>
            left.projectId.localeCompare(right.projectId),
          )
      const workspaceAttentions = [...workspace.attentions.values()]
        .filter((attention) => attention.attributes.resolvedAt === null)
        .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
        .map((attention) => ({ ...attention.attributes, body: boundedText(attention.body, 1_200) }))

      const projects = await Promise.all(
        selected.map(async (project) => {
          const projectAttention = workspaceAttentions.find(
            (attention) =>
              attention.target === `project:${project.projectId}` && attention.resolvedAt === null,
          )
          const projectAttentionOpen = Boolean(projectAttention)
          const goalIds = input.goalId ? [input.goalId] : await project.store.listGoalIds()
          const goals = await Promise.all(
            goalIds.toSorted().map(async (goalId) => {
              const goalPackage = await project.store.readPackage(goalId)
              const prefix = `${project.projectId}/${goalId}/`
              const liveWorkIds = new Set(
                [...activeRuns.keys()]
                  .filter((key) => key.startsWith(prefix))
                  .map((key) => key.slice(prefix.length)),
              )
              const projections = deriveGoalWorkProjections(
                project.projectId,
                goalId,
                goalPackage,
                {
                  projectEligible: !projectAttentionOpen,
                  liveRunWorkIds: liveWorkIds,
                  operationallyDeferredWorkIds:
                    project.reconciler?.operationallyDeferredWorkIds?.(goalId, observedAt) ??
                    new Set(),
                  passCapacity: {
                    planner: activeCounts.planner < 1,
                    generator: activeCounts.generator < 3,
                    reviewer: activeCounts.reviewer < 1,
                  },
                  now: observedAt,
                  maxAttempts: 3,
                },
              )
              const projectionByWork = new Map(
                projections.map((projection) => [projection.workId, projection]),
              )
              const allWorks = [...goalPackage.works.values()]
              const attentionWorkIds = new Set(
                [...goalPackage.attentions.values()]
                  .filter((attention) => attention.attributes.resolvedAt === null)
                  .map((attention) =>
                    attention.attributes.target === null
                      ? null
                      : parseWorkAttentionTarget(attention.attributes.target),
                  )
                  .filter((target): target is NonNullable<typeof target> => target !== null)
                  .map((target) => target.workId),
              )
              const latestPlanning = allWorks
                .filter(
                  (work) => isPlanningWork(work.attributes) && isWorkTerminal(work.attributes),
                )
                .toSorted((left, right) => comparePlanningRecency(left, right, goalPackage))[0]
              const works = await Promise.all(
                allWorks
                  .filter(
                    (work) =>
                      input.includeEvidence ||
                      !isWorkTerminal(work.attributes) ||
                      attentionWorkIds.has(work.attributes.id),
                  )
                  .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
                  .map(async (work) => {
                    const key = `${prefix}${work.attributes.id}`
                    const runtime = await readWorkRuntime({
                      homeRoot,
                      projectRoot: project.projectRoot,
                      projectId: project.projectId,
                      goalId,
                      workId: work.attributes.id,
                      activeResponsibility: activeRuns.get(key) ?? null,
                      attemptSnapshot,
                      attemptStore: options.attempts,
                      observedAt,
                      staleAfterMs,
                    })
                    if (runtime.activeResponsibility) {
                      activeRunViews.push({
                        projectId: project.projectId,
                        goalId,
                        workId: work.attributes.id,
                        responsibility: runtime.activeResponsibility,
                        runId:
                          runtime.latestAttempt?.status === 'running'
                            ? runtime.latestAttempt.runId
                            : null,
                      })
                    }
                    const evidence = input.goalId
                      ? input.includeEvidence
                        ? await readWorkEvidence({
                            homeRoot,
                            project,
                            goalId,
                            work,
                            goalPackage,
                          })
                        : readWorkEvidenceSummary({ project, goalId, work, goalPackage })
                      : null
                    return {
                      attributes: input.includeEvidence
                        ? work.attributes
                        : compactWorkAttributes(work),
                      path: project.store.paths.absolute(
                        project.store.paths.workDocument(goalId, work.attributes.id),
                      ),
                      projection: projectionByWork.get(work.attributes.id) ?? null,
                      runtime,
                      ...(evidence ? { evidence } : {}),
                    }
                  }),
              )
              const latestPlanningOutcome = latestPlanning
                ? {
                    attributes: compactWorkAttributes(latestPlanning),
                    path: project.store.paths.absolute(
                      project.store.paths.workDocument(goalId, latestPlanning.attributes.id),
                    ),
                    runtime: await readWorkRuntime({
                      homeRoot,
                      projectRoot: project.projectRoot,
                      projectId: project.projectId,
                      goalId,
                      workId: latestPlanning.attributes.id,
                      activeResponsibility: null,
                      attemptSnapshot,
                      attemptStore: options.attempts,
                      observedAt,
                      staleAfterMs,
                    }),
                    evidence: readWorkEvidenceSummary({
                      project,
                      goalId,
                      work: latestPlanning,
                      goalPackage,
                    }),
                  }
                : null
              const design = input.goalId
                ? await options.publisher.snapshotTree(
                    project.store.paths.publicationRoot,
                    project.store.paths.designRoot(goalId),
                  )
                : null

              return {
                goal: {
                  attributes: goalPackage.goal.attributes,
                  body: boundedText(goalPackage.goal.body, input.includeEvidence ? 4_000 : 800),
                  path: project.store.paths.absolute(project.store.paths.goalDocument(goalId)),
                },
                latestPlanningOutcome,
                works,
                attentions: [...goalPackage.attentions.values()]
                  .filter((attention) => attention.attributes.resolvedAt === null)
                  .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
                  .map((attention) => ({
                    attributes: attention.attributes,
                    body: boundedText(attention.body, input.includeEvidence ? 4_000 : 1_200),
                    path: project.store.paths.absolute(
                      project.store.paths.attentionDocument(goalId, attention.attributes.id),
                    ),
                  })),
                ...(design
                  ? {
                      design: design.files.flatMap((file) =>
                        file.content
                          ? [
                              {
                                canonicalPath: file.path,
                                path: project.store.paths.absolute(file.path),
                              },
                            ]
                          : [],
                      ),
                    }
                  : {}),
              }
            }),
          )
          const repos = project.repos
            ? await Promise.all(
                project.repos.map(async (repo) => ({
                  ...(repo.repoId ? { repoId: repo.repoId } : {}),
                  ...(repo.repoPath ? { repoPath: repo.repoPath } : {}),
                  projectPath: repo.projectPath,
                  integrationRoot: repo.integrationRoot,
                  ...(repo.deliveryBranch ? { deliveryBranch: repo.deliveryBranch } : {}),
                  ...(repo.primary !== undefined ? { primary: repo.primary } : {}),
                  ...(repo.repoId && repo.repoPath && repo.deliveryBranch
                    ? { delivery: await deliveryProjection(repo) }
                    : {}),
                })),
              )
            : undefined
          return {
            projectId: project.projectId,
            projectRoot: project.projectRoot,
            ...(project.primaryRepoId ? { primaryRepoId: project.primaryRepoId } : {}),
            ...(repos ? { repos } : {}),
            available: !projectAttentionOpen,
            releaseHead: await releaseHead(project.projectRoot),
            goals,
          }
        }),
      )

      return {
        observedAt: observedAt.toISOString(),
        stateDigest: await semanticDigest(projects, workspaceAttentions),
        activeRuns: activeRunViews.sort(
          (left, right) =>
            left.projectId.localeCompare(right.projectId) ||
            left.goalId.localeCompare(right.goalId) ||
            left.workId.localeCompare(right.workId),
        ),
        workspaceAttentions,
        projects,
        ...(assistantModelSettings
          ? {
              assistantCodingDefaults: assistantModelSettings.codingDefaults,
              assistantCodingDefaultsInherited: assistantModelSettings.inherited,
            }
          : {}),
      }
    },
  }
}

function readWorkEvidenceSummary(input: {
  project: AssistantStateProject
  goalId: string
  work: WorkDocument
  goalPackage: GoalPackage
}) {
  const references = input.work.attributes.evidenceRefs
  const evidenceId = references.at(-1)
  if (!evidenceId) return { count: 0, latest: null }
  const evidence = input.goalPackage.evidence.get(evidenceId)
  if (!evidence) throw new Error(`Work references missing Evidence: ${evidenceId}`)
  return {
    count: references.length,
    latest: {
      id: evidence.attributes.id,
      producerRun: evidence.attributes.producerRun,
      artifactCount: evidence.attributes.artifacts.length,
      path: input.project.store.paths.absolute(
        input.project.store.paths.evidenceDocument(input.goalId, evidenceId),
      ),
    },
  }
}

function compactWorkAttributes(work: WorkDocument) {
  const attributes = work.attributes
  return {
    id: attributes.id,
    title: boundedText(attributes.title, 160),
    kind: attributes.kind,
    stage: attributes.stage,
    notBefore: attributes.notBefore,
    dependsOn: attributes.dependsOn,
    contractRevision: attributes.contractRevision,
    attempts: attributes.attempts,
    ...(attributes.kind === 'engineering'
      ? {
          repos: attributes.repos,
          ...(attributes.assistantDispatch
            ? { assistantDispatch: attributes.assistantDispatch }
            : {}),
        }
      : {}),
  }
}

function comparePlanningRecency(left: WorkDocument, right: WorkDocument, goalPackage: GoalPackage) {
  const leftCreatedAt = latestWorkEvidenceCreatedAt(left, goalPackage)
  const rightCreatedAt = latestWorkEvidenceCreatedAt(right, goalPackage)
  return (
    rightCreatedAt.localeCompare(leftCreatedAt) ||
    planningOrdinal(right.attributes.id) - planningOrdinal(left.attributes.id) ||
    right.attributes.id.localeCompare(left.attributes.id)
  )
}

function latestWorkEvidenceCreatedAt(work: WorkDocument, goalPackage: GoalPackage) {
  const evidenceId = work.attributes.evidenceRefs.at(-1)
  return evidenceId ? (goalPackage.evidence.get(evidenceId)?.attributes.createdAt ?? '') : ''
}

function planningOrdinal(workId: string) {
  if (workId === 'plan-initial') return 1
  const ordinal = /^plan-(\d+)$/.exec(workId)?.[1]
  return ordinal ? Number.parseInt(ordinal, 10) : 0
}

async function readWorkEvidence(input: {
  homeRoot: string
  project: AssistantStateProject
  goalId: string
  work: WorkDocument
  goalPackage: GoalPackage
}) {
  return Promise.all(
    input.work.attributes.evidenceRefs.map(async (evidenceId) => {
      const evidence = input.goalPackage.evidence.get(evidenceId)
      if (!evidence) throw new Error(`Work references missing Evidence: ${evidenceId}`)
      const artifacts = await Promise.all(
        evidence.attributes.artifacts.map(async (reference, artifactIndex) => {
          try {
            const artifact = await resolveEvidenceArtifact({
              homeRoot: input.homeRoot,
              project: input.project,
              reference,
            })
            return {
              reference,
              available: true,
              fileName: artifact.fileName,
              inspectionPath: artifact.path,
              operatorUrl: evidenceArtifactUrl({
                projectId: input.project.projectId,
                goalId: input.goalId,
                evidenceId,
                artifactIndex,
              }),
            }
          } catch (error) {
            return {
              reference,
              available: false,
              unavailableReason:
                error instanceof EvidenceArtifactResolutionError ? error.code : 'resolution_failed',
            }
          }
        }),
      )
      return {
        attributes: evidence.attributes,
        body: boundedText(evidence.body, 2_000),
        path: input.project.store.paths.absolute(
          input.project.store.paths.evidenceDocument(input.goalId, evidenceId),
        ),
        artifacts,
      }
    }),
  )
}

async function readWorkRuntime(input: {
  homeRoot: string
  projectRoot: string
  projectId: string
  goalId: string
  workId: string
  activeResponsibility: Responsibility | null
  attemptSnapshot: RunAttemptSnapshot
  attemptStore: RunAttemptStore
  observedAt: Date
  staleAfterMs: number
}) {
  const latest = input.attemptSnapshot.list(input.projectId, input.goalId, input.workId)[0] ?? null
  const runRoot = latest
    ? await existingRunRoot(
        input.homeRoot,
        input.projectId,
        input.goalId,
        input.workId,
        latest.runId,
      )
    : null
  const paths = runRoot ? await existingRunPaths(runRoot) : {}
  const runningEvents =
    latest?.status === 'running'
      ? ((await input.attemptStore.readEvents(
          input.projectId,
          input.goalId,
          input.workId,
          latest.runId,
        )) ?? [])
      : []
  const lastActivityAt = latest
    ? latest.status === 'running'
      ? await latestActivity(latest, runningEvents, paths.transcript ?? null)
      : (latest.endedAt ?? latest.startedAt)
    : null
  const stale = Boolean(
    input.activeResponsibility &&
      latest?.status === 'running' &&
      lastActivityAt &&
      input.observedAt.getTime() - new Date(lastActivityAt).getTime() >= input.staleAfterMs,
  )
  const worktreePath = join(resolve(input.projectRoot, '..'), 'work', input.goalId, input.workId)

  return {
    activeResponsibility: input.activeResponsibility,
    latestAttempt: latest ? boundedAttempt(latest) : null,
    lastActivityAt,
    stale,
    worktree: {
      path: worktreePath,
      exists: await Bun.file(join(worktreePath, '.git')).exists(),
    },
    paths,
  }
}

async function existingRunPaths(runRoot: string) {
  const candidates = {
    root: runRoot,
    attempt: join(runRoot, 'attempt.json'),
    events: join(runRoot, 'events.jsonl'),
    transcript: join(runRoot, 'transcript.log'),
    context: join(runRoot, 'context.md'),
    prompt: join(runRoot, 'prompt.md'),
    result: join(runRoot, 'result.json'),
  }
  const entries = await Promise.all(
    Object.entries(candidates).map(
      async ([key, path]) => [key, path, await pathExists(path)] as const,
    ),
  )
  return Object.fromEntries(
    entries.filter(([, , exists]) => exists).map(([key, path]) => [key, path]),
  ) as Partial<Record<keyof typeof candidates, string>>
}

async function existingRunRoot(
  homeRoot: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const flat = runStoragePath(homeRoot, runId)
  if (await pathExists(flat)) return flat
  const legacy = legacyRunStoragePath(homeRoot, projectId, goalId, workId, runId)
  return (await pathExists(legacy)) ? legacy : null
}

async function latestActivity(
  attempt: RunAttemptSummary,
  events: readonly { createdAt: string }[],
  transcriptPath: string | null,
) {
  const timestamps = [attempt.startedAt, attempt.endedAt, ...events.map((event) => event.createdAt)]
    .filter((value): value is string => value !== null)
    .map((value) => new Date(value).getTime())
  if (transcriptPath) {
    const transcriptStat = await stat(transcriptPath).catch(() => null)
    if (transcriptStat) timestamps.push(transcriptStat.mtimeMs)
  }
  return new Date(Math.max(...timestamps)).toISOString()
}

function boundedAttempt(attempt: RunAttemptSummary) {
  return {
    ...attempt,
    summary:
      attempt.summary && attempt.summary.length > 1_000
        ? `${attempt.summary.slice(0, 1_000)}...`
        : attempt.summary,
  }
}

async function semanticDigest(
  projects: DigestProject[],
  workspaceAttentions: DigestWorkspaceAttention[],
) {
  const semantic = {
    workspaceAttentions: workspaceAttentions.map(({ body: _body, ...attributes }) => attributes),
    projects: projects.map((project) => ({
      projectId: project.projectId,
      available: project.available,
      releaseHead: project.releaseHead,
      goals: project.goals.map((goal) => ({
        goal: goal.goal.attributes,
        latestPlanningOutcome: goal.latestPlanningOutcome
          ? {
              attributes: goal.latestPlanningOutcome.attributes,
              terminalAttempt:
                goal.latestPlanningOutcome.runtime.latestAttempt?.status === 'running'
                  ? null
                  : (goal.latestPlanningOutcome.runtime.latestAttempt ?? null),
              stale: goal.latestPlanningOutcome.runtime.stale,
            }
          : null,
        works: goal.works.map((work) => ({
          attributes: work.attributes,
          terminalAttempt:
            work.runtime.latestAttempt?.status === 'running'
              ? null
              : (work.runtime.latestAttempt ?? null),
          stale: work.runtime.stale,
        })),
        attentions: goal.attentions.map((attention) => attention.attributes),
      })),
    })),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(semantic))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function responsibilityCounts(active: ReadonlyMap<string, Responsibility>) {
  const counts: Record<Responsibility, number> = { planner: 0, generator: 0, reviewer: 0 }
  for (const responsibility of active.values()) counts[responsibility] += 1
  return counts
}

async function releaseHead(projectRoot: string) {
  const child = Bun.spawn(['git', 'rev-parse', 'refs/heads/hopi/release'], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return exitCode === 0 ? stdout.trim() : null
}

async function deliveryProjection(repo: {
  repoId?: string
  repoPath?: string
  integrationRoot: string
  deliveryBranch?: string
  primary?: boolean
}) {
  if (!repo.repoId || !repo.repoPath || !repo.deliveryBranch) {
    return { status: 'pending' as const, commit: null, reason: 'Delivery binding is incomplete' }
  }
  const desired = await releaseHead(repo.integrationRoot)
  if (!desired) {
    return {
      status: 'pending' as const,
      commit: null,
      reason: `Repo ${repo.repoId} managed release is unavailable`,
    }
  }
  try {
    const inspected = await inspectDeliveryProjection(
      {
        repoId: repo.repoId,
        integrationRoot: repo.integrationRoot,
        checkoutRoot: repo.repoPath,
        deliveryBranch: repo.deliveryBranch,
        primary: repo.primary ?? false,
      },
      desired,
    )
    return inspected.status === 'current'
      ? inspected
      : { status: inspected.status, commit: inspected.commit, reason: inspected.reason }
  } catch (error) {
    return {
      status: 'pending' as const,
      commit: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function boundedText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

async function pathExists(path: string) {
  return (await stat(path).catch(() => null)) !== null
}

function requireProject(projects: ReadonlyMap<string, AssistantStateProject>, projectId: string) {
  const project = projects.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project
}
