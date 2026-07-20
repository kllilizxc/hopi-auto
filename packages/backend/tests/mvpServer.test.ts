import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'
import type { AssistantModelRunner } from '../src/assistant/workspaceAssistant'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import {
  createServer,
  deriveAssistantFeedActivity,
  deriveWorkCompletedAt,
  latestAgentPlan,
  presentAttempt,
} from '../src/mvpServer'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { acknowledgeGoalAttention } from '../src/runtime/attentionDelivery'
import { createGoalController } from '../src/runtime/goalController'
import { HostDirectoryPickerError } from '../src/runtime/hostDirectoryPicker'
import { type RunAttemptSummary, createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { runStoragePath } from '../src/runtime/runPaths'
import { createWorkspaceAttentionController } from '../src/runtime/workspaceAttentionController'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
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

describe('MVP server', () => {
  test('projects one prioritized conversation activity from public and hidden model work', () => {
    expect(
      deriveAssistantFeedActivity({
        publicStatuses: [],
        internalSpeakingRunning: false,
        reflectionRunning: true,
      }),
    ).toEqual({ phase: 'thinking' })
    expect(
      deriveAssistantFeedActivity({
        publicStatuses: ['queued'],
        internalSpeakingRunning: true,
        reflectionRunning: false,
      }),
    ).toEqual({ phase: 'thinking' })
    expect(
      deriveAssistantFeedActivity({
        publicStatuses: ['running'],
        internalSpeakingRunning: true,
        reflectionRunning: true,
      }),
    ).toEqual({ phase: 'working' })
    expect(
      deriveAssistantFeedActivity({
        publicStatuses: ['queued'],
        internalSpeakingRunning: false,
        reflectionRunning: false,
      }),
    ).toEqual({ phase: 'waiting' })
  })

  test('preserves an explicit stale Attempt diagnosis when Evidence is unconsumed', () => {
    const producerRun = 'project:P-1/goal:G-1/work:W-1/run:R-1'
    const goalPackage = {
      goal: {
        attributes: {
          id: 'G-1',
          title: 'Goal',
          lifecycle: 'active',
          priority: 0,
          contractRevision: 1,
          completionAttentionId: null,
        },
        body: 'Goal.\n',
      },
      works: new Map([
        [
          'W-1',
          {
            attributes: {
              id: 'W-1',
              title: 'Work',
              kind: 'engineering',
              stage: 'review',
              notBefore: null,
              dependsOn: [],
              contractRevision: 1,
              evidenceRefs: [],
              attempts: 0,
            },
            body: 'Work.\n',
          },
        ],
      ]),
      attentions: new Map(),
      evidence: new Map([
        [
          'E-1',
          {
            attributes: {
              id: 'E-1',
              createdAt: '2026-07-11T00:00:00Z',
              producerRun,
              coordinatorCheck: null,
              owner: 'project:P-1/goal:G-1/work:W-1',
              artifacts: [],
            },
            body: '## Responsibility Result\n\n- Result: reject\n\n## Summary\n\nRejected.\n',
          },
        ],
      ]),
      inputs: [],
      design: new Map(),
    } as GoalPackage
    const attempt = {
      runId: 'R-1',
      workId: 'W-1',
      result: 'reject',
      summary: 'Rejected. Stale result: owning Work changed.',
      application: 'stale',
    }

    expect(presentAttempt(attempt, goalPackage, 'P-1', 'G-1')).toEqual(attempt)
  })

  test('derives Done completion from the Attempt that applied the terminal transition', () => {
    const attempt = (overrides: Partial<RunAttemptSummary> = {}): RunAttemptSummary => ({
      version: 1,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      runId: 'R-1',
      responsibility: 'reviewer',
      execution: null,
      startedAt: '2026-07-11T00:00:00Z',
      endedAt: '2026-07-11T00:05:00Z',
      status: 'finished',
      result: 'success',
      summary: 'Integrated.',
      exitCode: 0,
      application: 'integrated',
      ...overrides,
    })

    expect(
      deriveWorkCompletedAt({ kind: 'engineering', stage: 'done' }, [
        attempt({
          runId: 'R-generator',
          responsibility: 'generator',
          endedAt: '2026-07-11T00:04:00Z',
          application: 'published',
        }),
        attempt({ runId: 'R-reviewer' }),
      ]),
    ).toBe('2026-07-11T00:05:00Z')
    expect(
      deriveWorkCompletedAt({ kind: 'planning', stage: 'done' }, [
        attempt({ responsibility: 'planner', application: 'published' }),
      ]),
    ).toBe('2026-07-11T00:05:00Z')
    expect(
      deriveWorkCompletedAt({ kind: 'engineering', stage: 'done' }, [
        attempt({ application: null }),
      ]),
    ).toBe('2026-07-11T00:05:00Z')
    expect(deriveWorkCompletedAt({ kind: 'engineering', stage: 'review' }, [attempt()])).toBeNull()
    expect(
      deriveWorkCompletedAt({ kind: 'engineering', stage: 'done' }, [
        attempt({ result: 'reject', application: 'published' }),
      ]),
    ).toBeNull()
  })

  test('serves the React product frontend at root and Goal routes', async () => {
    const server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const routes = ['/', '/projects', '/projects/P-1/board/G-1', '/projects/P-1/docs/G-1']
    let rootHtml = ''
    for (const path of routes) {
      const response = await fetch(`${base}${path}`)
      const html = await response.text()

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(html).toContain('id="root"')
      expect(html).toContain('HOPI')
      if (path === '/') rootHtml = html
    }

    const assetPaths = [...rootHtml.matchAll(/(?:src|href)="([^"#]+)"/g)].map(
      (match) => match[1] as string,
    )
    expect(assetPaths.length).toBeGreaterThan(0)
    for (const path of assetPaths) {
      const response = await fetch(new URL(path, base))
      const asset = await response.text()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).not.toContain('application/json')
      if (response.headers.get('content-type')?.includes('text/css')) {
        expect(asset).not.toContain('@apply')
        expect(asset).not.toContain('@theme')
        expect(asset).toContain('.button--primary')
      }
    }
  })

  test('keeps host directory selection retryable after a chooser failure', async () => {
    let attempts = 0
    const pickerRepo = await createRepo(join(temporaryRoot, 'picker-repo'))
    const selectedPath = join(pickerRepo, 'apps', 'web')
    await mkdir(selectedPath, { recursive: true })
    const server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      startCoordinator: false,
      directoryPicker: async () => {
        attempts += 1
        if (attempts === 1) throw new HostDirectoryPickerError('Folder chooser failed')
        return attempts === 2 ? selectedPath : null
      },
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const failed = await fetch(`${base}/api/system/select-directory`, {
      method: 'POST',
    })
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ error: 'Folder chooser failed' })

    const selected = await fetch(`${base}/api/system/select-directory`, {
      method: 'POST',
    })
    expect(selected.status).toBe(200)
    expect(await selected.json()).toEqual({
      selection: {
        kind: 'git_repository',
        path: await realpath(selectedPath),
        repoPath: await realpath(pickerRepo),
        projectPath: 'apps/web',
      },
    })

    const cancelled = await fetch(`${base}/api/system/select-directory`, {
      method: 'POST',
    })
    expect(cancelled.status).toBe(200)
    expect(await cancelled.json()).toEqual({ selection: null })
  })

  test('keeps an Assistant lifecycle conflict request-local and the server available', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({
      projectId: 'P-1',
      repoPath: repoRoot,
    })
    const goalStore = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
    await goalStore.createGoal({
      goalId: 'G-1',
      title: 'Goal',
      objective: 'Ship it.',
    })
    await createGoalController(goalStore, {
      verifyCompletion: () => false,
    }).cancelGoal('G-1')

    const toolStatuses: number[] = []
    const assistantRunner: AssistantModelRunner = {
      async run(input) {
        if (input.toolMode === 'reflection') {
          return {
            reply: '',
            session: { transport: 'codex', sessionId: 'reflection-noop' },
          }
        }
        const conflict = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_start_planning',
            arguments: {
              projectId: 'P-1',
              goalId: 'G-1',
              mode: 'new_contract_revision',
            },
          }),
        })
        toolStatuses.push(conflict.status)
        expect(await conflict.json()).toEqual({
          error: 'Terminal Goal must be explicitly reopened',
        })

        const state = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_read_state',
            arguments: { projectId: 'P-1', goalId: 'G-1' },
          }),
        })
        toolStatuses.push(state.status)
        expect(await state.json()).toMatchObject({
          summary: 'Read current HOPI state.',
        })
        return {
          reply: 'The Goal must be reopened before revising it.',
          session: { transport: 'codex', sessionId: 'main-after-conflict' },
        }
      },
    }
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      assistantRunner,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const submitted = await request(base, '/api/inbox', {
      method: 'POST',
      body: {
        content: 'Revise the completed outcome.',
        context: { projectId: 'P-1', goalId: 'G-1' },
      },
    })
    let handled = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const feed = await request(base, '/api/assistant/feed?limit=20')
      const event = (feed.items as Array<{ event?: { id: string; status: string } }>).find(
        (item) => item.event?.id === submitted.eventId,
      )?.event
      if (event?.status === 'handled') {
        handled = true
        break
      }
      await Bun.sleep(20)
    }

    expect(handled).toBe(true)
    expect(toolStatuses).toEqual([409, 200])
    expect((await fetch(`${base}/api/state`)).status).toBe(200)
  })

  test('exposes a linked Project to later same-turn tools before refreshing runtime', async () => {
    const homeRoot = join(temporaryRoot, 'assistant-project-home')
    const repoRoot = await createRepo(join(temporaryRoot, 'assistant-project-repo'))
    let speakingRuns = 0
    const assistantRunner: AssistantModelRunner = {
      async run(input) {
        if (input.toolMode === 'reflection') {
          return {
            reply: '',
            session: { transport: 'codex', sessionId: 'reflection-project-change' },
          }
        }
        speakingRuns += 1
        const projectResponse = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_manage_project',
            arguments: {
              operation: 'link_project',
              projectId: 'P-via-assistant',
              primaryRepoId: 'primary',
              repos: [{ repoId: 'primary', repoPath: repoRoot }],
            },
          }),
        })
        expect(projectResponse.status).toBe(200)
        expect(await projectResponse.json()).toMatchObject({
          changed: true,
          value: {
            runtimeRefresh: 'after_current_turn',
            project: { projectId: 'P-via-assistant' },
          },
        })

        const goalResponse = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_create_goal',
            arguments: {
              projectId: 'P-via-assistant',
              goalId: 'G-pixel-sprite-experiment',
              title: 'Generate a right-moving pixel spritesheet',
              objective: 'Create and evaluate the first WAN 2.2 Animate pixel-art character asset.',
              firstWork: {
                kind: 'planning',
                title: 'Plan the WAN 2.2 Animate spritesheet',
                objective:
                  'Decide how to create and evaluate the pixel-art spritesheet with WAN 2.2 Animate.',
                acceptanceCriteria: [
                  'The plan preserves WAN 2.2 Animate as an explicit implementation constraint.',
                ],
              },
            },
          }),
        })
        expect(goalResponse.status).toBe(200)
        expect(await goalResponse.json()).toMatchObject({
          changed: true,
          value: {
            projectId: 'P-via-assistant',
            goalId: 'G-pixel-sprite-experiment',
          },
        })

        const modelResponse = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_configure_model',
            arguments: {
              role: 'assistant',
              codingDefaults: { transport: 'claude', model: 'sonnet' },
            },
          }),
        })
        expect(modelResponse.status).toBe(200)
        expect(await modelResponse.json()).toMatchObject({
          changed: true,
          value: {
            role: 'assistant',
            codingDefaults: { transport: 'claude', model: 'sonnet' },
          },
        })
        return {
          reply:
            'Linked Project P-via-assistant, created its first Goal, and changed the Assistant model.',
          session: { transport: 'codex', sessionId: 'session-before-model-change' },
        }
      },
    }
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      assistantRunner,
      roleRunner: {
        async run() {
          return {
            result: 'fail',
            summary: 'Test runner does not execute newly scheduled Planning.',
            artifacts: [],
            exitCode: 1,
            failureKind: 'operational',
          }
        },
      },
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const submitted = await request(base, '/api/inbox', {
      method: 'POST',
      body: { content: 'Link this repository and use Claude for our conversation.' },
    })
    let reply: string | null = null
    let topologyVisible = false
    let goalVisible = false
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [feed, state] = await Promise.all([
        request(base, '/api/assistant/feed?limit=20'),
        request(base, '/api/state'),
      ])
      const event = (
        feed.items as Array<{ event?: { id: string; status: string; reply: string } }>
      ).find((item) => item.event?.id === submitted.eventId)?.event
      if (event?.status === 'handled') reply = event.reply
      topologyVisible = Boolean(
        (state.projects as Array<{ projectId: string }>).some(
          (project) => project.projectId === 'P-via-assistant',
        ),
      )
      goalVisible = Boolean(
        (
          state.projects as Array<{
            projectId: string
            goals: Array<{ id: string }>
          }>
        )
          .find((project) => project.projectId === 'P-via-assistant')
          ?.goals.some((goal) => goal.id === 'G-pixel-sprite-experiment'),
      )
      if (reply && topologyVisible && goalVisible) {
        expect(state).toMatchObject({
          home: {
            agentRoleCodingDefaults: {
              assistant: {
                codingDefaults: { transport: 'claude', model: 'sonnet' },
                inherited: false,
              },
            },
          },
        })
        break
      }
      await Bun.sleep(20)
    }

    expect(reply).toBe(
      'Linked Project P-via-assistant, created its first Goal, and changed the Assistant model.',
    )
    expect(topologyVisible).toBe(true)
    expect(goalVisible).toBe(true)
    expect(speakingRuns).toBe(1)
    expect(
      await Bun.file(join(homeRoot, '.hopi', 'runtime', 'assistant', 'session.json')).exists(),
    ).toBe(false)
  })

  test('shares one host directory chooser across concurrent requests', async () => {
    let attempts = 0
    const pickerRepo = await createRepo(join(temporaryRoot, 'single-flight-picker-repo'))
    const server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      startCoordinator: false,
      directoryPicker: async () => {
        attempts += 1
        await Bun.sleep(50)
        return pickerRepo
      },
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        fetch(`${base}/api/system/select-directory`, { method: 'POST' }),
      ),
    )

    expect(attempts).toBe(1)
    for (const response of responses) {
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        selection: {
          kind: 'git_repository',
          path: await realpath(pickerRepo),
          repoPath: await realpath(pickerRepo),
          projectPath: '.',
        },
      })
    }
  })

  test('initializes an explicitly confirmed empty project directory', async () => {
    const selectedPath = join(temporaryRoot, 'empty-project')
    await mkdir(selectedPath)
    const server = createServer({
      rootDir: join(temporaryRoot, 'home'),
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const response = await fetch(`${base}/api/system/initialize-repository`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: selectedPath }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      selection: {
        kind: 'git_repository',
        path: await realpath(selectedPath),
        repoPath: await realpath(selectedPath),
        projectPath: '.',
      },
    })
    expect(await git(selectedPath, ['branch', '--show-current'])).toBe('main')
    expect(await git(selectedPath, ['log', '-1', '--pretty=%s'])).toBe(
      'chore: initialize repository',
    )
  })

  test('projects only the latest Agent plan snapshot without merging revisions', () => {
    expect(
      latestAgentPlan([
        {
          kind: 'plan',
          transport: 'codex',
          planId: 'plan-1',
          status: 'active',
          items: [{ text: 'Old step', completed: false }],
        },
        {
          kind: 'plan',
          transport: 'codex',
          planId: 'plan-2',
          status: 'active',
          items: [{ text: 'Replacement step', completed: true }],
        },
        {
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'assistant',
          summary: 'Continuing after the plan update.',
        },
      ]),
    ).toMatchObject({
      planId: 'plan-2',
      items: [{ text: 'Replacement step', completed: true }],
    })
  })

  test('starts Project Preview from the selected Git subdirectory scope', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    const selectedPath = join(repoRoot, 'apps', 'web')
    await mkdir(selectedPath, { recursive: true })
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    await request(base, '/api/projects', {
      method: 'POST',
      body: {
        projectId: 'P-scoped',
        primaryRepoId: 'web',
        repos: [{ repoId: 'web', repoPath: repoRoot, projectPath: 'apps/web' }],
      },
    })
    const preview = await request(base, '/api/projects/P-scoped/preview/start', {
      method: 'POST',
    })

    expect(preview).toMatchObject({
      kind: 'repair_required',
      reason: 'missing',
    })
    expect(preview.prompt).toContain('/apps/web/scripts/hopi/preview')
  })

  test('derives an omitted Project ID from the primary selected folder', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'monorepo'))
    const selectedPath = join(repoRoot, 'apps', 'product-web')
    await mkdir(selectedPath, { recursive: true })
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const state = await request(base, '/api/projects', {
      method: 'POST',
      body: {
        primaryRepoId: 'web',
        repos: [
          {
            repoId: 'web',
            repoPath: repoRoot,
            projectPath: 'apps/product-web',
          },
        ],
      },
    })

    expect(state).toMatchObject({ projects: [{ projectId: 'P-product-web' }] })
  })

  test('derives readable unique Goal IDs from titles without exposing identity input', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, '产品工作台'))
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const state = await request(base, '/api/projects', {
      method: 'POST',
      body: {
        primaryRepoId: 'primary',
        repos: [{ repoId: 'primary', repoPath: repoRoot }],
      },
    })
    expect(state).toMatchObject({ projects: [{ projectId: 'P-产品工作台' }] })

    const projectPath = `/api/projects/${encodeURIComponent('P-产品工作台')}`
    const first = await request(base, `${projectPath}/goals`, {
      method: 'POST',
      body: {
        title: '优化整体前端样式',
        objective: '统一页面颜色、间距与反馈。',
      },
    })
    const second = await request(base, `${projectPath}/goals`, {
      method: 'POST',
      body: { title: '优化整体前端样式', objective: '继续优化另一套界面。' },
    })

    expect(first).toMatchObject({
      projectId: 'P-产品工作台',
      goal: { id: 'G-优化整体前端样式', title: '优化整体前端样式' },
    })
    expect(second).toMatchObject({ goal: { id: 'G-优化整体前端样式-2' } })
    expect(
      await request(base, `${projectPath}/goals/${encodeURIComponent('G-优化整体前端样式')}`),
    ).toMatchObject({ goal: { id: 'G-优化整体前端样式' } })
  })

  test('exposes canonical product APIs and Work Attempt streams', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    const before = await checkoutSnapshot(repoRoot)
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const linkedState = await request(base, '/api/projects', {
      method: 'POST',
      body: { projectId: 'P-1', repoPath: repoRoot },
    })
    expect(linkedState).toMatchObject({ projects: [{ projectId: 'P-1' }] })
    const assistantSessionPath = join(homeRoot, '.hopi', 'runtime', 'assistant', 'session.json')
    await mkdir(join(assistantSessionPath, '..'), { recursive: true })
    await Bun.write(
      assistantSessionPath,
      JSON.stringify({
        version: 1,
        transport: 'codex',
        sessionId: 'old-codex-session',
      }),
    )
    expect(
      await request(base, '/api/agent-roles/assistant/settings', {
        method: 'PATCH',
        body: {
          codingDefaults: {
            transport: 'opencode',
            model: 'anthropic/claude-sonnet-4-5',
          },
        },
      }),
    ).toMatchObject({
      home: {
        agentRoleCodingDefaults: {
          assistant: {
            codingDefaults: {
              transport: 'opencode',
              model: 'anthropic/claude-sonnet-4-5',
            },
            inherited: false,
          },
        },
      },
    })
    expect(await Bun.file(assistantSessionPath).exists()).toBe(false)
    await Bun.write(
      assistantSessionPath,
      JSON.stringify({
        version: 1,
        transport: 'opencode',
        sessionId: 'opencode-session',
      }),
    )
    expect(
      await request(base, '/api/agent-roles/assistant/settings', {
        method: 'PATCH',
        body: {
          codingDefaults: {
            transport: 'opencode',
            model: 'openai/gpt-5.4',
          },
        },
      }),
    ).toMatchObject({
      home: {
        agentRoleCodingDefaults: {
          assistant: {
            codingDefaults: {
              transport: 'opencode',
              model: 'openai/gpt-5.4',
            },
          },
        },
      },
    })
    expect(await Bun.file(assistantSessionPath).json()).toMatchObject({
      transport: 'opencode',
      sessionId: 'opencode-session',
    })
    expect(
      await request(base, '/api/agent-roles/reviewer/settings', {
        method: 'PATCH',
        body: {
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
          },
        },
      }),
    ).toMatchObject({
      home: {
        agentRoleCodingDefaults: {
          assistant: {
            codingDefaults: { transport: 'opencode', model: 'openai/gpt-5.4' },
            inherited: false,
          },
          planner: { inherited: true },
          generator: { inherited: true },
          reviewer: {
            codingDefaults: {
              transport: 'codex',
              model: 'gpt-5.5',
              reasoningEffort: 'high',
            },
            inherited: false,
          },
        },
      },
    })
    expect(await Bun.file(assistantSessionPath).json()).toMatchObject({
      transport: 'opencode',
      sessionId: 'opencode-session',
    })
    const created = await request(base, '/api/projects/P-1/goals', {
      method: 'POST',
      body: {
        goalId: 'G-1',
        title: 'Ship MVP',
        objective: 'Align implementation.',
      },
    })
    expect(created).toMatchObject({
      projectId: 'P-1',
      goal: { id: 'G-1', lifecycle: 'active' },
      works: [
        {
          kind: 'planning',
          completedAt: null,
          runAttemptCount: 0,
          projection: { column: 'Plan' },
        },
      ],
    })
    const linkedRepo = (
      linkedState.projects as Array<{
        repos: Array<{ integrationRoot: string; projectPath: string }>
      }>
    )[0]?.repos[0]
    if (!linkedRepo) throw new Error('Linked Project has no primary Repo')
    const linkedStore = createGoalPackageStore(
      linkedRepo.integrationRoot,
      'P-1',
      new PublicationCoordinator(),
      linkedRepo.projectPath,
    )
    await linkedStore.publishGoal('G-1', {
      supportingWrites: [
        {
          path: linkedStore.paths.attentionDocument('G-1', 'A-board-routing'),
          expectedHash: null,
          content: renderAttentionDocument({
            attributes: {
              id: 'A-board-routing',
              target: 'project:P-1/goal:G-1/work:plan-initial',
              createdAt: '2026-07-11T00:00:00Z',
              resolvedAt: null,
              notifiedAt: null,
            },
            body: '## Needs you\n\nChoose the delivery strategy without sending this body to Board.\n',
          }),
        },
        {
          path: linkedStore.paths.attentionDocument('G-1', 'A-board-resolved'),
          expectedHash: null,
          content: renderAttentionDocument({
            attributes: {
              id: 'A-board-resolved',
              target: 'project:P-1/goal:G-1/work:plan-initial',
              createdAt: '2026-07-10T00:00:00Z',
              resolvedAt: '2026-07-10T01:00:00Z',
              notifiedAt: '2026-07-10T00:05:00Z',
            },
            body: '## Resolved\n\nHistorical Attention stays in the full Goal only.\n',
          }),
        },
      ],
    })
    const boardProjection = await request(base, '/api/projects/P-1/goals/G-1?view=board')
    expect(boardProjection).toMatchObject({
      goal: { id: 'G-1' },
      works: [{ id: 'plan-initial', projection: { column: 'Plan' } }],
    })
    expect(boardProjection.design).toBeUndefined()
    expect(boardProjection.evidence).toBeUndefined()
    expect((boardProjection.works as Array<Record<string, unknown>>)[0]?.body).toBeUndefined()
    expect(boardProjection.attentions).toMatchObject([{ id: 'A-board-routing' }])
    expect(boardProjection.attentions).toHaveLength(1)
    expect((boardProjection.attentions as Array<Record<string, unknown>>)[0]?.body).toBeUndefined()
    const fullProjection = await request(base, '/api/projects/P-1/goals/G-1')
    const fullAttentions = fullProjection.attentions as Array<{ id: string; body: string }>
    expect(fullAttentions).toHaveLength(2)
    expect(fullAttentions.find((attention) => attention.id === 'A-board-routing')).toMatchObject({
      body: expect.stringContaining('Choose the delivery strategy'),
    })
    const docsProjection = await request(base, '/api/projects/P-1/goals/G-1?view=docs')
    const firstDesign = (docsProjection.design as Array<{ path: string; excerpt: string }>)[0]
    expect(docsProjection).toMatchObject({ goal: { id: 'G-1' }, evidence: [] })
    expect(typeof firstDesign?.path).toBe('string')
    expect(typeof firstDesign?.excerpt).toBe('string')
    expect(docsProjection.works).toBeUndefined()
    expect(docsProjection.attentions).toBeUndefined()
    expect((docsProjection.design as Array<Record<string, unknown>>)[0]?.content).toBeUndefined()
    const designPath = firstDesign?.path
    expect(
      await request(
        base,
        `/api/projects/P-1/goals/G-1/documents?path=${encodeURIComponent(designPath ?? '')}`,
      ),
    ).toMatchObject({ path: designPath, content: expect.any(String) })
    expect(await request(base, '/api/projects/P-1/goals/G-1/works/plan-initial')).toMatchObject({
      id: 'plan-initial',
      body: expect.any(String),
    })
    expect(await request(base, '/api/state?view=shell')).toMatchObject({ attentions: [] })
    const assistantAttentionProjection = await request(base, '/api/assistant/attentions')
    expect(assistantAttentionProjection.attentions).toHaveLength(2)
    expect(
      (assistantAttentionProjection.attentions as Array<{ id: string; body: string }>).find(
        (attention) => attention.id === 'A-board-routing',
      ),
    ).toMatchObject({
      body: expect.stringContaining('Choose the delivery strategy'),
    })
    const attemptStore = createRunAttemptStore(homeRoot, {
      now: () => new Date('2026-07-11T00:00:00Z'),
    })
    const attempt = await attemptStore.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      runId: 'R-1',
      responsibility: 'planner',
      runRoot: join(homeRoot, '.hopi', 'runtime', 'runs', 'R-1'),
    })
    await Bun.write(
      join(homeRoot, '.hopi', 'runtime', 'runs', 'R-1', 'prompt.md'),
      '# Planner system prompt\n\nCreate the Engineering Work DAG.\n',
    )
    await attempt.record({
      kind: 'message',
      level: 'info',
      role: 'planner',
      content: 'Planning the Engineering Work DAG.',
    })
    await Bun.write(
      join(homeRoot, '.hopi', 'runtime', 'runs', 'R-1', 'transcript.log'),
      'stdout: {"type":"turn.completed","usage":{"input_tokens":400,"cached_input_tokens":250,"output_tokens":30,"reasoning_output_tokens":10}}\n',
    )
    expect(
      await request(base, '/api/projects/P-1/goals/G-1/works/plan-initial/attempts'),
    ).toMatchObject({
      attempts: [
        {
          runId: 'R-1',
          status: 'running',
          diagnostics: { tokenUsage: { inputTokens: 400, cachedInputTokens: 250 } },
        },
      ],
      summary: { runs: 1, runsWithTokenUsage: 1, inputTokens: 400 },
    })
    expect(await request(base, '/api/projects/P-1/goals/G-1/execution-cost')).toMatchObject({
      goalId: 'G-1',
      summary: { runs: 1, inputTokens: 400 },
      byResponsibility: [
        { responsibility: 'planner', summary: { runs: 1 } },
        { responsibility: 'generator', summary: { runs: 0 } },
        { responsibility: 'reviewer', summary: { runs: 0 } },
      ],
    })
    expect(await request(base, '/api/projects/P-1/goals/G-1')).toMatchObject({
      works: [{ id: 'plan-initial', runAttemptCount: 1 }],
    })
    const attemptDetail = await request(
      base,
      '/api/projects/P-1/goals/G-1/works/plan-initial/attempts/R-1',
    )
    expect(attemptDetail).toMatchObject({
      runId: 'R-1',
      runPrompt: '# Planner system prompt\n\nCreate the Engineering Work DAG.\n',
    })
    expect(attemptDetail.events).toBeUndefined()
    const eventHead = await request(
      base,
      '/api/projects/P-1/goals/G-1/works/plan-initial/attempts/R-1/events?limit=1',
    )
    expect(eventHead).toMatchObject({
      items: [
        {
          kind: 'message',
          role: 'planner',
          content: 'Planning the Engineering Work DAG.',
        },
      ],
      pageInfo: { hasOlder: true, hasNewer: false, totalCount: 2 },
    })
    const eventHeadInfo = eventHead.pageInfo as {
      oldestCursor: string
      newestCursor: string
    }
    const olderEvents = await request(
      base,
      `/api/projects/P-1/goals/G-1/works/plan-initial/attempts/R-1/events?limit=1&before=${encodeURIComponent(eventHeadInfo.oldestCursor)}`,
    )
    expect(olderEvents).toMatchObject({
      items: [{ kind: 'message', role: 'coordinator' }],
      pageInfo: { hasOlder: false, hasNewer: true, totalCount: 2 },
    })
    const olderInfo = olderEvents.pageInfo as { newestCursor: string }
    expect(
      await request(
        base,
        `/api/projects/P-1/goals/G-1/works/plan-initial/attempts/R-1/events?limit=1&after=${encodeURIComponent(olderInfo.newestCursor)}`,
      ),
    ).toMatchObject({
      items: [
        {
          kind: 'message',
          role: 'planner',
          content: 'Planning the Engineering Work DAG.',
        },
      ],
      pageInfo: { hasNewer: false },
    })
    await attempt.record({
      kind: 'plan',
      transport: 'codex',
      planId: 'planner-plan',
      status: 'active',
      items: [
        { text: 'Inspect the Goal contract', completed: true },
        { text: 'Publish the Work DAG', completed: false },
      ],
      vendorEventType: 'item.updated',
    })
    expect(
      await request(
        base,
        '/api/projects/P-1/goals/G-1/works/plan-initial/attempts/R-1/events?limit=10',
      ),
    ).toMatchObject({
      items: [
        {},
        {},
        {
          kind: 'plan',
          planId: 'planner-plan',
          status: 'active',
          items: [{ completed: true }, { completed: false }],
          streamIndex: 2,
        },
      ],
    })

    const paused = await request(base, '/api/projects/P-1/goals/G-1/pause', {
      method: 'POST',
    })
    expect(paused).toMatchObject({ goal: { lifecycle: 'paused' } })
    const resumed = await request(base, '/api/projects/P-1/goals/G-1/resume', {
      method: 'POST',
    })
    expect(resumed).toMatchObject({ goal: { lifecycle: 'active' } })
    const message = await request(base, '/api/inbox', {
      method: 'POST',
      body: {
        content: 'Update the design before implementation.',
        context: { projectId: 'P-1', goalId: 'G-1' },
      },
    })
    expect(message).toMatchObject({ status: 'pending' })
    const revised = await request(base, '/api/projects/P-1/goals/G-1')
    expect(revised).toMatchObject({ goal: { contractRevision: 1 } })
    const cancelled = await request(base, '/api/projects/P-1/goals/G-1/cancel', {
      method: 'POST',
    })
    expect(cancelled).toMatchObject({ goal: { lifecycle: 'cancelled' } })
    const reopened = await request(base, '/api/projects/P-1/goals/G-1/reopen', {
      method: 'POST',
    })
    expect(reopened).toMatchObject({
      goal: { lifecycle: 'active', contractRevision: 2 },
    })

    const state = await request(base, '/api/state')
    expect(state).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          goals: [{ id: 'G-1', createdAt: expect.any(String) }],
        },
      ],
    })
    expect(state.events).toBeUndefined()
    const assistantFeed = await request(base, '/api/assistant/feed')
    const assistantEntries = assistantFeed.items as Array<{
      kind: string
      event?: { id: string }
    }>
    expect(assistantEntries).toHaveLength(6)
    expect(assistantEntries.find((entry) => entry.event?.id === message.eventId)).toMatchObject({
      kind: 'event',
      event: {
        status: 'pending',
        context: { projectId: 'P-1', goalId: 'G-1' },
        routeClaim: null,
        runtimeStatus: 'queued',
        runtimeEvents: [],
      },
    })
    const preview = await request(base, '/api/projects/P-1/preview/start', {
      method: 'POST',
    })
    expect(preview).toMatchObject({
      kind: 'repair_required',
      reason: 'missing',
    })
    const repair = await request(base, '/api/preview/repair', {
      method: 'POST',
      body: {
        prompt: preview.prompt,
        context: { projectId: 'P-1', goalId: 'G-1' },
      },
    })
    const repairFeed = await request(base, '/api/assistant/feed')
    const repairEntries = repairFeed.items as Array<{
      event?: {
        id: string
        status: string
        context: { projectId: string; goalId: string } | null
      }
    }>
    expect(repairEntries.find((entry) => entry.event?.id === repair.eventId)).toMatchObject({
      event: {
        status: 'pending',
        context: { projectId: 'P-1', goalId: 'G-1' },
      },
    })
    expect(await checkoutSnapshot(repoRoot)).toEqual(before)
  })

  test('keeps Project Attention explicit after rebind and exposes it on the Board contract', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({
      projectId: 'P-1',
      repoPath: repoRoot,
    })
    const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
    await createGoalPackageStore(linked.integrationRoot, 'P-1', publisher).createGoal({
      goalId: 'G-1',
      title: 'Goal',
      objective: 'Ship it.',
    })
    await createWorkspaceAttentionController(workspace).ensureProjectAttention(
      'P-1',
      'The Repo path moved.',
    )
    const movedRepo = join(temporaryRoot, 'moved-repo')
    await rename(repoRoot, movedRepo)
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    const blockedPreview = await fetch(`${base}/api/projects/P-1/preview/start`, { method: 'POST' })
    expect(blockedPreview.status).toBe(409)
    expect(await request(base, '/api/state')).toMatchObject({
      projects: [{ projectId: 'P-1', openAttentionCount: 1 }],
    })
    const blockedGoal = await request(base, '/api/projects/P-1/goals/G-1')
    expect(blockedGoal).toMatchObject({
      projectAttention: {
        scope: 'workspace',
        projectId: 'P-1',
        target: 'project:P-1',
        createdAt: expect.any(String),
        body: expect.stringContaining('The Repo path moved.'),
      },
      works: [
        {
          blockedBy: 'Project',
          projection: {
            primaryBadge: 'waiting',
            failedPredicates: ['project_ineligible'],
          },
        },
      ],
    })

    const state = await request(base, '/api/projects/P-1/rebind', {
      method: 'POST',
      body: { repoPath: movedRepo },
    })
    const attentions = state.attentions as Array<{
      target: string
      resolvedAt: string | null
    }>

    expect(
      attentions.find((attention) => attention.target === 'project:P-1')?.resolvedAt,
    ).toBeNull()
    expect(state).toMatchObject({
      projects: [{ projectId: 'P-1', openAttentionCount: 1 }],
    })
    expect(await request(base, '/api/projects/P-1/goals/G-1')).toMatchObject({
      projectAttention: { target: 'project:P-1', resolvedAt: null },
    })
  })

  test('keeps Workspace state readable when a blocked migrated Project root is unavailable', async () => {
    const sourceMachine = join(temporaryRoot, 'source-machine')
    const destinationMachine = join(temporaryRoot, 'destination-machine')
    const homeRoot = join(sourceMachine, 'home')
    const repoRoot = await createRepo(join(sourceMachine, 'repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({
      projectId: 'P-1',
      repoPath: repoRoot,
    })
    await createGoalPackageStore(linked.integrationRoot, 'P-1', publisher).createGoal({
      goalId: 'G-1',
      title: 'Goal',
      objective: 'Survive migration.',
    })
    await createWorkspaceAttentionController(
      createAssistantWorkspaceStore(homeRoot, publisher),
    ).ensureProjectAttention('P-1', 'The Project paths must be rebound.')
    await rename(sourceMachine, destinationMachine)

    const server = createServer({
      rootDir: join(destinationMachine, 'home'),
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)

    expect(await request(`http://127.0.0.1:${server.port}`, '/api/state')).toMatchObject({
      projects: [{ projectId: 'P-1', openAttentionCount: 1, goals: [] }],
      attentions: [{ target: 'project:P-1', resolvedAt: null }],
      activeRuns: [],
    })
  })

  test('links and rebinds a secondary Repo through the Project API without touching checkouts', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const webRepo = await createRepo(join(temporaryRoot, 'web'))
    const apiRepo = await createRepo(join(temporaryRoot, 'api'))
    const canonicalWebRepo = await realpath(webRepo)
    const canonicalApiRepo = await realpath(apiRepo)
    await Bun.write(join(webRepo, 'local.txt'), 'local web state\n')
    await Bun.write(join(apiRepo, 'local.txt'), 'local api state\n')
    const webBefore = await checkoutSnapshot(webRepo)
    const apiBefore = await checkoutSnapshot(apiRepo)
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    await request(base, '/api/projects', {
      method: 'POST',
      body: { projectId: 'P-1', repoId: 'web', repoPath: webRepo },
    })
    const linked = await request(base, '/api/projects/P-1/repos', {
      method: 'POST',
      body: { repoId: 'api', repoPath: apiRepo },
    })

    expect(linked).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'web',
          repoPath: canonicalWebRepo,
          repos: [
            { repoId: 'web', repoPath: canonicalWebRepo, primary: true },
            { repoId: 'api', repoPath: canonicalApiRepo, primary: false },
          ],
        },
      ],
    })
    expect(await checkoutSnapshot(webRepo)).toEqual(webBefore)
    expect(await checkoutSnapshot(apiRepo)).toEqual(apiBefore)

    const movedApiRepo = join(temporaryRoot, 'moved-api')
    await rename(apiRepo, movedApiRepo)
    const canonicalMovedApiRepo = await realpath(movedApiRepo)
    const rebound = await request(base, '/api/projects/P-1/repos/api/rebind', {
      method: 'POST',
      body: { repoPath: movedApiRepo },
    })

    expect(rebound).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'web',
          repos: [
            { repoId: 'web', primary: true },
            { repoId: 'api', repoPath: canonicalMovedApiRepo, primary: false },
          ],
        },
      ],
    })
    expect(await checkoutSnapshot(movedApiRepo)).toEqual(apiBefore)
  })

  test('accepts multipart Inbox images and serves their durable conversation thumbnails', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    await createAssistantHomeStore(homeRoot).initialize()
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    const form = new FormData()
    form.set('content', '')
    form.append(
      'images',
      new File([pngBytes()], 'screen shot.png', { type: 'image/png' }),
      'screen shot.png',
    )

    const response = await fetch(`${base}/api/inbox`, {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(202)
    const receipt = (await response.json()) as { eventId: string }
    const feed = await request(base, '/api/assistant/feed')
    const entry = (feed.items as Array<{ event?: { id: string; attachments: unknown[] } }>).find(
      (candidate) => candidate.event?.id === receipt.eventId,
    )
    expect(entry?.event?.attachments).toHaveLength(1)
    const attachment = entry?.event?.attachments[0] as {
      fileName: string
      mediaType: string
      url: string
    }
    expect(attachment).toMatchObject({
      fileName: 'screen-shot.png',
      mediaType: 'image/png',
    })

    const image = await fetch(`${base}${attachment.url}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes())

    const invalid = new FormData()
    invalid.set('content', 'This is not actually an image.')
    invalid.append('images', new File(['spoof'], 'spoof.png', { type: 'image/png' }))
    expect((await fetch(`${base}/api/inbox`, { method: 'POST', body: invalid })).status).toBe(400)
  })

  test('opens only artifacts reached through referenced canonical Evidence', async () => {
    const homeRoot = join(temporaryRoot, 'artifact-home')
    const repoRoot = await createRepo(join(temporaryRoot, 'artifact-repo'))
    await mkdir(join(repoRoot, 'reports'), { recursive: true })
    await Bun.write(join(repoRoot, 'reports', 'stage-report.md'), '# Project report\n')
    await git(repoRoot, ['add', 'reports/stage-report.md'])
    await git(repoRoot, ['commit', '-m', 'add project report'])
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
    const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Produce a report.' })

    const planningPath = store.paths.workDocument('G-1', 'plan-initial')
    const planningSource = await Bun.file(store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    planning.attributes.stage = 'done'
    await store.publishGoal('G-1', {
      supportingWrites: [
        {
          path: store.paths.workDocument('G-1', 'W-report'),
          expectedHash: null,
          content: renderWorkDocument({
            attributes: {
              id: 'W-report',
              title: 'Write report',
              kind: 'engineering',
              stage: 'generate',
              notBefore: null,
              dependsOn: [],
              contractRevision: 1,
              evidenceRefs: [],
              attempts: 0,
            },
            body: 'Write the report.\n',
          }),
        },
      ],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
        content: renderWorkDocument(planning),
      },
    })

    const runRoot = runStoragePath(homeRoot, 'R-report')
    await mkdir(join(runRoot, 'artifacts'), { recursive: true })
    await Bun.write(join(runRoot, 'artifacts', '001-report.md'), '# Run report\n')
    await Bun.write(join(runRoot, 'artifacts', '002-preview.apng'), pngBytes())
    const workPath = store.paths.workDocument('G-1', 'W-report')
    const workSource = await Bun.file(store.paths.absolute(workPath)).text()
    const work = parseWorkDocument(workSource)
    work.attributes.stage = 'review'
    work.attributes.evidenceRefs = ['E-report']
    await store.publishGoal('G-1', {
      supportingWrites: [
        {
          path: store.paths.evidenceDocument('G-1', 'E-report'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-report',
              createdAt: '2026-07-18T00:00:00Z',
              producerRun: 'project:P-1/goal:G-1/work:W-report/run:R-report',
              coordinatorCheck: null,
              owner: 'project:P-1/goal:G-1/work:W-report',
              artifacts: [
                'artifact:R-report/001-report.md',
                'reports/stage-report.md',
                'artifact:R-report/002-preview.apng',
              ],
            },
            body: 'The reports are attached.\n',
          }),
        },
      ],
      gateWrite: {
        path: workPath,
        expectedHash: await hashBytes(new TextEncoder().encode(workSource)),
        content: renderWorkDocument(work),
      },
    })

    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    const artifactBase = `${base}/api/projects/P-1/goals/G-1/evidence/E-report/artifacts`

    const runArtifact = await fetch(`${artifactBase}/0`)
    expect(runArtifact.status).toBe(200)
    expect(runArtifact.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(runArtifact.headers.get('content-disposition')).toContain('001-report.md')
    expect(await runArtifact.text()).toBe('# Run report\n')

    const projectArtifact = await fetch(`${artifactBase}/1`)
    expect(projectArtifact.status).toBe(200)
    expect(await projectArtifact.text()).toBe('# Project report\n')

    const animationArtifact = await fetch(`${artifactBase}/2`)
    expect(animationArtifact.status).toBe(200)
    expect(animationArtifact.headers.get('content-type')).toBe('image/apng')
    expect(new Uint8Array(await animationArtifact.arrayBuffer())).toEqual(pngBytes())
    expect((await fetch(`${artifactBase}/3`)).status).toBe(404)
  })

  test('correlates repeated local completion IDs by canonical Goal identity', async () => {
    const homeRoot = join(temporaryRoot, 'completion-home')
    const repoRoot = await createRepo(join(temporaryRoot, 'completion-repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({
      projectId: 'P-1',
      repoPath: repoRoot,
    })
    const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
    await createCompletedGoal(store, 'G-1', 'A-complete')
    await createCompletedGoal(store, 'G-2', 'A-complete')
    const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
    for (const goalId of ['G-1', 'G-2']) {
      const event = await workspace.receiveReflectionEvent({
        eventId: `EV-${goalId}`,
        content: `Internal completion for ${goalId}.`,
        context: {
          projectId: 'P-1',
          goalId,
          attentionRefs: [`project:P-1/goal:${goalId}/attention:A-complete`],
        },
      })
      await workspace.handleEvent(event.attributes.id, {
        reply: `${goalId} is complete.`,
        disposition: 'answered',
        expose: true,
      })
      await acknowledgeGoalAttention(store, goalId, 'A-complete', new Date())
    }
    const userEvent = await workspace.receiveEvent({
      eventId: 'EV-user-followup',
      content: 'Thanks.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-complete'],
      },
    })
    await workspace.handleEvent(userEvent.attributes.id, {
      reply: 'You are welcome.',
      disposition: 'answered',
    })
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    const legacyReceipt = await request(base, '/api/inbox', {
      method: 'POST',
      body: {
        content: 'Legacy client follow-up.',
        context: { projectId: 'P-1', goalId: 'G-1', attentionId: 'A-complete' },
      },
    })

    const feed = await request(base, '/api/assistant/feed')
    const items = feed.items as Array<{
      kind: string
      event?: { id: string }
      completion?: { goalId: string }
    }>

    expect(items).toHaveLength(4)
    expect(items.find((item) => item.event?.id === 'EV-G-1')).toMatchObject({
      kind: 'event',
      completion: { goalId: 'G-1' },
    })
    expect(items.find((item) => item.event?.id === 'EV-G-2')).toMatchObject({
      kind: 'event',
      completion: { goalId: 'G-2' },
    })
    expect(items.find((item) => item.event?.id === 'EV-user-followup')).toMatchObject({
      kind: 'event',
      completion: null,
    })
    expect(items.find((item) => item.event?.id === legacyReceipt.eventId)).toMatchObject({
      kind: 'event',
      completion: null,
      event: {
        context: {
          projectId: 'P-1',
          goalId: 'G-1',
          attentionRefs: ['project:P-1/goal:G-1/attention:A-complete'],
        },
      },
    })
    const changes = await request(base, '/api/assistant/feed/changes')
    expect(changes.removedIds).toEqual(
      expect.arrayContaining([
        'completion:project:P-1/goal:G-1/attention:A-complete',
        'completion:project:P-1/goal:G-2/attention:A-complete',
      ]),
    )
  })

  test('synchronizes an older mutable Assistant turn independently from chronological history', async () => {
    const homeRoot = join(temporaryRoot, 'assistant-feed-home')
    const publisher = new PublicationCoordinator()
    await createAssistantHomeStore(homeRoot, publisher).initialize()
    const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
    let clock = new Date('2026-07-16T09:00:01.000Z')
    const conversation = createAssistantConversationStore(homeRoot, {
      now: () => clock,
    })
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    await request(base, '/api/state')

    await workspace.receiveEvent({
      eventId: 'EV-A',
      content: 'Run the first task.',
      receivedAt: new Date('2026-07-16T09:00:00.000Z'),
    })
    await conversation.begin('EV-A')
    clock = new Date('2026-07-16T09:00:02.000Z')
    await conversation.record('EV-A', {
      kind: 'transcript',
      transport: 'codex',
      entryKind: 'tool_call',
      summary: 'Tool call: command (bun test)',
      toolName: 'command',
      toolInvocationKey: 'call-A',
    })

    const initial = await request(base, '/api/assistant/feed')
    expect(initial).toMatchObject({
      activity: { phase: 'working' },
      syncCursor: '2026-07-16T09:00:02.000Z',
      items: [{ id: 'event:EV-A', event: { runtimeStatus: 'running' } }],
    })

    await workspace.receiveEvent({
      eventId: 'EV-B',
      content: 'Queue a newer task.',
      receivedAt: new Date('2026-07-16T09:01:00.000Z'),
    })
    const afterQueued = await request(
      base,
      `/api/assistant/feed/changes?cursor=${encodeURIComponent(String(initial.syncCursor))}`,
    )
    expect(afterQueued).toMatchObject({
      activity: { phase: 'working' },
      syncCursor: '2026-07-16T09:01:00.000Z',
    })
    expect((afterQueued.items as Array<{ id: string }>).map((entry) => entry.id)).toContain(
      'event:EV-B',
    )

    clock = new Date('2026-07-16T09:02:00.000Z')
    await conversation.complete('EV-A')
    await workspace.handleEvent('EV-A', {
      reply: 'The first task is complete.',
      disposition: 'answered',
      handledAt: new Date('2026-07-16T09:02:01.000Z'),
    })
    const afterOlderTurnCompleted = await request(
      base,
      `/api/assistant/feed/changes?cursor=${encodeURIComponent(String(afterQueued.syncCursor))}`,
    )
    expect(afterOlderTurnCompleted).toMatchObject({
      activity: { phase: 'waiting' },
      syncCursor: '2026-07-16T09:02:01.000Z',
    })
    expect(
      (afterOlderTurnCompleted.items as Array<{ id: string; event: unknown }>).find(
        (entry) => entry.id === 'event:EV-A',
      ),
    ).toMatchObject({
      event: {
        runtimeStatus: 'completed',
        reply: 'The first task is complete.',
      },
    })

    await workspace.handleEvent('EV-B', {
      reply: 'The queued task is complete.',
      disposition: 'answered',
      handledAt: new Date('2026-07-16T09:03:00.000Z'),
    })
    expect(
      await request(
        base,
        `/api/assistant/feed/changes?cursor=${encodeURIComponent(
          String(afterOlderTurnCompleted.syncCursor),
        )}`,
      ),
    ).toMatchObject({
      activity: null,
      syncCursor: '2026-07-16T09:03:00.000Z',
    })
  })

  test('shows hidden Reflection speaking work only as conversation Thinking activity', async () => {
    const homeRoot = join(temporaryRoot, 'assistant-thinking-home')
    const publisher = new PublicationCoordinator()
    await createAssistantHomeStore(homeRoot, publisher).initialize()
    const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
    const conversation = createAssistantConversationStore(homeRoot)
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    await request(base, '/api/state')

    await workspace.receiveReflectionEvent({
      eventId: 'EV-internal-thinking',
      content: 'Reassess the latest state internally.',
    })
    await conversation.begin('EV-internal-thinking')

    expect(await request(base, '/api/assistant/feed')).toMatchObject({
      activity: { phase: 'thinking' },
      items: [],
    })

    await conversation.complete('EV-internal-thinking')
    await workspace.handleEvent('EV-internal-thinking', {
      reply: 'No operator-facing update is needed.',
      disposition: 'internal-noop',
    })
    expect(await request(base, '/api/assistant/feed')).toMatchObject({
      activity: null,
      items: [],
    })
  })

  test('hides internal Reflection turns and projects only explicitly exposed updates', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    await home.initialize()
    const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
    await workspace.receiveReflectionEvent({
      eventId: 'EV-hidden',
      content: 'No operator action is useful.',
    })
    await workspace.handleEvent('EV-hidden', {
      reply: 'Remain silent.',
      disposition: 'internal-noop',
    })
    await workspace.receiveReflectionEvent({
      eventId: 'EV-public',
      content: 'A decision is required.',
    })
    await workspace.exposeEvent('EV-public')
    await workspace.handleEvent('EV-public', {
      reply: 'Please choose the release strategy.',
      disposition: 'notified',
    })
    const reflectionRoot = join(
      homeRoot,
      '.hopi',
      'runtime',
      'assistant',
      'reflections',
      'RF-debug',
    )
    await mkdir(reflectionRoot, { recursive: true })
    await Bun.write(
      join(reflectionRoot, 'reflection.json'),
      JSON.stringify({
        version: 1,
        reflectionId: 'RF-debug',
        stateDigest: 'd'.repeat(64),
        status: 'completed',
        startedAt: '2026-07-11T00:00:00.000Z',
        endedAt: '2026-07-11T00:00:01.000Z',
        error: null,
        handoffEventId: 'EV-public',
      }),
    )
    await Bun.write(
      join(reflectionRoot, 'events.jsonl'),
      `${JSON.stringify({
        eventId: 'RE-1',
        createdAt: '2026-07-11T00:00:00.500Z',
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'assistant',
        summary: 'A decision is required.',
      })}\n`,
    )
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)

    const base = `http://127.0.0.1:${server.port}`
    const state = await request(base, '/api/state')
    expect(state.events).toBeUndefined()
    const assistantFeed = await request(base, '/api/assistant/feed')
    expect(assistantFeed).toMatchObject({
      items: [
        {
          kind: 'event',
          event: {
            id: 'EV-public',
            source: 'reflection',
            visibility: 'public',
            reply: 'Please choose the release strategy.',
          },
        },
      ],
    })
    expect(await request(base, '/api/debug/reflections')).toMatchObject({
      items: [
        {
          manifest: { reflectionId: 'RF-debug', handoffEventId: 'EV-public' },
        },
      ],
    })
    expect(await request(base, '/api/debug/reflections/RF-debug/events')).toMatchObject({
      items: [{ summary: 'A decision is required.' }],
    })
  })
})

async function createCompletedGoal(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  attentionId: string,
) {
  await store.createGoal({
    goalId,
    title: goalId,
    objective: `Complete ${goalId}.`,
  })
  const workPath = store.paths.workDocument(goalId, 'plan-initial')
  const workSource = await Bun.file(store.paths.absolute(workPath)).text()
  const work = parseWorkDocument(workSource)
  work.attributes.stage = 'done'
  await store.publishGoal(goalId, {
    supportingWrites: [
      {
        path: store.paths.attentionDocument(goalId, attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: null,
            createdAt: new Date().toISOString(),
            resolvedAt: null,
            notifiedAt: null,
          },
          body: `## Completion\n\n${goalId} is complete.\n`,
        }),
      },
    ],
    gateWrite: {
      path: workPath,
      expectedHash: await hashBytes(new TextEncoder().encode(workSource)),
      content: renderWorkDocument(work),
    },
  })
  await createGoalController(store, {
    verifyCompletion: () => true,
  }).completeGoal(goalId, attentionId)
}

async function request(
  base: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method: options.method,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
  return body as Record<string, unknown> & { events?: unknown[] }
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

async function checkoutSnapshot(path: string) {
  return {
    head: await git(path, ['rev-parse', 'HEAD']),
    branch: await git(path, ['branch', '--show-current']),
    status: await git(path, ['status', '--porcelain']),
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
}
