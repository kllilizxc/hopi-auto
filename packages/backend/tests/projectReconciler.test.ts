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
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import type { ProjectPreparer } from '../src/runtime/projectPreparation'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
import {
  type StableWorktreeManager,
  StableWorktreeSyncError,
} from '../src/runtime/stableWorktreeManager'
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
    for (let cycle = 0; cycle < 5; cycle += 1) {
      results.push(await fixture.reconciler.reconcileGoal('goal-1'))
    }
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(results.map((result) => result.kind)).toEqual([
      'pass_finished',
      'pass_finished',
      'pass_finished',
      'planning_ensured',
      'pass_finished',
    ])
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer', 'planner'])
    expect(fixture.runner.plannerCwds).toEqual(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'planner')
        .map((run) => run.path),
    )
    expect(fixture.runner.reviewerCwds).toEqual(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => run.path),
    )
    expect(fixture.runner.plannerCwds).not.toEqual(fixture.runner.plannerRunRoots)
    expect(fixture.runner.reviewerCwds).not.toEqual(fixture.runner.reviewerRunRoots)
    expect(fixture.runner.generatorCwds[0]).toBe(
      fixture.runner.repoRootsByRun.find((run) => run.responsibility === 'generator')?.paths[0],
    )
    expect(goalPackage.goal.attributes.lifecycle).toBe('done')
    expect(goalPackage.goal.attributes.completionAttentionId).toBeNull()
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('done')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('1')
    const workAttempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    const generatorAttempt = workAttempts.find((attempt) => attempt.responsibility === 'generator')
    expect(workAttempts).toHaveLength(2)
    expect(generatorAttempt).toMatchObject({
      status: 'finished',
      result: 'success',
      execution: { transport: 'codex', model: 'gpt-test', reasoningEffort: 'xhigh' },
    })
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

  test('runs direct initial Engineering through the unchanged delivery and final Planning profile', async () => {
    const fixture = await createFixture({ directInitialWork: true })

    const results = []
    for (let cycle = 0; cycle < 4; cycle += 1) {
      results.push(await fixture.reconciler.reconcileGoal('goal-1'))
    }
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(results.map((result) => result.kind)).toEqual([
      'pass_finished',
      'pass_finished',
      'planning_ensured',
      'pass_finished',
    ])
    expect(fixture.runner.responsibilities).toEqual(['generator', 'reviewer', 'planner'])
    expect(goalPackage.goal.attributes.lifecycle).toBe('done')
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'done',
      assistantDispatch: 'home:H-1/event:EV-1',
    })
  })

  test('runs one Engineering Work across two Repos and publishes one primary C1', async () => {
    const releases: Array<{ projectId: string; commit: string }> = []
    const fixture = await createFixture({
      includeSecondaryRepo: true,
      changedRepoIds: ['primary', 'api'],
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
    })
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(api.integrationRoot, 'src', 'feature.ts')).text()).toContain('2')
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('1')
    expect(await Bun.file(join(fixture.apiRepoRoot, 'src', 'feature.ts')).text()).toContain('1')
    expect(releases).toEqual([{ projectId: 'project-1', commit: expect.any(String) }])
  })

  test('exposes every Repo without making a missing prepare adapter an Engineering gate', async () => {
    const fixture = await createFixture({
      includeSecondaryRepo: true,
    })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    if (!fixture.apiRepoRoot) throw new Error('Expected api Repo fixture')
    const api = fixture.linked.repos.find((repo) => repo.repoId === 'api')
    if (!api) throw new Error('Expected linked api Repo')
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer'])
    expect(fixture.runner.repoRootsByRun).toEqual([
      expect.objectContaining({ responsibility: 'planner', paths: expect.any(Array) }),
      expect.objectContaining({ responsibility: 'generator', paths: expect.any(Array) }),
      expect.objectContaining({ responsibility: 'reviewer', paths: expect.any(Array) }),
    ])
    expect(fixture.runner.repoRootsByRun.every((run) => run.paths.length === 2)).toBe(true)
    expect(await Bun.file(join(api.integrationRoot, 'scripts', 'hopi', 'prepare')).exists()).toBe(
      false,
    )
    expect(await Bun.file(join(fixture.apiRepoRoot, 'scripts', 'hopi', 'prepare')).exists()).toBe(
      false,
    )
    expect(await Bun.file(join(api.integrationRoot, 'src', 'feature.ts')).text()).toContain('1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    expect(attempts.map((attempt) => attempt.application)).not.toContain(
      'candidate_preparation_failed',
    )
  })

  test('reuses separate Generator and Reviewer sessions across a rejection loop', async () => {
    const fixture = await createFixture({ reviewerRejectOnce: true })

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    expect(fixture.runner.responsibilities).toEqual([
      'planner',
      'generator',
      'reviewer',
      'generator',
      'reviewer',
    ])
    expect(
      fixture.runner.sessionsByRun
        .filter((run) => run.responsibility === 'generator')
        .map((run) => run.sessionId),
    ).toEqual([null, 'session-W-1-generator'])
    expect(
      fixture.runner.refreshAssignmentsByRun
        .filter((run) => run.responsibility === 'generator')
        .map((run) => run.refreshAssignment),
    ).toEqual([false, false])
    expect(
      fixture.runner.sessionsByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => run.sessionId),
    ).toEqual([null, 'session-W-1-reviewer'])
    expect(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'generator')
        .map((run) => ({ path: run.path, markerFound: run.markerFound })),
    ).toEqual([
      {
        path: expect.stringContaining('/generator/assignment-'),
        markerFound: false,
      },
      {
        path: expect.stringContaining('/generator/assignment-'),
        markerFound: true,
      },
    ])
    expect(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => ({ path: run.path, markerFound: run.markerFound })),
    ).toEqual([
      {
        path: expect.stringContaining('/reviewer/assignment-'),
        markerFound: false,
      },
      {
        path: expect.stringContaining('/reviewer/assignment-'),
        markerFound: true,
      },
    ])
    expect(fixture.runner.sessionWorkspacesByRun[1]?.path).toBe(
      fixture.runner.sessionWorkspacesByRun[3]?.path,
    )
    expect(fixture.runner.sessionWorkspacesByRun[2]?.path).toBe(
      fixture.runner.sessionWorkspacesByRun[4]?.path,
    )
    expect(new Set(fixture.runner.generatorCwds).size).toBe(1)
    expect(fixture.runner.reviewerCwds).toEqual(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => run.path),
    )
    expect(new Set(fixture.runner.reviewerCwds).size).toBe(1)
    expect(new Set(fixture.runner.reviewerRunRoots).size).toBe(2)
    expect(
      await Bun.file(
        join(fixture.runner.sessionWorkspacesByRun[1]?.path ?? '', 'continuity.txt'),
      ).exists(),
    ).toBe(false)
    const generatorAttempts = (await fixture.attempts.list('project-1', 'goal-1', 'W-1')).filter(
      (attempt) => attempt.responsibility === 'generator',
    )
    const repairPrompt = await fixture.attempts.readMetadata(
      'project-1',
      'goal-1',
      'W-1',
      generatorAttempts[0]?.runId ?? '',
    )
    expect(repairPrompt?.runPrompt).toContain(
      '### Current Repair View (Diagnostics, Not Authority)',
    )
    expect(repairPrompt?.runPrompt).not.toContain('Previous claimed summary')
    expect(repairPrompt?.runPrompt).not.toContain('Observed execution commands')
  })

  test('settles Planner semantic failure without inventing Attention or redispatching', async () => {
    const fixture = await createFixture({ plannerResult: 'fail' })

    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const planning = goalPackage.works.get('plan-initial')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'plan-initial')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect(planning?.attributes).toMatchObject({ stage: 'plan' })
    expect(goalPackage.attentions.size).toBe(0)
    expect(attempts[0]).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'published',
    })
    expect(typeof attempts[0]?.workHash).toBe('string')

    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(fixture.runner.responsibilities).toEqual(['planner'])
  })

  test('settles an unmaterialized attention label without inventing Attention or redispatching', async () => {
    const fixture = await createFixture({ generatorResult: 'attention' })

    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'attention',
      application: 'published',
    })
    expect(goalPackage.attentions.size).toBe(0)
    expect(attempts[0]).toMatchObject({
      status: 'finished',
      result: 'attention',
      application: 'published',
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator'])
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
      '1',
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

  test('checkpoints partial Generator source and settles semantic failure as Attempt history', async () => {
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
    const goalPackage = await fixture.store.readPackage('goal-1')
    const work = goalPackage.works.get('W-1')
    const recoveryPlanning = [...goalPackage.works.values()].find(
      (candidate) =>
        candidate.attributes.kind === 'planning' && candidate.attributes.stage === 'plan',
    )
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect(work?.attributes).toMatchObject({ stage: 'generate' })
    expect(recoveryPlanning).toBeUndefined()
    expect(goalPackage.attentions.size).toBe(0)
    expect(attempts[0]).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'published',
    })
    expect(typeof attempts[0]?.workHash).toBe('string')
    expect(await git(taskWorktreePath, ['status', '--porcelain'])).toBe('')
    expect(await git(taskWorktreePath, ['log', '-1', '--format=%s'])).toContain('hopi: checkpoint')
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
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
      evidenceRefs: [],
    })
  })

  test('contains Coordinator checkpoint infrastructure failure in Attempt history', async () => {
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

    expect(result).toMatchObject({
      kind: 'pass_finished',
      application: 'operational_failure',
    })
    expect(blocked).toEqual([])
    expect(work?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: [],
    })
    expect(attempts.at(-1)).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'operational_failure',
    })
    expect(typeof attempts.at(-1)?.workHash).toBe('string')
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
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

  test('dispatches Generator and Reviewer when the Project has no prepare adapter', async () => {
    const fixture = await createFixture()

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
    expect(await Bun.file(join(fixture.projectRoot, 'scripts', 'hopi', 'prepare')).exists()).toBe(
      false,
    )
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer'])
    expect(attempts.map((attempt) => attempt.application)).not.toContain(
      'candidate_preparation_failed',
    )
  })

  test('attaches a failed Project preparation to the Run without blocking responsibility passes', async () => {
    const fixture = await createFixture({
      prepareScript: [
        '#!/usr/bin/env bun',
        'const manifest = await Bun.file(process.env.HOPI_REPOS_FILE).json()',
        'console.log(`repos=${manifest.repoOrder.join(",")}`)',
        'process.exit(7)',
        '',
      ].join('\n'),
    })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    expect(fixture.runner.responsibilities).toEqual(['planner', 'generator', 'reviewer'])
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
    for (const attempt of attempts) {
      const runRoot = join(fixture.homeRoot, '.hopi', 'runtime', 'runs', attempt.runId)
      expect(await Bun.file(join(runRoot, 'project-prepare', 'result.json')).json()).toMatchObject({
        kind: 'failed',
        exitCode: 7,
      })
      expect(await Bun.file(join(runRoot, 'project-prepare', 'prepare.log')).text()).toContain(
        'repos=primary',
      )
      expect(await Bun.file(join(runRoot, 'prompt.md')).text()).toContain('## Project Preparation')
      expect(await Bun.file(join(runRoot, 'prompt.md')).text()).toContain('- Status: failed')
    }
  })

  test('settles a task branch synchronization conflict as an operational Attempt', async () => {
    const syncFailure = async () => {
      throw new StableWorktreeSyncError('task delta conflicts with the current release')
    }
    const worktrees: StableWorktreeManager = {
      prepare: syncFailure,
      prepareClean: syncFailure,
      inspect: async () => null,
    }
    const fixture = await createFixture({ worktrees })

    await fixture.reconciler.reconcileGoal('goal-1')
    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'operational_failure',
    })
    expect(fixture.runner.responsibilities).toEqual(['planner'])
    expect(goalPackage.attentions.size).toBe(0)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      status: 'finished',
      result: 'fail',
      application: 'operational_failure',
      summary: expect.stringContaining('task delta conflicts with the current release'),
      workHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: [],
    })

    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')).toEqual({
      runId: 'run-3',
      disposition: 'scheduled',
    })
    const retryResult = await fixture.reconciler.reconcileGoal('goal-1')

    expect(retryResult).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'operational_failure',
    })
    expect(await fixture.attempts.list('project-1', 'goal-1', 'W-1')).toHaveLength(2)
  })

  test('explicit retry reserves one Run without inventing or mutating Attention', async () => {
    const fixture = await createFixture({ directInitialWork: true, generatorResult: 'fail' })
    const first = await fixture.reconciler.reconcileGoal('goal-1')
    expect(first).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })

    expect(await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')).toEqual({
      runId: 'run-2',
      disposition: 'scheduled',
    })
    expect(await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')).toEqual({
      runId: 'run-2',
      disposition: 'already_scheduled',
    })
    const retried = await fixture.reconciler.reconcileGoal('goal-1')
    expect(retried).toMatchObject({
      kind: 'pass_finished',
      result: 'fail',
      application: 'published',
    })
    expect((await fixture.store.readPackage('goal-1')).attentions.size).toBe(0)
    expect(fixture.runner.responsibilities).toEqual(['generator', 'generator'])
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
  })

  test('returns the active Attempt when retry arrives during Project preparation', async () => {
    let markPreparationStarted: () => void = () => undefined
    const preparationStarted = new Promise<void>((resolve) => {
      markPreparationStarted = resolve
    })
    let releasePreparation: () => void = () => undefined
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const preparer: ProjectPreparer = {
      async prepare(input) {
        markPreparationStarted()
        await preparationGate
        return {
          kind: 'ready',
          adapterPath: join(input.projectRoot, 'scripts', 'hopi', 'prepare'),
          exitCode: 0,
          startedAt: '2026-07-11T00:00:00.000Z',
          endedAt: '2026-07-11T00:00:01.000Z',
          durationMs: 1_000,
          logs: 'prepared',
          logPath: join(input.runtimeDir, 'prepare.log'),
          reposFile: join(input.runtimeDir, 'repos.json'),
        }
      },
    }
    const fixture = await createFixture({ directInitialWork: true, preparer })

    const generator = fixture.reconciler.reconcileGoal('goal-1')
    await preparationStarted
    expect(await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')).toEqual({
      runId: 'run-1',
      disposition: 'already_active',
    })
    expect(await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')).toEqual({
      runId: 'run-1',
      disposition: 'already_active',
    })
    expect(await fixture.attempts.list('project-1', 'goal-1', 'W-1')).toMatchObject([
      { runId: 'run-1', responsibility: 'generator', status: 'running' },
    ])

    releasePreparation()
    expect(await generator).toMatchObject({
      kind: 'pass_finished',
      runId: 'run-1',
      result: 'success',
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      runId: 'run-2',
      result: 'success',
    })
    expect(
      (await fixture.attempts.list('project-1', 'goal-1', 'W-1')).map((attempt) => attempt.runId),
    ).toEqual(['run-2', 'run-1'])
  })

  test('resumes the same responsibility Session after a Project Owner Work message', async () => {
    const fixture = await createFixture({
      directInitialWork: true,
      generatorOperationalFailure: true,
    })
    const first = await fixture.reconciler.reconcileGoal('goal-1')
    const controller = createGoalController(fixture.store, { verifyCompletion: () => false })
    await controller.appendWorkMessage('goal-1', 'W-1', {
      sourceEventId: 'EV-guidance',
      content: 'Use the verified API command from the current design.',
    })
    await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')
    const second = await fixture.reconciler.reconcileGoal('goal-1')

    expect(first).toMatchObject({ kind: 'pass_finished', application: 'operational_failure' })
    expect(second).toMatchObject({ kind: 'pass_finished', application: 'operational_failure' })
    expect(fixture.runner.sessionsByRun).toEqual([
      { responsibility: 'generator', sessionId: null },
      { responsibility: 'generator', sessionId: 'session-W-1-generator' },
    ])
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    expect(attempts).toHaveLength(2)
    expect(attempts[0]?.workHash).toBe(attempts[1]?.workHash)
    expect(
      await Bun.file(
        join(fixture.homeRoot, '.hopi', 'runtime', 'runs', attempts[0]?.runId ?? '', 'prompt.md'),
      ).text(),
    ).toContain('Use the verified API command from the current design.')
  })

  test('keeps runtime process failure out of Work fields and exposes it through Attempt history', async () => {
    const fixture = await createFixture({ generatorOperationalFailure: true })

    await fixture.reconciler.reconcileGoal('goal-1')
    const failed = await fixture.reconciler.reconcileGoal('goal-1')
    const blocked = await fixture.reconciler.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')

    expect(failed).toMatchObject({
      kind: 'pass_finished',
      application: 'operational_failure',
    })
    expect(blocked).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: [],
    })
    expect(attempts[0]).toMatchObject({
      application: 'operational_failure',
    })
    expect(typeof attempts[0]?.workHash).toBe('string')
    expect(goalPackage.attentions.size).toBe(0)
  })

  test('reconstructs a settled runtime failure gate from Attempt logs after restart', async () => {
    const fixture = await createFixture()
    await fixture.reconciler.reconcileGoal('goal-1')
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')
    if (!work) throw new Error('Expected Engineering Work')
    const workHash = await hashBytes(new TextEncoder().encode(renderWorkDocument(work)))
    for (let index = 1; index <= 3; index += 1) {
      const runId = `persisted-${index}`
      const recorder = await fixture.attempts.start({
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'W-1',
        runId,
        responsibility: 'generator',
        runRoot: join(fixture.homeRoot, '.hopi', 'runtime', 'runs', runId),
        workHash,
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
    const settled = await restarted.reconcileGoal('goal-1')
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(settled).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(goalPackage.attentions.size).toBe(0)
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
  })

  test('cleans Reviewer residue and retries Reviewer without a Generator recovery', async () => {
    const fixture = await createFixture({
      reviewerOperationalWriteOnce: true,
    })

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    await fixture.reconciler.requestWorkRun?.('goal-1', 'W-1')
    await fixture.reconciler.reconcileGoal('goal-1')
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
    expect(work?.attributes).toMatchObject({ stage: 'done' })
    expect(await Bun.file(join(worktree, 'test-results', 'output.txt')).exists()).toBe(false)
  })
})

class DeliveryScriptRunner implements RoleRunner {
  readonly responsibilities: string[] = []
  readonly sessionsByRun: Array<{ responsibility: string; sessionId: string | null }> = []
  readonly refreshAssignmentsByRun: Array<{
    responsibility: string
    refreshAssignment: boolean
  }> = []
  readonly sessionWorkspacesByRun: Array<{
    responsibility: string
    path: string
    markerFound: boolean
  }> = []
  readonly plannerCwds: string[] = []
  readonly plannerRunRoots: string[] = []
  readonly generatorCwds: string[] = []
  readonly reviewerCwds: string[] = []
  readonly reviewerRunRoots: string[] = []
  readonly repoRootsByRun: Array<{ responsibility: string; paths: string[] }> = []
  private reviewerRuns = 0
  private reviewerRejections = 0

  constructor(
    private readonly options: {
      generatorResult: 'success' | 'attention' | 'fail'
      generatorOperationalFailure: boolean
      reviewerOperationalWriteOnce: boolean
      reviewerRejectOnce: boolean
      changedRepoIds: readonly string[]
      generatorWaitForAbort: boolean
      plannerWaitForAbort: boolean
      plannerResult: 'success' | 'fail'
    },
  ) {}

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    const artifacts: string[] = []
    this.responsibilities.push(input.responsibility)
    await observer?.onExecution?.({
      transport: 'codex',
      model: 'gpt-test',
      reasoningEffort: 'xhigh',
    })
    this.sessionsByRun.push({
      responsibility: input.responsibility,
      sessionId: input.session?.sessionId ?? null,
    })
    this.refreshAssignmentsByRun.push({
      responsibility: input.responsibility,
      refreshAssignment: input.refreshAssignment ?? false,
    })
    const continuityMarker = join(input.context.runtimeScratchDir, 'continuity.txt')
    const markerFound = await Bun.file(continuityMarker).exists()
    this.sessionWorkspacesByRun.push({
      responsibility: input.responsibility,
      path: input.context.runtimeScratchDir,
      markerFound,
    })
    if (!markerFound) {
      await Bun.write(continuityMarker, `${input.responsibility} continuity\n`)
    }
    await observer?.onSession?.({
      transport: 'codex',
      sessionId: `session-${input.workId}-${input.responsibility}`,
    })
    this.repoRootsByRun.push({
      responsibility: input.responsibility,
      paths: input.context.repoRoots.map((repo) => repo.path),
    })
    if (input.responsibility === 'planner') {
      this.plannerCwds.push(input.cwd)
      this.plannerRunRoots.push(input.context.runRoot)
    }
    if (input.responsibility === 'generator') this.generatorCwds.push(input.cwd)
    if (input.responsibility === 'reviewer') {
      this.reviewerCwds.push(input.cwd)
      this.reviewerRunRoots.push(input.context.runRoot)
    }
    await observer?.onEvent?.({
      kind: 'message',
      level: 'info',
      role: input.responsibility,
      content: `${input.responsibility} is working.`,
    })
    if (input.responsibility === 'planner') {
      if (this.options.plannerWaitForAbort) await waitForAbort(input.signal)
      else if (this.options.plannerResult === 'success') await this.plan(input)
    }
    if (input.responsibility === 'generator') {
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_call',
        summary: 'Tool call: Bash (bun test focused)',
        toolName: 'Bash',
        toolInvocationKey: `verify-${input.runId}`,
      })
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'tool_result',
        summary: 'Focused checks passed.',
        toolName: 'Bash',
        toolInvocationKey: `verify-${input.runId}`,
      })
      for (const repo of input.context.repoRoots) {
        if (!this.options.changedRepoIds.includes(repo.repoId)) continue
        await mkdir(join(repo.path, 'src'), { recursive: true })
        await Bun.write(join(repo.path, 'src', 'feature.ts'), 'export const feature = 2\n')
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
    if (
      input.responsibility === 'reviewer' &&
      this.options.reviewerRejectOnce &&
      this.reviewerRejections++ === 0
    ) {
      return {
        result: 'reject',
        summary: 'Reviewer requested one focused correction.',
        artifacts: [],
        exitCode: 0,
      }
    }
    return {
      result:
        input.responsibility === 'generator'
          ? this.options.generatorResult
          : input.responsibility === 'planner'
            ? this.options.plannerResult
            : 'success',
      summary: `${input.responsibility} completed its fixed responsibility.`,
      artifacts,
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
            notBefore: null,
            dependsOn: [],
            contractRevision: planning.attributes.contractRevision,
            evidenceRefs: [],
          },
          body: '## Acceptance Criteria\n\n- feature equals 2.\n',
        }),
      )
      await Bun.write(join(input.context.proposalRoot, 'AGENTS.md'), '# Test project\n')
    }
  }
}

async function createFixture(
  options: {
    generatorResult?: 'success' | 'attention' | 'fail'
    changedRepoIds?: readonly string[]
    generatorOperationalFailure?: boolean
    generatorWaitForAbort?: boolean
    plannerWaitForAbort?: boolean
    plannerResult?: 'success' | 'fail'
    reviewerOperationalWriteOnce?: boolean
    reviewerRejectOnce?: boolean
    includeSecondaryRepo?: boolean
    projectPath?: string
    worktrees?: StableWorktreeManager
    checkpointTask?: Parameters<typeof createProjectReconciler>[0]['checkpointTask']
    onProjectBlocked?: Parameters<typeof createProjectReconciler>[0]['onProjectBlocked']
    onReleaseUpdated?: Parameters<typeof createProjectReconciler>[0]['onReleaseUpdated']
    directInitialWork?: boolean
    prepareScript?: string
    preparer?: ProjectPreparer
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
  if (options.prepareScript) {
    const preparePath = join(projectSourceRoot, 'scripts', 'hopi', 'prepare')
    await mkdir(dirname(preparePath), { recursive: true })
    await Bun.write(preparePath, options.prepareScript)
    await chmod(preparePath, 0o755)
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
    ...(options.directInitialWork
      ? {
          acceptedInput: {
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-1',
              sourceDigest: 'a'.repeat(64),
              attachments: [],
            },
            body: 'Set feature to 2.\n',
          },
          initialEngineeringWork: {
            id: 'W-1',
            title: 'Build feature 2',
            objective: 'Set feature to 2.',
            acceptanceCriteria: ['feature equals 2.'],
            assistantDispatch: 'home:H-1/event:EV-1' as const,
          },
        }
      : {}),
  })
  const runner = new DeliveryScriptRunner({
    generatorResult: options.generatorResult ?? 'success',
    generatorOperationalFailure: options.generatorOperationalFailure ?? false,
    reviewerOperationalWriteOnce: options.reviewerOperationalWriteOnce ?? false,
    reviewerRejectOnce: options.reviewerRejectOnce ?? false,
    changedRepoIds: options.changedRepoIds ?? ['primary'],
    generatorWaitForAbort: options.generatorWaitForAbort ?? false,
    plannerWaitForAbort: options.plannerWaitForAbort ?? false,
    plannerResult: options.plannerResult ?? 'success',
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
      preparer: options.preparer,
      worktrees: options.worktrees,
      checkpointTask: options.checkpointTask,
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
