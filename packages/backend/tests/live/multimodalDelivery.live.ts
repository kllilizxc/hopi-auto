import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { type TestRunCleanupRegistration, registerTestRunCleanup } from '../testRunArtifact'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  type StateRecorder,
  captureBrowserPage,
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

const SCENARIO = 'multimodal-reference-delivery'
const PROJECT_ID = 'P-live-multimodal'
const GOAL_TITLE = 'Recreate Orbit Control dashboard'
const REFERENCE_PURPOSE = 'Use the screenshot as the required visual and content reference.'
const INSTRUCTION = [
  `在 Project ${PROJECT_ID} 中创建一个 Goal，标题必须是“${GOAL_TITLE}”。`,
  '附件截图是必须采用的视觉与内容参考，请通过 Goal references 保存并让后续 Planner、Generator、Reviewer 都能看到。',
  `Reference purpose 使用“${REFERENCE_PURPOSE}”`,
  '请在现有 index.html 中还原截图，运行测试并安全交付；不要把 Assistant Home 的附件路径写入 Goal 或 Work 文档。',
].join(' ')

interface FeedEvent {
  id: string
  body: string
  status: string
  runtimeStatus: string
  runtimeError: string | null
  attachments: Array<{
    reference: string
    fileName: string
    mediaType: string
    sizeBytes: number
    url: string
  }>
  runtimeEvents: Array<{ kind: string; entryKind?: string; transport?: string }>
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
let referenceServer: ReturnType<typeof Bun.serve> | null = null
let implementationServer: ReturnType<typeof Bun.serve> | null = null
let referenceCleanup: TestRunCleanupRegistration | null = null
let implementationCleanup: TestRunCleanupRegistration | null = null

try {
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeFrontendRepo(harness.repoRoot)
  const checkoutBefore = await checkoutSnapshot(harness.repoRoot)
  const linked = await requestJson<LiveState>(harness.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: harness.repoRoot },
  })
  const integrationRoot = linked.projects.find((project) => project.projectId === PROJECT_ID)
    ?.repos[0]?.integrationRoot
  assert.ok(integrationRoot)

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
      evidencePrefix: 'reference-orbit-control',
      visibleText: 'ORBIT CONTROL',
      auditLabel: 'capture the immutable visual reference before HOPI upload',
    },
  )
  await referenceCleanup.run()
  referenceServer = null
  const referencePath = join(harness.artifactRoot, referenceCapture.screenshot)
  const referenceBytes = new Uint8Array(await Bun.file(referencePath).arrayBuffer())
  assert.ok(referenceBytes.byteLength > 1_000, 'Reference screenshot must contain real PNG bytes')
  await markHarnessCheckpoint(harness, 'reference_captured')

  recorder = await startStateRecorder(harness)
  await enterHarnessPhase(harness, 'browser_multimodal_admission')
  const browserAdmission = await sendAssistantMessage(harness, INSTRUCTION, {
    imagePaths: [referencePath],
  })
  assert.equal(browserAdmission.attached, 1)
  const admitted = await waitForValue(
    async () => {
      const [state, feed] = await Promise.all([
        requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state'),
        requestJson<FeedView>(harness?.baseUrl ?? '', '/api/assistant/feed?limit=100'),
      ])
      const event = feed.items.find((item) => item.event?.body.trim() === INSTRUCTION)?.event
      const goals = state.projects.find((project) => project.projectId === PROJECT_ID)?.goals ?? []
      if (event?.runtimeStatus === 'failed') {
        throw new Error(`Assistant failed multimodal admission: ${event.runtimeError}`)
      }
      if (event?.status === 'handled' && goals.length === 0) {
        throw new Error('Assistant handled the multimodal instruction without creating a Goal')
      }
      return { event, goals }
    },
    (value) => value.event?.status === 'handled' && value.goals.length === 1,
    { timeoutMs: 5 * 60_000, description: 'multimodal Goal admission' },
  )
  const event = admitted.event
  const goalId = admitted.goals[0]?.id
  assert.ok(event && goalId)
  assert.equal(admitted.goals[0]?.title, GOAL_TITLE)
  assert.equal(event.attachments.length, 1)
  assert.equal(event.attachments[0]?.mediaType, 'image/png')
  assert.ok(
    event.runtimeEvents.some(
      (item) => item.kind === 'transcript' && item.entryKind === 'tool_call',
    ),
  )
  const servedReference = await fetch(`${harness.baseUrl}${event.attachments[0]?.url}`)
  assert.equal(servedReference.status, 200)
  assert.deepEqual(new Uint8Array(await servedReference.arrayBuffer()), referenceBytes)
  await markHarnessCheckpoint(harness, 'multimodal_goal_admitted')

  await enterHarnessPhase(harness, 'multimodal_agent_execution')
  await waitForValue(
    async () => {
      const state = await requestJson<LiveState>(harness?.baseUrl ?? '', '/api/state')
      const goal = state.projects
        .find((project) => project.projectId === PROJECT_ID)
        ?.goals.find((candidate) => candidate.id === goalId)
      const unexpected = state.attentions.find(
        (attention) =>
          attention.target !== null &&
          attention.resolvedAt === null &&
          attention.notifiedAt !== null,
      )
      if (unexpected) throw new Error(`Unexpected operator Attention: ${unexpected.id}`)
      return { goal, activeRuns: state.activeRuns }
    },
    (value) => value.goal?.lifecycle === 'done' && value.activeRuns.length === 0,
    { timeoutMs: 15 * 60_000, description: `multimodal Goal ${goalId} to converge` },
  )
  await waitForGoalQuiescence(harness, PROJECT_ID, goalId)
  await recorder.stop()

  await enterHarnessPhase(harness, 'multimodal_domain_verification')
  const finalGoal = await requestJson<LiveGoalDetail>(
    harness.baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${goalId}`,
  )
  assert.equal(finalGoal.goal.lifecycle, 'done')
  const goalRoot = join(integrationRoot, '.hopi', 'docs', 'goals', goalId)
  const assetFiles = await filesUnder(join(goalRoot, 'assets'))
  assert.equal(assetFiles.length, 1, 'Exactly the selected Inbox image must become a Goal asset')
  const assetFile = assetFiles[0]
  assert.ok(assetFile)
  assert.deepEqual(new Uint8Array(await Bun.file(assetFile).arrayBuffer()), referenceBytes)
  const assetPath = assetFile.slice(integrationRoot.length + 1).replaceAll('\\', '/')
  const references = await Bun.file(join(goalRoot, 'design', 'references.md')).text()
  assert.ok(references.includes(assetPath))
  assert.ok(references.includes(`Inbox \`${event.id}\``))

  const editableGoalMarkdown = [
    { path: join(goalRoot, 'goal.md'), content: await Bun.file(join(goalRoot, 'goal.md')).text() },
    ...(await markdownUnder(join(goalRoot, 'design'))),
    ...(await markdownUnder(join(goalRoot, 'work'))),
  ]
  for (const { path, content } of editableGoalMarkdown) {
    assert.ok(
      !content.includes('.hopi/docs/assistant/attachments/'),
      `${path} leaked an Assistant-home attachment path`,
    )
  }
  const workDocuments = editableGoalMarkdown.filter(({ path }) => path.includes('/work/'))
  assert.ok(
    workDocuments.some(
      ({ path, content }) => path.endsWith('plan-initial.md') && content.includes(assetPath),
    ),
    'Initial Planning Work must cite the adopted asset',
  )
  assert.ok(
    workDocuments.some(
      ({ path, content }) => !path.endsWith('plan-initial.md') && content.includes(assetPath),
    ),
    'Engineering Work must cite the adopted asset so later responsibilities receive it',
  )

  const attempts = await readAttempts(harness, goalId, finalGoal)
  assertRealDelivery(attempts)
  for (const responsibility of ['planner', 'generator', 'reviewer'] as const) {
    const matching = attempts.filter(
      (attempt) =>
        attempt.responsibility === responsibility &&
        attempt.status === 'finished' &&
        attempt.result === 'success',
    )
    const contexts = await Promise.all(
      matching.map((attempt) =>
        Bun.file(
          join(
            harness?.homeRoot ?? '',
            '.hopi',
            'runtime',
            'runs',
            PROJECT_ID,
            goalId,
            attempt.workId,
            attempt.runId,
            'context.md',
          ),
        ).text(),
      ),
    )
    assert.ok(
      contexts.some((context) => context.includes(assetPath)),
      `${responsibility} must receive the adopted image in its staged context`,
    )
  }

  const tests = await runCommand(['bun', 'test'], integrationRoot)
  assert.equal(tests.exitCode, 0, tests.stderr || tests.stdout)
  assert.deepEqual(await checkoutSnapshot(harness.repoRoot), checkoutBefore)
  assert.deepEqual(recorder.violations, [])
  assert.deepEqual(await readPendingInboxEvents(harness.homeRoot), [])

  await enterHarnessPhase(harness, 'multimodal_presentation_verification')
  implementationServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response(Bun.file(join(integrationRoot, 'index.html')))
    },
  })
  implementationCleanup = registerTestRunCleanup(harness, {
    name: 'implementation-server',
    cleanup: () => implementationServer?.stop(true),
  })
  const finalCapture = await captureBrowserPage(
    harness,
    `http://127.0.0.1:${implementationServer.port}`,
    {
      evidencePrefix: 'implemented-orbit-control',
      visibleText: 'ORBIT CONTROL',
      auditLabel: 'capture the delivered multimodal implementation',
    },
  )
  await implementationCleanup.run()
  implementationServer = null
  const kanban = await inspectKanban(harness, PROJECT_ID, goalId, {
    evidencePrefix: 'multimodal-terminal',
  })
  await recordAction(harness, 'multimodal_delivery_verified', {
    projectId: PROJECT_ID,
    goalId,
    eventId: event.id,
    assetPath,
    attempts: attempts.length,
  })
  await markHarnessCheckpoint(harness, 'multimodal_delivery_verified')
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId,
    eventId: event.id,
    attachment: event.attachments[0],
    assetPath,
    attempts,
    observations: recorder.observations,
    browser: { referenceCapture, browserAdmission, finalCapture, kanban },
  })
  console.log(`HOPI-E2E-022 multimodal Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  await referenceCleanup?.run()
  await implementationCleanup?.run()
  if (recorder) await recorder.stop().catch(() => undefined)
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', {
      error: errorMessage(error),
      invariantViolations: recorder?.violations ?? [],
      observations: recorder?.observations ?? 0,
    }).catch(() => undefined)
    console.error(`HOPI-E2E-022 multimodal Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function initializeFrontendRepo(root: string) {
  await mkdir(join(root, 'test'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(
    join(root, 'AGENTS.md'),
    [
      '# Multimodal fixture',
      '',
      'Implement only index.html. Treat the adopted Goal image as required product evidence.',
      'Run bun test. Keep the page self-contained and do not add dependencies.',
      '',
    ].join('\n'),
  )
  await Bun.write(join(root, 'package.json'), '{"type":"module","scripts":{"test":"bun test"}}\n')
  await Bun.write(
    join(root, 'index.html'),
    '<!doctype html><html><body><main><h1>Placeholder dashboard</h1></main></body></html>\n',
  )
  await Bun.write(
    join(root, 'test', 'design.test.ts'),
    [
      "import { expect, test } from 'bun:test'",
      '',
      "test('matches the adopted Orbit Control reference semantics', async () => {",
      "  const html = await Bun.file('index.html').text()",
      "  expect(html).toContain('ORBIT CONTROL')",
      "  expect(html).toContain('Operations overview')",
      "  expect(html.toLowerCase()).toContain('#f4b942')",
      '  expect((html.match(/data-metric/g) ?? []).length).toBeGreaterThanOrEqual(3)',
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
  await gitOutput(root, ['commit', '-m', 'multimodal frontend fixture'])
}

async function readAttempts(harness: LiveHarness, goalId: string, goal: LiveGoalDetail) {
  const attempts: AttemptView[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptView[] }>(
      harness.baseUrl,
      `/api/projects/${PROJECT_ID}/goals/${goalId}/works/${work.id}/attempts`,
    )
    attempts.push(...response.attempts.map((attempt) => ({ ...attempt, workId: work.id })))
  }
  return attempts
}

function assertRealDelivery(attempts: AttemptView[]) {
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
}

async function filesUnder(root: string) {
  const files: string[] = []
  const glob = new Bun.Glob('**/*')
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true }))
    files.push(join(root, relative))
  return files.toSorted()
}

async function markdownUnder(root: string) {
  const files: Array<{ path: string; content: string }> = []
  const glob = new Bun.Glob('**/*.md')
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
    files.push({ path: join(root, relative), content: await Bun.file(join(root, relative)).text() })
  }
  return files
}

function referenceHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; color: #f6f0df; background: #111718; font: 16px Georgia, serif; }
      body::before { content: ""; position: fixed; inset: 0; opacity: .18; background: repeating-linear-gradient(90deg, transparent 0 78px, #f4b942 79px 80px); }
      main { position: relative; width: min(1080px, 92vw); margin: 8vh auto; border: 1px solid #53605d; background: #182120; box-shadow: 16px 16px 0 #090d0d; }
      header { display: flex; justify-content: space-between; align-items: end; padding: 34px; border-bottom: 1px solid #53605d; }
      .eyebrow, .token { color: #f4b942; font: 700 12px ui-monospace, monospace; letter-spacing: .16em; }
      h1 { margin: 8px 0 0; font-size: clamp(36px, 6vw, 72px); line-height: .9; letter-spacing: -.04em; }
      section { padding: 34px; }
      h2 { margin: 0 0 24px; font-weight: 400; font-style: italic; }
      .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      article { min-height: 170px; padding: 22px; border: 1px solid #53605d; background: #101615; }
      article strong { display: block; margin-top: 42px; color: #f4b942; font: 700 34px ui-monospace, monospace; }
      article span { color: #9da8a4; font: 12px ui-monospace, monospace; letter-spacing: .12em; }
      @media (max-width: 700px) { .metrics { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; gap: 20px; } }
    </style>
  </head>
  <body>
    <main>
      <header><div><div class="eyebrow">MISSION CONSOLE / 07</div><h1>ORBIT CONTROL</h1></div><div class="token">SIGNAL / #F4B942</div></header>
      <section><h2>Operations overview</h2><div class="metrics">
        <article><span>UPLINK</span><strong>98.7%</strong></article>
        <article><span>CREW</span><strong>24</strong></article>
        <article><span>WINDOW</span><strong>T-03:18</strong></article>
      </div></section>
    </main>
  </body>
</html>`
}
