import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type WorkspaceAttentionAttributes,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import { goalAttentionReference, workspaceAttentionReference } from '../domain/attentionReference'
import { parseWorkAttentionTarget } from '../domain/attentionTarget'
import {
  type AttentionAttributes,
  type GoalAttributes,
  type InputAttributes,
  type WorkAttributes,
  type WorkDocument,
  isEngineeringWork,
  isWorkTerminal,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { projectReleaseRef } from '../domain/project'
import { type WorkProjection, deriveGoalWorkProjections } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
import {
  EvidenceArtifactResolutionError,
  evidenceArtifactUrl,
  resolveEvidenceArtifact,
} from '../runtime/evidenceArtifacts'
import type {
  RunAttemptSnapshot,
  RunAttemptStore,
  RunAttemptSummary,
} from '../runtime/runAttemptStore'
import { runStoragePath } from '../runtime/runPaths'
import { WORKER_CONCURRENCY } from '../runtime/softwareDelivery'
import { inspectSourceMerge } from '../runtime/sourceMergePreflight'
import { createStableWorktreeManager } from '../runtime/stableWorktreeManager'
import { currentSettledWorkIds } from '../runtime/workAssignment'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { AssistantToolRequestError } from './assistantToolRequestError'

const DEFAULT_ATTEMPT_STALE_AFTER_MS = 10 * 60 * 1_000

export interface AssistantStateProject {
  projectId: string
  label?: string
  projectRoot: string
  sourceRoot: string
  primaryRepoId: string
  repos: readonly {
    repoId: string
    repoPath: string
    integrationRoot: string
    projectPath: string
    primary: boolean
  }[]
  store: GoalPackageStore
}

export interface AssistantStateReader {
  read(input?: AssistantStateReadInput): Promise<AssistantStateSnapshot>
  readForWake(): Promise<AssistantStateSnapshot>
}

export interface AssistantStateReadInput {
  projectId?: string
  goalId?: string
  includeEvidence?: boolean
  attemptHistoryLimit?: number
}

export interface AssistantStateSnapshot {
  observedAt: string
  stateDigest: string
  conversationDigests: {
    home: string
    projects: Record<string, string>
  }
  activeRuns: AssistantStateActiveRun[]
  workspaceAttentions: AssistantStateWorkspaceAttention[]
  projects: AssistantStateProjectSnapshot[]
}

export interface AssistantStateActiveRun {
  projectId: string
  goalId: string
  workId: string
  runId: string
  status: 'queued' | 'running'
  requestedAt: string
  startedAt: string | null
  waitReason: 'capacity' | null
}

export interface AssistantStateWorkspaceAttention extends WorkspaceAttentionAttributes {
  reference: string
  projectId: string | null
  body: string
  inspectionPath: string
}

export interface AssistantStateRuntime {
  active: boolean
  latestAttempt: RunAttemptSummary | null
  attemptCount: number
  recentAttempts: AssistantStateRecentAttempt[]
  lastActivityAt: string | null
  stale: boolean
  worktree: { path: string; exists: boolean }
  paths: Partial<
    Record<
      'root' | 'attempt' | 'events' | 'transcript' | 'context' | 'prompt' | 'report' | 'artifacts',
      string
    >
  >
}

export interface AssistantStateWorkAttributes {
  id: string
  title: string
  kind: WorkAttributes['kind']
  status: WorkAttributes['status']
  createdAt: string
  notBefore: string | null
  dependsOn: string[]
  contractRevision: number
  evidenceRefs?: string[]
  contextRefs?: WorkAttributes['contextRefs']
  ownerMessages?: WorkAttributes['ownerMessages']
  revisionInput?: string
  decisionType?: 'research' | 'prototype' | 'grilling' | 'task'
  taskMode?: 'afk' | 'hitl'
}

export interface AssistantStateWorkSnapshot {
  attributes: AssistantStateWorkAttributes
  body: string
  path: string
  candidateIntegration?: AssistantStateCandidateIntegration
  projection: WorkProjection | null
  runtime: AssistantStateRuntime
  evidence?: AssistantStateEvidence
}

export interface AssistantStateGoalSnapshot {
  goal: { attributes: GoalAttributes; body: string; path: string }
  acceptedInputs: Array<{
    attributes: InputAttributes
    body: string
    path: string
  }>
  works: AssistantStateWorkSnapshot[]
  attentions: Array<{
    reference: string
    attributes: AttentionAttributes
    body: string
    path: string
  }>
  design: Array<{
    canonicalPath: string
    path: string
    hash: string | null
    excerpt: string
  }>
}

export interface AssistantStateProjectSnapshot {
  projectId: string
  label?: string
  projectRoot: string
  sourceRoot: string
  primaryRepoId: string
  repos: readonly {
    repoId: string
    repoPath: string
    integrationRoot: string
    projectPath: string
    primary: boolean
  }[]
  available: boolean
  releaseHead: string | null
  error?: string
  inspectionPaths?: { projectRoot: string; publicationRoot: string }
  goals: AssistantStateGoalSnapshot[]
}

export type AssistantStateRecentAttempt = ReturnType<typeof compactAttemptIndex> & {
  artifactPreservation: Awaited<ReturnType<typeof readArtifactPreservation>>
}
export type AssistantStateCandidateIntegration = Awaited<
  ReturnType<typeof readCandidateIntegration>
>
export type AssistantStateEvidenceSummary = ReturnType<typeof readWorkEvidenceSummary>
export type AssistantStateEvidenceDetail = Awaited<ReturnType<typeof readWorkEvidence>>[number]
export type AssistantStateEvidence = AssistantStateEvidenceSummary | AssistantStateEvidenceDetail[]

export function createAssistantStateReader(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantStateProject>
  publisher: PublicationCoordinator
  attempts: RunAttemptStore
  now?: () => Date
  staleAfterMs?: number
}): AssistantStateReader {
  const homeRoot = resolve(options.homeRoot)
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_ATTEMPT_STALE_AFTER_MS
  const worktrees = createStableWorktreeManager()
  let wakeCache: { token: string; snapshot: AssistantStateSnapshot } | null = null

  const read = async (input: AssistantStateReadInput = {}) => {
    const observedAt = now()
    const [workspace, attemptSnapshot] = await Promise.all([
      options.workspace.readWorkspaceForControl(),
      options.attempts.snapshot(),
    ])
    const runningAttempts = attemptSnapshot.running()
    const activeAttempts = [...runningAttempts, ...attemptSnapshot.queued()]
    const runningCount = runningAttempts.length
    const runningAttemptsByWork = new Map<string, RunAttemptSummary>()
    for (const attempt of runningAttempts) {
      const key = `${attempt.projectId}/${attempt.goalId}/${attempt.workId}`
      if (!runningAttemptsByWork.has(key)) runningAttemptsByWork.set(key, attempt)
    }
    const selected = input.projectId
      ? [requireProject(options.projects, input.projectId)]
      : [...options.projects.values()].sort((left, right) =>
          left.projectId.localeCompare(right.projectId),
        )
    const selectedProjectIds = new Set(selected.map((project) => project.projectId))
    const activeRunViews = activeAttempts
      .filter(
        (attempt) =>
          selectedProjectIds.has(attempt.projectId) &&
          (!input.goalId || attempt.goalId === input.goalId),
      )
      .map((attempt) => presentActiveAttempt(attempt, runningCount))
    const workspaceAttentions = [...workspace.attentions.values()]
      .filter((attention) => attention.attributes.resolvedAt === null)
      .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
      .map((attention) => ({
        reference: workspaceAttentionReference(workspace.homeId, attention.attributes.id),
        projectId: workspaceAttentionProjectId(attention),
        ...attention.attributes,
        body: boundedText(attention.body, 1_200),
        inspectionPath: resolve(
          options.workspace.root.path,
          options.workspace.paths.attention(attention.attributes.id),
        ),
      }))

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
              const queuedAttempts = attemptSnapshot
                .queued()
                .filter(
                  (attempt) => attempt.projectId === project.projectId && attempt.goalId === goalId,
                )
              const attemptsByWork = attemptSnapshot.listGoal(project.projectId, goalId)
              const projections = deriveGoalWorkProjections(
                project.projectId,
                goalId,
                goalPackage,
                {
                  projectEligible: true,
                  runningWorkIds: liveWorkIds,
                  queuedWorkIds: new Set(queuedAttempts.map((attempt) => attempt.workId)),
                  settledWorkIds: await currentSettledWorkIds(
                    goalPackage.works.values(),
                    attemptsByWork,
                  ),
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
                  .map((attention) => parseWorkAttentionTarget(attention.attributes.target))
                  .filter((target): target is NonNullable<typeof target> => target !== null)
                  .map((target) => target.workId),
              )
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
                      active: runningAttempt !== null,
                      attemptSnapshot,
                      attemptStore: options.attempts,
                      observedAt,
                      staleAfterMs,
                      attemptHistoryLimit: input.attemptHistoryLimit ?? 3,
                    })
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
                      body: boundedText(work.body, input.includeEvidence ? 8_000 : 4_000),
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
                acceptedInputs: goalPackage.inputs
                  .toSorted(
                    (left, right) =>
                      left.attributes.sourceHomeId.localeCompare(right.attributes.sourceHomeId) ||
                      left.attributes.sourceEventId.localeCompare(right.attributes.sourceEventId),
                  )
                  .map((acceptedInput) => ({
                    attributes: acceptedInput.attributes,
                    body: boundedText(acceptedInput.body, input.includeEvidence ? 4_000 : 1_200),
                    path: project.store.paths.absolute(
                      project.store.paths.inputDocument(
                        goalId,
                        acceptedInput.attributes.sourceHomeId,
                        acceptedInput.attributes.sourceEventId,
                      ),
                    ),
                  })),
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
                works,
              }
            }),
          )
          const repos = project.repos.map((repo) => ({
            repoId: repo.repoId,
            repoPath: repo.repoPath,
            projectPath: repo.projectPath,
            integrationRoot: repo.integrationRoot,
            primary: repo.primary,
          }))
          return {
            projectId: project.projectId,
            ...(project.label ? { label: project.label } : {}),
            projectRoot: project.projectRoot,
            sourceRoot: project.sourceRoot,
            primaryRepoId: project.primaryRepoId,
            repos,
            available: true,
            releaseHead: await releaseHead(project.projectRoot, project.projectId),
            goals,
          }
        } catch (error) {
          return {
            projectId: project.projectId,
            ...(project.label ? { label: project.label } : {}),
            projectRoot: project.projectRoot,
            sourceRoot: project.sourceRoot,
            primaryRepoId: project.primaryRepoId,
            repos: project.repos,
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
    const attentionProjectId = (attention: AssistantStateWorkspaceAttention) =>
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
      activeRuns: uniqueActiveRuns(activeRunViews),
      workspaceAttentions,
      projects,
    }
  }

  const wakeSourceToken = async () => {
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
    async readForWake() {
      const before = await wakeSourceToken()
      if (before && wakeCache?.token === before && wakeCache.snapshot.activeRuns.length === 0) {
        return wakeCache.snapshot
      }
      const snapshot = await read({ attemptHistoryLimit: 12 })
      const after = await wakeSourceToken()
      if (before && after === before && snapshot.activeRuns.length === 0) {
        wakeCache = { token: before, snapshot }
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
    status: attributes.status,
    createdAt: attributes.createdAt,
    notBefore: attributes.notBefore,
    dependsOn: attributes.dependsOn,
    contractRevision: attributes.contractRevision,
    ...(attributes.kind === 'decision'
      ? {
          decisionType: attributes.decisionType,
          ...(attributes.taskMode ? { taskMode: attributes.taskMode } : {}),
        }
      : {}),
  }
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
  active: boolean
  attemptSnapshot: RunAttemptSnapshot
  attemptStore: RunAttemptStore
  observedAt: Date
  staleAfterMs: number
  attemptHistoryLimit: number
}) {
  const attempts = input.attemptSnapshot.list(input.projectId, input.goalId, input.workId)
  const latest = attempts[0] ?? null
  const runRoot = latest ? await existingRunRoot(input.homeRoot, latest.runId) : null
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
    input.active &&
      latest?.status === 'running' &&
      lastActivityAt &&
      input.observedAt.getTime() - new Date(lastActivityAt).getTime() >= input.staleAfterMs,
  )
  const worktreePath = join(resolve(input.projectRoot, '..'), 'work', input.goalId, input.workId)
  const recentAttempts = await Promise.all(
    attempts.slice(0, input.attemptHistoryLimit).map(async (attempt) => ({
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
    active: input.active,
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
    report: join(runRoot, 'report.md'),
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
  const runRoot = await existingRunRoot(input.homeRoot, input.runId)
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

async function existingRunRoot(homeRoot: string, runId: string) {
  const root = runStoragePath(homeRoot, runId)
  return (await pathExists(root)) ? root : null
}

async function readCandidateIntegration(input: {
  project: AssistantStateProject
  goalId: string
  work: WorkDocument
  worktrees: ReturnType<typeof createStableWorktreeManager>
}) {
  if (!isEngineeringWork(input.work.attributes)) return []
  const primaryRepoId = input.project.primaryRepoId
  const repos = input.project.repos
  const scratchRoot = await mkdtemp(join(tmpdir(), 'hopi-assistant-candidate-'))
  try {
    return await Promise.all(
      repos.map(async (repo, index) => {
        const repoId = repo.repoId
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
    reportMarkdown:
      attempt.reportMarkdown && attempt.reportMarkdown.length > 4_000
        ? `${attempt.reportMarkdown.slice(0, 4_000)}...`
        : attempt.reportMarkdown,
  }
}

function compactAttemptIndex(attempt: RunAttemptSummary) {
  return {
    runId: attempt.runId,
    status: attempt.status,
    termination: attempt.termination,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    reportMarkdown:
      attempt.reportMarkdown && attempt.reportMarkdown.length > 1_000
        ? `${attempt.reportMarkdown.slice(0, 1_000)}...`
        : attempt.reportMarkdown,
  }
}

async function semanticDigest(
  projects: AssistantStateProjectSnapshot[],
  workspaceAttentions: AssistantStateWorkspaceAttention[],
) {
  const semantic = {
    workspaceAttentions: workspaceAttentions.map(
      ({ body: _body, reference: _reference, ...attributes }) => attributes,
    ),
    projects: projects.map((project) => ({
      projectId: project.projectId,
      ...(project.label ? { label: project.label } : {}),
      available: project.available,
      releaseHead: project.releaseHead,
      ...(project.error ? { error: project.error } : {}),
      goals: project.goals.map((goal) => ({
        goal: goal.goal.attributes,
        acceptedInputs: goal.acceptedInputs.map((acceptedInput) => acceptedInput.attributes),
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

function uniqueActiveRuns(runs: AssistantStateActiveRun[]) {
  return [...new Map(runs.map((run) => [run.runId, run])).values()].sort(
    (left, right) =>
      left.projectId.localeCompare(right.projectId) ||
      left.goalId.localeCompare(right.goalId) ||
      left.workId.localeCompare(right.workId),
  )
}

function presentActiveAttempt(
  attempt: RunAttemptSummary,
  runningCount: number,
): AssistantStateActiveRun {
  return {
    projectId: attempt.projectId,
    goalId: attempt.goalId,
    workId: attempt.workId,
    runId: attempt.runId,
    status: attempt.status === 'queued' ? 'queued' : 'running',
    requestedAt: attempt.requestedAt,
    startedAt: attempt.startedAt,
    waitReason:
      attempt.status === 'queued' && runningCount >= WORKER_CONCURRENCY ? 'capacity' : null,
  }
}

function latestTerminalAttempt(runtime: AssistantStateRuntime) {
  if (runtime.latestAttempt?.status !== 'running') return runtime.latestAttempt
  const settled = runtime.recentAttempts.find((attempt) => attempt.status === 'settled')
  if (!settled) return null
  return {
    runId: settled.runId,
    status: settled.status,
    termination: settled.termination,
  }
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
