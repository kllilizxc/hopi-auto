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
    expect(fixture.runner.plannerCwds).toEqual(fixture.runner.plannerRunRoots)
    expect(goalPackage.goal.attributes.lifecycle).toBe('done')
    expect(goalPackage.goal.attributes.completionAttentionId).not.toBeNull()
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('done')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('2')
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
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.apiRepoRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
  })

  test('keeps a Git subdirectory Project inside its selected source scope', async () => {
    const projectPath = 'apps/new-product'
    const fixture = await createFixture({ projectPath })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    const managedScope = join(fixture.projectRoot, ...projectPath.split('/'))
    const generatorRun = fixture.runner.repoRootsByRun.find(
      (run) => run.responsibility === 'generator',
    )
    expect(fixture.linked.projectPath).toBe(projectPath)
    expect(fixture.runner.repoRootsByRun[0]).toEqual({
      responsibility: 'planner',
      paths: [managedScope],
    })
    expect(generatorRun?.paths[0]).toBe(
      join(dirname(fixture.projectRoot), 'work', 'goal-1', 'W-1', projectPath),
    )
    expect(await Bun.file(join(managedScope, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).exists()).toBe(false)
    expect(await Bun.file(join(managedScope, 'AGENTS.md')).exists()).toBe(true)
    expect(await Bun.file(join(fixture.projectRoot, 'AGENTS.md')).exists()).toBe(false)
    expect(await Bun.file(join(fixture.projectSourceRoot, 'src', 'feature.ts')).text()).toContain(
      '2',
    )
  })

  test('rejects a reviewed task commit that escapes its selected Git subdirectory', async () => {
    const projectPath = 'apps/new-product'
    const fixture = await createFixture({ projectPath })
    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')
    const taskRoot = join(dirname(fixture.projectRoot), 'work', 'goal-1', 'W-1')
    await Bun.write(join(taskRoot, 'outside-scope.ts'), 'export const escaped = true\n')
    await checkpointTaskWorktree({
      worktreePath: taskRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'escaped-source',
    })

    const result = await fixture.reconciler.reconcileGoal('goal-1')

    expect(result).toMatchObject({ kind: 'pass_finished', result: 'reject' })
    expect(await Bun.file(join(fixture.projectRoot, 'outside-scope.ts')).exists()).toBe(false)
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'generate',
    )
  })

  test('Pause is a lifecycle guard and dispatches no responsibility pass', async () => {
    const fixture = await createFixture()
    const controller = createGoalController(fixture.store, { verifyCompletion: () => true })
    await controller.pauseGoal('goal-1')

    const result = await fixture.reconciler.reconcileGoal('goal-1')

    expect(result).toMatchObject({ kind: 'wait', decision: { reasons: ['goal_paused'] } })
    expect(fixture.runner.responsibilities).toEqual([])
  })

  test('does not admit a responsibility after a project interrupt during dispatch preparation', async () => {
    const fixture = await createFixture()
    const originalReadPackage = fixture.store.readPackage.bind(fixture.store)
    let releaseReadPackage: () => void = () => undefined
    const readPackageReleased = new Promise<void>((resolve) => {
      releaseReadPackage = resolve
    })
    let markReadPackageStarted: () => void = () => undefined
    const readPackageStarted = new Promise<void>((resolve) => {
      markReadPackageStarted = resolve
    })
    let blockNextRead = true
    fixture.store.readPackage = async (goalId) => {
      if (blockNextRead) {
        blockNextRead = false
        markReadPackageStarted()
        await readPackageReleased
      }
      return originalReadPackage(goalId)
    }

    const running = fixture.reconciler.reconcileGoal('goal-1')
    await readPackageStarted
    fixture.reconciler.interruptRuns()
    releaseReadPackage()

    expect(await running).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    expect(fixture.runner.responsibilities).toEqual([])
    expect(fixture.reconciler.liveWorkIds()).toEqual(new Set())
  })

  test('does not admit an exact Work after its interruption during dispatch preparation', async () => {
    const fixture = await createFixture()
    const planning = [...(await fixture.store.readPackage('goal-1')).works.values()].find(
      (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
    )
    if (!planning) throw new Error('Expected an active Planning Work')
    const originalReadPackage = fixture.store.readPackage.bind(fixture.store)
    let releaseReadPackage: () => void = () => undefined
    const readPackageReleased = new Promise<void>((resolve) => {
      releaseReadPackage = resolve
    })
    let markReadPackageStarted: () => void = () => undefined
    const readPackageStarted = new Promise<void>((resolve) => {
      markReadPackageStarted = resolve
    })
    let blockNextRead = true
    fixture.store.readPackage = async (goalId) => {
      if (blockNextRead) {
        blockNextRead = false
        markReadPackageStarted()
        await readPackageReleased
      }
      return originalReadPackage(goalId)
    }

    const running = fixture.reconciler.reconcileGoal('goal-1')
    await readPackageStarted
    fixture.reconciler.interruptRuns('goal-1', planning.attributes.id)
    releaseReadPackage()

    expect(await running).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    expect(fixture.runner.responsibilities).toEqual([])
    expect(fixture.reconciler.liveWorkIds()).toEqual(new Set())
  })

  test('interrupts one exact Work Run without affecting another live Run', async () => {
    const fixture = await createFixture({ plannerWaitForAbort: true })
    await fixture.store.createGoal({
      goalId: 'goal-2',
      title: 'Ship another feature',
      objective: 'Plan an independent delivery.',
    })
    const planningWorkId = async (goalId: string) => {
      const workId = [...(await fixture.store.readPackage(goalId)).works.values()].find(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      )?.attributes.id
      if (!workId) throw new Error(`Expected an active Planning Work for ${goalId}`)
      return workId
    }
    const firstWorkId = await planningWorkId('goal-1')
    const secondWorkId = await planningWorkId('goal-2')
    const first = fixture.reconciler.reconcileGoal('goal-1')
    const second = fixture.reconciler.reconcileGoal('goal-2')
    await waitUntil(async () => fixture.runner.responsibilities.length === 2)

    fixture.reconciler.interruptRuns('goal-1', firstWorkId)
    expect(await first).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    expect(fixture.reconciler.liveWorkIds()).toContain(`goal-2/${secondWorkId}`)

    fixture.reconciler.interruptRuns('goal-2', secondWorkId)
    expect(await second).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    const firstAttempt = (await fixture.attempts.list('project-1', 'goal-1', firstWorkId)).at(-1)
    const secondAttempt = (await fixture.attempts.list('project-1', 'goal-2', secondWorkId)).at(-1)
    expect(firstAttempt?.status).toBe('interrupted')
    expect(secondAttempt?.status).toBe('interrupted')
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

  test('checkpoints partial Generator source before completing an interruption', async () => {
    let taskWorktreePath = ''
    const fixture = await createFixture({
      generatorWaitForAbort: true,
      checkpointTask: async (input) => {
        taskWorktreePath = input.worktreePath
        return checkpointTaskWorktree(input)
      },
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const running = fixture.reconciler.reconcileGoal('goal-1')
    const expectedWorktree = join(dirname(fixture.projectRoot), 'work', 'goal-1', 'W-1')
    await waitUntil(async () =>
      (
        await Bun.file(join(expectedWorktree, 'src', 'feature.ts'))
          .text()
          .catch(() => '')
      ).includes('2'),
    )

    fixture.reconciler.interruptRuns('goal-1')
    const result = await running
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    const attempt = attempts.at(-1)

    expect(result).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    expect(taskWorktreePath).toBe(expectedWorktree)
    expect(await git(taskWorktreePath, ['status', '--porcelain'])).toBe('')
    expect(await git(taskWorktreePath, ['log', '-1', '--format=%s'])).toContain('hopi: checkpoint')
    expect(attempt).toMatchObject({ status: 'interrupted', result: null, application: null })
    expect(
      (await fixture.attempts.read('project-1', 'goal-1', 'W-1', attempt?.runId ?? ''))?.events,
    ).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'coordinator',
        content: 'Checkpointed safe partial Generator source before interruption.',
      }),
    )
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 0,
      evidenceRefs: [],
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

  test('reconstructs operational exhaustion from Attempt logs after restart', async () => {
    const fixture = await createFixture({ operationalRetryBaseMs: 0 })
    await fixture.reconciler.reconcileGoal('goal-1')
    for (let index = 1; index <= 3; index += 1) {
      const runId = `persisted-${index}`
      const recorder = await fixture.attempts.start({
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'W-1',
        runId,
        responsibility: 'generator',
        runRoot: join(
          fixture.homeRoot,
          '.hopi',
          'runtime',
          'runs',
          'project-1',
          'goal-1',
          'W-1',
          runId,
        ),
      })
      await recorder.finish({
        outcome: {
          result: 'fail',
          summary: `Runtime launch failed ${index}.`,
          exitCode: 1,
        },
        application: 'operational_failure',
      })
    }

    const restarted = fixture.createReconciler()
    const exhausted = await restarted.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attention = [...goalPackage.attentions.values()].find(
      (candidate) => candidate.attributes.target === 'project:project-1/goal:goal-1/work:W-1',
    )

    expect(exhausted).toMatchObject({ kind: 'attention_ensured' })
    expect(attention?.attributes.id).toStartWith('A-')
    expect(attention?.attributes.id).not.toContain('operational')
    expect(attention?.body).toContain('3 consecutive operational failures')
    expect(attention?.body).toContain('Runtime launch failed 3.')
    expect(goalPackage.works.get('W-1')?.attributes.attempts).toBe(0)
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['attention']) },
    })
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
  readonly plannerCwds: string[] = []
  readonly plannerRunRoots: string[] = []
  readonly repoRootsByRun: Array<{ responsibility: string; paths: string[] }> = []
  private reviewerRuns = 0

  constructor(
    private readonly options: {
      generatorResult: 'success' | 'fail'
      generatorOperationalFailure: boolean
      reviewerOperationalWriteOnce: boolean
      generatorCreatesPrepare: boolean
      generatorWaitForAbort: boolean
      plannerWaitForAbort: boolean
      workRepos: readonly string[]
    },
  ) {}

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    this.responsibilities.push(input.responsibility)
    this.repoRootsByRun.push({
      responsibility: input.responsibility,
      paths: input.context.repoRoots.map((repo) => repo.path),
    })
    if (input.responsibility === 'planner') {
      this.plannerCwds.push(input.cwd)
      this.plannerRunRoots.push(input.context.runRoot)
    }
    await observer?.onEvent?.({
      kind: 'message',
      level: 'info',
      role: input.responsibility,
      content: `${input.responsibility} is working.`,
    })
    if (input.responsibility === 'planner') {
      if (this.options.plannerWaitForAbort) await waitForAbort(input.signal)
      else await this.plan(input)
    }
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
      if (this.options.generatorWaitForAbort) {
        await waitForAbort(input.signal)
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
  }
}

async function createFixture(
  options: {
    generatorResult?: 'success' | 'fail'
    includePrepare?: boolean
    generatorCreatesPrepare?: boolean
    generatorOperationalFailure?: boolean
    generatorWaitForAbort?: boolean
    plannerWaitForAbort?: boolean
    reviewerOperationalWriteOnce?: boolean
    includeSecondaryRepo?: boolean
    projectPath?: string
    operationalRetryBaseMs?: number
    checkpointTask?: Parameters<typeof createProjectReconciler>[0]['checkpointTask']
    onProjectBlocked?: Parameters<typeof createProjectReconciler>[0]['onProjectBlocked']
    onReleaseUpdated?: Parameters<typeof createProjectReconciler>[0]['onReleaseUpdated']
  } = {},
) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-project-reconciler-'))
  temporaryRoots.push(temporaryRoot)
  const repoRoot = join(temporaryRoot, 'repo')
  const projectSourceRoot = options.projectPath
    ? join(repoRoot, ...options.projectPath.split('/'))
    : repoRoot
  await mkdir(join(projectSourceRoot, 'src'), { recursive: true })
  await Bun.write(join(projectSourceRoot, 'src', 'feature.ts'), 'export const feature = 1\n')
  if (options.includePrepare !== false) {
    await mkdir(join(projectSourceRoot, 'scripts', 'hopi'), { recursive: true })
    const prepareAdapter = join(projectSourceRoot, 'scripts', 'hopi', 'prepare')
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
    repoPath: projectSourceRoot,
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
  const store = createGoalPackageStore(
    linked.integrationRoot,
    'project-1',
    publisher,
    linked.projectPath,
  )
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Ship feature',
    objective: 'Set feature to 2.',
  })
  const runner = new DeliveryScriptRunner({
    generatorResult: options.generatorResult ?? 'success',
    generatorOperationalFailure: options.generatorOperationalFailure ?? false,
    reviewerOperationalWriteOnce: options.reviewerOperationalWriteOnce ?? false,
    generatorCreatesPrepare: options.generatorCreatesPrepare ?? false,
    generatorWaitForAbort: options.generatorWaitForAbort ?? false,
    plannerWaitForAbort: options.plannerWaitForAbort ?? false,
    workRepos: options.includeSecondaryRepo ? ['primary', 'api'] : ['primary'],
  })
  let runSequence = 0
  const now = () => new Date('2026-07-11T00:00:00Z')
  const attempts = createRunAttemptStore(homeRoot, { now })
  const createReconciler = () =>
    createProjectReconciler({
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
  const reconciler = createReconciler()
  return {
    homeRoot,
    repoRoot,
    projectSourceRoot,
    apiRepoRoot,
    linked,
    projectRoot: linked.integrationRoot,
    store,
    runner,
    reconciler,
    createReconciler,
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

async function waitForAbort(signal?: AbortSignal) {
  if (!signal) throw new Error('Expected a Generator Run signal')
  if (signal.aborted) return
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  )
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for test condition')
}
