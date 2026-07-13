import assert from 'node:assert/strict'
import { initializeFailingClampProject } from './failingClampProject'
import { captureGoalDeliveryPresentation, verifyGoalDeliveryDomain } from './goalDeliveryScenario'
import {
  type LiveHarness,
  type LiveState,
  type StateRecorder,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  markHarnessCheckpoint,
  readPendingInboxEvents,
  recordAction,
  requestJson,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'goal-delivery'
const PROJECT_ID = 'P-live-clamp'
const INSTRUCTION = [
  `在 Project ${PROJECT_ID} 中，项目测试失败了。`,
  '请创建一个 Goal，找出原因并修复，运行测试验证后安全交付。',
].join(' ')

interface FeedView {
  items: Array<{
    kind: string
    event?: {
      id: string
      body: string
      status: string
      reply: string | null
      runtimeStatus: string
      runtimeError: string | null
      runtimeEvents: Array<{
        kind: string
        transport?: string
        entryKind?: string
        toolName?: string
      }>
    }
  }>
}

let harness: LiveHarness | null = null
let recorder: StateRecorder | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  const checkoutBefore = await initializeFailingClampProject(harness.repoRoot)
  await recordAction(harness, 'fixture_created', { checkout: checkoutBefore })

  const linked = await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: harness.repoRoot },
  })
  const project = linked.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  const integrationRoot = project?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(integrationRoot, 'Linked Project must expose its primary managed integration')
  await recordAction(harness, 'project_linked', { projectId: PROJECT_ID, integrationRoot })
  await markHarnessCheckpoint(harness, 'project_linked')

  await enterHarnessPhase(harness, 'assistant_admission')
  recorder = await startStateRecorder(harness)
  const browserAdmission = await sendAssistantMessage(harness, INSTRUCTION)
  const received = await waitForValue(
    () => requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
    (feed) => feed.items.some((item) => item.event?.body.trim() === INSTRUCTION),
    { timeoutMs: 30_000, description: 'the browser-submitted Inbox event to become durable' },
  )
  const eventId = received.items.find((item) => item.event?.body.trim() === INSTRUCTION)?.event?.id
  assert.ok(eventId, 'Browser-submitted message must have a canonical Inbox event')
  await recordAction(harness, 'user_message_sent', {
    eventId,
    content: INSTRUCTION,
    browserAdmission,
  })

  const admitted = await waitForValue(
    async () => {
      const [state, feed] = await Promise.all([
        requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state'),
        requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
      ])
      const event = feed.items.find((item) => item.event?.id === eventId)?.event
      const goals =
        state.projects.find((candidate) => candidate.projectId === PROJECT_ID)?.goals ?? []
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed: ${event.runtimeError ?? 'no error detail'}`)
      }
      if (event?.status === 'handled' && goals.length === 0) {
        throw new Error('Assistant handled the instruction without creating a Goal')
      }
      return { state, event, goals }
    },
    (value) => value.event?.status === 'handled' && value.goals.length > 0,
    { timeoutMs: 3 * 60_000, description: 'the real Assistant to admit one Goal' },
  )
  assert.equal(admitted.goals.length, 1, 'One instruction should admit one Goal')
  const goalId = admitted.goals[0]?.id
  assert.ok(goalId, 'Assistant-created Goal must have an ID')
  assert.ok(
    admitted.event?.runtimeEvents.some(
      (event) => event.kind === 'transcript' && event.entryKind === 'tool_call',
    ),
    'Assistant admission must contain a real model tool call',
  )
  await recordAction(harness, 'goal_admitted', { projectId: PROJECT_ID, goalId })
  await markHarnessCheckpoint(harness, 'goal_admitted')

  await enterHarnessPhase(harness, 'agent_execution')
  await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const current = state.projects
        .find((candidate) => candidate.projectId === PROJECT_ID)
        ?.goals.find((goal) => goal.id === goalId)
      if (current?.lifecycle === 'cancelled') throw new Error(`Goal ${goalId} was cancelled`)
      const needsUser = state.attentions.find(
        (attention) =>
          attention.target !== null &&
          attention.resolvedAt === null &&
          attention.notifiedAt !== null,
      )
      if (needsUser) {
        throw new Error(`Goal requires unexpected user action: ${needsUser.id}`)
      }
      const activeForGoal = state.activeRuns.filter((run) =>
        run.key.startsWith(`${PROJECT_ID}/${goalId}/`),
      )
      return { state, current, activeForGoal }
    },
    (value) => value.current?.lifecycle === 'done' && value.activeForGoal.length === 0,
    { timeoutMs: 15 * 60_000, description: `Goal ${goalId} to converge` },
  )
  await waitForReflectionQuiescence(harness, goalId)
  await recorder.stop()
  await markHarnessCheckpoint(harness, 'goal_converged')

  await enterHarnessPhase(harness, 'domain_verification')
  const domain = await verifyGoalDeliveryDomain({
    context: harness,
    projectId: PROJECT_ID,
    goalId,
    integrationRoot,
    checkoutBefore,
    invariantViolations: recorder.violations,
  })
  await markHarnessCheckpoint(harness, 'delivery_verified')

  await enterHarnessPhase(harness, 'presentation_verification')
  const presentation = await captureGoalDeliveryPresentation(
    harness,
    PROJECT_ID,
    goalId,
    domain.completion.body,
  )
  await recordAction(harness, 'scenario_verified', {
    goalId,
    observations: recorder.observations,
    responsibilities: domain.attempts.map((attempt) => attempt.responsibility),
  })
  await markHarnessCheckpoint(harness, 'scenario_verified')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId,
    observations: recorder.observations,
    attempts: domain.attempts,
    projectVerification: domain.projectVerification,
    ...presentation,
  })
  console.log(`Live E2E passed: ${harness.artifactRoot}`)
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
    console.error(`Live E2E failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function waitForReflectionQuiescence(harness: LiveHarness, goalId: string) {
  let stableSince = 0
  let previous = ''
  await waitForValue(
    async () => {
      const [state, reflections, pendingInbox] = await Promise.all([
        requestJson<LiveState>(harness.baseUrl, '/api/state'),
        requestJson<{
          items: Array<{ manifest: { reflectionId: string; status: string } }>
        }>(harness.baseUrl, '/api/debug/reflections?limit=100'),
        readPendingInboxEvents(harness.homeRoot),
      ])
      const goal = state.projects
        .find((project) => project.projectId === PROJECT_ID)
        ?.goals.find((candidate) => candidate.id === goalId)
      const signature = JSON.stringify({ state, reflections: reflections.items, pendingInbox })
      const quiet =
        goal?.lifecycle === 'done' &&
        state.activeRuns.length === 0 &&
        reflections.items.every((item) => item.manifest.status !== 'running') &&
        pendingInbox.length === 0
      if (!quiet || signature !== previous) {
        previous = signature
        stableSince = quiet ? Date.now() : 0
      }
      return { quiet, stableFor: stableSince ? Date.now() - stableSince : 0 }
    },
    (value) => value.quiet && value.stableFor >= 6_000,
    { timeoutMs: 5 * 60_000, description: `post-completion Reflection for ${goalId} to settle` },
  )
}
