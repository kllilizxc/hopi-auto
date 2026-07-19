import assert from 'node:assert/strict'
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ConfiguredRoleRunner,
  type RoleRunInput,
  type RoleRunResult,
  type RoleRunner,
} from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../../src/domain/canonicalDocuments'
import { type MvpServer, createServer } from '../../src/mvpServer'
import { runStoragePath } from '../../src/runtime/runPaths'
import {
  assertAcceptedDelivery,
  captureAssistantReply,
  captureCompletionUpdate,
  checkoutSnapshot,
  errorMessage,
  finishTestRun,
  gitOutput,
  inspectKanban,
  ownTestRunServer,
  recordAction,
  requestJson,
  sendAssistantMessage,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'operational-recovery-browser'
const PROJECT_ID = 'P-operational-recovery'
const GOAL_ID = 'G-operational-recovery'
const WORK_ID = 'W-operational-recovery'
const USER_REPLY = '外部执行条件已经修复，请继续当前任务。'
const ASSISTANT_REPLY = '修复信息已记录，任务已恢复执行。'
const COMPLETION_REPLY = '任务已完成，外部执行失败已恢复。'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const failureExecutable = join(artifactRoot, 'operational-failure.ts')
const repairFlag = join(artifactRoot, 'external-condition-repaired')
const roleRuns: RoleRunRecord[] = []
const assistantRuns: AssistantRunRecord[] = []
const successfulRoles = createSuccessfulRoles()
const processRunner = new ConfiguredRoleRunner({
  resolveConfig: () => ({
    transport: 'process',
    cwdMode: 'worktree',
    cmd: ['bun', failureExecutable],
  }),
})
let attentionToResolve: string | null = null
let server: MvpServer | null = null
let serverCleanup: ReturnType<typeof ownTestRunServer> | null = null
let restartCount = 0

const roleRunner: RoleRunner = {
  async run(input, observer) {
    const repaired = await Bun.file(repairFlag).exists()
    const outcome = repaired
      ? await successfulRoles.run(input, observer)
      : await processRunner.run(input, observer)
    roleRuns.push({
      runId: input.runId,
      workId: input.workId,
      responsibility: input.responsibility,
      repaired,
      result: outcome.result,
      applicationKind: outcome.failureKind ?? 'semantic',
      exitCode: outcome.exitCode,
    })
    return outcome
  },
}

const assistantRunner: AssistantModelRunner = {
  async run(input, observer) {
    const mode = input.toolMode ?? 'main'
    assistantRuns.push({ eventId: input.eventId, mode, action: 'reply' })
    if (mode === 'internal') {
      const message = (await Bun.file(repairFlag).exists())
        ? COMPLETION_REPLY
        : '当前任务连续运行失败，需要你修复外部执行条件后告诉我继续。'
      await callAssistantTool(input, observer, 'hopi_request_user', { message })
      return assistantResult(message, mode)
    }
    if (mode === 'main' && attentionToResolve && input.prompt.includes(USER_REPLY)) {
      const attentionId = attentionToResolve
      await callAssistantTool(input, observer, 'hopi_control_work', {
        projectId: PROJECT_ID,
        goalId: GOAL_ID,
        workId: 'plan-initial',
        operation: 'retry',
      })
      attentionToResolve = null
      assistantRuns.push({ eventId: input.eventId, mode, action: `retried:${attentionId}` })
      return assistantResult(ASSISTANT_REPLY, mode)
    }
    return assistantResult(mode === 'reflection' ? '' : '没有需要执行的操作。', mode)
  },
}

const context = { scenario: SCENARIO, artifactRoot, baseUrl: '' }
let blocked: GoalView | null = null
let settled: GoalView | null = null

try {
  await initializeFixture(repoRoot, failureExecutable)
  const checkoutBefore = await checkoutSnapshot(repoRoot)
  startServer()
  await recordAction(context, 'server_started', { baseUrl: context.baseUrl })
  await requestJson(context.baseUrl, '/api/projects', {
    method: 'POST',
    body: { projectId: PROJECT_ID, repoId: 'primary', repoPath: repoRoot },
  })
  await requestJson(context.baseUrl, `/api/projects/${PROJECT_ID}/goals`, {
    method: 'POST',
    body: {
      goalId: GOAL_ID,
      title: 'Recover from an operational failure',
      objective: 'Exercise bounded operational recovery through the production Coordinator.',
    },
  })

  for (const expectedFailures of [1, 2]) {
    await waitForOperationalFailures(expectedFailures)
    await restartServer()
  }

  blocked = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) =>
      operationalAttention(value)?.notifiedAt !== null &&
      value.works.some(
        (work) => work.id === 'plan-initial' && work.projection.primaryBadge === 'Needs you',
      ),
    { timeoutMs: 60_000, description: 'operational exhaustion and Needs you projection' },
  )
  const failedRuns = roleRuns.filter((run) => run.applicationKind === 'operational')
  assert.equal(failedRuns.length, 3, 'The Coordinator must stop after three operational failures')
  assert.equal(restartCount, 2, 'The failure episode must cross two Coordinator restarts')
  assert.equal(
    blocked.works.find((work) => work.id === 'plan-initial')?.attempts,
    0,
    'Operational failures must not consume semantic Work attempts',
  )
  const blocker = operationalAttention(blocked)
  assert.ok(blocker, 'Operational exhaustion must create one Work-target Attention')
  assert.match(blocker.body, /3 consecutive operational failures/)
  assert.equal(
    blocked.attentions.filter(
      (attention) => attention.target === workTarget('plan-initial') && !attention.resolvedAt,
    ).length,
    1,
  )
  const rawFailures = await readFailureEvidence(failedRuns)
  const blockedBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'blocked',
  })

  attentionToResolve = blocker.id
  await Bun.write(repairFlag, 'repaired\n')
  await recordAction(context, 'external_condition_repaired', { attentionId: blocker.id })
  const assistantBrowser = await sendAssistantMessage(context, USER_REPLY, {
    evidencePrefix: 'repair',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })
  settled = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) =>
      value.goal.lifecycle === 'done' &&
      value.works.some((work) => work.id === WORK_ID && work.stage === 'done') &&
      Boolean(value.attentions.find((attention) => attention.id === blocker.id)?.resolvedAt),
    { timeoutMs: 90_000, description: 'fresh operational episode and completed delivery' },
  )
  const assistantReplyBrowser = await captureAssistantReply(context, ASSISTANT_REPLY)
  const completionBrowser = await captureCompletionUpdate(context, COMPLETION_REPLY)
  const recoveredBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'recovered',
  })
  const planningAttempts = await readAttempts('plan-initial')
  assert.equal(
    planningAttempts.attempts.filter((attempt) => attempt.application === 'operational_failure')
      .length,
    3,
  )
  assert.ok(
    planningAttempts.attempts.some(
      (attempt) => attempt.status === 'finished' && attempt.application === 'published',
    ),
    'The same planning Work must publish successfully in the fresh episode',
  )
  assert.equal(
    settled.attentions.filter((attention) => attention.target === workTarget('plan-initial'))
      .length,
    1,
    'Recovery must retain and resolve the original blocker rather than replacing history',
  )
  assert.equal(
    settled.attentions.filter((attention) => attention.target !== null && !attention.resolvedAt)
      .length,
    0,
    'Successful recovery must clear every targeted blocker',
  )
  assert.ok(
    assistantRuns.some((run) => run.action === `retried:${blocker.id}`),
    'One Work retry must atomically resolve the exact blocker through its tool boundary',
  )
  const checkoutAfter = await assertAcceptedDelivery(repoRoot, checkoutBefore)

  const evidence = {
    status: 'passed',
    startedAt,
    projectId: PROJECT_ID,
    goalId: GOAL_ID,
    restartCount,
    roleRuns,
    assistantRuns,
    checkoutBefore,
    checkoutAfter,
    rawFailures,
    blocker,
    settled,
    planningAttempts,
    browser: {
      blockedBrowser,
      assistantBrowser,
      assistantReplyBrowser,
      completionBrowser,
      recoveredBrowser,
    },
  }
  await Bun.write(
    join(artifactRoot, 'browser-contract.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    ...evidence,
    resultFile: 'browser-contract.json',
    paths: { home: homeRoot, repo: repoRoot },
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-014 Browser passed: ${artifactRoot}`)
} catch (error) {
  const evidence = {
    status: 'failed',
    startedAt,
    restartCount,
    roleRuns,
    assistantRuns,
    blocked,
    settled,
    error: errorMessage(error),
  }
  await Bun.write(
    join(artifactRoot, 'browser-contract.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    ...evidence,
    resultFile: 'browser-contract.json',
    paths: { home: homeRoot, repo: repoRoot },
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-014 Browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await shutdownServer()
}

function startServer() {
  server = createServer({ rootDir: homeRoot, port: 0, roleRunner, assistantRunner })
  serverCleanup = ownTestRunServer(testRun, server)
  context.baseUrl = `http://127.0.0.1:${server.port}`
}

async function restartServer() {
  await shutdownServer()
  restartCount += 1
  startServer()
  await recordAction(context, 'server_restarted', {
    restartCount,
    baseUrl: context.baseUrl,
  })
}

async function shutdownServer() {
  const cleanup = serverCleanup
  server = null
  serverCleanup = null
  if (cleanup) await cleanup.run()
}

async function waitForOperationalFailures(expected: number) {
  return waitForValue(
    () => readAttempts('plan-initial'),
    (value) =>
      value.attempts.filter((attempt) => attempt.application === 'operational_failure').length >=
      expected,
    { timeoutMs: 30_000, description: `${expected} retained operational failure(s)` },
  )
}

function readAttempts(workId: string) {
  return requestJson<AttemptsView>(
    context.baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${workId}/attempts`,
  )
}

function goalPath() {
  return `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`
}

function workTarget(workId: string) {
  return `project:${PROJECT_ID}/goal:${GOAL_ID}/work:${workId}`
}

function operationalAttention(goal: GoalView) {
  return goal.attentions.find((attention) => attention.target === workTarget('plan-initial'))
}

async function readFailureEvidence(runs: RoleRunRecord[]) {
  return Promise.all(
    runs.map(async (run) => {
      const root = runStoragePath(homeRoot, run.runId)
      const transcript = await Bun.file(join(root, 'transcript.log')).text()
      const events = await requestJson<{ items: AttemptEvent[] }>(
        context.baseUrl,
        `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}/works/${run.workId}/attempts/${run.runId}/events?limit=200`,
      )
      assert.match(transcript, /stdout: operational fixture stdout/)
      assert.match(transcript, /stderr: operational fixture stderr/)
      assert.ok(
        events.items.some(
          (event) =>
            event.kind === 'message' &&
            event.content?.includes('operational fixture stdout') === true,
        ),
        'Normalized Attempt stream must retain process stdout',
      )
      assert.ok(
        events.items.some(
          (event) =>
            event.kind === 'message' &&
            event.content?.includes('operational fixture stderr') === true,
        ),
        'Normalized Attempt stream must retain process stderr',
      )
      return { runId: run.runId, transcriptPath: join(root, 'transcript.log'), transcript, events }
    }),
  )
}

async function callAssistantTool(
  input: Parameters<AssistantModelRunner['run']>[0],
  observer: Parameters<AssistantModelRunner['run']>[1],
  name: 'hopi_request_user' | 'hopi_control_work',
  args: Record<string, unknown>,
) {
  await observer?.onEvent?.({
    kind: 'transcript',
    transport: 'codex',
    entryKind: 'tool_call',
    summary: name,
    toolName: name,
  })
  const response = await fetch(input.toolUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: input.toolToken, name, arguments: args }),
  })
  const body = await response.text()
  await observer?.onEvent?.({
    kind: 'transcript',
    transport: 'codex',
    entryKind: response.ok ? 'tool_result' : 'error',
    summary: body,
    toolName: name,
  })
  if (!response.ok) throw new Error(`${name} failed with ${response.status}: ${body}`)
}

function assistantResult(reply: string, mode: string) {
  return {
    reply,
    session: { transport: 'codex' as const, sessionId: `operational-browser-${mode}` },
  }
}

function createSuccessfulRoles(): RoleRunner {
  return {
    async run(input) {
      if (input.responsibility === 'planner') return plan(input)
      if (input.responsibility === 'generator') {
        await mkdir(join(input.cwd, 'src'), { recursive: true })
        await Bun.write(join(input.cwd, 'src', 'recovered.ts'), 'export const recovered = true\n')
        return success('Generator completed after the external condition was repaired.')
      }
      assert.equal(
        await Bun.file(join(input.cwd, 'src', 'recovered.ts')).text(),
        'export const recovered = true\n',
      )
      return success('Reviewer accepted the recovered delivery.')
    },
  }
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
          title: 'Complete recovered delivery',
          kind: 'engineering',
          stage: 'generate',
          repos: ['primary'],
          notBefore: null,
          dependsOn: [],
          contractRevision: planning.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: '## Acceptance Criteria\n\n- Recovered source is delivered through C1.\n',
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
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Completion\n\nOperational recovery completed successfully.\n',
      }),
    )
  }
  return success('Planner published the next recovered delivery state.')
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

async function initializeFixture(root: string, executable: string) {
  await mkdir(join(root, 'scripts', 'hopi'), { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Operational recovery fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
  const prepare = join(root, 'scripts', 'hopi', 'prepare')
  await Bun.write(prepare, '#!/usr/bin/env sh\nset -eu\n:\n')
  await chmod(prepare, 0o755)
  await Bun.write(
    executable,
    [
      "console.log(`operational fixture stdout: ${process.env.HOPI_RUN_ID ?? 'unknown'}`)",
      "console.error(`operational fixture stderr: ${process.env.HOPI_RUN_ID ?? 'unknown'}`)",
      'process.exit(23)',
      '',
    ].join('\n'),
  )
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial operational recovery fixture'])
}

interface RoleRunRecord {
  runId: string
  workId: string
  responsibility: string
  repaired: boolean
  result: string
  applicationKind: string
  exitCode: number | null
}

interface AssistantRunRecord {
  eventId: string
  mode: string
  action: string
}

interface GoalView {
  goal: { lifecycle: string }
  works: Array<{
    id: string
    stage: string
    attempts: number
    projection: { primaryBadge: string | null }
  }>
  attentions: Array<{
    id: string
    target: string | null
    resolvedAt: string | null
    notifiedAt: string | null
    body: string
  }>
}

interface AttemptsView {
  attempts: Array<{
    runId: string
    status: string
    application: string | null
    summary: string | null
  }>
}

interface AttemptEvent {
  kind: string
  content?: string
  summary?: string
}
