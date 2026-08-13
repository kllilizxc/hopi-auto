import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-conversation-store')
const threadManifestPath = (threadId: string) =>
  join(temporaryRoot, '.hopi', 'runtime', 'assistant', 'threads', `${threadId}.json`)
const turnEventsPath = (eventId: string) =>
  join(temporaryRoot, '.hopi', 'runtime', 'assistant', 'turns', eventId, 'events.jsonl')
const projectReceiptPath = (projectId: string, receiptId: string) =>
  join(
    temporaryRoot,
    '.hopi',
    'runtime',
    'assistant',
    'receipts',
    'projects',
    projectId,
    `${receiptId}.json`,
  )

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('AssistantConversationStore Threads and Session Epochs', () => {
  test('stores isolated Thread sessions and durable Epoch facts', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await registerThread(store, 'T-A', 'EV-A')
    await registerThread(store, 'T-B', 'EV-B')
    await store.writeSession(
      { kind: 'thread', threadId: 'T-A' },
      { transport: 'opencode', sessionId: 'ses-1' },
      'contract-a',
      'runtime-a',
    )
    await store.writeSession(
      { kind: 'thread', threadId: 'T-B' },
      { transport: 'codex', sessionId: 'project-a' },
      'contract-a',
      'runtime-a',
    )
    expect(
      await store.readSession({ kind: 'thread', threadId: 'T-A' }, 'contract-a', 'runtime-a'),
    ).toEqual({
      transport: 'opencode',
      sessionId: 'ses-1',
    })
    expect(
      await store.readSession({ kind: 'thread', threadId: 'T-B' }, 'contract-a', 'runtime-a'),
    ).toEqual({ transport: 'codex', sessionId: 'project-a' })
    expect(await Bun.file(threadManifestPath('T-A')).exists()).toBe(true)
    expect(await store.readThread({ kind: 'thread', threadId: 'T-A' })).toMatchObject({
      threadId: 'T-A',
      origin: { eventId: 'EV-A' },
      eventIds: ['EV-A'],
      epochs: [{ epoch: 1, transport: 'opencode', sessionId: 'ses-1', endedAt: null }],
    })
  })

  test('isolates malformed Thread runtime metadata without affecting event truth', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    const path = threadManifestPath('T-broken')
    await mkdir(join(path, '..'), { recursive: true })
    await Bun.write(path, '{not-json')

    expect(await store.readSession({ kind: 'thread', threadId: 'T-broken' })).toBeNull()
    expect(await Bun.file(path).exists()).toBe(false)
  })

  test('rotates an incompatible Session while retaining its bounded handoff', async () => {
    const store = createAssistantConversationStore(temporaryRoot, {
      now: sequenceClock([
        '2026-07-28T00:00:00Z',
        '2026-07-28T00:01:00Z',
        '2026-07-28T00:02:00Z',
        '2026-07-28T00:03:00Z',
      ]),
    })
    const scope = { kind: 'thread', threadId: 'T-contract' } as const
    await registerThread(store, scope.threadId, 'EV-contract')
    await store.writeSession(scope, { transport: 'codex', sessionId: 'thread-old' }, 'contract-old')

    expect(await store.readSession(scope, 'contract-current')).toBeNull()
    expect(await store.readThread(scope)).toMatchObject({
      epochs: [
        {
          epoch: 1,
          sessionId: 'thread-old',
          closeReason: 'contract_changed',
          handoffMarkdown: expect.stringContaining('Continue from durable Thread events'),
        },
      ],
    })

    await store.writeSession(
      scope,
      { transport: 'codex', sessionId: 'thread-new' },
      'contract-current',
    )
    expect((await store.readThread(scope))?.epochs).toHaveLength(2)
    expect((await store.readThread(scope))?.epochs.at(-1)).toMatchObject({
      epoch: 2,
      sessionId: 'thread-new',
      endedAt: null,
    })
  })

  test('ignores only a concurrently appended unterminated event tail', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.begin('EV-live')
    await appendFile(turnEventsPath('EV-live'), '{"kind":"message"')

    expect((await store.readTurn('EV-live'))?.events).toHaveLength(1)

    await appendFile(turnEventsPath('EV-live'), '\n')
    expect((await store.readTurn('EV-live'))?.events).toHaveLength(1)
  })

  test('interrupts healthy turns when a sibling manifest is corrupt', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.begin('EV-healthy')
    const corruptPath = join(
      temporaryRoot,
      '.hopi',
      'runtime',
      'assistant',
      'turns',
      'EV-corrupt',
      'turn.json',
    )
    await mkdir(join(corruptPath, '..'), { recursive: true })
    await Bun.write(corruptPath, '{not-json')

    await store.interruptRunning()

    expect((await store.readTurn('EV-healthy'))?.manifest.status).toBe('interrupted')
    expect(await store.readTurn('EV-corrupt')).toBeNull()
  })

  test('discards an interrupted turn tail before recording its resumed attempt', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.begin('EV-resume')
    await appendFile(turnEventsPath('EV-resume'), '{"kind":"message"\0\0')

    await store.begin('EV-resume')

    const turn = await store.readTurn('EV-resume')
    expect(turn?.manifest.attempt).toBe(2)
    expect(turn?.events).toHaveLength(2)
    expect(turn?.events.at(-1)).toMatchObject({
      kind: 'message',
      content: 'Resuming Assistant turn after running.',
    })
    expect(await Bun.file(turnEventsPath('EV-resume')).text()).not.toContain('\0')
  })

  test('retains fork action receipts until one speaking turn acknowledges them', async () => {
    const store = createAssistantConversationStore(temporaryRoot, {
      now: () => new Date('2026-07-28T00:00:00Z'),
    })
    const scope = { kind: 'project', projectId: 'P-A' } as const
    await store.recordActionReceipt(scope, {
      receiptId: 'AR-tool-1',
      eventId: 'EV-wake-1',
      kind: 'tool',
      summary: 'Updated Work dependencies.',
      detail: '{"workId":"W-1"}',
    })
    await store.recordActionReceipt(scope, {
      receiptId: 'AR-tool-1',
      eventId: 'EV-wake-1',
      kind: 'tool',
      summary: 'Updated Work dependencies.',
      detail: '{"workId":"W-1"}',
    })

    expect(await store.readPendingActionReceipts(scope)).toMatchObject([
      {
        receiptId: 'AR-tool-1',
        eventId: 'EV-wake-1',
        deliveredAt: null,
      },
    ])

    await store.acknowledgeActionReceipts(scope, ['AR-tool-1'])
    expect(await store.readPendingActionReceipts(scope)).toEqual([])
  })

  test('isolates corrupt action receipts while healthy receipts remain readable and writable', async () => {
    const store = createAssistantConversationStore(temporaryRoot, {
      now: () => new Date('2026-07-28T00:00:00Z'),
    })
    const scope = { kind: 'project', projectId: 'P-A' } as const
    await store.recordActionReceipt(scope, {
      receiptId: 'AR-healthy',
      eventId: 'EV-healthy',
      kind: 'tool',
      summary: 'Healthy effect.',
      detail: null,
    })
    const corruptPath = projectReceiptPath('P-A', 'AR-corrupt')
    await mkdir(join(corruptPath, '..'), { recursive: true })
    await Bun.write(corruptPath, '{not-json')

    expect(await store.readPendingActionReceipts(scope)).toMatchObject([
      { receiptId: 'AR-healthy' },
    ])
    await store.acknowledgeActionReceipts(scope, ['AR-corrupt', 'AR-healthy'])
    expect(await store.readPendingActionReceipts(scope)).toEqual([])

    await store.recordActionReceipt(scope, {
      receiptId: 'AR-corrupt',
      eventId: 'EV-rebuilt',
      kind: 'reply',
      summary: 'Rebuilt effect.',
      detail: null,
    })
    expect(await store.readPendingActionReceipts(scope)).toMatchObject([
      { receiptId: 'AR-corrupt', eventId: 'EV-rebuilt' },
    ])
  })
})

async function registerThread(
  store: ReturnType<typeof createAssistantConversationStore>,
  threadId: string,
  eventId: string,
) {
  return store.ensureThread({
    threadId,
    createdAt: '2026-07-28T00:00:00Z',
    origin: { eventId, projectId: null, goalId: null },
    eventIds: [eventId],
  })
}

function sequenceClock(values: readonly string[]) {
  let index = 0
  return () => new Date(values[Math.min(index++, values.length - 1)] ?? '2026-07-28T00:00:00Z')
}
