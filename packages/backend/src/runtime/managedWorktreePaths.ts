import { basename, dirname, join, resolve } from 'node:path'
import { assertStableId } from '../domain/stableId'

export const HOPI_WORKTREE_DIRECTORY = '.hopi-worktrees'

export interface ManagedRepoWorktreePaths {
  root: string
  integration: string
  work: string
}

export function managedRepoWorktreePaths(
  repoPath: string,
  projectId: string,
): ManagedRepoWorktreePaths {
  assertStableId(projectId, 'projectId')
  const repoRoot = resolve(repoPath)
  const repoName = basename(repoRoot)
  if (!repoName) throw new Error(`Cannot derive managed worktree root for ${repoRoot}`)
  const root = join(dirname(repoRoot), HOPI_WORKTREE_DIRECTORY, repoName, 'projects', projectId)
  return {
    root,
    integration: join(root, 'integration'),
    work: join(root, 'work'),
  }
}

export function managedTaskWorktreePath(
  repoPath: string,
  projectId: string,
  goalId: string,
  workId: string,
) {
  return join(managedRepoWorktreePaths(repoPath, projectId).work, goalId, workId)
}

export function legacyManagedRepoWorktreePaths(repoPath: string): ManagedRepoWorktreePaths {
  const repoRoot = resolve(repoPath)
  const repoName = basename(repoRoot)
  if (!repoName) throw new Error(`Cannot derive managed worktree root for ${repoRoot}`)
  const root = join(dirname(repoRoot), HOPI_WORKTREE_DIRECTORY, repoName)
  return { root, integration: join(root, 'integration'), work: join(root, 'work') }
}
