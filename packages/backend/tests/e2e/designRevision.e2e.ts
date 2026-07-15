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
  checkoutSnapshot,
  errorMessage,
  finishTestRun,
  gitOutput,
  requestJson,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'design-revision-active-delivery'
const PROJECT_ID = 'P-design-revision'
const GOAL_ID = 'G-design-revision'
const WORK_ID = 'W-design-revision'
const testRun = await startTestRun(SCENARIO, 'contract')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const roles = createRoles()
const assistant = createAssistant()
let server: MvpServer | null = null

try {
  await initializeFixture(repoRoot)
  const checkoutBefore = await checkoutSnapshot(repoRoot)
  server = createServer({
    rootDir: homeRoot,
    port: 0,
    roleRunner: roles,
    assistantRunner: assistant,
  })
  const baseUrl = `http://127.0.0.1:${server.port}`
  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Revise a running delivery',
      objective: 'Initial acceptance: feature must export revision 1.',
    },
  })
  await waitForValue(
    () => requestJson<StateView>(baseUrl, '/api/state'),
    (state) =>
      state.activeRuns.some(
        (run) =>
          run.key === `${PROJECT_ID}/${GOAL_ID}/${WORK_ID}` && run.responsibility === 'generator',
      ),
    { timeoutMs: 30_000, description: 'initial Generator before material design revision' },
  )

  await requestJson(baseUrl, '/api/inbox', {
    method: 'POST',
    body: {
      content:
        'Material design change: replace revision 1 with revision 2 and retain no revision 1 behavior.',
      context: { projectId: PROJECT_ID, goalId: GOAL_ID },
    },
  })
  const settled = await waitForValue(
    () => requestJson<GoalView>(baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`),
    (goal) =>
      goal.goal.lifecycle === 'done' &&
      goal.goal.contractRevision === 2 &&
      goal.works.some((work) => work.id === WORK_ID && work.stage === 'done'),
    { timeoutMs: 90_000, description: 'revised delivery completion' },
  )
  const attempts = await requestJson<{
    attempts: Array<{
      responsibility: string
      status: string
      application: string | null
      contractRevision?: number
    }>
  }>(baseUrl, `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${WORK_ID}/attempts`)
  assert.equal(
    assistant.materialRevisionRequests,
    1,
    'The material instruction must be interpreted once',
  )
  assert.ok(
    attempts.attempts.some(
      (attempt) =>
        attempt.responsibility === 'generator' &&
        (attempt.application === 'stale' || attempt.status === 'interrupted'),
    ),
    'The pre-revision Generator must be retained as stale or interrupted rather than published',
  )
  assert.ok(
    attempts.attempts.some(
      (attempt) => attempt.responsibility === 'generator' && attempt.application === 'published',
    ),
    'A fresh Generator result must publish under the revised contract',
  )
  assert.equal(
    attempts.attempts.filter(
      (attempt) => attempt.responsibility === 'generator' && attempt.application === 'published',
    ).length,
    1,
    'Only the fresh Generator may publish after the material revision',
  )
  assert.ok(
    attempts.attempts.some(
      (attempt) => attempt.responsibility === 'reviewer' && attempt.application === 'integrated',
    ),
    'Only a Reviewer result from the revised candidate may integrate',
  )
  assert.deepEqual(await checkoutSnapshot(repoRoot), checkoutBefore)
  await Bun.write(
    join(artifactRoot, 'design-revision-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, settled, attempts, roleRuns: roles.runs }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'design-revision-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-012 design revision passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'design-revision-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, roleRuns: roles.runs, error: errorMessage(error) }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot, repo: repoRoot },
    resultFile: 'design-revision-contract.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-012 design revision failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server?.shutdown()
}

function createAssistant(): AssistantModelRunner & { materialRevisionRequests: number } {
  const runner = {
    materialRevisionRequests: 0,
    async run(input: AssistantModelInput): Promise<AssistantModelResult> {
      if (input.toolMode === 'main') {
        runner.materialRevisionRequests += 1
        const response = await fetch(input.toolUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: input.toolToken,
            name: 'hopi_request_planning',
            arguments: {
              projectId: PROJECT_ID,
              goalId: GOAL_ID,
              materialContractChange: true,
            },
          }),
        })
        if (!response.ok) throw new Error(`Could not request material planning: ${response.status}`)
      }
      return {
        reply:
          input.toolMode === 'reflection' ? '' : 'The revised contract is now being delivered.',
        session: { transport: 'codex', sessionId: `design-revision-${input.toolMode ?? 'main'}` },
      }
    },
  }
  return runner
}

function createRoles(): RoleRunner & { runs: Array<{ responsibility: string; revision: number }> } {
  const runner = {
    runs: [] as Array<{ responsibility: string; revision: number }>,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      const revision = await readRevision(input)
      runner.runs.push({ responsibility: input.responsibility, revision })
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator') {
        if (revision === 1) {
          await new Promise<void>((resolve) =>
            input.signal?.addEventListener('abort', () => resolve(), { once: true }),
          )
          await Bun.write(
            join(input.cwd, 'src', 'feature.ts'),
            'export const featureRevision = 1\n',
          )
          return success('Stale Generator proposed revision 1 after interruption.')
        }
        await Bun.write(join(input.cwd, 'src', 'feature.ts'), 'export const featureRevision = 2\n')
        return success('Fresh Generator completed revision 2.')
      }
      assert.equal(
        await Bun.file(join(input.cwd, 'src', 'feature.ts')).text(),
        'export const featureRevision = 2\n',
      )
      return success('Reviewer accepted only revision 2.')
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
  const engineering = works.find((work) => work.attributes.id === WORK_ID)
  await mkdir(workRoot, { recursive: true })
  if (!engineering) {
    await Bun.write(
      join(workRoot, `${WORK_ID}.md`),
      renderWorkDocument({
        attributes: {
          id: WORK_ID,
          title: 'Deliver the current revision',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: `## Acceptance Criteria\n\n- Feature exports revision ${planning.attributes.contractRevision}.\n`,
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
        body: '## Completion\n\nRevision 2 is the accepted release.\n',
      }),
    )
  }
  return success('Planner published the current contract plan.')
}

async function readRevision(input: RoleRunInput) {
  const source = await Bun.file(
    join(
      input.context.contextRoot,
      'authority',
      '.hopi',
      'docs',
      'goals',
      input.goalId,
      'work',
      `${input.workId}.md`,
    ),
  ).text()
  return parseWorkDocument(source).attributes.contractRevision
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixture(root: string) {
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Fixture\n')
  await Bun.write(join(root, 'src', 'feature.ts'), 'export const featureRevision = 0\n')
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
  activeRuns: Array<{ key: string; responsibility: string }>
}
interface GoalView {
  goal: { lifecycle: string; contractRevision: number }
  works: Array<{ id: string; stage: string }>
}
