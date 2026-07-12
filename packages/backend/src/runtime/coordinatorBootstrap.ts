import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { isEngineeringWork, parseWorkDocument } from '../domain/canonicalDocuments'
import { HOPI_RELEASE_REF } from '../domain/project'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { listIntegrationRecords } from './c1Integrator'
import { createCompletionStructureVerifier } from './completionVerifier'
import type { WorkspaceAttentionController } from './workspaceAttentionController'

export interface CoordinatorBootstrapProject {
  projectId: string
  projectRoot: string
  store: GoalPackageStore
}

export interface CoordinatorBootstrapResult {
  homeId: string
  eligibleProjectIds: ReadonlySet<string>
  blockedProjectIds: ReadonlySet<string>
}

export class CoordinatorBootError extends Error {}

const HOPI_TEMPORARY_FILE =
  /(?:\.tmp\.|\.hopi-tmp-)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function bootstrapCoordinator(input: {
  homeRoot: string
  home: AssistantHomeStore
  workspace: AssistantWorkspaceStore
  projects: readonly CoordinatorBootstrapProject[]
  attentions: WorkspaceAttentionController
}): Promise<CoordinatorBootstrapResult> {
  const homeHopiRoot = join(input.homeRoot, '.hopi')
  await removeAbandonedTemporaryFiles(homeHopiRoot, new Set([join(homeHopiRoot, 'projects')]))
  await rm(join(input.homeRoot, '.hopi', 'runtime', 'leases'), {
    recursive: true,
    force: true,
  })

  let homeId: string
  try {
    const [home, workspace] = await Promise.all([
      input.home.readHome(),
      input.workspace.readWorkspace(),
    ])
    if (home.homeId !== workspace.homeId) throw new Error('Assistant home identity disagrees')
    homeId = home.homeId
  } catch (error) {
    throw new CoordinatorBootError(`Assistant home is invalid: ${errorMessage(error)}`)
  }

  const eligible = new Set<string>()
  const blocked = new Set<string>()
  for (const project of input.projects) {
    try {
      await removeAbandonedTemporaryFiles(
        project.projectRoot,
        new Set([join(project.projectRoot, '.git')]),
      )
      const linked = await input.home.validateProject(project.projectId)
      if (linked.integrationRoot !== project.projectRoot) {
        throw new Error('Project runtime root disagrees with the Assistant-home link')
      }
      await project.store.migrateLegacyGoals()
      await validateManagedProjection(project)
      eligible.add(project.projectId)
    } catch (error) {
      blocked.add(project.projectId)
      await input.attentions.ensureProjectAttention(
        project.projectId,
        `Project validation failed: ${errorMessage(error)}`,
      )
    }
  }
  return { homeId, eligibleProjectIds: eligible, blockedProjectIds: blocked }
}

async function validateManagedProjection(project: CoordinatorBootstrapProject) {
  // Index-reading Git commands may refresh and lock the index, so bootstrap must not race them.
  const head = await git(project.projectRoot, ['rev-parse', 'HEAD'])
  const target = await git(project.projectRoot, ['rev-parse', HOPI_RELEASE_REF])
  const indexTree = await git(project.projectRoot, ['write-tree'])
  const targetTree = await git(project.projectRoot, ['show', '-s', '--format=%T', HOPI_RELEASE_REF])
  const sourceStatus = await git(project.projectRoot, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.',
    ':(exclude).hopi/**',
  ])
  if (head !== target || indexTree !== targetTree) {
    throw new Error('managed integration index does not materialize the durable release ref')
  }
  const unsafeSourceStatus = sourceStatus
    .split('\n')
    .filter(Boolean)
    .filter((line) => line !== '?? AGENTS.md')
  if (unsafeSourceStatus.length > 0) {
    throw new Error(`managed integration source is dirty: ${unsafeSourceStatus.join(', ')}`)
  }

  const packages = new Map<string, Awaited<ReturnType<GoalPackageStore['readPackage']>>>()
  for (const goalId of await project.store.listGoalIds()) {
    const goalPackage = await project.store.readPackage(goalId)
    packages.set(goalId, goalPackage)
    if (!(await createCompletionStructureVerifier(project.store).verify(goalId, goalPackage))) {
      throw new Error(`Goal ${goalId} has invalid qualified C1 history`)
    }
  }

  const records = await listIntegrationRecords(project.projectRoot)
  const uniqueWork = new Set<string>()
  for (const record of records) {
    if (uniqueWork.has(record.workReference)) {
      throw new Error(`duplicate reachable C1 for ${record.workReference}`)
    }
    uniqueWork.add(record.workReference)
    const identity = parseWorkReference(project.projectId, record.workReference)
    const goalPackage = packages.get(identity.goalId)
    const work = goalPackage?.works.get(identity.workId)
    if (!work || !isEngineeringWork(work.attributes) || work.attributes.stage !== 'done') {
      throw new Error(
        `C1 ${record.commit} is not materialized as done Work ${record.workReference}`,
      )
    }
    const source = await gitBlob(
      project.projectRoot,
      `${record.commit}:${project.store.paths.workDocument(identity.goalId, identity.workId)}`,
    )
    if (!source || parseWorkDocument(source).attributes.stage !== 'done') {
      throw new Error(`C1 ${record.commit} does not contain done Work ${record.workReference}`)
    }
  }
}

function parseWorkReference(projectId: string, reference: string) {
  const pattern = new RegExp(
    `^project:${escapeRegex(projectId)}/goal:([A-Za-z0-9._-]+)/work:([A-Za-z0-9._-]+)$`,
  )
  const match = pattern.exec(reference)
  if (!match?.[1] || !match[2]) throw new Error(`C1 has invalid Work reference: ${reference}`)
  return { goalId: match[1], workId: match[2] }
}

async function removeAbandonedTemporaryFiles(root: string, skipped: ReadonlySet<string>) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (HOPI_TEMPORARY_FILE.test(entry.name)) {
      await rm(path, { recursive: true, force: true })
      continue
    }
    if (entry.isDirectory() && !skipped.has(path)) {
      await removeAbandonedTemporaryFiles(path, skipped)
    }
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim())
  return stdout.trim()
}

async function gitBlob(cwd: string, object: string) {
  const child = Bun.spawn(['git', 'show', object], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    child.exited,
  ])
  return exitCode === 0 ? new TextDecoder().decode(stdout) : null
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
