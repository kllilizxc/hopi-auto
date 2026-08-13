import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  RoleRunInput,
  RoleRunObserver,
  RoleRunResult,
  RoleRunner,
} from '../src/agent/RoleRunner'
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import { createServer } from '../src/mvpServer'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createDeliveryOperationStore } from '../src/runtime/deliveryOperationStore'
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

  test('EV-006 runs explicit profiles independently of Work stage and keeps review optional', async () => {
    const fixture = await createFixture({ directInitialWork: true })
    const inspectDirective = {
      protocol: 'report' as const,
      profile: 'reviewer' as const,
      workspaceMode: 'read_only' as const,
      instructionMarkdown: 'Inspect the current implementation and report remaining risk.',
      refs: ['goal://goal-1/work/W-1'],
      baseChangeSetId: null,
    }

    expect(
      await fixture.reconciler.requestWorkRun('goal-1', 'W-1', {
        directive: inspectDirective,
      }),
    ).toMatchObject({ disposition: 'scheduled' })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      result: 'reported',
      application: 'reported',
    })
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'generate',
    )
    expect(fixture.runner.runContracts[0]).toMatchObject({
      profile: 'reviewer',
      protocol: 'report',
      workspaceMode: 'read_only',
      prompt: expect.stringContaining(inspectDirective.instructionMarkdown),
    })
    const inspectedAttempt = (await fixture.attempts.list('project-1', 'goal-1', 'W-1'))[0]
    expect(inspectedAttempt).toMatchObject({
      profile: 'reviewer',
      protocol: 'report',
      workspaceMode: 'read_only',
      result: null,
      termination: 'normal',
      application: 'reported',
      reportMarkdown: expect.stringContaining('reviewer completed'),
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['awaiting_supervisor'] },
    })

    const implementDirective = {
      protocol: 'report' as const,
      profile: 'generator' as const,
      workspaceMode: 'isolated_write' as const,
      instructionMarkdown: 'Implement the Work in the isolated source projection.',
      refs: [],
      baseChangeSetId: null,
    }
    await fixture.reconciler.requestWorkRun('goal-1', 'W-1', {
      directive: implementDirective,
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      result: 'reported',
      application: 'reported',
    })
    const attempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    expect(attempts).toHaveLength(2)
    const implementationAttempt = attempts.find((attempt) => attempt.profile === 'generator')
    expect(implementationAttempt).toMatchObject({
      profile: 'generator',
      protocol: 'report',
      result: null,
      changeSetId: `CS-${implementationAttempt?.runId}`,
    })
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'generate',
    )
  })

  test('EV-002 checkpoints source and rotates Session Epochs without changing the Run', async () => {
    const checkpointPaths: string[] = []
    const fixture = await createFixture({
      directInitialWork: true,
      generatorEpochRotation: true,
      checkpointTask: async (input) => {
        checkpointPaths.push(input.worktreePath)
        return checkpointTaskWorktree(input)
      },
    })
    await fixture.reconciler.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'generator',
        workspaceMode: 'isolated_write',
        instructionMarkdown: 'Implement the Work across a context boundary.',
        refs: [],
        baseChangeSetId: null,
      },
    })

    const result = await fixture.reconciler.reconcileGoal('goal-1')
    const [attempt] = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    if (!attempt?.changeSetId) throw new Error('Expected a frozen ChangeSet')
    const detail = await fixture.attempts.read('project-1', 'goal-1', 'W-1', attempt.runId)
    const repoChange = detail?.changeSet?.repos[0]
    if (!repoChange) throw new Error('Expected one frozen Repo change')
    const generatorCwd = fixture.runner.generatorCwds[0]
    if (!generatorCwd) throw new Error('Expected one Generator workspace')

    expect(result).toMatchObject({
      kind: 'pass_finished',
      runId: attempt.runId,
      result: 'reported',
      application: 'reported',
    })
    expect(attempt).toMatchObject({
      status: 'finished',
      termination: 'normal',
      sessionEpochs: [
        {
          epoch: 1,
          sessionId: `session-${attempt.runId}-epoch-1`,
          closeReason: 'context_boundary',
          handoffMarkdown: expect.stringContaining(`Run ${attempt.runId}`),
        },
        {
          epoch: 2,
          sessionId: `session-${attempt.runId}-epoch-2`,
          closeReason: 'normal',
          handoffMarkdown: null,
        },
      ],
    })
    expect(checkpointPaths).toHaveLength(2)
    expect(new Set(checkpointPaths)).toEqual(new Set([generatorCwd]))
    expect(
      await git(generatorCwd, [
        'rev-list',
        '--count',
        `${repoChange.baseCommit}..${repoChange.resultCommit}`,
      ]),
    ).toBe('2')
    expect(await Bun.file(join(generatorCwd, 'src', 'epoch-one.ts')).text()).toBe(
      'export const epoch = 1\n',
    )
    expect(detail?.events).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'coordinator',
        content: 'Checkpointed 1 Repo workspace before Session Epoch rotation.',
      }),
    )
  })

  test('EV-007 requires explicit semantic Work and Goal completion decisions', async () => {
    const fixture = await createFixture({ directInitialWork: true })
    await fixture.reconciler.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'generator',
        workspaceMode: 'isolated_write',
        instructionMarkdown: 'Implement the accepted behavior and report the evidence.',
        refs: [],
        baseChangeSetId: null,
      },
    })

    await expect(
      fixture.reconciler.completeWork('goal-1', 'W-1', {
        sourceEventId: 'EV-complete',
        decision: 'The implementation meets the current Work acceptance meaning.',
      }),
    ).rejects.toThrow('active or queued Run')
    await fixture.reconciler.reconcileGoal('goal-1')

    const completedWork = await fixture.reconciler.completeWork('goal-1', 'W-1', {
      sourceEventId: 'EV-complete',
      decision: 'The implementation Report and frozen ChangeSet satisfy this Work.',
    })
    expect(completedWork.attributes).toMatchObject({
      stage: 'done',
      ownerMessages: [
        expect.objectContaining({
          sourceEventId: 'EV-complete',
          content: expect.stringContaining('frozen ChangeSet satisfy this Work'),
        }),
      ],
    })
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toEqual({
      kind: 'wait',
      decision: { kind: 'wait', reasons: ['awaiting_supervisor_completion'] },
    })
    expect((await fixture.store.readPackage('goal-1')).goal.attributes.lifecycle).toBe('active')

    const changeSetId = (await fixture.attempts.list('project-1', 'goal-1', 'W-1'))[0]?.changeSetId
    if (!changeSetId) throw new Error('Expected a frozen ChangeSet')
    await fixture.reconciler.proposeOperation('goal-1', {
      id: 'OP-required-archive',
      workId: 'W-1',
      idempotencyKey: 'required-archive',
      requiredForGoal: true,
      intent: { kind: 'archive', changeSetId, outputName: 'required-delivery.zip' },
      proposedByEventId: 'EV-complete',
    })
    await fixture.reconciler.proposeOperation('goal-1', {
      id: 'OP-optional-integration',
      workId: 'W-1',
      idempotencyKey: 'optional-integration',
      requiredForGoal: false,
      intent: { kind: 'baseline_integration', changeSetId },
      proposedByEventId: 'EV-complete',
    })
    await expect(
      fixture.reconciler.completeGoal('goal-1', {
        decision: 'Current acceptance meaning is satisfied.',
      }),
    ).rejects.toThrow('OP-required-archive')
    expect(
      await fixture.reconciler.executeOperation('goal-1', 'OP-required-archive', 'EV-complete'),
    ).toMatchObject({ status: 'succeeded', result: { kind: 'archive_created' } })

    const completedGoal = await fixture.reconciler.completeGoal('goal-1', {
      decision: 'Current acceptance meaning is satisfied by the observed Report and ChangeSet.',
    })
    expect(completedGoal.attributes.lifecycle).toBe('done')
    expect(completedGoal.body).toContain('## Completion decision')
    expect(completedGoal.body).toContain('Current acceptance meaning is satisfied')
    expect(await fixture.reconciler.listGoalOperations('goal-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'OP-required-archive', status: 'succeeded' }),
        expect.objectContaining({ id: 'OP-optional-integration', status: 'proposed' }),
      ]),
    )
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toEqual({
      kind: 'wait',
      decision: { kind: 'wait', reasons: ['goal_done'] },
    })
  })

  test('EV-012 preserves rejection and repair lineage through restart, Operations, and product APIs', async () => {
    const fixture = await createFixture({
      directInitialWork: true,
      generatorChangesOnRetry: true,
      reviewerRejectCount: 2,
      objective: 'Set feature to 3 with verification evidence.',
      acceptanceCriteria: ['feature equals 3.', 'verification evidence is reviewable.'],
    })
    const attempt = async (runId: string) => {
      const value = (await fixture.attempts.list('project-1', 'goal-1', 'W-1')).find(
        (candidate) => candidate.runId === runId,
      )
      if (!value) throw new Error(`Expected Run ${runId}`)
      return value
    }
    const detail = async (runId: string) => {
      const value = await fixture.attempts.read('project-1', 'goal-1', 'W-1', runId)
      if (!value) throw new Error(`Expected Run detail ${runId}`)
      return value
    }

    const implementation = await fixture.reconciler.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'generator',
        workspaceMode: 'isolated_write',
        instructionMarkdown: 'Implement the first candidate and preserve its source delta.',
        refs: [],
        baseChangeSetId: null,
      },
    })
    let restarted = fixture.createReconciler()
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      runId: implementation.runId,
      result: 'reported',
    })
    const implementationDetail = await detail(implementation.runId)
    const firstChangeSet = implementationDetail.changeSet
    if (!firstChangeSet) throw new Error('Expected the rejected candidate ChangeSet')

    const defectReview = await restarted.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'reviewer',
        workspaceMode: 'read_only',
        instructionMarkdown: 'Independently inspect the first candidate for source defects.',
        refs: [firstChangeSet.id],
        baseChangeSetId: firstChangeSet.id,
      },
    })
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      runId: defectReview.runId,
      result: 'reported',
    })
    expect(await attempt(defectReview.runId)).toMatchObject({
      summary: 'Independent review found a source defect.',
      reportMarkdown: expect.stringContaining('Independent review found a source defect.'),
    })

    const repair = await restarted.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'generator',
        workspaceMode: 'isolated_write',
        instructionMarkdown: 'Repair the source defect and add focused verification evidence.',
        refs: [defectReview.runId, firstChangeSet.id],
        baseChangeSetId: firstChangeSet.id,
      },
    })
    restarted = fixture.createReconciler()
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      runId: repair.runId,
      result: 'reported',
    })
    const repairDetail = await detail(repair.runId)
    const repairedChangeSet = repairDetail.changeSet
    if (!repairedChangeSet) throw new Error('Expected the repair ChangeSet')
    const firstRepoChange = firstChangeSet.repos[0]
    const repairedRepoChange = repairedChangeSet.repos[0]
    if (!firstRepoChange || !repairedRepoChange) {
      throw new Error('Expected primary Repo changes in both ChangeSets')
    }
    expect(repairDetail).toMatchObject({
      baseChangeSetId: firstChangeSet.id,
      sessionEpochs: [{ sessionId: `session-${repair.runId}-generator` }],
    })
    expect(repairedRepoChange.baseCommit).toBe(firstRepoChange.resultCommit)

    const evidenceReview = await restarted.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'reviewer',
        workspaceMode: 'read_only',
        instructionMarkdown: 'Independently review the repair and its documentation evidence.',
        refs: [repairedChangeSet.id],
        baseChangeSetId: repairedChangeSet.id,
      },
    })
    await restarted.reconcileGoal('goal-1')
    expect(await attempt(evidenceReview.runId)).toMatchObject({
      summary: 'Independent review rejected the documentation evidence.',
      reportMarkdown: expect.stringContaining(
        'Independent review rejected the documentation evidence.',
      ),
    })

    const finalReview = await restarted.requestWorkRun('goal-1', 'W-1', {
      directive: {
        protocol: 'report',
        profile: 'reviewer',
        workspaceMode: 'read_only',
        instructionMarkdown:
          'Perform the final independent assessment of source and verification evidence.',
        refs: [evidenceReview.runId, repairedChangeSet.id],
        baseChangeSetId: repairedChangeSet.id,
      },
    })
    await restarted.reconcileGoal('goal-1')
    expect(await attempt(finalReview.runId)).toMatchObject({
      summary: 'Independent final review accepted the repaired source and documentation evidence.',
    })

    await restarted.completeWork('goal-1', 'W-1', {
      sourceEventId: 'EV-final-review',
      decision:
        'The final independent Report accepts the repaired ChangeSet and verification evidence.',
    })
    const operationInputs = [
      {
        id: 'OP-integrate-candidate',
        idempotencyKey: 'integrate-candidate-ancestry',
        intent: { kind: 'baseline_integration' as const, changeSetId: firstChangeSet.id },
      },
      {
        id: 'OP-integrate-repair',
        idempotencyKey: 'integrate-accepted-repair',
        intent: { kind: 'baseline_integration' as const, changeSetId: repairedChangeSet.id },
      },
      {
        id: 'OP-required-archive',
        idempotencyKey: 'archive-accepted-repair',
        intent: {
          kind: 'archive' as const,
          changeSetId: repairedChangeSet.id,
          outputName: 'accepted-repair.zip',
        },
      },
    ]
    for (const operation of operationInputs) {
      await restarted.proposeOperation('goal-1', {
        ...operation,
        workId: 'W-1',
        requiredForGoal: true,
        proposedByEventId: 'EV-final-review',
      })
    }
    await expect(
      restarted.completeGoal('goal-1', {
        decision: 'The accepted repair is ready for delivery.',
      }),
    ).rejects.toThrow('OP-integrate-candidate')

    const operationStore = createDeliveryOperationStore(fixture.homeRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    expect(
      await operationStore.begin('OP-integrate-candidate', 'EV-operation-approval'),
    ).toMatchObject({ status: 'executing' })
    restarted = fixture.createReconciler()
    const firstIntegration = await restarted.executeOperation(
      'goal-1',
      'OP-integrate-candidate',
      'EV-operation-approval',
    )
    expect(firstIntegration).toMatchObject({
      status: 'succeeded',
      result: { kind: 'baseline_integrated', changeSetId: firstChangeSet.id },
    })
    expect(
      await fixture
        .createReconciler()
        .executeOperation('goal-1', 'OP-integrate-candidate', 'EV-operation-retry'),
    ).toEqual(firstIntegration)

    expect(
      await operationStore.begin('OP-integrate-repair', 'EV-operation-approval'),
    ).toMatchObject({ status: 'executing' })
    restarted = fixture.createReconciler()
    expect(
      await restarted.executeOperation('goal-1', 'OP-integrate-repair', 'EV-operation-approval'),
    ).toMatchObject({
      status: 'succeeded',
      result: { kind: 'baseline_integrated', changeSetId: repairedChangeSet.id },
    })
    await expect(
      restarted.completeGoal('goal-1', {
        decision: 'The accepted repair is integrated.',
      }),
    ).rejects.toThrow('OP-required-archive')
    const archive = await fixture
      .createReconciler()
      .executeOperation('goal-1', 'OP-required-archive', 'EV-operation-approval')
    expect(archive).toMatchObject({
      status: 'succeeded',
      result: { kind: 'archive_created', changeSetId: repairedChangeSet.id },
    })
    if (archive.result?.kind !== 'archive_created') throw new Error('Expected archive result')
    expect(await Bun.file(archive.result.path).exists()).toBe(true)

    const completed = await fixture.createReconciler().completeGoal('goal-1', {
      decision: 'Required ancestry-preserving integration and archive Operations both succeeded.',
    })
    expect(completed.attributes.lifecycle).toBe('done')

    const releaseHead = await git(fixture.projectRoot, [
      'rev-parse',
      projectReleaseRef('project-1'),
    ])
    expect(releaseHead).toBe(repairedRepoChange.resultCommit)
    await git(fixture.projectRoot, [
      'merge-base',
      '--is-ancestor',
      firstRepoChange.resultCommit,
      releaseHead,
    ])
    expect(await Bun.file(join(fixture.projectRoot, 'src', 'feature.ts')).text()).toContain('3')
    expect(await Bun.file(join(fixture.projectRoot, 'docs', 'verification.md')).text()).toContain(
      'Feature 3',
    )
    expect(await Bun.file(join(fixture.repoRoot, 'src', 'feature.ts')).text()).toContain('1')
    expect(await detail(implementation.runId)).toMatchObject({
      changeSet: { id: firstChangeSet.id },
    })

    const allAttempts = await fixture.attempts.list('project-1', 'goal-1', 'W-1')
    expect(allAttempts).toHaveLength(5)
    expect(new Set(allAttempts.map((candidate) => candidate.runId)).size).toBe(5)
    const sessions = allAttempts.flatMap((candidate) =>
      candidate.sessionEpochs.map((epoch) => epoch.sessionId),
    )
    expect(new Set(sessions).size).toBe(5)

    const server = createServer({
      rootDir: fixture.homeRoot,
      port: 0,
      attempts: fixture.attempts,
      startCoordinator: false,
    })
    const baseUrl = `http://127.0.0.1:${server.port}`
    const readApi = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`)
      if (!response.ok) throw new Error(`API ${path} returned ${response.status}`)
      return response.json() as Promise<Record<string, unknown>>
    }
    try {
      const board = await readApi('/api/projects/project-1/goals/goal-1?view=board')
      expect(board).toMatchObject({
        goal: { lifecycle: 'done' },
        works: [{ id: 'W-1', stage: 'done' }],
      })
      expect(board.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'OP-integrate-candidate', status: 'succeeded' }),
          expect.objectContaining({ id: 'OP-integrate-repair', status: 'succeeded' }),
          expect.objectContaining({ id: 'OP-required-archive', status: 'succeeded' }),
        ]),
      )
      const attemptProjection = await readApi(
        '/api/projects/project-1/goals/goal-1/works/W-1/attempts',
      )
      if (!Array.isArray(attemptProjection.attempts)) throw new Error('Expected Run list API')
      expect(
        (attemptProjection.attempts as Array<{ runId: string }>).map(
          (candidate) => candidate.runId,
        ),
      ).toEqual(expect.arrayContaining(allAttempts.map((candidate) => candidate.runId)))
      const repairProjection = await readApi(
        `/api/projects/project-1/goals/goal-1/works/W-1/attempts/${repair.runId}`,
      )
      expect(repairProjection).toMatchObject({
        runId: repair.runId,
        reportMarkdown: expect.any(String),
        changeSet: { id: repairedChangeSet.id },
        sessionEpochs: [{ sessionId: `session-${repair.runId}-generator` }],
        artifacts: { preserved: expect.any(Array), unavailable: expect.any(Array) },
      })
    } finally {
      await server.shutdown()
    }
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

  test('writes one complete checkpoint trailer for every Repo in a multi-Repo Work', async () => {
    const fixture = await createFixture({
      includeSecondaryRepo: true,
      changedRepoIds: ['primary', 'api'],
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    await fixture.reconciler.reconcileGoal('goal-1')

    for (const repo of fixture.linked.repos) {
      const worktreePath = join(dirname(repo.integrationRoot), 'work', 'goal-1', 'W-1')
      expect(await git(worktreePath, ['show', '-s', '--format=%B', 'HEAD'])).toBe(
        [
          'hopi: checkpoint goal-1/W-1',
          '',
          'HOPI-Project: project-1',
          'HOPI-Goal: goal-1',
          'HOPI-Work: W-1',
          `HOPI-Repo: ${repo.repoId}`,
          'HOPI-Producer-Run: run-2',
          '',
          'Generation-Mode: AI-Pure',
        ].join('\n'),
      )
    }
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

  test('starts fresh Generator and Reviewer Sessions across a rejection loop', async () => {
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
    ).toEqual([null, null])
    expect(
      fixture.runner.refreshAssignmentsByRun
        .filter((run) => run.responsibility === 'generator')
        .map((run) => run.refreshAssignment),
    ).toEqual([false, false])
    expect(
      fixture.runner.sessionsByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => run.sessionId),
    ).toEqual([null, null])
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
        markerFound: false,
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
        markerFound: false,
      },
    ])
    expect(fixture.runner.sessionWorkspacesByRun[1]?.path).not.toBe(
      fixture.runner.sessionWorkspacesByRun[3]?.path,
    )
    expect(fixture.runner.sessionWorkspacesByRun[2]?.path).not.toBe(
      fixture.runner.sessionWorkspacesByRun[4]?.path,
    )
    expect(new Set(fixture.runner.generatorCwds).size).toBe(1)
    expect(fixture.runner.reviewerCwds).toEqual(
      fixture.runner.sessionWorkspacesByRun
        .filter((run) => run.responsibility === 'reviewer')
        .map((run) => run.path),
    )
    expect(new Set(fixture.runner.reviewerCwds).size).toBe(2)
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

  test('creates a new checkpoint after Reviewer rejection without bypassing review', async () => {
    const fixture = await createFixture({
      reviewerRejectOnce: true,
      generatorChangesOnRetry: true,
    })

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await fixture.reconciler.reconcileGoal('goal-1')
    }

    const worktreePath = join(dirname(fixture.projectRoot), 'work', 'goal-1', 'W-1')
    const [retryCheckpoint, firstCheckpoint] = (
      await git(worktreePath, ['log', '--format=%H', '-2'])
    ).split('\n')
    if (!retryCheckpoint || !firstCheckpoint) throw new Error('Expected two Generator checkpoints')

    expect(await git(worktreePath, ['show', '-s', '--format=%P', retryCheckpoint])).toBe(
      firstCheckpoint,
    )
    expect(await git(worktreePath, ['show', '-s', '--format=%B', firstCheckpoint])).toBe(
      [
        'hopi: checkpoint goal-1/W-1',
        '',
        'HOPI-Project: project-1',
        'HOPI-Goal: goal-1',
        'HOPI-Work: W-1',
        'HOPI-Repo: primary',
        'HOPI-Producer-Run: run-2',
        '',
        'Generation-Mode: AI-Pure',
      ].join('\n'),
    )
    expect(await git(worktreePath, ['show', '-s', '--format=%B', retryCheckpoint])).toBe(
      [
        'hopi: checkpoint goal-1/W-1',
        '',
        'HOPI-Project: project-1',
        'HOPI-Goal: goal-1',
        'HOPI-Work: W-1',
        'HOPI-Repo: primary',
        'HOPI-Producer-Run: run-4',
        '',
        'Generation-Mode: AI-Pure',
      ].join('\n'),
    )
    expect(fixture.runner.responsibilities).toEqual([
      'planner',
      'generator',
      'reviewer',
      'generator',
      'reviewer',
    ])
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes.stage).toBe(
      'done',
    )
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
    const controller = createGoalController(fixture.store, {})
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
    expect(await git(taskWorktreePath, ['show', '-s', '--format=%B', 'HEAD'])).toBe(
      [
        'hopi: checkpoint goal-1/W-1',
        '',
        'HOPI-Project: project-1',
        'HOPI-Goal: goal-1',
        'HOPI-Work: W-1',
        'HOPI-Repo: primary',
        'HOPI-Producer-Run: run-2',
        '',
        'Generation-Mode: AI-Pure',
      ].join('\n'),
    )
    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
  })

  test('EV-004 checkpoints partial Generator source before completing an interruption', async () => {
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
    const detail = await fixture.attempts.read('project-1', 'goal-1', 'W-1', attempt?.runId ?? '')

    expect(result).toMatchObject({
      kind: 'wait',
      decision: { reasons: ['run_interrupted'] },
    })
    expect(taskWorktreePath).toBe(expectedWorktree)
    expect(await git(taskWorktreePath, ['status', '--porcelain'])).toBe('')
    expect(await git(taskWorktreePath, ['show', '-s', '--format=%B', 'HEAD'])).toBe(
      [
        'hopi: checkpoint goal-1/W-1',
        '',
        'HOPI-Project: project-1',
        'HOPI-Goal: goal-1',
        'HOPI-Work: W-1',
        'HOPI-Repo: primary',
        'HOPI-Producer-Run: run-2',
        '',
        'Generation-Mode: AI-Pure',
      ].join('\n'),
    )
    expect(attempt).toMatchObject({
      status: 'interrupted',
      termination: 'interrupted',
      result: null,
      application: null,
      changeSetId: `CS-${attempt?.runId}`,
    })
    expect(detail?.changeSet).toMatchObject({
      id: `CS-${attempt?.runId}`,
      producerRunId: attempt?.runId,
      disposition: 'unaccepted',
      repos: [
        {
          repoId: 'primary',
          baseCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
          resultCommit: expect.stringMatching(/^[a-f0-9]{40}$/),
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ],
    })
    expect(detail?.events).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'coordinator',
        content:
          'Checkpointed safe partial Generator source before interruption and froze any delta.',
      }),
    )
    expect((await fixture.store.readPackage('goal-1')).works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    })
  })

  test('EV-004 freezes every changed Repo when a multi-Repo Generator is interrupted', async () => {
    const fixture = await createFixture({
      includeSecondaryRepo: true,
      changedRepoIds: ['primary', 'api'],
      generatorWaitForAbort: true,
    })

    await fixture.reconciler.reconcileGoal('goal-1')
    const running = fixture.reconciler.reconcileGoal('goal-1')
    const worktreeRoot = join(dirname(fixture.projectRoot), 'work', 'goal-1', 'W-1')
    const api = fixture.linked.repos.find((repo) => repo.repoId === 'api')
    if (!api) throw new Error('Expected secondary Repo')
    const apiWorktreeRoot = join(dirname(api.integrationRoot), 'work', 'goal-1', 'W-1')
    await waitUntil(async () => {
      const [primary, secondary] = await Promise.all([
        Bun.file(join(worktreeRoot, 'src', 'feature.ts'))
          .text()
          .catch(() => ''),
        Bun.file(join(apiWorktreeRoot, 'src', 'feature.ts'))
          .text()
          .catch(() => ''),
      ])
      return primary.includes('2') && secondary.includes('2')
    })

    fixture.reconciler.interruptRuns('goal-1')
    await running
    const attempt = (await fixture.attempts.list('project-1', 'goal-1', 'W-1')).at(-1)
    const detail = await fixture.attempts.read('project-1', 'goal-1', 'W-1', attempt?.runId ?? '')

    expect(attempt).toMatchObject({
      termination: 'interrupted',
      changeSetId: `CS-${attempt?.runId}`,
    })
    expect(detail?.changeSet?.repos.map((repo) => repo.repoId).sort()).toEqual(['api', 'primary'])
    expect(
      detail?.changeSet?.repos.every(
        (repo) => repo.baseCommit !== repo.resultCommit && /^[a-f0-9]{64}$/.test(repo.contentHash),
      ),
    ).toBe(true)
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
      contextRefs: [],
      ownerMessages: [],
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
        'const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: manifest.repos.primary }).stdout.toString().trim()',
        'if (manifest.projection !== "candidate" || manifest.releaseHeads.primary !== head) process.exit(8)',
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
      contextRefs: [],
      ownerMessages: [],
    })

    expect(await fixture.reconciler.reconcileGoal('goal-1')).toMatchObject({
      kind: 'wait',
      decision: { reasons: expect.arrayContaining(['failed_attempt']) },
    })
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
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

  test('explicit continuation reserves one Run without inventing or mutating Attention', async () => {
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

    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
      runId: 'run-2',
      disposition: 'scheduled',
    })
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
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

  test('runs the same queued Attempt after the Coordinator is recreated', async () => {
    const fixture = await createFixture({ directInitialWork: true })
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
      runId: 'run-1',
      disposition: 'scheduled',
    })

    const restarted = fixture.createReconciler()
    expect(await restarted.reconcileGoal('goal-1')).toMatchObject({
      kind: 'pass_finished',
      runId: 'run-1',
      result: 'success',
    })
    expect(fixture.runner.responsibilities).toEqual(['generator'])
    expect(await fixture.attempts.list('project-1', 'goal-1', 'W-1')).toMatchObject([
      { runId: 'run-1', status: 'finished' },
    ])
  })

  test('keeps a timed queued Attempt across restart and runs it once after notBefore', async () => {
    const fixture = await createFixture({ directInitialWork: true })
    const controller = createGoalController(fixture.store, {})
    await controller.setWorkNotBefore('goal-1', 'W-1', '2026-07-12T00:00:00.000Z')
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toMatchObject({
      runId: 'run-1',
      disposition: 'scheduled',
    })
    expect(
      await fixture.reconciler.reconcileGoal('goal-1', {
        now: new Date('2026-07-11T12:00:00.000Z'),
      }),
    ).toMatchObject({ kind: 'wait' })

    const restarted = fixture.createReconciler()
    expect(
      await restarted.reconcileGoal('goal-1', {
        now: new Date('2026-07-12T00:00:01.000Z'),
      }),
    ).toMatchObject({
      kind: 'pass_finished',
      runId: 'run-1',
      result: 'success',
    })
    expect(fixture.runner.responsibilities).toEqual(['generator'])
  })

  test('returns the active Attempt when continuation arrives during Project preparation', async () => {
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
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
      runId: 'run-1',
      disposition: 'already_active',
    })
    expect(await fixture.reconciler.requestWorkRun('goal-1', 'W-1')).toEqual({
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

  test('starts a fresh responsibility Session after a Project Owner Work message', async () => {
    const fixture = await createFixture({
      directInitialWork: true,
      generatorOperationalFailure: true,
    })
    const first = await fixture.reconciler.reconcileGoal('goal-1')
    const controller = createGoalController(fixture.store, {})
    await controller.appendWorkMessage('goal-1', 'W-1', {
      sourceEventId: 'EV-guidance',
      content: 'Use the verified API command from the current design.',
    })
    await fixture.reconciler.requestWorkRun('goal-1', 'W-1')
    const second = await fixture.reconciler.reconcileGoal('goal-1')

    expect(first).toMatchObject({ kind: 'pass_finished', application: 'operational_failure' })
    expect(second).toMatchObject({ kind: 'pass_finished', application: 'operational_failure' })
    expect(fixture.runner.sessionsByRun).toEqual([
      { responsibility: 'generator', sessionId: null },
      { responsibility: 'generator', sessionId: null },
    ])
    const firstRunView = fixture.runner.runViewsByRun[0]
    if (!firstRunView) throw new Error('Expected the first Generator Run view')
    expect(fixture.runner.runViewsByRun[1]?.path).not.toBe(firstRunView.path)
    expect(fixture.runner.runViewsByRun.every(({ ownsCurrentRun }) => ownsCurrentRun)).toBe(true)
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
      contextRefs: [],
      ownerMessages: [],
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
    await fixture.reconciler.requestWorkRun('goal-1', 'W-1')
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
  readonly runViewsByRun: Array<{ path: string; ownsCurrentRun: boolean }> = []
  readonly plannerCwds: string[] = []
  readonly plannerRunRoots: string[] = []
  readonly generatorCwds: string[] = []
  readonly reviewerCwds: string[] = []
  readonly reviewerRunRoots: string[] = []
  readonly repoRootsByRun: Array<{ responsibility: string; paths: string[] }> = []
  readonly runContracts: Array<{
    profile: string
    protocol: string | undefined
    workspaceMode: string | undefined
    prompt: string
  }> = []
  private generatorRuns = 0
  private reviewerRuns = 0
  private reviewerRejections = 0

  constructor(
    private readonly options: {
      generatorResult: 'success' | 'fail'
      generatorChangesOnRetry: boolean
      generatorOperationalFailure: boolean
      generatorEpochRotation: boolean
      reviewerOperationalWriteOnce: boolean
      reviewerRejectCount: number
      changedRepoIds: readonly string[]
      generatorWaitForAbort: boolean
      plannerWaitForAbort: boolean
      plannerResult: 'success' | 'fail'
    },
  ) {}

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    const artifacts: string[] = []
    this.responsibilities.push(input.responsibility)
    this.runContracts.push({
      profile: input.responsibility,
      protocol: input.protocol,
      workspaceMode: input.workspaceMode,
      prompt: await Bun.file(input.context.promptFile).text(),
    })
    await observer?.onExecution?.({
      transport: 'codex',
      provider: 'codex',
      model: 'gpt-test',
      reasoningEffort: 'xhigh',
      permissionBoundary: 'bounded',
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
    if (!input.context.runViewRoot) throw new Error('Responsibility Run view is missing')
    this.runViewsByRun.push({
      path: input.context.runViewRoot,
      ownsCurrentRun:
        (await realpath(input.context.runViewRoot)) === (await realpath(input.context.runRoot)),
    })
    if (!markerFound) {
      await Bun.write(continuityMarker, `${input.responsibility} continuity\n`)
    }
    await observer?.onSession?.({
      transport: 'codex',
      sessionId:
        this.options.generatorEpochRotation && input.responsibility === 'generator'
          ? `session-${input.runId}-epoch-1`
          : `session-${input.runId}-${input.responsibility}`,
      executionKey: 'test-execution',
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
      if (this.options.generatorEpochRotation) {
        for (const repo of input.context.repoRoots) {
          if (!this.options.changedRepoIds.includes(repo.repoId)) continue
          await mkdir(join(repo.path, 'src'), { recursive: true })
          await Bun.write(join(repo.path, 'src', 'epoch-one.ts'), 'export const epoch = 1\n')
        }
        const previousSession = {
          transport: 'codex' as const,
          sessionId: `session-${input.runId}-epoch-1`,
          executionKey: 'test-execution',
        }
        await observer?.onSessionInvalid?.()
        await observer?.onSessionRotate?.({
          reason: 'context_boundary',
          previousSession,
          handoffMarkdown: `# Run Session Epoch handoff\n\nRun ${input.runId} keeps its workspace.`,
        })
        await observer?.onSession?.({
          ...previousSession,
          sessionId: `session-${input.runId}-epoch-2`,
        })
      }
      const generatorRun = this.generatorRuns++
      const featureVersion = this.options.generatorChangesOnRetry ? generatorRun + 2 : 2
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
        await Bun.write(
          join(repo.path, 'src', 'feature.ts'),
          `export const feature = ${featureVersion}\n`,
        )
        if (this.options.generatorChangesOnRetry && generatorRun > 0) {
          await mkdir(join(repo.path, 'docs'), { recursive: true })
          await Bun.write(
            join(repo.path, 'docs', 'verification.md'),
            `# Verification\n\nFeature ${featureVersion} is covered by the focused check.\n`,
          )
        }
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
      this.reviewerRejections < this.options.reviewerRejectCount
    ) {
      const rejection = this.reviewerRejections++
      return {
        result: 'reject',
        summary:
          rejection === 0
            ? 'Independent review found a source defect.'
            : 'Independent review rejected the documentation evidence.',
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
      summary:
        input.responsibility === 'reviewer' && this.options.reviewerRejectCount > 0
          ? 'Independent final review accepted the repaired source and documentation evidence.'
          : `${input.responsibility} completed its fixed responsibility.`,
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
            contextRefs: [],
            ownerMessages: [],
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
    generatorResult?: 'success' | 'fail'
    generatorChangesOnRetry?: boolean
    changedRepoIds?: readonly string[]
    generatorOperationalFailure?: boolean
    generatorEpochRotation?: boolean
    generatorWaitForAbort?: boolean
    plannerWaitForAbort?: boolean
    plannerResult?: 'success' | 'fail'
    reviewerOperationalWriteOnce?: boolean
    reviewerRejectOnce?: boolean
    reviewerRejectCount?: number
    objective?: string
    acceptanceCriteria?: readonly string[]
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
    objective: options.objective ?? 'Set feature to 2.',
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
            objective: options.objective ?? 'Set feature to 2.',
            acceptanceCriteria: options.acceptanceCriteria ?? ['feature equals 2.'],
            assistantDispatch: 'home:H-1/event:EV-1' as const,
          },
        }
      : {}),
  })
  const runner = new DeliveryScriptRunner({
    generatorResult: options.generatorResult ?? 'success',
    generatorChangesOnRetry: options.generatorChangesOnRetry ?? false,
    generatorOperationalFailure: options.generatorOperationalFailure ?? false,
    generatorEpochRotation: options.generatorEpochRotation ?? false,
    reviewerOperationalWriteOnce: options.reviewerOperationalWriteOnce ?? false,
    reviewerRejectCount: options.reviewerRejectCount ?? (options.reviewerRejectOnce ? 1 : 0),
    changedRepoIds: options.changedRepoIds ?? ['primary'],
    generatorWaitForAbort: options.generatorWaitForAbort ?? false,
    plannerWaitForAbort: options.plannerWaitForAbort ?? false,
    plannerResult: options.plannerResult ?? 'success',
  })
  let runSequence = 0
  const now = () => new Date('2026-07-11T00:00:00Z')
  const attempts = createRunAttemptStore(homeRoot, { now })
  const createReconciler = () => {
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
      preparer: options.preparer,
      worktrees: options.worktrees,
      checkpointTask: options.checkpointTask,
      onProjectBlocked: options.onProjectBlocked,
      onReleaseUpdated: options.onReleaseUpdated,
      now,
      createRunId: () => `run-${++runSequence}`,
    })
    return {
      ...reconciler,
      reconcileGoal(
        goalId: string,
        runtime: Partial<Parameters<typeof reconciler.reconcileGoal>[1]> = {},
      ) {
        return reconciler.reconcileGoal(goalId, {
          projectEligible: true,
          passCapacity: { planner: true, generator: true, reviewer: true },
          ...runtime,
        })
      },
    }
  }
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
