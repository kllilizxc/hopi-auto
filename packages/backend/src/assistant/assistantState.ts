import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isWorkTerminal } from '../domain/canonicalDocuments'
import { deriveGoalWorkProjections } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
import type { Responsibility } from '../runtime/roleContextStager'
import type { RunAttemptStore, RunAttemptSummary } from '../runtime/runAttemptStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'

export const DEFAULT_ATTEMPT_STALE_AFTER_MS = 10 * 60 * 1_000

export interface AssistantStateProject {
  projectId: string
  projectRoot: string
  store: GoalPackageStore
  reconciler?: {
    operationallyDeferredWorkIds?(goalId: string, observedAt?: Date): ReadonlySet<string>
  }
}

export interface AssistantStateReader {
  read(input?: { projectId?: string; goalId?: string }): Promise<AssistantStateSnapshot>
}

export interface AssistantStateSnapshot {
  observedAt: string
  stateDigest: string
  activeRuns: AssistantStateActiveRun[]
  workspaceAttentions: unknown[]
  projects: unknown[]
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
  body: string
}

interface DigestProject {
  projectId: string
  available: boolean
  releaseHead: string | null
  goals: Array<{
    goal: { attributes: unknown }
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
  now?: () => Date
  staleAfterMs?: number
}): AssistantStateReader {
  const homeRoot = resolve(options.homeRoot)
  const now = options.now ?? (() => new Date())
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_ATTEMPT_STALE_AFTER_MS

  return {
    async read(input = {}) {
      const observedAt = now()
      const workspace = await options.workspace.readWorkspace()
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
        .map((attention) => ({ ...attention.attributes, body: attention.body }))

      const projects = await Promise.all(
        selected.map(async (project) => {
          const projectAttentionOpen = workspaceAttentions.some(
            (attention) =>
              attention.target === `project:${project.projectId}` && attention.resolvedAt === null,
          )
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
                  projectAttentionOpen,
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
              const works = await Promise.all(
                [...goalPackage.works.values()]
                  .filter(
                    (work) =>
                      work.attributes.kind === 'engineering' || !isWorkTerminal(work.attributes),
                  )
                  .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
                  .map(async (work) => {
                    const key = `${prefix}${work.attributes.id}`
                    const runtime = await readWorkRuntime({
                      homeRoot,
                      projectId: project.projectId,
                      goalId,
                      workId: work.attributes.id,
                      activeResponsibility: activeRuns.get(key) ?? null,
                      attempts: options.attempts,
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
                    return {
                      attributes: work.attributes,
                      path: project.store.paths.absolute(
                        project.store.paths.workDocument(goalId, work.attributes.id),
                      ),
                      projection: projectionByWork.get(work.attributes.id) ?? null,
                      runtime,
                    }
                  }),
              )
              const design = input.goalId
                ? await options.publisher.snapshotTree(
                    project.store.paths.publicationRoot,
                    project.store.paths.designRoot(goalId),
                  )
                : null

              return {
                goal: {
                  attributes: goalPackage.goal.attributes,
                  body: boundedText(goalPackage.goal.body, 4_000),
                  path: project.store.paths.absolute(project.store.paths.goalDocument(goalId)),
                },
                works,
                attentions: [...goalPackage.attentions.values()]
                  .filter((attention) => attention.attributes.resolvedAt === null)
                  .sort((left, right) => left.attributes.id.localeCompare(right.attributes.id))
                  .map((attention) => ({
                    attributes: attention.attributes,
                    body: boundedText(attention.body, 4_000),
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
          return {
            projectId: project.projectId,
            projectRoot: project.projectRoot,
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
      }
    },
  }
}

async function readWorkRuntime(input: {
  homeRoot: string
  projectId: string
  goalId: string
  workId: string
  activeResponsibility: Responsibility | null
  attempts: RunAttemptStore
  observedAt: Date
  staleAfterMs: number
}) {
  const latest = (await input.attempts.list(input.projectId, input.goalId, input.workId))[0] ?? null
  const runRoot = latest
    ? join(
        input.homeRoot,
        '.hopi',
        'runtime',
        'runs',
        input.projectId,
        input.goalId,
        input.workId,
        latest.runId,
      )
    : null
  const detail = latest
    ? await input.attempts.read(input.projectId, input.goalId, input.workId, latest.runId)
    : null
  const paths = runRoot ? await existingRunPaths(runRoot) : {}
  const lastActivityAt = latest
    ? await latestActivity(latest, detail?.events ?? [], paths.transcript ?? null)
    : null
  const stale = Boolean(
    input.activeResponsibility &&
      latest?.status === 'running' &&
      lastActivityAt &&
      input.observedAt.getTime() - new Date(lastActivityAt).getTime() >= input.staleAfterMs,
  )
  const worktreePath = join(
    input.homeRoot,
    '.hopi',
    'runtime',
    'worktrees',
    input.projectId,
    input.goalId,
    input.workId,
  )

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
