import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'run-attempt-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('RunAttemptStore', () => {
  test('records one responsibility Attempt and its normalized live event stream', async () => {
    let tick = 0
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date(Date.UTC(2026, 6, 11, 0, 0, tick++)),
    })
    const recorder = await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      responsibility: 'generator',
      runRoot: runRoot('R-1'),
    })
    await Bun.write(
      join(runRoot('R-1'), 'prompt.md'),
      '# Generator system prompt\n\nImplement the owning Work exactly.\n',
    )
    await recorder.setExecution({
      transport: 'codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'xhigh',
    })
    await recorder.record({
      kind: 'message',
      level: 'info',
      role: 'generator',
      content: 'Implementing the owning Work.',
    })
    await recorder.record({
      kind: 'transcript',
      transport: 'codex',
      entryKind: 'tool_call',
      summary: 'bun test',
      toolName: 'exec_command',
      toolInvocationKey: 'call-1',
    })
    await recorder.record({
      kind: 'plan',
      transport: 'codex',
      planId: 'item-plan-1',
      status: 'active',
      items: [
        { text: 'Inspect the runtime', completed: true },
        { text: 'Implement the projection', completed: false },
      ],
      vendorEventType: 'item.updated',
    })
    expect((await store.snapshot()).running().map((attempt) => attempt.runId)).toEqual(['R-1'])
    await recorder.finish({
      outcome: {
        result: 'success',
        summary: 'Implementation verified.',
        exitCode: 0,
      },
      application: 'published',
    })
    expect((await store.snapshot()).running()).toEqual([])

    const attempts = await store.list('P-1', 'G-1', 'W-1')
    const detail = await store.read('P-1', 'G-1', 'W-1', 'R-1')

    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      runId: 'R-1',
      status: 'finished',
      result: 'success',
      application: 'published',
      execution: { transport: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' },
    })
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'message',
      'message',
      'transcript',
      'plan',
      'message',
    ])
    expect(detail?.events[2]).toMatchObject({
      entryKind: 'tool_call',
      toolName: 'exec_command',
      summary: 'bun test',
    })
    expect(detail?.events[3]).toMatchObject({
      kind: 'plan',
      planId: 'item-plan-1',
      status: 'active',
      items: [{ completed: true }, { completed: false }],
    })
    expect(detail?.runPrompt).toBe(
      '# Generator system prompt\n\nImplement the owning Work exactly.\n',
    )
  })

  test('groups real Attempt history for one Goal with a single runtime scan', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    for (const input of [
      { projectId: 'P-1', goalId: 'G-1', workId: 'W-1', runId: 'R-1' },
      { projectId: 'P-1', goalId: 'G-1', workId: 'W-2', runId: 'R-2' },
      { projectId: 'P-1', goalId: 'G-2', workId: 'W-1', runId: 'R-3' },
    ]) {
      await store.start({
        ...input,
        responsibility: 'generator',
        runRoot: runRoot(input.runId),
      })
    }

    const attemptsByWork = await store.listGoal('P-1', 'G-1')

    expect([...attemptsByWork.keys()].sort()).toEqual(['W-1', 'W-2'])
    expect(attemptsByWork.get('W-1')?.map((attempt) => attempt.runId)).toEqual(['R-1'])
    expect(attemptsByWork.get('W-2')?.map((attempt) => attempt.runId)).toEqual(['R-2'])
  })

  test('builds one immutable Attempt snapshot for many Work lookups', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    for (let index = 0; index < 96; index += 1) {
      const runId = `R-${index}`
      await store.start({
        projectId: 'P-1',
        goalId: index < 64 ? 'G-1' : 'G-2',
        workId: `W-${index % 16}`,
        runId,
        responsibility: 'generator',
        runRoot: runRoot(runId),
      })
    }

    const snapshot = await store.snapshot()
    expect(snapshot.listGoal('P-1', 'G-1').size).toBe(16)
    expect(snapshot.list('P-1', 'G-1', 'W-0')).toHaveLength(4)

    await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-0',
      runId: 'R-later',
      responsibility: 'generator',
      runRoot: runRoot('R-later'),
    })
    expect(snapshot.list('P-1', 'G-1', 'W-0')).toHaveLength(4)
    expect((await store.snapshot()).list('P-1', 'G-1', 'W-0')).toHaveLength(5)
  })

  test('advances the rebuildable index only after durable manifest transitions', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    expect(store.generation()).toBe(0)

    const recorder = await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-indexed',
      responsibility: 'generator',
      runRoot: runRoot('R-indexed'),
    })
    const running = await store.snapshot()
    expect(store.generation()).toBe(1)

    await recorder.setExecution({
      transport: 'codex',
      model: 'gpt-5.6',
      reasoningEffort: 'medium',
    })
    expect(store.generation()).toBe(2)
    expect((await store.snapshot()).list('P-1', 'G-1', 'W-1')[0]?.execution).toMatchObject({
      model: 'gpt-5.6',
    })

    await recorder.finish({
      outcome: { result: 'success', summary: 'Indexed.', exitCode: 0 },
      application: 'published',
    })
    expect(store.generation()).toBe(3)
    expect((await store.snapshot()).list('P-1', 'G-1', 'W-1')[0]?.status).toBe('finished')
    expect(running.list('P-1', 'G-1', 'W-1')[0]?.status).toBe('running')
  })

  test('marks a running Attempt interrupted when a new Coordinator starts', async () => {
    const first = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    await first.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-running',
      responsibility: 'planner',
      runRoot: runRoot('R-running'),
    })
    const restarted = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:01:00Z'),
    })

    expect(await restarted.interruptRunningAttempts()).toBe(1)
    expect(await restarted.read('P-1', 'G-1', 'W-1', 'R-running')).toMatchObject({
      status: 'interrupted',
      endedAt: '2026-07-11T00:01:00.000Z',
      summary: 'Coordinator stopped before recording an Attempt outcome.',
    })
  })

  test('isolates a corrupt Attempt manifest from healthy listing and restart recovery', async () => {
    const store = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-healthy',
      responsibility: 'generator',
      runRoot: runRoot('R-healthy'),
    })
    const corruptRoot = runRoot('R-corrupt')
    await mkdir(corruptRoot, { recursive: true })
    await Bun.write(join(corruptRoot, 'attempt.json'), '{not-json')

    expect((await store.snapshot()).running().map((attempt) => attempt.runId)).toEqual([
      'R-healthy',
    ])
    expect(await store.interruptRunningAttempts()).toBe(1)
    expect(await store.read('P-1', 'G-1', 'W-1', 'R-healthy')).toMatchObject({
      status: 'interrupted',
    })
  })

  test('keeps a queued Attempt durable across restart until it runs or is cancelled', async () => {
    const first = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    expect(
      await first.reserve({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-queued',
        responsibility: 'generator',
        workHash: 'a'.repeat(64),
      }),
    ).toEqual({ runId: 'R-queued', disposition: 'scheduled' })

    const restarted = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:01:00Z'),
    })
    expect(await restarted.interruptRunningAttempts()).toBe(0)
    expect(await restarted.list('P-1', 'G-1', 'W-1')).toMatchObject([
      {
        runId: 'R-queued',
        status: 'queued',
        requestedAt: '2026-07-11T00:00:00.000Z',
        startedAt: null,
      },
    ])
    expect(
      await restarted.interruptQueued({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
      }),
    ).toBe(1)
    expect(await restarted.list('P-1', 'G-1', 'W-1')).toMatchObject([
      { runId: 'R-queued', status: 'interrupted' },
    ])
  })

  test('lets only one dispatcher claim a queued Attempt', async () => {
    const store = createRunAttemptStore(temporaryRoot)
    await store.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-claim',
      responsibility: 'generator',
      workHash: 'b'.repeat(64),
    })
    const claims = await Promise.allSettled([
      store.start({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-claim',
        responsibility: 'generator',
        runRoot: runRoot('R-claim'),
        workHash: 'b'.repeat(64),
      }),
      store.start({
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        runId: 'R-claim',
        responsibility: 'generator',
        runRoot: runRoot('R-claim'),
        workHash: 'b'.repeat(64),
      }),
    ])
    expect(claims.filter((claim) => claim.status === 'fulfilled')).toHaveLength(1)
    expect(claims.filter((claim) => claim.status === 'rejected')).toHaveLength(1)
    const recorder = claims.find((claim) => claim.status === 'fulfilled')
    if (recorder?.status !== 'fulfilled') throw new Error('Expected one claimed Attempt')
    await recorder.value.interrupt('test complete')
  })

  test('fails an Attempt event write instead of silently losing its trace', async () => {
    const store = createRunAttemptStore(temporaryRoot)
    const recorder = await store.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-write-failure',
      responsibility: 'generator',
      runRoot: runRoot('R-write-failure'),
    })
    const eventsPath = join(runRoot('R-write-failure'), 'events.jsonl')
    await rm(eventsPath)
    await mkdir(eventsPath)

    await expect(
      recorder.record({
        kind: 'message',
        level: 'info',
        role: 'generator',
        content: 'This event must be durable.',
      }),
    ).rejects.toThrow()
  })

  test('does not close a recovered Attempt when its interruption event cannot be stored', async () => {
    const first = createRunAttemptStore(temporaryRoot)
    await first.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-recovery-write-failure',
      responsibility: 'generator',
      runRoot: runRoot('R-recovery-write-failure'),
    })
    const eventsPath = join(runRoot('R-recovery-write-failure'), 'events.jsonl')
    await rm(eventsPath)
    await mkdir(eventsPath)

    const restarted = createRunAttemptStore(temporaryRoot)
    await expect(restarted.interruptRunningAttempts()).rejects.toThrow()
    expect(await restarted.read('P-1', 'G-1', 'W-1', 'R-recovery-write-failure')).toMatchObject({
      status: 'running',
      endedAt: null,
    })
  })

  test('discards a torn event tail before restart recovery appends its interruption', async () => {
    const first = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    await first.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-torn',
      responsibility: 'generator',
      runRoot: runRoot('R-torn'),
    })
    const eventsPath = join(runRoot('R-torn'), 'events.jsonl')
    await appendFile(eventsPath, '{"eventId":"torn"\0\0')

    const restarted = createRunAttemptStore(temporaryRoot, {
      now: () => new Date('2026-07-11T00:01:00Z'),
    })
    expect(await restarted.interruptRunningAttempts()).toBe(1)

    const detail = await restarted.read('P-1', 'G-1', 'W-1', 'R-torn')
    expect(detail?.events).toHaveLength(2)
    expect(detail?.events.at(-1)).toMatchObject({
      kind: 'message',
      level: 'error',
      content: 'Coordinator stopped before recording an Attempt outcome.',
    })
    expect(await Bun.file(eventsPath).text()).not.toContain('\0')
  })
})

function runRoot(runId: string) {
  return join(temporaryRoot, '.hopi', 'runtime', 'runs', runId)
}
