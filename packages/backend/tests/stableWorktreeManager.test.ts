import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HOPI_RELEASE_BRANCH } from '../src/domain/project'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
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
