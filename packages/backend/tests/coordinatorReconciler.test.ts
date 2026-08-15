import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AssistantWake,
  WakeObservation,
  WakeObserveResult,
} from '../src/assistant/assistantWake'
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
  test('starts only an explicitly queued Run', async () => {
    const fixture = await workspaceFixture()
    const goalPackage = engineeringPackage('G-1')
    let queued = false
    let runs = 0
    const reconciler = projectReconciler({
      async decisionWhenEligible(): Promise<ReconcileDecision> {
        return queued
          ? { kind: 'dispatch', workId: 'W-1' }
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
      concurrency: 1,
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(runs).toBe(0)

    queued = true
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await coordinator.waitForIdle()
    expect(runs).toBe(1)
    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'idle' })
    expect(
      fixture.wakeObservations.some((observation) =>
        observation.settledScopeKeys.includes('project:P-1'),
      ),
    ).toBe(true)
  })

  test('enforces one shared Worker capacity across Projects', async () => {
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
          : { kind: 'dispatch', workId: 'W-1' }
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
      concurrency: 2,
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
          ? { kind: 'dispatch', workId: 'W-1' }
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
            reply: 'Requesting an explicit read-only review Run.',
            disposition: 'tool:run',
          })
          assistantFinished = true
          return { kind: 'answered', eventId }
        },
      },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOf(goalPackage), reconciler }],
      concurrency: 1,
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
          return { kind: 'dispatch', workId: 'W-1' }
        }
        if (goalId === 'G-2' && firstSettled) {
          return { kind: 'dispatch', workId: 'W-1' }
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
      order.push(`wake:${observation.settledScopeKeys.includes('project:P-1')}`)
      return 'unchanged'
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [{ projectId: 'P-1', store: storeOfMap(packages), reconciler }],
      concurrency: 1,
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
      concurrency: 0,
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'deterministic_action', count: 1 })
    expect(cancellations).toBe(1)
  })

  test('keeps settlement observation local while sharing Worker capacity', async () => {
    const fixture = await workspaceFixture()
    let projectARuns = 0
    let projectBStarted = false
    let releaseProjectB: (() => void) | undefined
    const projectBGate = new Promise<void>((resolve) => {
      releaseProjectB = resolve
    })
    const projectA = projectReconciler({
      async decisionWhenEligible() {
        return projectARuns < 2
          ? { kind: 'dispatch', workId: `W-${projectARuns + 1}` }
          : { kind: 'wait', reasons: ['complete'] }
      },
      async reconcileGoal() {
        projectARuns += 1
        return {
          kind: 'run_settled',
          workId: `W-${projectARuns}`,
          runId: `R-A-${projectARuns}`,
          termination: 'normal',
        }
      },
    })
    const projectB = projectReconciler({
      async decisionWhenEligible() {
        return projectBStarted
          ? { kind: 'wait', reasons: ['run_active'] }
          : { kind: 'dispatch', workId: 'W-1' }
      },
      async reconcileGoal() {
        projectBStarted = true
        await projectBGate
        return {
          kind: 'run_settled',
          workId: 'W-1',
          runId: 'R-B-1',
          termination: 'normal',
        }
      },
    })
    fixture.setWakeObserve(async (observation) => {
      const scopeKey = observation.scopeKeys?.[0]
      if (!scopeKey) return 'unchanged'
      return observation.settledScopeKeys.includes(scopeKey) ? 'unchanged' : 'deferred'
    })
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: { process: async (eventId) => ({ kind: 'answered', eventId }) },
      wake: fixture.wake,
      projects: [
        {
          projectId: 'P-A',
          store: storeOf(engineeringPackage('G-A')),
          reconciler: projectA,
        },
        {
          projectId: 'P-B',
          store: storeOf(engineeringPackage('G-B')),
          reconciler: projectB,
        },
      ],
      concurrency: 2,
    })

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 2 })
    await Bun.sleep(0)
    expect(projectBStarted).toBe(true)
    expect(projectARuns).toBe(1)

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'runs_started', count: 1 })
    await Bun.sleep(0)
    expect(projectARuns).toBe(2)
    expect(
      fixture.wakeObservations.some(
        (observation) =>
          observation.scopeKeys?.[0] === 'project:P-A' &&
          observation.settledScopeKeys.includes('project:P-A'),
      ),
    ).toBe(true)

    releaseProjectB?.()
    await coordinator.waitForIdle()
  })

  test('keeps a direct command barrier local to its Project', async () => {
    const fixture = await workspaceFixture()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-A',
      content: 'Project A command follow-up.',
      context: { projectId: 'P-A', goalId: 'G-A' },
    })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-B',
      content: 'Project B remains independently runnable.',
      context: { projectId: 'P-B', goalId: 'G-B' },
    })
    let releaseDirectCommand: (() => void) | undefined
    const directCommandGate = new Promise<void>((resolve) => {
      releaseDirectCommand = resolve
    })
    const processed: string[] = []
    const coordinator = createCoordinatorReconciler({
      workspace: fixture.workspace,
      assistant: {
        async process(eventId) {
          processed.push(eventId)
          await fixture.workspace.handleEvent(eventId, {
            reply: 'Handled independently.',
            disposition: 'test',
          })
          return { kind: 'answered', eventId }
        },
      },
      wake: fixture.wake,
      projects: [
        {
          projectId: 'P-A',
          store: storeOf(engineeringPackage('G-A')),
          reconciler: projectReconciler({}),
        },
        {
          projectId: 'P-B',
          store: storeOf(engineeringPackage('G-B')),
          reconciler: projectReconciler({}),
        },
      ],
      concurrency: 1,
    })
    const directCommand = coordinator.runDirectAssistantCommand('P-A', () => directCommandGate)

    expect(await coordinator.reconcileOnce()).toEqual({ kind: 'assistant_started', count: 1 })
    await Bun.sleep(0)
    expect(processed).toEqual(['EV-B'])
    expect((await fixture.workspace.readEvent('EV-A'))?.attributes.status).toBe('pending')

    releaseDirectCommand?.()
    await directCommand
    await coordinator.waitForIdle()
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
        return { kind: 'dispatch', workId: 'W-1' }
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
      concurrency: 1,
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
        return { kind: 'dispatch', workId: 'W-1' }
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
          store: storeOf(decisionPackage('G-good')),
          reconciler: healthy,
        },
      ],
      concurrency: 1,
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
        projects: ['P-1', 'P-A', 'P-B', 'P-bad', 'P-good'].map((projectId) => ({
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
  let observeImpl: (input: WakeObservation) => Promise<WakeObserveResult> = async () => 'unchanged'
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
            status: 'open',
            createdAt: '2026-08-14T00:00:00.000Z',
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

function decisionPackage(goalId: string): GoalPackage {
  const goalPackage = engineeringPackage(goalId)
  goalPackage.works = new Map([
    [
      'W-decide',
      {
        attributes: {
          id: 'W-decide',
          title: 'Resolve the route',
          kind: 'decision',
          decisionType: 'research',
          status: 'open',
          createdAt: '2026-08-14T00:00:00.000Z',
          notBefore: null,
          dependsOn: [],
          contractRevision: 1,
          evidenceRefs: [],
          contextRefs: [],
          ownerMessages: [],
        },
        body: '## Question\n\nWhich route satisfies the Goal?\n',
      },
    ],
  ])
  return goalPackage
}
