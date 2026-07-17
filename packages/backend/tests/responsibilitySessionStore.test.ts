import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createResponsibilitySessionStore } from '../src/runtime/responsibilitySessionStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ResponsibilitySessionStore', () => {
  test('retains one workspace and vendor session within a Work revision', async () => {
    const root = await temporaryRoot()
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const reviewer = key('W-1', 'reviewer')

    const first = await store.open(generator, 1)
    expect(first.session).toBeNull()
    await Bun.write(join(first.workspaceDir, 'partial-proof.json'), '{"ok":true}\n')
    await store.write(generator, 1, {
      transport: 'codex',
      sessionId: 'thread-generator',
    })
    await store.write(reviewer, 1, {
      transport: 'claude',
      sessionId: 'thread-reviewer',
    })

    const resumed = await store.open(generator, 1)
    expect(resumed).toMatchObject({
      contractRevision: 1,
      session: { transport: 'codex', sessionId: 'thread-generator' },
      workspaceDir: first.workspaceDir,
    })
    expect(await Bun.file(join(resumed.workspaceDir, 'partial-proof.json')).text()).toBe(
      '{"ok":true}\n',
    )
    expect((await store.open(reviewer, 1)).session).toEqual({
      transport: 'claude',
      sessionId: 'thread-reviewer',
    })

    await store.invalidateVendor(generator, 1)
    expect((await store.open(generator, 1)).session).toBeNull()
    expect(await Bun.file(join(first.workspaceDir, 'partial-proof.json')).exists()).toBe(true)
  })

  test('starts a fresh conversation and workspace for a material revision', async () => {
    const root = await temporaryRoot()
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const revisionOne = await store.open(generator, 1)
    await Bun.write(join(revisionOne.workspaceDir, 'old-diagnostic.txt'), 'retained')
    await store.write(generator, 1, { transport: 'codex', sessionId: 'revision-one' })

    const revisionTwo = await store.open(generator, 2)
    expect(revisionTwo.session).toBeNull()
    expect(revisionTwo.workspaceDir).not.toBe(revisionOne.workspaceDir)
    expect(await Bun.file(join(revisionTwo.workspaceDir, 'old-diagnostic.txt')).exists()).toBe(
      false,
    )
    expect(await Bun.file(join(revisionOne.workspaceDir, 'old-diagnostic.txt')).text()).toBe(
      'retained',
    )

    await store.clearWork({ projectId: 'P-1', goalId: 'G-1', workId: 'W-1' })
    expect(await Bun.file(revisionOne.workspaceDir).exists()).toBe(false)
    expect(await Bun.file(revisionTwo.workspaceDir).exists()).toBe(false)
  })

  test('migrates a legacy session and repairs malformed metadata without deleting files', async () => {
    const root = await temporaryRoot()
    const legacyPath = join(
      root,
      '.hopi',
      'runtime',
      'responsibility-sessions',
      'P-1',
      'G-1',
      'W-1',
      'generator.json',
    )
    await mkdir(dirname(legacyPath), { recursive: true })
    await Bun.write(
      legacyPath,
      `${JSON.stringify({ version: 1, transport: 'codex', sessionId: 'legacy-thread' })}\n`,
    )
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const migrated = await store.open(generator, 3)

    expect(migrated.session).toEqual({ transport: 'codex', sessionId: 'legacy-thread' })
    expect(await Bun.file(legacyPath).exists()).toBe(false)
    const manifestPath = join(dirname(migrated.workspaceDir), 'session.json')
    await Bun.write(join(migrated.workspaceDir, 'retained.txt'), 'keep')
    await Bun.write(manifestPath, '{not-json')

    const repaired = await store.open(generator, 3)
    expect(repaired.session).toBeNull()
    expect(await Bun.file(join(repaired.workspaceDir, 'retained.txt')).text()).toBe('keep')
    expect(await Bun.file(manifestPath).json()).toEqual({
      version: 2,
      contractRevision: 3,
      session: null,
    })
  })
})

function key(workId: string, responsibility: 'generator' | 'reviewer') {
  return { projectId: 'P-1', goalId: 'G-1', workId, responsibility } as const
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-responsibility-session-'))
  temporaryRoots.push(root)
  return root
}
