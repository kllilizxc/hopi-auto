import assert from 'node:assert/strict'
import { join } from 'node:path'
import { createServer } from '../../src/mvpServer'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createWebhookAttentionTransport } from '../../src/runtime/attentionDelivery'
import { createAssistantHomeStore } from '../../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  errorMessage,
  finishTestRun,
  ownTestRunServer,
  startTestRun,
  waitForValue,
} from '../live/liveHarness'
import { registerTestRunCleanup } from '../testRunArtifact'

const SCENARIO = 'webhook-delivery-retry'
const testRun = await startTestRun(SCENARIO, 'contract')
const { artifactRoot, startedAt } = testRun
const homeRoot = join(artifactRoot, 'home')
const home = createAssistantHomeStore(homeRoot)
const homeDocument = await home.initialize()
const workspace = createAssistantWorkspaceStore(homeRoot, new PublicationCoordinator())
const event = await workspace.receiveReflectionEvent({
  eventId: 'EV-webhook-retry',
  content: 'An operator-facing delivery must be sent through the configured webhook.',
})
await workspace.handleEvent(event.attributes.id, {
  reply: 'The release needs your confirmation before delivery can continue.',
  disposition: 'answered',
  expose: true,
})

const requests: Array<{
  headers: Record<string, string | undefined>
  body: { key: string; eventId: string; body: string }
}> = []
const webhook = Bun.serve({
  port: 0,
  async fetch(request) {
    requests.push({
      headers: {
        contentType: request.headers.get('content-type') ?? undefined,
        idempotencyKey: request.headers.get('idempotency-key') ?? undefined,
      },
      body: (await request.json()) as { key: string; eventId: string; body: string },
    })
    return new Response(requests.length === 1 ? 'offline' : null, {
      status: requests.length === 1 ? 503 : 204,
    })
  },
})
const server = createServer({
  rootDir: homeRoot,
  port: 0,
  attentionTransport: createWebhookAttentionTransport(`http://127.0.0.1:${webhook.port}/hook`),
})
const webhookCleanup = registerTestRunCleanup(testRun, {
  name: 'webhook-server',
  cleanup: () => webhook.stop(true),
})
ownTestRunServer(testRun, server)

try {
  const delivered = await waitForValue(
    async () =>
      (await workspace.readEvent(event.attributes.id))?.attributes.webhookDeliveredAt ?? null,
    (value) => value !== null,
    { timeoutMs: 15_000, description: 'webhook retry acknowledgement to become durable' },
  )
  assert.equal(requests.length, 2, 'One transient webhook failure must produce exactly one retry')
  assert.deepEqual(
    requests.map((request) => request.headers.idempotencyKey),
    [
      `${homeDocument.homeId}/${event.attributes.id}`,
      `${homeDocument.homeId}/${event.attributes.id}`,
    ],
  )
  assert.ok(requests.every((request) => request.headers.contentType === 'application/json'))
  assert.ok(
    requests.every(
      (request) =>
        request.body.eventId === event.attributes.id &&
        request.body.body === 'The release needs your confirmation before delivery can continue.',
    ),
  )
  await Bun.write(
    join(artifactRoot, 'webhook-e2e.json'),
    `${JSON.stringify(
      { status: 'passed', startedAt, delivered, requests, homeId: homeDocument.homeId },
      null,
      2,
    )}\n`,
  )
  await finishTestRun(testRun, 'passed', {
    paths: { home: homeRoot },
    resultFile: 'webhook-e2e.json',
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  })
  console.log(`HOPI-E2E-025 webhook E2E passed: ${artifactRoot}`)
} catch (error) {
  await Bun.write(
    join(artifactRoot, 'webhook-e2e.json'),
    `${JSON.stringify({ status: 'failed', startedAt, requests, error: errorMessage(error) }, null, 2)}\n`,
  )
  await finishTestRun(testRun, 'failed', {
    paths: { home: homeRoot },
    resultFile: 'webhook-e2e.json',
    error: errorMessage(error),
    providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
  }).catch(() => undefined)
  console.error(`HOPI-E2E-025 webhook E2E failed: ${errorMessage(error)}`)
  console.error(`Retained evidence: ${artifactRoot}`)
  process.exitCode = 1
} finally {
  await server.shutdown()
  await webhookCleanup.run()
}
