import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
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
    await recorder.finish({
      outcome: { result: 'success', summary: 'Implementation verified.', exitCode: 0 },
      application: 'published',
    })

    const attempts = await store.list('P-1', 'G-1', 'W-1')
    const detail = await store.read('P-1', 'G-1', 'W-1', 'R-1')

    expect(attempts).toHaveLength(1)
    expect(attempts[0]).toMatchObject({
      runId: 'R-1',
      status: 'finished',
      result: 'success',
      application: 'published',
    })
    expect(detail?.events.map((event) => event.kind)).toEqual([
      'message',
      'message',
      'transcript',
      'message',
    ])
    expect(detail?.events[2]).toMatchObject({
      entryKind: 'tool_call',
      toolName: 'exec_command',
      summary: 'bun test',
    })
    expect(detail?.runPrompt).toBe(
      '# Generator system prompt\n\nImplement the owning Work exactly.\n',
    )
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

  test('keeps pre-recorder Run directories visible as legacy Attempts', async () => {
    const root = legacyRunRoot('P-1', 'G-1', 'W-1', 'R-legacy')
    await mkdir(root, { recursive: true })
    await Bun.write(
      join(root, 'context.md'),
      '# HOPI Responsibility Context\n\n- Responsibility: reviewer\n',
    )
    await Bun.write(
      join(root, 'result.json'),
      `${JSON.stringify({ result: 'reject', summary: 'Visual regression.', artifacts: [] })}\n`,
    )
    const store = createRunAttemptStore(temporaryRoot)

    expect(await store.list('P-1', 'G-1', 'W-1')).toMatchObject([
      {
        runId: 'R-legacy',
        responsibility: 'reviewer',
        status: 'finished',
        result: 'reject',
        summary: 'Visual regression.',
      },
    ])
    expect((await store.read('P-1', 'G-1', 'W-1', 'R-legacy'))?.events).toEqual([])
    expect((await store.read('P-1', 'G-1', 'W-1', 'R-legacy'))?.runPrompt).toBeNull()
  })
})

function runRoot(runId: string) {
  return join(temporaryRoot, '.hopi', 'runtime', 'runs', runId)
}

function legacyRunRoot(projectId: string, goalId: string, workId: string, runId: string) {
  return join(temporaryRoot, '.hopi', 'runtime', 'runs', projectId, goalId, workId, runId)
}
