import { basename, dirname, join, resolve } from 'node:path'

export const HOPI_WORKTREE_DIRECTORY = '.hopi-worktrees'

export interface ManagedRepoWorktreePaths {
  root: string
  integration: string
  work: string
}

export function managedRepoWorktreePaths(repoPath: string): ManagedRepoWorktreePaths {
  const repoRoot = resolve(repoPath)
  const repoName = basename(repoRoot)
  if (!repoName) throw new Error(`Cannot derive managed worktree root for ${repoRoot}`)
  const root = join(dirname(repoRoot), HOPI_WORKTREE_DIRECTORY, repoName)
  return {
    root,
    integration: join(root, 'integration'),
    work: join(root, 'work'),
  }
}

export function managedTaskWorktreePath(repoPath: string, goalId: string, workId: string) {
  return join(managedRepoWorktreePaths(repoPath).work, goalId, workId)
}
