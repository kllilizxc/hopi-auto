import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'assistant-thread-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createAssistantThreadStore', () => {
  test('reads a missing Goal assistant thread as empty runtime state', async () => {
    const store = createAssistantThreadStore(testRoot())

    await expect(store.readThread(goalKey)).resolves.toEqual({
      goalKey,
      entries: [],
    })
  })

  test('appends user and assistant messages to the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendUserMessage(goalKey, 'Please plan the auth work.')
    await store.appendEntry(goalKey, {
      kind: 'assistant_message',
      content: 'I will create visible planning work before any engineering tasks.',
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        { kind: 'user_message', content: 'Please plan the auth work.' },
        {
          kind: 'assistant_message',
          content: 'I will create visible planning work before any engineering tasks.',
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
