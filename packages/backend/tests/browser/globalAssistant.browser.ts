import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { createServer } from '../../src/mvpServer'
import {
  captureAssistantReply,
  errorMessage,
  finishTestRun,
  ownTestRunServer,
  requestJson,
  sendAssistantMessage,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'

const SCENARIO = 'global-assistant-browser'
const CONTENT = '浏览器契约：发送一条全局 Assistant 消息。'
const REPLY = '浏览器契约回复。'
const testRun = await startTestRun(SCENARIO, 'browser')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const modes: string[] = []
const runner: AssistantModelRunner = {
  async run(input) {
    modes.push(input.toolMode ?? 'main')
    return {
      reply: input.toolMode === 'main' ? REPLY : 'No action required.',
      session: {
        transport: 'codex',
        sessionId: `browser-contract-${input.toolMode ?? 'main'}`,
      },
    }
  },
}
const server = createServer({ rootDir: homeRoot, port: 0, assistantRunner: runner })
ownTestRunServer(testRun, server)
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
          item.event.status === 'handled' &&
          item.event.reply === REPLY,
      ),
    { timeoutMs: 30_000, description: 'the browser message to be handled durably' },
  )
  const event = feed.items.find((item) => item.event?.body.trim() === CONTENT)?.event
  assert.ok(event, 'Browser-submitted event must exist in the canonical feed')
  assert.ok(modes.includes('main'), 'The Coordinator must schedule the Assistant speaking turn')
  const replyBrowser = await captureAssistantReply(context, REPLY)
  const browserResources = (await Bun.file(join(artifactRoot, 'browser-resources.jsonl')).text())
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { created: string[]; closed: string[]; leaked: string[] })
  assert.ok(browserResources.length >= 2, 'Each Browser invocation must retain resource evidence')
  assert.ok(
    browserResources.every(
      (resources) =>
        resources.leaked.length === 0 &&
        resources.created.toSorted().join('\n') === resources.closed.toSorted().join('\n'),
    ),
    'Every Browser invocation must close exactly the targets it created',
  )
  await Bun.write(
    join(artifactRoot, 'browser-contract.json'),
    `${JSON.stringify({ status: 'passed', startedAt, event, modes, browser, replyBrowser, browserResources }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot },
    resultFile: 'browser-contract.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`Browser contract passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'browser-contract.json'),
    `${JSON.stringify({ status: 'failed', startedAt, error: errorMessage(error), modes }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot },
    resultFile: 'browser-contract.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`Browser contract failed: ${errorMessage(error)}`)
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
      reply: string | null
    }
  }>
}
