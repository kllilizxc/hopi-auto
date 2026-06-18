import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner, AgentStepInput } from '../src/agent/AgentRunner'
import { createServer } from '../src/index'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createBoardStore } from '../src/storage/boardStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'project-workflow')
const servers: Array<ReturnType<typeof createServer>> = []
let workspaceCounter = 0

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
  await rm(tmpBase, { recursive: true, force: true })
})

describe('project-scoped workflow MVP', () => {
  test('creates and lists linked projects', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const server = startServer(serverRoot)

    const createResponse = await postJson(server, '/api/projects', {
      projectKey: 'workspace-a',
      name: 'Workspace A',
      rootDir: projectRoot,
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      projectKey: 'workspace-a',
      name: 'Workspace A',
      rootDir: projectRoot,
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
    })
    await expect(
      Bun.file(join(projectRoot, '.hopi', 'runtime', 'agent-adapters.json')).json(),
    ).resolves.toMatchObject({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
      roles: {},
    })

    const listResponse = await fetch(apiUrl(server, '/api/projects'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      projects: [
        expect.objectContaining({
          projectKey: 'workspace-a',
          name: 'Workspace A',
          rootDir: projectRoot,
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.4',
            reasoningEffort: 'xhigh',
          },
        }),
      ],
    })
  })

  test('persists custom coding defaults on create and patch', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const server = startServer(serverRoot)

    const createResponse = await postJson(server, '/api/projects', {
      projectKey: 'workspace-a',
      rootDir: projectRoot,
      codingDefaults: {
        transport: 'claude',
        model: 'sonnet',
      },
    })
    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      projectKey: 'workspace-a',
      codingDefaults: {
        transport: 'claude',
        model: 'sonnet',
      },
    })

    const updateResponse = await patchJson(server, '/api/projects/workspace-a/settings', {
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
    })
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      projectKey: 'workspace-a',
      codingDefaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
    })

    await expect(
      Bun.file(join(projectRoot, '.hopi', 'runtime', 'agent-adapters.json')).json(),
    ).resolves.toMatchObject({
      version: 3,
      defaults: {
        transport: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'xhigh',
      },
    })
  })

  test('rejects duplicate project keys and invalid project paths', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const server = startServer(serverRoot)

    expect(
      await postJson(server, '/api/projects', {
        projectKey: 'workspace-a',
        rootDir: projectRoot,
      }),
    ).toHaveProperty('status', 201)

    const duplicateResponse = await postJson(server, '/api/projects', {
      projectKey: 'workspace-a',
      rootDir: await prepareDir('workspace-b'),
    })
    expect(duplicateResponse.status).toBe(409)
    await expect(duplicateResponse.json()).resolves.toMatchObject({
      error: 'Project already exists: workspace-a',
    })

    const invalidResponse = await postJson(server, '/api/projects', {
      projectKey: 'missing',
      rootDir: join(serverRoot, 'does-not-exist'),
    })
    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining('Project path does not exist'),
    })
  })

  test('creates a goal under a linked project and seeds the initial planning task', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const server = startServer(serverRoot)
    await createProject(server, projectRoot)

    const createResponse = await postJson(server, '/api/projects/workspace-a/goals', {
      goalKey: 'build-mvp-flow',
      title: 'Build MVP flow',
      objective: 'Restore the project-goal-kanban loop.',
      successCriteria: ['Project, goal, and automation flow work end to end.'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      goalKey: 'build-mvp-flow',
      title: 'Build MVP flow',
      objective: 'Restore the project-goal-kanban loop.',
    })

    const boardResponse = await fetch(
      apiUrl(server, '/api/projects/workspace-a/goals/build-mvp-flow/board'),
    )
    expect(boardResponse.status).toBe(200)
    await expect(boardResponse.json()).resolves.toMatchObject({
      goal: {
        goalKey: 'build-mvp-flow',
        title: 'Build MVP flow',
      },
      items: [
        {
          ref: 'plan-goal',
          kind: 'planning',
          status: 'planned',
          title: 'Plan goal',
        },
      ],
    })

    await expect(
      Bun.file(
        join(projectRoot, '.hopi', 'docs', 'goals', 'build-mvp-flow', 'goal.md'),
      ).text(),
    ).resolves.toContain('Restore the project-goal-kanban loop.')
    await expect(
      Bun.file(
        join(projectRoot, '.hopi', 'docs', 'goals', 'build-mvp-flow', 'todo.yml'),
      ).text(),
    ).resolves.toContain('ref: plan-goal')
    await expect(
      Bun.file(
        join(projectRoot, '.hopi', 'docs', 'goals', 'build-mvp-flow', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('taskRef: plan-goal')
    await expect(
      Bun.file(
        join(projectRoot, '.hopi', 'docs', 'goals', 'build-mvp-flow', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('- design.md')
    await expect(
      Bun.file(
        join(projectRoot, '.hopi', 'docs', 'goals', 'build-mvp-flow', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('- todo.yml')
  })

  test('reads project-scoped board state from the linked project root', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const server = startServer(serverRoot)
    await createProject(server, projectRoot)

    await postJson(server, '/api/projects/workspace-a/goals', {
      goalKey: 'shared-goal',
      title: 'Project board title',
      objective: 'Project-scoped board state should win.',
    })

    await createBoardStore(serverRoot).mutateBoard(
      'shared-goal',
      'test',
      'seed legacy board',
      (board) => {
        board.goal.title = 'Legacy board title'
        board.items.push({
          ref: 'legacy-task',
          kind: 'engineering',
          status: 'planned',
          title: 'Legacy task',
          description: 'Legacy root board',
          acceptanceCriteria: ['Legacy root board exists.'],
          blockedBy: [],
        })
      },
    )

    const response = await fetch(apiUrl(server, '/api/projects/workspace-a/goals/shared-goal/board'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      goal: {
        goalKey: 'shared-goal',
        title: 'Project board title',
      },
      items: [expect.objectContaining({ ref: 'plan-goal' })],
    })
  })

  test('starts automation, runs reconcile until idle, and rejects concurrent loops', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    const runner = new PlanningSuccessRunner(projectRoot)
    const server = startServer(serverRoot, runner)
    await createProject(server, projectRoot)
    await postJson(server, '/api/projects/workspace-a/goals', {
      goalKey: 'build-mvp-flow',
      title: 'Build MVP flow',
      objective: 'Restore the project-goal-kanban loop.',
    })

    const firstStart = await postJson(
      server,
      '/api/projects/workspace-a/goals/build-mvp-flow/start',
      {},
    )
    expect(firstStart.status).toBe(200)
    await expect(firstStart.json()).resolves.toMatchObject({
      alreadyRunning: false,
      status: {
        state: 'running',
      },
    })

    const secondStart = await postJson(
      server,
      '/api/projects/workspace-a/goals/build-mvp-flow/start',
      {},
    )
    expect(secondStart.status).toBe(200)
    await expect(secondStart.json()).resolves.toMatchObject({
      alreadyRunning: true,
      status: {
        state: 'running',
      },
    })

    const finalStatus = await waitForAutomationIdle(
      server,
      '/api/projects/workspace-a/goals/build-mvp-flow/automation',
    )
    expect(finalStatus).toMatchObject({
      state: 'idle',
    })
    expect(runner.calls).toBe(2)

    const boardResponse = await fetch(
      apiUrl(server, '/api/projects/workspace-a/goals/build-mvp-flow/board'),
    )
    await expect(boardResponse.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ ref: 'plan-goal', status: 'done' })],
    })
  })

  test('reading automation status does not mutate a running automation loop', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    let releaseRunner!: () => void
    const runnerReleased = new Promise<void>((resolve) => {
      releaseRunner = resolve
    })
    const runner: AgentRunner = {
      async run() {
        await runnerReleased
        return { kind: 'success' }
      },
    }
    const server = startServer(serverRoot, runner)
    await createProject(server, projectRoot)
    await createBoardStore(projectRoot).mutateBoard(
      'status-goal',
      'test',
      'seed running board',
      (board) => {
        board.goal.title = 'Status Goal'
        board.items = [engineeringTask('T-1', 'in_progress')]
      },
    )

    const startResponse = await postJson(
      server,
      '/api/projects/workspace-a/goals/status-goal/start',
      {},
    )
    expect(startResponse.status).toBe(200)

    const firstStatusResponse = await fetch(
      apiUrl(server, '/api/projects/workspace-a/goals/status-goal/automation'),
    )
    expect(firstStatusResponse.status).toBe(200)
    const firstStatusPayload = (await firstStatusResponse.json()) as { status: { state: string } }
    expect(firstStatusPayload.status.state).toBe('running')

    let stableUpdatedAt: string | null = null
    let previousUpdatedAt: string | null = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await fetch(
        apiUrl(server, '/api/projects/workspace-a/goals/status-goal/automation'),
      )
      expect(statusResponse.status).toBe(200)
      const payload = (await statusResponse.json()) as {
        status: {
          state: string
          updatedAt: string
        }
      }
      expect(payload.status.state).toBe('running')
      if (payload.status.updatedAt === previousUpdatedAt) {
        stableUpdatedAt = payload.status.updatedAt
        break
      }
      previousUpdatedAt = payload.status.updatedAt
      await Bun.sleep(25)
    }

    expect(stableUpdatedAt).not.toBeNull()
    if (!stableUpdatedAt) {
      throw new Error('Expected stable updatedAt timestamp')
    }

    await Bun.sleep(10)

    const finalStatusResponse = await fetch(
      apiUrl(server, '/api/projects/workspace-a/goals/status-goal/automation'),
    )
    expect(finalStatusResponse.status).toBe(200)
    const finalStatusPayload = (await finalStatusResponse.json()) as {
      status: {
        state: string
        updatedAt: string
      }
    }
    expect(finalStatusPayload.status.state).toBe('running')
    expect(finalStatusPayload.status.updatedAt).toBe(stableUpdatedAt)

    releaseRunner()
    await waitForAutomationIdle(server, '/api/projects/workspace-a/goals/status-goal/automation')
  })

  test('starts automation with three running tasks by default', async () => {
    const serverRoot = await prepareDir('server-root')
    const projectRoot = await prepareDir('workspace-a')
    let releaseRunners!: () => void
    let resolveThreeStarted!: () => void
    const threeStarted = new Promise<void>((resolve) => {
      resolveThreeStarted = resolve
    })
    const runnersReleased = new Promise<void>((resolve) => {
      releaseRunners = resolve
    })
    const startedTaskRefs: string[] = []
    const runner: AgentRunner = {
      async run(input) {
        startedTaskRefs.push(input.taskRef)
        if (startedTaskRefs.length === 3) {
          resolveThreeStarted()
        }
        await runnersReleased
        return { kind: 'success' }
      },
    }
    const server = startServer(serverRoot, runner)
    await createProject(server, projectRoot)
    await createBoardStore(projectRoot).mutateBoard(
      'parallel-goal',
      'test',
      'seed parallel board',
      (board) => {
        board.goal.title = 'Parallel Goal'
        board.items = [
          engineeringTask('T-1', 'in_progress'),
          engineeringTask('T-2', 'in_progress'),
          engineeringTask('T-3', 'in_progress'),
        ]
      },
    )

    const startResponse = await postJson(
      server,
      '/api/projects/workspace-a/goals/parallel-goal/start',
      {},
    )
    expect(startResponse.status).toBe(200)
    await expect(startResponse.json()).resolves.toMatchObject({
      alreadyRunning: false,
      status: {
        state: 'running',
        maxParallel: 5,
        laneParallelism: {
          in_progress: 3,
          in_review: 1,
          merging: 1,
        },
      },
    })
    await threeStarted

    const boardResponse = await fetch(
      apiUrl(server, '/api/projects/workspace-a/goals/parallel-goal/board'),
    )
    expect(boardResponse.status).toBe(200)
    await expect(boardResponse.json()).resolves.toMatchObject({
      items: [
        expect.objectContaining({ ref: 'T-1', running: true }),
        expect.objectContaining({ ref: 'T-2', running: true }),
        expect.objectContaining({ ref: 'T-3', running: true }),
      ],
    })

    const stopResponse = await postJson(
      server,
      '/api/projects/workspace-a/goals/parallel-goal/stop',
      {},
    )
    expect(stopResponse.status).toBe(200)
    releaseRunners()
    const finalStatus = await waitForAutomationIdle(
      server,
      '/api/projects/workspace-a/goals/parallel-goal/automation',
    )
    expect(finalStatus).toMatchObject({
      state: 'idle',
      stepCount: expect.any(Number),
      maxParallel: 5,
      laneParallelism: {
        in_progress: 3,
        in_review: 1,
        merging: 1,
      },
    })
  })
})

function startServer(rootDir: string, runner?: AgentRunner) {
  const server = createServer({ rootDir, port: 0, runner })
  servers.push(server)
  return server
}

async function createProject(server: ReturnType<typeof createServer>, rootDir: string) {
  const response = await postJson(server, '/api/projects', {
    projectKey: 'workspace-a',
    name: 'Workspace A',
    rootDir,
  })
  expect(response.status).toBe(201)
}

function engineeringTask(ref: string, status: 'in_progress') {
  return {
    ref,
    kind: 'engineering' as const,
    status,
    title: `Task ${ref}`,
    description: `Do ${ref}.`,
    acceptanceCriteria: [`${ref} is complete.`],
    blockedBy: [],
  }
}

async function prepareDir(name: string) {
  const dir = join(tmpBase, `${workspaceCounter += 1}-${name}`)
  await mkdir(dir, { recursive: true })
  return dir
}

async function postJson(
  server: ReturnType<typeof createServer>,
  path: string,
  body: unknown,
) {
  return fetch(apiUrl(server, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patchJson(
  server: ReturnType<typeof createServer>,
  path: string,
  body: unknown,
) {
  return fetch(apiUrl(server, path), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function apiUrl(server: ReturnType<typeof createServer>, path: string) {
  return `http://127.0.0.1:${server.port}${path}`
}

async function waitForAutomationIdle(
  server: ReturnType<typeof createServer>,
  path: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(apiUrl(server, path))
    const payload = (await response.json()) as {
      status: {
        state: string
      }
    }
    if (payload.status.state !== 'running') {
      return payload.status
    }
    await Bun.sleep(25)
  }

  throw new Error(`Automation did not settle for ${path}`)
}

class PlanningSuccessRunner implements AgentRunner {
  calls = 0
  private readonly traces: ReturnType<typeof createWriteTraceStore>

  constructor(private readonly rootDir: string) {
    this.traces = createWriteTraceStore(rootDir)
  }

  async run(input: AgentStepInput) {
    this.calls += 1
    if (input.role === 'planner') {
      const goalDir = `.hopi/docs/goals/${input.goalKey}`
      await this.traces.appendEntry(input.goalKey, {
        runId: input.runId,
        stepId: input.stepId,
        taskRef: input.taskRef,
        role: 'planner',
        agent: 'process_runner',
        cwd: this.rootDir,
        toolName: 'process',
        callId: input.stepId,
        targetPaths: [`${goalDir}/design.md`, `${goalDir}/todo.yml`],
        changes: [
          { path: `${goalDir}/design.md`, kind: 'modified' },
          { path: `${goalDir}/todo.yml`, kind: 'modified' },
        ],
        argumentSummary: 'planner updated durable design and task graph',
        resultSummary: 'exit 0 (2 changed files)',
      })
    }
    await Bun.sleep(30)
    return { kind: 'success' as const }
  }
}
