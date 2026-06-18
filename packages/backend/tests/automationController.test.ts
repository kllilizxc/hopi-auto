import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AutomationController } from '../src/runtime/automationController'
import { createExecutionStateStore } from '../src/runtime/executionStateStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'automation-controller')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('AutomationController', () => {
  test('runs one worker per default lane slot', async () => {
    const automation = new AutomationController(
      createExecutionStateStore(join(tmpBase, crypto.randomUUID())),
    )
    let activeCount = 0
    let maxObservedActiveCount = 0
    let releaseSteps!: () => void
    let resolveFiveActive!: () => void
    const fiveActive = new Promise<void>((resolve) => {
      resolveFiveActive = resolve
    })
    const stepsReleased = new Promise<void>((resolve) => {
      releaseSteps = resolve
    })

    const started = await automation.start({
      projectKey: 'project-1',
      goalKey: 'goal-1',
      executeStep: async () => {
        activeCount += 1
        maxObservedActiveCount = Math.max(maxObservedActiveCount, activeCount)
        if (activeCount === 5) {
          resolveFiveActive()
        }
        await stepsReleased
        activeCount -= 1
        return { kind: 'idle' }
      },
    })

    expect(started.status.maxParallel).toBe(5)
    expect(started.status.laneParallelism).toEqual({
      in_progress: 3,
      in_review: 1,
      merging: 1,
    })
    await fiveActive
    expect(maxObservedActiveCount).toBe(5)

    releaseSteps()
    await waitFor(async () => (await automation.getStatus('project-1', 'goal-1')).state === 'idle')
    expect(await automation.getStatus('project-1', 'goal-1')).toMatchObject({
      state: 'idle',
      stepCount: 5,
      maxParallel: 5,
      laneParallelism: {
        in_progress: 3,
        in_review: 1,
        merging: 1,
      },
      reconcileEnabled: false,
    })
  })

  test('continues into another reconcile round after one worker advances and others idle', async () => {
    const automation = new AutomationController(
      createExecutionStateStore(join(tmpBase, crypto.randomUUID())),
    )
    let callCount = 0
    let releaseAdvancedStep!: () => void
    const advancedStepReleased = new Promise<void>((resolve) => {
      releaseAdvancedStep = resolve
    })

    await automation.start({
      projectKey: 'project-2',
      goalKey: 'goal-2',
      executeStep: async () => {
        callCount += 1
        if (callCount === 1) {
          await advancedStepReleased
          return {
            kind: 'advanced',
            taskRef: 'T-1',
            from: 'planned',
            to: 'in_review',
          } as const
        }

        if (callCount <= 5) {
          return { kind: 'idle' } as const
        }

        return { kind: 'idle' } as const
      },
    })

    releaseAdvancedStep()
    await waitFor(async () => (await automation.getStatus('project-2', 'goal-2')).state === 'idle')

    const status = await automation.getStatus('project-2', 'goal-2')
    expect(status.stepCount).toBeGreaterThan(5)
    expect(status.lastResult).toEqual({ kind: 'idle' })
    expect(status.reconcileEnabled).toBe(false)
  })

  test('stop pauses future reconcile steps without cancelling the current in-flight session', async () => {
    const automation = new AutomationController(
      createExecutionStateStore(join(tmpBase, crypto.randomUUID())),
    )
    let releaseFirstStep!: () => void
    let resolveFirstStepStarted!: () => void
    const firstStepStarted = new Promise<void>((resolve) => {
      resolveFirstStepStarted = resolve
    })
    const firstStepReleased = new Promise<void>((resolve) => {
      releaseFirstStep = resolve
    })
    let callCount = 0

    await automation.start({
      projectKey: 'project-3',
      goalKey: 'goal-3',
      maxParallel: 1,
      executeStep: async () => {
        callCount += 1
        if (callCount === 1) {
          resolveFirstStepStarted()
          await firstStepReleased
          return {
            kind: 'advanced',
            taskRef: 'T-1',
            from: 'planned',
            to: 'in_review',
          } as const
        }

        return { kind: 'idle' } as const
      },
    })

    await firstStepStarted
    const stopped = await automation.stop('project-3', 'goal-3')
    expect(stopped.state).toBe('running')
    expect(stopped.reconcileEnabled).toBe(false)

    releaseFirstStep()
    await waitFor(async () => (await automation.getStatus('project-3', 'goal-3')).state === 'idle')

    const status = await automation.getStatus('project-3', 'goal-3')
    expect(status.stepCount).toBe(3)
    expect(status.lastResult).toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })
    expect(status.reconcileEnabled).toBe(false)
  })

  test('start re-enables reconcile while a paused run is still draining', async () => {
    const automation = new AutomationController(
      createExecutionStateStore(join(tmpBase, crypto.randomUUID())),
    )
    let releaseFirstStep!: () => void
    let resolveFirstStepStarted!: () => void
    const firstStepStarted = new Promise<void>((resolve) => {
      resolveFirstStepStarted = resolve
    })
    const firstStepReleased = new Promise<void>((resolve) => {
      releaseFirstStep = resolve
    })
    let callCount = 0

    await automation.start({
      projectKey: 'project-4',
      goalKey: 'goal-4',
      maxParallel: 1,
      executeStep: async () => {
        callCount += 1
        if (callCount === 1) {
          resolveFirstStepStarted()
          await firstStepReleased
          return {
            kind: 'advanced',
            taskRef: 'T-1',
            from: 'planned',
            to: 'in_review',
          } as const
        }

        return { kind: 'idle' } as const
      },
    })

    await firstStepStarted
    await automation.stop('project-4', 'goal-4')
    const resumed = await automation.start({
      projectKey: 'project-4',
      goalKey: 'goal-4',
      maxParallel: 1,
      executeStep: async () => {
        callCount += 1
        if (callCount === 1) {
          await firstStepReleased
          return {
            kind: 'advanced',
            taskRef: 'T-1',
            from: 'planned',
            to: 'in_review',
          } as const
        }

        return { kind: 'idle' } as const
      },
    })

    expect(resumed.alreadyRunning).toBe(true)
    expect(resumed.status.reconcileEnabled).toBe(true)

    releaseFirstStep()
    await waitFor(async () => (await automation.getStatus('project-4', 'goal-4')).state === 'idle')

    const status = await automation.getStatus('project-4', 'goal-4')
    expect(status.stepCount).toBeGreaterThan(3)
    expect(status.lastResult).toEqual({ kind: 'idle' })
    expect(status.reconcileEnabled).toBe(false)
  })
})

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  const startedAt = Date.now()
  while (!(await predicate())) {
    if (Date.now() - startedAt > 1000) {
      throw new Error('Timed out waiting for predicate')
    }
    await Bun.sleep(10)
  }
}
