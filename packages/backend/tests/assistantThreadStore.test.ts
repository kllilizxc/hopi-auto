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

  test('persists structured assistant action-result authority in the assistant thread', async () => {
    const store = createAssistantThreadStore(testRoot())

    await store.appendEntry(goalKey, {
      kind: 'action_result',
      actionType: 'request_planning',
      summary: 'Requested planning follow-through in PR-1 for P-1.',
      result: {
        kind: 'request_planning',
        requestKey: 'PR-1',
        taskRef: 'P-1',
        resolvedSourceResponseFormat: 'matching_answer_sources',
        summary: 'Requested planning follow-through in PR-1 for P-1.',
      },
    })

    await expect(store.readThread(goalKey)).resolves.toMatchObject({
      goalKey,
      entries: [
        {
          kind: 'action_result',
          actionType: 'request_planning',
          summary: 'Requested planning follow-through in PR-1 for P-1.',
          result: {
            kind: 'request_planning',
            requestKey: 'PR-1',
            taskRef: 'P-1',
            resolvedSourceResponseFormat: 'matching_answer_sources',
            summary: 'Requested planning follow-through in PR-1 for P-1.',
          },
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
