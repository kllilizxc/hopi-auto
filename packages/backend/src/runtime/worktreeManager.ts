import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createProjectPaths } from '../storage/paths'

export interface PrepareWorktreeOptions {
  goalKey: string
  taskRef: string
  runId: string
  baseRef?: string
}

export interface CleanupWorktreeOptions {
  goalKey: string
  taskRef: string
  runId: string
}

export interface PreparedWorktree {
  path: string
  branch: string
  baseRef: string
}

export interface WorktreeManager {
  prepare(options: PrepareWorktreeOptions): Promise<PreparedWorktree>
  cleanup(options: CleanupWorktreeOptions): Promise<void>
}

export function createWorktreeManager(rootDir = process.cwd()): WorktreeManager {
  const paths = createProjectPaths(rootDir)

  return {
    async prepare(options) {
      const path = paths.worktreePath(options.goalKey, options.taskRef, options.runId)
      const branch = worktreeBranchName(options.goalKey, options.taskRef, options.runId)
      const baseRef = options.baseRef ?? 'HEAD'

      if (await isPreparedWorktree(path)) {
        return { path, branch, baseRef }
      }

      await rm(path, { recursive: true, force: true })
      await mkdir(dirname(path), { recursive: true })
      await runGit(rootDir, ['worktree', 'add', '--force', '-b', branch, path, baseRef])

      return { path, branch, baseRef }
    },
    async cleanup(options) {
      const path = paths.worktreePath(options.goalKey, options.taskRef, options.runId)
      const branch = worktreeBranchName(options.goalKey, options.taskRef, options.runId)

      if (await pathExists(path)) {
        await runGit(rootDir, ['worktree', 'remove', '--force', path])
      }

      await runGit(rootDir, ['worktree', 'prune', '--expire', 'now']).catch(() => undefined)
      await runGit(rootDir, ['branch', '-D', branch]).catch(() => undefined)
    },
  }
}

export function worktreeBranchName(goalKey: string, taskRef: string, runId: string) {
  return `hopi/${goalKey}/${taskRef}/${runId}`
}

async function isPreparedWorktree(path: string) {
  return Bun.file(join(path, '.git')).exists()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function runGit(cwd: string, args: string[]) {
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
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }

  return stdout.trim()
}
