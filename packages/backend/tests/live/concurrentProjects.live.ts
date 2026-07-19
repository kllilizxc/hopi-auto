import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  type StateRecorder,
  assertAcceptedDelivery,
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

const SCENARIO = 'concurrent-project-instructions'
const PROJECT_A = 'P-concurrent-a'
const PROJECT_B = 'P-concurrent-b'
const TITLE_A = 'Repair Project A protocol test'
const TITLE_B = 'Repair Project B protocol test'
const INSTRUCTION_A = `在 Project ${PROJECT_A} 中创建一个 Goal，修复当前失败的协议测试并安全交付。Goal 标题使用“${TITLE_A}”。`
const INSTRUCTION_B = `在 Project ${PROJECT_B} 中创建一个 Goal，修复当前失败的协议测试并安全交付。Goal 标题使用“${TITLE_B}”。`

interface FeedEvent {
  id: string
  body: string
  receivedAt: string
  handledAt: string | null
  status: string
  reply: string | null
  runtimeStatus: string
  runtimeError: string | null
  runtimeEvents: Array<{ kind: string; entryKind?: string }>
}

interface FeedView {
  items: Array<{ event?: FeedEvent }>
}

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
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await enterHarnessPhase(harness, 'fixture_setup')
  const repoA = join(harness.artifactRoot, 'repo-a')
  const repoB = join(harness.artifactRoot, 'repo-b')
  await initializeProtocolRepo(repoA, 'a')
  await initializeProtocolRepo(repoB, 'b')
  const checkoutA = await checkoutSnapshot(repoA)
  const checkoutB = await checkoutSnapshot(repoB)
  await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_A, repoId: 'primary', repoPath: repoA },
  })
  const linked = await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_B, repoId: 'primary', repoPath: repoB },
  })
  const integrationA = linked.projects.find((project) => project.projectId === PROJECT_A)?.repos[0]
    ?.integrationRoot
  const integrationB = linked.projects.find((project) => project.projectId === PROJECT_B)?.repos[0]
    ?.integrationRoot
  assert.ok(integrationA && integrationB)
  recorder = await startStateRecorder(harness)

  await enterHarnessPhase(harness, 'project_a_admission')
  const browserA = await sendAssistantMessage(harness, INSTRUCTION_A, {
    evidencePrefix: 'project-a',
  })
  const admittedA = await waitForGoalAdmission(harness, PROJECT_A, INSTRUCTION_A)
  const goalA = admittedA.goalId
  const activeA = await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      return state.activeRuns.find((run) => run.key.startsWith(`${PROJECT_A}/${goalA}/`)) ?? null
    },
    (run) => run !== null,
    { timeoutMs: 5 * 60_000, description: 'Project A responsibility to become active' },
  )
  assert.ok(activeA)
  const activeWorkId = activeA.key.split('/')[2]
  assert.ok(activeWorkId)
  const activeAttempts = await requestJson<{ attempts: AttemptView[] }>(
    harness.baseUrl,
    `/api/projects/${PROJECT_A}/goals/${goalA}/works/${activeWorkId}/attempts`,
  )
  const activeAttempt = activeAttempts.attempts.find((attempt) => attempt.status === 'running')
  assert.ok(activeAttempt)
  await markHarnessCheckpoint(harness, 'project_a_responsibility_active')

  await enterHarnessPhase(harness, 'concurrent_public_instructions')
  const statusQuestion = `Project ${PROJECT_A} 的 Goal “${TITLE_A}” 现在是否仍在执行？只用一句话说明真实状态，不要修改任何内容。`
  const browserStatus = await sendAssistantMessage(harness, statusQuestion, {
    evidencePrefix: 'status-during-a',
  })
  const browserB = await sendAssistantMessage(harness, INSTRUCTION_B, {
    evidencePrefix: 'project-b',
  })
  const statusEvent = await waitForHandledEvent(harness, statusQuestion)
  const admittedB = await waitForGoalAdmission(harness, PROJECT_B, INSTRUCTION_B)
  const goalB = admittedB.goalId
  assert.ok(
    hasAny(statusEvent.reply ?? '', ['active', 'running', 'working', '执行', '进行']),
    `Status reply did not report the active Goal: ${statusEvent.reply}`,
  )
  assert.ok(statusEvent.runtimeEvents.some((runtime) => runtime.entryKind === 'tool_call'))
  await markHarnessCheckpoint(harness, 'project_b_admitted_while_a_running')

  await enterHarnessPhase(harness, 'concurrent_delivery')
  await Promise.all([
    waitForGoalDone(harness, PROJECT_A, goalA),
    waitForGoalDone(harness, PROJECT_B, goalB),
  ])
  await waitForGoalQuiescence(harness, PROJECT_A, goalA)
  await waitForGoalQuiescence(harness, PROJECT_B, goalB)
  await recorder.stop()

  await enterHarnessPhase(harness, 'domain_verification')
  const [finalA, finalB] = await Promise.all([
    requestJson<LiveGoalDetail>(harness.baseUrl, `/api/projects/${PROJECT_A}/goals/${goalA}`),
    requestJson<LiveGoalDetail>(harness.baseUrl, `/api/projects/${PROJECT_B}/goals/${goalB}`),
  ])
  const [attemptsA, attemptsB] = await Promise.all([
    readAttempts(harness, PROJECT_A, goalA, finalA),
    readAttempts(harness, PROJECT_B, goalB, finalB),
  ])
  assertRealDelivery(attemptsA, PROJECT_A)
  assertRealDelivery(attemptsB, PROJECT_B)
  const originalAttempt = attemptsA.find((attempt) => attempt.runId === activeAttempt.runId)
  assert.equal(
    originalAttempt?.status,
    'finished',
    'Speaking turns must not interrupt Project A responsibility Runs',
  )
  const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
  const publicEvents = [INSTRUCTION_A, statusQuestion, INSTRUCTION_B].map((body) => {
    const event = feed.items.find((item) => item.event?.body.trim() === body)?.event
    assert.ok(event)
    assert.equal(event.status, 'handled')
    assert.ok(event.reply?.trim())
    return event
  })
  assert.deepEqual(
    publicEvents.map((event) => event.id),
    [admittedA.event.id, statusEvent.id, admittedB.event.id],
  )
  for (let index = 1; index < publicEvents.length; index += 1) {
    const previous = publicEvents[index - 1]
    const current = publicEvents[index]
    assert.ok(previous && current)
    assert.ok(current.receivedAt >= previous.receivedAt)
    assert.ok(
      (current.handledAt ?? '') >= (previous.handledAt ?? ''),
      'Assistant turns must finish FIFO',
    )
  }
  const finalState = await requestJson<LiveState>(harness.baseUrl, '/api/state')
  assert.equal(
    finalState.projects.reduce((count, project) => count + project.goals.length, 0),
    2,
    'The read-only status question must not create a third Goal',
  )
  for (const [integration, repo, checkout] of [
    [integrationA, repoA, checkoutA],
    [integrationB, repoB, checkoutB],
  ] as const) {
    assert.equal(
      await Bun.file(join(integration, 'src', 'protocol.ts')).text(),
      "export const protocol = 'v2'\n",
    )
    assert.equal((await runCommand(['bun', 'test'], integration)).exitCode, 0)
    await assertAcceptedDelivery(repo, checkout)
  }
  assert.deepEqual(recorder.violations, [])
  assert.deepEqual(await readPendingInboxEvents(harness.homeRoot), [])

  const browserFinalA = await inspectKanban(harness, PROJECT_A, goalA, {
    evidencePrefix: 'project-a-terminal',
  })
  const browserFinalB = await inspectKanban(harness, PROJECT_B, goalB, {
    evidencePrefix: 'project-b-terminal',
  })
  await recordAction(harness, 'concurrent_projects_verified', {
    projectA: { goalId: goalA, attempts: attemptsA.length },
    projectB: { goalId: goalB, attempts: attemptsB.length },
  })
  await markHarnessCheckpoint(harness, 'concurrent_projects_verified')
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projects: { [PROJECT_A]: goalA, [PROJECT_B]: goalB },
    activeAttemptDuringInstructions: activeAttempt,
    attempts: { [PROJECT_A]: attemptsA, [PROJECT_B]: attemptsB },
    browser: { browserA, browserStatus, browserB, browserFinalA, browserFinalB },
    observations: recorder.observations,
  })
  console.log(`HOPI-E2E-011 concurrent Projects Live passed: ${harness.artifactRoot}`)
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
    console.error(`HOPI-E2E-011 concurrent Projects Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function waitForGoalAdmission(harness: LiveHarness, projectId: string, instruction: string) {
  return waitForValue(
    async () => {
      const [state, feed] = await Promise.all([
        requestJson<LiveState>(harness.baseUrl, '/api/state'),
        requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100'),
      ])
      const event = feed.items.find((item) => item.event?.body.trim() === instruction)?.event
      const goals = state.projects.find((project) => project.projectId === projectId)?.goals ?? []
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed ${projectId} admission: ${event.runtimeError}`)
      }
      return { event, goals }
    },
    (value) => value.event?.status === 'handled' && value.goals.length === 1,
    { timeoutMs: 3 * 60_000, description: `${projectId} Goal admission` },
  ).then((value) => {
    const event = value.event
    const goalId = value.goals[0]?.id
    assert.ok(event && goalId)
    assert.ok(event.runtimeEvents.some((runtime) => runtime.entryKind === 'tool_call'))
    return { event, goalId }
  })
}

async function waitForHandledEvent(harness: LiveHarness, body: string) {
  return waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
      const event = feed.items.find((item) => item.event?.body.trim() === body)?.event
      if (event?.runtimeStatus === 'failed')
        throw new Error(event.runtimeError ?? 'Assistant failed')
      return event ?? null
    },
    (event) => event?.status === 'handled',
    { timeoutMs: 3 * 60_000, description: 'concurrent status question to be handled' },
  ).then((event) => {
    assert.ok(event)
    return event
  })
}

async function waitForGoalDone(harness: LiveHarness, projectId: string, goalId: string) {
  return waitForValue(
    () => requestJson<LiveState>(harness.baseUrl, '/api/state'),
    (state) => {
      const goal = state.projects
        .find((project) => project.projectId === projectId)
        ?.goals.find((candidate) => candidate.id === goalId)
      const targeted = state.attentions.find(
        (attention) =>
          attention.target !== null &&
          attention.resolvedAt === null &&
          attention.notifiedAt !== null,
      )
      if (targeted) throw new Error(`Unexpected operator Attention: ${targeted.id}`)
      return goal?.lifecycle === 'done'
    },
    { timeoutMs: 15 * 60_000, description: `${projectId}/${goalId} to finish` },
  )
}

async function readAttempts(
  harness: LiveHarness,
  projectId: string,
  goalId: string,
  goal: LiveGoalDetail,
) {
  const attempts: AttemptView[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptView[] }>(
      harness.baseUrl,
      `/api/projects/${projectId}/goals/${goalId}/works/${work.id}/attempts`,
    )
    attempts.push(...response.attempts.map((attempt) => ({ ...attempt, workId: work.id })))
  }
  return attempts
}

function assertRealDelivery(attempts: AttemptView[], projectId: string) {
  for (const responsibility of ['planner', 'generator', 'reviewer'] as const) {
    assert.ok(
      attempts.some(
        (attempt) =>
          attempt.responsibility === responsibility &&
          attempt.status === 'finished' &&
          attempt.result === 'success',
      ),
      `${projectId} lacks a successful real ${responsibility}`,
    )
  }
  assert.ok(attempts.some((attempt) => attempt.application === 'integrated'))
}

async function initializeProtocolRepo(root: string, label: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'test'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    join(root, 'AGENTS.md'),
    `# Concurrent fixture ${label}\n\nRun bun test and keep the protocol change minimal.\n`,
  )
  await Bun.write(join(root, 'package.json'), '{"type":"module","scripts":{"test":"bun test"}}\n')
  await Bun.write(join(root, 'src', 'protocol.ts'), "export const protocol = 'v1'\n")
  await Bun.write(
    join(root, 'test', 'protocol.test.ts'),
    [
      "import { expect, test } from 'bun:test'",
      "import { protocol } from '../src/protocol'",
      '',
      `test('project ${label} uses protocol v2', () => {`,
      "  expect(protocol).toBe('v2')",
      '})',
      '',
    ].join('\n'),
  )
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', `concurrent fixture ${label}`])
}

function hasAny(value: string, candidates: string[]) {
  const normalized = value.toLowerCase()
  return candidates.some((candidate) => normalized.includes(candidate.toLowerCase()))
}
