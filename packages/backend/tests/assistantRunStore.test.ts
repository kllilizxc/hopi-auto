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
      events: [
        { kind: 'message', level: 'info', role: 'assistant', content: 'finished' },
        {
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'tool_call',
          summary: 'Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
          toolName: 'Bash',
          toolInvocationKey: 'shell-1',
          vendorEventType: 'item/completed',
        },
      ],
      status: 'completed',
    })
    await Bun.write(
      paths.assistantContextPath(goalKey, 'assistant-run-2'),
      '# HOPI Goal Assistant Context\n\nDurable context.\n',
    )
    await Bun.write(
      paths.assistantPromptPath(goalKey, 'assistant-run-2'),
      '# HOPI Goal Assistant Prompt\n\nBundled prompt.\n',
    )
    await Bun.write(
      paths.assistantOutcomePath(goalKey, 'assistant-run-2'),
      '{\n  "message": "Second reply.",\n  "actions": []\n}\n',
    )

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
      events: expect.arrayContaining([
        expect.objectContaining({
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'tool_call',
          toolName: 'Bash',
          toolInvocationKey: 'shell-1',
          vendorEventType: 'item/completed',
        }),
      ]),
      actionResults: [{ kind: 'update_preference', summary: 'Updated durable preferences.' }],
    })
    await expect(store.readBundle(goalKey, 'assistant-run-2')).resolves.toMatchObject({
      goalKey,
      assistantRunId: 'assistant-run-2',
      context: {
        path: expect.stringContaining(
          '.hopi/runtime/goals/goal-1/assistant/runs/assistant-run-2/context.md',
        ),
        content: expect.stringContaining('Durable context.'),
      },
      prompt: {
        path: expect.stringContaining(
          '.hopi/runtime/goals/goal-1/assistant/runs/assistant-run-2/prompt.md',
        ),
        content: expect.stringContaining('Bundled prompt.'),
      },
      outcome: {
        path: expect.stringContaining(
          '.hopi/runtime/goals/goal-1/assistant/runs/assistant-run-2/outcome.json',
        ),
        content: expect.stringContaining('"message": "Second reply."'),
      },
      result: {
        path: expect.stringContaining(
          '.hopi/runtime/goals/goal-1/assistant/runs/assistant-run-2/result.json',
        ),
        content: expect.stringContaining('"assistantRunId": "assistant-run-2"'),
      },
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
