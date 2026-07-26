import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { workspaceAttentionReference } from '../../src/domain/attentionReference'
import { parseWorkDocument, renderWorkDocument } from '../../src/domain/canonicalDocuments'
import { inboxEventReference } from '../../src/domain/inboxEventReference'
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
const STATUS_MESSAGE = '请告诉我现在需要确认什么。'
const USER_MESSAGE = '我已经检查过项目环境，请把这个 Project Attention 标为已处理。'
const NEEDS_YOU_MESSAGE = '请确认项目环境已经恢复。'
const ASSISTANT_REPLY = '这个 Project Attention 已处理；当前 Planner 继续运行。'
const CHECKPOINT_ATTENTION_ID = 'A-checkpoint-follow-up'
const CHECKPOINT_ATTENTION_BODY =
  'Task checkpoint failed. The Project owner must inspect the task worktree before retrying.'
const CHECKPOINT_NEEDS_YOU_MESSAGE = '任务 checkpoint 失败，需要确认是否允许重建任务工作树。'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const repoRoot = join(artifactRoot, 'repo')
const recoveryBlocker = join(repoRoot, 'local-recovery-blocker.txt')
const roleRuns: Array<{ runId: string; responsibility: string; status: string }> = []
const assistantToolResults: Array<{
  kind: 'create' | 'resolve'
  attentionId: string
  changed: boolean
}> = []
const assistantTurns: Array<{ eventId: string; projectId: string | null }> = []
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
      return success('Generator produced source before its task checkpoint failed closed.')
    }
    throw new Error('Reviewer must not run after the task checkpoint failure')
  },
}

const assistantRunner: AssistantModelRunner = {
  async run(input, observer) {
    const mode = input.toolMode ?? 'main'
    assistantTurns.push({ eventId: input.eventId, projectId: input.projectId ?? null })
    if (mode === 'main' && input.prompt.includes(STATUS_MESSAGE)) {
      return assistantResult(
        `<NeedsYou attentionId="${attentionToResolve}">${NEEDS_YOU_MESSAGE}</NeedsYou>`,
        mode,
      )
    }
    if (mode === 'main' && input.prompt.includes(USER_MESSAGE)) {
      await rm(recoveryBlocker, { force: true })
      const response = await callAssistantTool(input, observer, 'hopi_manage_attention', {
        change: {
          kind: 'resolve',
          attentionRef: workspaceAttentionReference(assistantHomeId, attentionToResolve),
          resolution: USER_MESSAGE,
        },
      })
      assistantToolResults.push({
        kind: 'resolve',
        attentionId: attentionToResolve,
        changed: response.changed === true,
      })
      return assistantResult(ASSISTANT_REPLY, mode)
    }
    if (mode === 'internal' && input.prompt.includes('Task checkpoint failed')) {
      const response = await callAssistantTool(input, observer, 'hopi_manage_attention', {
        change: {
          kind: 'create',
          target: `project:${PROJECT_ID}`,
          attentionId: CHECKPOINT_ATTENTION_ID,
          body: CHECKPOINT_ATTENTION_BODY,
        },
      })
      assistantToolResults.push({
        kind: 'create',
        attentionId: CHECKPOINT_ATTENTION_ID,
        changed: response.changed === true,
      })
      return assistantResult(
        `<NeedsYou attentionId="${CHECKPOINT_ATTENTION_ID}">${CHECKPOINT_NEEDS_YOU_MESSAGE}</NeedsYou>`,
        mode,
      )
    }
    if (mode === 'internal') return assistantResult('', mode)
    throw new Error(`Unexpected public Assistant turn: ${input.eventId}`)
  },
}

const context = { scenario: SCENARIO, artifactRoot, baseUrl: '' }
let server: ReturnType<typeof createServer> | null = null
let initial: GoalView | null = null
let resumed: GoalView | null = null
let afterFailure: GoalView | null = null

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
  assertAttentionDoesNotBlockWork(initial)
  const initialBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-blocked',
  })
  assert.equal(initialBrowser.view?.projectBlocked, false)
  assert.equal(initialBrowser.view?.projectAttentionBody, null)

  const needsYouSubmission = await sendAssistantMessage(context, STATUS_MESSAGE, {
    evidencePrefix: 'project-question',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })
  const needsYouBrowser = await captureAssistantReply(context, NEEDS_YOU_MESSAGE, {
    evidencePrefix: 'project-question',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })

  const assistantBrowser = await sendAssistantMessage(context, USER_MESSAGE, {
    evidencePrefix: 'project-resolve',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
    replyToLatestNeedsYou: true,
  })
  resumed = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) =>
      value.projectAttention === null &&
      roleRuns.some((run) => run.responsibility === 'planner' && run.status === 'started'),
    {
      timeoutMs: 30_000,
      description: 'Attention resolution while independent Planner remains active',
    },
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
  const assistantReplyBrowser = await captureAssistantReply(context, ASSISTANT_REPLY, {
    evidencePrefix: 'project-resolve',
    pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
  })
  const inbox = await workspace.readWorkspace()
  const questionEvent = [...inbox.events.values()].find(
    (event) => event.body.trim() === STATUS_MESSAGE,
  )
  const replyEvent = [...inbox.events.values()].find((event) => event.body.trim() === USER_MESSAGE)
  assert.ok(questionEvent, 'The Needs you source event must remain canonical')
  assert.ok(replyEvent, 'The explicit reply event must remain canonical')
  assert.equal(replyEvent.attributes.context?.projectId, PROJECT_ID)
  assert.deepEqual(replyEvent.attributes.context?.attentionRefs, [
    workspaceAttentionReference(assistantHomeId, original.attributes.id),
  ])
  assert.equal(
    replyEvent.attributes.context?.replyTo,
    inboxEventReference(assistantHomeId, questionEvent.attributes.id),
  )
  assert.equal(
    assistantTurns.find((turn) => turn.eventId === replyEvent.attributes.id)?.projectId,
    PROJECT_ID,
    'Explicit Project Attention Reply must use the Project Assistant Session',
  )

  releasePlanner?.()
  afterFailure = await waitForValue(
    () => requestJson<GoalView>(context.baseUrl, goalPath()),
    (value) => {
      const work = value.works.find((candidate) => candidate.id === WORK_ID)
      return (
        value.projectAttention?.id === CHECKPOINT_ATTENTION_ID &&
        value.projectAttention.body.includes(CHECKPOINT_ATTENTION_BODY) &&
        work?.projection.primaryBadge === 'Waiting for Assistant' &&
        work.projection.failedPredicates.includes('failed_attempt') &&
        !work.projection.failedPredicates.includes('project_ineligible')
      )
    },
    {
      timeoutMs: 60_000,
      description: 'Assistant Attention handoff after the admitted Generator Run drains',
    },
  )
  assertProjectAttentionDoesNotGateWork(afterFailure)
  assert.equal(
    afterFailure.attentions.filter(
      (attention) => attention.target !== null && attention.resolvedAt === null,
    ).length,
    0,
    'Project failure must not be projected as Goal or Work Needs you',
  )
  const afterFailureBrowser = await inspectKanban(context, PROJECT_ID, GOAL_ID, {
    evidencePrefix: 'project-failure',
  })
  assert.equal(afterFailureBrowser.view?.projectBlocked, false)
  assert.equal(afterFailureBrowser.view?.projectAttentionBody, null)
  const checkpointNeedsYouBrowser = await captureAssistantReply(
    context,
    CHECKPOINT_NEEDS_YOU_MESSAGE,
    {
      evidencePrefix: 'project-failure',
      pagePath: `/projects/${PROJECT_ID}/board/${GOAL_ID}`,
    },
  )
  assert.deepEqual(assistantToolResults, [
    { kind: 'resolve', attentionId: original.attributes.id, changed: true },
    { kind: 'create', attentionId: CHECKPOINT_ATTENTION_ID, changed: true },
  ])
  const finalWorkspace = await workspace.readWorkspace()
  assert.ok(finalWorkspace.attentions.get(original.attributes.id)?.attributes.resolvedAt)
  assert.equal(finalWorkspace.attentions.get(CHECKPOINT_ATTENTION_ID)?.attributes.resolvedAt, null)
  assert.deepEqual(
    await checkoutSnapshot(repoRoot),
    checkoutBefore,
    'Project recovery must not mutate the user checkout',
  )

  const evidence = {
    status: 'passed',
    startedAt,
    originalAttentionId: original.attributes.id,
    replacementAttentionId: afterFailure.projectAttention?.id,
    roleRuns,
    assistantToolResults,
    assistantTurns,
    initial,
    resumed,
    afterFailure,
    browser: {
      initialBrowser,
      needsYouSubmission,
      needsYouBrowser,
      assistantBrowser,
      assistantReplyBrowser,
      resumedBrowser,
      afterFailureBrowser,
      checkpointNeedsYouBrowser,
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
    assistantTurns,
    initial,
    resumed,
    afterFailure,
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

function assertAttentionDoesNotBlockWork(goal: GoalView) {
  const work = goal.works.find(
    (candidate) => candidate.stage !== 'done' && candidate.stage !== 'cancelled',
  )
  assert.ok(work, 'A nonterminal Work must remain visible with Project Attention')
  assert.ok(
    work.projection.primaryBadge === 'queued' || work.projection.primaryBadge === 'working',
    `Project Attention must not stop ready Work: ${work.projection.primaryBadge}`,
  )
  assertProjectAttentionDoesNotGateWork(goal)
}

function assertProjectAttentionDoesNotGateWork(goal: GoalView) {
  for (const work of goal.works) {
    assert.ok(
      !work.projection.failedPredicates.includes('project_ineligible'),
      'Project Attention must not add a scheduling predicate',
    )
    assert.notEqual(work.projection.primaryBadge, 'Needs you')
  }
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
        notBefore: null,
        dependsOn: [],
        contractRevision: planning.attributes.contractRevision,
        evidenceRefs: [],
      },
      body: '## Acceptance Criteria\n\n- The Generator result reaches task checkpointing.\n',
    }),
  )
}

async function callAssistantTool(
  input: Parameters<AssistantModelRunner['run']>[0],
  observer: Parameters<AssistantModelRunner['run']>[1],
  name: 'hopi_manage_attention',
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
