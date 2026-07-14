import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import type { GoalPackage } from '../src/domain/goalPackage'
import { createServer, presentAttempt } from '../src/mvpServer'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { acknowledgeGoalAttention } from '../src/runtime/attentionDelivery'
import { createGoalController } from '../src/runtime/goalController'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
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

  test('exposes canonical product APIs and Work Attempt streams', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    await Bun.write(join(repoRoot, 'local.txt'), 'dirty user checkout\n')
    const before = await checkoutSnapshot(repoRoot)
    const server = createServer({
      rootDir: homeRoot,
      port: 0,
      startCoordinator: false,
    })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`

    expect(
      await request(base, '/api/projects', {
        method: 'POST',
        body: { projectId: 'P-1', repoPath: repoRoot },
      }),
    ).toMatchObject({ projects: [{ projectId: 'P-1' }] })
    const assistantSessionPath = join(homeRoot, '.hopi', 'runtime', 'assistant', 'session.json')
    await mkdir(join(assistantSessionPath, '..'), { recursive: true })
    await Bun.write(
      assistantSessionPath,
      JSON.stringify({ version: 1, transport: 'codex', sessionId: 'old-codex-session' }),
    )
    expect(
      await request(base, '/api/assistant/settings', {
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
        assistantCodingDefaults: {
          transport: 'opencode',
          model: 'anthropic/claude-sonnet-4-5',
        },
        assistantCodingDefaultsInherited: false,
      },
    })
    expect(await Bun.file(assistantSessionPath).exists()).toBe(false)
    await Bun.write(
      assistantSessionPath,
      JSON.stringify({ version: 1, transport: 'opencode', sessionId: 'opencode-session' }),
    )
    expect(
      await request(base, '/api/assistant/settings', {
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
        assistantCodingDefaults: {
          transport: 'opencode',
          model: 'openai/gpt-5.4',
        },
      },
    })
    expect(await Bun.file(assistantSessionPath).json()).toMatchObject({
      transport: 'opencode',
      sessionId: 'opencode-session',
    })
    expect(
      await request(base, '/api/projects/P-1/settings', {
        method: 'PATCH',
        body: {
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
          },
        },
      }),
    ).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
          },
          codingDefaultsInherited: false,
        },
      ],
    })
    const created = await request(base, '/api/projects/P-1/goals', {
      method: 'POST',
      body: { goalId: 'G-1', title: 'Ship MVP', objective: 'Align implementation.' },
    })
    expect(created).toMatchObject({
      projectId: 'P-1',
      goal: { id: 'G-1', lifecycle: 'active' },
      works: [{ kind: 'planning', projection: { column: 'Plan' } }],
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
      runRoot: join(homeRoot, '.hopi', 'runtime', 'runs', 'P-1', 'G-1', 'plan-initial', 'R-1'),
    })
    await Bun.write(
      join(homeRoot, '.hopi', 'runtime', 'runs', 'P-1', 'G-1', 'plan-initial', 'R-1', 'prompt.md'),
      '# Planner system prompt\n\nCreate the Engineering Work DAG.\n',
    )
    await attempt.record({
      kind: 'message',
      level: 'info',
      role: 'planner',
      content: 'Planning the Engineering Work DAG.',
    })
    expect(
      await request(base, '/api/projects/P-1/goals/G-1/works/plan-initial/attempts'),
    ).toMatchObject({ attempts: [{ runId: 'R-1', status: 'running' }] })
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
      items: [{ kind: 'message', role: 'planner', content: 'Planning the Engineering Work DAG.' }],
      pageInfo: { hasOlder: true, hasNewer: false, totalCount: 2 },
    })
    const eventHeadInfo = eventHead.pageInfo as { oldestCursor: string; newestCursor: string }
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
      items: [{ kind: 'message', role: 'planner', content: 'Planning the Engineering Work DAG.' }],
      pageInfo: { hasNewer: false },
    })

    const paused = await request(base, '/api/projects/P-1/goals/G-1/pause', { method: 'POST' })
    expect(paused).toMatchObject({ goal: { lifecycle: 'paused' } })
    const resumed = await request(base, '/api/projects/P-1/goals/G-1/resume', { method: 'POST' })
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
    expect(reopened).toMatchObject({ goal: { lifecycle: 'active', contractRevision: 2 } })

    const state = await request(base, '/api/state')
    expect(state).toMatchObject({
      projects: [
        {
          projectId: 'P-1',
          codingDefaults: { model: 'gpt-5.3-codex' },
          goals: [{ id: 'G-1' }],
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
    const preview = await request(base, '/api/projects/P-1/preview/start', { method: 'POST' })
    expect(preview).toMatchObject({ kind: 'repair_required', reason: 'missing' })
    expect(await checkoutSnapshot(repoRoot)).toEqual(before)
  })

  test('keeps Project Attention explicit after rebind and exposes it on the Board contract', async () => {
    const homeRoot = join(temporaryRoot, 'home')
    const repoRoot = await createRepo(join(temporaryRoot, 'repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
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
    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
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
    const attentions = state.attentions as Array<{ target: string; resolvedAt: string | null }>

    expect(
      attentions.find((attention) => attention.target === 'project:P-1')?.resolvedAt,
    ).toBeNull()
    expect(state).toMatchObject({ projects: [{ projectId: 'P-1', openAttentionCount: 1 }] })
    expect(await request(base, '/api/projects/P-1/goals/G-1')).toMatchObject({
      projectAttention: { target: 'project:P-1', resolvedAt: null },
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
    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
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
    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
    activeServers.add(server)
    const base = `http://127.0.0.1:${server.port}`
    const form = new FormData()
    form.set('content', '')
    form.append(
      'images',
      new File([pngBytes()], 'screen shot.png', { type: 'image/png' }),
      'screen shot.png',
    )

    const response = await fetch(`${base}/api/inbox`, { method: 'POST', body: form })
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
    expect(attachment).toMatchObject({ fileName: 'screen-shot.png', mediaType: 'image/png' })

    const image = await fetch(`${base}${attachment.url}`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(pngBytes())

    const invalid = new FormData()
    invalid.set('content', 'This is not actually an image.')
    invalid.append('images', new File(['spoof'], 'spoof.png', { type: 'image/png' }))
    expect((await fetch(`${base}/api/inbox`, { method: 'POST', body: invalid })).status).toBe(400)
  })

  test('correlates repeated local completion IDs by canonical Goal identity', async () => {
    const homeRoot = join(temporaryRoot, 'completion-home')
    const repoRoot = await createRepo(join(temporaryRoot, 'completion-repo'))
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
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
    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
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
    const server = createServer({ rootDir: homeRoot, port: 0, startCoordinator: false })
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
  await store.createGoal({ goalId, title: goalId, objective: `Complete ${goalId}.` })
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
  await createGoalController(store, { verifyCompletion: () => true }).completeGoal(
    goalId,
    attentionId,
  )
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
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
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
