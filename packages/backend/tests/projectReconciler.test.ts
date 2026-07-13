import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  RoleRunInput,
  RoleRunObserver,
  RoleRunResult,
  RoleRunner,
} from '../src/agent/RoleRunner'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { TaskCheckpointError, checkpointTaskWorktree } from '../src/runtime/taskCheckpoint'
import { createProjectReconciler } from '../src/scheduler/projectReconciler'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ProjectReconciler', () => {
  test('runs the fixed profile from initial Planning through C1 and final Goal completion', async () => {
    const releases: Array<{ projectId: string; commit: string }> = []
    const fixture = await createFixture({
      onReleaseUpdated: (input) => {
        releases.push(input)
      },
    })

    const results = []
    for (let cycle = 0; cycle < 6; cycle += 1) {
      results.push(await fixture.reconciler.reconcileGoal('goal-1'))
    }
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(results.map((result) => result.kind)).toEqual([
      'pass_finished',
      'pass_finished',
      'pass_finished',
      'planning_ensured',
      'pass_finished',
      'goal_completed',
    ])
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer', 'planner'])
    expect(goalPackage.goal.attributes.lifecycle).toBe('done')
    expect(goalPackage.goal.attributes.completionAttentionId).not.toBeNull()
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('done')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('1')
    const workAttempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    const generatorAttempt = workAttempts.find((attempt) => attempt.responsibility === 'generator')
    expect(workAttempts).toHaveLength(2)
    expect(generatorAttempt).toMatchObject({ status: 'finished', result: 'success' })
    expect(
      (await fixture.attempts.read('project-1', 'goal-1', 'W-1', generatorAttempt?.runId ?? ''))
        ?.events,
    ).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'generator',
        content: 'generator is working.',
      }),
    )
  })

  test('runs one Engineering Work across two Repos and publishes one primary C1', async () => {
    const releases: Array<{ projectId: string; commit: string }> = []
    const fixture = await createFixture({
      includeSecondaryRepo: true,
      onReleaseUpdated: (input) => {
        releases.push(input)
      },
    })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    const api = fixture.linked.repos.find((repo) => repo.repoId === 'api')
    if (!api || !fixture.apiRepoRoot) throw new Error('Expected api Repo fixture')
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer'])
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes).toMatchObject({
      stage: 'done',
      repos: ['primary', 'api'],
    })
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(api.integrationRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('1')
    expect(await Bun.file(join(fixture.apiRepoRoot, 'src', 'feature.ts')).text()).toContain('1')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
  })

  test('Pause is a lifecycle guard and dispatches no responsibility pass', async () => {
    const fixture = await createFixture()
    const controller = createGoalController(fixture.store, { verifyCompletion: () => true })
    await controller.pauseGoal('goal-1')

    const result = await fixture.reconciler.reconcileGoal('goal-1')

    expect(result).toMatchObject({ kind: 'wait', decision: { reasons: ['goal_paused'] } })
    expect(fixture.runner.responsibilities).toEqual([])
  })

  test('checkpoints partial Generator source before applying fail', async () => {
    let taskWorktreePath = ''
    const fixture = await createFixture({
      generatorResult: 'fail',
      checkpointTask: async (input) => {
        taskWorktreePath = input.worktreePath
        return checkpointTaskWorktree(input)
      },
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect(work?.attributes).toMatchObject({ stage: 'generate', attempts: 1 })
    expect(await git(taskWorktreePath, ['status', '--porcelain'])).toBe('')
    expect(await git(taskWorktreePath, ['log', '-1', '--format=%s'])).toContain('hopi: checkpoint')
  })

  test('keeps malformed Generator Attention isolated to a failed Work attempt', async () => {
    const blocked: string[] = []
    const fixture = await createFixture({
      generatorMalformedAttention: true,
      onProjectBlocked: ({ reason }) => {
        blocked.push(reason)
      },
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect(blocked).toEqual([])
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 1,
    })
    expect(goalPackage.attentions.size).toBe(0)
    expect(attempts.at(-1)).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'published',
      summary: expect.stringContaining('Attention document is missing YAML front matter'),
    })
  })

  test('does not consume a Work attempt when Coordinator checkpoint infrastructure fails', async () => {
    const blocked: string[] = []
    const fixture = await createFixture({
      checkpointTask: async () => {
        throw new TaskCheckpointError('git index is unavailable')
      },
      onProjectBlocked: ({ reason }) => {
        blocked.push(reason)
      },
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(result).toMatchObject({ kind: 'project_blocked' })
    expect(blocked).toEqual([expect.stringContaining('git index is unavailable')])
    expect(work?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 0,
      evidenceRefs: [],
    })
    expect(attempts.at(-1)).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'project_blocked',
    })
  })

  test('keeps durable C1 success when release runtime cleanup fails', async () => {
    const fixture = await createFixture({
      onReleaseUpdated: () => {
        throw new Error('preview cleanup failed')
      },
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'success',
      application: 'integrated',
    })
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
  })

  test('bootstraps a missing Project prepare script inside the first real Engineering Work', async () => {
    const fixture = await createFixture({ includePrepare: false, generatorCreatesPrepare: true })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
    expect(await Bun.file(join(fixture.projectRoot, 'scripts', 'hopi', 'prepare')).exists()).toBe(
      true,
    )
  })

  test('skips Reviewer and returns to Generator when Project preparation is missing', async () => {
    const fixture = await createFixture({ includePrepare: false })

    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')

    expect(result).toMatchObject({ kind: 'pass_finished', result: 'reject' })
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator'])
    expect(work?.attributes).toMatchObject({ stage: 'generate', attempts: 1 })
  })

  test('keeps operational process failure out of Work attempts and backs off redispatch', async () => {
    const fixture = await createFixture({
      generatorOperationalFailure: true,
      operationalRetryBaseMs: 60_000,
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const failed = await fixture.reconciler.reconcileGoal('goal-1')
    const deferred = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(failed).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'operational_failure',
    })
    expect(deferred).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['operational_backoff'] },
    })
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 0,
      evidenceRefs: [],
    })
    expect(attempts[0]).toMatchObject({ application: 'operational_failure' })
  })

  test('stops after three persisted operational failures without consuming Work attempts', async () => {
    const fixture = await createFixture({
      generatorOperationalFailure: true,
      operationalRetryBaseMs: 0,
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')
    const exhausted = await fixture.reconciler.reconcileGoal('goal-1')
    const afterExhaustion = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const work = goalPackage.works.get('W-1')
    const attention = [...goalPackage.attentions.values()].find((candidate) =>
      candidate.attributes.id.startsWith('operational-attempts-W-1-3-'),
    )

    expect(exhausted).toMatchObject({ kind: 'attention_ensured' })
    expect(afterExhaustion).toMatchObject({ kind: 'wait' })
    expect(fixture.runner.responsibilities).toEqual([
      'planner',
      'generator',
      'generator',
      'generator',
    ])
    expect(work?.attributes).toMatchObject({ stage: 'generate', attempts: 0 })
    expect(
      await fixture.attempts.countConsecutiveOperationalFailures('project-1', 'goal-1', 'W-1'),
    ).toBe(3)
    expect(attention?.body).toContain('automatic retry stopped')
    expect(attention?.body).toContain("did not consume the Work's 0 published recovery attempts")
  })

  test('cleans Reviewer residue and retries Reviewer without a Generator recovery', async () => {
    const fixture = await createFixture({
      reviewerOperationalWriteOnce: true,
      operationalRetryBaseMs: 0,
    })

    for (let cycle = 0; cycle < 4; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')
    const worktree = join(
      fixture.homeRoot,
      '.hopi',
      'runtime',
      'worktrees',
      'project-1',
      'goal-1',
      'W-1',
    )

    expect(fixture.runner.responsibilities).toEqual([
      'planner',
      'generator',
      'reviewer',
      'reviewer',
    ])
    expect(work?.attributes).toMatchObject({ stage: 'done', attempts: 0 })
    expect(await Bun.file(join(worktree, 'test-results', 'output.txt')).exists()).toBe(false)
  })
})

class DeliveryScriptRunner implements RoleRunner {
  readonly responsibilities: string[] = []
  private reviewerRuns = 0

  constructor(
    private readonly options: {
      generatorResult: 'success' | 'fail'
      generatorOperationalFailure: boolean
      generatorMalformedAttention: boolean
      reviewerOperationalWriteOnce: boolean
      generatorCreatesPrepare: boolean
      workRepos: readonly string[]
    },
  ) {}

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    this.responsibilities.push(input.responsibility)
    await observer?.onEvent?.({
      kind: 'message',
      level: 'info',
      role: input.responsibility,
      content: `${input.responsibility} is working.`,
    })
    if (input.responsibility === 'planner') await this.plan(input)
    if (input.responsibility === 'generator') {
      for (const repo of input.context.repoRoots) {
        await mkdir(join(repo.path, 'src'), { recursive: true })
        await Bun.write(join(repo.path, 'src', 'feature.ts'), 'export const feature = 2\n')
      }
      if (this.options.generatorCreatesPrepare) {
        const adapter = join(input.cwd, 'scripts', 'hopi', 'prepare')
        await mkdir(dirname(adapter), { recursive: true })
        await Bun.write(adapter, '#!/usr/bin/env bun\nconsole.log("ready")\n')
        await chmod(adapter, 0o755)
      }
      if (this.options.generatorOperationalFailure) {
        return {
          result: 'fail',
          summary: 'Provider process exited before returning a valid responsibility result.',
          artifacts: [],
          exitCode: 1,
          failureKind: 'operational',
        }
      }
      if (this.options.generatorMalformedAttention) {
        const attentionPath = join(
          input.context.proposalRoot,
          '.hopi',
          'docs',
          'goals',
          input.goalId,
          'attention',
          'A-malformed.md',
        )
        await mkdir(dirname(attentionPath), { recursive: true })
        await Bun.write(attentionPath, '# Missing frontmatter\n')
        return {
          result: 'attention',
          summary: 'Registry access requires operator action.',
          artifacts: [],
          exitCode: 0,
        }
      }
    }
    if (
      input.responsibility === 'reviewer' &&
      this.options.reviewerOperationalWriteOnce &&
      this.reviewerRuns++ === 0
    ) {
      await mkdir(join(input.cwd, 'test-results'), { recursive: true })
      await Bun.write(join(input.cwd, 'test-results', 'output.txt'), 'review residue\n')
      return {
        result: 'fail',
        summary: 'reviewer modified the task worktree',
        artifacts: [],
        exitCode: 0,
        failureKind: 'operational',
      }
    }
    return {
      result: input.responsibility === 'generator' ? this.options.generatorResult : 'success',
      summary: `${input.responsibility} completed its fixed responsibility.`,
      artifacts: [],
      exitCode: 0,
    }
  }

  private async plan(input: RoleRunInput) {
    const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
    const workRoot = join(goalRoot, 'work')
    const planningPath = join(workRoot, `${input.workId}.md`)
    const authorityWorkRoot = join(
      input.context.contextRoot,
      'authority',
      '.hopi',
      'docs',
      'goals',
      input.goalId,
      'work',
    )
    const planning = parseWorkDocument(
      await Bun.file(join(authorityWorkRoot, `${input.workId}.md`)).text(),
    )
    const workFiles = (await readdir(authorityWorkRoot)).filter((path) => path.endsWith('.md'))
    const engineering = []
    for (const file of workFiles) {
      const work = parseWorkDocument(await Bun.file(join(authorityWorkRoot, file)).text())
      if (work.attributes.kind === 'engineering') engineering.push(work)
    }

    await mkdir(workRoot, { recursive: true })
    if (engineering.length === 0) {
      await Bun.write(
        join(workRoot, 'W-1.md'),
        renderWorkDocument({
          attributes: {
            id: 'W-1',
            title: 'Build feature 2',
            kind: 'engineering',
            stage: 'generate',
            repos: [...this.options.workRepos],
            notBefore: null,
            dependsOn: [],
            contractRevision: planning.attributes.contractRevision,
            evidenceRefs: [],
            attempts: 0,
          },
          body: '## Acceptance Criteria\n\n- feature equals 2.\n',
        }),
      )
      await Bun.write(join(input.context.proposalRoot, 'AGENTS.md'), '# Test project\n')
    } else {
      const attentionPath = join(goalRoot, 'attention', `A-complete-${input.runId}.md`)
      await mkdir(dirname(attentionPath), { recursive: true })
      await Bun.write(
        attentionPath,
        renderAttentionDocument({
          attributes: {
            id: `A-complete-${input.runId}`,
            target: null,
            createdAt: '2026-07-11T00:00:00Z',
            resolvedAt: null,
            notifiedAt: null,
          },
          body: '## Complete\n\nFeature 2 is integrated and verified.\n',
        }),
      )
    }
    planning.attributes.stage = 'done'
    await Bun.write(planningPath, renderWorkDocument(planning))
  }
}

async function createFixture(
  options: {
    generatorResult?: 'success' | 'fail'
    includePrepare?: boolean
    generatorCreatesPrepare?: boolean
    generatorOperationalFailure?: boolean
    generatorMalformedAttention?: boolean
    reviewerOperationalWriteOnce?: boolean
    includeSecondaryRepo?: boolean
    operationalRetryBaseMs?: number
    checkpointTask?: Parameters<typeof createProjectReconciler>[0]['checkpointTask']
    onProjectBlocked?: Parameters<typeof createProjectReconciler>[0]['onProjectBlocked']
    onReleaseUpdated?: Parameters<typeof createProjectReconciler>[0]['onReleaseUpdated']
  } = {},
) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-project-reconciler-'))
  temporaryRoots.push(temporaryRoot)
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
  if (options.includePrepare !== false) {
    await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
    const prepareAdapter = join(repoRoot, 'scripts', 'hopi', 'prepare')
    await Bun.write(prepareAdapter, '#!/usr/bin/env bun\nconsole.log("ready")\n')
    await chmod(prepareAdapter, 0o755)
  }
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'core.autocrlf', 'false'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const homeRoot = join(temporaryRoot, 'home')
  const home = createAssistantHomeStore(homeRoot)
  let linked = await home.linkProject({
    projectId: 'project-1',
    repoPath: repoRoot,
  })
  let apiRepoRoot: string | null = null
  if (options.includeSecondaryRepo) {
    apiRepoRoot = join(temporaryRoot, 'api-repo')
    await mkdir(join(apiRepoRoot, 'src'), { recursive: true })
    await Bun.write(join(apiRepoRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
    await git(apiRepoRoot, ['init', '-b', 'main'])
    await git(apiRepoRoot, ['config', 'core.autocrlf', 'false'])
    await git(apiRepoRoot, ['config', 'user.email', 'hopi@example.test'])
    await git(apiRepoRoot, ['config', 'user.name', 'HOPI Test'])
    await git(apiRepoRoot, ['add', '.'])
    await git(apiRepoRoot, ['commit', '-m', 'initial'])
    linked = await home.linkRepo({
      projectId: 'project-1',
      repoId: 'api',
      repoPath: apiRepoRoot,
    })
  }
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Ship feature',
    objective: 'Set feature to 2.',
  })
  const runner = new DeliveryScriptRunner({
    generatorResult: options.generatorResult ?? 'success',
    generatorOperationalFailure: options.generatorOperationalFailure ?? false,
    generatorMalformedAttention: options.generatorMalformedAttention ?? false,
    reviewerOperationalWriteOnce: options.reviewerOperationalWriteOnce ?? false,
    generatorCreatesPrepare: options.generatorCreatesPrepare ?? false,
    workRepos: options.includeSecondaryRepo ? ['primary', 'api'] : ['primary'],
  })
  let runSequence = 0
  const now = () => new Date('2026-07-11T00:00:00Z')
  const attempts = createRunAttemptStore(homeRoot, { now })
  const reconciler = createProjectReconciler({
    homeRoot,
    projectId: 'project-1',
    projectRoot: linked.integrationRoot,
    primaryRepoId: linked.primaryRepoId,
    projectRepos: linked.repos,
    store,
    publisher,
    roleRunner: runner,
    attempts,
    checkpointTask: options.checkpointTask,
    operationalRetryBaseMs: options.operationalRetryBaseMs,
    onProjectBlocked: options.onProjectBlocked,
    onReleaseUpdated: options.onReleaseUpdated,
    now,
    createRunId: () => `run-${++runSequence}`,
  })
  return {
    homeRoot,
    repoRoot,
    apiRepoRoot,
    linked,
    projectRoot: linked.integrationRoot,
    store,
    runner,
    reconciler,
    attempts,
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
