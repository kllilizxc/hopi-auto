import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRunChangeSetStore, readGitHead } from '../src/runtime/runChangeSet'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('RunChangeSetStore', () => {
  test('EV-004 freezes a multi-Repo source delta as immutable unaccepted evidence', async () => {
    const root = await temporaryRoot()
    const homeRoot = join(root, 'home')
    const firstRepo = await createRepo(root, 'repo-a', 'export const value = 1\n')
    const secondRepo = await createRepo(root, 'repo-b', 'export const other = 1\n')
    const firstBase = await readGitHead(firstRepo)
    const secondBase = await readGitHead(secondRepo)
    await Bun.write(join(firstRepo, 'feature.ts'), 'export const value = 2\n')
    await Bun.write(join(secondRepo, 'feature.ts'), 'export const other = 2\n')
    await commit(firstRepo, 'first result')
    await commit(secondRepo, 'second result')
    const firstResult = await readGitHead(firstRepo)
    const secondResult = await readGitHead(secondRepo)
    const store = createRunChangeSetStore(homeRoot, {
      now: () => new Date('2026-08-13T00:00:00.000Z'),
    })

    const frozen = await store.freeze({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      repos: [
        {
          repoId: 'repo-b',
          worktreePath: secondRepo,
          baseCommit: secondBase,
          resultCommit: secondResult,
        },
        {
          repoId: 'repo-a',
          worktreePath: firstRepo,
          baseCommit: firstBase,
          resultCommit: firstResult,
        },
      ],
    })

    if (!frozen) throw new Error('Expected a ChangeSet')
    expect({
      id: frozen.id,
      producerRunId: frozen.producerRunId,
      disposition: frozen.disposition,
      repos: frozen.repos.map(({ repoId, baseCommit, resultCommit }) => ({
        repoId,
        baseCommit,
        resultCommit,
      })),
    }).toEqual({
      id: 'CS-R-1',
      producerRunId: 'R-1',
      disposition: 'unaccepted',
      repos: [
        { repoId: 'repo-a', baseCommit: firstBase, resultCommit: firstResult },
        { repoId: 'repo-b', baseCommit: secondBase, resultCommit: secondResult },
      ],
    })
    expect(frozen.manifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(frozen.repos.every((repo) => /^[a-f0-9]{64}$/.test(repo.contentHash))).toBe(true)
    const patch = new TextDecoder().decode(await store.readPatch(frozen, 'repo-a'))
    expect(patch).toContain('-export const value = 1')
    expect(patch).toContain('+export const value = 2')

    await rm(firstRepo, { recursive: true, force: true })
    await rm(secondRepo, { recursive: true, force: true })
    const restarted = createRunChangeSetStore(homeRoot)
    expect(await restarted.read('R-1')).toEqual(frozen)
    expect(new TextDecoder().decode(await restarted.readPatch(frozen, 'repo-b'))).toContain(
      '+export const other = 2',
    )
  })

  test('returns no ChangeSet for an unchanged Run and refuses to replace frozen heads', async () => {
    const root = await temporaryRoot()
    const homeRoot = join(root, 'home')
    const repo = await createRepo(root, 'repo', 'first\n')
    const base = await readGitHead(repo)
    const store = createRunChangeSetStore(homeRoot)
    expect(
      await store.freeze({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-empty',
        repos: [{ repoId: 'repo', worktreePath: repo, baseCommit: base, resultCommit: base }],
      }),
    ).toBeNull()

    await Bun.write(join(repo, 'feature.ts'), 'second\n')
    await commit(repo, 'second')
    const second = await readGitHead(repo)
    const frozen = await store.freeze({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-frozen',
      repos: [{ repoId: 'repo', worktreePath: repo, baseCommit: base, resultCommit: second }],
    })
    expect(frozen?.repos).toHaveLength(1)

    await Bun.write(join(repo, 'feature.ts'), 'third\n')
    await commit(repo, 'third')
    const third = await readGitHead(repo)
    expect(
      store.freeze({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-frozen',
        repos: [{ repoId: 'repo', worktreePath: repo, baseCommit: base, resultCommit: third }],
      }),
    ).rejects.toThrow('ChangeSet is immutable')
  })
})

async function createRepo(root: string, name: string, content: string) {
  const repo = join(root, name)
  await mkdir(repo, { recursive: true })
  await git(repo, ['init', '-q'])
  await Bun.write(join(repo, 'feature.ts'), content)
  await commit(repo, 'base')
  return repo
}

async function commit(repo: string, message: string) {
  await git(repo, ['add', '-A'])
  await git(
    repo,
    [
      '-c',
      'user.name=HOPI Test',
      '-c',
      'user.email=hopi-test@example.com',
      'commit',
      '-q',
      '-m',
      message,
    ],
    { GIT_AUTHOR_DATE: '2026-08-13T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-13T00:00:00Z' },
  )
}

async function git(repo: string, args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(['git', ...args], {
    cwd: repo,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, ...env },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-change-set-'))
  temporaryRoots.push(root)
  return root
}
