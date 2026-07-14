import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  type AssistantModelRunner,
  WorkspaceAssistantError,
} from '../../src/assistant/workspaceAssistant'
import { createServer } from '../../src/mvpServer'
import {
  type LiveState,
  captureAssistantReply,
  createHarnessArtifactRoot,
  errorMessage,
  requestJson,
  sendAssistantMessage,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'assistant-provider-error'
const CONTENT = '浏览器契约：检查 Assistant provider error。'
const PROVIDER_ERROR = 'API Error: Request rejected (429) · Daily provider allocation exceeded.'
const startedAt = new Date().toISOString()
const artifactRoot = await createHarnessArtifactRoot(SCENARIO, startedAt)
const homeRoot = join(artifactRoot, 'home')
let invocations = 0
const runner: AssistantModelRunner = {
  async run(_input, observer) {
    invocations += 1
    await observer?.onEvent?.({
      kind: 'transcript',
      transport: 'claude',
      entryKind: 'status',
      summary: 'Claude initialized',
      vendorEventType: 'system.init',
    })
    for (const attempt of [1, 10]) {
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'claude',
        entryKind: 'status',
        summary: `Provider retry · ${attempt}/10 · 429 rate_limit`,
        vendorEventType: 'system.api_retry',
      })
    }
    await observer?.onEvent?.({
      kind: 'transcript',
      transport: 'claude',
      entryKind: 'assistant',
      summary: PROVIDER_ERROR,
      vendorEventType: 'assistant',
    })
    await observer?.onEvent?.({
      kind: 'transcript',
      transport: 'claude',
      entryKind: 'error',
      summary: PROVIDER_ERROR,
      vendorEventType: 'result.api_error',
    })
    await observer?.onEvent?.({
      kind: 'transcript',
      transport: 'claude',
      entryKind: 'status',
      summary: 'success',
      vendorEventType: 'result.success',
    })
    throw new WorkspaceAssistantError(PROVIDER_ERROR)
  },
}
const server = createServer({ rootDir: homeRoot, port: 0, assistantRunner: runner })
const context = {
  scenario: SCENARIO,
  artifactRoot,
  baseUrl: `http://127.0.0.1:${server.port}`,
}

try {
  const browser = await sendAssistantMessage(context, CONTENT)
  const feed = await waitForValue(
    () => requestJson<AssistantFeed>(context.baseUrl, '/api/assistant/feed?limit=20'),
    (value) =>
      value.items.some(
        (item) =>
          item.event?.body.trim() === CONTENT &&
          item.event.runtimeStatus === 'failed' &&
          item.event.runtimeError === PROVIDER_ERROR,
      ),
    { timeoutMs: 30_000, description: 'the provider failure to become durable' },
  )
  const event = feed.items.find((item) => item.event?.body.trim() === CONTENT)?.event
  assert.ok(event, 'Browser-submitted event must exist in the canonical feed')
  const state = await waitForValue(
    () => requestJson<LiveState>(context.baseUrl, '/api/state'),
    (value) =>
      value.attentions.some(
        (attention) =>
          attention.target?.endsWith(`/event:${event.id}`) === true &&
          attention.resolvedAt === null,
      ),
    { timeoutMs: 30_000, description: 'one event Attention after the terminal failure' },
  )
  assert.equal(invocations, 1, 'Coordinator must not retry a terminal Assistant failure')
  const errorBrowser = await captureAssistantReply(context, PROVIDER_ERROR)
  assert.equal(errorBrowser.visibleErrorActivity, true, 'Provider failure must render as an error')
  await Bun.write(
    join(artifactRoot, 'assistant-provider-error.json'),
    `${JSON.stringify(
      { status: 'passed', startedAt, event, state, invocations, browser, errorBrowser },
      null,
      2,
    )}\n`,
  )
  console.log(`HOPI-E2E-029 Browser passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'assistant-provider-error.json'),
    `${JSON.stringify(
      { status: 'failed', startedAt, error: errorMessage(error), invocations },
      null,
      2,
    )}\n`,
  )
  console.error(`HOPI-E2E-029 Browser failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server.shutdown()
}

interface AssistantFeed {
  items: Array<{
    event?: {
      id: string
      body: string
      status: string
      runtimeStatus: string
      runtimeError: string | null
    }
  }>
}
