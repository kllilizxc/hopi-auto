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
  errorMessage,
  finishTestRun,
  gitOutput,
  ownTestRunServer,
  requestJson,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'restart-during-generator'
const PROJECT_ID = 'P-restart'
const GOAL_ID = 'G-restart'
const WORK_ID = 'W-restart'
const testRun = await startTestRun(SCENARIO, 'contract')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const firstRunner = createRestartRoleRunner(true)
const resumedRunner = createRestartRoleRunner(false)
let firstServer: MvpServer | null = null
let resumedServer: MvpServer | null = null
let firstServerCleanup: ReturnType<typeof ownTestRunServer> | null = null
let resumedServerCleanup: ReturnType<typeof ownTestRunServer> | null = null

try {
  await initializeFixture(repoRoot)
  firstServer = createServer({ rootDir: homeRoot, port: 0, roleRunner: firstRunner })
  firstServerCleanup = ownTestRunServer(testRun, firstServer)
  const firstUrl = `http://127.0.0.1:${firstServer.port}`
  await requestJson(firstUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  await requestJson(firstUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Recover a Generator after Coordinator replacement',
      objective: 'Checkpoint active source safely and finish only after a replacement Coordinator.',
    },
  })

  const active = await waitForValue(
    () => requestJson<StateView>(firstUrl, '/api/state'),
    (state) =>
      state.activeRuns.some(
        (run) =>
          run.key === `${PROJECT_ID}/${GOAL_ID}/${WORK_ID}` && run.responsibility === 'generator',
      ) && firstRunner.generatorWorktree !== null,
    { timeoutMs: 30_000, description: 'first Generator source delta and active Attempt' },
  )
  assert.ok(firstRunner.generatorWorktree)
  assert.equal(
    await Bun.file(join(firstRunner.generatorWorktree, 'src', 'restart-marker.ts')).text(),
    'export const generatorCheckpoint = true\n',
  )

  await firstServerCleanup.run()
  firstServer = null

  const interrupted = await readAttempts(homeRoot)
  const interruptedGenerator = interrupted.find(
    (attempt) => attempt.responsibility === 'generator' && attempt.status === 'interrupted',
  )
  assert.ok(
    interruptedGenerator,
    'Coordinator shutdown must durably interrupt the active Generator',
  )
  assert.equal(
    active.activeRuns.length,
    1,
    'The pre-shutdown API observation must retain exactly the one active Generator Run',
  )

  resumedServer = createServer({ rootDir: homeRoot, port: 0, roleRunner: resumedRunner })
  resumedServerCleanup = ownTestRunServer(testRun, resumedServer)
  const resumedUrl = `http://127.0.0.1:${resumedServer.port}`
  const settled = await waitForValue(
    () => requestJson<GoalView>(resumedUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'done' &&
      goal.works.find((work) => work.id === WORK_ID)?.stage === 'done',
    { timeoutMs: 60_000, description: 'replacement Coordinator delivery completion' },
  )
  const attempts = await readAttempts(homeRoot)
  assert.equal(
    attempts.filter(
      (attempt) => attempt.responsibility === 'generator' && attempt.status === 'interrupted',
    ).length,
    1,
    'The old Generator Attempt must remain interrupted after replacement',
  )
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.responsibility === 'generator' &&
        attempt.status === 'finished' &&
        attempt.application === 'published',
    ),
    'The replacement Coordinator must publish a fresh successful Generator Attempt',
  )
  assert.ok(
    attempts.some(
      (attempt) =>
        attempt.responsibility === 'reviewer' &&
        attempt.status === 'finished' &&
        attempt.application === 'integrated',
    ),
    'The replacement Coordinator must integrate only an accepted Review',
  )
  assert.equal(
    await gitOutput(join(homeRoot, '.hopi', 'projects', PROJECT_ID, 'integration'), [
      'rev-list',
      '--count',
      'refs/heads/hopi/release',
      '--grep',
      `project:${PROJECT_ID}/goal:${GOAL_ID}/work:${WORK_ID}`,
    ]),
    '1',
    'C1 must advance at most once for the recovered Work',
  )
  await Bun.write(
    join(artifactRoot, 'restart-contract.json'),
    `${JSON.stringify(
      {
        status: 'passed',
        startedAt,
        projectId: PROJECT_ID,
        goalId: GOAL_ID,
        workId: WORK_ID,
        activeBeforeShutdown: active.activeRuns,
        interruptedGenerator,
        attempts,
        finalGoal: settled,
        firstRuns: firstRunner.runs,
        resumedRuns: resumedRunner.runs,
      },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'restart-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-016 restart contract passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'restart-contract.json'),
    `${JSON.stringify(
      {
        status: 'failed',
        startedAt,
        firstRuns: firstRunner.runs,
        resumedRuns: resumedRunner.runs,
        error: errorMessage(error),
      },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'restart-contract.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-016 restart contract failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await resumedServerCleanup?.run()
  await firstServerCleanup?.run()
}

function createRestartRoleRunner(blockFirstGenerator: boolean): RoleRunner & {
  runs: Array<{ responsibility: string; runId: string }>
  generatorWorktree: string | null
} {
  const runner = {
    runs: [] as Array<{ responsibility: string; runId: string }>,
    generatorWorktree: null as string | null,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push({ responsibility: input.responsibility, runId: input.runId })
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator') return generate(input)
      if (input.responsibility === 'reviewer') return review(input)
      throw new Error(`Unexpected responsibility: ${input.responsibility}`)
    },
  }

  async function generate(input: RoleRunInput): Promise<RoleRunResult> {
    if (blockFirstGenerator) {
      runner.generatorWorktree = input.cwd
      await Bun.write(
        join(input.cwd, 'src', 'restart-marker.ts'),
        'export const generatorCheckpoint = true\n',
      )
      await new Promise<void>((resolve) =>
        input.signal?.addEventListener('abort', () => resolve(), { once: true }),
      )
      return successful('Generator was stopped after writing a checkpoint candidate.')
    }
    await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const feature = 2\n')
    return successful('Replacement Generator finished the recovered candidate.')
  }
  return runner
}

async function plan(input: RoleRunInput): Promise<RoleRunResult> {
  const goalRoot = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const proposalWorkRoot = join(goalRoot, 'work')
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
  const authorityWorks = await Promise.all(
    (await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: authorityWorkRoot }))).map((path) =>
      Bun.file(join(authorityWorkRoot, path)).text().then(parseWorkDocument),
    ),
  )
  const engineeringExists = authorityWorks.some((work) => work.attributes.kind === 'engineering')
  await mkdir(proposalWorkRoot, { recursive: true })
  if (!engineeringExists) {
    await Bun.write(
      join(proposalWorkRoot, `${WORK_ID}.md`),
      renderWorkDocument({
        attributes: {
          id: WORK_ID,
          title: 'Recover the interrupted Generator candidate',
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
          createdAt: '2026-07-14T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nReplacement Coordinator completed the recovered delivery.\n',
      }),
    )
  }
  return successful('Planner published the recovered delivery plan.')
}

async function review(input: RoleRunInput): Promise<RoleRunResult> {
  assert.equal(
    await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
    'export const feature = 2\n',
  )
  return successful('Reviewer accepted the recovered source.')
}

function successful(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Restart fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module","scripts":{"test":"bun test"}}\n')
  await Bun.write(join(root, 'src', 'feature.ts'), 'export const feature = 1\n')
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial restart fixture'])
}

async function readAttempts(root: string) {
  const attemptsRoot = join(root, '.hopi', 'runtime', 'runs')
  const runIds = await Array.fromAsync(
    new Bun.Glob('*').scan({ cwd: attemptsRoot, onlyFiles: false }),
  )
  const attempts = await Promise.all(
    runIds.map(async (runId) => {
      const file = Bun.file(join(attemptsRoot, runId, 'attempt.json'))
      if (!(await file.exists())) return null
      return JSON.parse(await file.text()) as {
        responsibility: string
        status: string
        application: string | null
        runId: string
        projectId: string
        goalId: string
        workId: string
      }
    }),
  )
  return attempts.filter(
    (attempt): attempt is NonNullable<typeof attempt> =>
      attempt !== null &&
      attempt.projectId === PROJECT_ID &&
      attempt.goalId === GOAL_ID &&
      attempt.workId === WORK_ID,
  )
}

interface StateView {
  activeRuns: Array<{ key: string; responsibility: string }>
}

interface GoalView {
  goal: { lifecycle: string }
  works: Array<{ id: string; stage: string }>
}
