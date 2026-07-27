import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantReflection } from '../src/assistant/assistantReflection'
import type { AttentionDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { PublicationCoordinator } from '../src/publication/publisher'
import type { Responsibility } from '../src/runtime/roleContextStager'
import { createWorkspaceAttentionController } from '../src/runtime/workspaceAttentionController'
import { createCoordinatorReconciler as createCoordinatorReconcilerWithOptions } from '../src/scheduler/coordinatorReconciler'
import type { ProjectReconciler } from '../src/scheduler/projectReconciler'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'coordinator-reconciler')
const testConcurrency = { planner: 3, generator: 3, reviewer: 3 } as const
type CoordinatorOptions = Parameters<typeof createCoordinatorReconcilerWithOptions>[0]

function createCoordinatorReconciler(
  options: Omit<CoordinatorOptions, 'concurrency'> & {
    concurrency?: CoordinatorOptions['concurrency']
  },
) {
  return createCoordinatorReconcilerWithOptions({ concurrency: testConcurrency, ...options })
}

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

  test('does not dispatch a deterministic direct command receipt before acknowledgement', async () => {
    const fixture = await workspaceFixture()
    const processed: string[] = []
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          processed.push(eventId)
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    await coordinator.runDirectAssistantCommand(async () => {
      await fixture.workspace.receiveEvent({ eventId: 'EV-direct', content: 'Pause Goal G-1.' })
      expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
      await fixture.workspace.handleEvent('EV-direct', {
        reply: 'Paused Goal G-1.',
        disposition: 'tool:pause',
      })
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(processed).toEqual([])
    expect((await fixture.workspace.readWorkspace()).attentions.size).toBe(0)
  })

  test('quiesces one Project before an environment mutation', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let finishRun: (() => void) | undefined
    const runGate = new Promise<void>((resolve) => {
      finishRun = resolve
    })
    let interruptions = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => ['G-1'],
            readPackage: async () => goalPackage,
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns() {
              interruptions += 1
            },
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              await runGate
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

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    let quiesced = false
    const quiescing = coordinator.quiesceProject('P-1').then(() => {
      quiesced = true
    })
    await Bun.sleep(0)
    expect(interruptions).toBeGreaterThan(0)
    expect(quiesced).toBe(false)

    finishRun?.()
    await quiescing
    expect(quiesced).toBe(true)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
  })

  test('holds the contextual Goal until the Assistant turn settles without blocking other Goals', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    await fixture.workspace.receiveEvent({
      eventId: 'EV-goal-turn',
      content: 'Revise this Goal.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })
    const packages = new Map(['G-1', 'G-2'].map((goalId) => [goalId, engineeringPackage(goalId)]))
    let finishAssistant: (() => void) | undefined
    const assistantGate = new Promise<void>((resolve) => {
      finishAssistant = resolve
    })
    const dispatched: string[] = []
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          await assistantGate
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Accepted.',
            disposition: 'tool:request_planning',
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => [...packages.keys()],
            readPackage: async (goalId: string) => requirePackage(packages, goalId),
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal(goalId: string) {
              dispatched.push(goalId)
              const goalPackage = requirePackage(packages, goalId)
              const work = goalPackage.works.get('W-1')
              if (!work) throw new Error(`Missing Work for ${goalId}`)
              work.attributes.stage = 'done'
              goalPackage.goal.attributes.lifecycle = 'paused'
              return {
                kind: 'pass_finished' as const,
                workId: 'W-1',
                runId: `R-${goalId}`,
                result: 'success' as const,
                application: 'published' as const,
              }
            },
          } as ProjectReconciler,
        },
      ],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    await Bun.sleep(0)
    expect(dispatched).toEqual(['G-2'])
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })

    finishAssistant?.()
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    await coordinator.waitForIdle()
    expect(dispatched).toEqual(['G-2', 'G-1'])
  })

  test('lets a Project wake supervise the same Goal while its repair Run continues', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-reviewer-reject',
      content: 'Reviewer rejected the current candidate.',
      context: { projectId: 'P-1' },
    })
    const goalPackage = engineeringPackage('G-1')
    let finishAssistant: (() => void) | undefined
    const assistantGate = new Promise<void>((resolve) => {
      finishAssistant = resolve
    })
    let dispatches = 0
    let markDispatched: (() => void) | undefined
    const dispatched = new Promise<void>((resolve) => {
      markDispatched = resolve
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          await assistantGate
          await fixture.workspace.handleEvent(eventId, {
            reply: '',
            disposition: 'silent',
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => ['G-1'],
            readPackage: async () => goalPackage,
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              dispatches += 1
              markDispatched?.()
              goalPackage.goal.attributes.lifecycle = 'paused'
              return {
                kind: 'pass_finished' as const,
                workId: 'W-1',
                runId: 'R-generator-repair',
                result: 'success',
                application: 'published',
              }
            },
          },
        },
      ],
    })

    coordinator.start()
    await dispatched
    expect(dispatches).toBe(1)

    finishAssistant?.()
    await coordinator.waitForIdle()
    await coordinator.stop()
  })

  test('rechecks a dynamically protected Goal after candidate scanning', async () => {
    const fixture = await workspaceFixture()
    const packages = new Map(['G-1', 'G-2'].map((goalId) => [goalId, engineeringPackage(goalId)]))
    let markSecondScan: (() => void) | undefined
    const secondScan = new Promise<void>((resolve) => {
      markSecondScan = resolve
    })
    let releaseSecondScan: (() => void) | undefined
    const secondScanGate = new Promise<void>((resolve) => {
      releaseSecondScan = resolve
    })
    const dispatched: string[] = []
    const project = (projectId: string, goalId: string, hold = false) => ({
      projectId,
      store: {
        async listGoalIds() {
          if (hold) {
            markSecondScan?.()
            await secondScanGate
          }
          return [goalId]
        },
        readPackage: async () => requirePackage(packages, goalId),
      } as unknown as GoalPackageStore,
      reconciler: {
        interruptRuns: () => undefined,
        liveWorkIds: () => new Set<string>(),
        async reconcileGoal() {
          dispatched.push(goalId)
          return { kind: 'wait' as const, decision: { kind: 'wait' as const, reasons: [] } }
        },
      } as ProjectReconciler,
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [project('P-1', 'G-1'), project('P-2', 'G-2', true)],
    })

    const tick = coordinator.reconcileOnce()
    await secondScan
    coordinator.protectAssistantGoal('EV-late-effect', 'P-1', 'G-1')
    releaseSecondScan?.()

    expect(await tick).toEqual({ kind: 'passes_started', count: 1 })
    await coordinator.waitForIdle()
    expect(dispatched).toEqual(['G-2'])
    coordinator.settleAssistantTurn('EV-late-effect')
  })

  test('records one terminal Assistant failure on the original event without retrying', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Unsafe ambiguity.' })
    let calls = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process() {
          calls += 1
          throw new Error('conversation process failed')
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    const workspace = await fixture.workspace.readWorkspace()

    expect(calls).toBe(1)
    expect(workspace.attentions.size).toBe(0)
    expect(workspace.events.get('EV-1')?.attributes).toMatchObject({
      status: 'handled',
      disposition: 'operational-failed',
      reply: 'Assistant unavailable: conversation process failed',
    })
  })

  test('keeps a failed internal Assistant wake pending and resumes it after restart', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-reflection-failed',
      content: 'Surface one current-state assessment.',
    })
    let calls = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process() {
          calls += 1
          throw new Error('speaking transport failed')
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    await coordinator.reconcileOnce()
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toMatchObject({
      kind: 'idle',
      nextWakeAt: expect.any(Number),
    })
    const workspace = await fixture.workspace.readWorkspace()
    const event = workspace.events.get('EV-reflection-failed')

    expect(calls).toBe(1)
    expect(event?.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'internal',
      status: 'pending',
    })
    expect(workspace.attentions.size).toBe(0)

    const restarted = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          calls += 1
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Recovered after restart.',
            disposition: 'notified',
            expose: true,
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      attentions: fixture.attentions,
      projects: [],
    })

    expect(await restarted.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    await restarted.waitForIdle()
    expect(calls).toBe(2)
    expect(
      (await fixture.workspace.readWorkspace()).events.get('EV-reflection-failed')?.attributes,
    ).toMatchObject({
      status: 'handled',
      disposition: 'notified',
      reply: 'Recovered after restart.',
    })
  })

  test('does not let an Attention suppress a public turn or the following wake observation', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveEvent({ eventId: 'EV-blocked', content: 'Blocked turn.' })
    await fixture.attentions.ensureEventAttention('EV-blocked', 'Assistant transport failed.')
    const observations: boolean[] = []
    const reflection = {
      async observe(input) {
        observations.push(input.settled)
        return 'running' as const
      },
      acknowledgeProjects: async () => undefined,
      isActive: () => false,
      listRuns: async () => [],
      listRunSummaries: async () => [],
      readRunEvents: async () => null,
      waitForIdle: async () => undefined,
      stop: async () => undefined,
    } satisfies AssistantReflection
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Processed with Attention still open.',
            disposition: 'answered',
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      reflection,
      attentions: fixture.attentions,
      projects: [],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(observations).toEqual([true])
  })

  test('does not let an Attention suppress an internal turn or the following wake observation', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal',
      content: 'Revalidate one Attention.',
    })
    await fixture.attentions.ensureEventAttention('EV-internal', 'Assistant transport failed.')
    const observations: boolean[] = []
    const reflection = {
      async observe(input) {
        observations.push(input.settled)
        return 'running' as const
      },
      acknowledgeProjects: async () => undefined,
      isActive: () => false,
      listRuns: async () => [],
      listRunSummaries: async () => [],
      readRunEvents: async () => null,
      waitForIdle: async () => undefined,
      stop: async () => undefined,
    } satisfies AssistantReflection
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Internal state assessed.',
            disposition: 'notified',
            expose: true,
          })
          return { kind: 'answered' as const, eventId }
        },
      },
      reflection,
      attentions: fixture.attentions,
      projects: [],
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(observations).toEqual([true])
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

  test('enforces each configured responsibility capacity globally across Projects and Goals', async () => {
    const fixture = await workspaceFixture()
    for (const responsibility of ['planner', 'generator', 'reviewer'] as const) {
      const packages = new Map(
        ['G-1', 'G-2', 'G-3', 'G-4'].map((goalId) => [
          goalId,
          responsibilityPackage(goalId, responsibility),
        ]),
      )
      const pending = new Map<string, () => void>()
      const storeFor = (goalIds: string[]) =>
        ({
          listGoalIds: async () => goalIds,
          readPackage: async (goalId: string) => requirePackage(packages, goalId),
        }) as unknown as GoalPackageStore
      const reconciler = {
        interruptRuns: () => undefined,
        liveWorkIds: () => new Set<string>(),
        reconcileGoal(goalId: string) {
          return new Promise((resolve) => {
            pending.set(goalId, () => {
              const goalPackage = requirePackage(packages, goalId)
              const work = [...goalPackage.works.values()][0]
              if (!work) throw new Error(`Missing Work for ${goalId}`)
              work.attributes.stage = 'done'
              goalPackage.goal.attributes.lifecycle = 'paused'
              resolve({
                kind: 'pass_finished',
                workId: work.attributes.id,
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
        projects: [
          { projectId: 'P-1', store: storeFor(['G-1', 'G-2']), reconciler },
          { projectId: 'P-2', store: storeFor(['G-3', 'G-4']), reconciler },
        ],
      })

      expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 3 })
      expect([...pending.keys()]).toEqual(['G-1', 'G-2', 'G-3'])
      expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })

      pending.get('G-1')?.()
      await Bun.sleep(0)
      expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
      pending.get('G-2')?.()
      pending.get('G-3')?.()
      pending.get('G-4')?.()
      await coordinator.waitForIdle()
    }
  })

  test('fills Generator capacity with independent Work from the same Goal', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    const firstWork = goalPackage.works.get('W-1')
    if (!firstWork) throw new Error('Missing first Work')
    goalPackage.works = new Map([
      ...goalPackage.works,
      [
        'W-2',
        {
          attributes: {
            ...firstWork.attributes,
            id: 'W-2',
            title: 'Build independently',
          },
          body: 'Build independently.\n',
        } satisfies WorkDocument,
      ],
    ])
    const live = new Set<string>()
    const finish = new Map<string, () => void>()
    const reconciler = {
      interruptRuns: () => undefined,
      liveWorkIds: () => new Set([...live].map((workId) => `G-1/${workId}`)),
      reconcileGoal() {
        const work = [...goalPackage.works.values()].find(
          (candidate) =>
            candidate.attributes.stage === 'generate' && !live.has(candidate.attributes.id),
        )
        if (!work) throw new Error('Missing ready Work')
        const workId = work.attributes.id
        live.add(workId)
        return new Promise((resolve) => {
          finish.set(workId, () => {
            work.attributes.stage = 'done'
            live.delete(workId)
            resolve({
              kind: 'pass_finished',
              workId,
              runId: `run-${workId}`,
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
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => ['G-1'],
            readPackage: async () => goalPackage,
          } as unknown as GoalPackageStore,
          reconciler,
        },
      ],
    })

    coordinator.start()
    for (let attempt = 0; attempt < 100 && live.size < 2; attempt += 1) {
      await Bun.sleep(1)
    }
    expect([...live]).toEqual(['W-1', 'W-2'])

    const stopping = coordinator.stop()
    finish.get('W-1')?.()
    finish.get('W-2')?.()
    await stopping
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
      acknowledgeProjects: async () => undefined,
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
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('done')
    releaseOverlappingScan?.()
    expect(await overlappingTick).toEqual({ kind: 'idle' })
    expect(observations).toEqual([false, false])

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(observations).toEqual([false, false, true])
  })

  test('revokes only the paused Goal reservation', async () => {
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
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })

    requirePackage(packages, 'G-2').goal.attributes.lifecycle = 'paused'
    finish.get('G-2')?.()
    await coordinator.waitForIdle()
  })

  test('admits same-revision Planning independently from live Engineering', async () => {
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
    const inFlight = new Set<Responsibility>()
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
          inFlight.add('generator')
          await engineeringRun
          const engineering = goalPackage.works.get('W-1')
          if (!engineering) throw new Error('Missing Engineering Work')
          engineering.attributes.stage = 'review'
          inFlight.delete('generator')
          return {
            kind: 'pass_finished' as const,
            workId: 'W-1',
            runId: 'R-engineering',
            result: 'success',
            application: 'published',
          }
        }
        inFlight.add('planner')
        await planningRun
        const planning = goalPackage.works.get('plan-0002')
        if (!planning) throw new Error('Missing Planning Work')
        planning.attributes.stage = 'done'
        goalPackage.goal.attributes.lifecycle = 'paused'
        inFlight.delete('planner')
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
    expect([...inFlight]).toEqual(['generator'])
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
      },
      body: 'Plan the concurrent instruction.\n',
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    expect(dispatchCount).toBe(2)
    expect([...inFlight].toSorted()).toEqual(['generator', 'planner'])

    finishEngineering?.()
    await Bun.sleep(0)
    expect([...inFlight]).toEqual(['planner'])

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

  test('stops after an in-flight deterministic action without leaving a wake pending', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    goalPackage.works = new Map()
    let markActionStarted: (() => void) | undefined
    const actionStarted = new Promise<void>((resolve) => {
      markActionStarted = resolve
    })
    let finishAction: (() => void) | undefined
    const actionGate = new Promise<void>((resolve) => {
      finishAction = resolve
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            readReconciliationSnapshot: async () => new Map([['G-1', goalPackage]]),
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              markActionStarted?.()
              await actionGate
              return {
                kind: 'pass_finished' as const,
                workId: 'plan-initial',
                runId: 'R-1',
                result: 'success' as const,
                application: 'published' as const,
              }
            },
          },
        },
      ],
    })

    coordinator.start()
    await actionStarted
    const stopping = coordinator.stop()
    finishAction?.()

    await stopping
  })

  test('turns a failed deterministic Goal action into a Project system event', async () => {
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
    expect(workspace.attentions.size).toBe(0)
    expect(
      [...workspace.events.values()].some(
        (event) =>
          event.attributes.source === 'system' &&
          event.body.includes('invalid completion structure'),
      ),
    ).toBe(true)
  })

  test('fails one project closed and records canonical validation as a system event', async () => {
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
    expect(workspace.attentions.size).toBe(0)
    expect(
      [...workspace.events.values()].some(
        (event) =>
          event.attributes.source === 'system' && event.body.includes('goal.md is invalid'),
      ),
    ).toBe(true)
  })

  test('records a fresh system event when explicit recovery reaches the same execution fault', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    const original = await fixture.attentions.ensureProjectAttention(
      'P-1',
      'The Project failed its first execution boundary.',
    )
    const goalPackage = planningPackage('G-1')
    let dispatches = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => ['G-1'],
            readPackage: async () => goalPackage,
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              dispatches += 1
              return {
                kind: 'project_blocked' as const,
                reason: 'The repaired Project still fails C1 publication.',
              }
            },
          },
        },
      ],
    })
    coordinator.setProjectEligible('P-1', false)

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    await fixture.workspace.resolveAttention(
      original.attributes.id,
      'Assistant judged the repair sufficient.',
    )
    coordinator.setProjectEligible('P-1', true)

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'passes_started', count: 1 })
    await coordinator.waitForIdle()
    const workspace = await fixture.workspace.readWorkspace()
    const failureEvents = [...workspace.events.values()].filter(
      (event) =>
        event.attributes.source === 'system' &&
        event.body.includes('The repaired Project still fails C1 publication.'),
    )

    expect(dispatches).toBe(1)
    expect(workspace.attentions.get(original.attributes.id)?.attributes.resolvedAt).not.toBeNull()
    expect(failureEvents).toHaveLength(1)
  })

  test('keeps Project Attention open until an Agent explicitly resolves it', async () => {
    const fixture = await workspaceFixture()
    await Bun.write(
      fixture.home.paths.projectLinksPath,
      'version: 1\nprojects:\n  - projectId: P-1\n    repoPath: /tmp/project-one\n',
    )
    const attention = await fixture.attentions.ensureProjectAttention(
      'P-1',
      'Delivery checkout is not ready.',
    )
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            listGoalIds: async () => [],
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
          } as unknown as ProjectReconciler,
        },
      ],
    })
    coordinator.setProjectEligible('P-1', false)

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(
      (await fixture.workspace.readWorkspace()).attentions.get(attention.attributes.id)?.attributes
        .resolvedAt,
    ).toBeNull()

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(
      (await fixture.workspace.readWorkspace()).attentions.get(attention.attributes.id)?.attributes
        .resolvedAt,
    ).toBeNull()
  })

  test('does not rescan an idle Project until another edge arrives', async () => {
    const fixture = await workspaceFixture()
    let scans = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            async readReconciliationSnapshot() {
              scans += 1
              return new Map()
            },
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
          } as unknown as ProjectReconciler,
        },
      ],
    })

    coordinator.start()
    await coordinator.waitForIdle()
    const idleScans = scans
    await Bun.sleep(50)
    expect(scans).toBe(idleScans)

    coordinator.wake()
    await coordinator.waitForIdle()
    expect(scans).toBe(idleScans + 1)
    await coordinator.stop()
  })

  test('wakes once when Work notBefore becomes ready', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    const work = goalPackage.works.get('W-1')
    if (!work) throw new Error('Missing Engineering Work')
    work.attributes.notBefore = new Date(Date.now() + 60).toISOString()
    let dispatches = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      projects: [
        {
          projectId: 'P-1',
          store: {
            readReconciliationSnapshot: async () => new Map([['G-1', goalPackage]]),
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
            async reconcileGoal() {
              dispatches += 1
              goalPackage.goal.attributes.lifecycle = 'paused'
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

    coordinator.start()
    await coordinator.waitForIdle()
    expect(dispatches).toBe(0)
    await waitUntil(() => dispatches === 1)
    await coordinator.waitForIdle()
    expect(dispatches).toBe(1)
    await coordinator.stop()
  })

  test('wakes once when a Goal Attention revisit becomes due', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    goalPackage.goal.attributes.lifecycle = 'paused'
    const revisitAt = new Date(Date.now() + 60).toISOString()
    ;(goalPackage.attentions as Map<string, AttentionDocument>).set('A-revisit', {
      attributes: {
        id: 'A-revisit',
        target: 'project:P-1/goal:G-1/work:W-1',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        notifiedAt: null,
        operatorRequest: null,
        revisitAt,
      },
      body: 'Recheck the external condition.\n',
    })
    const observations: boolean[] = []
    const reflection = {
      async observe(input) {
        observations.push(input.settled)
        return 'unchanged' as const
      },
      acknowledgeProjects: async () => undefined,
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
            readReconciliationSnapshot: async () => new Map([['G-1', goalPackage]]),
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
          } as unknown as ProjectReconciler,
        },
      ],
    })

    coordinator.start()
    await coordinator.waitForIdle()
    expect(observations).toEqual([true])
    await waitUntil(() => observations.length === 2)
    await coordinator.waitForIdle()
    expect(observations).toEqual([true, true])
    await coordinator.stop()
  })

  test('wakes at the delivery retry deadline without periodic Project scans', async () => {
    const fixture = await workspaceFixture()
    const retryAt = Date.now() + 60
    let delivered = false
    let deliveryCalls = 0
    let scans = 0
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered' as const, eventId }) },
      attentions: fixture.attentions,
      delivery: {
        async deliverOnce() {
          deliveryCalls += 1
          if (!delivered && Date.now() >= retryAt) {
            delivered = true
            return 1
          }
          return 0
        },
        nextAttemptAt() {
          return delivered ? null : retryAt
        },
      },
      projects: [
        {
          projectId: 'P-1',
          store: {
            async readReconciliationSnapshot() {
              scans += 1
              return new Map()
            },
          } as unknown as GoalPackageStore,
          reconciler: {
            interruptRuns: () => undefined,
            liveWorkIds: () => new Set<string>(),
          } as unknown as ProjectReconciler,
        },
      ],
    })

    coordinator.start()
    await coordinator.waitForIdle()
    const initialScans = scans
    expect(deliveryCalls).toBe(1)
    await waitUntil(() => delivered)
    await coordinator.waitForIdle()
    expect(scans).toBeGreaterThan(initialScans)
    expect(deliveryCalls).toBeGreaterThanOrEqual(2)
    await coordinator.stop()
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

function planningPackage(goalId: string): GoalPackage {
  const goalPackage = engineeringPackage(goalId)
  goalPackage.works = new Map([
    [
      'plan-initial',
      {
        attributes: {
          id: 'plan-initial',
          title: 'Plan',
          kind: 'planning',
          stage: 'plan',
          notBefore: null,
          dependsOn: [],
          contractRevision: 1,
          evidenceRefs: [],
        },
        body: 'Plan.\n',
      },
    ],
  ])
  return goalPackage
}

function responsibilityPackage(
  goalId: string,
  responsibility: 'planner' | 'generator' | 'reviewer',
) {
  if (responsibility === 'planner') return planningPackage(goalId)
  const goalPackage = engineeringPackage(goalId)
  if (responsibility === 'reviewer') {
    const work = goalPackage.works.get('W-1')
    if (!work) throw new Error(`Missing Work for ${goalId}`)
    work.attributes.stage = 'review'
  }
  return goalPackage
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for Coordinator state')
}
