import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseWorkDocument, renderInputDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'goal-controller')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(() => rm(temporaryRoot, { recursive: true, force: true }))

describe('GoalController', () => {
  test('creates both Work kinds and validates dependencies against the current DAG', async () => {
    const { store, controller } = await setup()
    const decision = await controller.createWork('G-1', {
      kind: 'decision',
      title: 'Choose the visual hierarchy',
      decisionType: 'prototype',
      question: 'Which route composition is readable at a glance?',
      dependsOn: [],
    })
    const engineering = await controller.createWork('G-1', {
      kind: 'engineering',
      title: 'Implement the chosen hierarchy',
      objective: 'Implement the accepted route composition.',
      acceptanceCriteria: ['The route reads from left to right.'],
      dependsOn: [decision.attributes.id],
    })

    expect(decision.attributes.kind).toBe('decision')
    expect(engineering.attributes.dependsOn).toEqual([decision.attributes.id])
    await expect(
      controller.setWorkDependencies('G-1', decision.attributes.id, [engineering.attributes.id]),
    ).rejects.toThrow('Work dependency cycle')
  })

  test('revises the current Goal contract and leaves older Work visibly stale', async () => {
    const { store, controller } = await setup()
    const original = (await store.readPackage('G-1')).works.get('W-root')
    const input = acceptedInput(store, 'EV-revise')
    const revised = await controller.reviseContract('G-1', {
      contractMarkdown: '## Objective\n\nShip the route with keyboard navigation.\n',
      acceptedInput: input,
    })

    expect(revised.attributes.contractRevision).toBe(2)
    expect((await store.readPackage('G-1')).works.get('W-root')).toEqual(original)
    expect(
      await Bun.file(
        store.paths.absolute(store.paths.inputDocument('G-1', 'H-1', 'EV-revise')),
      ).exists(),
    ).toBe(true)
  })

  test('pause/resume do not manufacture Work and terminal reopen increments revision', async () => {
    const { store, controller } = await setup()
    const before = [...(await store.readPackage('G-1')).works.keys()]
    await controller.pauseGoal('G-1')
    await controller.resumeGoal('G-1')
    expect([...(await store.readPackage('G-1')).works.keys()]).toEqual(before)

    await controller.cancelGoal('G-1')
    const reopened = await controller.reopenGoal('G-1', {
      eventId: 'EV-reopen',
      contractMarkdown: '## Objective\n\nReopen with a revised destination.\n',
    })
    expect(reopened.attributes).toMatchObject({ lifecycle: 'active', contractRevision: 2 })
  })

  test('cancels a dependency subtree in dependent-first order', async () => {
    const { store, controller } = await setup()
    const second = await controller.createWork('G-1', {
      kind: 'engineering',
      title: 'Second Work',
      objective: 'Second.',
      acceptanceCriteria: ['Second complete.'],
      dependsOn: ['W-root'],
    })
    const third = await controller.createWork('G-1', {
      kind: 'decision',
      title: 'Third Work',
      decisionType: 'research',
      question: 'What does the second Work reveal?',
      dependsOn: [second.attributes.id],
    })

    const cancelled = await controller.cancelWork('G-1', 'W-root')
    expect(cancelled.map((work) => work.attributes.id)).toEqual([
      third.attributes.id,
      second.attributes.id,
      'W-root',
    ])
    expect(
      [...(await store.readPackage('G-1')).works.values()].every(
        (work) => work.attributes.status === 'cancelled',
      ),
    ).toBe(true)
  })

  test('schedules Work, records guidance idempotently, and lets Attention claim it', async () => {
    const { store, controller } = await setup()
    const scheduled = await controller.setWorkNotBefore('G-1', 'W-root', '2026-08-15T00:00:00.000Z')
    expect(scheduled.attributes.notBefore).toBe('2026-08-15T00:00:00.000Z')
    await controller.appendWorkMessage('G-1', 'W-root', {
      sourceEventId: 'EV-guidance',
      content: 'Preserve the one-path C1 boundary.',
    })
    await controller.appendWorkMessage('G-1', 'W-root', {
      sourceEventId: 'EV-guidance',
      content: 'Preserve the one-path C1 boundary.',
    })
    const attention = await controller.createAttention('P-1', 'G-1', 'W-root', {
      attentionId: 'A-choice',
      summary: 'Choose a route density.',
      body: 'Should the graph optimize for breadth or detail?',
    })
    const work = parseWorkDocument(
      await Bun.file(store.paths.absolute(store.paths.workDocument('G-1', 'W-root'))).text(),
    )
    expect(work.attributes.ownerMessages).toHaveLength(1)
    expect(attention.attributes.target).toBe('project:P-1/goal:G-1/work:W-root')
  })
})

async function setup() {
  const store = createGoalPackageStore(temporaryRoot, 'P-1', new PublicationCoordinator())
  await store.createGoal({
    goalId: 'G-1',
    title: 'Ship route',
    objective: 'Ship the current route.',
    firstWork: {
      id: 'W-root',
      title: 'Build the route',
      kind: 'engineering',
      objective: 'Build the route.',
      acceptanceCriteria: ['The route is usable.'],
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  })
  const controller = createGoalController(store, {
    now: () => new Date('2026-08-14T01:00:00.000Z'),
  })
  return { store, controller }
}

function acceptedInput(store: ReturnType<typeof createGoalPackageStore>, eventId: string) {
  const path = store.paths.inputDocument('G-1', 'H-1', eventId)
  return {
    path,
    write: {
      path,
      expectedHash: null,
      content: renderInputDocument({
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: eventId,
          sourceDigest: 'a'.repeat(64),
          attachments: [],
        },
        body: 'Revise the accepted destination.\n',
      }),
    },
  }
}
