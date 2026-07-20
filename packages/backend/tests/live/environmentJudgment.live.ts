import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  parseGoalDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderGoalDocument,
  renderWorkDocument,
} from '../../src/domain/canonicalDocuments'
import { createServer } from '../../src/mvpServer'
import { PublicationCoordinator, hashBytes } from '../../src/publication/publisher'
import { createGoalPackageStore } from '../../src/storage/goalPackageStore'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  markHarnessCheckpoint,
  ownTestRunServer,
  requestJson,
  shutdownLiveHarness,
  startLiveHarness,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'assistant-environment-judgment'
const PROJECT_ID = 'P-environment-judgment'
const GOAL_ID = 'G-spritesheet'
const INSTRUCTION = '把已交付的 spritesheet 转成一个可以直接查看和下载的视频预览。'

interface FeedEvent {
  id: string
  body: string
  status: string
  reply: string | null
  runtimeStatus: string
}

interface FeedView {
  items: Array<{ event?: FeedEvent }>
}

let harness: LiveHarness | null = null

try {
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await enterHarnessPhase(harness, 'fixture_setup')
  await seedSpritesheet(harness.repoRoot)
  const linked = await requestJson<{
    projects: Array<{
      projectId: string
      repos: Array<{ integrationRoot: string; primary: boolean }>
    }>
  }>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: harness.repoRoot },
  })
  const integrationRoot = linked.projects
    .find((project) => project.projectId === PROJECT_ID)
    ?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(integrationRoot, 'Fixture Project must expose its managed integration root')

  await ownTestRunServer(harness, harness.server).run()
  await seedCompletedGoal(integrationRoot)
  harness.server = createServer({ rootDir: harness.homeRoot, port: 0 })
  ownTestRunServer(harness, harness.server)
  harness.baseUrl = `http://127.0.0.1:${harness.server.port}`
  await markHarnessCheckpoint(harness, 'completed_goal_seeded')

  await enterHarnessPhase(harness, 'assistant_judgment')
  await requestJson<{ eventId: string; status: 'pending' | 'handled' }>(
    harness.baseUrl,
    '/api/inbox',
    {
      method: 'POST',
      body: {
        content: INSTRUCTION,
        context: { projectId: PROJECT_ID, goalId: GOAL_ID },
      },
    },
  )
  const event = await waitForHandledEvent(harness, INSTRUCTION)
  assert.ok(event)

  const baseUrl = harness.baseUrl
  const state = await waitForValue(
    () => requestJson<LiveState>(baseUrl, '/api/state'),
    (candidate) => {
      const project = candidate.projects.find((item) => item.projectId === PROJECT_ID)
      const original = project?.goals.find((goal) => goal.id === GOAL_ID)
      return Boolean(original?.lifecycle === 'active' || (project?.goals.length ?? 0) > 1)
    },
    { timeoutMs: 30_000, description: 'Assistant to establish durable progress' },
  )
  const original = await requestJson<LiveGoalDetail>(
    baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`,
  )
  const transcriptPath = join(
    harness.homeRoot,
    '.hopi',
    'runtime',
    'assistant',
    'turns',
    event.id,
    'transcript.log',
  )
  const transcript = await Bun.file(transcriptPath).text()
  const publicReply = event.reply ?? ''

  assert.ok(
    original.goal.lifecycle === 'active' ||
      state.projects.find((project) => project.projectId === PROJECT_ID)?.goals.length !== 1,
    'The requested deliverable must establish a durable Goal effect',
  )
  assert.doesNotMatch(
    `${transcript}\n${publicReply}`,
    /sudo\s+(?:chown|chmod)|brew\s+install|请安装\s*`?ffmpeg|Cellar[^\n]*(?:不可写|not writable)/i,
    'Assistant must not misreport its projected sandbox as a host ownership repair',
  )
  await markHarnessCheckpoint(harness, 'environment_judgment_verified')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    eventId: event.id,
    reply: publicReply,
    originalGoal: original.goal,
    works: original.works,
    projectGoals: state.projects.find((project) => project.projectId === PROJECT_ID)?.goals,
  })
  console.log(`HOPI-E2E-033 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', { error: errorMessage(error) }).catch(
      () => undefined,
    )
    console.error(`HOPI-E2E-033 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function seedCompletedGoal(integrationRoot: string) {
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(integrationRoot, PROJECT_ID, publisher)
  await store.createGoal({
    goalId: GOAL_ID,
    title: 'Generate a right-facing pixel character spritesheet',
    objective:
      'Deliver a reusable right-facing character spritesheet at assets/sprites/hero-run-right-8f.png.',
  })
  await finishInitialPlanning(store)
  const attentionId = 'A-complete'
  const goalPath = store.paths.goalDocument(GOAL_ID)
  const goalSource = await Bun.file(store.paths.absolute(goalPath)).text()
  const goal = parseGoalDocument(goalSource)
  goal.attributes.lifecycle = 'done'
  goal.attributes.completionAttentionId = attentionId
  await store.publishGoal(GOAL_ID, {
    supportingWrites: [
      {
        path: store.paths.attentionDocument(GOAL_ID, attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: null,
            createdAt: '2026-07-20T10:46:00.000Z',
            resolvedAt: null,
            notifiedAt: '2026-07-20T10:47:00.000Z',
            operatorRequest: null,
          },
          body: '## Completion\n\nThe requested spritesheet is complete.\n',
        }),
      },
    ],
    gateWrite: {
      path: goalPath,
      expectedHash: await hashBytes(new TextEncoder().encode(goalSource)),
      content: renderGoalDocument(goal),
    },
  })
}

async function finishInitialPlanning(store: ReturnType<typeof createGoalPackageStore>) {
  const workId = 'plan-initial'
  const evidenceId = 'E-spritesheet'
  const path = store.paths.workDocument(GOAL_ID, 'plan-initial')
  const source = await Bun.file(store.paths.absolute(path)).text()
  const work = parseWorkDocument(source)
  work.attributes.stage = 'done'
  work.attributes.evidenceRefs = [evidenceId]
  await store.publishGoal(GOAL_ID, {
    supportingWrites: [
      {
        path: store.paths.evidenceDocument(GOAL_ID, evidenceId),
        expectedHash: null,
        content: renderEvidenceDocument({
          attributes: {
            id: evidenceId,
            createdAt: '2026-07-20T10:45:00.000Z',
            producerRun: `project:${PROJECT_ID}/goal:${GOAL_ID}/work:${workId}/run:R-spritesheet`,
            coordinatorCheck: null,
            owner: `project:${PROJECT_ID}/goal:${GOAL_ID}/work:${workId}`,
            artifacts: ['assets/sprites/hero-run-right-8f.png'],
          },
          body: '## Summary\n\nThe spritesheet is delivered and verified.\n',
        }),
      },
    ],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(work),
    },
  })
}

async function seedSpritesheet(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  const path = join(repoRoot, 'assets', 'sprites', 'hero-run-right-8f.png')
  await mkdir(join(path, '..'), { recursive: true })
  await Bun.write(path, spritesheetPng())
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'add spritesheet fixture'])
}

function spritesheetPng() {
  const width = 128
  const height = 16
  const rows = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4)
    for (let x = 0; x < width; x += 1) {
      const frame = Math.floor(x / 16)
      const pixel = row + 1 + x * 4
      rows[pixel] = 24 + frame * 25
      rows[pixel + 1] = 196 - frame * 12
      rows[pixel + 2] = 80 + ((x + y) % 2) * 80
      rows[pixel + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(kind: string, data: Buffer) {
  const type = Buffer.from(kind)
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return chunk
}

function crc32(data: Buffer) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

async function waitForHandledEvent(harness: LiveHarness, content: string) {
  return waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
      const event = feed.items.find((item) => item.event?.body.trim() === content)?.event
      if (event?.runtimeStatus === 'failed') {
        throw new Error(
          `Assistant failed for ${JSON.stringify(content)}: ${event.reply ?? 'no reply'}`,
        )
      }
      return event
    },
    (event): event is FeedEvent => event?.status === 'handled' && Boolean(event.reply?.trim()),
    { timeoutMs: 4 * 60_000, description: `Assistant reply to ${JSON.stringify(content)}` },
  )
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
