import { lstat, mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_PRIMARY_REPO_ID, HOPI_RELEASE_BRANCH, HOPI_RELEASE_REF } from '../domain/project'

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

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

export function createStableWorktreeManager(homeRoot: string): StableWorktreeManager {
  const absoluteHomeRoot = resolve(homeRoot)

  function worktree(input: StableWorktreeInput): StableWorktree {
    assertInput(input)
    const repoId = input.repoId ?? DEFAULT_PRIMARY_REPO_ID
    const primaryRepoId = input.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
    const workRoot = join(
      absoluteHomeRoot,
      '.hopi',
      'runtime',
      'worktrees',
      input.projectId,
      input.goalId,
      input.workId,
    )
    return {
      path:
        repoId === primaryRepoId
          ? workRoot
          : join(dirname(workRoot), `${input.workId}.repos`, repoId),
      branch: stableWorkBranch(input),
      baseRef: HOPI_RELEASE_BRANCH,
      repoId,
    }
  }

  return {
    async prepare(input) {
      const expected = worktree(input)
      const existing = await this.inspect(input)
      if (existing) return existing

      return materialize(input, expected)
    },
    async prepareClean(input) {
      const expected = worktree(input)
      const existing = await this.inspect(input)
      if (!existing) return materialize(input, expected)
      const status = await runGit(existing.path, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ])
      if (!status.stdout) return existing

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
      return materialize(input, expected)
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

async function runGit(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', '-c', 'core.autocrlf=false', ...args], {
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
