import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { workspaceAttentionReference } from '../../src/domain/attentionReference'
import { parseWorkDocument, renderWorkDocument } from '../../src/domain/canonicalDocuments'
import { createServer } from '../../src/mvpServer'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createWorkspaceAttentionController } from '../../src/runtime/workspaceAttentionController'
import { createAssistantHomeStore } from '../../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../../src/storage/goalPackageStore'
import {
  captureAssistantReply,
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

const SCENARIO = 'project-attention-recovery-browser'
const PROJECT_ID = 'P-project-attention'
const GOAL_ID = 'G-project-attention'
const WORK_ID = 'W-after-project-recovery'
const USER_MESSAGE = '我已经检查过项目环境，请解除 Project blocker 并继续。'
const ASSISTANT_REPLY = 'Project Attention 已解除，Coordinator 已恢复执行。'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const recoveryBlocker = join(repoRoot, 'local-recovery-blocker.txt')
const roleRuns: Array<{ runId: string; responsibility: string; status: string }> = []
const assistantToolResults: Array<{ attentionId: string; changed: boolean }> = []
let attentionToResolve = ''
let assistantHomeId = ''
let releasePlanner: (() => void) | undefined
const plannerGate = new Promise<void>((resolveGate) => {
  releasePlanner = resolveGate
})

const roleRunner: RoleRunner = {
  async run(input) {
    const record = {
      runId: input.runId,
      responsibility: input.responsibility,
      status: 'started',
    }
    roleRuns.push(record)
    if (input.responsibility === 'planner') {
      await plannerGate
      await stageEngineeringWork(input)
      record.status = 'finished'
      return success('Planner published the first delivery Work after Project recovery.')
    }
    if (input.responsibility === 'generator') {
      await mkdir(join(input.cwd, 'src'), { recursive: true })
      await Bun.write(join(input.cwd, 'src', 'delivery.ts'), 'export const delivered = true\n')
      await rm(join(input.cwd, '.git'), { force: true })
      record.status = 'finished'
      return success('Generator produced source after an incorrect Project recovery judgment.')
    }
    throw new Error('Reviewer must not run after the task checkpoint failure')
  },
}

const assistantRunner: AssistantModelRunner = {
  async run(input, observer) {
    const mode = input.toolMode ?? 'main'
    if (mode === 'main' && input.prompt.includes(USER_MESSAGE)) {
      await rm(recoveryBlocker, { force: true })
      const response = await callAssistantTool(input, observer, 'hopi_resolve_attention', {
        attentionRef: workspaceAttentionReference(assistantHomeId, attentionToResolve),
        resolution: USER_MESSAGE,
      })
      assistantToolResults.push({
        attentionId: attentionToResolve,
        changed: response.changed === true,
      })
      return assistantResult(ASSISTANT_REPLY, mode)
    }
    return assistantResult(
      mode === 'reflection' ? 'No handoff required.' : 'Project is blocked.',
      mode,
    )
  },
}

const context = { scenario: SCENARIO, artifactRoot, baseUrl: '' }
let server: ReturnType<typeof createServer> | null = null
let initial: GoalView | null = null
let resumed: GoalView | null = null
let reblocked: GoalView | null = null

try {
  await initializeRepo(repoRoot)
  const checkoutBefore = await checkoutSnapshot(repoRoot)
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  await home.initialize()
  const linked = await home.linkProject({ projectId: PROJECT_ID, repoPath: repoRoot })
  const goalStore = createGoalPackageStore(linked.integrationRoot, PROJECT_ID, publisher)
  await goalStore.createGoal({
    goalId: GOAL_ID,
    title: 'Recover Project execution',
    objective: 'Resume Planning after an Agent resolves Project Attention.',
  })
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  assistantHomeId = (await workspace.readWorkspace()).homeId
  const original = await createWorkspaceAttentionController(workspace).ensureProjectAttention(
    PROJECT_ID,
    'The Project environment needs Agent inspection before execution can continue.',
  )
  attentionToResolve = original.attributes.id
  await Bun.write(recoveryBlocker, 'Remove this external checkout change before recovery.\n')

  server = createServer({ rootDir: homeRoot, port: 0, roleRunner, assistantRunner })
  ownTestRunServer(testRun, server)
  context.baseUrl = `http://127.0.0.1:${server.port}`
  await recordAction(context, 'server_started', { baseUrl: context.baseUrl })

  initial = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) => value.projectAttention?.id === original.attributes.id,
    { timeoutMs: 30_000, description: 'the original Project Attention on GoalDetail' },
  )
  assertWorkIsProjectBlocked(initial)
  const initialBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-blocked',
  })
  assert.equal(initialBrowser.view?.projectBlocked, true)
  assert.match(initialBrowser.view?.projectAttentionBody ?? '', /needs Agent inspection/)

  const assistantBrowser = await sendAssistantMessage(context, USER_MESSAGE, {
    evidencePrefix: 'project-resolve',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })
  resumed = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) =>
      value.projectAttention === null &&
      roleRuns.some((run) => run.responsibility === 'planner' && run.status === 'started'),
    { timeoutMs: 30_000, description: 'Project eligibility restoration and Planner dispatch' },
  )
  assert.equal(
    resumed.works.find((work) => work.id === 'plan-initial')?.projection.primaryBadge,
    'working',
  )
  const resumedBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-resumed',
  })
  assert.equal(resumedBrowser.view?.projectBlocked, false)
  assert.equal(resumedBrowser.view?.projectAttentionBody, null)
  const assistantReplyBrowser = await captureAssistantReply(context, ASSISTANT_REPLY)

  releasePlanner?.()
  reblocked = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) => {
      const work = value.works.find((candidate) => candidate.id === WORK_ID)
      return (
        value.projectAttention !== null &&
        value.projectAttention.id !== original.attributes.id &&
        value.projectAttention.body.includes('Task checkpoint failed') &&
        work?.projection.primaryBadge === 'waiting' &&
        work.projection.failedPredicates.length === 1 &&
        work.projection.failedPredicates[0] === 'project_ineligible'
      )
    },
    {
      timeoutMs: 60_000,
      description: 'the stable Project-blocked state after the admitted Generator Run drains',
    },
  )
  assertWorkIsProjectBlocked(reblocked)
  assert.equal(
    reblocked.attentions.filter(
      (attention) => attention.target !== null && attention.resolvedAt === null,
    ).length,
    0,
    'Project failure must not be projected as Goal or Work Needs you',
  )
  const reblockedBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-reblocked',
  })
  assert.equal(reblockedBrowser.view?.projectBlocked, true)
  assert.match(reblockedBrowser.view?.projectAttentionBody ?? '', /Task checkpoint failed/)
  assert.deepEqual(assistantToolResults, [{ attentionId: original.attributes.id, changed: true }])
  assert.deepEqual(
    await checkoutSnapshot(repoRoot),
    checkoutBefore,
    'Project recovery must not mutate the user checkout',
  )

  const evidence = {
    status: 'passed',
    startedAt,
    originalAttentionId: original.attributes.id,
    replacementAttentionId: reblocked.projectAttention?.id,
    roleRuns,
    assistantToolResults,
    initial,
    resumed,
    reblocked,
    browser: {
      initialBrowser,
      assistantBrowser,
      assistantReplyBrowser,
      resumedBrowser,
      reblockedBrowser,
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
  console.log(`HOPI-E2E-028 Browser passed: ${artifactRoot}`)
} catch (error) {
  const evidence = {
    status: 'failed',
    startedAt,
    error: errorMessage(error),
    roleRuns,
    assistantToolResults,
    initial,
    resumed,
    reblocked,
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
  console.error(`HOPI-E2E-028 Browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  releasePlanner?.()
  await server?.shutdown()
}

function assertWorkIsProjectBlocked(goal: GoalView) {
  const blockedWork = goal.works.find((work) => work.stage !== 'done' && work.stage !== 'cancelled')
  assert.ok(blockedWork, 'A nonterminal Work must remain visible while Project is blocked')
  assert.equal(blockedWork.projection.primaryBadge, 'waiting')
  assert.deepEqual(blockedWork.projection.failedPredicates, ['project_ineligible'])
  assert.notEqual(blockedWork.projection.primaryBadge, 'Needs you')
}

async function stageEngineeringWork(input: RoleRunInput) {
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
  const workPath = join(
    input.context.proposalRoot,
    '.hopi',
    'docs',
    'goals',
    input.goalId,
    'work',
    `${WORK_ID}.md`,
  )
  await mkdir(dirname(workPath), { recursive: true })
  await Bun.write(
    workPath,
    renderWorkDocument({
      attributes: {
        id: WORK_ID,
        title: 'Reach the next execution boundary',
        kind: 'engineering',
        stage: 'generate',
        repos: ['primary'],
        notBefore: null,
        dependsOn: [],
        contractRevision: planning.attributes.contractRevision,
        evidenceRefs: [],
        attempts: 0,
      },
      body: '## Acceptance Criteria\n\n- The Generator result reaches task checkpointing.\n',
    }),
  )
}

async function callAssistantTool(
  input: Parameters<AssistantModelRunner['run']>[0],
  observer: Parameters<AssistantModelRunner['run']>[1],
  name: 'hopi_resolve_attention',
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
  return JSON.parse(body) as { changed?: boolean }
}

function assistantResult(reply: string, mode: string) {
  return {
    reply,
    session: { transport: 'codex' as const, sessionId: `project-attention-${mode}` },
  }
}

function success(summary: string): RoleRunResult {
  return { result: 'success', summary, artifacts: [], exitCode: 0 }
}

function goalPath() {
  return `/api/projects/${PROJECT_ID}/goals/${GOAL_ID}`
}

async function initializeRepo(root: string) {
  await mkdir(root, { recursive: true })
  await Bun.write(join(root, 'AGENTS.md'), '# Project Attention recovery fixture\n')
  await Bun.write(join(root, 'package.json'), '{"type":"module"}\n')
  await gitOutput(root, ['init', '-b', 'main'])
  await gitOutput(root, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(root, ['config', 'user.name', 'HOPI E2E'])
  await gitOutput(root, ['add', '.'])
  await gitOutput(root, ['commit', '-m', 'initial Project Attention fixture'])
}

interface GoalView {
  projectAttention: {
    id: string
    target: string
    createdAt: string
    resolvedAt: string | null
    body: string
  } | null
  works: Array<{
    id: string
    stage: string
    projection: { primaryBadge: string | null; failedPredicates: string[] }
  }>
  attentions: Array<{
    id: string
    target: string | null
    resolvedAt: string | null
  }>
}
