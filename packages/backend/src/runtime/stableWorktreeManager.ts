import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_PRIMARY_REPO_ID, HOPI_RELEASE_BRANCH, HOPI_RELEASE_REF } from '../domain/project'
import { STABLE_ID_PATTERN } from '../domain/stableId'
import { relocateRegisteredWorktree } from './worktreeRelocator'

export interface StableWorktreeInput {
  projectRoot: string
  projectId: string
  goalId: string
  workId: string
  repoId?: string
  primaryRepoId?: string
}

export interface StableWorktree {
  path: string
  branch: string
  baseRef: typeof HOPI_RELEASE_BRANCH
  repoId: string
}

export interface StableWorktreeManager {
  prepare(input: StableWorktreeInput): Promise<StableWorktree>
  prepareClean(input: StableWorktreeInput): Promise<StableWorktree>
  inspect(input: StableWorktreeInput): Promise<StableWorktree | null>
}

export class StableWorktreeError extends Error {}
export class StableWorktreeSyncError extends StableWorktreeError {}

export function createStableWorktreeManager(homeRoot: string): StableWorktreeManager {
  const absoluteHomeRoot = resolve(homeRoot)

  function worktree(input: StableWorktreeInput): StableWorktree {
    assertInput(input)
    const repoId = input.repoId ?? DEFAULT_PRIMARY_REPO_ID
    const workRoot = join(dirname(resolve(input.projectRoot)), 'work', input.goalId, input.workId)
    return {
      path: workRoot,
      branch: stableWorkBranch(input),
      baseRef: HOPI_RELEASE_BRANCH,
      repoId,
    }
  }

  return {
    async prepare(input) {
      const expected = worktree(input)
      await migrateLegacyWorktree(input, expected)
      const existing = await this.inspect(input)
      const prepared = existing ?? (await materialize(input, expected))
      return synchronize(input, prepared)
    },
    async prepareClean(input) {
      const expected = worktree(input)
      await migrateLegacyWorktree(input, expected)
      const existing = await this.inspect(input)
      let prepared = existing
      if (!prepared) {
        prepared = await materialize(input, expected)
      } else {
        const status = await worktreeStatus(prepared.path)
        if (status) {
          const removed = await runGit(
            input.projectRoot,
            ['worktree', 'remove', '--force', expected.path],
            true,
          )
          if (removed.exitCode !== 0) {
            throw new StableWorktreeError(
              `Cannot discard dirty Work checkout ${input.workId}: ${removed.stderr || removed.stdout}`,
            )
          }
          prepared = await materialize(input, expected)
        }
      }
      return synchronize(input, prepared)
    },
    async inspect(input) {
      const expected = worktree(input)
      const gitFile = await lstat(join(expected.path, '.git')).catch(() => null)
      if (!gitFile?.isFile()) return null

      const [branch, worktreeCommon, projectCommon] = await Promise.all([
        runGit(expected.path, ['branch', '--show-current']),
        gitCommonDir(expected.path),
        gitCommonDir(input.projectRoot),
      ])
      if (branch.stdout !== expected.branch) {
        throw new StableWorktreeError(
          `Work worktree ${input.workId} is on ${branch.stdout || 'detached HEAD'}, expected ${expected.branch}`,
        )
      }
      if (worktreeCommon !== projectCommon) {
        throw new StableWorktreeError(`Work worktree ${input.workId} belongs to another Repo`)
      }
      return expected
    },
  }

  async function materialize(input: StableWorktreeInput, expected: StableWorktree) {
    if (await pathExists(expected.path)) {
      await rm(expected.path, { recursive: true, force: true })
    }
    await mkdir(dirname(expected.path), { recursive: true })

    const branchExists =
      (
        await runGit(
          input.projectRoot,
          ['show-ref', '--verify', '--quiet', `refs/heads/${expected.branch}`],
          true,
        )
      ).exitCode === 0
    const args = branchExists
      ? ['worktree', 'add', '--force', expected.path, expected.branch]
      : ['worktree', 'add', '-b', expected.branch, expected.path, HOPI_RELEASE_REF]
    const result = await runGit(input.projectRoot, args, true)
    if (result.exitCode !== 0) {
      throw new StableWorktreeError(
        `Cannot prepare Work worktree ${input.workId}: ${result.stderr || result.stdout}`,
      )
    }
    return expected
  }

  async function synchronize(input: StableWorktreeInput, expected: StableWorktree) {
    const [taskHead, releaseHead] = await Promise.all([
      runGit(expected.path, ['rev-parse', 'HEAD']),
      runGit(input.projectRoot, ['rev-parse', HOPI_RELEASE_REF]),
    ])
    if (taskHead.stdout === releaseHead.stdout) return expected

    const releaseIsAncestor = await runGit(
      expected.path,
      ['merge-base', '--is-ancestor', releaseHead.stdout, taskHead.stdout],
      true,
    )
    if (releaseIsAncestor.exitCode === 0) return expected
    if (releaseIsAncestor.exitCode !== 1) {
      throw new StableWorktreeError(
        `Cannot inspect release ancestry for Work ${input.workId}: ${releaseIsAncestor.stderr || releaseIsAncestor.stdout}`,
      )
    }

    const status = await worktreeStatus(expected.path)
    if (status) {
      throw new StableWorktreeSyncError(
        `Cannot synchronize dirty Work checkout ${input.workId} with release ${releaseHead.stdout}; preserve its uncheckpointed source and replan`,
      )
    }

    const taskIsAncestor = await runGit(
      expected.path,
      ['merge-base', '--is-ancestor', taskHead.stdout, releaseHead.stdout],
      true,
    )
    if (taskIsAncestor.exitCode !== 0 && taskIsAncestor.exitCode !== 1) {
      throw new StableWorktreeError(
        `Cannot inspect task ancestry for Work ${input.workId}: ${taskIsAncestor.stderr || taskIsAncestor.stdout}`,
      )
    }

    const mergeArgs =
      taskIsAncestor.exitCode === 0
        ? ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', releaseHead.stdout]
        : [
            '-c',
            'core.hooksPath=/dev/null',
            'merge',
            '--no-ff',
            '--no-edit',
            '--no-gpg-sign',
            '-m',
            `hopi: synchronize ${input.goalId}/${input.workId} with release`,
            releaseHead.stdout,
          ]
    const merge = await runGit(expected.path, mergeArgs, true, {
      GIT_AUTHOR_NAME: 'HOPI Coordinator',
      GIT_AUTHOR_EMAIL: 'hopi@local',
      GIT_COMMITTER_NAME: 'HOPI Coordinator',
      GIT_COMMITTER_EMAIL: 'hopi@local',
    })
    if (merge.exitCode !== 0) {
      await runGit(expected.path, ['merge', '--abort'], true)
      const [restoredHead, restoredStatus, mergeHead] = await Promise.all([
        runGit(expected.path, ['rev-parse', 'HEAD']),
        worktreeStatus(expected.path),
        runGit(expected.path, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'], true),
      ])
      if (restoredHead.stdout !== taskHead.stdout || restoredStatus || mergeHead.exitCode === 0) {
        throw new StableWorktreeError(
          `Work ${input.workId} synchronization failed and the exact prior checkout could not be restored`,
        )
      }
      throw new StableWorktreeSyncError(
        `Work ${input.workId} changes conflict with release ${releaseHead.stdout}: ${merge.stderr || merge.stdout}`,
      )
    }

    const [nextHead, nextStatus, synchronized] = await Promise.all([
      runGit(expected.path, ['rev-parse', 'HEAD']),
      worktreeStatus(expected.path),
      runGit(expected.path, ['merge-base', '--is-ancestor', releaseHead.stdout, 'HEAD'], true),
    ])
    if (synchronized.exitCode !== 0) {
      throw new StableWorktreeError(
        `Work ${input.workId} did not cleanly synchronize ${taskHead.stdout} with release ${releaseHead.stdout} at ${nextHead.stdout}`,
      )
    }
    if (nextStatus) {
      throw new StableWorktreeSyncError(
        `Work ${input.workId} synchronized with release ${releaseHead.stdout} at ${nextHead.stdout}, but the merge exposed preserved source changes (${nextStatus}); replan this Work lineage`,
      )
    }
    return expected
  }

  async function migrateLegacyWorktree(input: StableWorktreeInput, expected: StableWorktree) {
    if (await pathExists(expected.path)) return
    const repoId = input.repoId ?? DEFAULT_PRIMARY_REPO_ID
    const primaryRepoId = input.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
    const legacyPrimary = join(
      absoluteHomeRoot,
      '.hopi',
      'runtime',
      'worktrees',
      input.projectId,
      input.goalId,
      input.workId,
    )
    const legacyPath =
      repoId === primaryRepoId
        ? legacyPrimary
        : join(dirname(legacyPrimary), `${input.workId}.repos`, repoId)
    if (!(await pathExists(legacyPath))) return
    await relocateRegisteredWorktree({
      repoRoot: input.projectRoot,
      from: legacyPath,
      to: expected.path,
      expectedBranch: expected.branch,
    })
  }
}

export function stableWorkBranch(
  input: Pick<StableWorktreeInput, 'projectId' | 'goalId' | 'workId'>,
) {
  assertStableId(input.projectId, 'projectId')
  assertStableId(input.goalId, 'goalId')
  assertStableId(input.workId, 'workId')
  return `hopi/work/${input.projectId}/${input.goalId}/${input.workId}`
}

async function gitCommonDir(cwd: string) {
  const result = await runGit(cwd, ['rev-parse', '--git-common-dir'])
  return realpath(resolve(cwd, result.stdout))
}

async function worktreeStatus(path: string) {
  return (await runGit(path, ['status', '--porcelain=v1', '--untracked-files=all'])).stdout
}

async function runGit(
  cwd: string,
  args: string[],
  allowFailure = false,
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  if (exitCode !== 0 && !allowFailure) {
    throw new StableWorktreeError(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result
}

async function pathExists(path: string) {
  return (await lstat(path).catch(() => null)) !== null
}

function assertInput(input: StableWorktreeInput) {
  assertStableId(input.projectId, 'projectId')
  assertStableId(input.goalId, 'goalId')
  assertStableId(input.workId, 'workId')
  assertStableId(input.repoId ?? DEFAULT_PRIMARY_REPO_ID, 'repoId')
  assertStableId(input.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID, 'primaryRepoId')
}

function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new StableWorktreeError(`Invalid ${label}: ${value}`)
  }
}
