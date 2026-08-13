import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AssistantStateRecentAttempt,
  AssistantStateRuntime,
  AssistantStateSnapshot,
} from '../src/assistant/assistantState'
import { createAssistantWake } from '../src/assistant/assistantWake'
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
      context: {
        projectId: 'P-1',
        observedDigest: '2222222222222222222222222222222222222222222222222222222222222222',
      },
    })
    expect(events[0]?.body).toContain('native fork of the Project speaking Session')
    expect(events[0]?.body).toContain('material fact identities')
    expect(await fixture.wake.listRuns()).toMatchObject([
      {
        manifest: {
          status: 'completed',
          scope: { kind: 'project', projectId: 'P-1' },
        },
      },
    ])
  })

  test('reports Wake publication failure instead of returning a false started handoff', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    const runsRoot = join(fixture.homeRoot, '.hopi', 'runtime', 'assistant', 'wakes', 'runs')
    await Bun.write(runsRoot, 'not a directory')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '2'.repeat(64) } }))

    await expect(fixture.wake.observe({ settled: true })).rejects.toThrow()
    expect(fixture.wake.isActive()).toBe(false)
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

  test('continues each unresolved Project Attention revision at most once', async () => {
    const fixture = await setup(['P-1'])
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
    expect(await recoveredWake.observe({ settled: true })).toBe('started')
    await recoveredWake.waitForIdle()

    const continuation = [...(await fixture.workspace.readWorkspace()).events.values()].find(
      (candidate) => candidate.attributes.id !== event.attributes.id,
    )
    if (!continuation) throw new Error('Expected Attention continuation')
    const homeId = (await fixture.workspace.readWorkspace()).homeId
    expect(continuation.attributes).toMatchObject({
      source: 'system',
      status: 'pending',
      context: {
        projectId: 'P-1',
        attentionRefs: [`home:${homeId}/attention:A-1`],
      },
    })
    expect(await recoveredWake.observe({ settled: false })).toBe('unchanged')
    await fixture.workspace.handleEvent(continuation.attributes.id, {
      reply: 'The todo remains open.',
      disposition: 'silent',
      expose: true,
    })
    expect(await recoveredWake.observe({ settled: true })).toBe('unchanged')
    expect((await recoveredWake.listRuns()).length).toBe(2)

    const unchangedTimestamp = new Date('2026-07-25T00:00:00.000Z')
    await fixture.workspace.updateAttention('A-1', {
      body: 'Inspect the changed failure.',
      updatedAt: unchangedTimestamp,
    })
    fixture.setSnapshot(
      snapshot(['P-1'], {
        workspaceAttentions: [
          {
            ...snapshotAttention('A-1', 'P-1'),
            body: 'Inspect the changed failure.',
          },
        ],
      }),
    )

    expect(await recoveredWake.observe({ settled: true })).toBe('started')
    await recoveredWake.waitForIdle()
    expect((await recoveredWake.listRuns()).length).toBe(3)
    expect(await recoveredWake.observe({ settled: true })).toBe('unchanged')
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
          status: 'running',
          requestedAt: '2026-07-25T00:00:00.000Z',
          startedAt: '2026-07-25T00:00:00.000Z',
          waitReason: null,
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

  test('defers an ordinary unsettled change but preserves it for the settled edge', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '5'.repeat(64) } }))

    expect(await fixture.wake.observe({ settled: false })).toBe('deferred')
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.wake.listRuns()).length).toBe(1)
  })

  test('wakes immediately for a published Planning outcome before Engineering dispatch', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(planningOutcomeSnapshot())

    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    const event = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    expect(event?.attributes.context?.projectId).toBe('P-1')
    expect(event?.body).toContain('attempt:P-1:G-1:planning:R-plan-1:success:published')
  })

  test('publishes a state edge without requiring a cached speaking Session', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '8'.repeat(64) } }))

    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()
    expect((await fixture.workspace.readWorkspace()).events.size).toBe(1)
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

  test('does not create another wake when only the repair Generator changes after one reject', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')

    fixture.setSnapshot(reviewerRejectSnapshot('R-review-1', 'R-generator-2', '6'))
    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()
    const firstEvent = [...(await fixture.workspace.readWorkspace()).events.values()][0]
    if (!firstEvent) throw new Error('Expected Reviewer reject wake')
    await fixture.workspace.handleEvent(firstEvent.attributes.id, {
      reply: 'Observed.',
      disposition: 'silent',
    })

    fixture.setSnapshot(reviewerRejectSnapshot('R-review-1', 'R-generator-3', '7'))
    expect(await fixture.wake.observe({ settled: false })).toBe('started')
    await fixture.wake.waitForIdle()

    expect((await fixture.workspace.readWorkspace()).events.size).toBe(1)
    expect(await fixture.wake.listRuns()).toHaveLength(1)
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

  test('acknowledges an Assistant-created Attention revision without a redundant continuation', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    await fixture.workspace.createAttention(attention('A-1', 'P-1'))
    fixture.setSnapshot(
      snapshot(['P-1'], {
        workspaceAttentions: [snapshotAttention('A-1', 'P-1')],
        projectDigests: { 'P-1': '8'.repeat(64) },
      }),
    )

    await fixture.wake.acknowledgeProjects(['P-1'])

    expect(await fixture.wake.observe({ settled: true })).toBe('unchanged')
    expect(await fixture.wake.listRuns()).toEqual([])
  })

  test('isolates a corrupt Wake run from healthy diagnostics', async () => {
    const fixture = await setup(['P-1'])
    expect(await fixture.wake.observe({ settled: true })).toBe('baseline')
    fixture.setSnapshot(snapshot(['P-1'], { projectDigests: { 'P-1': '2'.repeat(64) } }))
    expect(await fixture.wake.observe({ settled: true })).toBe('started')
    await fixture.wake.waitForIdle()

    const corruptPath = join(
      fixture.homeRoot,
      '.hopi',
      'runtime',
      'assistant',
      'wakes',
      'runs',
      'WK-corrupt',
      'wake.json',
    )
    await mkdir(join(corruptPath, '..'), { recursive: true })
    await Bun.write(corruptPath, '{not-json')

    expect(await fixture.wake.listRuns()).toHaveLength(1)
    expect(await fixture.wake.readRunEvents('WK-corrupt')).toBeNull()
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
    readForWake: async () => current,
  }
  const wake = createAssistantWake({ homeRoot, workspace, state, onWake() {} })
  return {
    homeRoot,
    wake,
    workspace,
    setSnapshot(next: AssistantStateSnapshot) {
      current = next
    },
    recreateWake() {
      return createAssistantWake({ homeRoot, workspace, state, onWake() {} })
    },
  }
}

function snapshot(
  projectIds: string[],
  overrides: {
    projectDigests?: Record<string, string>
    workspaceAttentions?: AssistantStateSnapshot['workspaceAttentions']
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
      projectRoot: `/tmp/${projectId}/project`,
      sourceRoot: `/tmp/${projectId}/source`,
      primaryRepoId: 'primary',
      repos: [
        {
          repoId: 'primary',
          repoPath: `/tmp/${projectId}/repo`,
          integrationRoot: `/tmp/${projectId}/integration`,
          projectPath: '.',
          primary: true,
        },
      ],
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
      summary: 'Inspect the repeated failure.',
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
    summary: 'Inspect the repeated failure.',
    body: 'Inspect the repeated failure.',
    inspectionPath: `/tmp/${id}.md`,
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
        status: 'running',
        requestedAt: '2026-07-25T00:00:00.000Z',
        startedAt: '2026-07-25T00:00:00.000Z',
        waitReason: null,
      },
    ],
    projects: [
      {
        projectId: 'P-1',
        projectRoot: '/tmp/P-1/project',
        sourceRoot: '/tmp/P-1/source',
        primaryRepoId: 'primary',
        repos: [
          {
            repoId: 'primary',
            repoPath: '/tmp/P-1/repo',
            integrationRoot: '/tmp/P-1/integration',
            projectPath: '.',
            primary: true,
          },
        ],
        available: true,
        releaseHead: 'release',
        goals: [
          {
            goal: {
              attributes: {
                id: 'G-1',
                title: 'Goal',
                lifecycle: 'active',
                priority: 1,
                contractRevision: 1,
              },
              body: 'Goal',
              path: '/tmp/G-1/goal.md',
            },
            acceptedInputs: [],
            design: [],
            attentions: [],
            latestPlanningOutcome: null,
            works: [
              {
                attributes: {
                  id: 'W-1',
                  title: 'Work',
                  kind: 'engineering',
                  stage: 'generate',
                  notBefore: null,
                  dependsOn: [],
                  contractRevision: 1,
                },
                body: 'Work',
                path: '/tmp/G-1/works/W-1.md',
                projection: null,
                runtime: runtime([
                  attempt(generatorRunId, 'generator', 'running', null, null),
                  attempt(`${generatorRunId}-interrupted`, 'generator', 'interrupted', null, null),
                  attempt(reviewerRunId, 'reviewer', 'finished', 'reject', 'published'),
                ]),
              },
            ],
          },
        ],
      },
    ],
  }
}

function planningOutcomeSnapshot(): AssistantStateSnapshot {
  const current = reviewerRejectSnapshot('R-unused-review', 'R-unused-generator', '8')
  const project = current.projects[0]
  const goal = project?.goals[0]
  if (!project || !goal) throw new Error('Missing planning snapshot Project')
  return {
    ...current,
    activeRuns: [],
    projects: [
      {
        ...project,
        goals: [
          {
            ...goal,
            latestPlanningOutcome: {
              attributes: {
                id: 'plan-initial',
                title: 'Plan current Goal',
                kind: 'planning',
                stage: 'done',
                notBefore: null,
                dependsOn: [],
                contractRevision: 1,
              },
              body: 'Planning outcome',
              path: '/tmp/G-1/works/plan-initial.md',
              runtime: runtime([
                attempt('R-plan-1', 'planner', 'finished', 'success', 'published'),
              ]),
              evidence: {
                count: 1,
                latest: {
                  id: 'E-R-plan-1',
                  producerRun: 'R-plan-1',
                  artifactCount: 0,
                  path: '/tmp/G-1/evidence/E-R-plan-1.md',
                },
              },
            },
            works: [],
          },
        ],
      },
    ],
  }
}

function attempt(
  runId: string,
  responsibility: AssistantStateRecentAttempt['responsibility'],
  status: AssistantStateRecentAttempt['status'],
  result: AssistantStateRecentAttempt['result'],
  application: string | null,
): AssistantStateRecentAttempt {
  return {
    runId,
    responsibility,
    status,
    result,
    application,
    startedAt: '2026-07-25T00:00:00.000Z',
    endedAt: status === 'running' ? null : '2026-07-25T00:01:00.000Z',
    summary: null,
    artifactPreservation: null,
  }
}

function runtime(recentAttempts: AssistantStateRecentAttempt[]): AssistantStateRuntime {
  return {
    activeResponsibility: null,
    latestAttempt: null,
    attemptCount: recentAttempts.length,
    recentAttempts,
    lastActivityAt: '2026-07-25T00:01:00.000Z',
    stale: false,
    worktree: { path: '/tmp/worktree', exists: true },
    paths: {},
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
