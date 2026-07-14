import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  type LiveHarness,
  enterHarnessPhase,
  errorMessage,
  finishLiveHarness,
  markHarnessCheckpoint,
  requestJson,
  sendAssistantMessage,
  shutdownLiveHarness,
  startLiveHarness,
  waitForValue,
} from './liveHarness'

const SCENARIO = 'long-conversation-session-recovery'
const SESSION_PATH = ['.hopi', 'runtime', 'assistant', 'session.json']
const OLD_MARKER = 'OLD-HISTORY-MARKER'
const NEW_MARKER = 'NEW-HISTORY-MARKER'
const INTERNAL_MARKER = 'INTERNAL-REFLECTION-MUST-NOT-APPEAR'

interface FeedEvent {
  id: string
  body: string
  status: string
  reply: string | null
  runtimeStatus: string
}

interface FeedView {
  items: Array<{ event?: FeedEvent }>
}

let harness: LiveHarness | null = null

try {
  harness = await startLiveHarness(SCENARIO)
  await enterHarnessPhase(harness, 'conversation_history_setup')
  const first = `${OLD_MARKER} ${'x'.repeat(8_200)}\n\n只回复“已记录”，不要创建或修改任何 HOPI 资源。`
  const second = `${NEW_MARKER} ${'y'.repeat(8_200)}\n\n只回复“已记录”，不要创建或修改任何 HOPI 资源。`
  for (const [index, content] of [first, second].entries()) {
    await sendAssistantMessage(harness, content, { evidencePrefix: `history-${index + 1}` })
    const event = await waitForHandledEvent(harness, content)
    assert.ok(event?.reply?.trim())
  }
  await markHarnessCheckpoint(harness, 'bounded_public_history_created')

  await enterHarnessPhase(harness, 'vendor_session_removal')
  const workspace = createAssistantWorkspaceStore(harness.homeRoot, new PublicationCoordinator())
  const internal = await workspace.receiveReflectionEvent({
    content: `${INTERNAL_MARKER}: this private Reflection must not be used when rebuilding public history.`,
  })
  await workspace.handleEvent(internal.attributes.id, {
    reply: 'Hidden Reflection outcome.',
    disposition: 'answered',
  })
  const sessionPath = join(harness.homeRoot, ...SESSION_PATH)
  const oldSession = (await Bun.file(sessionPath).json()) as { sessionId: string }
  await rm(sessionPath)
  await markHarnessCheckpoint(harness, 'vendor_session_removed')

  await enterHarnessPhase(harness, 'session_recovery')
  const recovery = `会话缓存已丢失。继续当前对话：只回复最新公开标记 ${NEW_MARKER}，不要提及 ${INTERNAL_MARKER}，不要修改任何资源。`
  await sendAssistantMessage(harness, recovery, { evidencePrefix: 'recovery' })
  const finalEvent = await waitForHandledEvent(harness, recovery)
  assert.ok(finalEvent)
  assert.ok(
    finalEvent.reply?.includes(NEW_MARKER),
    'Rebuilt conversation must retain newest public history',
  )
  assert.ok(
    !finalEvent.reply?.includes(INTERNAL_MARKER),
    'Rebuilt public conversation must exclude internal Reflection briefs',
  )
  const newSession = (await Bun.file(sessionPath).json()) as { sessionId: string }
  assert.notEqual(
    newSession.sessionId,
    oldSession.sessionId,
    'Removed vendor session must be rebuilt',
  )
  await enterHarnessPhase(harness, 'domain_verification')
  await markHarnessCheckpoint(harness, 'session_rebuilt_from_public_history')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    oldSessionId: oldSession.sessionId,
    newSessionId: newSession.sessionId,
    internalEventId: internal.attributes.id,
    finalEventId: finalEvent.id,
  })
  console.log(`HOPI-E2E-026 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', { error: errorMessage(error) }).catch(
      () => undefined,
    )
    console.error(`HOPI-E2E-026 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function waitForHandledEvent(harness: LiveHarness, content: string) {
  return waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
      const event = feed.items.find((item) => item.event?.body.trim() === content.trim())?.event
      if (event?.runtimeStatus === 'failed') {
        throw new Error(
          `Assistant failed for ${content.slice(0, 100)}: ${event.reply ?? 'no reply'}`,
        )
      }
      return event
    },
    (event) => event?.status === 'handled' && Boolean(event.reply?.trim()),
    { timeoutMs: 4 * 60_000, description: 'durable Assistant reply' },
  )
}
