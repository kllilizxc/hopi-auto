import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectReleaseRef } from '../src/domain/project'
import { createDeliveryOperationExecutor } from '../src/runtime/deliveryOperationExecutor'
import { createDeliveryOperationStore } from '../src/runtime/deliveryOperationStore'
import { createRunChangeSetStore } from '../src/runtime/runChangeSet'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('Delivery Operations', () => {
  test('EV-008 integrates a ChangeSet with candidate ancestry and idempotent replay', async () => {
    const fixture = await createFixture()
    await Bun.write(join(fixture.repoRoot, '.hopi', 'goal.md'), 'current goal revision\n')
    await git(fixture.repoRoot, ['add', '.hopi/goal.md'])
    await git(fixture.repoRoot, ['commit', '-m', 'goal document revision'])
    const canonicalHead = await git(fixture.repoRoot, ['rev-parse', 'HEAD'])
    const operation = await fixture.operations.propose({
      id: 'OP-integrate',
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      idempotencyKey: 'accept-CS-R-1',
      requiredForGoal: true,
      intent: { kind: 'baseline_integration', changeSetId: fixture.changeSet.id },
      proposedByEventId: 'EV-propose',
    })

    const first = await fixture.executor.execute(operation.id, 'EV-approve')
    const releaseHead = await git(fixture.repoRoot, ['rev-parse', projectReleaseRef('P-1')])
    expect(first).toMatchObject({
      status: 'succeeded',
      result: {
        kind: 'baseline_integrated',
        changeSetId: fixture.changeSet.id,
        repos: [
          {
            expectedBase: fixture.baseCommit,
            resultCommit: fixture.resultCommit,
            observedCommit: releaseHead,
          },
        ],
      },
    })
    expect(releaseHead).not.toBe(canonicalHead)
    expect(await isAncestor(fixture.repoRoot, canonicalHead, releaseHead)).toBe(true)
    expect(await isAncestor(fixture.repoRoot, fixture.resultCommit, releaseHead)).toBe(true)
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toBe(
      'export const feature = 2\n',
    )
    expect(await Bun.file(join(fixture.repoRoot, '.hopi', 'goal.md')).text()).toBe(
      'current goal revision\n',
    )
    expect(await Bun.file(join(fixture.selectedRepoRoot, 'src', 'feature.ts')).text()).toBe(
      'export const feature = 1\n',
    )

    const restartedOperations = createDeliveryOperationStore(fixture.homeRoot)
    const restartedExecutor = createDeliveryOperationExecutor({
      projectId: 'P-1',
      repos: fixture.repos,
      operations: restartedOperations,
      changeSets: fixture.changeSets,
    })
    const replayed = await restartedExecutor.execute(operation.id, 'EV-approve')
    expect(replayed).toEqual(first)
    expect(await git(fixture.repoRoot, ['rev-parse', projectReleaseRef('P-1')])).toBe(releaseHead)
  })

  test('EV-008 integrates every Repo in one multi-Repo ChangeSet', async () => {
    const fixture = await createFixture({ includeSecondaryRepo: true })
    const operation = await fixture.operations.propose({
      id: 'OP-integrate-multi',
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      idempotencyKey: 'accept-multi-CS-R-1',
      requiredForGoal: true,
      intent: { kind: 'baseline_integration', changeSetId: fixture.changeSet.id },
      proposedByEventId: 'EV-propose',
    })

    const result = await fixture.executor.execute(operation.id, 'EV-approve')

    expect(result.status).toBe('succeeded')
    expect(result.result?.kind).toBe('baseline_integrated')
    if (result.result?.kind !== 'baseline_integrated') {
      throw new Error('Expected baseline integration')
    }
    expect(result.result.repos).toHaveLength(2)
    for (const pair of fixture.repoPairs) {
      const releaseHead = await git(pair.integrationRoot, ['rev-parse', projectReleaseRef('P-1')])
      expect(releaseHead).toBe(pair.resultCommit)
      expect(await isAncestor(pair.integrationRoot, pair.resultCommit, releaseHead)).toBe(true)
      expect(await Bun.file(join(pair.integrationRoot, 'src', 'feature.ts')).text()).toBe(
        'export const feature = 2\n',
      )
      expect(await Bun.file(join(pair.sourceRoot, 'src', 'feature.ts')).text()).toBe(
        'export const feature = 1\n',
      )
    }
  })

  test('EV-008 records a competing source baseline as a durable conflict', async () => {
    const fixture = await createFixture()
    await Bun.write(join(fixture.repoRoot, 'src', 'feature.ts'), 'export const feature = 3\n')
    await git(fixture.repoRoot, ['add', 'src/feature.ts'])
    await git(fixture.repoRoot, ['commit', '-m', 'competing source change'])
    const competingHead = await git(fixture.repoRoot, ['rev-parse', 'HEAD'])
    const operation = await fixture.operations.propose({
      id: 'OP-conflict',
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      idempotencyKey: 'conflict-CS-R-1',
      requiredForGoal: false,
      intent: { kind: 'baseline_integration', changeSetId: fixture.changeSet.id },
      proposedByEventId: 'EV-propose',
    })

    const result = await fixture.executor.execute(operation.id, 'EV-approve')

    expect(result).toMatchObject({
      status: 'failed',
      result: {
        kind: 'baseline_conflict',
        changeSetId: fixture.changeSet.id,
        summary: expect.stringContaining('source baseline changed'),
        repos: [{ observedCommit: competingHead }],
      },
    })
    expect(await fixture.operations.read(operation.id)).toEqual(result)
    expect(await git(fixture.repoRoot, ['rev-parse', projectReleaseRef('P-1')])).toBe(competingHead)
  })

  test('creates a content-addressed archive without making it a global gate', async () => {
    const fixture = await createFixture()
    const operation = await fixture.operations.propose({
      id: 'OP-archive',
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      idempotencyKey: 'archive-CS-R-1',
      requiredForGoal: false,
      intent: {
        kind: 'archive',
        changeSetId: fixture.changeSet.id,
        outputName: 'delivery.zip',
      },
      proposedByEventId: 'EV-propose',
    })

    const result = await fixture.executor.execute(operation.id, 'EV-approve')

    expect(result).toMatchObject({
      status: 'succeeded',
      requiredForGoal: false,
      result: {
        kind: 'archive_created',
        changeSetId: fixture.changeSet.id,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        size: expect.any(Number),
      },
    })
    if (result.result?.kind !== 'archive_created') throw new Error('Expected archive result')
    const listing = await command(['unzip', '-Z1', result.result.path], fixture.root)
    expect(listing).toContain('primary/src/feature.ts')
    expect(listing).not.toContain('.hopi/')
  })
})

async function createFixture(options: { includeSecondaryRepo?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hopi-delivery-operation-'))
  temporaryRoots.push(root)
  const homeRoot = join(root, 'home')
  const repoPairs = [await createRepoPair(root, 'primary', true)]
  if (options.includeSecondaryRepo) repoPairs.push(await createRepoPair(root, 'api', false))
  const primary = repoPairs[0]
  if (!primary) throw new Error('Primary Repo fixture is missing')
  const changeSets = createRunChangeSetStore(homeRoot, {
    now: () => new Date('2026-08-13T00:00:00.000Z'),
  })
  const changeSet = await changeSets.freeze({
    projectId: 'P-1',
    goalId: 'G-1',
    workId: 'W-1',
    runId: 'R-1',
    repos: repoPairs.map((pair) => ({
      repoId: pair.repoId,
      worktreePath: pair.candidateRoot,
      baseCommit: pair.baseCommit,
      resultCommit: pair.resultCommit,
    })),
  })
  if (!changeSet) throw new Error('Expected candidate ChangeSet')
  const operations = createDeliveryOperationStore(homeRoot, {
    now: () => new Date('2026-08-13T01:00:00.000Z'),
  })
  const repos = repoPairs.map((pair) => ({
    repoId: pair.repoId,
    repoPath: pair.sourceRoot,
    projectPath: '.',
    integrationRoot: pair.integrationRoot,
    primary: pair.primary,
  }))
  const executor = createDeliveryOperationExecutor({
    projectId: 'P-1',
    repos,
    operations,
    changeSets,
  })
  return {
    root,
    homeRoot,
    repoRoot: primary.integrationRoot,
    selectedRepoRoot: primary.sourceRoot,
    candidateRoot: primary.candidateRoot,
    baseCommit: primary.baseCommit,
    resultCommit: primary.resultCommit,
    repoPairs,
    repos,
    changeSet,
    changeSets,
    operations,
    executor,
  }
}

async function createRepoPair(root: string, repoId: string, primary: boolean) {
  const sourceRoot = join(root, `source-${repoId}`)
  const integrationRoot = join(root, `integration-${repoId}`)
  const candidateRoot = join(root, `candidate-${repoId}`)
  await mkdir(join(sourceRoot, 'src'), { recursive: true })
  await mkdir(join(sourceRoot, '.hopi'), { recursive: true })
  await Bun.write(join(sourceRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
  await Bun.write(join(sourceRoot, '.hopi', 'goal.md'), 'initial goal\n')
  await git(sourceRoot, ['init', '-b', 'main'])
  await git(sourceRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(sourceRoot, ['config', 'user.name', 'HOPI Test'])
  await git(sourceRoot, ['add', '.'])
  await git(sourceRoot, ['commit', '-m', 'initial'])
  const baseCommit = await git(sourceRoot, ['rev-parse', 'HEAD'])
  await git(sourceRoot, [
    'worktree',
    'add',
    '-b',
    'hopi/project/P-1/release',
    integrationRoot,
    baseCommit,
  ])
  await git(sourceRoot, [
    'worktree',
    'add',
    '-b',
    `candidate-R-1-${repoId}`,
    candidateRoot,
    baseCommit,
  ])
  await Bun.write(join(candidateRoot, 'src', 'feature.ts'), 'export const feature = 2\n')
  await git(candidateRoot, ['add', 'src/feature.ts'])
  await git(candidateRoot, ['commit', '-m', 'candidate change'])
  const resultCommit = await git(candidateRoot, ['rev-parse', 'HEAD'])
  return {
    repoId,
    primary,
    sourceRoot,
    integrationRoot,
    candidateRoot,
    baseCommit,
    resultCommit,
  }
}

async function git(cwd: string, args: string[]) {
  return command(['git', '-c', 'core.autocrlf=false', ...args], cwd)
}

async function command(cmd: string[], cwd: string) {
  const child = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(`${cmd.join(' ')} failed: ${stderr.trim()}`)
  return stdout.trim()
}

async function isAncestor(cwd: string, ancestor: string, descendant: string) {
  const child = Bun.spawn(['git', 'merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return (await child.exited) === 0
}
