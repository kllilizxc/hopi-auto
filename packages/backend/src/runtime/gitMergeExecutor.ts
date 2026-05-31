import type { AgentOutcome } from '../agent/AgentRunner'
import type { TaskKind } from '../domain/board'
import { createWorktreeManager, worktreeBranchName } from './worktreeManager'

export interface CompleteMergeOptions {
  goalKey: string
  taskRef: string
  taskKind: TaskKind
  runId: string
}

export interface GitMergeExecutor {
  completeMerge(options: CompleteMergeOptions): Promise<AgentOutcome>
}

export function createGitMergeExecutor(rootDir = process.cwd()): GitMergeExecutor {
  const worktrees = createWorktreeManager(rootDir)

  return {
    async completeMerge(options) {
      const branch = worktreeBranchName(options.goalKey, options.taskRef, options.runId)

      if (options.taskKind === 'planning') {
        await worktrees.cleanup(options)
        return { kind: 'success' }
      }

      if (!(await branchExists(rootDir, branch))) {
        throw new Error(`Missing merge branch for engineering run: ${branch}`)
      }

      const merge = await runGitAllowFailure(rootDir, ['merge', '--no-ff', '--no-edit', branch])
      if (merge.exitCode === 0) {
        await worktrees.cleanup(options)
        return { kind: 'success' }
      }

      const unmergedFiles = await listUnmergedFiles(rootDir)
      if (unmergedFiles.length > 0) {
        await runGitAllowFailure(rootDir, ['merge', '--abort'])
        return {
          kind: 'merge_conflict',
          artifactRef: `branch:${branch}`,
        }
      }

      throw new Error(
        `git merge ${branch} failed: ${merge.stderr.trim() || merge.stdout.trim() || `exit ${merge.exitCode}`}`,
      )
    },
  }
}

async function branchExists(cwd: string, branch: string) {
  const result = await runGitAllowFailure(cwd, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branch}`,
  ])
  return result.exitCode === 0
}

async function listUnmergedFiles(cwd: string) {
  const result = await runGitAllowFailure(cwd, ['diff', '--name-only', '--diff-filter=U'])
  if (result.exitCode !== 0) {
    return []
  }

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function runGitAllowFailure(cwd: string, args: string[]) {
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

  return {
    stdout,
    stderr,
    exitCode,
  }
}
