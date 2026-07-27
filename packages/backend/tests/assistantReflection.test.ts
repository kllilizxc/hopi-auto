import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantWake } from '../src/assistant/assistantReflection'
import type { AssistantStateSnapshot } from '../src/assistant/assistantState'
import type { WorkspaceAttentionDocument } from '../src/domain/assistantWorkspaceDocuments'
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

  test('does not loop an unresolved Attention and consumes one scheduled revisit once', async () => {
    let currentTime = Date.parse('2026-07-25T00:00:00.000Z')
    const fixture = await setup(['P-1'], () => new Date(currentTime))
    await fixture.workspace.createAttention(attention('A-1', 'P-1'))
    fixture.setSnapshot(
      snapshot(['P-1'], {
        workspaceAttentions: [snapshotAttention('A-1', 'P-1')],
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
    const recoveredWake = fixture.recreateWake()
    expect(await recoveredWake.observe({ settled: false })).toBe('unchanged')
    expect(await recoveredWake.observe({ settled: true })).toBe('unchanged')

    const revisitAt = new Date(currentTime + 60_000).toISOString()
    await fixture.workspace.updateAttention('A-1', {
      revisitAt,
      updatedAt: new Date(currentTime),
    })
    await recoveredWake.acknowledgeProjects(['P-1'])
    expect(await recoveredWake.observe({ settled: true })).toBe('unchanged')

    currentTime += 60_000
    expect(await recoveredWake.observe({ settled: true })).toBe('started')
    await recoveredWake.waitForIdle()
    const revisit = [...(await fixture.workspace.readWorkspace()).events.values()].find(
      (candidate) => candidate.attributes.id !== event.attributes.id,
    )
    if (!revisit) throw new Error('Expected scheduled Attention revisit')
    const homeId = (await fixture.workspace.readWorkspace()).homeId
    expect(revisit.attributes).toMatchObject({
      source: 'system',
      status: 'pending',
      context: {
        projectId: 'P-1',
        attentionRefs: [`home:${homeId}/attention:A-1`],
      },
    })
    expect(await recoveredWake.observe({ settled: false })).toBe('unchanged')
    await fixture.workspace.handleEvent(revisit.attributes.id, {
      reply: 'The external condition is still unavailable.',
      disposition: 'silent',
    })
    expect(await recoveredWake.observe({ settled: true })).toBe('unchanged')
    expect(await fixture.recreateWake().observe({ settled: true })).toBe('unchanged')
    expect((await recoveredWake.listRuns()).length).toBe(2)
  })

  test('wakes a Goal Attention at its scheduled revisit without a state digest edge', async () => {
    let currentTime = Date.parse('2026-07-25T00:00:00.000Z')
    const revisitAt = new Date(currentTime + 60_000).toISOString()
    const fixture = await setup(['P-1'], () => new Date(currentTime))
    const current = snapshot(['P-1'])
    fixture.setSnapshot({
      ...current,
      projects: [
        {
          projectId: 'P-1',
          available: true,
          releaseHead: 'release',
          goals: [
            {
              goal: { attributes: { id: 'G-1' } },
              attentions: [
                {
                  reference: 'project:P-1/goal:G-1/attention:A-goal',
                  attributes: {
                    id: 'A-goal',
                    resolvedAt: null,
                    operatorRequest: null,
                    revisitAt,
                  },
                },
              ],
              works: [],
            },
          ],
        },
      ],
    })
    await fixture.wake.acknowledgeProjects(['P-1'])

    currentTime += 60_000
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    const revisit = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    expect(revisit?.attributes).toMatchObject({
      source: 'system',
      status: 'pending',
      context: {
        projectId: 'P-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-goal'],
      },
    })
    if (!revisit) throw new Error('Expected Goal Attention revisit')
    await fixture.workspace.handleEvent(revisit.attributes.id, {
      reply: 'Checked.',
      disposition: 'silent',
    })
    expect(await fixture.wake.observe({ settled: true })).not.toBe('started')
    expect(await fixture.wake.observe({ settled: true })).toBe('unchanged')
  })

  test('does not treat legacy NeedsYou text as an Attention ownership transfer', async () => {
    let currentTime = Date.parse('2026-07-25T00:00:00.000Z')
    const fixture = await setup(['P-1'], () => new Date(currentTime))
    await fixture.workspace.createAttention(attention('A-1', 'P-1'))
    const state = await fixture.workspace.readWorkspace()
    const attentionRef = `home:${state.homeId}/attention:A-1`
    const revisitAt = new Date(currentTime + 60_000).toISOString()
    await fixture.workspace.updateAttention('A-1', {
      revisitAt,
      updatedAt: new Date(currentTime),
    })
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-question',
      content: 'Ask for the missing input.',
      context: { projectId: 'P-1', attentionRefs: [attentionRef] },
      receivedAt: new Date(currentTime),
    })
    await fixture.workspace.handleEvent('EV-question', {
      reply: '<NeedsYou attentionId="A-1">Restore the external session.</NeedsYou>',
      disposition: 'notified',
      expose: true,
      handledAt: new Date(currentTime),
    })
    await fixture.wake.acknowledgeProjects(['P-1'])

    currentTime += 60_000
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.workspace.readWorkspace()).events.size).toBe(2)

    await fixture.workspace.receiveEvent({
      eventId: 'EV-answer',
      content: 'The external session is restored.',
      context: {
        projectId: 'P-1',
        attentionRefs: [attentionRef],
        replyTo: `home:${state.homeId}/event:EV-question`,
      },
      receivedAt: new Date(currentTime),
    })
    await fixture.workspace.handleEvent('EV-answer', {
      reply: 'I will recheck it.',
      disposition: 'answered',
      handledAt: new Date(currentTime),
    })
    expect(await fixture.wake.observe({ settled: true })).not.toBe('started')
    expect((await fixture.workspace.readWorkspace()).events.size).toBe(3)
  })

  test('lets an active Work Attempt provide the next Attention wake edge', async () => {
    const fixture = await setup(['P-1'])
    await fixture.workspace.createAttention(attention('A-1', 'P-1'))
    const current = snapshot(['P-1'], {
      workspaceAttentions: [snapshotAttention('A-1', 'P-1')],
    })
    fixture.setSnapshot(current)
    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    const event = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    if (!event) throw new Error('Expected wake event')
    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Started independent Work.',
      disposition: 'tools-used',
    })
    fixture.setSnapshot({
      ...current,
      conversationDigests: {
        ...current.conversationDigests,
        projects: { 'P-1': '9'.repeat(64) },
      },
      activeRuns: [
        {
          projectId: 'P-1',
          goalId: 'G-1',
          workId: 'W-1',
          responsibility: 'generator',
          runId: 'R-1',
        },
      ],
    })

    expect(await fixture.wake.observe({ settled: false })).toBe('deferred')
    expect((await fixture.wake.listRuns()).length).toBe(1)

    fixture.setSnapshot({
      ...current,
      conversationDigests: {
        ...current.conversationDigests,
        projects: { 'P-1': '9'.repeat(64) },
      },
    })
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.wake.listRuns()).length).toBe(2)
  })

  test('routes cross-Project delegated Work settlement back to the source Project', async () => {
    const fixture = await setup(['P-1', 'P-2'])
    const running = delegatedAttentionSnapshot(true, '1')
    fixture.setSnapshot(running)

    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')

    fixture.setSnapshot(delegatedAttentionSnapshot(false, '2'))
    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    const event = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    expect(event?.attributes).toMatchObject({
      source: 'system',
      status: 'pending',
      context: { projectId: 'P-1' },
    })
    expect(await fixture.wake.listRuns()).toMatchObject([
      {
        manifest: {
          scope: { kind: 'project', projectId: 'P-1' },
          status: 'completed',
        },
      },
    ])
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

  test('wakes for a settled failure while another Goal in the same Project is active', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')

    const current = snapshot(['P-1'], {
      projectDigests: { 'P-1': '8'.repeat(64) },
    })
    fixture.setSnapshot({
      ...current,
      activeRuns: [
        {
          projectId: 'P-1',
          goalId: 'G-active',
          workId: 'W-active',
          responsibility: 'planner',
          runId: 'R-active',
        },
      ],
      projects: [
        {
          projectId: 'P-1',
          available: true,
          releaseHead: 'release',
          goals: [
            {
              goalId: 'G-failed',
              works: [
                {
                  workId: 'W-failed',
                  projection: { failedPredicates: ['failed_attempt'] },
                },
              ],
            },
            {
              goalId: 'G-active',
              works: [],
            },
          ],
        },
      ],
    })

    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    const event = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    expect(event?.attributes).toMatchObject({
      source: 'system',
      status: 'pending',
      context: { projectId: 'P-1' },
    })
  })

  test('wakes for each published Reviewer reject while the repair Generator is active', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')

    fixture.setSnapshot(reviewerRejectSnapshot('R-review-1', 'R-generator-2', '6'))
    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    fixture.setSnapshot(reviewerRejectSnapshot('R-review-2', 'R-generator-3', '7'))
    expect(await fixture.wake.observe({ settled: false })).toBe('deferred')
    expect((await fixture.wake.listRuns()).length).toBe(1)

    const firstEvent = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    if (!firstEvent) throw new Error('Expected first Reviewer reject wake')
    await fixture.workspace.handleEvent(firstEvent.attributes.id, {
      reply: 'Observed.',
      disposition: 'silent',
    })

    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.wake.listRuns()).length).toBe(2)
  })

  test('acknowledges the current Assistant effect without consuming a later state edge', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')

    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '6'.repeat(64) } }))
    await fixture.wake.acknowledgeProjects(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('unchanged')
    expect(await fixture.wake.listRuns()).toEqual([])

    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '7'.repeat(64) } }))
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect(await fixture.wake.listRuns()).toHaveLength(1)
  })
})

async function setup(projectIds: string[], now: () => Date = () => new Date()) {
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
  const wake = createAssistantWake({ homeRoot, workspace, state, now })
  return {
    wake,
    workspace,
    setSnapshot(next: AssistantStateSnapshot) {
      current = next
    },
    recreateWake() {
      return createAssistantWake({ homeRoot, workspace, state, now })
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
    delegations: [],
    workspaceAttentions: overrides.workspaceAttentions ?? [],
    projects: projectIds.map((projectId) => ({
      projectId,
      available: true,
      releaseHead: 'release',
      goals: [],
    })),
  }
}

function attention(id: string, projectId: string): WorkspaceAttentionDocument {
  const timestamp = '2026-07-25T00:00:00.000Z'
  return {
    attributes: {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      refs: [`project:${projectId}`],
      target: `project:${projectId}`,
      notifiedAt: null,
      operatorRequest: null,
    },
    body: 'Inspect the repeated failure.\n',
  }
}

function snapshotAttention(id: string, projectId: string) {
  return {
    reference: `home:H-1/attention:${id}`,
    projectId,
    id,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    resolvedAt: null,
    refs: [`project:${projectId}`],
    body: 'Inspect the repeated failure.',
    inspectionPath: `/tmp/${id}.md`,
  }
}

function delegatedAttentionSnapshot(active: boolean, sourceDigest: string) {
  const current = snapshot(['P-1', 'P-2'], {
    projectDigests: {
      'P-1': sourceDigest.repeat(64),
      'P-2': '3'.repeat(64),
    },
  })
  const activeRun = active
    ? {
        projectId: 'P-2',
        goalId: 'G-target',
        workId: 'W-target',
        responsibility: 'generator' as const,
        runId: 'R-target',
      }
    : null
  return {
    ...current,
    activeRuns: activeRun ? [activeRun] : [],
    delegations: [
      {
        sourceProjectId: 'P-1',
        sourceGoalId: 'G-source',
        sourceEventId: 'EV-source',
        sourceAttentionRefs: ['project:P-1/goal:G-source/attention:A-source'],
        targetProjectId: 'P-2',
        targetGoalId: 'G-target',
        targetWorkId: 'W-target',
        work: {
          attributes: {
            id: 'W-target',
            kind: 'engineering',
            stage: active ? 'generate' : 'done',
          },
          path: '/tmp/W-target.md',
          runtime: {
            latestAttempt: { status: active ? 'running' : 'finished' },
            recentAttempts: [
              {
                runId: 'R-target',
                responsibility: 'generator',
                status: active ? 'running' : 'finished',
                result: active ? null : 'success',
                application: active ? null : 'published',
              },
            ],
            attemptCount: 1,
            stale: false,
          },
        },
        activeRun,
      },
    ],
    projects: [
      {
        projectId: 'P-1',
        available: true,
        releaseHead: 'release',
        goals: [
          {
            attentions: [{ attributes: { resolvedAt: null } }],
            works: [],
          },
        ],
      },
      {
        projectId: 'P-2',
        available: true,
        releaseHead: 'release',
        goals: [],
      },
    ],
  }
}

function reviewerRejectSnapshot(
  reviewerRunId: string,
  generatorRunId: string,
  digestCharacter: string,
): AssistantStateSnapshot {
  const current = snapshot(['P-1'], {
    projectDigests: { 'P-1': digestCharacter.repeat(64) },
  })
  return {
    ...current,
    activeRuns: [
      {
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'W-1',
        responsibility: 'generator',
        runId: generatorRunId,
      },
    ],
    projects: [
      {
        projectId: 'P-1',
        available: true,
        releaseHead: 'release',
        goals: [
          {
            works: [
              {
                runtime: {
                  recentAttempts: [
                    {
                      runId: generatorRunId,
                      responsibility: 'generator',
                      status: 'running',
                      result: null,
                      application: null,
                    },
                    {
                      runId: `${generatorRunId}-interrupted`,
                      responsibility: 'generator',
                      status: 'interrupted',
                      result: null,
                      application: null,
                    },
                    {
                      runId: reviewerRunId,
                      responsibility: 'reviewer',
                      status: 'finished',
                      result: 'reject',
                      application: 'published',
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
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
