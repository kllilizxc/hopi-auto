import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../../src/domain/canonicalDocuments'
import { type MvpServer, createServer } from '../../src/mvpServer'
import {
  assertAcceptedDelivery,
  checkoutSnapshot,
  errorMessage,
  finishTestRun,
  gitOutput,
  inspectKanban,
  ownTestRunServer,
  requestJson,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'cancel-reopen-browser'
const PROJECT_ID = 'P-cancel-reopen'
const GOAL_ID = 'G-cancel-reopen'
const INITIAL_WORK = 'W-initial'
const DEPENDENT_WORK = 'W-dependent'
const REOPENED_WORK = 'W-reopened'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const roles = createRoles()
let server: MvpServer | null = null

try {
  await initializeFixture(repoRoot)
  const checkoutBefore = await checkoutSnapshot(repoRoot)
  server = createServer({ rootDir: homeRoot, port: 0, roleRunner: roles })
  ownTestRunServer(testRun, server)
  const context = {
    scenario: 'cancel-reopen-browser',
    artifactRoot,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
  await requestJson(context.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  await requestJson(context.baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: { goalId: GOAL_ID, title: 'Cancel then reopen delivery', objective: 'Initial contract.' },
  })
  await waitForValue(
    () => requestJson<StateView>(context.baseUrl, '/api/state'),
    (state) =>
      state.activeRuns.some((run) => run.key === `${PROJECT_ID}/${GOAL_ID}/${INITIAL_WORK}`),
    { timeoutMs: 30_000, description: 'active initial Generator before cancellation' },
  )
  await requestJson(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/cancel`, {
    method: 'POST',
  })
  const cancelled = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'cancelled' &&
      goal.works.some((work) => work.id === INITIAL_WORK && work.stage === 'cancelled') &&
      goal.works.some((work) => work.id === DEPENDENT_WORK && work.stage === 'cancelled'),
    { timeoutMs: 30_000, description: 'cancelled dependency chain' },
  )
  const archive = await inspectKanban(context, PROJECT_ID, GOAL_ID)
  assert.equal(
    archive.view?.cancelledArchive,
    true,
    'Browser must retain cancelled Work in its archive',
  )
  const runCountAfterCancel = roles.runs.length
  await Bun.sleep(1_200)
  assert.equal(
    roles.runs.length,
    runCountAfterCancel,
    'Cancelled Goal must not dispatch stale Work',
  )
  await requestJson(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/reopen`, {
    method: 'POST',
  })
  const settled = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'done' &&
      goal.goal.contractRevision === 2 &&
      goal.works.some((work) => work.id === REOPENED_WORK && work.stage === 'done') &&
      goal.works.some((work) => work.id === INITIAL_WORK && work.stage === 'cancelled'),
    { timeoutMs: 60_000, description: 'reopened contract delivery completion' },
  )
  const reopenedBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'reopened',
  })
  assert.equal(
    reopenedBrowser.view?.cancelledArchive,
    true,
    'Reopened terminal Browser view must preserve the cancelled archive',
  )
  const attempts = await requestJson<{
    attempts: Array<{ responsibility: string; status: string; application: string | null }>
  }>(
    context.baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${REOPENED_WORK}/attempts`,
  )
  assert.ok(
    attempts.attempts.some(
      (attempt) => attempt.responsibility === 'reviewer' && attempt.application === 'integrated',
    ),
  )
  const checkoutAfter = await assertAcceptedDelivery(repoRoot, checkoutBefore)
  await Bun.write(
    join(artifactRoot, 'cancel-reopen-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, cancelled, archive, reopenedBrowser, settled, attempts, checkoutBefore, checkoutAfter, runs: roles.runs }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'cancel-reopen-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-023 cancel/reopen browser passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'cancel-reopen-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, runs: roles.runs, error: errorMessage(error) }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'cancel-reopen-contract.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-023 cancel/reopen browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server?.shutdown()
}

function createRoles(): RoleRunner & { runs: string[] } {
  const runner = {
    runs: [] as string[],
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push(`${input.responsibility}:${input.workId}`)
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator' && input.workId === INITIAL_WORK) {
        await new Promise<void>((resolve) =>
          input.signal?.addEventListener('abort', () => resolve(), { once: true }),
        )
        return success('Initial Generator interrupted by cancellation.')
      }
      if (input.responsibility === 'generator') {
        await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const feature = 2\n')
        return success('Reopened Generator completed.')
      }
      assert.equal(
        await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
        'export const feature = 2\n',
      )
      return success('Reviewer accepted reopened source.')
    },
  }
  return runner
}

async function plan(input: RoleRunInput): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const workRoot = join(goalRoot, 'work')
  const authority = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
  )
  const planning = parseWorkDocument(await Bun.file(join(authority, `${input.workId}.md`)).text())
  const works = await Promise.all(
    (await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: authority }))).map((path) =>
      Bun.file(join(authority, path)).text().then(parseWorkDocument),
    ),
  )
  await mkdir(workRoot, { recursive: true })
  if (
    planning.attributes.contractRevision === 1 &&
    !works.some((work) => work.attributes.id === INITIAL_WORK)
  ) {
    await writeWork(workRoot, INITIAL_WORK, planning.attributes.contractRevision, [])
    await writeWork(workRoot, DEPENDENT_WORK, planning.attributes.contractRevision, [INITIAL_WORK])
  } else if (
    planning.attributes.contractRevision === 2 &&
    !works.some((work) => work.attributes.id === REOPENED_WORK)
  ) {
    await writeWork(workRoot, REOPENED_WORK, planning.attributes.contractRevision, [])
  } else if (
    works.some((work) => work.attributes.id === REOPENED_WORK && work.attributes.stage === 'done')
  ) {
    const attentionPath = join(goalRoot, 'attention', `A-complete-${input.runId}.md`)
    await mkdir(dirname(attentionPath), { recursive: true })
    await Bun.write(
      attentionPath,
      renderAttentionDocument({
        attributes: {
          id: `A-complete-${input.runId}`,
          target: null,
          createdAt: '2026-07-14T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nReopened contract delivered.\n',
      }),
    )
  }
  return success('Planner published the current contract plan.')
}

async function writeWork(root: string, id: string, revision: number, dependsOn: string[]) {
  await Bun.write(
    join(root, `${id}.md`),
    renderWorkDocument({
      attributes: {
        id,
        title: id,
        kind: 'engineering',
        stage: 'generate',
        repos: ['primary'],
        notBefore: null,
        dependsOn,
        contractRevision: revision,
        evidenceRefs: [],
        attempts: 0,
      },
      body: '## Acceptance Criteria\n\n- Feature equals 2.\n',
    }),
  )
}
function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}
async function initializeFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Fixture\n')
  await Bun.write(join(root, 'src', 'feature.ts'), 'export const feature = 1\n')
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial fixture'])
}
interface StateView {
  activeRuns: Array<{ key: string }>
}
interface GoalView {
  goal: { lifecycle: string; contractRevision: number }
  works: Array<{ id: string; stage: string }>
}
