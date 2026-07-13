import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { PublicationCoordinator } from '../src/publication/publisher'
import {
  type AttentionDeliveryMessage,
  createAssistantReplyDeliveryWorker,
  createWebhookAttentionTransport,
} from '../src/runtime/attentionDelivery'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import {
  type AssistantWorkspaceStore,
  createAssistantWorkspaceStore,
} from '../src/storage/assistantWorkspaceStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'attention-delivery')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Assistant reply delivery', () => {
  test('mirrors only a handled public speaking reply instead of raw Attention', async () => {
    const fixture = await setup()
    const event = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-speaking',
      content: 'Internal board assessment.',
    })
    await fixture.workspace.createAttention({
      attributes: {
        id: 'A-event',
        target: `home:${fixture.homeId}/event:EV-speaking`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: 'Internal Attention body.\n',
    })
    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Please choose the release window.',
      disposition: 'answered',
      expose: true,
    })
    const worker = createAssistantReplyDeliveryWorker(fixture.workspace, fixture.transport)

    expect(await worker.deliverOnce()).toBe(1)
    expect(fixture.messages).toEqual([
      {
        key: `${fixture.homeId}/EV-speaking`,
        eventId: 'EV-speaking',
        body: 'Please choose the release window.',
      },
    ])
    const state = await fixture.workspace.readWorkspace()
    expect(state.events.get('EV-speaking')?.attributes.webhookDeliveredAt).not.toBeNull()
    expect(state.attentions.get('A-event')?.attributes.notifiedAt).toBeNull()
    expect(await worker.deliverOnce()).toBe(0)
  })

  test('does not mirror ordinary public user replies', async () => {
    const fixture = await setup()
    const event = await fixture.workspace.receiveEvent({ eventId: 'EV-user', content: 'Hi.' })
    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Hello.',
      disposition: 'answered',
    })

    const worker = createAssistantReplyDeliveryWorker(fixture.workspace, fixture.transport)

    expect(await worker.deliverOnce()).toBe(0)
    expect(fixture.messages).toEqual([])
  })

  test('retries the same Home/event key when webhook acknowledgement publication is lost', async () => {
    const fixture = await setupHandledReflection()
    let loseAcknowledgement = true
    const workspace: AssistantWorkspaceStore = {
      ...fixture.workspace,
      async markEventWebhookDelivered(eventId, deliveredAt) {
        if (loseAcknowledgement) {
          loseAcknowledgement = false
          throw new Error('stopped after transport acknowledgement')
        }
        return fixture.workspace.markEventWebhookDelivered(eventId, deliveredAt)
      },
    }
    const worker = createAssistantReplyDeliveryWorker(workspace, fixture.transport)

    await expect(worker.deliverOnce()).rejects.toThrow('stopped after transport acknowledgement')
    expect(await worker.deliverOnce()).toBe(1)
    expect(fixture.messages.map((message) => message.key)).toEqual([
      `${fixture.homeId}/EV-speaking`,
      `${fixture.homeId}/EV-speaking`,
    ])
  })

  test('backs off transport failures without blocking reconciliation ticks', async () => {
    const fixture = await setupHandledReflection()
    let currentTime = Date.parse('2026-07-11T00:00:00Z')
    let sends = 0
    const worker = createAssistantReplyDeliveryWorker(
      fixture.workspace,
      {
        async send(message) {
          fixture.messages.push(message)
          sends += 1
          if (sends === 1) throw new Error('offline')
        },
      },
      { now: () => new Date(currentTime), retryBaseMs: 1_000, retryMaxMs: 2_000 },
    )

    expect(await worker.deliverOnce()).toBe(0)
    expect(await worker.deliverOnce()).toBe(0)
    expect(sends).toBe(1)
    currentTime += 1_000
    expect(await worker.deliverOnce()).toBe(1)
    expect(sends).toBe(2)
  })

  test('posts one provider-neutral webhook payload with the Inbox idempotency key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const transport = createWebhookAttentionTransport(
      'https://notify.example.test/hopi',
      async (input, init) => {
        requests.push({ url: String(input), init })
        return new Response(null, { status: 204 })
      },
    )
    const message: AttentionDeliveryMessage = {
      key: 'H-1/EV-1',
      eventId: 'EV-1',
      body: 'Please repair the Repo.',
    }

    await transport.send(message)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://notify.example.test/hopi')
    expect(new Headers(requests[0]?.init?.headers).get('idempotency-key')).toBe(message.key)
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(message)
  })
})

async function setupHandledReflection() {
  const fixture = await setup()
  const event = await fixture.workspace.receiveReflectionEvent({
    eventId: 'EV-speaking',
    content: 'Internal assessment.',
  })
  await fixture.workspace.handleEvent(event.attributes.id, {
    reply: 'The operator-facing result.',
    disposition: 'answered',
    expose: true,
  })
  return fixture
}

async function setup() {
  const homeRoot = join(temporaryRoot, crypto.randomUUID())
  const home = createAssistantHomeStore(homeRoot)
  const homeDocument = await home.initialize()
  const workspace = createAssistantWorkspaceStore(homeRoot, new PublicationCoordinator())
  const messages: AttentionDeliveryMessage[] = []
  return {
    homeId: homeDocument.homeId,
    workspace,
    messages,
    transport: { send: async (message: AttentionDeliveryMessage) => void messages.push(message) },
  }
}
