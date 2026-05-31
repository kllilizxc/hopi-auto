import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorktreeManager } from '../src/runtime/worktreeManager'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'worktree-manager')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createWorktreeManager', () => {
  test('prepares an isolated git worktree for a run', async () => {
    const rootDir = await initGitRepo(testRoot())
    const manager = createWorktreeManager(rootDir)

    const prepared = await manager.prepare({
      goalKey: 'goal-1',
      taskRef: 'T-1',
      runId: 'run-12345678',
    })

    expect(prepared.path).toContain('.hopi/worktrees/goal-1/T-1/run-12345678')
    expect(prepared.branch).toBe('hopi/goal-1/T-1/run-12345678')
    expect(prepared.baseRef).toBe('HEAD')
    expect(await git(rootDir, ['worktree', 'list', '--porcelain'])).toContain(prepared.path)
    expect(await git(prepared.path, ['rev-parse', '--show-toplevel'])).toBe(prepared.path)
  })

  test('removes the run worktree and disposable branch during cleanup', async () => {
    const rootDir = await initGitRepo(testRoot())
    const manager = createWorktreeManager(rootDir)

    const prepared = await manager.prepare({
      goalKey: 'goal-1',
      taskRef: 'T-9',
      runId: 'run-cleanup',
    })

    await manager.cleanup({
      goalKey: 'goal-1',
      taskRef: 'T-9',
      runId: 'run-cleanup',
    })

    expect(await pathExists(prepared.path)).toBeFalse()
    expect(await git(rootDir, ['branch', '--list', prepared.branch])).toBe('')
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
  const command = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
    command.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
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
