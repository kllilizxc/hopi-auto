import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { HomeResetError, applyHomeReset, planHomeReset } from '../src/runtime/homeReset'
import { managedRepoWorktreePaths } from '../src/runtime/managedWorktreePaths'

describe('Assistant Home reset', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  test('clears the Home and its managed Git state without modifying the user checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hopi-home-reset-'))
    roots.push(root)
    const homeRoot = join(root, 'home')
    const repoRoot = join(root, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await git(repoRoot, ['init', '-b', 'main'])
    await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
    await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
    await Bun.write(join(repoRoot, 'source.txt'), 'source\n')
    await git(repoRoot, ['add', '.'])
    await git(repoRoot, ['commit', '-m', 'initial'])
    await Bun.write(join(repoRoot, 'local.txt'), 'dirty checkout\n')

    const managed = managedRepoWorktreePaths(repoRoot, 'P-1')
    await git(repoRoot, ['branch', 'hopi/project/P-1/release'])
    await mkdir(join(managed.integration, '..'), { recursive: true })
    await git(repoRoot, ['worktree', 'add', managed.integration, 'hopi/project/P-1/release'])
    await git(repoRoot, ['branch', 'hopi/work/P-1/G-1/W-1'])

    await mkdir(join(homeRoot, '.hopi'), { recursive: true })
    await Bun.write(
      join(homeRoot, '.hopi', 'projects.yml'),
      stringify({
        projects: [
          {
            projectId: 'P-1',
            repos: [{ repoId: 'primary', repoPath: repoRoot }],
          },
        ],
      }),
    )
    const checkoutBefore = await checkoutSnapshot(repoRoot)
    const plan = await planHomeReset(homeRoot)
    expect(plan.repos).toMatchObject([
      {
        repoPath: repoRoot,
        managedWorktrees: [await realpath(managed.integration)],
        refs: ['refs/heads/hopi/project/P-1/release', 'refs/heads/hopi/work/P-1/G-1/W-1'],
      },
    ])

    await expect(applyHomeReset({ homeRoot, confirm: 'home' })).rejects.toBeInstanceOf(
      HomeResetError,
    )

    const result = await applyHomeReset({ homeRoot, confirm: homeRoot })

    expect(result.kind).toBe('home_reset')
    expect(await Bun.file(join(homeRoot, '.hopi')).exists()).toBe(false)
    expect(await Bun.file(managed.integration).exists()).toBe(false)
    expect(
      (await gitResult(repoRoot, ['show-ref', '--verify', 'refs/heads/hopi/project/P-1/release']))
        .exitCode,
    ).not.toBe(0)
    expect(
      (await gitResult(repoRoot, ['show-ref', '--verify', 'refs/heads/hopi/work/P-1/G-1/W-1']))
        .exitCode,
    ).not.toBe(0)
    expect(await checkoutSnapshot(repoRoot)).toEqual(checkoutBefore)
  })
})

async function checkoutSnapshot(repoRoot: string) {
  return {
    branch: await git(repoRoot, ['branch', '--show-current']),
    head: await git(repoRoot, ['rev-parse', 'HEAD']),
    status: await git(repoRoot, ['status', '--porcelain=v1', '-uall']),
  }
}

async function git(cwd: string, args: string[]) {
  const result = await gitResult(cwd, args)
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}

async function gitResult(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
