import { copyFile, mkdir, readdir, rename, rmdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { resolveProjectPath } from '../domain/projectPath'
import { legacyManagedRepoWorktreePaths, managedRepoWorktreePaths } from './managedWorktreePaths'
import { cleanupRunScratch, preserveRunArtifacts } from './runArtifacts'

interface StoredProjectRepoLink {
  repoId: string
  repoPath: string
  projectPath?: string
}

interface StoredProjectLink {
  projectId: string
  primaryRepoId?: string
  repoPath?: string
  repos?: StoredProjectRepoLink[]
}

interface StoredProjectLinks {
  projects?: StoredProjectLink[]
}

interface RunLocation {
  runId: string
  runRoot: string
  legacyRunRoot: string
}

export interface AssistantHomeMigrationSummary {
  relocated: boolean
  from: string
  to: string
  flattenedRuns: number
  preservedArtifacts: number
  rewrittenEvidenceFiles: number
  removedScratchRoots: number
  warnings: readonly string[]
}

export function defaultAssistantHomeRoot(
  env: { XDG_DATA_HOME?: string } = process.env as { XDG_DATA_HOME?: string },
  userHome = homedir(),
) {
  const dataRoot = env.XDG_DATA_HOME?.trim()
  return resolve(
    dataRoot && isAbsolute(dataRoot) ? dataRoot : join(userHome, '.local', 'share'),
    'hopi',
  )
}

export async function migrateRepositoryAssistantHome(input: {
  legacyRoot: string
  homeRoot: string
}): Promise<AssistantHomeMigrationSummary> {
  const legacyHopiRoot = join(resolve(input.legacyRoot), '.hopi')
  const targetHopiRoot = join(resolve(input.homeRoot), '.hopi')
  const summary: AssistantHomeMigrationSummary = {
    relocated: false,
    from: legacyHopiRoot,
    to: targetHopiRoot,
    flattenedRuns: 0,
    preservedArtifacts: 0,
    rewrittenEvidenceFiles: 0,
    removedScratchRoots: 0,
    warnings: [],
  }
  if (legacyHopiRoot === targetHopiRoot) return summary

  const [legacyExists, targetExists, trackedRepositoryFiles] = await Promise.all([
    pathExists(join(legacyHopiRoot, 'home.yml')),
    pathExists(targetHopiRoot),
    trackedHopiFiles(input.legacyRoot),
  ])
  if (legacyExists && targetExists) {
    throw new Error(
      `Both the legacy repository Home and external HOPI Home exist: ${legacyHopiRoot}, ${targetHopiRoot}`,
    )
  }
  if (legacyExists) {
    await mkdir(dirname(targetHopiRoot), { recursive: true })
    await rename(legacyHopiRoot, targetHopiRoot)
    await restoreTrackedRepositoryFiles(
      resolve(input.legacyRoot),
      targetHopiRoot,
      trackedRepositoryFiles,
    )
    summary.relocated = true
  }
  if (!(await pathExists(targetHopiRoot))) return summary

  const runMigration = await flattenAndFinalizeRuns(targetHopiRoot, legacyHopiRoot)
  summary.flattenedRuns = runMigration.flattenedRuns
  summary.preservedArtifacts = runMigration.preservedArtifacts
  summary.removedScratchRoots = runMigration.removedScratchRoots
  summary.warnings = runMigration.warnings
  summary.rewrittenEvidenceFiles = await rewriteLinkedEvidence(
    targetHopiRoot,
    runMigration.replacements,
  )
  await recordMigration(targetHopiRoot, summary)
  return summary
}

async function recordMigration(hopiRoot: string, summary: AssistantHomeMigrationSummary) {
  const changed =
    summary.relocated ||
    summary.flattenedRuns > 0 ||
    summary.preservedArtifacts > 0 ||
    summary.rewrittenEvidenceFiles > 0 ||
    summary.removedScratchRoots > 0 ||
    summary.warnings.length > 0
  const root = join(hopiRoot, 'runtime', 'migrations')
  const path = join(root, 'external-home-v1.json')
  const existing = await Bun.file(path)
    .json()
    .catch(() => null)
  if (!changed && existing) return

  const recordedAt = new Date().toISOString()
  const previous = migrationRecord(existing)
  const event = { recordedAt, ...summary }
  const record = {
    version: 1,
    migratedAt: previous?.migratedAt ?? recordedAt,
    updatedAt: recordedAt,
    relocated: Boolean(previous?.relocated || summary.relocated),
    from: summary.from,
    to: summary.to,
    flattenedRuns: (previous?.flattenedRuns ?? 0) + summary.flattenedRuns,
    preservedArtifacts: (previous?.preservedArtifacts ?? 0) + summary.preservedArtifacts,
    rewrittenEvidenceFiles:
      (previous?.rewrittenEvidenceFiles ?? 0) + summary.rewrittenEvidenceFiles,
    removedScratchRoots: (previous?.removedScratchRoots ?? 0) + summary.removedScratchRoots,
    warnings: summary.warnings,
    history: [...(previous?.history ?? []), event],
  }
  await mkdir(root, { recursive: true })
  await Bun.write(path, `${JSON.stringify(record, null, 2)}\n`)
}

function migrationRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    migratedAt: typeof record.migratedAt === 'string' ? record.migratedAt : undefined,
    relocated: record.relocated === true,
    flattenedRuns: numberField(record.flattenedRuns),
    preservedArtifacts: numberField(record.preservedArtifacts),
    rewrittenEvidenceFiles: numberField(record.rewrittenEvidenceFiles),
    removedScratchRoots: numberField(record.removedScratchRoots),
    history: Array.isArray(record.history) ? record.history : [],
  }
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

async function flattenAndFinalizeRuns(hopiRoot: string, legacyHopiRoot: string) {
  const runsRoot = join(hopiRoot, 'runtime', 'runs')
  const nested = await nestedRunLocations(runsRoot, legacyHopiRoot)
  let flattenedRuns = 0
  for (const location of nested) {
    const destination = join(runsRoot, location.runId)
    if (await pathExists(destination)) {
      throw new Error(`Cannot flatten duplicate Run ID ${location.runId}`)
    }
    await rename(location.runRoot, destination)
    await removeEmptyAncestors(dirname(location.runRoot), runsRoot)
    location.runRoot = destination
    flattenedRuns += 1
  }

  const locations = new Map<string, RunLocation>()
  for (const location of nested) locations.set(location.runId, location)
  for (const entry of await readDirectories(runsRoot)) {
    const runRoot = join(runsRoot, entry)
    if (!(await isRunRoot(runRoot))) continue
    const identity = await readRunIdentity(runRoot, entry)
    locations.set(entry, {
      runId: entry,
      runRoot,
      legacyRunRoot: join(
        legacyHopiRoot,
        'runtime',
        'runs',
        identity.projectId,
        identity.goalId,
        identity.workId,
        entry,
      ),
    })
  }

  const replacements = new Map<string, string>()
  const warnings: string[] = []
  let preservedArtifacts = 0
  let removedScratchRoots = 0
  for (const location of [...locations.values()].sort((left, right) =>
    left.runId.localeCompare(right.runId),
  )) {
    const resultFile = join(location.runRoot, 'result.json')
    const artifacts = await readResultArtifacts(resultFile)
    if (artifacts === null) continue
    try {
      const result = await preserveRunArtifacts({
        runId: location.runId,
        runRoot: location.runRoot,
        legacyRunRoot: location.legacyRunRoot,
        artifacts,
        resultFile,
      })
      preservedArtifacts += result.preserved.length
      for (const [source, reference] of result.replacements) {
        replacements.set(source, reference)
      }
      if (await runIsTerminal(location.runRoot)) {
        const scratch = join(location.runRoot, 'scratch')
        if (await pathExists(scratch)) {
          await cleanupRunScratch(scratch)
          removedScratchRoots += 1
        }
      }
    } catch (error) {
      warnings.push(`${location.runId}: ${errorMessage(error)}`)
    }
  }
  return {
    flattenedRuns,
    preservedArtifacts,
    removedScratchRoots,
    replacements,
    warnings,
  }
}

async function nestedRunLocations(runsRoot: string, legacyHopiRoot: string) {
  const locations: RunLocation[] = []
  for (const projectId of await readDirectories(runsRoot)) {
    const projectRoot = join(runsRoot, projectId)
    if (await isRunRoot(projectRoot)) continue
    for (const goalId of await readDirectories(projectRoot)) {
      const goalRoot = join(projectRoot, goalId)
      for (const workId of await readDirectories(goalRoot)) {
        const workRoot = join(goalRoot, workId)
        for (const runId of await readDirectories(workRoot)) {
          const runRoot = join(workRoot, runId)
          if (!(await isRunRoot(runRoot))) continue
          locations.push({
            runId,
            runRoot,
            legacyRunRoot: join(
              legacyHopiRoot,
              'runtime',
              'runs',
              projectId,
              goalId,
              workId,
              runId,
            ),
          })
        }
      }
    }
  }
  return locations
}

async function rewriteLinkedEvidence(hopiRoot: string, replacements: ReadonlyMap<string, string>) {
  if (replacements.size === 0) return 0
  const linksFile = Bun.file(join(hopiRoot, 'projects.yml'))
  if (!(await linksFile.exists())) return 0
  const links = parse(await linksFile.text()) as StoredProjectLinks
  let rewritten = 0
  for (const project of links.projects ?? []) {
    const binding = primaryProjectBinding(project)
    if (!binding) continue
    const integrationRoot = await existingIntegrationRoot(hopiRoot, project, binding)
    const projectRoot = resolveProjectPath(integrationRoot, binding.projectPath ?? '.')
    const glob = new Bun.Glob('.hopi/docs/goals/*/evidence/*.md')
    for await (const relativePath of glob.scan({ cwd: projectRoot, onlyFiles: true, dot: true })) {
      const path = join(projectRoot, relativePath)
      const file = Bun.file(path)
      let source = await file.text()
      const before = source
      for (const [legacyPath, reference] of replacements) {
        if (source.includes(legacyPath)) source = source.replaceAll(legacyPath, reference)
      }
      if (source === before) continue
      await Bun.write(path, source)
      rewritten += 1
    }
  }
  return rewritten
}

async function existingIntegrationRoot(
  hopiRoot: string,
  project: StoredProjectLink,
  binding: StoredProjectRepoLink,
) {
  const managedRoot = managedRepoWorktreePaths(binding.repoPath, project.projectId).integration
  const candidates = [
    managedRoot,
    legacyManagedRepoWorktreePaths(binding.repoPath).integration,
    binding.repoId === (project.primaryRepoId ?? binding.repoId)
      ? join(hopiRoot, 'projects', project.projectId, 'integration')
      : join(hopiRoot, 'projects', project.projectId, 'repos', binding.repoId, 'integration'),
  ]
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }
  return managedRoot
}

function primaryProjectBinding(project: StoredProjectLink): StoredProjectRepoLink | null {
  if (project.repos?.length) {
    return (
      project.repos.find((repo) => repo.repoId === project.primaryRepoId) ??
      project.repos[0] ??
      null
    )
  }
  return project.repoPath ? { repoId: 'primary', repoPath: project.repoPath } : null
}

async function readResultArtifacts(path: string): Promise<string[] | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  try {
    const source = await file.text()
    if (!source.trim()) return []
    const value = JSON.parse(source)
    if (!value || typeof value !== 'object' || !Array.isArray(value.artifacts)) return null
    return value.artifacts.every((artifact: unknown) => typeof artifact === 'string')
      ? value.artifacts
      : null
  } catch {
    return null
  }
}

async function readRunIdentity(runRoot: string, runId: string) {
  const manifest = await Bun.file(join(runRoot, 'attempt.json'))
    .json()
    .catch(() => null)
  if (
    manifest &&
    typeof manifest === 'object' &&
    typeof manifest.projectId === 'string' &&
    typeof manifest.goalId === 'string' &&
    typeof manifest.workId === 'string'
  ) {
    return {
      projectId: manifest.projectId,
      goalId: manifest.goalId,
      workId: manifest.workId,
    }
  }
  const context = await Bun.file(join(runRoot, 'context.md'))
    .text()
    .catch(() => '')
  const projectId = context.match(/^- Project: (.+)$/m)?.[1]
  const goalId = context.match(/^- Goal: (.+)$/m)?.[1]
  const workId = context.match(/^- Work: (.+)$/m)?.[1]
  if (!projectId || !goalId || !workId) {
    throw new Error(`Cannot recover identity for flattened Run ${runId}`)
  }
  return { projectId, goalId, workId }
}

async function runIsTerminal(runRoot: string) {
  const manifest = await Bun.file(join(runRoot, 'attempt.json'))
    .json()
    .catch(() => null)
  return !manifest || typeof manifest !== 'object' || manifest.status !== 'running'
}

async function isRunRoot(path: string) {
  return (
    (await Bun.file(join(path, 'attempt.json')).exists()) ||
    (await Bun.file(join(path, 'context.md')).exists())
  )
}

async function readDirectories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
}

async function pathExists(path: string) {
  return Boolean(await stat(path).catch(() => null))
}

async function trackedHopiFiles(repositoryRoot: string) {
  const child = Bun.spawn(['git', '-C', resolve(repositoryRoot), 'ls-files', '-z', '--', '.hopi'], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (exitCode !== 0) return []
  return stdout
    .split('\0')
    .filter((path) => path.startsWith('.hopi/') && !path.includes('\\') && !path.includes('/../'))
}

async function restoreTrackedRepositoryFiles(
  repositoryRoot: string,
  migratedHopiRoot: string,
  paths: readonly string[],
) {
  for (const path of paths) {
    const relativePath = path.slice('.hopi/'.length)
    const source = join(migratedHopiRoot, relativePath)
    if (!(await pathExists(source))) continue
    const destination = join(repositoryRoot, path)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
}

async function removeEmptyAncestors(start: string, stop: string) {
  let current = start
  while (resolve(current) !== resolve(stop)) {
    try {
      await rmdir(current)
    } catch (error) {
      if (errorCode(error) === 'ENOTEMPTY' || errorCode(error) === 'ENOENT') return
      throw error
    }
    current = dirname(current)
  }
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
