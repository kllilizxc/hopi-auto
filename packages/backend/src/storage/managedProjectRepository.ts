import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  type ProjectLink,
  type ProjectRepoLink,
  projectReleaseBranch,
  projectReleaseRef,
} from '../domain/project'
import {
  type GitProjectDirectoryInspection,
  ProjectDirectoryError,
  inspectGitProjectDirectory,
} from '../runtime/projectDirectory'
import { relocateRegisteredWorktree } from '../runtime/worktreeRelocator'
import type { AssistantHomePaths } from './assistantHomeStore'
import { AssistantHomeStoreError } from './assistantHomeStoreError'
import { writeTextAtomically } from './atomicFile'

export type RepoInspection = GitProjectDirectoryInspection

export interface MaterializedManagedRoot {
  repo: RepoInspection
  integrationRoot: string
  releaseHead: string
  created: boolean
  previousReleaseHead: string | null
}

export async function inspectRepo(
  inputPath: string,
  projectPath?: string,
): Promise<RepoInspection> {
  try {
    return await inspectGitProjectDirectory(inputPath, projectPath)
  } catch (error) {
    if (error instanceof ProjectDirectoryError) {
      throw new AssistantHomeStoreError('repo_invalid', error.message)
    }
    throw error
  }
}

export async function createManagedRepoRoot(
  integrationRoot: string,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
) {
  await mkdir(dirname(integrationRoot), { recursive: true })
  const releaseBranch = projectReleaseBranch(projectId)
  const releaseRef = projectReleaseRef(projectId)
  const targetExists =
    (await runGit(repo.repoPath, ['show-ref', '--verify', '--quiet', releaseRef], true))
      .exitCode === 0
  const checkoutConfig = ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null']
  const args = targetExists
    ? [...checkoutConfig, 'worktree', 'add', integrationRoot, releaseBranch]
    : [...checkoutConfig, 'worktree', 'add', '-b', releaseBranch, integrationRoot, 'HEAD']
  const result = await runGit(repo.repoPath, args, true)
  if (result.exitCode !== 0) {
    throw new AssistantHomeStoreError(
      'invalid_project',
      `Cannot create managed integration worktree for ${projectId}/${repoId}: ${result.stderr || result.stdout}`,
    )
  }
}

export async function materializeReboundManagedRoot(
  paths: AssistantHomePaths,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
): Promise<MaterializedManagedRoot> {
  const integrationRoot = paths.managedIntegrationRoot(projectId, repo.repoPath)
  if (await pathExists(integrationRoot)) {
    await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
    return {
      repo,
      integrationRoot,
      releaseHead: (await runGit(integrationRoot, ['rev-parse', 'HEAD'])).stdout,
      created: false,
      previousReleaseHead: null,
    }
  }

  await mkdir(dirname(integrationRoot), { recursive: true })
  const releaseBranch = projectReleaseBranch(projectId)
  const previousRelease = await runGit(
    repo.repoPath,
    ['rev-parse', '--verify', projectReleaseRef(projectId)],
    true,
  )
  const targetHead = (await runGit(repo.repoPath, ['rev-parse', 'HEAD'])).stdout
  const result = await runGit(
    repo.repoPath,
    [
      '-c',
      'core.autocrlf=false',
      'worktree',
      'add',
      '-B',
      releaseBranch,
      integrationRoot,
      targetHead,
    ],
    true,
  )
  if (result.exitCode !== 0) {
    throw invalidProject(
      projectId,
      `Cannot materialize rebound Repo ${repoId}: ${result.stderr || result.stdout}`,
    )
  }
  await validateExistingManagedRepoRoot(integrationRoot, projectId, repoId, repo)
  return {
    repo,
    integrationRoot,
    releaseHead: targetHead,
    created: true,
    previousReleaseHead: previousRelease.exitCode === 0 ? previousRelease.stdout : null,
  }
}

export async function replaceCanonicalTree(
  sourceIntegrationRoot: string,
  targetIntegrationRoot: string,
) {
  const source = join(sourceIntegrationRoot, '.hopi')
  const target = join(targetIntegrationRoot, '.hopi')
  if (!(await pathExists(source))) {
    throw new Error(`Canonical Project documents are missing: ${source}`)
  }
  await rm(target, { recursive: true, force: true })
  await cp(source, target, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
}

export async function removeMaterializedManagedRoot(
  projectId: string,
  materialized: MaterializedManagedRoot,
) {
  await runGit(
    materialized.repo.repoPath,
    ['worktree', 'remove', '--force', materialized.integrationRoot],
    true,
  )
  const current = await runGit(
    materialized.repo.repoPath,
    ['rev-parse', '--verify', projectReleaseRef(projectId)],
    true,
  )
  if (current.exitCode === 0 && current.stdout === materialized.releaseHead) {
    if (materialized.previousReleaseHead) {
      await runGit(materialized.repo.repoPath, [
        'update-ref',
        projectReleaseRef(projectId),
        materialized.previousReleaseHead,
        materialized.releaseHead,
      ])
    } else {
      await runGit(
        materialized.repo.repoPath,
        ['update-ref', '-d', projectReleaseRef(projectId), materialized.releaseHead],
        true,
      )
    }
  }
}

export async function repairManagedRepoRoot(
  paths: AssistantHomePaths,
  project: ProjectLink,
  repoLink: ProjectRepoLink,
  repo: RepoInspection,
) {
  const previousIntegrationRoot = paths.managedIntegrationRoot(project.projectId, repoLink.repoPath)
  const integrationRoot = paths.managedIntegrationRoot(project.projectId, repo.repoPath)
  if (previousIntegrationRoot !== integrationRoot && (await pathExists(previousIntegrationRoot))) {
    if (!(await inspectRepo(previousIntegrationRoot).catch(() => null))) {
      await repairMovedManagedPointers(previousIntegrationRoot, project.projectId, repo)
      const repair = await runGit(
        repo.repoPath,
        ['worktree', 'repair', previousIntegrationRoot],
        true,
      )
      if (repair.exitCode !== 0) {
        throw invalidProject(
          project.projectId,
          `cannot repair moved managed worktree: ${repair.stderr || repair.stdout}`,
        )
      }
    }
    await relocateRegisteredWorktree({
      repoRoot: repo.repoPath,
      from: previousIntegrationRoot,
      to: integrationRoot,
      expectedBranch: projectReleaseBranch(project.projectId),
    })
  }
  if (!(await pathExists(integrationRoot))) {
    if (repoLink.repoId !== project.primaryRepoId) {
      await createManagedRepoRoot(integrationRoot, project.projectId, repoLink.repoId, repo)
    } else {
      throw invalidProject(
        project.projectId,
        'managed integration root is missing; refusing to reconstruct potentially newer canonical documents from Git',
      )
    }
  } else {
    if (!(await inspectRepo(integrationRoot).catch(() => null))) {
      await repairMovedManagedPointers(integrationRoot, project.projectId, repo)
    }
    const repair = await runGit(repo.repoPath, ['worktree', 'repair', integrationRoot], true)
    if (repair.exitCode !== 0) {
      throw invalidProject(
        project.projectId,
        `cannot repair managed integration worktree: ${repair.stderr || repair.stdout}`,
      )
    }
  }
  await validateExistingManagedRepoRoot(integrationRoot, project.projectId, repoLink.repoId, repo)
  const [managedHead, targetHead] = await Promise.all([
    runGit(integrationRoot, ['rev-parse', 'HEAD']),
    runGit(repo.repoPath, ['rev-parse', projectReleaseRef(project.projectId)]),
  ])
  if (managedHead.stdout !== targetHead.stdout) {
    throw invalidProject(
      project.projectId,
      `rebound managed root does not materialize ${projectReleaseBranch(project.projectId)}`,
    )
  }
}

export async function validateExistingManagedRepoRoot(
  integrationRoot: string,
  projectId: string,
  repoId: string,
  repo: RepoInspection,
) {
  const managedRepo = await inspectRepo(integrationRoot).catch(() => null)
  if (!managedRepo || managedRepo.commonDir !== repo.commonDir) {
    throw invalidProject(
      projectId,
      `existing managed path for ${repoId} is not the linked Repo worktree`,
    )
  }

  const releaseBranch = projectReleaseBranch(projectId)
  const branch = await runGit(integrationRoot, ['branch', '--show-current'])
  if (branch.stdout !== releaseBranch) {
    throw invalidProject(projectId, `managed worktree ${repoId} is not on ${releaseBranch}`)
  }
}

export async function runGit(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  if (exitCode !== 0 && !allowFailure) {
    throw new AssistantHomeStoreError(
      'repo_invalid',
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result
}

export async function pathExists(path: string) {
  return (await stat(path).catch(() => null)) !== null
}

async function repairMovedManagedPointers(
  integrationRoot: string,
  projectId: string,
  repo: RepoInspection,
) {
  const managedPointerPath = join(integrationRoot, '.git')
  const pointerFile = Bun.file(managedPointerPath)
  if (!(await pointerFile.exists())) return
  const pointer = (await pointerFile.text()).trim().match(/^gitdir:\s*(.+)$/)
  const previousAdminRoot = pointer?.[1]
  if (!previousAdminRoot) return
  const adminName = basename(previousAdminRoot)
  const adminRoot = join(repo.commonDir, 'worktrees', adminName)
  const [adminStats, head] = await Promise.all([
    stat(adminRoot).catch(() => null),
    Bun.file(join(adminRoot, 'HEAD'))
      .text()
      .catch(() => ''),
  ])
  if (!adminStats?.isDirectory() || head.trim() !== `ref: ${projectReleaseRef(projectId)}`) return

  await Promise.all([
    writePointerAtomically(managedPointerPath, `gitdir: ${adminRoot}\n`),
    writePointerAtomically(join(adminRoot, 'gitdir'), `${managedPointerPath}\n`),
  ])
}

async function writePointerAtomically(path: string, content: string) {
  await writeTextAtomically(path, content)
}

function invalidProject(projectId: string, reason: string) {
  return new AssistantHomeStoreError('invalid_project', `Invalid Project ${projectId}: ${reason}`)
}
