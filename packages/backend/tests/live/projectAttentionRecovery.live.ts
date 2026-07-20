import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createWorkspaceAttentionController } from '../../src/runtime/workspaceAttentionController'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  captureAssistantReply,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  inspectKanban,
  markHarnessCheckpoint,
  recordAction,
  requestJson,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'project-attention-agent-recovery'
const PROJECT_ID = 'P-live-project-attention'
const GOAL_ID = 'G-live-project-attention'

interface FeedView {
  items: Array<{
    event?: {
      id: string
      body: string
      status: string
      reply: string | null
      runtimeStatus: string
      runtimeError: string | null
      runtimeEvents: Array<{
        kind: string
        entryKind?: string
        toolName?: string
      }>
    }
  }>
}

let harness: LiveHarness | null = null
let recorder: Awaited<ReturnType<typeof startStateRecorder>> | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeProject(harness.repoRoot)
  await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: harness.repoRoot },
  })

  const repairMarker = join(
    harness.homeRoot,
    '.hopi',
    'runtime',
    'project-repair',
    `${PROJECT_ID}.ready`,
  )
  const workspace = createAssistantWorkspaceStore(harness.homeRoot, new PublicationCoordinator())
  const attention = await createWorkspaceAttentionController(workspace).ensureProjectAttention(
    PROJECT_ID,
    `The external repair is complete only when ${repairMarker} exists and contains exactly READY. Inspect that evidence before resolving this Project Attention.`,
  )
  await requestJson(harness.baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Continue after Project repair',
      objective: 'Start Planning only after the repaired Project is judged eligible.',
    },
  })
  await mkdir(dirname(repairMarker), { recursive: true })
  await Bun.write(repairMarker, 'READY\n')
  recorder = await startStateRecorder(harness)
  await recordAction(harness, 'external_repair_completed', {
    attentionId: attention.attributes.id,
    repairMarker,
  })
  await markHarnessCheckpoint(harness, 'project_blocked_and_repaired')

  await enterHarnessPhase(harness, 'assistant_recovery')
  const instruction = `Project ${PROJECT_ID} 的外部修复已经完成。请检查 Project Attention 指定的证据；如果你判断可以继续，请显式解除它。只有工具成功后才能告诉我已经恢复。`
  const browserAdmission = await sendAssistantMessage(harness, instruction, {
    evidencePrefix: 'project-recovery-live',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })
  const recovered = await waitForValue(
    async () => {
      const [state, feed, goal] = await Promise.all([
        requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state'),
        requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
        requestJson<LiveGoalDetail>(
          harness?.baseUrl ?? '',
          `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`,
        ),
      ])
      const event = feed.items.find((item) => item.event?.body.trim() === instruction)?.event
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed: ${event.runtimeError ?? 'no error detail'}`)
      }
      const currentAttention = state.attentions.find(
        (candidate) => candidate.id === attention.attributes.id,
      )
      const plannerActive = state.activeRuns.some(
        (run) =>
          run.key.startsWith(`${PROJECT_ID}/${GOAL_ID}/`) && run.responsibility === 'planner',
      )
      return { state, event, goal, currentAttention, plannerActive }
    },
    (value) =>
      value.event?.status === 'handled' &&
      value.currentAttention?.resolvedAt != null &&
      value.goal.projectAttention === null &&
      value.plannerActive,
    { timeoutMs: 5 * 60_000, description: 'Claude to verify, resolve, and wake Planner' },
  )

  assert.equal(await Bun.file(repairMarker).text(), 'READY\n')
  const event = recovered.event
  assert.ok(event, 'Assistant event must be durable')
  const reply = event.reply?.trim()
  assert.ok(reply, 'Assistant must publish a visible recovery reply')
  const toolCallIndex = event.runtimeEvents.findIndex(
    (event) => event.entryKind === 'tool_call' && event.toolName === 'hopi_answer_attention',
  )
  const toolResultIndex = event.runtimeEvents.findIndex(
    (event, index) =>
      index > toolCallIndex &&
      event.entryKind === 'tool_result' &&
      event.toolName === 'hopi_answer_attention',
  )
  assert.ok(toolCallIndex >= 0, 'Real Assistant must call hopi_answer_attention')
  assert.ok(toolResultIndex > toolCallIndex, 'Successful resolve result must follow the tool call')
  assert.deepEqual(recorder.violations, [])
  const assistantReplyBrowser = await captureAssistantReply(harness, reply)
  const resumedBrowser = await inspectKanban(harness, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-recovery-live-resumed',
  })
  await recordAction(harness, 'project_recovery_verified', {
    attentionId: attention.attributes.id,
    eventId: event.id,
    browserAdmission,
  })
  await markHarnessCheckpoint(harness, 'planner_woken_after_project_recovery')
  await recorder.stop()
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    attentionId: attention.attributes.id,
    eventId: event.id,
    browserAdmission,
    assistantReplyBrowser,
    resumedBrowser,
  })
  console.log(`HOPI-E2E-028 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (recorder) await recorder.stop().catch(() => undefined)
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', {
      error: errorMessage(error),
    }).catch(() => undefined)
    console.error(`HOPI-E2E-028 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function initializeProject(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await Bun.write(
    join(repoRoot, 'AGENTS.md'),
    '# Project recovery fixture\n\nTreat Project Attention repair evidence as operational authority.\n',
  )
  await Bun.write(join(repoRoot, 'package.json'), '{"type":"module"}\n')
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI Live E2E'])
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'initial Project recovery fixture'])
}
