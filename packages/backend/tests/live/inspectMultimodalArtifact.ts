import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import type { RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  type LiveGoalDetail,
  type LiveState,
  captureBrowserPage,
  finishTestRun,
  inspectKanban,
  readPendingInboxEvents,
  requestJson,
  runCommand,
  semanticDirectoryDigest,
  startTestRun,
} from './liveHarness'

const PROJECT_ID = 'P-live-multimodal'

const sourceInput = process.argv.slice(2).find((argument) => argument !== '--')
if (!sourceInput) {
  console.error('Usage: bun run artifact:inspect:022 -- <artifact-root>')
  process.exit(2)
}

const sourceRoot = resolve(sourceInput)
const testRun = await startTestRun('multimodal-delivery-inspection', 'inspection')
const invocations = { assistant: 0, responsibility: 0 }
let server: MvpServer | null = null
let implementationServer: ReturnType<typeof Bun.serve> | null = null

try {
  const sourceRun = await Bun.file(join(sourceRoot, 'run.json')).json()
  assert.equal(sourceRun.scenario, 'multimodal-reference-delivery')
  assert.match(sourceRun.error ?? '', /inputs\/.+ leaked an Assistant-home attachment path/)
  const sourceDigestBefore = await semanticDirectoryDigest(sourceRoot)
  const assistantRunner: AssistantModelRunner = {
    async run() {
      invocations.assistant += 1
      throw new Error('Artifact inspection must not invoke an Assistant model')
    },
  }
  const roleRunner: RoleRunner = {
    async run() {
      invocations.responsibility += 1
      throw new Error('Artifact inspection must not invoke a responsibility model')
    },
  }
  server = createServer({
    rootDir: join(sourceRoot, 'home'),
    port: 0,
    startCoordinator: false,
    assistantRunner,
    roleRunner,
  })
  const baseUrl = `http://127.0.0.1:${server.port}`
  const state = await requestJson<LiveState>(baseUrl, '/api/state')
  assert.deepEqual(state.activeRuns, [])
  assert.equal(
    state.attentions.filter(
      (attention) => attention.target !== null && attention.resolvedAt === null,
    ).length,
    0,
  )
  assert.deepEqual(await readPendingInboxEvents(join(sourceRoot, 'home')), [])
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  const goal = project?.goals[0]
  const integrationRoot = project?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(project && goal && integrationRoot)
  assert.equal(project.goals.length, 1)
  assert.equal(goal.lifecycle, 'done')

  const feed = await requestJson<{
    items: Array<{
      event?: {
        id: string
        attachments: Array<{ reference: string; mediaType: string; url: string }>
      }
    }>
  }>(baseUrl, '/api/assistant/feed?limit=100')
  const sourceEvent = feed.items.find((item) => item.event?.attachments.length === 1)?.event
  assert.ok(sourceEvent)
  assert.equal(sourceEvent.attachments[0]?.mediaType, 'image/png')
  const referencePath = join(sourceRoot, 'screenshots', 'reference-orbit-control.png')
  const thumbnailPath = join(sourceRoot, 'screenshots', '03b-images-attached.png')
  const referenceBytes = new Uint8Array(await Bun.file(referencePath).arrayBuffer())
  assert.ok((await Bun.file(thumbnailPath).stat()).size > 1_000)
  const served = await fetch(`${baseUrl}${sourceEvent.attachments[0]?.url}`)
  assert.equal(served.status, 200)
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), referenceBytes)

  const goalRoot = join(integrationRoot, '.hopi', 'docs', 'goals', goal.id)
  const assetFiles = await filesUnder(join(goalRoot, 'assets'))
  assert.equal(assetFiles.length, 1)
  const assetFile = assetFiles[0]
  assert.ok(assetFile)
  assert.deepEqual(new Uint8Array(await Bun.file(assetFile).arrayBuffer()), referenceBytes)
  const assetPath = assetFile.slice(integrationRoot.length + 1).replaceAll('\\', '/')
  const references = await Bun.file(join(goalRoot, 'design', 'references.md')).text()
  assert.ok(references.includes(assetPath))
  assert.ok(references.includes(`Inbox \`${sourceEvent.id}\``))

  const editableDocuments = [
    { path: join(goalRoot, 'goal.md'), content: await Bun.file(join(goalRoot, 'goal.md')).text() },
    ...(await markdownUnder(join(goalRoot, 'design'))),
    ...(await markdownUnder(join(goalRoot, 'work'))),
  ]
  for (const document of editableDocuments) {
    assert.ok(
      !document.content.includes('.hopi/docs/assistant/attachments/'),
      `${document.path} leaked an Assistant-home attachment path`,
    )
  }
  const workDocuments = editableDocuments.filter(({ path }) => path.includes('/work/'))
  assert.ok(workDocuments.some(({ content }) => content.includes(assetPath)))

  const detail = await requestJson<LiveGoalDetail>(
    baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${goal.id}`,
  )
  const attempts = await readAttempts(baseUrl, goal.id, detail)
  for (const responsibility of ['planner', 'generator', 'reviewer'] as const) {
    const successful = attempts.filter(
      (attempt) =>
        attempt.responsibility === responsibility &&
        attempt.status === 'finished' &&
        attempt.result === 'success',
    )
    assert.ok(successful.length > 0)
    const contexts = await Promise.all(
      successful.map((attempt) =>
        Bun.file(
          join(
            sourceRoot,
            'home',
            '.hopi',
            'runtime',
            'runs',
            PROJECT_ID,
            goal.id,
            attempt.workId,
            attempt.runId,
            'context.md',
          ),
        ).text(),
      ),
    )
    assert.ok(contexts.some((context) => context.includes(assetPath)))
  }
  assert.ok(attempts.some((attempt) => attempt.application === 'integrated'))
  const tests = await runCommand(['bun', 'test'], integrationRoot)
  assert.equal(tests.exitCode, 0, tests.stderr || tests.stdout)
  assert.equal(
    (await runCommand(['git', 'status', '--porcelain'], join(sourceRoot, 'repo'))).stdout,
    '',
  )
  assert.match(
    await Bun.file(join(sourceRoot, 'repo', 'index.html')).text(),
    /Placeholder dashboard/,
  )

  implementationServer = Bun.serve({
    port: 0,
    fetch() {
      return new Response(Bun.file(join(integrationRoot, 'index.html')))
    },
  })
  const context = { scenario: testRun.scenario, artifactRoot: testRun.artifactRoot, baseUrl }
  const implementation = await captureBrowserPage(
    context,
    `http://127.0.0.1:${implementationServer.port}`,
    {
      evidencePrefix: 'implemented-orbit-control',
      visibleText: 'ORBIT CONTROL',
      auditLabel: 'inspect retained multimodal implementation',
    },
  )
  implementationServer.stop(true)
  implementationServer = null
  const kanban = await inspectKanban(context, PROJECT_ID, goal.id, {
    evidencePrefix: 'multimodal-terminal',
  })

  await server.shutdown()
  server = null
  assert.equal(await semanticDirectoryDigest(sourceRoot), sourceDigestBefore)
  assert.deepEqual(invocations, { assistant: 0, responsibility: 0 })
  await finishTestRun(testRun, 'passed', {
    source: { artifactRoot: sourceRoot, code: sourceRun.code },
    invocations,
    verification: {
      projectId: PROJECT_ID,
      goalId: goal.id,
      sourceEventId: sourceEvent.id,
      assetPath,
      attempts,
    },
    browser: { implementation, kanban },
  })
  console.log(`Multimodal artifact inspection passed: ${testRun.artifactRoot}`)
} catch (error) {
  implementationServer?.stop(true)
  if (server) await server.shutdown().catch(() => undefined)
  const message = error instanceof Error ? error.message : String(error)
  await finishTestRun(testRun, 'failed', {
    source: { artifactRoot: sourceRoot },
    invocations,
    error: message,
  }).catch(() => undefined)
  console.error(`Multimodal artifact inspection failed: ${message}`)
  console.error(`Retained inspection evidence: ${testRun.artifactRoot}`)
  process.exitCode = 1
}

interface AttemptView {
  workId: string
  runId: string
  responsibility: 'planner' | 'generator' | 'reviewer'
  status: string
  result: string | null
  application: string | null
}

async function readAttempts(baseUrl: string, goalId: string, goal: LiveGoalDetail) {
  const attempts: AttemptView[] = []
  for (const work of goal.works) {
    const response = await requestJson<{ attempts: AttemptView[] }>(
      baseUrl,
      `/api/projects/${PROJECT_ID}/goals/${goalId}/works/${work.id}/attempts`,
    )
    attempts.push(...response.attempts.map((attempt) => ({ ...attempt, workId: work.id })))
  }
  return attempts
}

async function filesUnder(root: string) {
  const files: string[] = []
  const glob = new Bun.Glob('**/*')
  for await (const relative of glob.scan({ cwd: root, onlyFiles: true })) {
    files.push(join(root, relative))
  }
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
