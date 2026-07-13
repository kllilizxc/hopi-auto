import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-conversation-store')
const sessionPath = join(temporaryRoot, '.hopi', 'runtime', 'assistant', 'session.json')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(join(sessionPath, '..'), { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('AssistantConversationStore session cache', () => {
  test('migrates a legacy Codex thread cache to a vendor-qualified session', async () => {
    await Bun.write(
      sessionPath,
      JSON.stringify({
        version: 1,
        threadId: 'legacy-thread',
        updatedAt: '2026-07-11T00:00:00Z',
      }),
    )
    const store = createAssistantConversationStore(temporaryRoot)

    expect(await store.readSession()).toEqual({
      transport: 'codex',
      sessionId: 'legacy-thread',
    })
    expect(await Bun.file(sessionPath).json()).toEqual({
      version: 1,
      transport: 'codex',
      sessionId: 'legacy-thread',
    })
  })

  test('stores one disposable vendor-qualified session and discards invalid cache data', async () => {
    const store = createAssistantConversationStore(temporaryRoot)
    await store.writeSession({ transport: 'opencode', sessionId: 'ses-1' })
    expect(await store.readSession()).toEqual({ transport: 'opencode', sessionId: 'ses-1' })

    await Bun.write(sessionPath, '{not-json')
    expect(await store.readSession()).toBeNull()
    expect(await Bun.file(sessionPath).exists()).toBe(false)
  })
})
