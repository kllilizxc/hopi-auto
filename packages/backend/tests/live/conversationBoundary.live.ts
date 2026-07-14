import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createServer } from '../../src/mvpServer'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createGoalController } from '../../src/runtime/goalController'
import { createGoalPackageStore } from '../../src/storage/goalPackageStore'
import { initializeFailingClampProject } from './failingClampProject'
import {
  type LiveHarness,
  type StateRecorder,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  markHarnessCheckpoint,
  recordAction,
  requestJson,
  semanticDirectoryDigest,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'conversation-page-context-boundary'
const PROJECT_ID = 'P-live-conversation'
const GOAL_ID = 'G-existing-context'

interface FeedEvent {
  id: string
  body: string
  status: string
  reply: string | null
  runtimeStatus: string
  context: { projectId?: string; goalId?: string } | null
}

interface FeedView {
  items: Array<{ kind: string; event?: FeedEvent }>
}

let harness: LiveHarness | null = null
let recorder: StateRecorder | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeFailingClampProject(harness.repoRoot)
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

  await harness.server.shutdown()
  await seedPausedGoal(integrationRoot)
  harness.server = createServer({ rootDir: harness.homeRoot, port: 0 })
  harness.baseUrl = `http://127.0.0.1:${harness.server.port}`
  await recordAction(harness, 'server_restarted_after_fixture_seed', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
  })
  await markHarnessCheckpoint(harness, 'stable_goal_seeded')

  const goalRoot = join(integrationRoot, '.hopi', 'docs', 'goals', GOAL_ID)
  const goalDigestBefore = await semanticDirectoryDigest(goalRoot)
  recorder = await startStateRecorder(harness)
  await enterHarnessPhase(harness, 'assistant_admission')

  const messages = [
    '你好。请只简短问候；不要创建或修改任何 Goal、Input、Work、设计、Attention 或代码。',
    '当前页面显示一个已有 Goal。请只读说明它的标题和当前状态；不要进行任何修改。',
    '继续当前对话：这个 Goal 目前为什么不会开始执行？只解释，不要修改任何内容。',
  ]
  const events: FeedEvent[] = []
  for (const [index, content] of messages.entries()) {
    await sendAssistantMessage(harness, content, {
      evidencePrefix: `turn-${index + 1}`,
      pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
    })
    const event = await waitForHandledEvent(harness, content)
    assert.ok(event, 'Handled event must remain in the Assistant feed')
    assert.equal(event.context?.projectId, PROJECT_ID, 'Goal page context must be retained')
    assert.equal(event.context?.goalId, GOAL_ID, 'Goal page context must be retained')
    const reply = event.reply ?? ''
    assert.ok(reply.trim(), 'Every public turn must have a visible durable reply')
    if (index === 1) {
      assert.ok(
        reply.includes('Existing read-only context Goal'),
        `Factual reply must name the actual Goal, received: ${event.reply}`,
      )
      assert.ok(
        hasAny(reply, ['paused', '暂停']),
        `Factual reply must report the paused lifecycle, received: ${event.reply}`,
      )
    }
    if (index === 2) {
      assert.ok(
        hasAny(reply, ['paused', '暂停']),
        `Follow-up must explain that pause blocks execution, received: ${event.reply}`,
      )
    }
    events.push(event)
  }
  await markHarnessCheckpoint(harness, 'conversation_handled')

  const goalDigestAfter = await semanticDirectoryDigest(goalRoot)
  assert.equal(
    goalDigestAfter,
    goalDigestBefore,
    'Read-only conversation must not mutate the canonical Goal package',
  )
  const state = await requestJson<{
    projects: Array<{
      projectId: string
      goals: Array<{ id: string; title: string; lifecycle: string }>
    }>
    activeRuns: unknown[]
  }>(harness.baseUrl, '/api/state')
  const goals = state.projects.find((project) => project.projectId === PROJECT_ID)?.goals ?? []
  assert.equal(goals.length, 1, 'Read-only conversation must not create another Goal')
  assert.equal(goals[0]?.id, GOAL_ID)
  assert.equal(goals[0]?.title, 'Existing read-only context Goal')
  assert.equal(goals[0]?.lifecycle, 'paused')
  assert.deepEqual(
    state.activeRuns,
    [],
    'Paused contextual Goal must not dispatch responsibility Runs',
  )
  assert.deepEqual(recorder.violations, [], 'No shared invariant may be violated')
  await recorder.stop()
  await markHarnessCheckpoint(harness, 'boundary_verified')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    events: events.map((event) => ({ id: event.id, context: event.context })),
    observations: recorder.observations,
  })
  console.log(`HOPI-E2E-010 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (recorder) await recorder.stop().catch(() => undefined)
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', {
      error: errorMessage(error),
      invariantViolations: recorder?.violations ?? [],
      observations: recorder?.observations ?? 0,
    }).catch(() => undefined)
    console.error(`HOPI-E2E-010 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

function hasAny(value: string, expected: readonly string[]) {
  const normalized = value.toLowerCase()
  return expected.some((candidate) => normalized.includes(candidate.toLowerCase()))
}

async function seedPausedGoal(integrationRoot: string) {
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(integrationRoot, PROJECT_ID, publisher)
  await store.createGoal({
    goalId: GOAL_ID,
    title: 'Existing read-only context Goal',
    objective: 'Provide stable page context for a conversation-only scenario.',
  })
  const controller = createGoalController(store, { verifyCompletion: () => false })
  await controller.pauseGoal(GOAL_ID)
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
    (event) => event?.status === 'handled' && Boolean(event.reply?.trim()),
    { timeoutMs: 3 * 60_000, description: `Assistant reply to ${JSON.stringify(content)}` },
  )
}
