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
  checkoutSnapshot,
  clickGoalControl,
  createHarnessArtifactRoot,
  errorMessage,
  gitOutput,
  requestJson,
  waitForValue,
} from '../live/liveHarness'

const PROJECT_ID = 'P-pause-resume'
const GOAL_ID = 'G-pause-resume'
const WORK_ID = 'W-pause-resume'
const startedAt = new Date().toISOString()
const artifactRoot = await createHarnessArtifactRoot('pause-resume-browser', startedAt)
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const roles = createRoles()
let server: MvpServer | null = null

try {
  await initializeFixture(repoRoot)
  const checkoutBefore = await checkoutSnapshot(repoRoot)
  server = createServer({ rootDir: homeRoot, port: 0, roleRunner: roles })
  const context = {
    scenario: 'pause-resume-browser',
    artifactRoot,
    baseUrl: `http://127.0.0.1:${server.port}`,
  }
  await requestJson(context.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  await requestJson(context.baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Pause an active delivery',
      objective: 'Pause then resume safely.',
    },
  })
  await waitForValue(
    () => requestJson<StateView>(context.baseUrl, '/api/state'),
    (state) => state.activeRuns.some((run) => run.key === `${PROJECT_ID}/${GOAL_ID}/${WORK_ID}`),
    { timeoutMs: 30_000, description: 'active Generator before Pause' },
  )
  assert.ok(roles.firstGeneratorWorktree)
  assert.equal(
    await Bun.file(join(roles.firstGeneratorWorktree, 'src', 'partial.ts')).text(),
    'export const partial = true\n',
  )
  const pauseBrowser = await clickGoalControl(context, PROJECT_ID, GOAL_ID, 'Pause')
  const paused = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'paused' &&
      goal.works.some((work) => work.id === WORK_ID && work.stage === 'generate'),
    { timeoutMs: 30_000, description: 'durable paused Goal after browser Pause' },
  )
  const runCountWhilePaused = roles.runs.length
  await Bun.sleep(1_200)
  assert.equal(
    roles.runs.length,
    runCountWhilePaused,
    'Paused Goal must not dispatch another responsibility',
  )
  const resumeBrowser = await clickGoalControl(context, PROJECT_ID, GOAL_ID, 'Resume')
  const settled = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'done' &&
      goal.works.some((work) => work.id === WORK_ID && work.stage === 'done'),
    { timeoutMs: 60_000, description: 'resumed delivery completion' },
  )
  const attempts = await requestJson<{
    attempts: Array<{ responsibility: string; status: string; application: string | null }>
  }>(context.baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${WORK_ID}/attempts`)
  assert.ok(
    attempts.attempts.some(
      (attempt) => attempt.status === 'interrupted' && attempt.responsibility === 'generator',
    ),
  )
  assert.ok(
    attempts.attempts.some(
      (attempt) => attempt.responsibility === 'reviewer' && attempt.application === 'integrated',
    ),
  )
  assert.deepEqual(
    await checkoutSnapshot(repoRoot),
    checkoutBefore,
    'Pause, Resume, and resumed delivery must not mutate the user checkout',
  )
  await Bun.write(
    join(artifactRoot, 'pause-resume-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, pauseBrowser, resumeBrowser, paused, settled, attempts, runs: roles.runs }, null, 2)}\n`,
  )
  console.log(`HOPI-E2E-015 pause/resume browser passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'pause-resume-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, runs: roles.runs, error: errorMessage(error) }, null, 2)}\n`,
  )
  console.error(`HOPI-E2E-015 pause/resume browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server?.shutdown()
}

function createRoles(): RoleRunner & { runs: string[]; firstGeneratorWorktree: string | null } {
  const runner = {
    runs: [] as string[],
    firstGeneratorWorktree: null as string | null,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push(input.responsibility)
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'reviewer') {
        assert.equal(
          await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
          'export const feature = 2\n',
        )
        return success('Reviewer accepted resumed source.')
      }
      if (runner.firstGeneratorWorktree === null) {
        runner.firstGeneratorWorktree = input.cwd
        await Bun.write(join(input.cwd, 'src', 'partial.ts'), 'export const partial = true\n')
        await new Promise<void>((resolve) =>
          input.signal?.addEventListener('abort', () => resolve(), { once: true }),
        )
        return success('Generator stopped by Pause.')
      }
      await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const feature = 2\n')
      return success('Generator completed after Resume.')
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
  const existing = await Promise.all(
    (await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: authority }))).map((path) =>
      Bun.file(join(authority, path)).text().then(parseWorkDocument),
    ),
  )
  const engineering = existing.find((work) => work.attributes.id === WORK_ID)
  await mkdir(workRoot, { recursive: true })
  if (!engineering) {
    await Bun.write(
      join(workRoot, `${WORK_ID}.md`),
      renderWorkDocument({
        attributes: {
          id: WORK_ID,
          title: 'Resume delivery',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- Feature equals 2.\n',
      }),
    )
  } else if (engineering.attributes.stage === 'done') {
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
        body: '## Completion\n\nResumed delivery completed.\n',
      }),
    )
  }
  return success('Planner published the next valid delivery state.')
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
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
  goal: { lifecycle: string }
  works: Array<{ id: string; stage: string }>
}
