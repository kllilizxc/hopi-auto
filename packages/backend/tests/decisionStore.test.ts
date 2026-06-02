import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
      prompt: 'What should the auth strategy be?',
      taskRef: 'T-7',
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      prompt: 'What should the auth strategy be?',
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          prompt: 'What should the auth strategy be?',
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

  test('persists an explicit decision summary key across create and resolve', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the launch sequencing',
      summaryKey: 'launch-shape',
      taskRef: 'T-7',
    })

    expect(created).toMatchObject({
      decisionKey: 'D-1',
      summary: 'Choose the launch sequencing',
      summaryKey: 'launch-shape',
      prompt: 'What should the launch sequencing be?',
      taskRef: 'T-7',
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use a staged rollout.',
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      summaryKey: 'launch-shape',
      prompt: 'What should the launch sequencing be?',
      status: 'resolved',
      answer: 'Use a staged rollout.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the launch sequencing',
          summaryKey: 'launch-shape',
          prompt: 'What should the launch sequencing be?',
          taskRef: 'T-7',
          status: 'resolved',
          answer: 'Use a staged rollout.',
        },
      ],
    })
  })

  test('upgrades a synthesized decision prompt when resolving with an explicit prompt', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    expect(created).toMatchObject({
      decisionKey: 'D-1',
      prompt: 'What should the auth strategy be?',
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
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

  test('backfills a legacy missing decision prompt from summary when resolving', async () => {
    const rootDir = testRoot()
    const store = createDecisionStore(rootDir)
    const decisionPath = join(rootDir, '.hopi', 'docs', 'goals', goalKey, 'decisions.yml')

    await mkdir(dirname(decisionPath), { recursive: true })
    await Bun.write(
      decisionPath,
      `version: 1
goalKey: ${goalKey}
decisions:
  - decisionKey: D-1
    summary: Choose the auth strategy
    taskRef: T-7
    status: open
    createdAt: 2026-06-02T00:00:00.000Z
`,
    )

    const resolved = await store.resolveDecision(goalKey, 'D-1', {
      answer: 'Use Bun-native auth middleware.',
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      prompt: 'What should the auth strategy be?',
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          prompt: 'What should the auth strategy be?',
          taskRef: 'T-7',
          status: 'resolved',
          answer: 'Use Bun-native auth middleware.',
        },
      ],
    })
  })

  test('preserves an existing decision prompt when resolving again', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the auth strategy',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      taskRef: 'T-7',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
      prompt: 'Should we switch to an external auth provider?',
    } as never)
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })
  })

  test('backfills a missing decision summary key and rejects conflicting summary keys', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the launch sequencing',
      taskRef: 'T-7',
    })
    expect(created).toMatchObject({
      decisionKey: 'D-1',
      status: 'open',
    })
    expect(created.summaryKey).toBeUndefined()

    const enriched = await store.enrichDecision(goalKey, created.decisionKey, {
      summaryKey: 'launch-shape',
    })
    expect(enriched).toMatchObject({
      decisionKey: 'D-1',
      summaryKey: 'launch-shape',
      status: 'open',
    })

    await expect(
      store.resolveDecision(goalKey, created.decisionKey, {
        answer: 'Use a staged rollout.',
        summaryKey: 'rollout-shape',
      }),
    ).rejects.toThrow('Decision summaryKey conflict')
  })

  test('merges durable decision match hints across create, enrich, and resolve', async () => {
    const store = createDecisionStore(testRoot())

    const created = await store.createDecision(goalKey, {
      summary: 'Choose the auth strategy',
      matchHints: ['login path'],
      taskRef: 'T-7',
    })

    const enriched = await store.enrichDecision(goalKey, created.decisionKey, {
      matchHints: ['login path', 'sign-in flow'],
    })
    expect(enriched).toMatchObject({
      decisionKey: 'D-1',
      matchHints: ['login path', 'sign-in flow'],
      status: 'open',
    })

    const resolved = await store.resolveDecision(goalKey, created.decisionKey, {
      answer: 'Use Bun-native auth middleware.',
      matchHints: ['auth entry'],
    })
    expect(resolved).toMatchObject({
      decisionKey: 'D-1',
      matchHints: ['login path', 'sign-in flow', 'auth entry'],
      status: 'resolved',
      answer: 'Use Bun-native auth middleware.',
    })

    await expect(store.readGoalDecisions(goalKey)).resolves.toMatchObject({
      goalKey,
      decisions: [
        {
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          matchHints: ['login path', 'sign-in flow', 'auth entry'],
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
