import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalAssistantRuntime } from '../src/assistant/GoalAssistantRuntime'
import { createAttemptStore } from '../src/runtime/attemptStore'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'
import { createBoardStore } from '../src/storage/boardStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-assistant-retry-task-runtime')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalAssistantRuntime retry_task', () => {
  test('clears retryable blockers and leaves non-retryable blockers in place', async () => {
    const rootDir = testRoot()
    await mkdir(rootDir, { recursive: true })
    await writeAdapterConfig(rootDir, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const prompt = await Bun.file(process.env.HOPI_PROMPT_FILE!).text(); if (!prompt.includes('retry_task')) throw new Error('missing retry_task guidance'); await Bun.write(process.env.HOPI_OUTCOME_FILE!, JSON.stringify({ message: 'I cleared the retryable blocker and left the dependency in place.', actions: [{ kind: 'retry_task', taskRef: 'T-4', reason: 'The user explicitly asked to retry the blocked engineering task.' }] }));",
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await writeBoard(rootDir)
    const attempts = createAttemptStore(rootDir)
    await attempts.increment('T-4', 'reviewer_rejected')
    await attempts.increment('T-4', 'merge_conflict')

    const runtime = createGoalAssistantRuntime(rootDir)
    const record = await runtime.run({
      goalKey: 'goal-1',
      content: 'Retry the blocked engineering task and continue when it is ready.',
    })

    expect(record.status).toBe('completed')
    expect(record.actionResults).toMatchObject([
      {
        kind: 'retry_task',
        taskRef: 'T-4',
        status: 'planned',
        clearedBlockers: [{ kind: 'intervention', ref: 'T-4:reviewer_rejected' }],
      },
    ])

    const board = await createBoardStore(rootDir).readBoard('goal-1')
    expect(board.items.find((item) => item.ref === 'T-4')).toMatchObject({
      ref: 'T-4',
      status: 'planned',
      blockedBy: [{ kind: 'task', ref: 'T-2' }],
    })
    await expect(attempts.get('T-4', 'reviewer_rejected')).resolves.toBe(0)
    await expect(attempts.get('T-4', 'merge_conflict')).resolves.toBe(0)

    await expect(createAssistantThreadStore(rootDir).readThread('goal-1')).resolves.toMatchObject({
      entries: [
        { kind: 'user_message', content: 'Retry the blocked engineering task and continue when it is ready.' },
        { kind: 'assistant_message', content: 'I cleared the retryable blocker and left the dependency in place.' },
        {
          kind: 'action',
          actionType: 'retry_task',
          action: {
            kind: 'retry_task',
            taskRef: 'T-4',
          },
        },
        {
          kind: 'action_result',
          actionType: 'retry_task',
          result: {
            kind: 'retry_task',
            taskRef: 'T-4',
            status: 'planned',
            clearedBlockers: [{ kind: 'intervention', ref: 'T-4:reviewer_rejected' }],
          },
        },
      ],
    })
  })
})

async function writeAdapterConfig(rootDir: string, config: unknown) {
  await mkdir(join(rootDir, '.hopi', 'runtime'), { recursive: true })
  await Bun.write(
    join(rootDir, '.hopi', 'runtime', 'agent-adapters.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

async function writeBoard(rootDir: string) {
  const goalDir = join(rootDir, '.hopi', 'docs', 'goals', 'goal-1')
  await mkdir(goalDir, { recursive: true })
  await Bun.write(
    join(goalDir, 'todo.yml'),
    `version: 1
goal:
  goalKey: goal-1
  title: Retry blocked engineering task
items:
  - ref: T-2
    kind: engineering
    status: done
    title: Upstream dependency
    description: Finish the upstream prerequisite before the polish retry.
    acceptanceCriteria:
      - The prerequisite task is complete.
    blockedBy: []
  - ref: T-4
    kind: engineering
    status: planned
    title: Polish deck manager layout
    description: Retry the reviewer-rejected deck manager polish task.
    acceptanceCriteria:
      - The deck manager returns to a clean two-pane layout.
    blockedBy:
      - kind: intervention
        ref: T-4:reviewer_rejected
      - kind: task
        ref: T-2
`,
  )
}

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
