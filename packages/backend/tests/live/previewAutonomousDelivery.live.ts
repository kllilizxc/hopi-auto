import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  captureBrowserPage,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  markHarnessCheckpoint,
  requestJson,
  shutdownLiveHarness,
  startLiveHarness,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'preview-autonomous-delivery'
const PROJECT_ID = 'P-preview-autonomous'
const EXPECTED_TEXT = 'Autonomous Preview is ready'

interface PreviewView {
  session: {
    status: 'starting' | 'running' | 'stopped' | 'failed'
    surfaces: Array<{ id: string; label: string; url: string }>
    logPath: string
  } | null
}

let harness: LiveHarness | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  const baseUrl = harness.baseUrl
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeRepo(harness.repoRoot)
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: {
      projectId: PROJECT_ID,
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary', repoPath: harness.repoRoot }],
    },
  })
  await markHarnessCheckpoint(harness, 'runnable_project_without_preview_linked')

  await enterHarnessPhase(harness, 'single_preview_start')
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/preview/start`, {
    method: 'POST',
  })

  const admitted = await waitForValue(
    () => requestJson<LiveState>(baseUrl, '/api/state'),
    (state) =>
      state.projects.find((project) => project.projectId === PROJECT_ID)?.goals.length === 1,
    { timeoutMs: 4 * 60_000, description: 'Assistant-created Preview Engineering Work' },
  )
  const goalId = admitted.projects.find((project) => project.projectId === PROJECT_ID)?.goals[0]?.id
  assert.ok(goalId)
  await markHarnessCheckpoint(harness, 'engineering_work_created')

  await enterHarnessPhase(harness, 'generator_and_reviewer')
  const completed = await waitForValue(
    () => requestJson<LiveState>(baseUrl, '/api/state'),
    (state) => {
      const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
      if (project?.needsYouCount || state.attentions.length > 0) {
        throw new Error(
          `Autonomous Preview requested operator input: ${JSON.stringify(state.attentions)}`,
        )
      }
      return project?.goals.some((goal) => goal.id === goalId && goal.lifecycle === 'done') === true
    },
    { timeoutMs: 20 * 60_000, intervalMs: 1_000, description: 'reviewed Preview delivery' },
  )
  const project = completed.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  const integrationRoot = project?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(integrationRoot)
  const detail = await requestJson<LiveGoalDetail>(
    baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${goalId}`,
  )
  assert.equal(detail.works.length, 1)
  assert.equal(detail.works[0]?.kind, 'engineering')
  assert.equal(detail.works[0]?.stage, 'done')
  assert.equal(detail.projectAttention, null)
  assert.ok(await Bun.file(join(integrationRoot, 'docs', 'hopi', 'preview', 'runbook.md')).exists())
  const adapterPath = join(integrationRoot, 'scripts', 'hopi', 'preview')
  assert.ok(await Bun.file(adapterPath).exists())
  await markHarnessCheckpoint(harness, 'reviewed_preview_integrated')

  await enterHarnessPhase(harness, 'integrated_preview_verification')
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/preview/start`, {
    method: 'POST',
  })
  const preview = await waitForValue(
    () => requestJson<PreviewView>(baseUrl, `/api/projects/${PROJECT_ID}/preview`),
    (view) => view.session?.status === 'running',
    { timeoutMs: 90_000, description: 'integrated Preview to reach running' },
  )
  assert.ok(preview.session)
  assert.equal(preview.session.surfaces.length, 1)
  const surface = preview.session.surfaces[0]
  assert.ok(surface)
  const browser = await captureBrowserPage(
    {
      scenario: SCENARIO,
      artifactRoot: harness.artifactRoot,
      baseUrl,
      browserHome: harness.homeRoot,
    },
    surface.url,
    {
      evidencePrefix: 'autonomous-preview-final',
      visibleText: EXPECTED_TEXT,
      auditLabel: 'open the autonomously delivered Preview surface',
    },
  )

  const runbook = await Bun.file(
    join(integrationRoot, 'docs', 'hopi', 'preview', 'runbook.md'),
  ).text()
  assert.match(runbook, /Autonomous Preview|operator-facing|surface/i)
  assert.match(runbook, /bun|server\.ts|start/i)
  const evidence = await readGoalEvidence(integrationRoot, goalId)
  assert.match(evidence, /browser|experience|semantic|页面|体验/i)
  assert.match(evidence, /adapter|missing|cause|root|缺少|根因/i)

  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/preview/stop`, {
    method: 'POST',
  })
  const stopped = await waitForValue(
    () => requestJson<PreviewView>(baseUrl, `/api/projects/${PROJECT_ID}/preview`),
    (view) => view.session?.status === 'stopped',
    { timeoutMs: 30_000, description: 'autonomous Preview cleanup' },
  )
  assert.equal(stopped.session?.surfaces.length, 0)
  await markHarnessCheckpoint(harness, 'final_experience_and_cleanup_verified')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId,
    work: detail.works[0],
    surface,
    browser,
    runbook,
    evidence,
  })
  console.log(`HOPI-E2E-035 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', { error: errorMessage(error) }).catch(
      () => undefined,
    )
    console.error(`HOPI-E2E-035 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function initializeRepo(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI Live'])
  await Bun.write(
    join(repoRoot, 'README.md'),
    [
      '# Autonomous Preview fixture',
      '',
      'This repository contains one operator-facing browser application.',
      'Run it with `bun run start`; `PORT` selects its HTTP port.',
      `The intended user experience is the page containing “${EXPECTED_TEXT}”.`,
      'Preview should expose that application as one operator-facing entry.',
      '',
    ].join('\n'),
  )
  await Bun.write(
    join(repoRoot, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module', scripts: { start: 'bun run server.ts' } }, null, 2)}\n`,
  )
  await Bun.write(
    join(repoRoot, 'server.ts'),
    [
      "const port = Number(process.env.PORT ?? '3000')",
      'const server = Bun.serve({',
      "  hostname: '127.0.0.1',",
      '  port,',
      "  fetch: () => new Response('<!doctype html><title>Autonomous Preview</title><main><h1>Autonomous Preview is ready</h1><p>Real application content.</p></main>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),",
      '})',
      'console.log(`Listening on ${server.url}`)',
      '',
    ].join('\n'),
  )
  const smoke = join(repoRoot, 'smoke.test.ts')
  await Bun.write(
    smoke,
    [
      "import { expect, test } from 'bun:test'",
      "test('documents the intended page', async () => {",
      "  expect(await Bun.file(new URL('./server.ts', import.meta.url)).text()).toContain('Autonomous Preview is ready')",
      '})',
      '',
    ].join('\n'),
  )
  await chmod(smoke, 0o644)
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'add runnable application without Preview adapter'])
}

async function readGoalEvidence(integrationRoot: string, goalId: string) {
  const root = join(integrationRoot, '.hopi', 'docs', 'goals', goalId, 'evidence')
  const paths = await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: root }))
  assert.ok(paths.length > 0, 'Reviewed Preview Work must publish Evidence')
  return (await Promise.all(paths.map((path) => Bun.file(join(root, path)).text()))).join('\n')
}
