import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
  captureBrowserPage,
  checkoutSnapshot,
  controlPreviewInBrowser,
  errorMessage,
  finishTestRun,
  gitOutput,
  ownTestRunServer,
  readModelUsage,
  requestJson,
  selectScopedProjectSourcesInBrowser,
  semanticDirectoryDigest,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'
import { registerTestRunCleanup } from '../testRunArtifact'

const SCENARIO = 'safe-scoped-project-source'
const EMPTY_PROJECT = 'P-empty-source'
const SCOPED_PROJECT = 'P-storefront'
const DELIVERY_GOAL = 'G-scoped-delivery'
const DELIVERY_WORK = 'W-scoped-delivery'
const ESCAPE_GOAL = 'G-out-of-scope-rejection'
const ESCAPE_WORK = 'W-escape-scope'
const SENTINEL = 'scope sentinel: unchanged\n'

const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const externalFixtureRoot = await mkdtemp(join(tmpdir(), 'hopi-scoped-source-fixtures-'))
const nonGitRoot = join(externalFixtureRoot, 'non-git-source')
const emptyRoot = join(externalFixtureRoot, 'empty-source')
const monorepoRoot = join(artifactRoot, 'monorepo')
const scopedRoot = join(monorepoRoot, 'apps', 'storefront')
const siblingSentinel = join(monorepoRoot, 'apps', 'admin', 'sentinel.txt')
const roles = createScopedRoles()
const modelInvocations: string[] = []
const deterministicModelRunner: AssistantModelRunner = {
  async run(input) {
    modelInvocations.push(input.toolMode ?? 'main')
    return {
      reply:
        input.toolMode === 'reflection' ? '' : 'Deterministic Project-source notification handled.',
      session: { transport: 'codex', sessionId: `source-no-action-${input.eventId}` },
    }
  },
}
registerTestRunCleanup(testRun, {
  name: 'external-source-fixtures',
  cleanup: () => rm(externalFixtureRoot, { recursive: true, force: true }),
})
let server: MvpServer | null = null
let restarted: MvpServer | null = null
let serverCleanup: ReturnType<typeof ownTestRunServer> | null = null
let restartedCleanup: ReturnType<typeof ownTestRunServer> | null = null

try {
  await initializeFixtures()
  const nonGitBefore = await semanticDirectoryDigest(nonGitRoot)
  const monorepoBefore = await checkoutSnapshot(monorepoRoot)
  const selections: Array<string | null> = [nonGitRoot, emptyRoot, scopedRoot]
  server = createServer({
    rootDir: homeRoot,
    port: 0,
    roleRunner: roles,
    assistantRunner: deterministicModelRunner,
    reflectionRunner: deterministicModelRunner,
    directoryPicker: async () => selections.shift() ?? null,
  })
  serverCleanup = ownTestRunServer(testRun, server)
  let baseUrl = `http://127.0.0.1:${server.port}`
  let browserContext = { scenario: SCENARIO, artifactRoot, baseUrl }

  const sourceSelection = await selectScopedProjectSourcesInBrowser(browserContext, {
    nonGitPath: nonGitRoot,
    emptyPath: emptyRoot,
    emptyProjectId: EMPTY_PROJECT,
    scopedPath: scopedRoot,
    scopedProjectId: SCOPED_PROJECT,
  })
  assert.equal(await semanticDirectoryDigest(nonGitRoot), nonGitBefore)
  assert.equal(await Bun.file(join(nonGitRoot, '.git')).exists(), false)
  assert.equal(await gitOutput(emptyRoot, ['branch', '--show-current']), 'main')
  assert.equal(
    await gitOutput(emptyRoot, ['log', '-1', '--pretty=%s']),
    'chore: initialize repository',
  )

  const linked = await requestJson<StateView>(baseUrl, '/api/state')
  assertProjectLinks(linked)
  assert.deepEqual(await checkoutSnapshot(monorepoRoot), monorepoBefore)
  const durableLinks = await Bun.file(join(homeRoot, '.hopi', 'projects.yml')).text()
  assert.match(durableLinks, /projectId: P-storefront/)
  assert.match(durableLinks, /projectPath: apps\/storefront/)

  await serverCleanup.run()
  server = null
  restarted = createServer({
    rootDir: homeRoot,
    port: 0,
    roleRunner: roles,
    assistantRunner: deterministicModelRunner,
    reflectionRunner: deterministicModelRunner,
  })
  restartedCleanup = ownTestRunServer(testRun, restarted)
  baseUrl = `http://127.0.0.1:${restarted.port}`
  browserContext = { scenario: SCENARIO, artifactRoot, baseUrl }
  const durable = await requestJson<StateView>(baseUrl, '/api/state')
  assertProjectLinks(durable)
  const reloadCapture = await captureBrowserPage(browserContext, `${baseUrl}/projects`, {
    evidencePrefix: '08-scoped-project-reloaded',
    visibleText: 'storefront',
    auditLabel: 'verify the scoped Project after Coordinator restart',
  })

  await requestJson(baseUrl, `/api/projects/${SCOPED_PROJECT}/goals`, {
    method: 'POST',
    body: {
      goalId: DELIVERY_GOAL,
      title: 'Deliver only the selected storefront scope',
      objective: 'Create scoped guidance, preparation, Preview, and one reviewed feature.',
    },
  })
  const delivered = await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      state.projects
        .find((project) => project.projectId === SCOPED_PROJECT)
        ?.goals.some((goal) => goal.id === DELIVERY_GOAL && goal.lifecycle === 'done') === true &&
      state.activeRuns.length === 0,
    { timeoutMs: 60_000, description: 'scoped delivery to pass Review and C1' },
  )
  const scopedProject = delivered.projects.find((project) => project.projectId === SCOPED_PROJECT)
  const integrationRoot = scopedProject?.repos.find((repo) => repo.primary)?.integrationRoot
  assert.ok(integrationRoot)
  const managedScope = join(integrationRoot, 'apps', 'storefront')
  assert.equal(await Bun.file(join(managedScope, 'AGENTS.md')).text(), '# Storefront project\n')
  assert.equal(await Bun.file(join(integrationRoot, 'AGENTS.md')).exists(), false)
  assert.equal(
    await Bun.file(join(managedScope, 'src', 'feature.ts')).text(),
    'export const storefront = 2\n',
  )
  assert.equal(
    await Bun.file(join(integrationRoot, 'apps', 'admin', 'sentinel.txt')).text(),
    SENTINEL,
  )
  assert.ok(
    roles.cwds
      .filter((entry) => entry.projectId === SCOPED_PROJECT)
      .every((entry) => entry.cwd.endsWith('/apps/storefront')),
    `Every scoped responsibility cwd must stay below projectPath: ${JSON.stringify(roles.cwds)}`,
  )

  const previewStart = await controlPreviewInBrowser(
    browserContext,
    SCOPED_PROJECT,
    DELIVERY_GOAL,
    'start',
    'scoped',
  )
  const preview = await requestJson<PreviewView>(baseUrl, `/api/projects/${SCOPED_PROJECT}/preview`)
  assert.equal(preview.session?.status, 'running')
  const previewSurface = preview.session.surfaces[0]
  assert.ok(previewSurface)
  const previewCapture = await captureBrowserPage(browserContext, previewSurface.url, {
    evidencePrefix: '09-scoped-preview-ready',
    visibleText: 'scoped-preview-ready',
    auditLabel: 'open Preview from the reviewed scoped integration',
  })
  const previewStop = await controlPreviewInBrowser(
    browserContext,
    SCOPED_PROJECT,
    DELIVERY_GOAL,
    'stop',
    'scoped',
  )
  assert.match(await Bun.file(preview.session.logPath).text(), /HOPI_PREVIEW_URL=/)
  assert.match(
    await Bun.file(join(dirname(preview.session.logPath), 'project-prepare', 'prepare.log')).text(),
    /prepared:.*apps\/storefront/,
  )

  const afterDelivery = await checkoutSnapshot(monorepoRoot)
  assert.equal(afterDelivery.branch, monorepoBefore.branch)
  assert.equal(afterDelivery.status, '')
  assert.notEqual(afterDelivery.head, monorepoBefore.head)
  assert.equal(
    await Bun.file(join(scopedRoot, 'src', 'feature.ts')).text(),
    'export const storefront = 2\n',
  )
  assert.equal(await Bun.file(siblingSentinel).text(), SENTINEL)

  await requestJson(baseUrl, `/api/projects/${SCOPED_PROJECT}/goals`, {
    method: 'POST',
    body: {
      goalId: ESCAPE_GOAL,
      title: 'Reject an out-of-scope task commit',
      objective: 'Prove C1 rejects a task commit that changes the sibling app.',
    },
  })
  const rejectedAttempt = await waitForValue(
    () => readAttemptsWhenAvailable(baseUrl),
    (attempts) =>
      attempts.attempts.some(
        (attempt) =>
          attempt.responsibility === 'reviewer' &&
          attempt.result === 'reject' &&
          attempt.summary?.includes('escape Project scope') === true,
      ),
    { timeoutMs: 60_000, description: 'out-of-scope C1 rejection' },
  )
  await requestJson(baseUrl, `/api/projects/${SCOPED_PROJECT}/goals/${ESCAPE_GOAL}/pause`, {
    method: 'POST',
  })
  await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      state.projects
        .find((project) => project.projectId === SCOPED_PROJECT)
        ?.goals.some((goal) => goal.id === ESCAPE_GOAL && goal.lifecycle === 'paused') === true &&
      !state.activeRuns.some((run) => run.key.startsWith(`${SCOPED_PROJECT}/${ESCAPE_GOAL}/`)),
    { timeoutMs: 30_000, description: 'pause the rejected escape fixture' },
  )
  assert.equal(await Bun.file(siblingSentinel).text(), SENTINEL)
  assert.equal(
    await Bun.file(join(integrationRoot, 'apps', 'admin', 'sentinel.txt')).text(),
    SENTINEL,
  )
  assert.deepEqual(await checkoutSnapshot(monorepoRoot), afterDelivery)
  assert.ok(roles.rejectedTaskSentinel)
  assert.equal(await Bun.file(roles.rejectedTaskSentinel).text(), 'scope sentinel: escaped\n')
  const rejectionCapture = await captureBrowserPage(
    browserContext,
    `${baseUrl}/projects/${SCOPED_PROJECT}/board/${ESCAPE_GOAL}`,
    {
      evidencePrefix: '10-out-of-scope-rejected',
      visibleText: 'Reject an out-of-scope task commit',
      auditLabel: 'retain the paused Kanban projection after scoped C1 rejection',
    },
  )
  assert.ok(
    modelInvocations.every(
      (mode) => mode === 'reflection' || mode === 'internal' || mode === 'main',
    ),
  )
  const runtimeUsage = await readModelUsage(homeRoot)
  assert.equal(runtimeUsage.providerUsageEvents, 0)
  assert.deepEqual(runtimeUsage.tokens, {
    input: 0,
    cachedInput: 0,
    output: 0,
    uncachedInput: 0,
  })

  const result = {
    status: 'passed',
    startedAt,
    sourceSelection,
    reloadCapture,
    previewStart,
    previewCapture,
    previewStop,
    rejectionCapture,
    rejectedAttempt,
    durableLinks,
    roles: { invocations: roles.invocations, cwds: roles.cwds },
    modelInvocations,
    runtimeUsage,
    checkout: { before: monorepoBefore, afterDelivery },
  }
  await Bun.write(
    join(artifactRoot, 'scoped-project-source.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  await restartedCleanup.run()
  restarted = null
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, nonGitRoot, emptyRoot, monorepoRoot, scopedRoot },
    resultFile: 'scoped-project-source.json',
    providerUsage: {
      runs: runtimeUsage.providerUsageEvents,
      inputTokens: runtimeUsage.tokens.input,
      outputTokens: runtimeUsage.tokens.output,
    },
  })
  console.log(`HOPI-E2E-031 safe scoped Project source passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'scoped-project-source.json'),
    `${JSON.stringify(
      {
        status: 'failed',
        startedAt,
        error: errorMessage(error),
        errorStack: error instanceof Error ? error.stack : null,
        roles: { invocations: roles.invocations, cwds: roles.cwds },
        modelInvocations,
      },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, nonGitRoot, emptyRoot, monorepoRoot, scopedRoot },
    resultFile: 'scoped-project-source.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-031 safe scoped Project source failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await restartedCleanup?.run()
  await serverCleanup?.run()
}

// Bun can retain internal HTML-bundler threads after Browser Harness closes all targets.
process.exit(process.exitCode ?? 0)

function assertProjectLinks(state: StateView) {
  assert.equal(state.projects.length, 2)
  const empty = state.projects.find((project) => project.projectId === EMPTY_PROJECT)
  const scoped = state.projects.find((project) => project.projectId === SCOPED_PROJECT)
  assert.ok(empty)
  assert.ok(scoped)
  assert.equal(empty.repos[0]?.repoPath, emptyRoot)
  assert.equal(empty.repos[0]?.projectPath, '.')
  assert.equal(scoped.repos[0]?.repoPath, monorepoRoot)
  assert.equal(scoped.repos[0]?.projectPath, 'apps/storefront')
}

function createScopedRoles(): RoleRunner & {
  invocations: string[]
  cwds: Array<{ projectId: string; goalId: string; responsibility: string; cwd: string }>
  rejectedTaskSentinel: string | null
} {
  let escapeGeneratorCalls = 0
  const roles = {
    invocations: [] as string[],
    cwds: [] as Array<{
      projectId: string
      goalId: string
      responsibility: string
      cwd: string
    }>,
    rejectedTaskSentinel: null as string | null,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      roles.invocations.push(`${input.goalId}:${input.responsibility}:${input.workId}`)
      const scopedCwd =
        input.responsibility === 'planner'
          ? input.context.repoRoots.find((repo) => repo.primary)?.path
          : input.cwd
      assert.ok(scopedCwd)
      roles.cwds.push({
        projectId: input.projectId,
        goalId: input.goalId,
        responsibility: input.responsibility,
        cwd: scopedCwd,
      })
      assert.ok(scopedCwd.endsWith('/apps/storefront'))

      if (input.responsibility === 'planner') return planScopedWork(input)
      if (input.goalId === DELIVERY_GOAL && input.responsibility === 'generator') {
        await mkdir(join(input.cwd, 'src'), { recursive: true })
        await mkdir(join(input.cwd, 'scripts', 'hopi'), { recursive: true })
        await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const storefront = 2\n')
        await writeScopedAdapters(input.cwd)
        return success('Generated only the selected storefront source and Project adapters.')
      }
      if (input.goalId === DELIVERY_GOAL && input.responsibility === 'reviewer') {
        assert.equal(
          await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
          'export const storefront = 2\n',
        )
        assert.equal(
          await Bun.file(join(input.cwd, '..', 'admin', 'sentinel.txt')).text(),
          SENTINEL,
        )
        return success('Reviewer accepted the scoped source without touching its sibling.')
      }
      if (input.goalId === ESCAPE_GOAL && input.responsibility === 'generator') {
        escapeGeneratorCalls += 1
        if (escapeGeneratorCalls > 1) {
          if (!input.signal) throw new Error('Escape retry requires an interrupt signal')
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener('abort', () => resolve(), { once: true }),
          )
          return success('Interrupted escape retry fixture.')
        }
        roles.rejectedTaskSentinel = join(input.cwd, '..', 'admin', 'sentinel.txt')
        await Bun.write(roles.rejectedTaskSentinel, 'scope sentinel: escaped\n')
        return success('Deliberately changed a sibling path for the scoped C1 guard.')
      }
      if (input.goalId === ESCAPE_GOAL && input.responsibility === 'reviewer') {
        assert.equal(
          await Bun.file(join(input.cwd, '..', 'admin', 'sentinel.txt')).text(),
          'scope sentinel: escaped\n',
        )
        return success('Expose the out-of-scope candidate to deterministic C1 validation.')
      }
      throw new Error(`Unexpected scoped responsibility: ${input.goalId}/${input.responsibility}`)
    },
  }
  return roles
}

async function planScopedWork(input: RoleRunInput): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const authorityWorkRoot = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
  )
  const planning = parseWorkDocument(
    await Bun.file(join(authorityWorkRoot, `${input.workId}.md`)).text(),
  )
  const works = await Promise.all(
    (await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: authorityWorkRoot }))).map((path) =>
      Bun.file(join(authorityWorkRoot, path)).text().then(parseWorkDocument),
    ),
  )
  const engineering = works.filter((work) => work.attributes.kind === 'engineering')
  if (engineering.length === 0) {
    if (input.goalId === DELIVERY_GOAL) {
      await Bun.write(join(input.context.proposalRoot, 'AGENTS.md'), '# Storefront project\n')
    }
    const workId = input.goalId === DELIVERY_GOAL ? DELIVERY_WORK : ESCAPE_WORK
    const primaryRepoId = input.context.repoRoots.find((repo) => repo.primary)?.repoId
    if (!primaryRepoId) throw new Error('Scoped Planner requires one primary Repo')
    const title =
      input.goalId === DELIVERY_GOAL
        ? 'Create scoped source and adapters'
        : 'Attempt a sibling source mutation'
    const workRoot = join(goalRoot, 'work')
    await mkdir(workRoot, { recursive: true })
    await Bun.write(
      join(workRoot, `${workId}.md`),
      renderWorkDocument({
        attributes: {
          id: workId,
          title,
          kind: 'engineering',
          stage: 'generate',
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body:
          input.goalId === DELIVERY_GOAL
            ? '## Acceptance Criteria\n\n- Deliver feature value 2 plus working prepare and Preview adapters beneath the selected scope.\n'
            : '## Acceptance Criteria\n\n- Exercise C1 rejection when a candidate changes `apps/admin/sentinel.txt`.\n',
      }),
    )
  } else if (engineering.every((work) => work.attributes.stage === 'done')) {
    const attentionId = `A-complete-${input.runId}`
    const attentionPath = join(goalRoot, 'attention', `${attentionId}.md`)
    await mkdir(dirname(attentionPath), { recursive: true })
    await Bun.write(
      attentionPath,
      renderAttentionDocument({
        attributes: {
          id: attentionId,
          target: null,
          createdAt: '2026-07-17T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nThe selected source scope is reviewed, integrated, and previewable.\n',
      }),
    )
  }
  return success('Planner published only the scoped Project proposal.')
}

async function writeScopedAdapters(projectRoot: string) {
  const prepare = join(projectRoot, 'scripts', 'hopi', 'prepare')
  const preview = join(projectRoot, 'scripts', 'hopi', 'preview')
  await Bun.write(
    prepare,
    '#!/usr/bin/env sh\nset -eu\ntest -f package.json\nprintf "prepared:%s\\n" "$PWD"\n',
  )
  await Bun.write(
    preview,
    [
      '#!/usr/bin/env bun',
      "const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('scoped-preview-ready') })",
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
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixtures() {
  await mkdir(nonGitRoot, { recursive: true })
  await Bun.write(join(nonGitRoot, 'existing.txt'), 'user-owned non-Git content\n')
  await mkdir(emptyRoot, { recursive: true })
  await mkdir(join(scopedRoot, 'src'), { recursive: true })
  await mkdir(dirname(siblingSentinel), { recursive: true })
  await Bun.write(join(monorepoRoot, 'README.md'), '# Scoped monorepo fixture\n')
  await Bun.write(join(scopedRoot, 'package.json'), '{"type":"module"}\n')
  await Bun.write(join(scopedRoot, 'src', 'feature.ts'), 'export const storefront = 1\n')
  await Bun.write(siblingSentinel, SENTINEL)
  await gitOutput(monorepoRoot, ['init', '-b', 'main'])
  await gitOutput(monorepoRoot, ['config', 'core.autocrlf', 'false'])
  await gitOutput(monorepoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(monorepoRoot, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(monorepoRoot, ['add', '.'])
  await gitOutput(monorepoRoot, ['commit', '-m', 'initial monorepo fixture'])
}

interface StateView {
  projects: Array<{
    projectId: string
    goals: Array<{ id: string; lifecycle: string }>
    repos: Array<{
      repoId: string
      repoPath: string
      projectPath: string
      integrationRoot: string
      primary: boolean
    }>
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
}

interface PreviewView {
  session: {
    status: string
    surfaces: Array<{ id: string; label: string; url: string }>
    logPath: string
  } | null
}

interface AttemptView {
  attempts: Array<{
    runId: string
    responsibility: string
    status: string
    result: string | null
    summary: string | null
    application: string | null
  }>
}

async function readAttemptsWhenAvailable(baseUrl: string): Promise<AttemptView> {
  const response = await fetch(
    `${baseUrl}/api/projects/${SCOPED_PROJECT}/goals/${ESCAPE_GOAL}/works/${ESCAPE_WORK}/attempts`,
  )
  if (response.status === 404) return { attempts: [] }
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} while reading escape Attempts: ${body}`)
  return JSON.parse(body) as AttemptView
}
