import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../../src/domain/canonicalDocuments'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  assertAcceptedRelease,
  captureBrowserPage,
  checkoutSnapshot,
  controlPreviewInBrowser,
  errorMessage,
  finishTestRun,
  gitOutput,
  inspectProjectPreviewStatus,
  ownTestRunServer,
  requestJson,
  requestPreviewRepairInBrowser,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'preview-lifecycle-browser'
const VALID_PROJECT = 'P-preview-valid'
const VALID_GOAL = 'G-preview-release'
const MISSING_PROJECT = 'P-preview-missing'
const MISSING_GOAL = 'G-preview-missing'
const WORK_ID = 'W-preview-release'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const validRepo = join(artifactRoot, 'preview-valid')
const missingRepo = join(artifactRoot, 'preview-missing')
const roles = createPreviewRoles()
const assistantInvocations: Array<{ eventId: string; toolMode: string }> = []
const assistantRunner: AssistantModelRunner = {
  async run(input) {
    assistantInvocations.push({ eventId: input.eventId, toolMode: input.toolMode ?? 'main' })
    return {
      reply: 'I will route the Preview repair through the normal planning path.',
      session: { transport: 'codex', sessionId: 'preview-repair-browser' },
    }
  },
}
let server: MvpServer | null = null

try {
  await initializeValidRepo(validRepo)
  await initializeMissingRepo(missingRepo)
  const validCheckout = await checkoutSnapshot(validRepo)
  const missingCheckout = await checkoutSnapshot(missingRepo)
  server = createServer({
    rootDir: homeRoot,
    port: 0,
    roleRunner: roles,
    assistantRunner,
  })
  const serverCleanup = ownTestRunServer(testRun, server)
  const baseUrl = `http://127.0.0.1:${server.port}`
  const browserContext = { scenario: SCENARIO, artifactRoot, baseUrl }

  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: VALID_PROJECT, repoId: 'primary', repoPath: validRepo },
  })
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: MISSING_PROJECT, repoId: 'primary', repoPath: missingRepo },
  })
  await requestJson(baseUrl, `/api/projects/${VALID_PROJECT}/goals`, {
    method: 'POST',
    body: {
      goalId: VALID_GOAL,
      title: 'Invalidate Preview after a reviewed release',
      objective: 'Publish feature version 2 while Preview is running.',
    },
  })
  await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      state.activeRuns.some(
        (run) =>
          run.key === `${VALID_PROJECT}/${VALID_GOAL}/plan-initial` &&
          run.responsibility === 'planner',
      ),
    { timeoutMs: 30_000, description: 'gated initial Planner before Preview start' },
  )

  const firstStart = await controlPreviewInBrowser(
    browserContext,
    VALID_PROJECT,
    VALID_GOAL,
    'start',
    'first',
  )
  const firstSession = await requestJson<PreviewView>(
    baseUrl,
    `/api/projects/${VALID_PROJECT}/preview`,
  )
  assert.equal(firstSession.session?.status, 'running')
  assert.ok(firstSession.session.endpoint)
  const previewEndpoint = await captureBrowserPage(browserContext, firstSession.session.endpoint, {
    evidencePrefix: 'preview-endpoint-ready',
    visibleText: 'preview-version-1',
    auditLabel: 'open the ready HOPI Preview endpoint',
  })
  const manualStop = await controlPreviewInBrowser(
    browserContext,
    VALID_PROJECT,
    VALID_GOAL,
    'stop',
    'manual',
  )
  const manuallyStopped = await requestJson<PreviewView>(
    baseUrl,
    `/api/projects/${VALID_PROJECT}/preview`,
  )
  assert.equal(manuallyStopped.session?.status, 'stopped')
  assert.equal(manuallyStopped.session?.stoppedReason, null)

  const secondStart = await controlPreviewInBrowser(
    browserContext,
    VALID_PROJECT,
    VALID_GOAL,
    'start',
    'before-release',
  )
  const secondSession = await requestJson<PreviewView>(
    baseUrl,
    `/api/projects/${VALID_PROJECT}/preview`,
  )
  assert.equal(secondSession.session?.status, 'running')
  assert.ok(secondSession.session.endpoint)
  roles.releasePlanning()
  const released = await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) => {
      const project = state.projects.find((candidate) => candidate.projectId === VALID_PROJECT)
      return (
        project?.goals.some((goal) => goal.id === VALID_GOAL && goal.lifecycle === 'done') ===
          true &&
        project.preview?.status === 'stopped' &&
        project.preview.stoppedReason === 'release_updated'
      )
    },
    { timeoutMs: 60_000, description: 'C1 completion and Preview release invalidation' },
  )
  const releaseProjection = await inspectProjectPreviewStatus(
    browserContext,
    VALID_PROJECT,
    'stopped · release updated',
  )
  const validProject = released.projects.find((candidate) => candidate.projectId === VALID_PROJECT)
  assert.ok(validProject?.preview)
  assert.equal(
    await Bun.file(join(validProject.repos[0]?.integrationRoot ?? '', 'src', 'feature.ts')).text(),
    'export const feature = 2\n',
  )
  assert.match(await Bun.file(validProject.preview.logPath).text(), /HOPI_PREVIEW_URL=/)
  const reposManifest = (await Bun.file(
    join(dirname(validProject.preview.logPath), 'project-prepare', 'repos.json'),
  ).json()) as { primaryRepoId?: string; repos?: Record<string, string> }
  assert.equal(reposManifest.primaryRepoId, 'primary')
  assert.deepEqual(Object.keys(reposManifest.repos ?? {}), ['primary'])

  await requestJson(baseUrl, `/api/projects/${MISSING_PROJECT}/goals`, {
    method: 'POST',
    body: {
      goalId: MISSING_GOAL,
      title: 'Missing Preview adapter',
      objective: 'Keep this Goal paused while testing the repair boundary.',
    },
  })
  await requestJson(baseUrl, `/api/projects/${MISSING_PROJECT}/goals/${MISSING_GOAL}/pause`, {
    method: 'POST',
  })
  const repairBrowser = await requestPreviewRepairInBrowser(
    browserContext,
    MISSING_PROJECT,
    MISSING_GOAL,
  )
  const repairFeed = await waitForValue(
    () => requestJson<AssistantFeed>(baseUrl, '/api/assistant/feed?limit=20'),
    (feed) =>
      feed.items.some((item) => item.event?.body.includes('Preview could not start through')),
    { timeoutMs: 30_000, description: 'one ordinary Preview repair instruction in Assistant' },
  )
  const matchingRepairEvents = repairFeed.items.filter((item) =>
    item.event?.body.includes('Preview could not start through'),
  )
  assert.equal(matchingRepairEvents.length, 1)
  const repairEvent = matchingRepairEvents[0]?.event
  assert.ok(repairEvent)
  assert.deepEqual(repairEvent.context, { projectId: MISSING_PROJECT, goalId: MISSING_GOAL })
  assert.deepEqual(
    assistantInvocations.filter((invocation) => invocation.toolMode === 'main'),
    [{ eventId: repairEvent.id, toolMode: 'main' }],
    'Only the repair instruction requires one speaking Assistant turn',
  )
  const directEvents = repairFeed.items.filter(
    (item) =>
      item.event?.body.startsWith('Create Goal') || item.event?.body.startsWith('Pause Goal'),
  )
  assert.equal(directEvents.length, 3)
  assert.ok(
    directEvents.every(
      (item) => item.event?.runtimeEvents.length === 0 && item.event.runtimeError === null,
    ),
    'Deterministic Goal controls must not race a speaking Assistant turn',
  )
  assert.ok(
    (await requestJson<StateView>(baseUrl, '/api/state')).attentions.every(
      (attention) => !attention.target?.includes('/event:'),
    ),
    'Deterministic controls must not create false event Attention',
  )
  assert.equal(
    (await requestJson<PreviewView>(baseUrl, `/api/projects/${MISSING_PROJECT}/preview`)).session,
    null,
  )
  const deliveredCheckout = await assertAcceptedRelease(validRepo, VALID_PROJECT, validCheckout)
  assert.deepEqual(await checkoutSnapshot(missingRepo), missingCheckout)

  await Bun.write(
    join(artifactRoot, 'preview-lifecycle.json'),
    `${JSON.stringify(
      {
        status: 'passed',
        startedAt,
        firstStart,
        firstSession,
        previewEndpoint,
        manualStop,
        manuallyStopped,
        secondStart,
        releaseProjection,
        deliveredCheckout,
        repairBrowser,
        repairEvent,
        assistantInvocations,
        reposManifest,
        roleRuns: roles.runs,
      },
      null,
      2,
    )}\n`,
  )
  await serverCleanup.run()
  server = null
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, validRepo, missingRepo },
    resultFile: 'preview-lifecycle.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-021 Preview browser passed: ${artifactRoot}`)
} catch (error) {
  roles.releasePlanning()
  await Bun.write(
    join(artifactRoot, 'preview-lifecycle.json'),
    `${JSON.stringify(
      {
        status: 'failed',
        startedAt,
        error: errorMessage(error),
        roleRuns: roles.runs,
        assistantInvocations,
      },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, validRepo, missingRepo },
    resultFile: 'preview-lifecycle.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  server = null
  console.error(`HOPI-E2E-021 Preview browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  server?.stop(true)
}

// Bun can retain internal HTML-bundler threads after this browser-heavy CLI has closed all handles.
process.exit(process.exitCode ?? 0)

function createPreviewRoles(): RoleRunner & {
  runs: Array<{ projectId: string; responsibility: string; runId: string }>
  releasePlanning(): void
} {
  let releasePlanning: () => void = () => undefined
  const planningGate = new Promise<void>((resolve) => {
    releasePlanning = resolve
  })
  const runner = {
    runs: [] as Array<{ projectId: string; responsibility: string; runId: string }>,
    releasePlanning,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push({
        projectId: input.projectId,
        responsibility: input.responsibility,
        runId: input.runId,
      })
      if (input.projectId === MISSING_PROJECT) {
        await new Promise<void>((resolve) =>
          input.signal?.addEventListener('abort', () => resolve(), { once: true }),
        )
        return success('Paused missing-adapter fixture stopped its Planner.')
      }
      if (input.responsibility === 'planner') {
        const hasEngineering = await authorityHasEngineering(input)
        if (!hasEngineering) await planningGate
        return plan(input, hasEngineering)
      }
      if (input.responsibility === 'generator') {
        await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const feature = 2\n')
        return success('Generator prepared release version 2.')
      }
      assert.equal(
        await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
        'export const feature = 2\n',
      )
      return success('Reviewer accepted release version 2.')
    },
  }
  return runner
}

async function authorityHasEngineering(input: RoleRunInput) {
  const root = authorityWorkRoot(input)
  const paths = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: root }))
  const works = await Promise.all(
    paths.map((path) => Bun.file(join(root, path)).text().then(parseWorkDocument)),
  )
  return works.some((work) => work.attributes.kind === 'engineering')
}

async function plan(input: RoleRunInput, hasEngineering: boolean): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const planning = parseWorkDocument(
    await Bun.file(join(authorityWorkRoot(input), `${input.workId}.md`)).text(),
  )
  if (!hasEngineering) {
    const workRoot = join(goalRoot, 'work')
    await mkdir(workRoot, { recursive: true })
    await Bun.write(
      join(workRoot, `${WORK_ID}.md`),
      renderWorkDocument({
        attributes: {
          id: WORK_ID,
          title: 'Publish Preview release version 2',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- `src/feature.ts` exports feature with value 2.\n',
      }),
    )
  } else {
    const attentionPath = join(goalRoot, 'attention', `A-complete-${input.runId}.md`)
    await mkdir(dirname(attentionPath), { recursive: true })
    await Bun.write(
      attentionPath,
      renderAttentionDocument({
        attributes: {
          id: `A-complete-${input.runId}`,
          target: null,
          createdAt: '2026-07-15T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nThe reviewed release is integrated.\n',
      }),
    )
  }
  return success('Planner published the next Preview lifecycle state.')
}

function authorityWorkRoot(input: RoleRunInput) {
  return join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
  )
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeValidRepo(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Preview lifecycle fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
  await Bun.write(join(root, 'src', 'feature.ts'), 'export const feature = 1\n')
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  const preview = join(root, 'scripts', 'hopi', 'preview')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await Bun.write(
    preview,
    [
      '#!/usr/bin/env bun',
      "const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('preview-version-1') })",
      'console.log(`HOPI_PREVIEW_URL=http://127.0.0.1:${server.port}`)',
      'const stop = () => { server.stop(true); process.exit(0) }',
      "process.on('SIGTERM', stop)",
      "process.on('SIGINT', stop)",
      'await new Promise(() => undefined)',
      '',
    ].join('\n'),
  )
  await chmod(prepare, 0o755)
  await chmod(preview, 0o755)
  await commitFixture(root, 'valid Preview fixture')
}

async function initializeMissingRepo(root: string) {
  await mkdir(root, { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Missing Preview fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
  await commitFixture(root, 'missing Preview fixture')
}

async function commitFixture(root: string, message: string) {
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', message])
}

interface StateView {
  projects: Array<{
    projectId: string
    preview: PreviewSession | null
    repos: Array<{ integrationRoot: string }>
    goals: Array<{ id: string; lifecycle: string }>
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
  attentions: Array<{ target: string | null }>
}

interface PreviewSession {
  status: string
  stoppedReason: string | null
  logPath: string
  endpoint: string | null
}

interface PreviewView {
  session: PreviewSession | null
}

interface AssistantFeed {
  items: Array<{
    event?: {
      id: string
      body: string
      status: string
      context: { projectId: string; goalId: string } | null
      runtimeEvents: unknown[]
      runtimeError: string | null
    }
  }>
}
