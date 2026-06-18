import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  GoalAttachmentStoreError,
  createGoalAttachmentStore,
} from '../src/storage/goalAttachmentStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-attachment-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalAttachmentStore', () => {
  test('persists assistant images under the Goal asset tree', async () => {
    const rootDir = testRoot()
    const store = createGoalAttachmentStore(rootDir)
    const image = new File([Uint8Array.from([137, 80, 78, 71])], 'screen shot.PNG', {
      type: 'image/png',
    })

    const attachments = await store.persistAssistantImages('goal-1', [image])
    expect(attachments).toHaveLength(1)
    const first = attachments[0]
    if (!first) {
      throw new Error('Expected first attachment')
    }
    const assetPath = `${first.assetPath}`

    expect(first).toMatchObject({
      assetPath: expect.stringMatching(/^assets\/assistant\/[^/]+\/screen-shot\.png$/),
      fileName: 'screen-shot.png',
      mediaType: 'image/png',
      sizeBytes: 4,
    })

    const resolved = store.resolveGoalAsset('goal-1', assetPath.slice('assets/'.length))
    expect(resolved.assetPath).toBe(assetPath)
    await expect(Bun.file(resolved.absolutePath).bytes()).resolves.toEqual(
      Uint8Array.from([137, 80, 78, 71]),
    )
  })

  test('rejects unsupported assistant image types', async () => {
    const store = createGoalAttachmentStore(testRoot())
    const textFile = new File(['not an image'], 'notes.txt', { type: 'text/plain' })

    await expect(store.persistAssistantImages('goal-1', [textFile])).rejects.toThrow(
      GoalAttachmentStoreError,
    )
  })

  test('rejects asset traversal when serving Goal assets', () => {
    const store = createGoalAttachmentStore(testRoot())

    expect(() => store.resolveGoalAsset('goal-1', '../secret.txt')).toThrow(
      GoalAttachmentStoreError,
    )
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
