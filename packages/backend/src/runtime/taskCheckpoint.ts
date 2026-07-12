import { stableWorkBranch } from './stableWorktreeManager'

export interface TaskCheckpointInput {
  worktreePath: string
  projectId: string
  goalId: string
  workId: string
  runId: string
  repoId?: string
}

export interface TaskCheckpoint {
  head: string
  created: boolean
}

export type TaskCheckpointErrorCode = 'source_violation' | 'infrastructure'

export class TaskCheckpointError extends Error {
  constructor(
    message: string,
    readonly code: TaskCheckpointErrorCode = 'infrastructure',
  ) {
    super(message)
  }
}

export async function checkpointTaskWorktree(input: TaskCheckpointInput): Promise<TaskCheckpoint> {
  const expectedBranch = stableWorkBranch(input)
  const branch = await git(input.worktreePath, ['branch', '--show-current'])
  if (branch !== expectedBranch) {
    throw new TaskCheckpointError(
      `Task worktree is on ${branch || 'detached HEAD'}, expected ${expectedBranch}`,
    )
  }
  const canonicalStatus = await git(input.worktreePath, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    '.hopi',
  ])
  if (canonicalStatus) {
    throw new TaskCheckpointError(
      'Task worktree contains forbidden .hopi changes',
      'source_violation',
    )
  }

  // An explicit `.` pathspec makes Git reject an ignored .hopi directory before exclusions apply.
  await git(input.worktreePath, ['add', '-A'])
  const staged = await gitResult(input.worktreePath, ['diff', '--cached', '--quiet'])
  if (staged.exitCode !== 0 && staged.exitCode !== 1) {
    throw new TaskCheckpointError(staged.stderr || 'Cannot inspect staged task changes')
  }
  if (staged.exitCode === 0) {
    return { head: await git(input.worktreePath, ['rev-parse', 'HEAD']), created: false }
  }

  const message = [
    `hopi: checkpoint ${input.goalId}/${input.workId}`,
    '',
    `HOPI-Project: ${input.projectId}`,
    `HOPI-Goal: ${input.goalId}`,
    `HOPI-Work: ${input.workId}`,
    ...(input.repoId ? [`HOPI-Repo: ${input.repoId}`] : []),
    `HOPI-Producer-Run: ${input.runId}`,
  ].join('\n')
  const commit = await gitResult(input.worktreePath, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_NAME: 'HOPI Generator',
    GIT_AUTHOR_EMAIL: 'hopi@local',
    GIT_COMMITTER_NAME: 'HOPI Coordinator',
    GIT_COMMITTER_EMAIL: 'hopi@local',
  })
  if (commit.exitCode !== 0) {
    throw new TaskCheckpointError(commit.stderr || commit.stdout || 'Task checkpoint failed')
  }
  return { head: await git(input.worktreePath, ['rev-parse', 'HEAD']), created: true }
}

async function git(cwd: string, args: string[]) {
  const result = await gitResult(cwd, args)
  if (result.exitCode !== 0) {
    throw new TaskCheckpointError(
      `git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`,
    )
  }
  return result.stdout
}

async function gitResult(cwd: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(['git', ...args], {
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
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}
