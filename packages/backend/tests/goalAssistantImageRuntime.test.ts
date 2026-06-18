import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalAssistantRuntime } from '../src/assistant/GoalAssistantRuntime'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-assistant-image-runtime')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalAssistantRuntime image attachments', () => {
  test('fails closed for non-codex assistant transports with uploaded images', async () => {
    const rootDir = testRoot()
    await mkdir(rootDir, { recursive: true })
    await writeAdapterConfig(rootDir, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "await Bun.write(process.env.HOPI_OUTCOME_FILE!, JSON.stringify({ message: 'ok', actions: [] }))",
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const runtime = createGoalAssistantRuntime(rootDir)
    await expect(
      runtime.run({
        goalKey: 'goal-1',
        content: 'Use the screenshot.',
        images: [
          new File([Uint8Array.from([137, 80, 78, 71])], 'layout.png', {
            type: 'image/png',
          }),
        ],
      }),
    ).rejects.toThrow('Goal assistant image attachments require a Codex assistant transport.')

    await expect(createAssistantThreadStore(rootDir).readThread('goal-1')).resolves.toEqual({
      goalKey: 'goal-1',
      entries: [],
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

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
