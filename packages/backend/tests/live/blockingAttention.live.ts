import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type LiveHarness,
  type LiveState,
  assertAcceptedRelease,
  checkoutSnapshot,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  markHarnessCheckpoint,
  recordAction,
  requestJson,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'blocking-attention-continuation'
const PROJECT_ID = 'P-live-choice'

interface FeedView {
  items: Array<{
    event?: {
      body: string
      source: string
      status: string
      reply: string | null
      context: { attentionRefs?: string[] } | null
    }
  }>
}

interface AttemptSummary {
  runId: string
  responsibility: string
  status: 'running' | 'finished' | 'interrupted'
  result: 'success' | 'reject' | 'attention' | 'fail' | 'replan' | null
  summary: string | null
}

let harness: LiveHarness | null = null
let recorder: Awaited<ReturnType<typeof startStateRecorder>> | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeChoiceProject(harness.repoRoot)
  const checkoutBefore = await checkoutSnapshot(harness.repoRoot)
  await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: {
      projectId: PROJECT_ID,
      repoId: 'primary',
      repoPath: harness.repoRoot,
    },
  })
  recorder = await startStateRecorder(harness)

  await enterHarnessPhase(harness, 'assistant_admission')
  const instruction = `在 Project ${PROJECT_ID} 中实现 releaseLabel 功能。请先遵循项目权威要求；如果必须由我选择，请明确提出问题而不要猜测。`
  await sendAssistantMessage(harness, instruction, {
    evidencePrefix: 'request',
  })
  const goalId = await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const goal = state.projects.find((project) => project.projectId === PROJECT_ID)?.goals[0]
      if (goal) return goal.id
      const feed = await requestJson<FeedView>(
        harness?.baseUrl ?? '',
        '/api/assistant/feed?limit=20',
      )
      const unadmittedReply = feed.items.find(
        (item) =>
          item.event?.source === 'user' && item.event.status === 'handled' && item.event.reply,
      )?.event?.reply
      if (unadmittedReply) {
        throw new Error(
          `Assistant replied without admitting the requested Goal or creating targeted Attention: ${unadmittedReply}`,
        )
      }
      return null
    },
    (value) => value !== null,
    { timeoutMs: 3 * 60_000, description: 'Assistant-created ambiguous Goal' },
  )
  assert.ok(goalId)
  await markHarnessCheckpoint(harness, 'goal_admitted')

  await enterHarnessPhase(harness, 'attention_notification')
  const attention = await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const goal = await requestJson<{
        works: Array<{ id: string; kind: 'planning' | 'engineering' }>
      }>(
        harness?.baseUrl ?? '',
        `/api/projects/${encodeURIComponent(PROJECT_ID)}/goals/${encodeURIComponent(goalId)}`,
      )
      const planningWork = goal.works.find((work) => work.kind === 'planning')
      if (planningWork) {
        const attempts = await requestJson<{ attempts: AttemptSummary[] }>(
          harness?.baseUrl ?? '',
          `/api/projects/${encodeURIComponent(PROJECT_ID)}/goals/${encodeURIComponent(goalId)}/works/${encodeURIComponent(planningWork.id)}/attempts`,
        )
        const failures = attempts.attempts.filter(
          (attempt) => attempt.status === 'finished' && attempt.result === 'fail',
        )
        if (failures.length >= 3) {
          throw new Error(
            `Planner exhausted targeted-Attention retries without creating a valid operator Attention: ${failures
              .map((attempt) => `${attempt.runId}: ${attempt.summary ?? 'no summary'}`)
              .join(' | ')}`,
          )
        }
      }
      return state.attentions.find(
        (item) =>
          item.projectId === PROJECT_ID &&
          item.goalId === goalId &&
          item.target !== null &&
          item.resolvedAt === null,
      )
    },
    (value) => value?.notifiedAt != null,
    { timeoutMs: 8 * 60_000, description: 'one notified targeted Attention' },
  )
  assert.ok(attention)
  const reference = `project:${PROJECT_ID}/goal:${goalId}/attention:${attention.id}`
  const notification = await waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(
        harness?.baseUrl ?? '',
        '/api/assistant/feed?limit=100',
      )
      return feed.items.find(
        (item) =>
          item.event?.source === 'reflection' &&
          item.event.status === 'handled' &&
          item.event.context?.attentionRefs?.includes(reference),
      )?.event
    },
    (value) => Boolean(value?.reply?.trim()),
    { timeoutMs: 3 * 60_000, description: 'one public operator question' },
  )
  assert.ok(notification?.reply?.trim())
  await recordAction(harness, 'attention_notified', {
    goalId,
    attentionId: attention.id,
  })
  await markHarnessCheckpoint(harness, 'attention_notified')

  await enterHarnessPhase(harness, 'informational_follow_up')
  const followUp = '我只是想知道当前产物在哪里可以查看，暂时还没有做选择。'
  await sendAssistantMessage(harness, followUp, {
    evidencePrefix: 'follow-up',
    pagePath: `/projects/${PROJECT_ID}/board/${goalId}`,
  })
  await waitForValue(
    async () => {
      const [feed, state] = await Promise.all([
        requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
        requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state'),
      ])
      return {
        event: feed.items.find((item) => item.event?.body.trim() === followUp)?.event,
        attention: state.attentions.find((item) => item.id === attention.id),
      }
    },
    (value) => value.event?.status === 'handled',
    { timeoutMs: 3 * 60_000, description: 'informational follow-up to be answered' },
  ).then((value) => assert.equal(value.attention?.resolvedAt, null))
  await markHarnessCheckpoint(harness, 'informational_follow_up_preserved_attention')

  await enterHarnessPhase(harness, 'answer_and_continuation')
  await sendAssistantMessage(harness, '选择 compact。请完成测试和安全交付。', {
    evidencePrefix: 'answer',
    pagePath: `/projects/${PROJECT_ID}/board/${goalId}`,
  })
  await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const goal = state.projects
        .find((project) => project.projectId === PROJECT_ID)
        ?.goals.find((item) => item.id === goalId)
      const currentAttention = state.attentions.find((item) => item.id === attention.id)
      return { goal, currentAttention, activeRuns: state.activeRuns }
    },
    (value) =>
      value.goal?.lifecycle === 'done' &&
      value.currentAttention?.resolvedAt !== null &&
      value.activeRuns.length === 0,
    { timeoutMs: 15 * 60_000, description: 'selected delivery to complete' },
  )
  await assertAcceptedRelease(harness.repoRoot, PROJECT_ID, checkoutBefore)
  assert.equal(
    (await Bun.file(join(harness.repoRoot, 'src', 'release.ts')).text()).replaceAll('\r\n', '\n'),
    "export const releaseLabel = 'compact'\n",
  )
  assert.deepEqual(recorder.violations, [])
  await recorder.stop()
  await markHarnessCheckpoint(harness, 'delivery_verified')
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    goalId,
    attentionId: attention.id,
  })
  console.log(`HOPI-E2E-013 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (recorder) await recorder.stop().catch(() => undefined)
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', {
      error: errorMessage(error),
    }).catch(() => undefined)
    console.error(`HOPI-E2E-013 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function initializeChoiceProject(repoRoot: string) {
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    join(repoRoot, 'AGENTS.md'),
    `# Release label authority

The release label has two incompatible valid values: \`compact\` or \`verbose\`.
Never infer a value from existing tests or implementation. Ask the operator through targeted Attention
before Planning or Engineering selects a value. After a durable answer, implement only that choice and
run \`bun test\` before delivery.
`,
  )
  await Bun.write(
    join(repoRoot, 'package.json'),
    '{"type":"module","scripts":{"test":"bun test"}}\n',
  )
  await Bun.write(join(repoRoot, 'src', 'release.ts'), "export const releaseLabel = 'unset'\n")
  await Bun.write(
    join(repoRoot, 'src', 'release.test.ts'),
    "import { expect, test } from 'bun:test'\nimport { releaseLabel } from './release'\ntest('release label', () => expect(releaseLabel).toBe('compact'))\n",
  )
  const prepare = join(repoRoot, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'initial ambiguous choice fixture'])
}
