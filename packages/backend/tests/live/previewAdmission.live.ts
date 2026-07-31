import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoleRunInput, RoleRunResult, RoleRunner } from '../../src/agent/RoleRunner'
import { createServer } from '../../src/mvpServer'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  type LiveGoalDetail,
  type LiveHarness,
  type LiveState,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  gitOutput,
  markHarnessCheckpoint,
  ownTestRunServer,
  requestJson,
  shutdownLiveHarness,
  startLiveHarness,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'preview-admission'
const PROJECT_ID = 'P-preview-admission'

interface PreviewFailureEvent {
  id: string
  status: 'pending' | 'handled'
  body: string
}

let harness: LiveHarness | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'fixture_setup')
  await initializeRepo(harness.repoRoot)

  await ownTestRunServer(harness, harness.server).run()
  const roles = blockingRoles()
  harness.server = createServer({
    rootDir: harness.homeRoot,
    port: 0,
    roleRunner: roles,
  })
  ownTestRunServer(harness, harness.server)
  harness.baseUrl = `http://127.0.0.1:${harness.server.port}`
  const baseUrl = harness.baseUrl

  await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: {
      projectId: PROJECT_ID,
      primaryRepoId: 'primary',
      repos: [{ repoId: 'primary', repoPath: harness.repoRoot }],
    },
  })
  await markHarnessCheckpoint(harness, 'empty_project_linked')

  await enterHarnessPhase(harness, 'single_preview_start')
  await requestJson(baseUrl, `/api/projects/${PROJECT_ID}/preview/start`, {
    method: 'POST',
  })

  const workspace = createAssistantWorkspaceStore(harness.homeRoot, new PublicationCoordinator())
  const failureEvent = await waitForValue(
    async () => {
      const events = [...(await workspace.readWorkspace()).events.values()]
      const event = events.find(
        (candidate) =>
          candidate.attributes.source === 'system' &&
          candidate.body.includes('Project Preview start failed.'),
      )
      return event
        ? { id: event.attributes.id, status: event.attributes.status, body: event.body }
        : null
    },
    (event): event is PreviewFailureEvent => event?.status === 'handled',
    { timeoutMs: 4 * 60_000, description: 'Assistant to handle the Preview failure' },
  )
  assert.ok(failureEvent)

  const state = await waitForValue(
    () => requestJson<LiveState>(baseUrl, '/api/state'),
    (candidate) =>
      candidate.projects.find((project) => project.projectId === PROJECT_ID)?.goals.length === 1,
    { timeoutMs: 30_000, description: 'Assistant-created Preview repair Goal' },
  )
  const project = state.projects.find((candidate) => candidate.projectId === PROJECT_ID)
  const goalId = project?.goals[0]?.id
  assert.ok(goalId, 'Preview failure must create one Goal')

  const detail = await requestJson<LiveGoalDetail>(
    baseUrl,
    `/api/projects/${PROJECT_ID}/goals/${goalId}`,
  )
  assert.equal(detail.works.length, 1, 'Preview repair must begin with one Work')
  assert.equal(detail.works[0]?.kind, 'engineering')
  assert.ok(['generate', 'review'].includes(detail.works[0]?.stage ?? ''))
  assert.equal(detail.projectAttention, null)
  assert.deepEqual(state.attentions, [])

  const toolCalls = await assistantToolCalls(harness.homeRoot, failureEvent.id)
  assert.equal(
    toolCalls.filter((name) => name === 'hopi_create_goal').length,
    1,
    'Assistant must atomically create the Goal and first Engineering Work',
  )
  assert.ok(!toolCalls.includes('hopi_create_work'))
  assert.ok(!toolCalls.includes('hopi_manage_attention'))
  assert.match(failureEvent.body, /Requested capability: make Project Preview work/)
  assert.ok(
    roles.runs.some((run) => run.responsibility === 'generator'),
    'The created Engineering Work must become executable after the Assistant turn settles',
  )

  await markHarnessCheckpoint(harness, 'engineering_work_admitted_without_repair_message')
  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    projectId: PROJECT_ID,
    goalId,
    work: detail.works[0],
    failureEventId: failureEvent.id,
    toolCalls,
    roleRuns: roles.runs,
  })
  console.log(`HOPI-E2E-034 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', { error: errorMessage(error) }).catch(
      () => undefined,
    )
    console.error(`HOPI-E2E-034 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

function blockingRoles(): RoleRunner & {
  runs: Array<{ responsibility: RoleRunInput['responsibility']; runId: string }>
} {
  const runner = {
    runs: [] as Array<{ responsibility: RoleRunInput['responsibility']; runId: string }>,
    async run(input: RoleRunInput): Promise<RoleRunResult> {
      runner.runs.push({ responsibility: input.responsibility, runId: input.runId })
      await waitForAbort(input.signal)
      return {
        result: 'fail',
        summary: 'Admission probe stopped before role execution.',
        artifacts: [],
        exitCode: 1,
        failureKind: 'operational',
      }
    },
  }
  return runner
}

async function waitForAbort(signal?: AbortSignal) {
  if (signal?.aborted) return
  await new Promise<void>((resolve) =>
    signal?.addEventListener('abort', () => resolve(), { once: true }),
  )
}

async function assistantToolCalls(homeRoot: string, eventId: string) {
  const path = join(homeRoot, '.hopi', 'runtime', 'assistant', 'turns', eventId, 'events.jsonl')
  const source = await Bun.file(path).text()
  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const event = JSON.parse(line) as { entryKind?: string; toolName?: string }
      return event.entryKind === 'tool_call' && event.toolName ? [event.toolName] : []
    })
}

async function initializeRepo(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await gitOutput(repoRoot, ['init', '-b', 'main'])
  await gitOutput(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await gitOutput(repoRoot, ['config', 'user.name', 'HOPI Live'])
  await Bun.write(join(repoRoot, 'README.md'), '# Empty Preview project\n')
  await gitOutput(repoRoot, ['add', '.'])
  await gitOutput(repoRoot, ['commit', '-m', 'initial fixture'])
}
