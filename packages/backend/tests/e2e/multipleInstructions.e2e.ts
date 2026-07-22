import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import type {
  AssistantModelInput,
  AssistantModelResult,
  AssistantModelRunner,
} from '../../src/assistant/workspaceAssistant'
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
  ownTestRunServer,
  requestJson,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'multiple-instructions'
const PROJECT_A = 'P-instructions-a'
const PROJECT_B = 'P-instructions-b'
const GOAL_A = 'G-instructions-a'
const GOAL_B = 'G-instructions-b'
const testRun = await startTestRun(SCENARIO, 'contract')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoA = join(artifactRoot, 'repo-a')
const repoB = join(artifactRoot, 'repo-b')
const roles = createRoles()
const assistant = createAssistant()
let server: MvpServer | null = null

try {
  await Promise.all([initializeFixture(repoA), initializeFixture(repoB)])
  const [checkoutA, checkoutB] = await Promise.all([
    checkoutSnapshot(repoA),
    checkoutSnapshot(repoB),
  ])
  server = createServer({
    rootDir: homeRoot,
    port: 0,
    roleRunner: roles,
    assistantRunner: assistant,
  })
  ownTestRunServer(testRun, server)
  const baseUrl = `http://127.0.0.1:${server.port}`
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_A, repoId: 'primary', repoPath: repoA },
  })
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_B, repoId: 'primary', repoPath: repoB },
  })
  await requestJson(baseUrl, `/api/projects/${PROJECT_A}/goals`, {
    method: 'POST',
    body: { goalId: GOAL_A, title: 'Keep A running', objective: 'Deliver feature A.' },
  })
  await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      state.activeRuns.some(
        (run) =>
          run.key === `${PROJECT_A}/${GOAL_A}/${workId(PROJECT_A)}` &&
          run.responsibility === 'generator',
      ),
    {
      timeoutMs: 30_000,
      description: 'Project A Generator to remain active before new instructions',
    },
  )
  const statusEvent = await requestJson<{ eventId: string }>(baseUrl, '/api/inbox', {
    method: 'POST',
    body: {
      content: 'What is the current status of Project A?',
      context: { projectId: PROJECT_A, goalId: GOAL_A },
    },
  })
  const repair = await requestJson<{ eventId: string }>(baseUrl, '/api/inbox', {
    method: 'POST',
    body: { content: 'Repair Project B by creating its independent feature.' },
  })
  const settled = await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      lifecycle(state, PROJECT_A, GOAL_A) === 'done' &&
      lifecycle(state, PROJECT_B, GOAL_B) === 'done' &&
      state.activeRuns.length === 0,
    { timeoutMs: 90_000, description: 'both independently scoped Goals to finish' },
  )
  assert.deepEqual(
    assistant.eventIds,
    [statusEvent.eventId, repair.eventId],
    'Public Assistant turns must be FIFO',
  )
  assert.equal(assistant.createdGoals, 1, 'The status question must not create another Goal')
  await Promise.all([
    assertProjectDelivery(repoA, checkoutA, PROJECT_A),
    assertProjectDelivery(repoB, checkoutB, PROJECT_B),
  ])
  const [goalA, goalB] = await Promise.all([
    requestJson<GoalView>(baseUrl, `/api/projects/${PROJECT_A}/goals/${GOAL_A}`),
    requestJson<GoalView>(baseUrl, `/api/projects/${PROJECT_B}/goals/${GOAL_B}`),
  ])
  assert.ok(goalA.works.some((work) => work.id === workId(PROJECT_A) && work.stage === 'done'))
  assert.ok(goalB.works.some((work) => work.id === workId(PROJECT_B) && work.stage === 'done'))
  await Bun.write(
    join(artifactRoot, 'multiple-instructions.json'),
    `${JSON.stringify({ status: 'passed', startedAt, settled, statusEvent, repair, assistant, roleRuns: roles.runs }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, repoA, repoB },
    resultFile: 'multiple-instructions.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-011 multiple instructions passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'multiple-instructions.json'),
    `${JSON.stringify({ status: 'failed', startedAt, assistant, roleRuns: roles.runs, error: errorMessage(error) }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, repoA, repoB },
    resultFile: 'multiple-instructions.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-011 multiple instructions failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server?.shutdown()
}

function createAssistant(): AssistantModelRunner & { eventIds: string[]; createdGoals: number } {
  const runner = {
    eventIds: [] as string[],
    createdGoals: 0,
    async run(input: AssistantModelInput): Promise<AssistantModelResult> {
      if (input.toolMode === 'main') {
        runner.eventIds.push(input.eventId)
        if (runner.eventIds.length === 2) {
          runner.createdGoals += 1
          const response = await fetch(input.toolUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              token: input.toolToken,
              name: 'hopi_create_goal',
              arguments: {
                projectId: PROJECT_B,
                goalId: GOAL_B,
                title: 'Deliver B',
                objective: 'Deliver feature B.',
                firstWork: { kind: 'planning' },
              },
            }),
          })
          if (!response.ok) throw new Error(`Could not create Project B Goal: ${response.status}`)
        }
      }
      return {
        reply:
          runner.eventIds.length === 1
            ? 'Project A is still running.'
            : 'Created Project B delivery.',
        session: {
          transport: 'codex',
          sessionId: `multiple-instructions-${input.toolMode ?? 'main'}`,
        },
      }
    },
  }
  return runner
}

function createRoles(): RoleRunner & {
  runs: Array<{ projectId: string; responsibility: string }>
} {
  let releaseA: (() => void) | null = null
  const projectBStarted = new Promise<void>((resolve) => {
    releaseA = resolve
  })
  const runner = {
    runs: [] as Array<{ projectId: string; responsibility: string }>,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push({ projectId: input.projectId, responsibility: input.responsibility })
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator') {
        if (input.projectId === PROJECT_A) await projectBStarted
        else releaseA?.()
        await Bun.write(
          join(input.cwd, 'src', 'feature.ts'),
          `export const project = '${input.projectId}'\n`,
        )
        return success(`Generator completed ${input.projectId}.`)
      }
      const sourceRoot = input.sourceRoots?.[0]
      assert.ok(sourceRoot, 'Reviewer must receive the candidate source root separately from cwd')
      assert.notEqual(
        sourceRoot,
        input.cwd,
        'Reviewer cwd is its persistent Session workspace, not the candidate checkout',
      )
      assert.equal(
        await Bun.file(join(sourceRoot, 'src', 'feature.ts')).text(),
        `export const project = '${input.projectId}'\n`,
      )
      return success(`Reviewer accepted ${input.projectId}.`)
    },
  }
  return runner
}

async function plan(input: RoleRunInput): Promise<RoleRunResult> {
  const proposalGoal = join(input.context.proposalRoot, '.hopi', 'docs', 'goals', input.goalId)
  const proposalWork = join(proposalGoal, 'work')
  const authorityWork = join(
    input.context.contextRoot,
    'authority',
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
  )
  const planning = parseWorkDocument(
    await Bun.file(join(authorityWork, `${input.workId}.md`)).text(),
  )
  const works = await Promise.all(
    (await Array.fromAsync(new Bun.Glob('*.md').scan({ cwd: authorityWork }))).map((path) =>
      Bun.file(join(authorityWork, path)).text().then(parseWorkDocument),
    ),
  )
  const id = workId(input.projectId)
  await mkdir(proposalWork, { recursive: true })
  if (!works.some((work) => work.attributes.id === id)) {
    await Bun.write(
      join(proposalWork, `${id}.md`),
      renderWorkDocument({
        attributes: {
          id,
          title: `Deliver ${input.projectId}`,
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: `## Acceptance Criteria\n\n- Project equals ${input.projectId}.\n`,
      }),
    )
  } else if (works.some((work) => work.attributes.id === id && work.attributes.stage === 'done')) {
    const attention = join(proposalGoal, 'attention', `A-complete-${input.runId}.md`)
    await mkdir(dirname(attention), { recursive: true })
    await Bun.write(
      attention,
      renderAttentionDocument({
        attributes: {
          id: `A-complete-${input.runId}`,
          target: null,
          createdAt: '2026-07-14T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nDelivery completed.\n',
      }),
    )
  }
  return success('Planner published a scoped plan.')
}

function lifecycle(state: StateView, projectId: string, goalId: string) {
  return state.projects
    .find((project) => project.projectId === projectId)
    ?.goals.find((goal) => goal.id === goalId)?.lifecycle
}
function workId(projectId: string) {
  return `W-${projectId}`
}
function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}
async function initializeFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Fixture\n')
  await Bun.write(join(root, 'src', 'feature.ts'), 'export const project = null\n')
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial fixture'])
}
async function assertProjectDelivery(
  root: string,
  before: Awaited<ReturnType<typeof checkoutSnapshot>>,
  projectId: string,
) {
  const after = await assertAcceptedDelivery(root, before)
  assert.equal(
    (await Bun.file(join(root, 'src', 'feature.ts')).text()).trim(),
    `export const project = '${projectId}'`,
  )
  return after
}
interface StateView {
  projects: Array<{ projectId: string; goals: Array<{ id: string; lifecycle: string }> }>
  activeRuns: Array<{ key: string; responsibility: string }>
}
interface GoalView {
  works: Array<{ id: string; stage: string }>
}
