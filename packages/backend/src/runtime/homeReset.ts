import { realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parse } from 'yaml'
import { acquireCoordinatorInstanceLock } from '../publication/instanceLock'
import { HOPI_WORKTREE_DIRECTORY } from './managedWorktreePaths'

export interface HomeResetRepoPlan {
  repoPath: string
  managedWorktrees: string[]
  refs: string[]
}

export interface HomeResetPlan {
  homeRoot: string
  hopiDir: string
  repos: HomeResetRepoPlan[]
}

export interface HomeResetResult {
  kind: 'home_reset'
  plan: HomeResetPlan
}

export class HomeResetError extends Error {}

export async function planHomeReset(homeRootInput: string): Promise<HomeResetPlan> {
  const homeRoot = resolve(homeRootInput)
  const hopiDir = join(homeRoot, '.hopi')
  const repoPaths = await readRepoCleanupLocators(join(hopiDir, 'projects.yml'))
  const repos = await Promise.all(
    repoPaths.map(async (repoPath) => {
      const worktreeRoot = join(dirname(repoPath), HOPI_WORKTREE_DIRECTORY, basename(repoPath))
      const [registeredWorktrees, refs] = await Promise.all([
        listRegisteredWorktrees(repoPath),
        gitLines(repoPath, [
          'for-each-ref',
          '--format=%(refname)',
          'refs/heads/hopi/project/',
          'refs/heads/hopi/work/',
        ]),
      ])
      const managedWorktrees = (
        await Promise.all(
          registeredWorktrees.map(async (path) =>
            (await isInside(worktreeRoot, path)) ? path : null,
          ),
        )
      ).filter((path): path is string => path !== null)
      return {
        repoPath,
        managedWorktrees: managedWorktrees.toSorted(),
        refs: refs.toSorted(),
      }
    }),
  )
  return {
    homeRoot,
    hopiDir,
    repos: repos.toSorted((left, right) => left.repoPath.localeCompare(right.repoPath)),
  }
}

export async function applyHomeReset(input: {
  homeRoot: string
  confirm: string
}): Promise<HomeResetResult> {
  const homeRoot = resolve(input.homeRoot)
  if (!isAbsolute(input.confirm) || resolve(input.confirm) !== homeRoot) {
    throw new HomeResetError(
      `Reset confirmation must be the absolute Assistant Home path ${homeRoot}`,
    )
  }

  const lock = await acquireCoordinatorInstanceLock(
    join(homeRoot, '.hopi', 'runtime', 'coordinator.lock'),
  ).catch((error) => {
    throw new HomeResetError(
      `Home reset requires the HOPI service to be stopped: ${errorMessage(error)}`,
    )
  })

  let plan: HomeResetPlan | null = null
  let discardedHome: string | null = null
  try {
    plan = await planHomeReset(homeRoot)
    for (const repo of plan.repos) {
      for (const worktree of repo.managedWorktrees) {
        await git(repo.repoPath, ['worktree', 'remove', '--force', '--force', worktree])
      }
      for (const ref of repo.refs) {
        await git(repo.repoPath, ['update-ref', '-d', ref])
      }
      await git(repo.repoPath, ['worktree', 'prune'])
    }
    discardedHome = join(homeRoot, `.hopi.discard.${crypto.randomUUID()}`)
    await rename(plan.hopiDir, discardedHome)
  } finally {
    await lock.release()
  }
  await rm(discardedHome, { recursive: true, force: true })
  return { kind: 'home_reset', plan }
}

async function readRepoCleanupLocators(projectLinksPath: string) {
  const file = Bun.file(projectLinksPath)
  if (!(await file.exists())) return []
  let raw: unknown
  try {
    raw = parse(await file.text())
  } catch (error) {
    throw new HomeResetError(
      `Cannot discover managed Repos because ${projectLinksPath} is not valid YAML: ${errorMessage(error)}`,
    )
  }
  const paths = new Set<string>()
  collectRepoPaths(raw, paths)
  return [...paths].toSorted()
}

function collectRepoPaths(value: unknown, paths: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectRepoPaths(item, paths)
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'repoPath' && typeof item === 'string' && item.trim()) {
      paths.add(resolve(item))
    } else {
      collectRepoPaths(item, paths)
    }
  }
}

async function listRegisteredWorktrees(repoPath: string) {
  const output = await git(repoPath, ['worktree', 'list', '--porcelain'])
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => resolve(line.slice('worktree '.length)))
}

async function gitLines(repoPath: string, args: string[]) {
  return (await git(repoPath, args))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function git(repoPath: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd: repoPath,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new HomeResetError(
      `git ${args.join(' ')} failed in ${repoPath}: ${stderr.trim() || `exit ${exitCode}`}`,
    )
  }
  return stdout
}

async function isInside(root: string, candidate: string) {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(root).catch(() => resolve(root)),
    realpath(candidate).catch(() => resolve(candidate)),
  ])
  const path = relative(canonicalRoot, canonicalCandidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
