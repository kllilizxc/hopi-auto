import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoalDocument, WorkDocument } from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import {
  createServer,
  deriveAssistantFeedActivity,
  deriveGoalSummaries,
  deriveWorkCompletedAt,
} from '../src/mvpServer'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { runStoragePath } from '../src/runtime/runPaths'
import { workAssignmentHash } from '../src/runtime/workAssignment'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

let temporaryRoot = ''
const activeServers = new Set<ReturnType<typeof createServer>>()

beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-mvp-server-'))
})

afterEach(async () => {
  await Promise.all([...activeServers].map((server) => server.shutdown()))
  activeServers.clear()
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('MVP server Wayfinder boundary', () => {
  test('serves lightweight health without projecting Project state', async () => {
    const server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      instanceId: 'instance-test',
      startCoordinator: false,
    })
    activeServers.add(server)

    const health = await waitForHealth(`http://127.0.0.1:${server.port}`)
    expect(health).toMatchObject({
      status: 'ok',
      pid: process.pid,
      instanceId: 'instance-test',
      runtimeError: null,
      coordinator: { status: 'stopped', consecutiveFailures: 0 },
    })
  })

  test('projects the canonical Route graph', async () => {
    const fixture = await setupProject({
      firstWork: {
        id: 'W-boundary',
        title: 'Choose the publication boundary',
        kind: 'decision',
        decisionType: 'research',
        question: 'Which component may publish accepted source?',
      },
      mapMarkdown: mapMarkdown('Choose a deterministic publication boundary.'),
    })
    const controller = createGoalController(fixture.store, {
      now: () => new Date('2026-08-14T00:01:00.000Z'),
    })
    const engineering = await controller.createWork('G-1', {
      kind: 'engineering',
      title: 'Implement the publication boundary',
      objective: 'Publish accepted source through one boundary.',
      acceptanceCriteria: ['Only the accepted boundary mutates canonical source.'],
      dependsOn: ['W-boundary'],
    })

    const server = startServer(fixture.homeRoot)
    const base = `http://127.0.0.1:${server.port}`
    const route = await request(base, '/api/projects/P-1/goals/G-1?view=route')
    expect(route).toMatchObject({
      goal: { id: 'G-1', lifecycle: 'active' },
      route: {
        destination: { goalId: 'G-1', lifecycle: 'active' },
        nodes: expect.arrayContaining([
          expect.objectContaining({ id: 'W-boundary', kind: 'decision', status: 'open' }),
          expect.objectContaining({
            id: engineering.attributes.id,
            kind: 'engineering',
            blockedBy: 'Choose the publication boundary',
          }),
        ]),
        edges: [{ from: 'W-boundary', to: engineering.attributes.id }],
        focusWorkId: 'W-boundary',
        mapPath: '.hopi/docs/goals/G-1/design/index.md',
      },
    })
    expect(await rawRequest(base, '/api/projects/P-1/goals/G-1?view=unknown')).toBe(400)
  })

  test('derives queued, running, and waiting-Assistant state from generic Attempts', async () => {
    const fixture = await setupProject()
    const attempts = createRunAttemptStore(fixture.homeRoot, {
      now: () => new Date('2026-08-14T00:02:00.000Z'),
    })
    const currentWork = (await fixture.store.readPackage('G-1')).works.get('W-1')
    if (!currentWork) throw new Error('Expected W-1')
    await attempts.reserve({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      workHash: await workAssignmentHash(currentWork),
      request: {
        workspaceMode: 'isolated_write',
        instructionMarkdown: 'Implement the accepted change.',
        refs: [],
      },
    })
    const server = startServer(fixture.homeRoot, attempts)
    const base = `http://127.0.0.1:${server.port}`

    expect(await request(base, '/api/state')).toMatchObject({
      activeRuns: [
        {
          key: 'P-1/G-1/W-1',
          runId: 'R-1',
          status: 'queued',
          startedAt: null,
          waitReason: null,
        },
      ],
    })
    const queuedGoal = await request(base, '/api/projects/P-1/goals/G-1?view=route')
    expect((queuedGoal.works as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'W-1',
      projection: { state: 'queued' },
    })

    const recorder = await attempts.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      runRoot: runStoragePath(fixture.homeRoot, 'R-1'),
    })
    const runningGoal = await request(base, '/api/projects/P-1/goals/G-1?view=route')
    expect((runningGoal.works as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'W-1',
      projection: { state: 'running' },
    })

    await recorder.settle({
      termination: 'normal',
      reportMarkdown: 'The Worker completed its bounded assignment.',
      exitCode: 0,
    })
    expect(await request(base, '/api/state')).toMatchObject({ activeRuns: [] })
    const settledGoal = await request(base, '/api/projects/P-1/goals/G-1?view=route')
    expect((settledGoal.works as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'W-1',
      projection: { state: 'waiting_assistant' },
    })
  })

  test('exposes only Assistant and Worker settings', async () => {
    const fixture = await setupProject()
    const server = startServer(fixture.homeRoot)
    const base = `http://127.0.0.1:${server.port}`
    const state = await request(base, '/api/state')
    expect(
      Object.keys((state.home as { agentCodingDefaults: object }).agentCodingDefaults),
    ).toEqual(['assistant', 'worker'])

    const updated = await request(base, '/api/agents/worker/settings', {
      method: 'PATCH',
      body: { codingDefaults: { transport: 'claude', model: 'claude-sonnet-4-6' } },
    })
    expect(
      (updated.home as { agentCodingDefaults: Record<string, unknown> }).agentCodingDefaults.worker,
    ).toMatchObject({ codingDefaults: { transport: 'claude', model: 'claude-sonnet-4-6' } })
    expect(
      await rawRequest(base, '/api/agents/reviewer/settings', { method: 'PATCH', body: {} }),
    ).toBe(400)
  })

  test('rejects direct Goal creation and keeps creation behind the Assistant tool boundary', async () => {
    const fixture = await setupProject()
    const server = startServer(fixture.homeRoot)
    const base = `http://127.0.0.1:${server.port}`

    expect(
      await rawRequest(base, '/api/projects/P-1/goals', {
        method: 'POST',
        body: { title: 'Bypass Assistant' },
      }),
    ).toBe(404)
  })

  test('serves canonical Work and Map documents from the Route contract', async () => {
    const fixture = await setupProject({
      firstWork: {
        id: 'W-question',
        title: 'Resolve the route',
        kind: 'decision',
        decisionType: 'prototype',
        question: 'Which route is easiest to understand at a glance?',
      },
      mapMarkdown: mapMarkdown('Make the execution route obvious at a glance.'),
    })
    const server = startServer(fixture.homeRoot)
    const base = `http://127.0.0.1:${server.port}`

    expect(await request(base, '/api/projects/P-1/goals/G-1/works/W-question')).toMatchObject({
      id: 'W-question',
      body: expect.stringContaining('## Question'),
    })
    const mapPath = encodeURIComponent('.hopi/docs/goals/G-1/design/index.md')
    expect(
      await request(base, `/api/projects/P-1/goals/G-1/documents?path=${mapPath}`),
    ).toMatchObject({ content: expect.stringContaining('## Not yet specified') })
  })
})

describe('pure presentation helpers', () => {
  test('summarizes the current Route from derived Work state', () => {
    const goalPackage = packageWith([engineeringWork('W-1', 'open')])
    expect(
      deriveGoalSummaries(goalPackage, [
        { workId: 'W-1', state: 'ready', ready: true, failedPredicates: [] },
      ]),
    ).toEqual({ currentSummary: 'W-1', nextSummary: 'Ready' })
  })

  test('derives completion time and Assistant feed activity from facts', () => {
    expect(
      deriveWorkCompletedAt({ status: 'done' }, [
        { status: 'settled', endedAt: '2026-08-14T00:01:00.000Z' },
        { status: 'settled', endedAt: '2026-08-14T00:02:00.000Z' },
      ]),
    ).toBe('2026-08-14T00:02:00.000Z')
    expect(
      deriveAssistantFeedActivity({
        publicStatuses: ['completed'],
        internalSpeakingRunning: true,
        wakeRunning: false,
      }),
    ).toEqual({ phase: 'thinking' })
  })
})

async function setupProject(
  overrides: {
    firstWork?: Parameters<ReturnType<typeof createGoalPackageStore>['createGoal']>[0]['firstWork']
    mapMarkdown?: string
  } = {},
) {
  const homeRoot = join(temporaryRoot, 'home')
  const repoRoot = await createRepo(join(temporaryRoot, `repo-${crypto.randomUUID()}`))
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
  await store.createGoal({
    goalId: 'G-1',
    title: 'Goal',
    objective: 'Reach the destination.',
    firstWork:
      overrides.firstWork ??
      ({
        id: 'W-1',
        title: 'Implement the known change',
        kind: 'engineering',
        objective: 'Implement the accepted design.',
        acceptanceCriteria: ['The accepted behavior works.'],
      } as const),
    ...(overrides.mapMarkdown ? { mapMarkdown: overrides.mapMarkdown } : {}),
    createdAt: '2026-08-14T00:00:00.000Z',
  })
  return { homeRoot, store }
}

function startServer(homeRoot: string, attempts?: ReturnType<typeof createRunAttemptStore>) {
  const server = createServer({ rootDir: homeRoot, port: 0, attempts, startCoordinator: false })
  activeServers.add(server)
  return server
}

async function waitForHealth(base: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${base}/api/health`)
    const body = (await response.json()) as Record<string, unknown>
    if (body.status === 'ok') return body
    await Bun.sleep(5)
  }
  throw new Error('Server did not become healthy')
}

async function request(
  base: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
  return body as Record<string, unknown>
}

async function rawRequest(
  base: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  return response.status
}

async function createRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Repo\n')
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', 'initial'])
  return path
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}

function mapMarkdown(destination: string) {
  return `# Map\n\n## Destination\n\n${destination}\n\n## Notes\n\n- Keep the model small.\n\n## Decisions so far\n\n- None yet.\n\n## Not yet specified\n\n- The current question.\n\n## Out of scope\n\n- Compatibility.\n`
}

function packageWith(works: WorkDocument[]): GoalPackage {
  const goal: GoalDocument = {
    attributes: { id: 'G-1', title: 'Goal', lifecycle: 'active', priority: 0, contractRevision: 1 },
    body: '## Objective\n\nReach it.\n',
  }
  return {
    goal,
    works: new Map(works.map((work) => [work.attributes.id, work])),
    attentions: new Map(),
    evidence: new Map(),
    inputs: new Map(),
  }
}

function engineeringWork(id: string, status: 'open' | 'done'): WorkDocument {
  return {
    attributes: {
      id,
      title: id,
      kind: 'engineering',
      status,
      createdAt: '2026-08-14T00:00:00.000Z',
      notBefore: null,
      dependsOn: [],
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: '## Objective\n\nBuild it.\n',
  }
}
