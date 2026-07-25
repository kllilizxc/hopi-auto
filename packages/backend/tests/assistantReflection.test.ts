import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantWake } from '../src/assistant/assistantReflection'
import type { AssistantStateSnapshot } from '../src/assistant/assistantState'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-wake')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Assistant wake trigger', () => {
  test('records a state edge for the same Project Assistant without running another model', async () => {
    const fixture = await setup(['P-1'])

    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '2'.repeat(64) } }))
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()

    const events = [...(await fixture.workspace.readWorkspace()).events.values()]
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes).toMatchObject({
      source: 'system',
      visibility: 'internal',
      status: 'pending',
      context: { projectId: 'P-1' },
    })
    expect(events[0]?.body).toContain('Current Project state and every unresolved Attention')
    expect(events[0]?.body).not.toContain('"projects"')
    expect(await fixture.wake.listRuns()).toMatchObject([
      {
        manifest: {
          status: 'completed',
          scope: { kind: 'project', projectId: 'P-1' },
        },
      },
    ])
  })

  test('routes simultaneous changes independently by Project', async () => {
    const fixture = await setup(['P-1', 'P-2'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(
      snapshot(['P-1', 'P-2'], {
        projectDigests: { 'P-1': '3'.repeat(64), 'P-2': '4'.repeat(64) },
      }),
    )

    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()

    const projectIds = [...(await fixture.workspace.readWorkspace()).events.values()]
      .map((event) => event.attributes.context?.projectId)
      .sort()
    expect(projectIds).toEqual(['P-1', 'P-2'])
  })

  test('an unresolved Project Attention wakes once and stays durable without polling', async () => {
    const fixture = await setup(['P-1'])
    fixture.setSnapshot(
      snapshot(['P-1'], {
        workspaceAttentions: [
          {
            reference: 'home:H-1/attention:A-1',
            id: 'A-1',
            createdAt: '2026-07-25T00:00:00.000Z',
            updatedAt: '2026-07-25T00:00:00.000Z',
            resolvedAt: null,
            refs: ['project:P-1'],
            body: 'Inspect the repeated failure.',
            inspectionPath: '/tmp/A-1.md',
          },
        ],
      }),
    )

    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()
    expect(await fixture.wake.observe({ settled: false })).toBe('unchanged')

    const event = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    if (!event) throw new Error('Expected wake event')
    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'No public update.',
      disposition: 'silent',
    })
    expect(await fixture.wake.observe({ settled: false })).toBe('unchanged')
    expect((await fixture.wake.listRuns()).length).toBe(1)
  })

  test('defers an ordinary unsettled change but preserves it for the settled edge', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '5'.repeat(64) } }))

    expect(await fixture.wake.observe({ settled: false })).toBe('deferred')
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.wake.listRuns()).length).toBe(1)
  })
})

async function setup(projectIds: string[]) {
  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  for (const projectId of projectIds) {
    const repoRoot = join(temporaryRoot, projectId)
    await initializeGitRepo(repoRoot)
    await home.linkProject({ projectId, repoPath: repoRoot })
  }
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  let current = snapshot(projectIds)
  const state = {
    read: async () => current,
    readForReflection: async () => current,
  }
  const wake = createAssistantWake({ homeRoot, workspace, state })
  return {
    wake,
    workspace,
    setSnapshot(next: AssistantStateSnapshot) {
      current = next
    },
  }
}

function snapshot(
  projectIds: string[],
  overrides: {
    projectDigests?: Record<string, string>
    workspaceAttentions?: unknown[]
  } = {},
): AssistantStateSnapshot {
  const projectDigests = Object.fromEntries(
    projectIds.map((projectId, index) => [
      projectId,
      overrides.projectDigests?.[projectId] ?? String(index + 1).repeat(64),
    ]),
  )
  return {
    observedAt: '2026-07-25T00:00:00.000Z',
    stateDigest: 'f'.repeat(64),
    conversationDigests: {
      home: '0'.repeat(64),
      projects: projectDigests,
    },
    activeRuns: [],
    workspaceAttentions: overrides.workspaceAttentions ?? [],
    projects: projectIds.map((projectId) => ({
      projectId,
      available: true,
      releaseHead: 'release',
      goals: [],
    })),
  }
}

async function initializeGitRepo(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoRoot, 'README.md'), '# Project\n')
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}
