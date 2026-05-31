import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPreferenceStore } from '../src/storage/preferenceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'preference-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createPreferenceStore', () => {
  test('bootstraps a missing preference file with a durable placeholder', async () => {
    const store = createPreferenceStore(testRoot())

    const preferences = await store.readPreferences()
    expect(preferences.path).toContain('.hopi/preference.md')
    expect(preferences.content).toContain('Durable project preferences have not been recorded yet.')
  })

  test('writes and reads updated preference content', async () => {
    const store = createPreferenceStore(testRoot())

    await store.writePreferences('# Preferences\n\n- Prefer Bun-first APIs.\n')
    await expect(store.readPreferences()).resolves.toMatchObject({
      content: '# Preferences\n\n- Prefer Bun-first APIs.\n',
    })
  })

  test('records durable preference entries without duplicating existing guidance', async () => {
    const store = createPreferenceStore(testRoot())

    await store.recordPreference('Prefer Bun-first APIs.')
    await store.recordPreference('Prefer Bun-first APIs.')
    await store.recordPreference('Keep workflow truth file-native.')

    await expect(store.readPreferences()).resolves.toMatchObject({
      content: '# Preferences\n\n- Prefer Bun-first APIs.\n- Keep workflow truth file-native.\n',
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
