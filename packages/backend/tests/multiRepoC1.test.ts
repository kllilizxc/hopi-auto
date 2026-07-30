import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorkDocument } from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import {
  parseProjectDocument,
  renderProjectDocument,
  withRepoRelease,
} from '../src/domain/projectDocument'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createC1Integrator, reconcileProjectReleaseProjection } from '../src/runtime/c1Integrator'
import { createCompletionStructureVerifier } from '../src/runtime/completionVerifier'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
import { checkpointTaskWorktree } from '../src/runtime/taskCheckpoint'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []
const releaseRef = projectReleaseRef('project-1')

setDefaultTimeout(20_000)

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('multi-Repo C1', () => {
  test('publishes current task heads from primary and secondary Repos through one C1', async () => {
    const fixture = await createFixture(['primary', 'api'])
    const input = await fixture.completionInput()

    const result = await fixture.integrator.complete(input)

    if (result.kind !== 'integrated') throw new Error(JSON.stringify(result))
    expect(await git(fixture.linked.integrationRoot, ['rev-parse', releaseRef])).toBe(result.commit)
    expect(await sourceValue(fixture.repo('primary').integrationRoot)).toBe(2)
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)

    const project = parseProjectDocument(
      await Bun.file(join(fixture.linked.integrationRoot, '.hopi', 'project.yml')).text(),
    )
    const apiRelease = await git(fixture.repo('api').integrationRoot, ['rev-parse', releaseRef])
    expect(project.repos.find((repo) => repo.repoId === 'api')?.releaseCommit).toBe(apiRelease)
    expect(
      await git(fixture.repo('api').integrationRoot, ['show', '-s', '--format=%P', apiRelease]),
    ).toBe(requireMapValue(fixture.releaseBefore, 'api'))
    expect(
      await createCompletionStructureVerifier(fixture.store, fixture.layout).verify(
        'goal-1',
        await fixture.store.readPackage('goal-1'),
      ),
    ).toBe(true)

    const message = await git(fixture.linked.integrationRoot, [
      'show',
      '-s',
      '--format=%B',
      result.commit,
    ])
    expect(message).toContain(`HOPI-Repo-Commit: primary=${input.expectedTaskHeads.primary}`)
    expect(message).toContain(`HOPI-Repo-Commit: api=${input.expectedTaskHeads.api}`)
    for (const repo of fixture.linked.repos) {
      expect(await checkoutSnapshot(repo.repoPath)).toEqual(
        requireMapValue(fixture.userBefore, repo.repoId),
      )
    }
  })

  test('supports a secondary-only source change while completing Work canonically in primary', async () => {
    const fixture = await createFixture(['api'])

    const result = await fixture.integrator.complete(await fixture.completionInput())

    if (result.kind !== 'integrated') throw new Error(JSON.stringify(result))
    expect(await sourceValue(fixture.repo('primary').integrationRoot)).toBe(1)
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    expect(
      await git(fixture.linked.integrationRoot, [
        'show',
        `${result.commit}:${fixture.store.paths.workDocument('goal-1', 'W-1')}`,
      ]),
    ).toContain('status: done')
  })

  test('rejects a secondary source conflict and a changed task head before primary C1', async () => {
    const conflict = await createFixture(['api'])
    const primaryBefore = await git(conflict.linked.integrationRoot, ['rev-parse', releaseRef])
    await conflict.advanceRepo('api', 3)

    expect(await conflict.integrator.complete(await conflict.completionInput())).toMatchObject({
      kind: 'rejected',
    })
    expect(await git(conflict.linked.integrationRoot, ['rev-parse', releaseRef])).toBe(
      primaryBefore,
    )

    const stale = await createFixture(['api'])
    const input = await stale.completionInput()
    const apiTask = requireMapValue(stale.taskWorktrees, 'api')
    await Bun.write(join(apiTask, 'src', 'later.ts'), 'export const later = true\n')
    await checkpointTaskWorktree({
      worktreePath: apiTask,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-api-later',
      repoId: 'api',
    })
    await expect(stale.integrator.complete(input)).rejects.toThrow(
      'Repo api task branch changed before C1',
    )
  })

  test('reads a known v2 Project manifest only from an immutable release parent', async () => {
    const fixture = await createFixture(['api'])
    const projectPath = join(fixture.linked.integrationRoot, '.hopi', 'project.yml')
    const current = await Bun.file(projectPath).text()

    await Bun.write(projectPath, `version: 2\n${current}`)
    await git(fixture.linked.integrationRoot, ['add', '.hopi/project.yml'])
    await git(fixture.linked.integrationRoot, ['commit', '-m', 'historical project manifest'])
    await Bun.write(projectPath, current)
    await git(fixture.linked.integrationRoot, ['add', '.hopi/project.yml'])
    await git(fixture.linked.integrationRoot, ['commit', '-m', 'current project manifest'])

    await reconcileProjectReleaseProjection(fixture.layout)

    expect(parseProjectDocument(await Bun.file(projectPath).text())).toEqual(
      parseProjectDocument(current),
    )
  })

  test('recovers secondary projections after primary C1 without rebuilding delivery state', async () => {
    const fixture = await createFixture(['api', 'worker'])
    let projected = 0
    const input = await fixture.completionInput()

    const interrupted = await fixture.integrator.complete(input, {
      afterSecondaryProjection() {
        projected += 1
        if (projected === 1) throw new Error('stop after first secondary projection')
      },
    })

    expect(interrupted.kind).toBe('blocked_after_boundary')
    if (interrupted.kind !== 'blocked_after_boundary') throw new Error('Expected durable C1')
    expect(
      (
        await Promise.all(
          ['api', 'worker'].map(
            async (repoId) =>
              (await git(fixture.repo(repoId).integrationRoot, ['rev-parse', releaseRef])) !==
              requireMapValue(fixture.releaseBefore, repoId),
          ),
        )
      ).filter(Boolean),
    ).toHaveLength(1)

    expect(await fixture.integrator.complete(input)).toEqual({
      kind: 'already_integrated',
      commit: interrupted.commit,
    })
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    expect(await sourceValue(fixture.repo('worker').integrationRoot)).toBe(2)

    await reconcileProjectReleaseProjection(fixture.layout)
    expect(
      await createCompletionStructureVerifier(fixture.store, fixture.layout).verify(
        'goal-1',
        await fixture.store.readPackage('goal-1'),
      ),
    ).toBe(true)
  })
})

async function createFixture(changedRepoIds: string[]) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-multi-c1-'))
  temporaryRoots.push(temporaryRoot)
  const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
  const secondaryIds = [...new Set(changedRepoIds.filter((repoId) => repoId !== 'primary'))]
  const secondaryPaths = new Map<string, string>()
  for (const repoId of secondaryIds) {
    secondaryPaths.set(repoId, await createRepo(join(temporaryRoot, repoId)))
  }

  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  let linked = await home.linkProject({ projectId: 'project-1', repoPath: primaryPath })
  for (const [repoId, repoPath] of secondaryPaths) {
    linked = await home.linkRepo({ projectId: 'project-1', repoId, repoPath })
  }
  const userBefore = new Map(
    await Promise.all(
      linked.repos.map(
        async (repo) => [repo.repoId, await checkoutSnapshot(repo.repoPath)] as const,
      ),
    ),
  )
  const releaseBefore = new Map(
    await Promise.all(
      linked.repos.map(
        async (repo) =>
          [repo.repoId, await git(repo.integrationRoot, ['rev-parse', releaseRef])] as const,
      ),
    ),
  )

  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Goal',
    objective: 'Ship value 2.',
    firstWork: {
      id: 'W-1',
      title: 'Build value 2',
      kind: 'engineering',
      objective: 'Set every affected Repo value to 2.',
      acceptanceCriteria: ['Every affected Repo value equals 2.'],
    },
  })

  const manager = createStableWorktreeManager()
  const taskWorktrees = new Map<string, string>()
  for (const repo of linked.repos) {
    const stable = await manager.prepare({
      projectRoot: repo.integrationRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      repoId: repo.repoId,
      primaryRepoId: linked.primaryRepoId,
    })
    if (changedRepoIds.includes(repo.repoId)) {
      await Bun.write(join(stable.path, 'src', 'value.ts'), 'export const value = 2\n')
    }
    await checkpointTaskWorktree({
      worktreePath: stable.path,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-generator',
      repoId: repo.repoId,
    })
    taskWorktrees.set(repo.repoId, stable.path)
  }

  const layout = {
    projectId: linked.projectId,
    primaryRepoId: linked.primaryRepoId,
    repos: linked.repos.map((repo) => ({
      repoId: repo.repoId,
      integrationRoot: repo.integrationRoot,
      projectPath: repo.projectPath,
      primary: repo.primary,
    })),
  }
  const integrator = createC1Integrator(
    homeRoot,
    store,
    publisher,
    () => new Date('2026-08-13T00:00:00Z'),
    layout,
  )

  return {
    linked,
    store,
    integrator,
    layout,
    releaseBefore,
    userBefore,
    taskWorktrees,
    repo(repoId: string) {
      const repo = linked.repos.find((candidate) => candidate.repoId === repoId)
      if (!repo) throw new Error(`Missing Repo ${repoId}`)
      return repo
    },
    async advanceRepo(repoId: string, value: number) {
      const repo = linked.repos.find((candidate) => candidate.repoId === repoId)
      if (!repo || repo.primary) throw new Error(`Missing secondary Repo ${repoId}`)
      await Bun.write(
        join(repo.integrationRoot, 'src', 'value.ts'),
        `export const value = ${value}\n`,
      )
      await git(repo.integrationRoot, ['add', 'src/value.ts'])
      await git(repo.integrationRoot, ['commit', '-m', `advance ${repoId}`])
      const release = await git(repo.integrationRoot, ['rev-parse', releaseRef])
      const projectPath = join(linked.integrationRoot, '.hopi', 'project.yml')
      const document = parseProjectDocument(await Bun.file(projectPath).text())
      await Bun.write(
        projectPath,
        renderProjectDocument(withRepoRelease(document, repoId, release)),
      )
    },
    async completionInput() {
      const workPath = store.paths.workDocument('goal-1', 'W-1')
      const source = await Bun.file(store.paths.absolute(workPath)).text()
      const completedWork = parseWorkDocument(source)
      completedWork.attributes.status = 'done'
      completedWork.body = `${completedWork.body.trim()}\n\n## Completion decision\n\nShip all current task heads.\n`
      return {
        goalId: 'goal-1',
        workId: 'W-1',
        sourceEventId: 'assistant-event-multi',
        decision: 'Ship all current task heads.',
        expectedWorkHash: await hashBytes(new TextEncoder().encode(source)),
        taskWorktrees: Object.fromEntries(taskWorktrees),
        expectedTaskHeads: Object.fromEntries(
          await Promise.all(
            [...taskWorktrees].map(async ([repoId, path]) => [
              repoId,
              await git(path, ['rev-parse', 'HEAD']),
            ]),
          ),
        ),
        completedWork,
      }
    },
  }
}

function requireMapValue<K, V>(map: ReadonlyMap<K, V>, key: K) {
  const value = map.get(key)
  if (value === undefined) throw new Error(`Missing fixture value: ${String(key)}`)
  return value
}

async function createRepo(path: string) {
  await mkdir(join(path, 'src'), { recursive: true })
  await Bun.write(join(path, 'README.md'), '# Repo\n')
  await Bun.write(join(path, 'src', 'value.ts'), 'export const value = 1\n')
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', 'initial'])
  return path
}

async function sourceValue(path: string) {
  return Number.parseInt(
    (await Bun.file(join(path, 'src', 'value.ts')).text()).match(/\d+/)?.[0] ?? '',
  )
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
  if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`)
  return stdout.trim()
}
