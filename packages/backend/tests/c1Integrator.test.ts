import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createC1Integrator, findIntegrationCommits } from '../src/runtime/c1Integrator'
import { createCompletionStructureVerifier } from '../src/runtime/completionVerifier'
import { createPassOutcomeCoordinator } from '../src/runtime/passOutcomeCoordinator'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
import { checkpointTaskWorktree } from '../src/runtime/taskCheckpoint'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []
const HOPI_RELEASE_REF = projectReleaseRef('project-1')

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('C1Integrator', () => {
  test('moves the Project release, materializes C1, and leaves the selected checkout unchanged', async () => {
    const fixture = await createFixture()
    const beforeUser = await checkoutSnapshot(fixture.repoRoot)
    const prepared = await fixture.prepareReviewer('run-review')

    const integrated = await fixture.integrator.integrate(prepared.integrationInput)
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(integrated.kind).toBe('integrated')
    if (integrated.kind !== 'integrated') throw new Error('Expected C1 integration')
    expect(await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(integrated.commit)
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('done')
    expect(goalPackage.evidence.has('E-run-review')).toBe(true)
    expect(
      await createCompletionStructureVerifier(fixture.store).verify('goal-1', goalPackage),
    ).toBe(true)
    expect(await git(fixture.projectRoot, ['show', '-s', '--format=%P', integrated.commit])).toBe(
      fixture.releaseBeforeTask,
    )
    expect(
      await git(fixture.projectRoot, ['show', '-s', '--format=%B', integrated.commit]),
    ).toContain('HOPI-Work-Ref: project:project-1/goal:goal-1/work:W-1')
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(beforeUser)

    const repeated = await fixture.integrator.integrate(prepared.integrationInput)
    expect(repeated).toEqual({
      kind: 'already_integrated',
      commit: integrated.commit,
    })
  })

  test('matches qualified Work trailers exactly when one Work ID prefixes another', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-review')
    const integrated = await fixture.integrator.integrate(prepared.integrationInput)
    if (integrated.kind !== 'integrated') throw new Error('Expected C1 integration')
    await Bun.write(join(fixture.projectRoot, 'README.md'), '# Prefix Work\n')
    await git(fixture.projectRoot, ['add', 'README.md'])
    await git(fixture.projectRoot, [
      'commit',
      '-m',
      ['prefix work', '', 'HOPI-Work-Ref: project:project-1/goal:goal-1/work:W-1-extra'].join('\n'),
    ])

    expect(
      await findIntegrationCommits(
        fixture.projectRoot,
        HOPI_RELEASE_REF,
        'project:project-1/goal:goal-1/work:W-1',
      ),
    ).toEqual([integrated.commit])
    expect(
      await createCompletionStructureVerifier(fixture.store).verify(
        'goal-1',
        await fixture.store.readPackage('goal-1'),
      ),
    ).toBe(true)
  })

  test('integrates a task-side deletion when the release left the file unchanged', async () => {
    const fixture = await createFixture()
    await rm(join(fixture.taskWorktreePath, 'README.md'))
    await checkpointTaskWorktree({
      worktreePath: fixture.taskWorktreePath,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-delete',
    })
    const prepared = await fixture.prepareReviewer('run-review-delete')

    const result = await fixture.integrator.integrate(prepared.integrationInput)

    expect(result.kind).toBe('integrated')
    expect(await Bun.file(join(fixture.projectRoot, 'README.md')).exists()).toBe(false)
  })

  test('rejects a pre-boundary source conflict without moving the release ref', async () => {
    const fixture = await createFixture()
    await Bun.write(join(fixture.projectRoot, 'src', 'feature.ts'), 'export const feature = 3\n')
    await git(fixture.projectRoot, ['add', 'src/feature.ts'])
    await git(fixture.projectRoot, ['commit', '-m', 'concurrent integration'])
    const currentTarget = await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])
    const prepared = await fixture.prepareReviewer('run-conflict')

    const result = await fixture.integrator.integrate(prepared.integrationInput)

    expect(result).toMatchObject({ kind: 'rejected' })
    expect(await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(currentTarget)
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'review',
    )
  })

  test('rebuilds C1 on a clean target change after Reviewer staging', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-stale-target')
    await Bun.write(join(fixture.projectRoot, 'README.md'), '# New target\n')
    await git(fixture.projectRoot, ['add', 'README.md'])
    await git(fixture.projectRoot, ['commit', '-m', 'advance release'])
    const currentTarget = await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])

    const result = await fixture.integrator.integrate(prepared.integrationInput)

    expect(result.kind).toBe('integrated')
    if (result.kind !== 'integrated') throw new Error('Expected rebuilt C1 integration')
    expect(await git(fixture.projectRoot, ['show', '-s', '--format=%P', result.commit])).toBe(
      currentTarget,
    )
    expect(await Bun.file(join(fixture.projectRoot, 'README.md')).text()).toBe('# New target\n')
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
  })

  test('rereads an uncertain ref update and completes when the ref is already C1', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-uncertain')

    const result = await fixture.integrator.integrate(prepared.integrationInput, {
      async updateRef({ move }) {
        await move()
        throw new Error('simulated lost update-ref acknowledgement')
      },
    })

    expect(result).toMatchObject({ kind: 'integrated', recoveredUncertainUpdate: true })
  })

  test('never rolls back C1 when materialization fails after the ref boundary', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-post-ref')

    const result = await fixture.integrator.integrate(prepared.integrationInput, {
      beforeMaterialization() {
        throw new Error('simulated materialization stop')
      },
    })

    expect(result.kind).toBe('blocked_after_boundary')
    if (result.kind !== 'blocked_after_boundary') throw new Error('Expected blocked C1')
    expect(await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(result.commit)
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'review',
    )
  })

  test('never changes a dirty selected checkout', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-dirty-delivery')
    await Bun.write(join(fixture.repoRoot, 'local.txt'), 'local work\n')
    const before = await checkoutSnapshot(fixture.repoRoot)

    const integrated = await fixture.integrator.integrate(prepared.integrationInput)

    expect(integrated.kind).toBe('integrated')
    if (integrated.kind !== 'integrated') throw new Error('Expected integrated C1')
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(before)
    expect(await git(fixture.projectRoot, ['rev-parse', HOPI_RELEASE_REF])).toBe(integrated.commit)
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )

    const recovered = await fixture.integrator.integrate(prepared.integrationInput)

    expect(recovered).toEqual({
      kind: 'already_integrated',
      commit: integrated.commit,
    })
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(before)
  })

  test('never changes detached selected checkout index or working-tree bytes', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.prepareReviewer('run-switched-delivery')
    await git(fixture.repoRoot, ['switch', '--detach'])
    await Bun.write(join(fixture.repoRoot, 'README.md'), '# Staged locally\n')
    await git(fixture.repoRoot, ['add', 'README.md'])
    await Bun.write(join(fixture.repoRoot, 'README.md'), '# Working tree locally\n')
    const localBytes = Uint8Array.from([0, 255, 1, 254, 2])
    await Bun.write(join(fixture.repoRoot, 'local.bin'), localBytes)
    const before = await checkoutSnapshot(fixture.repoRoot)
    const stagedBefore = await git(fixture.repoRoot, ['show', ':README.md'])
    const workingBefore = new Uint8Array(
      await Bun.file(join(fixture.repoRoot, 'README.md')).arrayBuffer(),
    )

    const result = await fixture.integrator.integrate(prepared.integrationInput)

    expect(result.kind).toBe('integrated')
    if (result.kind !== 'integrated') throw new Error('Expected integrated C1')
    expect(await checkoutSnapshot(fixture.repoRoot)).toEqual(before)
    expect(await git(fixture.repoRoot, ['show', ':README.md'])).toBe(stagedBefore)
    expect(
      new Uint8Array(await Bun.file(join(fixture.repoRoot, 'README.md')).arrayBuffer()),
    ).toEqual(workingBefore)
    expect(
      new Uint8Array(await Bun.file(join(fixture.repoRoot, 'local.bin')).arrayBuffer()),
    ).toEqual(localBytes)
  })
})

async function createFixture() {
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
  await store.createGoal({ goalId: 'goal-1', title: 'Goal', objective: 'Ship feature 2.' })
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
            title: 'Build feature 2',
            kind: 'engineering',
            stage: 'review',
            notBefore: null,
            dependsOn: [],
            contractRevision: 1,
            evidenceRefs: [],
            attempts: 0,
          },
          body: '## Acceptance Criteria\n\n- feature equals 2.\n',
        }),
      },
    ],
    gateWrite: {
      path: planningPath,
      expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
      content: renderWorkDocument(planning),
    },
  })

  const releaseBeforeTask = await git(linked.integrationRoot, ['rev-parse', HOPI_RELEASE_REF])
  const stable = await createStableWorktreeManager(homeRoot).prepare({
    projectRoot: linked.integrationRoot,
    projectId: 'project-1',
    goalId: 'goal-1',
    workId: 'W-1',
  })
  await Bun.write(join(stable.path, 'src', 'feature.ts'), 'export const feature = 2\n')
  await checkpointTaskWorktree({
    worktreePath: stable.path,
    projectId: 'project-1',
    goalId: 'goal-1',
    workId: 'W-1',
    runId: 'run-generator',
  })

  const stager = createRoleContextStager(homeRoot, publisher)
  const outcomes = createPassOutcomeCoordinator(store, publisher, {
    now: () => new Date('2026-07-11T00:00:00Z'),
  })
  const integrator = createC1Integrator(
    homeRoot,
    store,
    publisher,
    () => new Date('2026-07-11T00:00:00Z'),
    {
      projectId: linked.projectId,
      primaryRepoId: linked.primaryRepoId,
      repos: linked.repos.map((repo) => ({
        repoId: repo.repoId,
        integrationRoot: repo.integrationRoot,
        projectPath: repo.projectPath,
        primary: repo.primary,
      })),
    },
  )

  return {
    repoRoot,
    projectRoot: linked.integrationRoot,
    taskWorktreePath: stable.path,
    store,
    releaseBeforeTask,
    integrator,
    async prepareReviewer(runId: string) {
      const context = await stager.prepare({
        projectRoot: linked.integrationRoot,
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'W-1',
        runId,
        responsibility: 'reviewer',
      })
      const pass = {
        goalId: 'goal-1',
        workId: 'W-1',
        runId,
        responsibility: 'reviewer' as const,
        context,
        outcome: {
          result: 'success' as const,
          summary: 'Reviewer verified feature 2.',
          artifacts: [],
          exitCode: 0,
        },
      }
      const application = await outcomes.apply(pass)
      if (application.kind !== 'integration_required') {
        throw new Error(`Expected integration_required, got ${application.kind}`)
      }
      return {
        context,
        integrationInput: {
          pass,
          taskWorktreePath: stable.path,
          evidence: application.evidence,
          completedWork: application.work,
        },
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
