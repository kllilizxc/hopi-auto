import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
import { TaskCheckpointError, checkpointTaskWorktree } from '../src/runtime/taskCheckpoint'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'task-checkpoint')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('checkpointTaskWorktree', () => {
  test('commits accumulated source changes on the stable task branch', async () => {
    const fixture = await setup()
    await Bun.write(join(fixture.worktreePath, 'feature.ts'), 'export const feature = true\n')

    const checkpoint = await checkpointTaskWorktree(fixture.input)

    expect(checkpoint.created).toBe(true)
    expect(await git(fixture.worktreePath, ['status', '--porcelain'])).toBe('')
    expect(await git(fixture.worktreePath, ['show', '-s', '--format=%B', 'HEAD'])).toContain(
      'HOPI-Producer-Run: run-1',
    )
  })

  test('is a no-op when the task branch is already checkpointed', async () => {
    const fixture = await setup()

    const checkpoint = await checkpointTaskWorktree(fixture.input)

    expect(checkpoint.created).toBe(false)
    expect(checkpoint.head).toBe(await git(fixture.worktreePath, ['rev-parse', 'HEAD']))
  })

  test('fails without committing forbidden canonical changes', async () => {
    const fixture = await setup()
    await mkdir(join(fixture.worktreePath, '.hopi'), { recursive: true })
    await Bun.write(
      join(fixture.worktreePath, '.hopi', 'project.yml'),
      'version: 1\nprojectId: P-1\n',
    )
    await git(fixture.worktreePath, ['add', '-f', '.hopi/project.yml'])
    await git(fixture.worktreePath, ['commit', '-m', 'canonical baseline'])
    await Bun.write(
      join(fixture.worktreePath, '.hopi', 'project.yml'),
      'version: 1\nprojectId: bad\n',
    )

    const failure = checkpointTaskWorktree(fixture.input).catch((error) => error)
    await expect(failure).resolves.toBeInstanceOf(TaskCheckpointError)
    await expect(failure).resolves.toMatchObject({
      code: 'source_violation',
      message: expect.stringContaining('forbidden .hopi'),
    })
    expect(await git(fixture.worktreePath, ['log', '--oneline'])).not.toContain('checkpoint')
  })
})

async function setup() {
  const repoPath = join(temporaryRoot, 'repo')
  await mkdir(repoPath, { recursive: true })
  await git(repoPath, ['init', '-b', 'main'])
  await git(repoPath, ['config', 'user.email', 'hopi@example.test'])
  await git(repoPath, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoPath, 'README.md'), '# Repo\n')
  await Bun.write(join(repoPath, '.gitignore'), '.hopi\n')
  await git(repoPath, ['add', '.'])
  await git(repoPath, ['commit', '-m', 'initial'])
  const homeRoot = join(temporaryRoot, 'home')
  const project = await createAssistantHomeStore(homeRoot).linkProject({
    projectId: 'P-1',
    repoPath,
  })
  const worktree = await createStableWorktreeManager(homeRoot).prepare({
    projectRoot: project.integrationRoot,
    projectId: 'P-1',
    goalId: 'G-1',
    workId: 'W-1',
  })
  return {
    worktreePath: worktree.path,
    input: {
      worktreePath: worktree.path,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'run-1',
    },
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}
