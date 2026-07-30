import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorkDocument } from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createC1Integrator, findIntegrationCommits } from '../src/runtime/c1Integrator'
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

describe('C1Integrator', () => {
  test('atomically publishes current task source and explicit Work completion with audit trailers', async () => {
    const fixture = await createFixture()
    const beforeUser = await checkoutSnapshot(fixture.repoRoot)
    const input = await fixture.completionInput()

    const result = await fixture.integrator.complete(input)

    expect(result.kind).toBe('integrated')
    if (result.kind !== 'integrated') throw new Error('Expected C1 integration')
    expect(await git(fixture.projectRoot, ['rev-parse', releaseRef])).toBe(result.commit)
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.status).toBe(
      'done',
    )
    expect(
      await createCompletionStructureVerifier(fixture.store, fixture.layout).verify(
        'goal-1',
        await fixture.store.readPackage('goal-1'),
      ),
    ).toBe(true)

    const message = await git(fixture.projectRoot, ['show', '-s', '--format=%B', result.commit])
    expect(message).toContain('HOPI-Assistant-Event: assistant-event-1')
    expect(message).toContain(`HOPI-Repo-Commit: primary=${input.expectedTaskHeads.primary}`)
    expect(message).toContain('HOPI-Completion-Decision: sha256:')
    expect(message).not.toContain('HOPI-Evidence-Run')
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(beforeUser)

    expect(await fixture.integrator.complete(input)).toEqual({
      kind: 'already_integrated',
      commit: result.commit,
    })
  })

  test('normalizes known historical Work metadata only inside an immutable C1', async () => {
    const fixture = await createFixture()
    const integrated = await fixture.integrator.complete(await fixture.completionInput())
    if (integrated.kind !== 'integrated') throw new Error('Expected C1 integration')

    const workPath = join(fixture.projectRoot, fixture.store.paths.workDocument('goal-1', 'W-1'))
    const currentSource = await Bun.file(workPath).text()
    const historicalSource = currentSource.replace('contextRefs: []\nownerMessages: []\n', '')
    expect(historicalSource).not.toBe(currentSource)
    await Bun.write(workPath, historicalSource)
    await git(fixture.projectRoot, ['add', fixture.store.paths.workDocument('goal-1', 'W-1')])
    await git(fixture.projectRoot, ['commit', '--amend', '--no-edit'])
    const historicalC1 = await git(fixture.projectRoot, ['rev-parse', 'HEAD'])

    await Bun.write(workPath, currentSource)
    await git(fixture.projectRoot, ['add', fixture.store.paths.workDocument('goal-1', 'W-1')])
    await git(fixture.projectRoot, ['commit', '-m', 'publish current Work metadata'])
    await fixture.store.invalidateCache()

    const goalPackage = await fixture.store.readPackage('goal-1')
    expect(
      await findIntegrationCommits(
        fixture.projectRoot,
        releaseRef,
        'project:project-1/goal:goal-1/work:W-1',
      ),
    ).toEqual([historicalC1])
    expect(
      await createCompletionStructureVerifier(fixture.store).verify('goal-1', goalPackage),
    ).toBe(true)
  })

  test('integrates task-side deletions and supports canonical-only completion', async () => {
    const deletion = await createFixture()
    await rm(join(deletion.taskWorktreePath, 'README.md'))
    await checkpointTaskWorktree({
      worktreePath: deletion.taskWorktreePath,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-delete',
    })
    expect((await deletion.integrator.complete(await deletion.completionInput())).kind).toBe(
      'integrated',
    )
    expect(await Bun.file(join(deletion.projectRoot, 'README.md')).exists()).toBe(false)

    const canonicalOnly = await createFixture({ sourceChange: false })
    const before = await git(canonicalOnly.projectRoot, ['rev-parse', releaseRef])
    const result = await canonicalOnly.integrator.complete(await canonicalOnly.completionInput())
    expect(result.kind).toBe('integrated')
    if (result.kind !== 'integrated') throw new Error('Expected canonical-only C1')
    expect(result.commit).not.toBe(before)
    expect(await Bun.file(join(canonicalOnly.projectRoot, 'src', 'feature.ts')).text()).toContain(
      '1',
    )
  })

  test('rejects source conflicts and stale task heads before moving the release', async () => {
    const conflict = await createFixture()
    await Bun.write(join(conflict.projectRoot, 'src', 'feature.ts'), 'export const feature = 3\n')
    await git(conflict.projectRoot, ['add', 'src/feature.ts'])
    await git(conflict.projectRoot, ['commit', '-m', 'concurrent release change'])
    const currentRelease = await git(conflict.projectRoot, ['rev-parse', releaseRef])

    expect(await conflict.integrator.complete(await conflict.completionInput())).toMatchObject({
      kind: 'rejected',
    })
    expect(await git(conflict.projectRoot, ['rev-parse', releaseRef])).toBe(currentRelease)
    expect((await conflict.store.readPackage('goal-1')).works.get('W-1')?.attributes.status).toBe(
      'open',
    )

    const stale = await createFixture()
    const staleInput = await stale.completionInput()
    await Bun.write(join(stale.taskWorktreePath, 'src', 'later.ts'), 'export const later = true\n')
    await checkpointTaskWorktree({
      worktreePath: stale.taskWorktreePath,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-later',
    })
    await expect(stale.integrator.complete(staleInput)).rejects.toThrow(
      'task branch changed before C1',
    )
  })

  test('rebuilds on a clean release advance and recovers an uncertain ref acknowledgement', async () => {
    const advanced = await createFixture()
    const input = await advanced.completionInput()
    await Bun.write(join(advanced.projectRoot, 'README.md'), '# New release target\n')
    await git(advanced.projectRoot, ['add', 'README.md'])
    await git(advanced.projectRoot, ['commit', '-m', 'advance release'])
    const currentRelease = await git(advanced.projectRoot, ['rev-parse', releaseRef])

    const rebuilt = await advanced.integrator.complete(input)
    expect(rebuilt.kind).toBe('integrated')
    if (rebuilt.kind !== 'integrated') throw new Error('Expected rebuilt C1')
    expect(await git(advanced.projectRoot, ['show', '-s', '--format=%P', rebuilt.commit])).toBe(
      currentRelease,
    )

    const uncertain = await createFixture()
    const recovered = await uncertain.integrator.complete(await uncertain.completionInput(), {
      async updateRef({ move }) {
        await move()
        throw new Error('lost update-ref acknowledgement')
      },
    })
    expect(recovered).toMatchObject({ kind: 'integrated', recoveredUncertainUpdate: true })
  })

  test('does not roll C1 back after the release ref boundary', async () => {
    const fixture = await createFixture()
    const result = await fixture.integrator.complete(await fixture.completionInput(), {
      beforeMaterialization() {
        throw new Error('simulated materialization stop')
      },
    })

    expect(result.kind).toBe('blocked_after_boundary')
    if (result.kind !== 'blocked_after_boundary') throw new Error('Expected blocked C1')
    expect(await git(fixture.projectRoot, ['rev-parse', releaseRef])).toBe(result.commit)
  })

  test('finds only the exact qualified Work trailer', async () => {
    const fixture = await createFixture()
    const result = await fixture.integrator.complete(await fixture.completionInput())
    if (result.kind !== 'integrated') throw new Error('Expected C1 integration')
    await Bun.write(join(fixture.projectRoot, 'prefix.txt'), 'prefix\n')
    await git(fixture.projectRoot, ['add', 'prefix.txt'])
    await git(fixture.projectRoot, [
      'commit',
      '-m',
      ['prefix', '', 'HOPI-Work-Ref: project:project-1/goal:goal-1/work:W-1-extra'].join('\n'),
    ])

    expect(
      await findIntegrationCommits(
        fixture.projectRoot,
        releaseRef,
        'project:project-1/goal:goal-1/work:W-1',
      ),
    ).toEqual([result.commit])
  })
})

async function createFixture(options: { sourceChange?: boolean } = {}) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-c1-'))
  temporaryRoots.push(temporaryRoot)
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
  await Bun.write(join(repoRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const homeRoot = join(temporaryRoot, 'home')
  const home = createAssistantHomeStore(homeRoot)
  const linked = await home.linkProject({ projectId: 'project-1', repoPath: repoRoot })
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Goal',
    objective: 'Ship feature 2.',
    firstWork: {
      id: 'W-1',
      title: 'Build feature 2',
      kind: 'engineering',
      objective: 'Set feature to 2.',
      acceptanceCriteria: ['Feature equals 2.'],
    },
  })

  const stable = await createStableWorktreeManager().prepare({
    projectRoot: linked.integrationRoot,
    projectId: 'project-1',
    goalId: 'goal-1',
    workId: 'W-1',
    repoId: linked.primaryRepoId,
    primaryRepoId: linked.primaryRepoId,
  })
  if (options.sourceChange !== false) {
    await Bun.write(join(stable.path, 'src', 'feature.ts'), 'export const feature = 2\n')
    await checkpointTaskWorktree({
      worktreePath: stable.path,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-generator',
    })
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
    repoRoot,
    projectRoot: linked.integrationRoot,
    taskWorktreePath: stable.path,
    store,
    layout,
    integrator,
    async completionInput() {
      const workPath = store.paths.workDocument('goal-1', 'W-1')
      const source = await Bun.file(store.paths.absolute(workPath)).text()
      const completedWork = parseWorkDocument(source)
      completedWork.attributes.status = 'done'
      completedWork.body = `${completedWork.body.trim()}\n\n## Completion decision\n\nShip the current task branch.\n`
      return {
        goalId: 'goal-1',
        workId: 'W-1',
        sourceEventId: 'assistant-event-1',
        decision: 'Ship the current task branch.',
        expectedWorkHash: await hashBytes(new TextEncoder().encode(source)),
        taskWorktrees: { primary: stable.path },
        expectedTaskHeads: { primary: await git(stable.path, ['rev-parse', 'HEAD']) },
        completedWork,
      }
    },
  }
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
