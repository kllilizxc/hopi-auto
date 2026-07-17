import assert from 'node:assert/strict'
import { join } from 'node:path'
import { type TestRunCleanupRegistration, registerTestRunCleanup } from '../testRunArtifact'
import {
  type LiveHarness,
  type LiveState,
  type StateRecorder,
  captureAssistantReply,
  captureBrowserPage,
  checkoutSnapshot,
  countLogicalRuns,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  markHarnessCheckpoint,
  readPendingInboxEvents,
  requestJson,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  startStateRecorder,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'conversation-only-image-judgment'
const PROJECT_ID = 'P-live-image-conversation'
const VISUAL_MARKER = 'CITRUS-731'
const INSTRUCTION = [
  '请只读取附件截图中央的短代号，并在一句简短回复中原样写出它。',
  '这只是一条只读对话，不要创建或修改任何 Project、Goal、Input、设计、Work、Attention、偏好或代码。',
].join(' ')

interface FeedEvent {
  id: string
  body: string
  status: string
  reply: string | null
  runtimeStatus: string
  runtimeError: string | null
  attachments: Array<{
    reference: string
    mediaType: string
    sizeBytes: number
    url: string
  }>
}

interface FeedView {
  items: Array<{ event?: FeedEvent }>
}

let harness: LiveHarness | null = null
let recorder: StateRecorder | null = null
let referenceServer: ReturnType<typeof Bun.serve> | null = null
let referenceCleanup: TestRunCleanupRegistration | null = null

try {
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeConversationRepo(harness.repoRoot)
  const checkoutBefore = await checkoutSnapshot(harness.repoRoot)
  await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: harness.repoRoot },
  })

  referenceServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response(referenceHtml(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    },
  })
  referenceCleanup = registerTestRunCleanup(harness, {
    name: 'reference-server',
    cleanup: () => referenceServer?.stop(true),
  })
  const referenceCapture = await captureBrowserPage(
    harness,
    `http://127.0.0.1:${referenceServer.port}`,
    {
      evidencePrefix: 'conversation-image-reference',
      visibleText: VISUAL_MARKER,
      auditLabel: 'capture the conversation-only image before upload',
    },
  )
  await referenceCleanup.run()
  referenceServer = null
  const referencePath = join(harness.artifactRoot, referenceCapture.screenshot)
  const referenceBytes = new Uint8Array(await Bun.file(referencePath).arrayBuffer())
  assert.ok(referenceBytes.byteLength > 1_000, 'Reference screenshot must contain real PNG bytes')
  await markHarnessCheckpoint(harness, 'reference_captured')

  recorder = await startStateRecorder(harness)
  await enterHarnessPhase(harness, 'browser_multimodal_conversation')
  const admission = await sendAssistantMessage(harness, INSTRUCTION, {
    imagePaths: [referencePath],
    evidencePrefix: 'conversation-image-turn',
    pagePath: `/projects/${PROJECT_ID}`,
  })
  assert.equal(admission.attached, 1)
  const event = await waitForHandledEvent(harness, INSTRUCTION)
  assert.ok(event)
  assert.ok(
    event.reply?.includes(VISUAL_MARKER),
    `Assistant must read the marker from image bytes, received: ${event.reply}`,
  )
  assert.equal(event.attachments.length, 1)
  assert.equal(event.attachments[0]?.mediaType, 'image/png')
  assert.equal(event.attachments[0]?.sizeBytes, referenceBytes.byteLength)
  const served = await fetch(`${harness.baseUrl}${event.attachments[0]?.url}`)
  assert.equal(served.status, 200)
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), referenceBytes)
  const browserReply = await captureAssistantReply(harness, event.reply ?? '')
  await markHarnessCheckpoint(harness, 'image_understood_without_goal_effect')

  await enterHarnessPhase(harness, 'domain_verification')
  const state = await requestJson<LiveState>(harness.baseUrl, '/api/state')
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  assert.ok(project)
  assert.deepEqual(project.goals, [], 'Conversation-only image must not create a Goal')
  assert.deepEqual(
    state.activeRuns,
    [],
    'Conversation-only image must not dispatch responsibilities',
  )
  assert.deepEqual(state.attentions, [], 'Conversation-only image must not create Attention')
  assert.deepEqual(await checkoutSnapshot(harness.repoRoot), checkoutBefore)
  assert.deepEqual(await readPendingInboxEvents(harness.homeRoot), [])
  assert.deepEqual(recorder.violations, [])
  await recorder.stop()

  const logicalRuns = await countLogicalRuns(harness.homeRoot)
  assert.equal(logicalRuns.assistant, 1)
  assert.equal(logicalRuns.reflection, 0)
  assert.equal(logicalRuns.planner, 0)
  assert.equal(logicalRuns.generator, 0)
  assert.equal(logicalRuns.reviewer, 0)
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
  assert.ok(transcript.trim(), 'Configured Assistant raw stream must be retained')
  assert.doesNotMatch(
    transcript,
    /responses_websocket|\bwss:\/\/|websocket.{0,80}(?:fallback|retry|failed|error)|(?:fallback|retry).{0,80}websocket/i,
    'Codex canary must not observe WebSocket setup or fallback diagnostics',
  )
  await markHarnessCheckpoint(harness, 'no_side_effects_or_websocket_diagnostics')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    eventId: event.id,
    attachmentReference: event.attachments[0]?.reference,
    referenceCapture,
    browserReply,
    logicalRuns,
    transcriptPath,
    observations: recorder.observations,
  })
  console.log(`HOPI-E2E-022 conversation-only Live passed: ${harness.artifactRoot}`)
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
    console.error(`HOPI-E2E-022 conversation-only Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function waitForHandledEvent(harness: LiveHarness, content: string) {
  return waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
      const event = feed.items.find((item) => item.event?.body.trim() === content)?.event
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed image judgment: ${event.runtimeError ?? event.reply}`)
      }
      return event
    },
    (event): event is FeedEvent => event?.status === 'handled' && Boolean(event.reply?.trim()),
    { timeoutMs: 4 * 60_000, description: 'conversation-only image reply' },
  )
}

function referenceHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 20% 10%, #fff7cf, #ef6b3c 48%, #17324d);
        font-family: Georgia, serif;
      }
      main {
        padding: 70px 100px;
        color: #fff9e8;
        background: rgba(18, 34, 49, .9);
        border: 8px solid #ffd758;
        box-shadow: 18px 18px 0 #122231;
        text-align: center;
      }
      small { display: block; letter-spacing: .32em; text-transform: uppercase; }
      strong { display: block; margin-top: 24px; font-size: 76px; letter-spacing: .08em; }
    </style>
  </head>
  <body><main><small>visual verification token</small><strong>${VISUAL_MARKER}</strong></main></body>
</html>`
}

async function initializeConversationRepo(repoRoot: string) {
  await Bun.write(join(repoRoot, 'README.md'), '# Conversation-only image fixture\n')
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'initial fixture'])
}
