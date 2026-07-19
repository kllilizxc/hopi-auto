import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { HOPI_RELEASE_REF } from '../src/domain/project'
import {
  parseProjectDocument,
  renderProjectDocument,
  withRepoRelease,
} from '../src/domain/projectDocument'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createC1Integrator, reconcileProjectReleaseProjection } from '../src/runtime/c1Integrator'
import { createCompletionStructureVerifier } from '../src/runtime/completionVerifier'
import { createPassOutcomeCoordinator } from '../src/runtime/passOutcomeCoordinator'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
import { checkpointTaskWorktree } from '../src/runtime/taskCheckpoint'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('multi-Repo C1', () => {
  test('one Work changes primary and secondary Repos through one primary C1', async () => {
    const fixture = await createFixture(['primary', 'api'])

    const result = await fixture.integrator.integrate(fixture.integrationInput)

    if (result.kind !== 'integrated') throw new Error(JSON.stringify(result))
    expect(result.kind).toBe('integrated')
    expect(await git(fixture.linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(
      result.commit,
    )
    expect(await sourceValue(fixture.repo('primary').integrationRoot)).toBe(2)
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    const projectDocument = parseProjectDocument(
      await Bun.file(join(fixture.linked.integrationRoot, '.hopi', 'project.yml')).text(),
    )
    const apiRelease = await git(fixture.repo('api').integrationRoot, [
      'rev-parse',
      HOPI_RELEASE_REF,
    ])
    expect(projectDocument.repos.find((repo) => repo.repoId === 'api')?.releaseCommit).toBe(
      apiRelease,
    )
    expect(
      await git(fixture.repo('api').integrationRoot, ['show', '-s', '--format=%P', apiRelease]),
    ).toBe(requireMapValue(fixture.releaseBefore, 'api'))
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
    expect(
      await createCompletionStructureVerifier(fixture.store, fixture.layout).verify(
        'goal-1',
        await fixture.store.readPackage('goal-1'),
      ),
    ).toBe(true)
    for (const repo of fixture.linked.repos) {
      const before = requireMapValue(fixture.userBefore, repo.repoId)
      expect(await checkoutSnapshot(repo.repoPath)).toEqual({
        head: await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF]),
        branch: before.branch,
        status: '',
      })
    }
  })

  test('a secondary-only Work keeps canonical Work and Evidence in primary', async () => {
    const fixture = await createFixture(['api'])

    const result = await fixture.integrator.integrate(fixture.integrationInput)

    if (result.kind !== 'integrated') throw new Error(JSON.stringify(result))
    expect(result.kind).toBe('integrated')
    expect(await sourceValue(fixture.repo('primary').integrationRoot)).toBe(1)
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    expect(
      await git(fixture.linked.integrationRoot, [
        'show',
        `${result.commit}:${fixture.store.paths.workDocument('goal-1', 'W-1')}`,
      ]),
    ).toContain('stage: done')
    expect((await fixture.store.readPackage('goal-1')).evidence.has('E-run-review')).toBe(true)
  })

  test('rejects a secondary Repo source conflict before primary C1', async () => {
    const fixture = await createFixture(['api'])
    const primaryBefore = await git(fixture.linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
    await fixture.advanceRepo('api', 3)

    const result = await fixture.integrator.integrate(fixture.integrationInput)

    expect(result).toMatchObject({ kind: 'rejected' })
    expect(await git(fixture.linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(
      primaryBefore,
    )
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'review',
    )
  })

  test('retries only projection after a crash following primary C1', async () => {
    const fixture = await createFixture(['api'])
    const apiBefore = fixture.releaseBefore.get('api')
    if (!apiBefore) throw new Error('Expected api release')

    const interrupted = await fixture.integrator.integrate(fixture.integrationInput, {
      beforeSecondaryProjection() {
        throw new Error('simulated process stop before secondary projection')
      },
    })

    expect(interrupted.kind).toBe('blocked_after_boundary')
    if (interrupted.kind !== 'blocked_after_boundary') throw new Error('Expected durable C1')
    expect(await git(fixture.repo('api').integrationRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(
      apiBefore,
    )
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )

    const recovered = await fixture.integrator.integrate(fixture.integrationInput)

    expect(recovered).toEqual({
      kind: 'already_integrated',
      commit: interrupted.commit,
      deliveryIssues: [],
    })
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    expect(await git(fixture.linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(
      interrupted.commit,
    )
  })

  test('startup reconciliation completes primary and secondary materialization after C1', async () => {
    const fixture = await createFixture(['api'])

    const interrupted = await fixture.integrator.integrate(fixture.integrationInput, {
      beforeMaterialization() {
        throw new Error('simulated process stop immediately after primary ref move')
      },
    })

    expect(interrupted.kind).toBe('blocked_after_boundary')
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'review',
    )

    await reconcileProjectReleaseProjection(fixture.layout)

    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
  })

  test('archives and removes unexpected managed integration files during reconciliation', async () => {
    const fixture = await createFixture(['api'])
    const apiRoot = fixture.repo('api').integrationRoot
    const leakedPath = join(apiRoot, 'tests', 'leaked.spec.ts')
    const stagedPath = join(apiRoot, 'tests', 'staged.spec.ts')
    await mkdir(join(apiRoot, 'tests'), { recursive: true })
    await Bun.write(leakedPath, 'leaked planner output\n')
    await Bun.write(stagedPath, 'staged planner output\n')
    await git(apiRoot, ['add', 'tests/staged.spec.ts'])

    await reconcileProjectReleaseProjection(fixture.layout)

    expect(await Bun.file(leakedPath).exists()).toBe(false)
    expect(await Bun.file(stagedPath).exists()).toBe(false)
    const recoveryRoot = join(apiRoot, '..', 'recovery')
    const recoveries = await readdir(recoveryRoot)
    expect(recoveries).toHaveLength(1)
    const recoveryPath = join(recoveryRoot, recoveries[0] ?? '')
    expect(await Bun.file(join(recoveryPath, 'files', 'tests', 'leaked.spec.ts')).text()).toBe(
      'leaked planner output\n',
    )
    expect(await Bun.file(join(recoveryPath, 'files', 'tests', 'staged.spec.ts')).text()).toBe(
      'staged planner output\n',
    )
    const manifest = await Bun.file(join(recoveryPath, 'manifest.json')).json()
    expect(manifest).toMatchObject({
      repoId: 'api',
      integrationRoot: apiRoot,
    })
    expect(manifest.preservedPaths).toContain('tests/leaked.spec.ts')
    expect(manifest.preservedPaths).toContain('tests/staged.spec.ts')
    expect(await git(apiRoot, ['status', '--porcelain=v1', '--untracked-files=all'])).toBe('')
  })

  test('continues remaining Repo projections after a partial projection', async () => {
    const fixture = await createFixture(['api', 'worker'])
    let projected = 0

    const interrupted = await fixture.integrator.integrate(fixture.integrationInput, {
      afterSecondaryProjection() {
        projected += 1
        if (projected === 1) throw new Error('simulated stop after first secondary projection')
      },
    })

    expect(interrupted.kind).toBe('blocked_after_boundary')
    if (interrupted.kind !== 'blocked_after_boundary') throw new Error('Expected durable C1')
    const changedBeforeRecovery = await Promise.all(
      ['api', 'worker'].map(
        async (repoId) =>
          (await git(fixture.repo(repoId).integrationRoot, ['rev-parse', HOPI_RELEASE_REF])) !==
          fixture.releaseBefore.get(repoId),
      ),
    )
    expect(changedBeforeRecovery.filter(Boolean)).toHaveLength(1)

    const recovered = await fixture.integrator.integrate(fixture.integrationInput)

    expect(recovered.kind).toBe('already_integrated')
    expect(await sourceValue(fixture.repo('api').integrationRoot)).toBe(2)
    expect(await sourceValue(fixture.repo('worker').integrationRoot)).toBe(2)
  })

  test('blocks an unexpected secondary ref after C1 without rolling primary back', async () => {
    const fixture = await createFixture(['api'])
    const interrupted = await fixture.integrator.integrate(fixture.integrationInput, {
      beforeSecondaryProjection() {
        throw new Error('simulated process stop before secondary projection')
      },
    })
    if (interrupted.kind !== 'blocked_after_boundary') throw new Error('Expected durable C1')
    const primaryC1 = interrupted.commit
    const apiRoot = fixture.repo('api').integrationRoot
    await Bun.write(join(apiRoot, 'unexpected.txt'), 'external release change\n')
    await git(apiRoot, ['add', 'unexpected.txt'])
    await git(apiRoot, ['commit', '-m', 'unexpected release change'])

    await expect(reconcileProjectReleaseProjection(fixture.layout)).rejects.toThrow('release is')
    expect(await git(fixture.linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(
      primaryC1,
    )
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
  })

  test('keeps one multi-Repo delivery pending and recovers it after checkout becomes clean', async () => {
    const fixture = await createFixture(['primary', 'api'])
    const api = fixture.repo('api')
    await Bun.write(join(api.repoPath, 'local.txt'), 'local state\n')

    const integrated = await fixture.integrator.integrate(fixture.integrationInput)

    expect(integrated.kind).toBe('integrated')
    if (integrated.kind !== 'integrated') throw new Error('Expected integrated C1')
    expect(integrated.deliveryIssues).toEqual([
      { repoId: 'api', reason: 'Repo api delivery checkout is dirty' },
    ])
    expect(await sourceValue(fixture.repo('primary').repoPath)).toBe(2)
    expect(await sourceValue(api.repoPath)).toBe(1)
    await rm(join(api.repoPath, 'local.txt'))

    await reconcileProjectReleaseProjection(fixture.layout)

    expect(await sourceValue(api.repoPath)).toBe(2)
  })
})

async function createFixture(workRepoIds: string[]) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-multi-c1-'))
  temporaryRoots.push(temporaryRoot)
  const primaryPath = await createRepo(join(temporaryRoot, 'primary'))
  const secondaryIds = [...new Set(workRepoIds.filter((repoId) => repoId !== 'primary'))]
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
          [repo.repoId, await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])] as const,
      ),
    ),
  )

  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({ goalId: 'goal-1', title: 'Goal', objective: 'Ship value 2.' })
  const planningPath = store.paths.workDocument('goal-1', 'plan-initial')
  const planningSource = await Bun.file(store.paths.absolute(planningPath)).text()
  const planning = parseWorkDocument(planningSource)
  planning.attributes.stage = 'done'
  await store.publishGoal('goal-1', {
    supportingWrites: [
      {
        path: store.paths.workDocument('goal-1', 'W-1'),
        expectedHash: null,
        content: renderWorkDocument({
          attributes: {
            id: 'W-1',
            title: 'Build value 2',
            kind: 'engineering',
            stage: 'review',
            repos: workRepoIds,
            notBefore: null,
            dependsOn: [],
            contractRevision: 1,
            evidenceRefs: [],
            attempts: 0,
          },
          body: '## Acceptance Criteria\n\n- every selected Repo value equals 2.\n',
        }),
      },
    ],
    gateWrite: {
      path: planningPath,
      expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
      content: renderWorkDocument(planning),
    },
  })

  const manager = createStableWorktreeManager(homeRoot)
  const taskWorktrees = new Map<string, string>()
  for (const repoId of workRepoIds) {
    const repo = linked.repos.find((candidate) => candidate.repoId === repoId)
    if (!repo) throw new Error(`Missing fixture Repo ${repoId}`)
    const stable = await manager.prepare({
      projectRoot: repo.integrationRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      repoId,
      primaryRepoId: linked.primaryRepoId,
    })
    await Bun.write(join(stable.path, 'src', 'value.ts'), 'export const value = 2\n')
    await checkpointTaskWorktree({
      worktreePath: stable.path,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-generator',
      repoId,
    })
    taskWorktrees.set(repoId, stable.path)
  }

  const stager = createRoleContextStager(homeRoot, publisher)
  const context = await stager.prepare({
    projectRoot: linked.integrationRoot,
    projectId: 'project-1',
    goalId: 'goal-1',
    workId: 'W-1',
    runId: 'run-review',
    responsibility: 'reviewer',
    primaryRepoId: linked.primaryRepoId,
    repoRoots: workRepoIds.map((repoId) => ({
      repoId,
      path: requireMapValue(taskWorktrees, repoId),
      primary: repoId === linked.primaryRepoId,
    })),
  })
  const pass = {
    goalId: 'goal-1',
    workId: 'W-1',
    runId: 'run-review',
    responsibility: 'reviewer' as const,
    context,
    outcome: {
      result: 'success' as const,
      summary: 'Reviewer verified every selected Repo value.',
      artifacts: [],
      exitCode: 0,
    },
  }
  const application = await createPassOutcomeCoordinator(store, publisher, {
    now: () => new Date('2026-07-12T00:00:00Z'),
  }).apply(pass)
  if (application.kind !== 'integration_required') {
    throw new Error(`Expected integration_required, got ${application.kind}`)
  }
  const layout = {
    primaryRepoId: linked.primaryRepoId,
    repos: linked.repos.map((repo) => ({
      repoId: repo.repoId,
      integrationRoot: repo.integrationRoot,
      checkoutRoot: repo.repoPath,
      deliveryBranch: repo.deliveryBranch,
      primary: repo.primary,
    })),
  }
  const integrator = createC1Integrator(
    homeRoot,
    store,
    publisher,
    () => new Date('2026-07-12T00:00:00Z'),
    layout,
  )
  const firstWorkRepoId = workRepoIds[0]
  if (!firstWorkRepoId) throw new Error('Fixture requires at least one Work Repo')

  return {
    linked,
    store,
    integrator,
    layout,
    releaseBefore,
    userBefore,
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
      const release = await git(repo.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
      const projectPath = join(linked.integrationRoot, '.hopi', 'project.yml')
      const document = parseProjectDocument(await Bun.file(projectPath).text())
      await Bun.write(
        projectPath,
        renderProjectDocument(withRepoRelease(document, repoId, release)),
      )
    },
    integrationInput: {
      pass,
      taskWorktreePath: requireMapValue(taskWorktrees, firstWorkRepoId),
      taskWorktrees: Object.fromEntries(taskWorktrees),
      evidence: application.evidence,
      completedWork: application.work,
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
