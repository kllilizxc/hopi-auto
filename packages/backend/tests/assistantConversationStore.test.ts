import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HOME_ASSISTANT_CONVERSATION_SCOPE } from '../src/assistant/assistantConversationScope'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-conversation-store')
const homeSessionPath = join(
  temporaryRoot,
  '.hopi',
  'runtime',
  'assistant',
  'sessions',
  'home.json',
)
const projectSessionPath = (projectId: string) =>
  join(temporaryRoot, '.hopi', 'runtime', 'assistant', 'sessions', 'projects', `${projectId}.json`)
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

describe('AssistantConversationStore session cache', () => {
  test('stores isolated Home and Project sessions', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      { transport: 'opencode', sessionId: 'ses-1' },
      'contract-a',
      'runtime-a',
    )
    await store.writeSession(
      { kind: 'project', projectId: 'P-A' },
      { transport: 'codex', sessionId: 'project-a' },
      'contract-a',
      'runtime-a',
    )
    await store.writeSession(
      { kind: 'project', projectId: 'P-项目二' },
      { transport: 'claude', sessionId: 'project-b' },
      'contract-a',
      'runtime-a',
    )
    expect(
      await store.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE, 'contract-a', 'runtime-a'),
    ).toEqual({
      transport: 'opencode',
      sessionId: 'ses-1',
    })
    expect(
      await store.readSession({ kind: 'project', projectId: 'P-A' }, 'contract-a', 'runtime-a'),
    ).toEqual({ transport: 'codex', sessionId: 'project-a' })
    expect(
      await store.readSession(
        { kind: 'project', projectId: 'P-项目二' },
        'contract-a',
        'runtime-a',
      ),
    ).toEqual({ transport: 'claude', sessionId: 'project-b' })

    expect(await Bun.file(projectSessionPath('P-A')).exists()).toBe(true)
  })

  test('isolates and discards malformed session metadata', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await mkdir(join(homeSessionPath, '..'), { recursive: true })
    await Bun.write(homeSessionPath, '{not-json')

    expect(await store.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE)).toBeNull()
    expect(await Bun.file(homeSessionPath).exists()).toBe(false)
  })

  test('invalidates a session created under another Assistant contract', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      { transport: 'codex', sessionId: 'thread-old' },
      'contract-old',
    )

    expect(
      await store.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE, 'contract-current'),
    ).toBeNull()
    expect(await Bun.file(homeSessionPath).exists()).toBe(false)
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
