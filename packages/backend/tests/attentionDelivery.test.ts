import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import {
  type AttentionDeliveryMessage,
  createAttentionDeliveryWorker,
  createWebhookAttentionTransport,
} from '../src/runtime/attentionDelivery'
import { createGoalController } from '../src/runtime/goalController'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'
import type { GoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'attention-delivery')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('AttentionDeliveryWorker', () => {
  test('notifies targeted Attention without resolving it', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Ambiguous.' })
    await fixture.workspace.createAttention({
      attributes: {
        id: 'A-event',
        target: `home:${fixture.homeId}/event:EV-1`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nChoose a Project.\n',
    })

    expect(await fixture.worker.deliverOnce([])).toBe(1)
    const attention = (await fixture.workspace.readWorkspace()).attentions.get('A-event')

    expect(fixture.messages).toHaveLength(1)
    expect(attention?.attributes.notifiedAt).toBe('2026-07-11T00:01:00.000Z')
    expect(attention?.attributes.resolvedAt).toBeNull()
  })

  test('delivers completion only after Goal done and resolves it in the acknowledgement gate', async () => {
    const fixture = await setup()
    const store = fixture.goalStore
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Finish.' })
    const workPath = store.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(store.paths.absolute(workPath)).text()
    const work = parseWorkDocument(source)
    work.attributes.stage = 'done'
    const attention = {
      attributes: {
        id: 'A-complete',
        target: null,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Complete\n\nEverything is delivered.\n',
    }
    await store.publishGoal('G-1', {
      supportingWrites: [
        {
          path: store.paths.attentionDocument('G-1', 'A-complete'),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      ],
      gateWrite: {
        path: workPath,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(work),
      },
    })

    expect(await fixture.worker.deliverOnce([{ projectId: 'P-1', store }])).toBe(0)
    await createGoalController(store, { verifyCompletion: () => true }).completeGoal(
      'G-1',
      'A-complete',
    )
    expect(await fixture.worker.deliverOnce([{ projectId: 'P-1', store }])).toBe(1)
    const delivered = (await store.readPackage('G-1')).attentions.get('A-complete')

    expect(delivered?.attributes.notifiedAt).toBe('2026-07-11T00:01:00.000Z')
    expect(delivered?.attributes.resolvedAt).toBe('2026-07-11T00:01:00.000Z')
  })

  test('retries with the same canonical delivery key after acknowledgement publication is lost', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Ambiguous.' })
    await fixture.workspace.createAttention({
      attributes: {
        id: 'A-retry',
        target: `home:${fixture.homeId}/event:EV-1`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nChoose.\n',
    })
    let fail = true
    const worker = createAttentionDeliveryWorker(
      fixture.workspace,
      { send: async (message) => void fixture.messages.push(message) },
      {
        now: () => new Date('2026-07-11T00:01:00Z'),
        beforeAcknowledgement() {
          if (!fail) return
          fail = false
          throw new Error('stopped after transport acknowledgement')
        },
      },
    )

    await expect(worker.deliverOnce([])).rejects.toThrow('stopped')
    expect(await worker.deliverOnce([])).toBe(1)

    expect(fixture.messages.map((message) => message.key)).toEqual([
      `${fixture.homeId}/A-retry`,
      `${fixture.homeId}/A-retry`,
    ])
  })

  test('backs off transport failures without blocking later reconciliation ticks', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Ambiguous.' })
    await fixture.workspace.createAttention({
      attributes: {
        id: 'A-backoff',
        target: `home:${fixture.homeId}/event:EV-1`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nChoose.\n',
    })
    let currentTime = Date.parse('2026-07-11T00:00:00Z')
    let sends = 0
    const worker = createAttentionDeliveryWorker(
      fixture.workspace,
      {
        async send() {
          sends += 1
          if (sends === 1) throw new Error('offline')
        },
      },
      { now: () => new Date(currentTime), retryBaseMs: 1_000, retryMaxMs: 2_000 },
    )

    expect(await worker.deliverOnce([])).toBe(0)
    expect(await worker.deliverOnce([])).toBe(0)
    expect(sends).toBe(1)
    currentTime += 1_000
    expect(await worker.deliverOnce([])).toBe(1)
    expect(sends).toBe(2)
  })

  test('posts one provider-neutral webhook payload with the canonical idempotency key', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const transport = createWebhookAttentionTransport(
      'https://notify.example.test/hopi',
      async (input, init) => {
        requests.push({ url: String(input), init })
        return new Response(null, { status: 204 })
      },
    )
    const message: AttentionDeliveryMessage = {
      key: 'H-1/A-1',
      target: 'project:P-1',
      body: '## Needs you\n\nRepair the Repo.\n',
      attentionId: 'A-1',
    }

    await transport.send(message)

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://notify.example.test/hopi')
    expect(new Headers(requests[0]?.init?.headers).get('idempotency-key')).toBe(message.key)
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(message)
  })

  test('keeps workspace notification delivery independent from an unreadable Project', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Ambiguous.' })
    await fixture.workspace.createAttention({
      attributes: {
        id: 'A-event',
        target: `home:${fixture.homeId}/event:EV-1`,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Needs you\n\nChoose.\n',
    })
    const unreadable = {
      listGoalIds: async () => {
        throw new Error('invalid Project root')
      },
    } as unknown as GoalPackageStore

    expect(await fixture.worker.deliverOnce([{ projectId: 'P-broken', store: unreadable }])).toBe(1)
    expect(fixture.messages).toHaveLength(1)
  })
})

async function setup() {
  const homeRoot = join(temporaryRoot, 'home')
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
  const home = createAssistantHomeStore(homeRoot)
  const homeDocument = await home.initialize()
  const project = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  const publisher = new PublicationCoordinator()
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  const goalStore = createGoalPackageStore(project.integrationRoot, 'P-1', publisher)
  const messages: AttentionDeliveryMessage[] = []
  return {
    homeId: homeDocument.homeId,
    workspace,
    goalStore,
    messages,
    worker: createAttentionDeliveryWorker(
      workspace,
      { send: async (message) => void messages.push(message) },
      { now: () => new Date('2026-07-11T00:01:00Z') },
    ),
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}
