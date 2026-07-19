import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectDirectoryError,
  classifyProjectDirectory,
  initializeEmptyGitRepository,
} from '../src/runtime/projectDirectory'

let temporaryRoot = ''

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-project-directory-'))
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('project directory selection', () => {
  test('preserves a selected Git subdirectory as its portable Project path', async () => {
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const selectedPath = join(repoPath, 'apps', 'new-product')
    await mkdir(selectedPath, { recursive: true })

    await expect(classifyProjectDirectory(selectedPath)).resolves.toEqual({
      kind: 'git_repository',
      path: await realpath(selectedPath),
      repoPath,
      projectPath: 'apps/new-product',
    })
  })

  test('distinguishes empty and non-empty directories outside Git', async () => {
    const emptyPath = join(temporaryRoot, 'empty')
    const existingPath = join(temporaryRoot, 'existing')
    await mkdir(emptyPath)
    await mkdir(existingPath)
    await Bun.write(join(existingPath, 'secret.env'), 'do-not-commit\n')

    await expect(classifyProjectDirectory(emptyPath)).resolves.toEqual({
      kind: 'empty_directory',
      path: await realpath(emptyPath),
    })
    await expect(classifyProjectDirectory(existingPath)).resolves.toEqual({
      kind: 'non_git_directory',
      path: await realpath(existingPath),
      entryCount: 1,
    })
  })

  test('rejects Git and HOPI metadata as a Project source scope', async () => {
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const metadataPath = join(repoPath, '.hopi', 'draft')
    await mkdir(metadataPath, { recursive: true })

    await expect(classifyProjectDirectory(metadataPath)).rejects.toMatchObject({
      code: 'invalid_scope',
    })
  })

  test('initializes an empty directory with main and one clean bootstrap commit', async () => {
    const selectedPath = join(temporaryRoot, 'new-product')
    await mkdir(selectedPath)

    await expect(initializeEmptyGitRepository(selectedPath)).resolves.toEqual({
      kind: 'git_repository',
      path: await realpath(selectedPath),
      repoPath: await realpath(selectedPath),
      projectPath: '.',
    })
    expect(await git(selectedPath, ['branch', '--show-current'])).toBe('main')
    expect(await git(selectedPath, ['log', '-1', '--pretty=%s'])).toBe(
      'chore: initialize repository',
    )
    expect(await git(selectedPath, ['status', '--porcelain'])).toBe('')
    await expect(initializeEmptyGitRepository(selectedPath)).resolves.toMatchObject({
      kind: 'git_repository',
      repoPath: await realpath(selectedPath),
      projectPath: '.',
    })
  })

  test('never initializes a nested or non-empty repository implicitly', async () => {
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const nestedPath = join(repoPath, 'new-product')
    const existingPath = join(temporaryRoot, 'existing')
    await mkdir(nestedPath)
    await mkdir(existingPath)
    await Bun.write(join(existingPath, 'source.txt'), 'existing\n')

    await expect(initializeEmptyGitRepository(nestedPath)).rejects.toBeInstanceOf(
      ProjectDirectoryError,
    )
    await expect(Bun.file(join(nestedPath, '.git')).exists()).resolves.toBe(false)
    await expect(initializeEmptyGitRepository(existingPath)).rejects.toThrow(
      'will not commit its existing contents automatically',
    )
    await expect(Bun.file(join(existingPath, '.git')).exists()).resolves.toBe(false)
  })
})

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Test Repo\n')
  await git(path, ['add', 'README.md'])
  await git(path, ['commit', '-m', 'initial'])
  return realpath(path)
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim())
  return stdout.trim()
}
