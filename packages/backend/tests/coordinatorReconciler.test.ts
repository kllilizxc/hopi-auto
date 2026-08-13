import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantWake, WakeObservation } from '../src/assistant/assistantWake'
import type { GoalPackage } from '../src/domain/goalPackage'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createCoordinatorReconciler } from '../src/scheduler/coordinatorReconciler'
import type { ProjectReconciler } from '../src/scheduler/projectReconciler'
import type { ReconcileDecision } from '../src/scheduler/reconcileDecision'
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

describe('CoordinatorReconciler explicit scheduling', () => {
  test('does not dispatch from Work stage and starts only an explicit queued decision', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let queued = false
    let runs = 0
    const reconciler = projectReconciler({
      async decisionWhenEligible(): Promise<ReconcileDecision> {
        return queued
          ? { kind: 'dispatch', workId: 'W-1', responsibility: 'generator' }
          : { kind: 'wait', reasons: ['no_queued_run'] }
      },
      async reconcileGoal() {
        runs += 1
        queued = false
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: 'R-1',
          termination: 'normal',
        }
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOf(goalPackage), reconciler }],
      concurrency: { planner: 1, generator: 1, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(runs).toBe(0)

    queued = true
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(runs).toBe(1)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(fixture.wakeObservations.some((observation) => observation.settled)).toBe(true)
  })

  test('enforces profile capacity across Projects without deriving profiles from lanes', async () => {
    const fixture = await workspaceFixture()
    const packages = new Map(
      ['G-1', 'G-2', 'G-3'].map((goalId) => [goalId, engineeringPackage(goalId)] as const),
    )
    const started = new Set<string>()
    const pending = new Map<string, () => void>()
    const reconciler = projectReconciler({
      async decisionWhenEligible(goalId) {
        return started.has(goalId)
          ? { kind: 'wait', reasons: ['run_active'] }
          : { kind: 'dispatch', workId: 'W-1', responsibility: 'generator' }
      },
      reconcileGoal(goalId) {
        started.add(goalId)
        return new Promise((resolve) => {
          pending.set(goalId, () => {
            resolve({
              kind: 'run_settled',
              workId: 'W-1',
              runId: `R-${goalId}`,
              termination: 'normal',
            })
          })
        })
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOfMap(packages), reconciler }],
      concurrency: { planner: 1, generator: 2, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 2 })
    expect([...pending.keys()]).toEqual(['G-1', 'G-2'])

    pending.get('G-1')?.()
    await Bun.sleep(0)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    expect([...pending.keys()]).toContain('G-3')

    pending.get('G-2')?.()
    pending.get('G-3')?.()
    await coordinator.waitForIdle()
  })

  test('processes a Project Assistant turn before dispatching that Project Run', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let assistantFinished = false
    let runStarted = false
    await fixture.workspace.receiveEvent({
      eventId: 'EV-1',
      content: 'Inspect the current Report and decide the next Run.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })
    const reconciler = projectReconciler({
      async decisionWhenEligible() {
        return assistantFinished
          ? { kind: 'dispatch', workId: 'W-1', responsibility: 'reviewer' }
          : { kind: 'wait', reasons: ['assistant_turn'] }
      },
      async reconcileGoal() {
        runStarted = true
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: 'R-review',
          termination: 'normal',
        }
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Requesting an explicit Reviewer Run.',
            disposition: 'tool:run',
          })
          assistantFinished = true
          return { kind: 'answered', eventId }
        },
      },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOf(goalPackage), reconciler }],
      concurrency: { planner: 1, generator: 1, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    expect(runStarted).toBe(false)
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(runStarted).toBe(true)
  })

  test('observes every Run settlement before admitting a later Run in that Project', async () => {
    const fixture = await workspaceFixture()
    const packages = new Map([
      ['G-1', engineeringPackage('G-1')],
      ['G-2', engineeringPackage('G-2')],
    ])
    const order: string[] = []
    let firstSettled = false
    const reconciler = projectReconciler({
      async decisionWhenEligible(goalId) {
        if (goalId === 'G-1' && !firstSettled) {
          return { kind: 'dispatch', workId: 'W-1', responsibility: 'generator' }
        }
        if (goalId === 'G-2' && firstSettled) {
          return { kind: 'dispatch', workId: 'W-1', responsibility: 'reviewer' }
        }
        return { kind: 'wait', reasons: ['not_explicitly_queued'] }
      },
      async reconcileGoal(goalId) {
        order.push(`run:${goalId}`)
        if (goalId === 'G-1') firstSettled = true
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: `R-${goalId}`,
          termination: 'normal',
        }
      },
    })
    fixture.setWakeObserve(async (observation) => {
      order.push(`wake:${observation.settled}`)
      return 'unchanged'
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOfMap(packages), reconciler }],
      concurrency: { planner: 1, generator: 1, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(order.indexOf('wake:true')).toBeGreaterThan(order.indexOf('run:G-1'))
    expect(order.indexOf('run:G-2')).toBeGreaterThan(order.indexOf('wake:true'))
  })

  test('keeps cancellation deterministic and never converts it into a Run', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    goalPackage.goal.attributes.lifecycle = 'cancelled'
    let cancellations = 0
    const reconciler = projectReconciler({
      async decisionWhenEligible() {
        return { kind: 'finish_cancellation' }
      },
      async reconcileGoal() {
        cancellations += 1
        return { kind: 'cancellation_finished' }
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOf(goalPackage), reconciler }],
      concurrency: { planner: 0, generator: 0, reviewer: 0 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'deterministic_action', count: 1 })
    expect(cancellations).toBe(1)
  })

  test('quiesces a Project by interrupting and draining its active Run', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let releaseRun: (() => void) | undefined
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    let interruptions = 0
    const reconciler = projectReconciler({
      async decisionWhenEligible() {
        return { kind: 'dispatch', workId: 'W-1', responsibility: 'generator' }
      },
      interruptRuns() {
        interruptions += 1
        releaseRun?.()
      },
      async reconcileGoal() {
        await runGate
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: 'R-active',
          termination: 'interrupted',
        }
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOf(goalPackage), reconciler }],
      concurrency: { planner: 1, generator: 1, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.quiesceProject('P-1')
    expect(interruptions).toBeGreaterThan(0)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
  })

  test('fails one invalid Project closed without blocking a healthy Project', async () => {
    const fixture = await workspaceFixture()
    let healthyRuns = 0
    const healthy = projectReconciler({
      async decisionWhenEligible() {
        return { kind: 'dispatch', workId: 'W-1', responsibility: 'planner' }
      },
      async reconcileGoal() {
        healthyRuns += 1
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: 'R-healthy',
          termination: 'normal',
        }
      },
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [
        {
          projectId: 'P-bad',
          store: {
            async readReconciliationSnapshot() {
              throw new Error('invalid canonical Project')
            },
          } as unknown as GoalPackageStore,
          reconciler: projectReconciler({}),
        },
        {
          projectId: 'P-good',
          store: storeOf(planningPackage('G-good')),
          reconciler: healthy,
        },
      ],
      concurrency: { planner: 1, generator: 1, reviewer: 1 },
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(healthyRuns).toBe(1)
    expect(
      [...(await fixture.workspace.readWorkspace()).events.values()].some((event) =>
        event.body.includes('invalid canonical Project'),
      ),
    ).toBe(true)
  })
})

async function workspaceFixture() {
  const home = createAssistantHomeStore(temporaryRoot)
  await home.initialize()
  await Bun.write(
    home.paths.projectLinksPath,
    `${JSON.stringify(
      {
        projects: ['P-1', 'P-bad', 'P-good'].map((projectId) => ({
          projectId,
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', repoPath: `/tmp/${projectId}` }],
        })),
      },
      null,
      2,
    )}\n`,
  )
  const workspace = createAssistantWorkspaceStore(temporaryRoot, new PublicationCoordinator())
  const wakeObservations: WakeObservation[] = []
  let observeImpl: (input: WakeObservation) => Promise<'unchanged' | 'baseline'> = async () =>
    'unchanged'
  const wake: AssistantWake = {
    async observe(input) {
      wakeObservations.push(input)
      return observeImpl(input)
    },
    async acknowledgeProjects() {},
    isActive: () => false,
    async listRuns() {
      return []
    },
    async listRunSummaries() {
      return []
    },
    async readRunEvents() {
      return null
    },
    async waitForIdle() {},
    async stop() {},
  }
  return {
    workspace,
    wake,
    wakeObservations,
    setWakeObserve(implementation: typeof observeImpl) {
      observeImpl = implementation
    },
  }
}

function projectReconciler(overrides: Partial<ProjectReconciler>): ProjectReconciler {
  return {
    async reconcileGoal() {
      return { kind: 'wait', decision: { kind: 'wait', reasons: [] } }
    },
    async decisionWhenEligible() {
      return { kind: 'wait', reasons: ['no_queued_run'] }
    },
    liveWorkIds() {
      return new Set()
    },
    async checkpointInterruptedRun() {
      return []
    },
    async requestWorkRun() {
      throw new Error('Unexpected Run request in Coordinator fixture')
    },
    async completeWork() {
      throw new Error('Unexpected Work completion in Coordinator fixture')
    },
    async completeGoal() {
      throw new Error('Unexpected Goal completion in Coordinator fixture')
    },
    async interruptQueuedRuns() {
      return 0
    },
    interruptRuns() {},
    ...overrides,
  }
}

function storeOf(goalPackage: GoalPackage) {
  return storeOfMap(new Map([[goalPackage.goal.attributes.id, goalPackage]]))
}

function storeOfMap(goalPackages: ReadonlyMap<string, GoalPackage>) {
  return {
    async readReconciliationSnapshot() {
      return new Map(goalPackages)
    },
  } as unknown as GoalPackageStore
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
            contextRefs: [],
            ownerMessages: [],
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
          contextRefs: [],
          ownerMessages: [],
        },
        body: 'Plan.\n',
      },
    ],
  ])
  return goalPackage
}
