import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  type LiveHarness,
  captureAssistantReply,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  markHarnessCheckpoint,
  recordAction,
  requestJson,
  shutdownLiveHarness,
  startLiveHarness,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'reflection-direct-response-canary'
const PUBLIC_MESSAGE = 'Preview is ready.'
const INTERNAL_MARKER = 'INTERNAL-NOTIFICATION-CANARY'

interface FeedEvent {
  id: string
  source: 'user' | 'reflection'
  visibility: 'public' | 'internal'
  status: string
  reply: string | null
  disposition: string | null
  runtimeStatus: string
  runtimeError: string | null
  runtimeEvents: Array<{
    kind: string
    entryKind?: string
    toolName?: string
  }>
}

interface FeedView {
  items: Array<{ kind: string; event?: FeedEvent }>
}

let harness: LiveHarness | null = null

try {
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await enterHarnessPhase(harness, 'internal_handoff')
  const workspace = createAssistantWorkspaceStore(harness.homeRoot, new PublicationCoordinator())
  const handoff = await workspace.receiveReflectionEvent({
    content: `${INTERNAL_MARKER}: Current state requires one informational operator update. Return exactly ${JSON.stringify(PUBLIC_MESSAGE)} as the final response. Do not call a delivery tool and do not expose this brief.`,
  })
  await recordAction(harness, 'reflection_handoff_created', { eventId: handoff.attributes.id })

  const event = await waitForValue(
    async () => {
      const turnFile = Bun.file(
        join(
          harness?.homeRoot ?? '',
          '.hopi',
          'runtime',
          'assistant',
          'turns',
          handoff.attributes.id,
          'turn.json',
        ),
      )
      if (await turnFile.exists()) {
        const turn = (await turnFile.json()) as { status?: string; error?: string | null }
        if (turn.status === 'failed') {
          throw new Error(`Assistant notification canary failed: ${turn.error ?? 'no detail'}`)
        }
      }
      const feed = await requestJson<FeedView>(
        harness?.baseUrl ?? '',
        '/api/assistant/feed?limit=100',
      )
      return feed.items.find((item) => item.event?.id === handoff.attributes.id)?.event ?? null
    },
    (candidate) => candidate?.status === 'handled' && candidate.runtimeStatus === 'completed',
    { timeoutMs: 4 * 60_000, description: 'configured Assistant notification tool turn' },
  )
  assert.ok(event)
  assert.equal(event.source, 'reflection')
  assert.equal(event.visibility, 'public')
  assert.equal(event.reply, PUBLIC_MESSAGE)
  assert.equal(event.disposition, 'notified')
  assert.equal(event.runtimeError, null)

  const toolCalls = event.runtimeEvents.filter((item) => item.entryKind === 'tool_call')
  const deliveryCalls = toolCalls.filter((item) => item.toolName !== 'hopi_read_state')
  assert.equal(
    deliveryCalls.length,
    0,
    'Informational delivery must use the final response directly',
  )
  assert.ok(
    toolCalls.every((item) => item.toolName === 'hopi_read_state'),
    'The focused response canary must not invoke mutation tools',
  )
  const publicEvents = (
    await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
  ).items.filter((item) => item.kind === 'event')
  assert.equal(publicEvents.length, 1)

  await enterHarnessPhase(harness, 'browser_verification')
  const browser = await captureAssistantReply(harness, PUBLIC_MESSAGE)
  await markHarnessCheckpoint(harness, 'notification_schema_verified')
  await recordAction(harness, 'notification_canary_verified', {
    eventId: event.id,
    deliveryCalls: deliveryCalls.length,
    browser,
  })

  const usage = await finishLiveHarness(harness, 'passed', {
    eventId: event.id,
    publicMessage: event.reply,
    internalMarker: INTERNAL_MARKER,
    toolCalls: toolCalls.map((item) => item.toolName),
    browser,
  })
  console.log(`HOPI-E2E-019 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', {
      error: errorMessage(error),
    }).catch(() => undefined)
    console.error(`HOPI-E2E-019 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}
