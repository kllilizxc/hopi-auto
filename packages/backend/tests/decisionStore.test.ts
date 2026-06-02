import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createDecisionStore } from '../src/storage/decisionStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'decision-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createDecisionStore', () => {
  test('reads a missing decisions file as an empty Goal decision set', async () => {
    const store = createDecisionStore(testRoot())

    await expect(store.readGoalDecisions(goalKey)).resolves.toEqual({
      version: 1,
      goalKey,
      decisions: [],
    })
  })

  test('creates and resolves durable Goal decisions', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    expect(created).toMatchObject({
      decisionKey: 'D-1',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          taskRef: 'T-7',
          status: 'resolved',
          answer: 'Use Bun-native auth middleware.',
        },
      ],
    })
  })

  test('supports stable custom decision keys for explicit blocker topics', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      decisionKey: 'db-provider',
      summary: 'Choose the database provider',
      taskRef: 'T-2',
    })

    expect(created).toMatchObject({
      decisionKey: 'db-provider',
      summary: 'Choose the database provider',
      taskRef: 'T-2',
      status: 'open',
    })
  })

  test('persists an explicit decision prompt across create and resolve', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the auth strategy',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      taskRef: 'T-7',
    })

    expect(created).toMatchObject({
      decisionKey: 'D-1',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      taskRef: 'T-7',
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
          taskRef: 'T-7',
          status: 'resolved',
          answer: 'Use Bun-native auth middleware.',
        },
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
