import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantReflection } from '../src/assistant/assistantReflection'
import type { WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createWorkspaceAttentionController } from '../src/runtime/workspaceAttentionController'
import { createCoordinatorReconciler } from '../src/scheduler/coordinatorReconciler'
import type { ProjectReconciler } from '../src/scheduler/projectReconciler'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'coordinator-reconciler')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('CoordinatorReconciler', () => {
  test('accepts multiple messages while processing Assistant turns in FIFO order', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'First.' })
    await fixture.workspace.receiveEvent({ eventId: 'EV-2', content: 'Second.' })
    const assistant = {
      async process(eventId: string) {
        await Bun.sleep(20)
        await fixture.workspace.handleEvent(eventId, {
          reply: `Handled ${eventId}`,
          disposition: 'answered',
        })
        return { kind: 'answered' as const, eventId }
      },
    }
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant,
      attentions: fixture.attentions,
      projects: [],
    })

    expect(await coordinator.reconcileOnce()).toMatchObject({ kind: 'assistant_started' })
    expect(await coordinator.reconcileOnce()).toMatchObject({ kind: 'idle' })
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toMatchObject({ kind: 'assistant_started' })
    await coordinator.waitForIdle()

    expect((await fixture.workspace.readEvent('EV-1'))?.attributes.status).toBe('handled')
    expect((await fixture.workspace.readEvent('EV-2'))?.attributes.status).toBe('handled')
  })

  test('turns bounded Assistant turn failure into event-target Attention', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Unsafe ambiguity.' })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process() {
          throw new Error('conversation process failed')
        },
      },
      attentions: fixture.attentions,
      projects: [],
      assistantMaxAttempts: 3,
    })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await coordinator.reconcileOnce()
      await coordinator.waitForIdle()
    }
    const workspace = await fixture.workspace.readWorkspace()

    expect(
      [...workspace.attentions.values()].some(
        (attention) =>
          attention.attributes.target === `home:${workspace.homeId}/event:EV-1` &&
          attention.attributes.resolvedAt === null,
      ),
    ).toBe(true)
  })

  test('prioritizes public user turns over older internal Reflection handoffs', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-reflection',
      content: 'Older internal assessment.',
      receivedAt: new Date('2026-07-11T00:00:00Z'),
    })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-user',
      content: 'New operator input.',
      receivedAt: new Date('2026-07-11T00:01:00Z'),
    })
    const processed: string[] = []
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          processed.push(eventId)
          await fixture.workspace.handleEvent(eventId, {
            reply: `Handled ${eventId}`,
            disposition: 'answered',
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()
    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()

    expect(processed).toEqual(['EV-user', 'EV-reflection'])
  })

  test('preempts a running internal Assistant turn when public user input arrives', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-reflection',
      content: 'Internal repair assessment.',
    })
    const started: string[] = []
    let reflectionAttempts = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId, signal) {
          started.push(eventId)
          if (eventId === 'EV-reflection' && reflectionAttempts++ === 0) {
            await new Promise<void>((_resolve, reject) => {
              if (!signal) throw new Error('Expected an Assistant turn signal')
              if (signal.aborted) return reject(new Error('interrupted'))
              signal.addEventListener('abort', () => reject(new Error('interrupted')), {
                once: true,
              })
            })
          }
          await fixture.workspace.handleEvent(eventId, {
            reply: `Handled ${eventId}`,
            disposition: 'answered',
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    expect(await coordinator.reconcileOnce()).toMatchObject({ kind: 'assistant_started' })
    await Bun.sleep(0)
    await fixture.workspace.receiveEvent({ eventId: 'EV-user', content: 'Operator input.' })
    coordinator.interruptInternalAssistant()
    await coordinator.waitForIdle()

    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()
    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()

    expect(started).toEqual(['EV-reflection', 'EV-user', 'EV-reflection'])
    expect((await fixture.workspace.readEvent('EV-user'))?.attributes.status).toBe('handled')
    expect((await fixture.workspace.readEvent('EV-reflection'))?.attributes.status).toBe('handled')
    expect((await fixture.workspace.readWorkspace()).attentions.size).toBe(0)
  })

  test('enforces the fixed global Generator capacity of three', async () => {
    const fixture = await workspaceFixture()
    const packages = new Map(
      ['G-1', 'G-2', 'G-3', 'G-4'].map((goalId) => [goalId, engineeringPackage(goalId)]),
    )
    const pending = new Map<string, () => void>()
    const store = {
      listGoalIds: async () => [...packages.keys()],
      readPackage: async (goalId: string) => requirePackage(packages, goalId),
    } as unknown as GoalPackageStore
    const reconciler = {
      interruptRuns: () => undefined,
      liveWorkIds: () => new Set<string>(),
      reconcileGoal(goalId: string) {
        return new Promise((resolve) => {
          pending.set(goalId, () => {
            const work = requirePackage(packages, goalId).works.get('W-1')
            if (!work) throw new Error(`Missing Work for ${goalId}`)
            work.attributes.stage = 'done'
            requirePackage(packages, goalId).goal.attributes.lifecycle = 'paused'
            resolve({
              kind: 'pass_finished',
              workId: 'W-1',
              runId: `run-${goalId}`,
              result: 'success',
              application: 'published',
            })
          })
        })
      },
    } as ProjectReconciler
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      attentions: fixture.attentions,
      projects: [{ projectId: 'P-1', store, reconciler }],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 3 })
    expect([...coordinator.activeRuns().values()]).toEqual(['generator', 'generator', 'generator'])
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })

    pending.get('G-1')?.()
    await Bun.sleep(0)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    pending.get('G-2')?.()
    pending.get('G-3')?.()
    pending.get('G-4')?.()
    await coordinator.waitForIdle()
  })

  test('reports settled Reflection eligibility only after responsibility progress drains', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let finish: (() => void) | undefined
    const pass = new Promise<void>((resolve) => {
      finish = resolve
    })
    let listCalls = 0
    let markOverlappingScanStarted: (() => void) | undefined
    const overlappingScanStarted = new Promise<void>((resolve) => {
      markOverlappingScanStarted = resolve
    })
    let releaseOverlappingScan: (() => void) | undefined
    const overlappingScan = new Promise<void>((resolve) => {
      releaseOverlappingScan = resolve
    })
    const observations: boolean[] = []
    const reflection = {
      async observe(input) {
        observations.push(input.settled)
        return 'baseline' as const
      },
      isActive: () => false,
      listRuns: async () => [],
      listRunSummaries: async () => [],
      readRunEvents: async () => null,
      waitForIdle: async () => undefined,
      stop: async () => undefined,
    } satisfies AssistantReflection
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      reflection,
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            async listGoalIds() {
              listCalls += 1
              if (listCalls === 2) {
                markOverlappingScanStarted?.()
                await overlappingScan
              }
              return ['G-1']
            },
            readPackage: async () => goalPackage,
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              await pass
              const work = goalPackage.works.get('W-1')
              if (!work) throw new Error('Missing Engineering Work')
              work.attributes.stage = 'done'
              goalPackage.goal.attributes.lifecycle = 'paused'
              return {
                kind: 'pass_finished' as const,
                workId: 'W-1',
                runId: 'R-1',
                result: 'success' as const,
                application: 'published' as const,
              }
            },
          },
        },
      ],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    expect(observations).toEqual([false])

    const overlappingTick = coordinator.reconcileOnce()
    await overlappingScanStarted
    finish?.()
    await Bun.sleep(0)
    expect(coordinator.activeRuns().size).toBe(0)
    releaseOverlappingScan?.()
    expect(await overlappingTick).toEqual({ kind: 'idle' })
    expect(observations).toEqual([false, false])

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(observations).toEqual([false, false, true])
  })

  test('revokes only the paused Goal live Run leases', async () => {
    const fixture = await workspaceFixture()
    const packages = new Map(['G-1', 'G-2'].map((goalId) => [goalId, engineeringPackage(goalId)]))
    const finish = new Map<string, () => void>()
    const interrupted: Array<string | undefined> = []
    const store = {
      listGoalIds: async () => [...packages.keys()],
      readPackage: async (goalId: string) => requirePackage(packages, goalId),
    } as unknown as GoalPackageStore
    const reconciler = {
      interruptRuns(goalId?: string) {
        interrupted.push(goalId)
        if (goalId) finish.get(goalId)?.()
      },
      liveWorkIds: () => new Set<string>(),
      reconcileGoal(goalId: string) {
        return new Promise((resolve) => {
          finish.set(goalId, () =>
            resolve({
              kind: 'wait',
              decision: { kind: 'wait', reasons: ['run_interrupted'] },
            }),
          )
        })
      },
    } as ProjectReconciler
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      attentions: fixture.attentions,
      projects: [{ projectId: 'P-1', store, reconciler }],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 2 })
    requirePackage(packages, 'G-1').goal.attributes.lifecycle = 'paused'

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    await Bun.sleep(0)
    expect(interrupted).toEqual(['G-1'])
    expect([...coordinator.activeRuns().keys()]).toEqual(['P-1/G-2/W-1'])

    requirePackage(packages, 'G-2').goal.attributes.lifecycle = 'paused'
    finish.get('G-2')?.()
    await coordinator.waitForIdle()
  })

  test('drains admitted same-Goal Engineering before dispatching queued Planning', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let finishEngineering: (() => void) | undefined
    const engineeringRun = new Promise<void>((resolve) => {
      finishEngineering = resolve
    })
    let finishPlanning: (() => void) | undefined
    const planningRun = new Promise<void>((resolve) => {
      finishPlanning = resolve
    })
    let dispatchCount = 0
    const store = {
      listGoalIds: async () => ['G-1'],
      readPackage: async () => goalPackage,
    } as unknown as GoalPackageStore
    const reconciler = {
      interruptRuns: () => undefined,
      liveWorkIds: () => new Set<string>(),
      async reconcileGoal() {
        dispatchCount += 1
        if (dispatchCount === 1) {
          await engineeringRun
          const engineering = goalPackage.works.get('W-1')
          if (!engineering) throw new Error('Missing Engineering Work')
          engineering.attributes.stage = 'review'
          return {
            kind: 'pass_finished' as const,
            workId: 'W-1',
            runId: 'R-engineering',
            result: 'success',
            application: 'published',
          }
        }
        await planningRun
        const planning = goalPackage.works.get('plan-0002')
        if (!planning) throw new Error('Missing Planning Work')
        planning.attributes.stage = 'done'
        goalPackage.goal.attributes.lifecycle = 'paused'
        return {
          kind: 'pass_finished' as const,
          workId: 'plan-0002',
          runId: 'R-planning',
          result: 'success',
          application: 'published',
        }
      },
    } as ProjectReconciler
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [{ projectId: 'P-1', store, reconciler }],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    expect([...coordinator.activeRuns().values()]).toEqual(['generator'])
    ;(goalPackage.works as Map<string, WorkDocument>).set('plan-0002', {
      attributes: {
        id: 'plan-0002',
        title: 'Reassess and plan the Goal',
        kind: 'planning',
        stage: 'plan',
        notBefore: null,
        dependsOn: [],
        contractRevision: 1,
        evidenceRefs: [],
        attempts: 0,
      },
      body: 'Plan the concurrent instruction.\n',
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(dispatchCount).toBe(1)

    finishEngineering?.()
    await Bun.sleep(0)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    expect([...coordinator.activeRuns().values()]).toEqual(['planner'])

    finishPlanning?.()
    await coordinator.waitForIdle()
  })

  test('does not dispatch a new pass when stop races with candidate scanning', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let releaseScan: (() => void) | undefined
    const scanStarted = new Promise<void>((resolve) => {
      releaseScan = resolve
    })
    let finishScan: (() => void) | undefined
    const scanGate = new Promise<void>((resolve) => {
      finishScan = resolve
    })
    let dispatches = 0
    const store = {
      async listGoalIds() {
        releaseScan?.()
        await scanGate
        return ['G-1']
      },
      readPackage: async () => goalPackage,
    } as unknown as GoalPackageStore
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              dispatches += 1
              return {
                kind: 'pass_finished' as const,
                workId: 'W-1',
                runId: 'R-1',
                result: 'success',
                application: 'published',
              }
            },
          },
        },
      ],
    })

    const tick = coordinator.reconcileOnce()
    await scanStarted
    const stopped = coordinator.stop()
    finishScan?.()

    expect(await tick).toEqual({ kind: 'idle' })
    await stopped
    expect(dispatches).toBe(0)
  })

  test('turns a failed deterministic Goal action into one project Attention', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    const goalPackage = engineeringPackage('G-1')
    goalPackage.works = new Map()
    const store = {
      listGoalIds: async () => ['G-1'],
      readPackage: async () => goalPackage,
    } as unknown as GoalPackageStore
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              throw new Error('invalid completion structure')
            },
          },
        },
      ],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'deterministic_action', count: 1 })
    const workspace = await fixture.workspace.readWorkspace()
    expect(
      [...workspace.attentions.values()].filter(
        (attention) =>
          attention.attributes.target === 'project:P-1' && attention.attributes.resolvedAt === null,
      ),
    ).toHaveLength(1)
  })

  test('fails one project closed when canonical validation breaks during reconciliation', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => ['G-corrupt'],
            readPackage: async () => {
              throw new Error('goal.md is invalid')
            },
          } as unknown as GoalPackageStore,
          reconciler: {
            liveWorkIds: () => new Set<string>(),
          } as unknown as ProjectReconciler,
        },
      ],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    const workspace = await fixture.workspace.readWorkspace()
    expect(
      [...workspace.attentions.values()].filter(
        (attention) =>
          attention.attributes.target === 'project:P-1' && attention.attributes.resolvedAt === null,
      ),
    ).toHaveLength(1)
  })
})

async function workspaceFixture() {
  const home = createAssistantHomeStore(temporaryRoot)
  await home.initialize()
  const publisher = new PublicationCoordinator()
  const workspace = createAssistantWorkspaceStore(temporaryRoot, publisher)
  return {
    home,
    workspace,
    attentions: createWorkspaceAttentionController(
      workspace,
      () => new Date('2026-07-11T00:00:00Z'),
    ),
  }
}

function requirePackage(packages: ReadonlyMap<string, GoalPackage>, goalId: string) {
  const goalPackage = packages.get(goalId)
  if (!goalPackage) throw new Error(`Missing Goal package ${goalId}`)
  return goalPackage
}

function engineeringPackage(goalId: string): GoalPackage {
  return {
    goal: {
      attributes: {
        id: goalId,
        title: goalId,
        lifecycle: 'active',
        priority: 0,
        contractRevision: 1,
        completionAttentionId: null,
      },
      body: 'Ship.\n',
    },
    works: new Map([
      [
        'W-1',
        {
          attributes: {
            id: 'W-1',
            title: 'Build',
            kind: 'engineering',
            stage: 'generate',
            notBefore: null,
            dependsOn: [],
            contractRevision: 1,
            evidenceRefs: [],
            attempts: 0,
          },
          body: 'Build.\n',
        },
      ],
    ]),
    attentions: new Map(),
    evidence: new Map(),
    inputs: [],
  }
}
