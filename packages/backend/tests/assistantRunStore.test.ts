import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantRunStore } from '../src/assistant/assistantRunStore'
import { createProjectPaths } from '../src/storage/paths'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'assistant-run-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createAssistantRunStore', () => {
  test('returns empty assistant run state for a missing Goal', async () => {
    const store = createAssistantRunStore(testRoot())

    await expect(store.listRuns(goalKey)).resolves.toEqual([])
    await expect(store.readRun(goalKey, 'run-missing')).resolves.toBeNull()
  })

  test('lists assistant runs newest-first and reads run detail', async () => {
    const rootDir = testRoot()
    const paths = createProjectPaths(rootDir)
    await writeAssistantRun(paths, goalKey, {
      assistantRunId: 'assistant-run-1',
      startedAt: '2026-06-01T00:00:00.000Z',
      endedAt: '2026-06-01T00:00:05.000Z',
      requestContent: 'First request.',
      message: 'First reply.',
      actions: [],
      actionResults: [],
      events: [],
      status: 'completed',
    })
    await writeAssistantRun(paths, goalKey, {
      assistantRunId: 'assistant-run-2',
      startedAt: '2026-06-01T00:10:00.000Z',
      endedAt: '2026-06-01T00:10:07.000Z',
      requestContent: 'Second request.',
      message: 'Second reply.',
      actions: [{ kind: 'update_preference', content: '# Preferences\n' }],
      actionResults: [{ kind: 'update_preference', summary: 'Updated durable preferences.' }],
      events: [{ kind: 'message', level: 'info', role: 'assistant', content: 'finished' }],
      status: 'completed',
    })

    const store = createAssistantRunStore(rootDir)
    await expect(store.listRuns(goalKey)).resolves.toEqual([
      {
        assistantRunId: 'assistant-run-2',
        startedAt: '2026-06-01T00:10:00.000Z',
        endedAt: '2026-06-01T00:10:07.000Z',
        status: 'completed',
        message: 'Second reply.',
        actionCount: 1,
      },
      {
        assistantRunId: 'assistant-run-1',
        startedAt: '2026-06-01T00:00:00.000Z',
        endedAt: '2026-06-01T00:00:05.000Z',
        status: 'completed',
        message: 'First reply.',
        actionCount: 0,
      },
    ])

    await expect(store.readRun(goalKey, 'assistant-run-2')).resolves.toMatchObject({
      goalKey,
      assistantRunId: 'assistant-run-2',
      requestContent: 'Second request.',
      message: 'Second reply.',
      status: 'completed',
      actionResults: [{ kind: 'update_preference', summary: 'Updated durable preferences.' }],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}

async function writeAssistantRun(
  paths: ReturnType<typeof createProjectPaths>,
  currentGoalKey: string,
  record: Record<string, unknown> & { assistantRunId: string },
) {
  const runDir = paths.assistantRunDir(currentGoalKey, record.assistantRunId)
  await mkdir(runDir, { recursive: true })
  await Bun.write(
    paths.assistantResultPath(currentGoalKey, record.assistantRunId),
    `${JSON.stringify({ goalKey: currentGoalKey, ...record }, null, 2)}\n`,
  )
}
