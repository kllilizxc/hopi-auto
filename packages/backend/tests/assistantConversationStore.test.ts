import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { HOME_ASSISTANT_CONVERSATION_SCOPE } from '../src/assistant/assistantConversationScope'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-conversation-store')
const legacySessionPath = join(temporaryRoot, '.hopi', 'runtime', 'assistant', 'session.json')
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

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(join(legacySessionPath, '..'), { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('AssistantConversationStore session cache', () => {
  test('discards the legacy mixed-scope session instead of guessing ownership', async () => {
    await Bun.write(
      legacySessionPath,
      JSON.stringify({
        version: 1,
        threadId: 'legacy-thread',
        updatedAt: '2026-07-11T00:00:00Z',
      }),
    )
    const store = createAssistantConversationStore(temporaryRoot)

    expect(await store.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE)).toBeNull()
    expect(await Bun.file(legacySessionPath).exists()).toBe(false)
  })

  test('stores isolated Home and Project sessions and discards invalid scoped cache data', async () => {
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

    await Bun.write(homeSessionPath, '{not-json')
    expect(await store.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE)).toBeNull()
    expect(await Bun.file(homeSessionPath).exists()).toBe(false)
    expect(await Bun.file(projectSessionPath('P-A')).exists()).toBe(true)
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

  test('invalidates a legacy session without the current runtime affinity', async () => {
    await Bun.write(
      legacySessionPath,
      JSON.stringify({
        version: 2,
        transport: 'opencode',
        sessionId: 'wrong-workspace-session',
        contractDigest: 'contract-current',
      }),
    )
    const store = createAssistantConversationStore(temporaryRoot)

    expect(
      await store.readSession(
        HOME_ASSISTANT_CONVERSATION_SCOPE,
        'contract-current',
        'runtime-current',
      ),
    ).toBeNull()
    expect(await Bun.file(legacySessionPath).exists()).toBe(false)
  })

  test('ignores only a concurrently appended unterminated event tail', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.begin('EV-live')
    await appendFile(turnEventsPath('EV-live'), '{"kind":"message"')

    expect((await store.readTurn('EV-live'))?.events).toHaveLength(1)

    await appendFile(turnEventsPath('EV-live'), '\n')
    await expect(store.readTurn('EV-live')).rejects.toThrow('Invalid durable JSONL record')
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
})
