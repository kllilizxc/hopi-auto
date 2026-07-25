import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { workspaceAttentionProjectId } from '../domain/assistantWorkspaceDocuments'
import { goalAttentionReference, workspaceAttentionReference } from '../domain/attentionReference'
import { parseWorkAttentionTarget } from '../domain/attentionTarget'
import {
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { projectReleaseRef } from '../domain/project'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
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
import { settledFailureWorkIds } from '../runtime/settledAttemptFailure'
import { inspectSourceMerge } from '../runtime/sourceMergePreflight'
import { createStableWorktreeManager } from '../runtime/stableWorktreeManager'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { AssistantToolRequestError } from './assistantToolRequestError'

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
    primary?: boolean
  }[]
  store: GoalPackageStore
}

export interface AssistantStateReader {
  read(input?: AssistantStateReadInput): Promise<AssistantStateSnapshot>
  readForReflection?(): Promise<AssistantStateSnapshot>
}

export interface AssistantStateReadInput {
  projectId?: string
  goalId?: string
  includeEvidence?: boolean
}

export interface AssistantStateSnapshot {
  observedAt: string
  stateDigest: string
  conversationDigests: {
    home: string
    projects: Record<string, string>
  }
  activeRuns: AssistantStateActiveRun[]
  workspaceAttentions: unknown[]
  projects: unknown[]
}

export interface AssistantStateActiveRun {
  projectId: string
  goalId: string
  workId: string
  responsibility: Responsibility
  runId: string
}

interface DigestWorkspaceAttention {
  reference: string
  projectId: string | null
  id: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  refs: string[]
  body: string
  inspectionPath: string
}

interface DigestRuntime {
  latestAttempt: { status: string } | null
  recentAttempts: Array<{
    runId: string
    responsibility: string
    status: string
    result: string | null
    application: string | null
  }>
  attemptCount: number
  stale: boolean
}

interface DigestProject {
  projectId: string
  available: boolean
  releaseHead: string | null
  error?: string
  goals: Array<{
    goal: { attributes: unknown }
    latestPlanningOutcome: {
      attributes: unknown
      runtime: DigestRuntime
    } | null
    works: Array<{
      attributes: unknown
      candidateIntegration?: unknown
      runtime: DigestRuntime
    }>
    attentions: Array<{ attributes: unknown }>
    design: Array<{ canonicalPath: string; hash: string | null }>
  }>
}

export function createAssistantStateReader(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantStateProject>
  publisher: PublicationCoordinator
  attempts: RunAttemptStore
  concurrency?: Readonly<Record<Responsibility, number>>
  now?: () => Date
  staleAfterMs?: number
}): AssistantStateReader {
  const homeRoot = resolve(options.homeRoot)
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_ATTEMPT_STALE_AFTER_MS
  const worktrees = createStableWorktreeManager(homeRoot)
  let reflectionCache: { token: string; snapshot: AssistantStateSnapshot } | null = null

  const read = async (input: AssistantStateReadInput = {}) => {
    const observedAt = now()
    const [workspace, attemptSnapshot] = await Promise.all([
      options.workspace.readWorkspaceForControl(),
      options.attempts.snapshot(),
    ])
    const runningAttempts = attemptSnapshot.running()
    const activeCounts = responsibilityCounts(runningAttempts)
    const runningAttemptsByWork = new Map<string, RunAttemptSummary>()
    for (const attempt of runningAttempts) {
      const key = `${attempt.projectId}/${attempt.goalId}/${attempt.workId}`
      if (!runningAttemptsByWork.has(key)) runningAttemptsByWork.set(key, attempt)
    }
    const activeRunViews: AssistantStateActiveRun[] = []
    const selected = input.projectId
      ? [requireProject(options.projects, input.projectId)]
      : [...options.projects.values()].sort((left, right) =>
          left.projectId.localeCompare(right.projectId),
        )
    const workspaceAttentions = [...workspace.attentions.values()]
      .filter((attention) => attention.attributes.resolvedAt === null)
      .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
      .map((attention) => {
        const {
          target: _target,
          notifiedAt: _notifiedAt,
          operatorRequest: _operatorRequest,
          ...attributes
        } = attention.attributes
        return {
          reference: workspaceAttentionReference(workspace.homeId, attention.attributes.id),
          projectId: workspaceAttentionProjectId(attention),
          ...attributes,
          body: boundedText(attention.body, 1_200),
          inspectionPath: resolve(
            options.workspace.root.path,
            options.workspace.paths.attention(attention.attributes.id),
          ),
        }
      })

    const projects = await Promise.all(
      selected.map(async (project) => {
        try {
          const goalPackages = await project.store.readReconciliationSnapshot()
          const goalIds = input.goalId ? [input.goalId] : [...goalPackages.keys()]
          const goals = await Promise.all(
            goalIds.toSorted().map(async (goalId) => {
              const goalPackage = goalPackages.get(goalId)
              if (!goalPackage) throw new AssistantToolRequestError(`Goal not found: ${goalId}`)
              const prefix = `${project.projectId}/${goalId}/`
              const liveWorkIds = new Set(
                runningAttempts
                  .filter(
                    (attempt) =>
                      attempt.projectId === project.projectId && attempt.goalId === goalId,
                  )
                  .map((attempt) => attempt.workId),
              )
              const failedWorkIds = await settledFailureWorkIds(
                goalPackage,
                attemptSnapshot.listGoal(project.projectId, goalId),
                liveWorkIds,
              )
              const projections = deriveGoalWorkProjections(
                project.projectId,
                goalId,
                goalPackage,
                {
                  projectEligible: true,
                  liveRunWorkIds: liveWorkIds,
                  settledFailureWorkIds: failedWorkIds,
                  passCapacity: {
                    planner:
                      activeCounts.planner <
                      (options.concurrency?.planner ?? Number.POSITIVE_INFINITY),
                    generator:
                      activeCounts.generator <
                      (options.concurrency?.generator ?? Number.POSITIVE_INFINITY),
                    reviewer:
                      activeCounts.reviewer <
                      (options.concurrency?.reviewer ?? Number.POSITIVE_INFINITY),
                  },
                  now: observedAt,
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
                    const runningAttempt = runningAttemptsByWork.get(key) ?? null
                    const runtime = await readWorkRuntime({
                      homeRoot,
                      projectRoot: project.projectRoot,
                      projectId: project.projectId,
                      goalId,
                      workId: work.attributes.id,
                      activeResponsibility: runningAttempt?.responsibility ?? null,
                      attemptSnapshot,
                      attemptStore: options.attempts,
                      observedAt,
                      staleAfterMs,
                    })
                    if (runningAttempt) {
                      activeRunViews.push({
                        projectId: project.projectId,
                        goalId,
                        workId: work.attributes.id,
                        responsibility: runningAttempt.responsibility,
                        runId: runningAttempt.runId,
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
                    const candidateIntegration =
                      isEngineeringWork(work.attributes) && !isWorkTerminal(work.attributes)
                        ? await readCandidateIntegration({
                            project,
                            goalId,
                            work,
                            worktrees,
                          })
                        : null
                    return {
                      attributes: input.includeEvidence
                        ? work.attributes
                        : compactWorkAttributes(work),
                      path: project.store.paths.absolute(
                        project.store.paths.workDocument(goalId, work.attributes.id),
                      ),
                      ...(candidateIntegration ? { candidateIntegration } : {}),
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
              const design = await options.publisher.snapshotTree(
                project.store.paths.publicationRoot,
                project.store.paths.designRoot(goalId),
              )

              return {
                goal: {
                  attributes: goalPackage.goal.attributes,
                  body: boundedText(goalPackage.goal.body, input.includeEvidence ? 4_000 : 800),
                  path: project.store.paths.absolute(project.store.paths.goalDocument(goalId)),
                },
                design: design.files.flatMap((file) =>
                  file.content
                    ? [
                        {
                          canonicalPath: file.path,
                          path: project.store.paths.absolute(file.path),
                          hash: file.hash,
                          excerpt: boundedText(
                            new TextDecoder().decode(file.content),
                            input.goalId ? 4_000 : 1_200,
                          ),
                        },
                      ]
                    : [],
                ),
                attentions: [...goalPackage.attentions.values()]
                  .filter((attention) => attention.attributes.resolvedAt === null)
                  .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
                  .map((attention) => ({
                    reference: goalAttentionReference(
                      project.projectId,
                      goalId,
                      attention.attributes.id,
                    ),
                    attributes: attention.attributes,
                    body: boundedText(attention.body, input.includeEvidence ? 4_000 : 1_200),
                    path: project.store.paths.absolute(
                      project.store.paths.attentionDocument(goalId, attention.attributes.id),
                    ),
                  })),
                latestPlanningOutcome,
                works,
              }
            }),
          )
          const repos = project.repos
            ? project.repos.map((repo) => ({
                ...(repo.repoId ? { repoId: repo.repoId } : {}),
                ...(repo.repoPath ? { repoPath: repo.repoPath } : {}),
                projectPath: repo.projectPath,
                integrationRoot: repo.integrationRoot,
                ...(repo.primary !== undefined ? { primary: repo.primary } : {}),
              }))
            : undefined
          return {
            projectId: project.projectId,
            projectRoot: project.projectRoot,
            ...(project.primaryRepoId ? { primaryRepoId: project.primaryRepoId } : {}),
            ...(repos ? { repos } : {}),
            available: true,
            releaseHead: await releaseHead(project.projectRoot, project.projectId),
            goals,
          }
        } catch (error) {
          return {
            projectId: project.projectId,
            projectRoot: project.projectRoot,
            ...(project.sourceRoot ? { sourceRoot: project.sourceRoot } : {}),
            available: false,
            releaseHead: null,
            error: errorMessage(error),
            inspectionPaths: {
              projectRoot: project.projectRoot,
              publicationRoot: project.store.paths.publicationRoot.path,
            },
            goals: [],
          }
        }
      }),
    )

    const projectIds = new Set(projects.map((project) => project.projectId))
    const attentionProjectId = (attention: DigestWorkspaceAttention) =>
      attention.projectId && projectIds.has(attention.projectId) ? attention.projectId : null
    const [stateDigest, homeDigest, projectDigestEntries] = await Promise.all([
      semanticDigest(projects, workspaceAttentions),
      semanticDigest(
        [],
        workspaceAttentions.filter((attention) => attentionProjectId(attention) === null),
      ),
      Promise.all(
        projects.map(
          async (project) =>
            [
              project.projectId,
              await semanticDigest(
                [project],
                workspaceAttentions.filter(
                  (attention) => attentionProjectId(attention) === project.projectId,
                ),
              ),
            ] as const,
        ),
      ),
    ])

    return {
      observedAt: observedAt.toISOString(),
      stateDigest,
      conversationDigests: {
        home: homeDigest,
        projects: Object.fromEntries(projectDigestEntries),
      },
      activeRuns: activeRunViews.sort(
        (left, right) =>
          left.projectId.localeCompare(right.projectId) ||
          left.goalId.localeCompare(right.goalId) ||
          left.workId.localeCompare(right.workId),
      ),
      workspaceAttentions,
      projects,
    }
  }

  const reflectionSourceToken = async () => {
    const roots = [
      options.workspace.root,
      ...[...options.projects.values()]
        .sort((left, right) => left.projectId.localeCompare(right.projectId))
        .map((project) => project.store.paths.publicationRoot),
    ]
    const generations = await Promise.all(roots.map((root) => options.publisher.generation(root)))
    return JSON.stringify([options.attempts.generation(), ...generations])
  }

  return {
    read,
    async readForReflection() {
      const before = await reflectionSourceToken()
      if (
        before &&
        reflectionCache?.token === before &&
        reflectionCache.snapshot.activeRuns.length === 0
      ) {
        return reflectionCache.snapshot
      }
      const snapshot = await read()
      const after = await reflectionSourceToken()
      if (before && after === before && snapshot.activeRuns.length === 0) {
        reflectionCache = { token: before, snapshot }
      }
      return snapshot
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
    ...(attributes.kind === 'engineering'
      ? {
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
              kind: artifact.kind,
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
  const attempts = input.attemptSnapshot.list(input.projectId, input.goalId, input.workId)
  const latest = attempts[0] ?? null
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
  const recentAttempts = await Promise.all(
    attempts.slice(0, 3).map(async (attempt) => ({
      ...compactAttemptIndex(attempt),
      artifactPreservation: await readArtifactPreservation({
        homeRoot: input.homeRoot,
        projectId: input.projectId,
        goalId: input.goalId,
        workId: input.workId,
        runId: attempt.runId,
      }),
    })),
  )

  return {
    activeResponsibility: input.activeResponsibility,
    latestAttempt: latest ? boundedAttempt(latest) : null,
    attemptCount: attempts.length,
    recentAttempts,
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
    artifacts: join(runRoot, 'artifacts.json'),
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

async function readArtifactPreservation(input: {
  homeRoot: string
  projectId: string
  goalId: string
  workId: string
  runId: string
}) {
  const runRoot = await existingRunRoot(
    input.homeRoot,
    input.projectId,
    input.goalId,
    input.workId,
    input.runId,
  )
  if (!runRoot) return null
  const path = join(runRoot, 'artifacts.json')
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    const value = await file.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const manifest = value as Record<string, unknown>
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : []
    const unavailable = Array.isArray(manifest.unavailable) ? manifest.unavailable : []
    return {
      path,
      preserved: artifacts.slice(0, 20),
      preservedOmitted: Math.max(0, artifacts.length - 20),
      unavailable: unavailable.slice(0, 20),
      unavailableOmitted: Math.max(0, unavailable.length - 20),
    }
  } catch (error) {
    return { path, error: errorMessage(error) }
  }
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

async function readCandidateIntegration(input: {
  project: AssistantStateProject
  goalId: string
  work: WorkDocument
  worktrees: ReturnType<typeof createStableWorktreeManager>
}) {
  if (!isEngineeringWork(input.work.attributes)) return []
  const primaryRepoId = input.project.primaryRepoId ?? 'primary'
  const repos = input.project.repos?.length
    ? input.project.repos
    : [
        {
          repoId: primaryRepoId,
          integrationRoot: input.project.projectRoot,
          projectPath: '.',
          primary: true,
        },
      ]
  const scratchRoot = await mkdtemp(join(tmpdir(), 'hopi-assistant-candidate-'))
  try {
    return await Promise.all(
      repos.map(async (repo, index) => {
        const repoId = repo.repoId ?? primaryRepoId
        try {
          const task = await input.worktrees.inspect({
            projectRoot: repo.integrationRoot,
            projectId: input.project.projectId,
            goalId: input.goalId,
            workId: input.work.attributes.id,
            repoId,
            primaryRepoId,
          })
          if (!task) {
            return {
              repoId,
              kind: 'unavailable' as const,
              detail: 'Task worktree is not materialized.',
            }
          }
          return {
            repoId,
            kind: 'observed' as const,
            ...(await inspectSourceMerge({
              repoRoot: repo.integrationRoot,
              taskRoot: task.path,
              releaseRef: projectReleaseRef(input.project.projectId),
              indexPath: join(scratchRoot, `${index}.index`),
            })),
          }
        } catch (error) {
          return {
            repoId,
            kind: 'unavailable' as const,
            detail: error instanceof Error ? error.message : String(error),
          }
        }
      }),
    )
  } finally {
    await rm(scratchRoot, { recursive: true, force: true })
  }
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

function compactAttemptIndex(attempt: RunAttemptSummary) {
  return {
    runId: attempt.runId,
    responsibility: attempt.responsibility,
    status: attempt.status,
    result: attempt.result,
    application: attempt.application,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    summary:
      attempt.summary && attempt.summary.length > 240
        ? `${attempt.summary.slice(0, 240)}...`
        : attempt.summary,
  }
}

async function semanticDigest(
  projects: DigestProject[],
  workspaceAttentions: DigestWorkspaceAttention[],
) {
  const semantic = {
    workspaceAttentions: workspaceAttentions.map(
      ({ body: _body, reference: _reference, ...attributes }) => attributes,
    ),
    projects: projects.map((project) => ({
      projectId: project.projectId,
      available: project.available,
      releaseHead: project.releaseHead,
      ...(project.error ? { error: project.error } : {}),
      goals: project.goals.map((goal) => ({
        goal: goal.goal.attributes,
        latestPlanningOutcome: goal.latestPlanningOutcome
          ? {
              attributes: goal.latestPlanningOutcome.attributes,
              terminalAttempt: latestTerminalAttempt(goal.latestPlanningOutcome.runtime),
              stale: goal.latestPlanningOutcome.runtime.stale,
            }
          : null,
        works: goal.works.map((work) => ({
          attributes: work.attributes,
          ...(work.candidateIntegration ? { candidateIntegration: work.candidateIntegration } : {}),
          terminalAttempt: latestTerminalAttempt(work.runtime),
          stale: work.runtime.stale,
        })),
        attentions: goal.attentions.map((attention) => attention.attributes),
        design: goal.design.map(({ canonicalPath, hash }) => ({ canonicalPath, hash })),
      })),
    })),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(semantic))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function latestTerminalAttempt(runtime: DigestRuntime) {
  if (runtime.latestAttempt?.status !== 'running') return runtime.latestAttempt
  const settled = runtime.recentAttempts.find((attempt) => attempt.status !== 'running')
  if (!settled) return null
  return {
    runId: settled.runId,
    responsibility: settled.responsibility,
    status: settled.status,
    result: settled.result,
    application: settled.application,
  }
}

function responsibilityCounts(active: readonly RunAttemptSummary[]) {
  const counts: Record<Responsibility, number> = { planner: 0, generator: 0, reviewer: 0 }
  for (const attempt of active) counts[attempt.responsibility] += 1
  return counts
}

function boundedText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

async function releaseHead(projectRoot: string, projectId: string) {
  const child = Bun.spawn(['git', 'rev-parse', projectReleaseRef(projectId)], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return exitCode === 0 ? stdout.trim() : null
}

async function pathExists(path: string) {
  return (await stat(path).catch(() => null)) !== null
}

function requireProject(projects: ReadonlyMap<string, AssistantStateProject>, projectId: string) {
  const project = projects.get(projectId)
  if (!project) throw new AssistantToolRequestError(`Project not found: ${projectId}`)
  return project
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
