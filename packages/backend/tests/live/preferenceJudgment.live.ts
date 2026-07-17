import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PublicationCoordinator } from '../../src/publication/publisher'
import { createAssistantWorkspaceStore } from '../../src/storage/assistantWorkspaceStore'
import {
  type LiveHarness,
  type LiveState,
  captureAssistantReply,
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

const SCENARIO = 'durable-preference-judgment'
const DURABLE_INSTRUCTION =
  '这是一个适用于所有项目的长期偏好：以后默认用中文回复，并且简短直接。请记住这个偏好；不要创建 Project、Goal 或任务。'
const ONE_OFF_INSTRUCTION =
  '仅这一次，请只用英文回复短语 "TEMPORARY OVERRIDE APPLIED"。这是一次性要求，不要修改任何长期偏好，也不要创建 Project、Goal 或任务。'

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
  harness = await startLiveHarness(SCENARIO, { deterministicReflection: true })
  await requestJson<LiveState>(harness.baseUrl, '/api/state')
  const workspace = createAssistantWorkspaceStore(harness.homeRoot, new PublicationCoordinator())
  const initial = (await workspace.readWorkspace()).preference

  await enterHarnessPhase(harness, 'durable_preference')
  await sendAssistantMessage(harness, DURABLE_INSTRUCTION, { evidencePrefix: 'durable' })
  const durableEvent = await waitForHandledEvent(harness, DURABLE_INSTRUCTION)
  assert.ok(durableEvent)
  const durableToolCalls = await toolCalls(harness.homeRoot, durableEvent.id)
  const remembered = (await workspace.readWorkspace()).preference

  assert.notEqual(
    remembered.digest,
    initial.digest,
    'Durable feedback must change preference truth',
  )
  assert.ok(
    hasAny(remembered.content, ['中文', 'Chinese']),
    `Preference must retain the requested language default: ${remembered.content}`,
  )
  assert.ok(
    hasAny(remembered.content, ['简短', '简洁', '直接', 'concise', 'brief', 'direct']),
    `Preference must retain the requested communication default: ${remembered.content}`,
  )
  assert.deepEqual(
    durableToolCalls.filter((name) => name === 'hopi_write_preferences'),
    ['hopi_write_preferences'],
    'Durable feedback must use the preference writer exactly once',
  )
  await markHarnessCheckpoint(harness, 'durable_preference_recorded')

  await enterHarnessPhase(harness, 'one_off_override')
  await sendAssistantMessage(harness, ONE_OFF_INSTRUCTION, { evidencePrefix: 'one-off' })
  const oneOffEvent = await waitForHandledEvent(harness, ONE_OFF_INSTRUCTION)
  assert.ok(oneOffEvent)
  const oneOffToolCalls = await toolCalls(harness.homeRoot, oneOffEvent.id)
  const afterOneOff = (await workspace.readWorkspace()).preference

  assert.ok(
    oneOffEvent.reply?.includes('TEMPORARY OVERRIDE APPLIED'),
    `Current-turn override must win in the reply: ${oneOffEvent.reply}`,
  )
  assert.equal(
    afterOneOff.digest,
    remembered.digest,
    'A one-off instruction must not change durable preferences',
  )
  assert.ok(
    !oneOffToolCalls.includes('hopi_write_preferences'),
    'A one-off instruction must not call the preference writer',
  )
  const browserReply = await captureAssistantReply(harness, oneOffEvent.reply ?? '')

  const state = await requestJson<LiveState>(harness.baseUrl, '/api/state')
  assert.deepEqual(state.projects, [], 'Preference conversation must not create a Project or Goal')
  assert.deepEqual(
    state.activeRuns,
    [],
    'Preference conversation must not dispatch responsibilities',
  )
  assert.deepEqual(state.attentions, [], 'Preference conversation must not create Attention')
  await markHarnessCheckpoint(harness, 'one_off_override_left_preferences_unchanged')

  await shutdownLiveHarness(harness)
  const usage = await finishLiveHarness(harness, 'passed', {
    durableEventId: durableEvent.id,
    oneOffEventId: oneOffEvent.id,
    initialDigest: initial.digest,
    rememberedDigest: remembered.digest,
    durableToolCalls,
    oneOffToolCalls,
    browserReply,
  })
  console.log(`HOPI-E2E-032 Live passed: ${harness.artifactRoot}`)
  console.log(`Model usage: ${JSON.stringify(usage)}`)
} catch (error) {
  if (harness) {
    await shutdownLiveHarness(harness).catch(() => undefined)
    const usage = await finishLiveHarness(harness, 'failed', { error: errorMessage(error) }).catch(
      () => undefined,
    )
    console.error(`HOPI-E2E-032 Live failed: ${errorMessage(error)}`)
    console.error(`Retained evidence: ${harness.artifactRoot}`)
    if (usage) console.error(`Model usage: ${JSON.stringify(usage)}`)
  }
  throw error
}

async function waitForHandledEvent(harness: LiveHarness, content: string) {
  return waitForValue(
    async () => {
      const feed = await requestJson<FeedView>(harness.baseUrl, '/api/assistant/feed?limit=100')
      const event = feed.items.find((item) => item.event?.body.trim() === content)?.event
      if (event?.runtimeStatus === 'failed') {
        throw new Error(
          `Assistant failed for ${JSON.stringify(content)}: ${event.reply ?? 'no reply'}`,
        )
      }
      return event
    },
    (event): event is FeedEvent => event?.status === 'handled' && Boolean(event.reply?.trim()),
    { timeoutMs: 4 * 60_000, description: `Assistant reply to ${JSON.stringify(content)}` },
  )
}

async function toolCalls(homeRoot: string, eventId: string) {
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

function hasAny(source: string, values: readonly string[]) {
  const normalized = source.toLowerCase()
  return values.some((value) => normalized.includes(value.toLowerCase()))
}
