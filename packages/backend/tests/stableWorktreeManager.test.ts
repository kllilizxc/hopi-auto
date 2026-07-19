import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HOPI_RELEASE_BRANCH } from '../src/domain/project'
import {
  StableWorktreeSyncError,
  createStableWorktreeManager,
} from '../src/runtime/stableWorktreeManager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'stable-worktree-manager')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('createStableWorktreeManager', () => {
  test('reuses one branch and worktree for every Run of an Engineering Work', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const home = createAssistantHomeStore(homeRoot)
    const project = await home.linkProject({ projectId: 'P-1', repoPath })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }

    const first = await manager.prepare(input)
    await Bun.write(join(first.path, 'work.txt'), 'uncommitted Generator work\n')
    const second = await manager.prepare(input)

    expect(second).toEqual(first)
    expect(first.branch).toBe('hopi/work/P-1/G-1/W-1')
    expect(await Bun.file(join(second.path, 'work.txt')).text()).toBe(
      'uncommitted Generator work\n',
    )
    expect(await git(first.path, ['branch', '--show-current'])).toBe(first.branch)
  })

  test('keeps readable Unicode identity valid through Git branches and worktree paths', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-unicode'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-产品工作台',
      repoPath,
    })

    const prepared = await createStableWorktreeManager(homeRoot).prepare({
      projectRoot: project.integrationRoot,
      projectId: project.projectId,
      goalId: 'G-优化前端样式',
      workId: 'W-theme',
    })

    expect(prepared.branch).toBe('hopi/work/P-产品工作台/G-优化前端样式/W-theme')
    expect(await git(prepared.path, ['branch', '--show-current'])).toBe(prepared.branch)
  })

  test('branches from hopi/release without linking canonical .hopi into the task checkout', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const home = createAssistantHomeStore(homeRoot)
    const project = await home.linkProject({ projectId: 'P-1', repoPath })
    await Bun.write(join(repoPath, 'local.txt'), 'user checkout change\n')
    const before = await checkoutSnapshot(repoPath)
    const manager = createStableWorktreeManager(homeRoot)

    const prepared = await manager.prepare({
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    })

    expect(prepared.baseRef).toBe(HOPI_RELEASE_BRANCH)
    expect(await checkoutSnapshot(repoPath)).toEqual(before)
    expect(await Bun.file(join(prepared.path, '.hopi', 'project.yml')).exists()).toBe(false)
  })

  test('materializes task worktrees without inheriting user autocrlf conversion', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    await git(repoPath, ['config', 'core.autocrlf', 'true'])
    await Bun.write(join(repoPath, 'run.sh'), '#!/usr/bin/env bash\nprintf "ready\\n"\n')
    await git(repoPath, ['add', 'run.sh'])
    await git(repoPath, ['commit', '-m', 'add executable text'])
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })

    const prepared = await createStableWorktreeManager(homeRoot).prepare({
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    })

    expect(await Bun.file(join(prepared.path, 'run.sh')).text()).toBe(
      '#!/usr/bin/env bash\nprintf "ready\\n"\n',
    )
  })

  test('creates sibling task worktrees for multiple Repos without dirtying primary', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
    const apiPath = await createRepo(join(temporaryRoot, 'api'))
    const home = createAssistantHomeStore(homeRoot)
    let project = await home.linkProject({ projectId: 'P-1', repoPath: primaryPath })
    project = await home.linkRepo({ projectId: 'P-1', repoId: 'api', repoPath: apiPath })
    const apiRepo = project.repos.find((repo) => repo.repoId === 'api')
    if (!apiRepo) throw new Error('Expected linked api Repo')
    const manager = createStableWorktreeManager(homeRoot)
    const common = { projectId: 'P-1', goalId: 'G-1', workId: 'W-1', primaryRepoId: 'primary' }

    const [primary, api] = await Promise.all([
      manager.prepare({
        ...common,
        repoId: 'primary',
        projectRoot: project.integrationRoot,
      }),
      manager.prepare({
        ...common,
        repoId: 'api',
        projectRoot: apiRepo.integrationRoot,
      }),
    ])
    await Bun.write(join(api.path, 'api-change.txt'), 'isolated\n')

    expect(api.path.startsWith(`${primary.path}/`)).toBe(false)
    expect(primary.branch).toBe(api.branch)
    expect(await git(primary.path, ['status', '--porcelain'])).toBe('')
  })

  test('rebuilds a disposable checkout from its stable task branch after migration cleanup', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const home = createAssistantHomeStore(homeRoot)
    const project = await home.linkProject({ projectId: 'P-1', repoPath })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const first = await manager.prepare(input)
    await Bun.write(join(first.path, 'checkpoint.txt'), 'preserved on the task branch\n')
    await git(first.path, ['add', 'checkpoint.txt'])
    await git(first.path, ['commit', '-m', 'task checkpoint'])
    await rm(first.path, { recursive: true, force: true })

    const rebuilt = await manager.prepare(input)

    expect(rebuilt.branch).toBe(first.branch)
    expect(
      (await Bun.file(join(rebuilt.path, 'checkpoint.txt')).text()).replaceAll('\r\n', '\n'),
    ).toBe('preserved on the task branch\n')
  })

  test('rebuilds a dirty Reviewer checkout from the stable task checkpoint', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    await Bun.write(join(prepared.path, 'checkpoint.txt'), 'durable task change\n')
    await git(prepared.path, ['add', 'checkpoint.txt'])
    await git(prepared.path, ['commit', '-m', 'task checkpoint'])
    await Bun.write(join(prepared.path, 'test-results', 'output.txt'), 'review residue\n')

    const clean = await manager.prepareClean(input)

    expect(clean).toEqual(prepared)
    expect(await git(clean.path, ['status', '--porcelain'])).toBe('')
    expect(
      (await Bun.file(join(clean.path, 'checkpoint.txt')).text()).replaceAll('\r\n', '\n'),
    ).toBe('durable task change\n')
    expect(await Bun.file(join(clean.path, 'test-results', 'output.txt')).exists()).toBe(false)
  })

  test('fast-forwards an unchanged stable task branch to the current release', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-fast-forward'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    const priorTaskHead = await git(prepared.path, ['rev-parse', 'HEAD'])
    await Bun.write(join(project.integrationRoot, 'release.txt'), 'new release source\n')
    await git(project.integrationRoot, ['add', 'release.txt'])
    await git(project.integrationRoot, ['commit', '-m', 'advance release'])
    const releaseHead = await git(project.integrationRoot, ['rev-parse', 'HEAD'])

    const synchronized = await manager.prepare(input)

    expect(await git(synchronized.path, ['rev-parse', 'HEAD'])).toBe(releaseHead)
    expect(await git(synchronized.path, ['status', '--porcelain'])).toBe('')
    expect(await Bun.file(join(synchronized.path, 'release.txt')).text()).toBe(
      'new release source\n',
    )
    expect(priorTaskHead).not.toBe(releaseHead)
  })

  test('merges the current release into a divergent stable task branch without losing its delta', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-divergent'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    await Bun.write(join(prepared.path, 'task.txt'), 'checkpointed task delta\n')
    await git(prepared.path, ['add', 'task.txt'])
    await git(prepared.path, ['commit', '-m', 'task checkpoint'])
    const taskHead = await git(prepared.path, ['rev-parse', 'HEAD'])
    await Bun.write(join(project.integrationRoot, 'release.txt'), 'independent release delta\n')
    await git(project.integrationRoot, ['add', 'release.txt'])
    await git(project.integrationRoot, ['commit', '-m', 'advance release independently'])
    const releaseHead = await git(project.integrationRoot, ['rev-parse', 'HEAD'])

    const synchronized = await manager.prepare(input)
    const synchronizedHead = await git(synchronized.path, ['rev-parse', 'HEAD'])

    expect(synchronizedHead).not.toBe(taskHead)
    expect(synchronizedHead).not.toBe(releaseHead)
    expect(await git(synchronized.path, ['rev-parse', 'HEAD^1'])).toBe(taskHead)
    expect(await git(synchronized.path, ['rev-parse', 'HEAD^2'])).toBe(releaseHead)
    expect(await git(synchronized.path, ['status', '--porcelain'])).toBe('')
    expect(await Bun.file(join(synchronized.path, 'task.txt')).text()).toBe(
      'checkpointed task delta\n',
    )
    expect(await Bun.file(join(synchronized.path, 'release.txt')).text()).toBe(
      'independent release delta\n',
    )
  })

  test('aborts a release conflict back to the exact prior stable task checkpoint', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-conflict'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    await Bun.write(join(prepared.path, 'README.md'), '# Task version\n')
    await git(prepared.path, ['add', 'README.md'])
    await git(prepared.path, ['commit', '-m', 'change task readme'])
    const taskHead = await git(prepared.path, ['rev-parse', 'HEAD'])
    await Bun.write(join(project.integrationRoot, 'README.md'), '# Release version\n')
    await git(project.integrationRoot, ['add', 'README.md'])
    await git(project.integrationRoot, ['commit', '-m', 'change release readme'])

    expect(manager.prepare(input)).rejects.toBeInstanceOf(StableWorktreeSyncError)

    expect(await git(prepared.path, ['rev-parse', 'HEAD'])).toBe(taskHead)
    expect(await git(prepared.path, ['status', '--porcelain'])).toBe('')
    expect(await Bun.file(join(prepared.path, 'README.md')).text()).toBe('# Task version\n')
    expect(await gitExitCode(prepared.path, ['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe(0)
  })

  test('preserves dirty source for Work recovery when release synchronization is needed', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-dirty'))
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    const taskHead = await git(prepared.path, ['rev-parse', 'HEAD'])
    await Bun.write(join(prepared.path, 'unfinished.txt'), 'uncheckpointed source\n')
    await Bun.write(join(project.integrationRoot, 'release.txt'), 'new release source\n')
    await git(project.integrationRoot, ['add', 'release.txt'])
    await git(project.integrationRoot, ['commit', '-m', 'advance release'])

    expect(manager.prepare(input)).rejects.toBeInstanceOf(StableWorktreeSyncError)

    expect(await git(prepared.path, ['rev-parse', 'HEAD'])).toBe(taskHead)
    expect(await Bun.file(join(prepared.path, 'unfinished.txt')).text()).toBe(
      'uncheckpointed source\n',
    )
    expect(await git(prepared.path, ['status', '--porcelain'])).toBe('?? unfinished.txt')
  })

  test('classifies source exposed by a successful release merge as Work-level sync recovery', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoPath = await createRepo(join(temporaryRoot, 'repo-exposed-source'))
    await Bun.write(join(repoPath, '.gitignore'), 'candidate.json\n')
    await git(repoPath, ['add', '.gitignore'])
    await git(repoPath, ['commit', '-m', 'ignore candidate output'])
    const project = await createAssistantHomeStore(homeRoot).linkProject({
      projectId: 'P-1',
      repoPath,
    })
    const manager = createStableWorktreeManager(homeRoot)
    const input = {
      projectRoot: project.integrationRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
    }
    const prepared = await manager.prepare(input)
    await Bun.write(join(prepared.path, 'candidate.json'), '{"preserved":true}\n')
    await Bun.write(join(prepared.path, 'task.txt'), 'checkpointed task delta\n')
    await git(prepared.path, ['add', 'task.txt'])
    await git(prepared.path, ['commit', '-m', 'checkpoint task delta'])
    const taskHead = await git(prepared.path, ['rev-parse', 'HEAD'])

    await rm(join(project.integrationRoot, '.gitignore'))
    await Bun.write(join(project.integrationRoot, 'release.txt'), 'release delta\n')
    await git(project.integrationRoot, ['add', '--all'])
    await git(project.integrationRoot, ['commit', '-m', 'expose candidate output'])
    const releaseHead = await git(project.integrationRoot, ['rev-parse', 'HEAD'])

    const syncError = await manager.prepare(input).catch((error: unknown) => error)
    expect(syncError).toBeInstanceOf(StableWorktreeSyncError)
    expect((syncError as Error).message).toContain(
      'merge exposed preserved source changes (?? candidate.json)',
    )

    const synchronizedHead = await git(prepared.path, ['rev-parse', 'HEAD'])
    expect(synchronizedHead).not.toBe(taskHead)
    expect(
      await gitExitCode(prepared.path, ['merge-base', '--is-ancestor', releaseHead, 'HEAD']),
    ).toBe(0)
    expect(await Bun.file(join(prepared.path, 'candidate.json')).text()).toBe(
      '{"preserved":true}\n',
    )
    expect(await git(prepared.path, ['status', '--porcelain'])).toBe('?? candidate.json')
  })
})

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Repo\n')
  await git(path, ['add', 'README.md'])
  await git(path, ['commit', '-m', 'initial'])
  return path
}

async function checkoutSnapshot(path: string) {
  const [head, branch, status] = await Promise.all([
    git(path, ['rev-parse', 'HEAD']),
    git(path, ['branch', '--show-current']),
    git(path, ['status', '--porcelain']),
  ])
  return { head, branch, status }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  return stdout.trim()
}

async function gitExitCode(cwd: string, args: string[]) {
  return Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' }).exited
}
