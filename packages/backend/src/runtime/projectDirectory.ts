import { readdir, realpath, rm, stat } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { ROOT_PROJECT_PATH, normalizeProjectPath, resolveProjectPath } from '../domain/projectPath'

export type ProjectDirectorySelection =
  | {
      kind: 'git_repository'
      path: string
      repoPath: string
      projectPath: string
    }
  | {
      kind: 'empty_directory'
      path: string
    }
  | {
      kind: 'non_git_directory'
      path: string
      entryCount: number
    }

export interface GitProjectDirectoryInspection {
  selectedPath: string
  repoPath: string
  projectPath: string
  commonDir: string
}

export type ProjectDirectoryErrorCode =
  | 'not_directory'
  | 'not_git'
  | 'not_empty'
  | 'invalid_scope'
  | 'initialization_failed'

export class ProjectDirectoryError extends Error {
  constructor(
    readonly code: ProjectDirectoryErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export async function classifyProjectDirectory(path: string): Promise<ProjectDirectorySelection> {
  const selectedPath = await canonicalDirectory(path)
  const repository = await inspectGitProjectDirectory(selectedPath).catch((error) => {
    if (error instanceof ProjectDirectoryError && error.code === 'not_git') return null
    throw error
  })
  if (repository) return presentGitSelection(repository)

  const entries = await readdir(selectedPath)
  return entries.length === 0
    ? { kind: 'empty_directory', path: selectedPath }
    : { kind: 'non_git_directory', path: selectedPath, entryCount: entries.length }
}

export async function inspectGitProjectDirectory(
  repoPath: string,
  projectPath?: string,
): Promise<GitProjectDirectoryInspection> {
  const requestedPath = projectPath ? resolveProjectPath(repoPath, projectPath) : resolve(repoPath)
  const selectedPath = await canonicalDirectory(requestedPath)
  const rootResult = await runGit(selectedPath, ['rev-parse', '--show-toplevel'], true)
  if (rootResult.exitCode !== 0 || !rootResult.stdout) {
    throw new ProjectDirectoryError('not_git', `Path is not inside a Git worktree: ${selectedPath}`)
  }

  const canonicalRepoPath = await realpath(rootResult.stdout)
  const relativeProjectPath = relative(canonicalRepoPath, selectedPath).split('\\').join('/')
  const normalizedProjectPath = normalizeProjectPath(relativeProjectPath || ROOT_PROJECT_PATH)
  if (
    normalizedProjectPath === '.git' ||
    normalizedProjectPath.startsWith('.git/') ||
    normalizedProjectPath === '.hopi' ||
    normalizedProjectPath.startsWith('.hopi/')
  ) {
    throw new ProjectDirectoryError(
      'invalid_scope',
      `Project scope cannot use HOPI or Git metadata: ${selectedPath}`,
    )
  }
  const commonResult = await runGit(canonicalRepoPath, ['rev-parse', '--git-common-dir'])
  return {
    selectedPath,
    repoPath: canonicalRepoPath,
    projectPath: normalizedProjectPath,
    commonDir: await realpath(resolve(canonicalRepoPath, commonResult.stdout)),
  }
}

export async function initializeEmptyGitRepository(
  path: string,
): Promise<Extract<ProjectDirectorySelection, { kind: 'git_repository' }>> {
  const selection = await classifyProjectDirectory(path)
  if (selection.kind === 'git_repository') {
    throw new ProjectDirectoryError(
      'initialization_failed',
      `Directory is already inside a Git repository: ${selection.repoPath}`,
    )
  }
  if (selection.kind === 'non_git_directory') {
    throw new ProjectDirectoryError(
      'not_empty',
      `Directory is not empty; HOPI will not commit its existing contents automatically: ${selection.path}`,
    )
  }

  const gitDir = resolve(selection.path, '.git')
  let initializationStarted = false
  try {
    initializationStarted = true
    await runGit(selection.path, ['init', '--initial-branch=main', '.'])
    await runGit(selection.path, [
      '-c',
      'user.name=HOPI',
      '-c',
      'user.email=hopi@localhost',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '--allow-empty',
      '--no-gpg-sign',
      '-m',
      'chore: initialize repository',
    ])
    return presentGitSelection(await inspectGitProjectDirectory(selection.path))
  } catch (error) {
    if (initializationStarted) await rm(gitDir, { recursive: true, force: true })
    if (error instanceof ProjectDirectoryError) throw error
    throw new ProjectDirectoryError(
      'initialization_failed',
      `Cannot initialize Git repository at ${selection.path}: ${errorMessage(error)}`,
    )
  }
}

async function canonicalDirectory(path: string) {
  const requestedPath = resolve(path)
  const stats = await stat(requestedPath).catch(() => null)
  if (!stats?.isDirectory()) {
    throw new ProjectDirectoryError('not_directory', `Path is not a directory: ${requestedPath}`)
  }
  return realpath(requestedPath)
}

function presentGitSelection(
  inspection: GitProjectDirectoryInspection,
): Extract<ProjectDirectorySelection, { kind: 'git_repository' }> {
  return {
    kind: 'git_repository',
    path: inspection.selectedPath,
    repoPath: inspection.repoPath,
    projectPath: inspection.projectPath,
  }
}

async function runGit(cwd: string, args: string[], allowFailure = false) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const result = { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
  if (exitCode !== 0 && !allowFailure) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr || result.stdout}`)
  }
  return result
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
