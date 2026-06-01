import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPreferenceStore } from '../src/storage/preferenceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'preference-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createPreferenceStore', () => {
  test('bootstraps a missing preference file with a canonical structured document', async () => {
    const store = createPreferenceStore(testRoot())

    const preferences = await store.readPreferences()
    expect(preferences.path).toContain('.hopi/preference.md')
    expect(preferences.content).toContain('# Preferences')
    expect(preferences.content).toContain('```yaml')
    expect(preferences.content).toContain('preferences: []')
    expect(preferences.entries).toEqual([])
  })

  test('writes and reads structured preference content with parsed entries', async () => {
    const store = createPreferenceStore(testRoot())

    await store.writePreferences(`# Preferences

\`\`\`yaml
version: 1
preferences:
  - preferenceKey: prefer-bun-first
    status: active
    summary: Prefer Bun-first APIs.
    rationale: Bun is the runtime boundary.
\`\`\`
`)
    await expect(store.readPreferences()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-bun-first',
          status: 'active',
          summary: 'Prefer Bun-first APIs.',
          rationale: 'Bun is the runtime boundary.',
        },
      ],
    })
  })

  test('records structured preference entries with stable keys and supersedes older guidance', async () => {
    const store = createPreferenceStore(testRoot())

    await store.recordPreference({
      preferenceKey: 'prefer-deterministic-workflows',
      summary: 'Prefer deterministic workflows.',
    })
    await store.recordPreference({
      preferenceKey: 'prefer-bun-first',
      summary: 'Prefer Bun-first APIs.',
      rationale: 'Bun is the runtime boundary.',
      supersedes: ['prefer-deterministic-workflows'],
    })

    await expect(store.readPreferences()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'retired',
          summary: 'Prefer deterministic workflows.',
          supersededBy: 'prefer-bun-first',
          retiredReason: 'Superseded by prefer-bun-first.',
        },
        {
          preferenceKey: 'prefer-bun-first',
          status: 'active',
          summary: 'Prefer Bun-first APIs.',
          rationale: 'Bun is the runtime boundary.',
        },
      ],
    })
  })

  test('retires an existing structured preference with an explicit reason', async () => {
    const store = createPreferenceStore(testRoot())

    await store.recordPreference({
      preferenceKey: 'prefer-bun-first',
      summary: 'Prefer Bun-first APIs.',
      rationale: 'Bun is the runtime boundary.',
    })
    await store.retirePreference({
      preferenceKey: 'prefer-bun-first',
      reason: 'The runtime boundary is now fixed elsewhere.',
    })

    await expect(store.readPreferences()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-bun-first',
          status: 'retired',
          summary: 'Prefer Bun-first APIs.',
          rationale: 'Bun is the runtime boundary.',
          retiredReason: 'The runtime boundary is now fixed elsewhere.',
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
