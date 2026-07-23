import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  type StateRecorder,
  assertAcceptedRelease,
  checkoutSnapshot,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  inspectKanban,
  markHarnessCheckpoint,
  readPendingInboxEvents,
  recordAction,
  requestJson,
  runCommand,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForGoalQuiescence,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'multi-repo-bootstrap-delivery'
const PROJECT_ID = 'P-live-multi-repo'
const PRIMARY_REPO_ID = 'web'
const SECONDARY_REPO_ID = 'api'
const INSTRUCTION = [
  `在 Project ${PROJECT_ID} 中，web 和 api 两个 Repo 的共享协议标记仍是 v1，测试要求 v2。`,
  '请创建一个 Goal，在两个 Repo 中完成兼容升级并运行各自测试后安全交付。',
  '项目目前没有根 AGENTS.md，两个 Repo 也没有 scripts/hopi/prepare；请把它们视为完整工作环境，而不是要求每个 Repo 具备同一初始化命令。',
].join(' ')

interface FeedView {
  items: Array<{
    event?: {
      id: string
      body: string
      status: string
      runtimeStatus: string
      runtimeError: string | null
      runtimeEvents: Array<{ kind: string; entryKind?: string; transport?: string }>
    }
  }>
}

interface GoalView extends LiveGoalDetail {}

interface AttemptView {
  workId: string
  runId: string
  responsibility: 'planner' | 'generator' | 'reviewer'
  status: string
  result: string | null
  application: string | null
}

let harness: LiveHarness | null = null
let recorder: StateRecorder | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  const primaryRoot = harness.repoRoot
  const secondaryRoot = join(harness.artifactRoot, 'repo-api')
  await initializeProtocolRepo(primaryRoot, PRIMARY_REPO_ID)
  await initializeProtocolRepo(secondaryRoot, SECONDARY_REPO_ID)
  const primaryBefore = await checkoutSnapshot(primaryRoot)
  const secondaryBefore = await checkoutSnapshot(secondaryRoot)

  let state = await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: PRIMARY_REPO_ID, repoPath: primaryRoot },
  })
  state = await requestJson<LiveState>(harness.baseUrl, `/api/projects/${PROJECT_ID}/repos`, {
    method: 'POST',
    body: { repoId: SECONDARY_REPO_ID, repoPath: secondaryRoot },
  })
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  assert.ok(project)
  assert.deepEqual(
    project.repos.map((repo) => repo.repoId),
    [PRIMARY_REPO_ID, SECONDARY_REPO_ID],
  )
  const integrations = Object.fromEntries(
    project.repos.map((repo) => [repo.repoId, repo.integrationRoot]),
  )
  await recordAction(harness, 'multi_repo_project_linked', { integrations })
  await markHarnessCheckpoint(harness, 'multi_repo_project_linked')

  recorder = await startStateRecorder(harness)
  await enterHarnessPhase(harness, 'assistant_admission')
  const browserAdmission = await sendAssistantMessage(harness, INSTRUCTION)
  const admitted = await waitForValue(
    async () => {
      const [currentState, feed] = await Promise.all([
        requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state'),
        requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
      ])
      const event = feed.items.find((item) => item.event?.body.trim() === INSTRUCTION)?.event
      const goals =
        currentState.projects.find((candidate) => candidate.projectId === PROJECT_ID)?.goals ?? []
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed: ${event.runtimeError ?? 'no error detail'}`)
      }
      if (event?.status === 'handled' && goals.length === 0) {
        throw new Error('Assistant handled the multi-Repo instruction without creating a Goal')
      }
      return { event, goals }
    },
    (value) => value.event?.status === 'handled' && value.goals.length === 1,
    { timeoutMs: 3 * 60_000, description: 'real Assistant multi-Repo Goal admission' },
  )
  const goalId = admitted.goals[0]?.id
  assert.ok(goalId)
  assert.ok(
    admitted.event?.runtimeEvents.some(
      (event) => event.kind === 'transcript' && event.entryKind === 'tool_call',
    ),
    'Assistant admission must use a real tool call',
  )
  await recordAction(harness, 'multi_repo_goal_admitted', {
    goalId,
    browserAdmission,
  })
  await markHarnessCheckpoint(harness, 'multi_repo_goal_admitted')

  await enterHarnessPhase(harness, 'multi_repo_agent_execution')
  await waitForValue(
    async () => {
      const current = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const goal = current.projects
        .find((candidate) => candidate.projectId === PROJECT_ID)
        ?.goals.find((candidate) => candidate.id === goalId)
      const unexpected = current.attentions.find(
        (attention) =>
          attention.target !== null &&
          attention.resolvedAt === null &&
          attention.notifiedAt !== null,
      )
      if (unexpected) throw new Error(`Unexpected operator Attention: ${unexpected.id}`)
      return { goal, activeRuns: current.activeRuns }
    },
    (value) => value.goal?.lifecycle === 'done' && value.activeRuns.length === 0,
    { timeoutMs: 15 * 60_000, description: `multi-Repo Goal ${goalId} to converge` },
  )
  await waitForGoalQuiescence(harness, PROJECT_ID, goalId)
  await recorder.stop()

  await enterHarnessPhase(harness, 'domain_verification')
  const finalGoal = await requestJson<GoalView>(
    harness.baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${goalId}`,
  )
  assert.equal(finalGoal.goal.lifecycle, 'done')
  const engineering = finalGoal.works.filter((work) => work.kind === 'engineering')
  assert.ok(engineering.length >= 1)
  const attempts = await readAttempts(harness, goalId, finalGoal)
  for (const responsibility of ['planner', 'generator', 'reviewer'] as const) {
    assert.ok(
      attempts.some(
        (attempt) =>
          attempt.responsibility === responsibility &&
          attempt.status === 'finished' &&
          attempt.result === 'success',
      ),
      `Expected one successful real ${responsibility}`,
    )
  }
  assert.ok(attempts.some((attempt) => attempt.application === 'integrated'))
  for (const repoId of [PRIMARY_REPO_ID, SECONDARY_REPO_ID]) {
    const root = integrations[repoId]
    assert.ok(root)
    assert.equal(
      await Bun.file(join(root, 'src', 'protocol.ts')).text(),
      "export const protocol = 'v2'\n",
    )
    const tests = await runCommand(['bun', 'test'], root)
    assert.equal(tests.exitCode, 0, `${repoId} integrated tests failed: ${tests.stderr}`)
  }
  const primaryIntegration = integrations[PRIMARY_REPO_ID]
  assert.ok(primaryIntegration)
  assert.match(await Bun.file(join(primaryIntegration, 'AGENTS.md')).text(), /./)
  const reposDoc = await Bun.file(join(primaryIntegration, '.hopi', 'docs', 'repos.md')).text()
  assert.ok(reposDoc.includes(PRIMARY_REPO_ID) && reposDoc.includes(SECONDARY_REPO_ID))
  await assertAcceptedRelease(primaryRoot, PROJECT_ID, primaryBefore)
  await assertAcceptedRelease(secondaryRoot, PROJECT_ID, secondaryBefore)
  assert.deepEqual(recorder.violations, [])
  assert.deepEqual(await readPendingInboxEvents(harness.homeRoot), [])

  await enterHarnessPhase(harness, 'presentation_verification')
  const browser = await inspectKanban(harness, PROJECT_ID, goalId, {
    evidencePrefix: 'multi-repo-terminal',
  })
  await markHarnessCheckpoint(harness, 'multi_repo_delivery_verified')
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId,
    repos: integrations,
    attempts,
    observations: recorder.observations,
    browser,
  })
  console.log(`HOPI-E2E-017/027 multi-Repo Live passed: ${harness.artifactRoot}`)
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
    console.error(`HOPI-E2E-017/027 multi-Repo Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function initializeProtocolRepo(root: string, repoId: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'test'), { recursive: true })
  await Bun.write(
    join(root, 'package.json'),
    `${JSON.stringify({ name: `hopi-e2e-${repoId}`, type: 'module', scripts: { test: 'bun test' } }, null, 2)}\n`,
  )
  await Bun.write(join(root, 'src', 'protocol.ts'), "export const protocol = 'v1'\n")
  await Bun.write(
    join(root, 'test', 'protocol.test.ts'),
    [
      "import { expect, test } from 'bun:test'",
      "import { protocol } from '../src/protocol'",
      '',
      `test('${repoId} uses shared protocol v2', () => {`,
      "  expect(protocol).toBe('v2')",
      '})',
      '',
    ].join('\n'),
  )
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', `${repoId} protocol v1 fixture`])
}

async function readAttempts(harness: LiveHarness, goalId: string, goal: GoalView) {
  const attempts: AttemptView[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptView[] }>(
      harness.baseUrl,
      `/api/projects/${PROJECT_ID}/goals/${goalId}/works/${work.id}/attempts`,
    )
    for (const attempt of response.attempts) {
      const events = await requestJson<{
        items: Array<{ kind: string; transport?: string }>
      }>(
        harness.baseUrl,
        `/api/projects/${PROJECT_ID}/goals/${goalId}/works/${work.id}/attempts/${attempt.runId}/events?limit=200`,
      )
      if (attempt.status === 'finished' && attempt.result === 'success') {
        assert.ok(
          events.items.some((event) => event.kind === 'transcript' && event.transport),
          `${attempt.responsibility} ${attempt.runId} must retain real transport events`,
        )
      }
      attempts.push({ ...attempt, workId: work.id })
    }
  }
  return attempts
}
