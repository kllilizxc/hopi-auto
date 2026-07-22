import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ProjectDirectoryError,
  classifyProjectDirectory,
  initializeEmptyGitRepository,
  withPreparedProjectRepositories,
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

  test('creates one missing leaf directory before initializing it', async () => {
    const selectedPath = join(temporaryRoot, 'new-product')

    const selection = await initializeEmptyGitRepository(selectedPath)
    const canonicalPath = await realpath(selectedPath)
    expect(selection).toEqual({
      kind: 'git_repository',
      path: canonicalPath,
      repoPath: canonicalPath,
      projectPath: '.',
    })
    expect(await git(selectedPath, ['branch', '--show-current'])).toBe('main')
    expect(await git(selectedPath, ['log', '-1', '--pretty=%s'])).toBe(
      'chore: initialize repository',
    )
  })

  test('does not create missing ancestors', async () => {
    const missingParent = join(temporaryRoot, 'missing-parent')
    const selectedPath = join(missingParent, 'new-product')

    await expect(initializeEmptyGitRepository(selectedPath)).rejects.toMatchObject({
      code: 'not_directory',
      message: `Parent directory must already exist: ${missingParent}`,
    })
    await expect(stat(missingParent).catch(() => null)).resolves.toBeNull()
  })

  test('never initializes a nested or non-empty repository implicitly', async () => {
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const nestedPath = join(repoPath, 'new-product')
    const existingPath = join(temporaryRoot, 'existing')
    await mkdir(existingPath)
    await Bun.write(join(existingPath, 'source.txt'), 'existing\n')

    await expect(initializeEmptyGitRepository(nestedPath)).rejects.toBeInstanceOf(
      ProjectDirectoryError,
    )
    await expect(stat(nestedPath).catch(() => null)).resolves.toBeNull()
    await expect(initializeEmptyGitRepository(existingPath)).rejects.toThrow(
      'will not commit its existing contents automatically',
    )
    await expect(Bun.file(join(existingPath, '.git')).exists()).resolves.toBe(false)
  })

  test('rolls back untouched initialization when a later repository cannot be prepared', async () => {
    const emptyPath = join(temporaryRoot, 'empty')
    const invalidPath = join(temporaryRoot, 'non-empty')
    await mkdir(emptyPath)
    await mkdir(invalidPath)
    await Bun.write(join(invalidPath, 'existing.txt'), 'keep\n')

    await expect(
      withPreparedProjectRepositories(
        [{ repoPath: emptyPath }, { repoPath: invalidPath }],
        async () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'not_empty' })

    expect(await Bun.file(join(emptyPath, '.git')).exists()).toBe(false)
    expect(await readdir(emptyPath)).toEqual([])
  })

  test('removes a newly created leaf when Project linking fails before it is touched', async () => {
    const selectedPath = join(temporaryRoot, 'new-project')

    await expect(
      withPreparedProjectRepositories([{ repoPath: selectedPath }], async () => {
        throw new Error('link failed')
      }),
    ).rejects.toThrow('link failed')

    await expect(stat(selectedPath).catch(() => null)).resolves.toBeNull()
  })

  test('preserves initialized Git state if a failed link attempt changed the repository', async () => {
    const selectedPath = join(temporaryRoot, 'changed-project')
    await mkdir(selectedPath)

    await expect(
      withPreparedProjectRepositories([{ repoPath: selectedPath }], async ([repository]) => {
        if (!repository) throw new Error('prepared repository missing')
        await Bun.write(join(repository.repoPath, 'created.txt'), 'keep\n')
        throw new Error('link failed after repository change')
      }),
    ).rejects.toThrow('link failed after repository change')

    expect((await stat(join(selectedPath, '.git'))).isDirectory()).toBe(true)
    expect(await Bun.file(join(selectedPath, 'created.txt')).text()).toBe('keep\n')
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
