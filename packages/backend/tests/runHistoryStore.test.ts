import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'run-history-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createRunHistoryStore', () => {
  test('reads missing history as an empty goal history', async () => {
    const store = createRunHistoryStore(testRoot())

    await expect(store.readGoalHistory(goalKey)).resolves.toEqual({
      goalKey,
      runs: [],
    })
  })

  test('starts a new run when a task leaves planned', async () => {
    const store = createRunHistoryStore(testRoot())

    const started = await store.startStep({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })

    const history = await store.readGoalHistory(goalKey)
    expect(started.runId).toBeString()
    expect(started.stepId).toBeString()
    expect(history.runs).toHaveLength(1)
    expect(history.runs[0]).toMatchObject({
      runId: started.runId,
      taskRef: 'T-1',
      taskKind: 'engineering',
      status: 'active',
      steps: [
        {
          stepId: started.stepId,
          role: 'generator',
          statusBefore: 'planned',
          outcome: 'running',
          messages: [systemMessage('generator dispatched')],
        },
      ],
    })
  })

  test('appends reviewer and merger steps to the active run', async () => {
    const store = createRunHistoryStore(testRoot())

    const generated = await store.startStep({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: generated.runId,
      stepId: generated.stepId,
      statusAfter: 'in_review',
      outcome: 'success',
      message: systemMessage('generator succeeded'),
    })

    const reviewed = await store.startStep({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'reviewer',
      statusBefore: 'in_review',
      message: systemMessage('reviewer dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: reviewed.runId,
      stepId: reviewed.stepId,
      statusAfter: 'merging',
      outcome: 'success',
      message: systemMessage('reviewer accepted'),
    })

    const merged = await store.startStep({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'merger',
      statusBefore: 'merging',
      message: systemMessage('merger dispatched'),
    })

    const run = await store.readRun(goalKey, generated.runId)
    expect(reviewed.runId).toBe(generated.runId)
    expect(merged.runId).toBe(generated.runId)
    expect(run?.steps.map((step) => step.role)).toEqual(['generator', 'reviewer', 'merger'])
    expect(run?.steps.map((step) => step.statusBefore)).toEqual(['planned', 'in_review', 'merging'])
  })

  test('closes runs with terminal state and final messages', async () => {
    const store = createRunHistoryStore(testRoot())

    const started = await store.startStep({
      goalKey,
      taskRef: 'T-1',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })

    await store.finishStep({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      statusAfter: 'planned',
      outcome: 'reject',
      message: systemMessage('review returned task to planned'),
      runStatus: 'retryable',
    })

    const run = await store.readRun(goalKey, started.runId)
    expect(run).toMatchObject({
      runId: started.runId,
      taskRef: 'T-1',
      status: 'retryable',
      finalTaskStatus: 'planned',
      terminalOutcome: 'reject',
    })
    expect(run?.endedAt).toBeString()
    expect(run?.steps[0]).toMatchObject({
      stepId: started.stepId,
      statusAfter: 'planned',
      outcome: 'reject',
      messages: [
        systemMessage('generator dispatched'),
        systemMessage('review returned task to planned'),
      ],
    })
  })

  test('starts a fresh run when a stale active run no longer matches the current stage', async () => {
    const store = createRunHistoryStore(testRoot())

    const generated = await store.startStep({
      goalKey,
      taskRef: 'T-2',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: generated.runId,
      stepId: generated.stepId,
      statusAfter: 'in_review',
      outcome: 'success',
      message: systemMessage('generator succeeded'),
    })

    const reviewed = await store.startStep({
      goalKey,
      taskRef: 'T-2',
      taskKind: 'engineering',
      role: 'reviewer',
      statusBefore: 'in_review',
      message: systemMessage('reviewer dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: reviewed.runId,
      stepId: reviewed.stepId,
      statusAfter: 'merging',
      outcome: 'success',
      message: systemMessage('reviewer accepted'),
    })

    const merging = await store.startStep({
      goalKey,
      taskRef: 'T-2',
      taskKind: 'engineering',
      role: 'merger',
      statusBefore: 'merging',
      message: systemMessage('merger dispatched'),
    })

    const restarted = await store.startStep({
      goalKey,
      taskRef: 'T-2',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator restarted'),
    })

    expect(restarted.runId).not.toBe(generated.runId)

    const history = await store.readGoalHistory(goalKey)
    expect(history.runs).toHaveLength(2)
    expect(history.runs[0]).toMatchObject({
      runId: generated.runId,
      status: 'system_error',
      finalTaskStatus: 'merging',
      terminalOutcome: 'system_error',
      steps: [
        { role: 'generator', outcome: 'success' },
        { role: 'reviewer', outcome: 'success' },
        { stepId: merging.stepId, role: 'merger', outcome: 'system_error', statusAfter: 'merging' },
      ],
    })
    expect(history.runs[1]).toMatchObject({
      runId: restarted.runId,
      status: 'active',
      steps: [{ role: 'generator', outcome: 'running', statusBefore: 'planned' }],
    })
  })

  test('keeps merger retries inside the same active run while the task remains in merging', async () => {
    const store = createRunHistoryStore(testRoot())

    const generated = await store.startStep({
      goalKey,
      taskRef: 'T-3',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: generated.runId,
      stepId: generated.stepId,
      statusAfter: 'in_review',
      outcome: 'success',
      message: systemMessage('generator succeeded'),
    })

    const reviewed = await store.startStep({
      goalKey,
      taskRef: 'T-3',
      taskKind: 'engineering',
      role: 'reviewer',
      statusBefore: 'in_review',
      message: systemMessage('reviewer dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: reviewed.runId,
      stepId: reviewed.stepId,
      statusAfter: 'merging',
      outcome: 'success',
      message: systemMessage('reviewer accepted'),
    })

    const firstMerge = await store.startStep({
      goalKey,
      taskRef: 'T-3',
      taskKind: 'engineering',
      role: 'merger',
      statusBefore: 'merging',
      message: systemMessage('merger dispatched'),
    })
    await store.finishStep({
      goalKey,
      runId: firstMerge.runId,
      stepId: firstMerge.stepId,
      statusAfter: 'merging',
      outcome: 'merge_conflict',
      message: systemMessage('merge conflict: branch:task/T-3'),
    })

    const retryMerge = await store.startStep({
      goalKey,
      taskRef: 'T-3',
      taskKind: 'engineering',
      role: 'merger',
      statusBefore: 'merging',
      message: systemMessage('merger retried'),
    })

    expect(retryMerge.runId).toBe(generated.runId)

    const run = await store.readRun(goalKey, generated.runId)
    expect(run).toMatchObject({
      runId: generated.runId,
      status: 'active',
      steps: [
        { role: 'generator', outcome: 'success', statusAfter: 'in_review' },
        { role: 'reviewer', outcome: 'success', statusAfter: 'merging' },
        { role: 'merger', outcome: 'merge_conflict', statusAfter: 'merging' },
        { role: 'merger', outcome: 'running', statusBefore: 'merging' },
      ],
    })
  })

  test('records structured step evidence while a step is running', async () => {
    const store = createRunHistoryStore(testRoot())

    const started = await store.startStep({
      goalKey,
      taskRef: 'T-9',
      taskKind: 'engineering',
      role: 'generator',
      statusBefore: 'planned',
      message: systemMessage('generator dispatched'),
    })

    await store.recordStepEvent({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      event: {
        kind: 'worktree_prepared',
        path: '.hopi/worktrees/T-9',
        branch: 'task/T-9',
        baseBranch: 'main',
      },
    })
    await store.recordStepEvent({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      event: {
        kind: 'artifact',
        ref: 'patch:T-9',
        label: 'Generated patch',
      },
    })
    await store.recordStepEvent({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      event: {
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'assistant',
        summary: 'Implemented the patch for T-9',
        vendorEventType: 'item/completed',
      },
    })
    await store.recordStepEvent({
      goalKey,
      runId: started.runId,
      stepId: started.stepId,
      event: {
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: 'Created implementation patch',
      },
    })

    const run = await store.readRun(goalKey, started.runId)
    expect(run?.steps[0]).toMatchObject({
      execution: {
        worktree: {
          path: '.hopi/worktrees/T-9',
          branch: 'task/T-9',
          baseBranch: 'main',
        },
        artifacts: [{ ref: 'patch:T-9', label: 'Generated patch' }],
      },
      transcript: [
        {
          transport: 'codex',
          kind: 'assistant',
          summary: 'Implemented the patch for T-9',
          vendorEventType: 'item/completed',
        },
      ],
      messages: [
        systemMessage('generator dispatched'),
        {
          kind: 'info',
          role: 'generator',
          content: 'Created implementation patch',
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

function systemMessage(content: string) {
  return {
    kind: 'system' as const,
    role: 'system' as const,
    content,
  }
}
