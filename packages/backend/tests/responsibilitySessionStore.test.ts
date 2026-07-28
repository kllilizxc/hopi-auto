import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  bindResponsibilitySessionRunView,
  createResponsibilitySessionStore,
} from '../src/runtime/responsibilitySessionStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('ResponsibilitySessionStore', () => {
  test('retains one workspace and vendor session within a Work assignment', async () => {
    const root = await temporaryRoot()
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const reviewer = key('W-1', 'reviewer')
    const assignment = scope(1, 'a')

    const first = await store.open(generator, assignment)
    expect(first.session).toBeNull()
    await Bun.write(join(first.workspaceDir, 'partial-proof.json'), '{"ok":true}\n')
    await store.write(generator, assignment, {
      transport: 'codex',
      sessionId: 'thread-generator',
      executionKey: 'generator-key',
    })
    await store.write(reviewer, assignment, {
      transport: 'claude',
      sessionId: 'thread-reviewer',
      executionKey: 'reviewer-key',
    })

    const resumed = await store.open(generator, assignment)
    expect(resumed).toMatchObject({
      contractRevision: 1,
      assignmentHash: 'a'.repeat(64),
      session: {
        transport: 'codex',
        sessionId: 'thread-generator',
        executionKey: 'generator-key',
      },
      workspaceDir: first.workspaceDir,
    })
    expect(await Bun.file(join(resumed.workspaceDir, 'partial-proof.json')).text()).toBe(
      '{"ok":true}\n',
    )
    expect((await store.open(reviewer, assignment)).session).toEqual({
      transport: 'claude',
      sessionId: 'thread-reviewer',
      executionKey: 'reviewer-key',
    })

    await store.invalidateVendor(generator, assignment)
    expect((await store.open(generator, assignment)).session).toBeNull()
    expect(await Bun.file(join(first.workspaceDir, 'partial-proof.json')).exists()).toBe(true)
  })

  test('starts a fresh conversation and workspace for a changed assignment fingerprint', async () => {
    const root = await temporaryRoot()
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const firstScope = scope(1, 'a')
    const secondScope = scope(1, 'b')
    const revisionOne = await store.open(generator, firstScope)
    await Bun.write(join(revisionOne.workspaceDir, 'old-diagnostic.txt'), 'retained')
    await store.write(generator, firstScope, {
      transport: 'codex',
      sessionId: 'revision-one',
      executionKey: 'revision-one-key',
    })

    const revisionTwo = await store.open(generator, secondScope)
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

  test('rejects malformed metadata', async () => {
    const root = await temporaryRoot()
    const store = createResponsibilitySessionStore(root)
    const generator = key('W-1', 'generator')
    const assignment = scope(3, 'c')
    const opened = await store.open(generator, assignment)

    expect(opened.session).toBeNull()
    const manifestPath = join(dirname(opened.workspaceDir), 'session.json')
    await Bun.write(manifestPath, '{not-json')

    expect(store.open(generator, assignment)).rejects.toThrow()
  })

  test('atomically rebinds one stable current view without changing older Run directories', async () => {
    const root = await temporaryRoot()
    const workspace = join(root, 'workspace')
    const firstRun = join(root, 'runs', 'R-1')
    const secondRun = join(root, 'runs', 'R-2')
    await mkdir(firstRun, { recursive: true })
    await mkdir(secondRun, { recursive: true })
    await Bun.write(join(firstRun, 'result.json'), 'first')
    await Bun.write(join(secondRun, 'result.json'), 'second')

    const current = await bindResponsibilitySessionRunView(workspace, firstRun)
    expect(await readlink(current)).toBe(firstRun)
    expect(await Bun.file(join(current, 'result.json')).text()).toBe('first')

    expect(await bindResponsibilitySessionRunView(workspace, secondRun)).toBe(current)
    expect(await readlink(current)).toBe(secondRun)
    expect(await Bun.file(join(current, 'result.json')).text()).toBe('second')
    expect(await Bun.file(join(firstRun, 'result.json')).text()).toBe('first')
  })
})

function key(workId: string, responsibility: 'generator' | 'reviewer') {
  return { projectId: 'P-1', goalId: 'G-1', workId, responsibility } as const
}

function scope(contractRevision: number, character: string) {
  return { contractRevision, assignmentHash: character.repeat(64) }
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-responsibility-session-'))
  temporaryRoots.push(root)
  return root
}
