import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createGitMergeExecutor } from '../src/runtime/gitMergeExecutor'
import { createWorktreeManager } from '../src/runtime/worktreeManager'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'git-merge-executor')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGitMergeExecutor', () => {
  test('merges an engineering run branch into the root repo and cleans the run worktree', async () => {
    const rootDir = await initGitRepo(testRoot())
    const worktrees = createWorktreeManager(rootDir)
    const prepared = await worktrees.prepare({
      goalKey,
      taskRef: 'T-1',
      runId: 'run-1',
    })
    await writeFile(join(prepared.path, 'feature.txt'), 'merged output\n', 'utf8')
    await git(prepared.path, ['add', 'feature.txt'])
    await git(prepared.path, ['commit', '-m', 'feature work'])

    const executor = createGitMergeExecutor(rootDir)
    const result = await executor.completeMerge({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      runId: 'run-1',
    })

    expect(result).toEqual({ kind: 'success' })
    expect(await readFile(join(rootDir, 'feature.txt'), 'utf8')).toBe('merged output\n')
    expect(await pathExists(prepared.path)).toBeFalse()
    expect(await git(rootDir, ['branch', '--list', prepared.branch])).toBe('')
  })

  test('treats a no-op engineering branch merge as success and still cleans the run worktree', async () => {
    const rootDir = await initGitRepo(testRoot())
    const worktrees = createWorktreeManager(rootDir)
    const prepared = await worktrees.prepare({
      goalKey,
      taskRef: 'T-2',
      runId: 'run-2',
    })

    const executor = createGitMergeExecutor(rootDir)
    const result = await executor.completeMerge({
      goalKey,
      taskRef: 'T-2',
      taskKind: 'engineering',
      runId: 'run-2',
    })

    expect(result).toEqual({ kind: 'success' })
    expect(await pathExists(prepared.path)).toBeFalse()
    expect(await git(rootDir, ['branch', '--list', prepared.branch])).toBe('')
  })

  test('aborts root conflicts, preserves the run worktree, and returns merge_conflict', async () => {
    const rootDir = await initGitRepo(testRoot())
    const worktrees = createWorktreeManager(rootDir)
    const prepared = await worktrees.prepare({
      goalKey,
      taskRef: 'T-3',
      runId: 'run-3',
    })

    await writeFile(join(prepared.path, 'shared.txt'), 'worktree version\n', 'utf8')
    await git(prepared.path, ['add', 'shared.txt'])
    await git(prepared.path, ['commit', '-m', 'worktree change'])

    await writeFile(join(rootDir, 'shared.txt'), 'root version\n', 'utf8')
    await git(rootDir, ['add', 'shared.txt'])
    await git(rootDir, ['commit', '-m', 'root change'])

    const executor = createGitMergeExecutor(rootDir)
    const result = await executor.completeMerge({
      goalKey,
      taskRef: 'T-3',
      taskKind: 'engineering',
      runId: 'run-3',
    })

    expect(result).toEqual({
      kind: 'merge_conflict',
      artifactRef: 'branch:hopi/goal-1/T-3/run-3',
    })
    expect(await pathExists(prepared.path)).toBeTrue()
    expect(await git(rootDir, ['branch', '--list', prepared.branch])).toContain(prepared.branch)
    expect(await git(rootDir, ['diff', '--name-only', '--diff-filter=U'])).toBe('')
  })

  test('allows planning merger success without a run branch', async () => {
    const rootDir = await initGitRepo(testRoot())
    const executor = createGitMergeExecutor(rootDir)

    await expect(
      executor.completeMerge({
        goalKey,
        taskRef: 'P-1',
        taskKind: 'planning',
        runId: 'run-planning',
      }),
    ).resolves.toEqual({ kind: 'success' })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function initGitRepo(rootDir: string) {
  await mkdir(rootDir, { recursive: true })
  await git(rootDir, ['init'])
  await git(rootDir, ['config', 'user.name', 'HOPI Tests'])
  await git(rootDir, ['config', 'user.email', 'hopi@example.com'])
  await writeFile(join(rootDir, 'README.md'), '# test repo\n', 'utf8')
  await git(rootDir, ['add', 'README.md'])
  await git(rootDir, ['commit', '-m', 'init'])
  return rootDir
}

async function git(cwd: string, args: string[]) {
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

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`)
  }

  return stdout.trim()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
