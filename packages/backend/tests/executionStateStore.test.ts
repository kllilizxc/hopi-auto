import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createExecutionStateStore,
  type DurableAutomationStatus,
  createWorkerLeaseStore,
} from '../src/runtime/executionStateStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'execution-state-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('ExecutionStateStore', () => {
  test('fresh start resets automation safety counters after a completed run', async () => {
    const rootDir = join(tmpBase, crypto.randomUUID())
    const store = createExecutionStateStore(rootDir)

    await store.startAutomation('project-1', 'goal-reset', { maxSteps: 1 })
    const firstClaim = await store.recordAutomationWorkerClaim('project-1', 'goal-reset')
    expect(firstClaim).not.toBeNull()
    await store.recordAutomationResult('project-1', 'goal-reset', {
      kind: 'blocked',
      taskRef: 'E-1',
      blocker: { kind: 'intervention', ref: 'E-1:reviewer_rejected' },
    })
    await store.completeAutomation('project-1', 'goal-reset', { state: 'blocked' })

    const restarted = await store.startAutomation('project-1', 'goal-reset', { maxSteps: 1 })
    expect(restarted.alreadyRunning).toBe(false)
    expect(restarted.status.state).toBe('running')
    expect(restarted.status.stepCount).toBe(0)
    expect(restarted.status.lastResult).toBeUndefined()

    const secondClaim = await store.recordAutomationWorkerClaim('project-1', 'goal-reset')
    expect(secondClaim).not.toBeNull()
  })

  test('resumeAutomation is idempotent while automation is already running', async () => {
    const rootDir = join(tmpBase, crypto.randomUUID())
    const automationChanges: DurableAutomationStatus[] = []
    const store = createExecutionStateStore(rootDir, {
      onAutomationChanged(_goalKey, status) {
        automationChanges.push(status)
      },
    })

    const started = await store.startAutomation('project-1', 'goal-running', { maxSteps: 3 })
    expect(automationChanges).toHaveLength(1)

    await Bun.sleep(5)

    const resumed = await store.resumeAutomation('project-1', 'goal-running')
    expect(resumed).not.toBeNull()
    expect(resumed?.state).toBe('running')
    expect(resumed?.updatedAt).toBe(started.status.updatedAt)
    expect(automationChanges).toHaveLength(1)
  })

  test('prevents redispatch while a task still has an open execution step', async () => {
    const rootDir = join(tmpBase, crypto.randomUUID())
    const store = createExecutionStateStore(rootDir)

    const first = await store.acquireTaskExecution({
      goalKey: 'goal-1',
      taskRef: 'E-1',
      taskKind: 'engineering',
      role: 'generator',
      lane: 'in_progress',
      statusBefore: 'in_progress',
      workerId: 'worker-1',
      laneLimit: 3,
    })

    expect(first).not.toBeNull()

    const second = await store.acquireTaskExecution({
      goalKey: 'goal-1',
      taskRef: 'E-1',
      taskKind: 'engineering',
      role: 'generator',
      lane: 'in_progress',
      statusBefore: 'in_progress',
      workerId: 'worker-1',
      laneLimit: 3,
    })

    expect(second).toBeNull()
    expect(await store.listActiveTaskExecutions('goal-1')).toHaveLength(1)
  })

  test('recovers stale task executions when the owning worker is gone', async () => {
    const rootDir = join(tmpBase, crypto.randomUUID())
    const store = createExecutionStateStore(rootDir)
    const workers = createWorkerLeaseStore(rootDir)

    const lease = await store.acquireTaskExecution({
      goalKey: 'goal-2',
      taskRef: 'E-2',
      taskKind: 'engineering',
      role: 'generator',
      lane: 'in_progress',
      statusBefore: 'in_progress',
      workerId: 'worker-missing',
      laneLimit: 3,
    })

    expect(lease).not.toBeNull()
    await workers.heartbeat('worker-live')

    const recovered = await store.recoverStaleTaskExecutions({
      goalKey: 'goal-2',
      activeWorkerIds: new Set(['worker-live']),
      stepStaleMs: 45_000,
    })

    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.taskRef).toBe('E-2')
    expect(await store.listActiveTaskExecutions('goal-2')).toHaveLength(0)
  })
})
