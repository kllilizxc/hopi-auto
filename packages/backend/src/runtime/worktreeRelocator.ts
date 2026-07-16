import { cp, lstat, mkdir, readdir, readlink, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export interface RelocateRegisteredWorktreeInput {
  repoRoot: string
  from: string
  to: string
  expectedBranch: string
}

export class WorktreeRelocationError extends Error {}

export async function relocateRegisteredWorktree(
  input: RelocateRegisteredWorktreeInput,
): Promise<boolean> {
  const repoRoot = resolve(input.repoRoot)
  const from = resolve(input.from)
  const to = resolve(input.to)
  if (from === to) return false

  const sourceExists = await pathExists(from)
  const targetExists = await pathExists(to)
  if (targetExists) {
    if (await recoverCompletedRelocation({ ...input, repoRoot, from, to, sourceExists }))
      return true
    if (!sourceExists) {
      throw new WorktreeRelocationError(`Managed worktree target already exists: ${to}`)
    }
    await rm(to, { recursive: true, force: true })
  }
  if (!sourceExists) return false

  const before = await inspectWorktree(repoRoot, from, input.expectedBranch)
  await mkdir(dirname(to), { recursive: true })
  const moved = await runGit(repoRoot, ['worktree', 'move', from, to], true)
  if (moved.exitCode === 0) {
    try {
      await assertSameWorktree(before, repoRoot, to, input.expectedBranch)
      return true
    } catch (error) {
      await runGit(repoRoot, ['worktree', 'move', to, from], true)
      throw error
    }
  }
  if (!isCrossDeviceMove(moved.stderr || moved.stdout)) {
    throw new WorktreeRelocationError(
      `Cannot relocate managed worktree ${from}: ${moved.stderr || moved.stdout}`,
    )
  }

  await copyAcrossDevices(before, repoRoot, from, to, input.expectedBranch)
  return true
}

interface WorktreeSnapshot {
  adminRoot: string
  head: string
  branch: string
  indexTree: string
  status: string
  canonicalDigest: string
}

async function copyAcrossDevices(
  before: WorktreeSnapshot,
  repoRoot: string,
  from: string,
  to: string,
  expectedBranch: string,
) {
  const temporary = `${to}.hopi-tmp-${crypto.randomUUID()}`
  const previousAdminPointer = await Bun.file(join(before.adminRoot, 'gitdir')).text()
  try {
    await cp(from, temporary, {
      recursive: true,
      dereference: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    await rename(temporary, to)
    await writeAtomically(join(to, '.git'), `gitdir: ${before.adminRoot}\n`)
    await writeAtomically(join(before.adminRoot, 'gitdir'), `${join(to, '.git')}\n`)
    await assertSameWorktree(before, repoRoot, to, expectedBranch)
    await rm(from, { recursive: true, force: true })
  } catch (error) {
    await writeAtomically(join(before.adminRoot, 'gitdir'), previousAdminPointer).catch(() => {})
    await rm(temporary, { recursive: true, force: true })
    await rm(to, { recursive: true, force: true })
    throw new WorktreeRelocationError(
      `Cannot copy managed worktree ${from} to ${to}: ${errorMessage(error)}`,
    )
  }
}

async function recoverCompletedRelocation(input: {
  repoRoot: string
  from: string
  to: string
  expectedBranch: string
  sourceExists: boolean
}) {
  const targetPointer = await worktreeAdminRoot(input.to).catch(() => null)
  if (!targetPointer) return false
  const commonDir = await gitCommonDir(input.to).catch(() => null)
  const expectedCommonDir = await gitCommonDir(input.repoRoot)
  if (commonDir !== expectedCommonDir) {
    throw new WorktreeRelocationError(
      `Managed worktree target belongs to another Repo: ${input.to}`,
    )
  }

  const adminGitdir = (
    await Bun.file(join(targetPointer, 'gitdir'))
      .text()
      .catch(() => '')
  ).trim()
  const targetGitFile = resolve(join(input.to, '.git'))
  const sourceGitFile = resolve(join(input.from, '.git'))
  if (resolve(adminGitdir || '.') === targetGitFile) {
    await inspectWorktree(input.repoRoot, input.to, input.expectedBranch)
    if (input.sourceExists) await rm(input.from, { recursive: true, force: true })
    return true
  }
  if (input.sourceExists && resolve(adminGitdir || '.') === sourceGitFile) {
    return false
  }
  if (!input.sourceExists && resolve(adminGitdir || '.') === sourceGitFile) {
    await writeAtomically(join(targetPointer, 'gitdir'), `${targetGitFile}\n`)
    await inspectWorktree(input.repoRoot, input.to, input.expectedBranch)
    return true
  }
  throw new WorktreeRelocationError(`Managed worktree registration is ambiguous: ${input.to}`)
}

async function assertSameWorktree(
  before: WorktreeSnapshot,
  repoRoot: string,
  path: string,
  expectedBranch: string,
) {
  const after = await inspectWorktree(repoRoot, path, expectedBranch)
  if (
    after.adminRoot !== before.adminRoot ||
    after.head !== before.head ||
    after.branch !== before.branch ||
    after.indexTree !== before.indexTree ||
    after.status !== before.status ||
    after.canonicalDigest !== before.canonicalDigest
  ) {
    throw new WorktreeRelocationError(`Managed worktree changed while relocating to ${path}`)
  }
}

async function inspectWorktree(repoRoot: string, path: string, expectedBranch: string) {
  const adminRoot = await worktreeAdminRoot(path)
  const branch = await git(path, ['branch', '--show-current'])
  const head = await git(path, ['rev-parse', 'HEAD'])
  const indexTree = await git(path, ['write-tree'])
  const status = await git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const [commonDir, expectedCommonDir, canonicalDigest] = await Promise.all([
    gitCommonDir(path),
    gitCommonDir(repoRoot),
    directoryDigest(join(path, '.hopi')),
  ])
  if (branch !== expectedBranch) {
    throw new WorktreeRelocationError(
      `Managed worktree is on ${branch || 'detached HEAD'}, expected ${expectedBranch}: ${path}`,
    )
  }
  if (commonDir !== expectedCommonDir) {
    throw new WorktreeRelocationError(`Managed worktree belongs to another Repo: ${path}`)
  }
  return { adminRoot, branch, head, indexTree, status, canonicalDigest }
}

async function worktreeAdminRoot(path: string) {
  const result = await git(path, ['rev-parse', '--git-dir'])
  return realpath(resolve(path, result))
}

async function gitCommonDir(path: string) {
  const result = await git(path, ['rev-parse', '--git-common-dir'])
  return realpath(resolve(path, result))
}

async function directoryDigest(root: string) {
  const hasher = new Bun.CryptoHasher('sha256')
  if (!(await pathExists(root))) return hasher.update('missing').digest('hex')
  await append(root, '')
  return hasher.digest('hex')

  async function append(path: string, relativePath: string): Promise<void> {
    const stats = await lstat(path)
    hasher.update(`${relativePath}\0${stats.mode}\0`)
    if (stats.isSymbolicLink()) {
      hasher.update(await readlink(path))
      return
    }
    if (stats.isFile()) {
      hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()))
      return
    }
    if (!stats.isDirectory()) return
    const entries = (await readdir(path)).sort()
    for (const entry of entries) {
      await append(join(path, entry), relativePath ? `${relativePath}/${entry}` : entry)
    }
  }
}

async function writeAtomically(path: string, content: string) {
  const temporary = `${path}.hopi-tmp-${crypto.randomUUID()}`
  await Bun.write(temporary, content)
  await rename(temporary, path)
}

async function git(cwd: string, args: string[]) {
  const result = await runGit(cwd, args)
  return result.stdout
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
    throw new WorktreeRelocationError(stderr.trim() || stdout.trim())
  }
  return result
}

function isCrossDeviceMove(message: string) {
  return /cross-device|EXDEV/i.test(message)
}

async function pathExists(path: string) {
  return (await lstat(path).catch(() => null)) !== null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
