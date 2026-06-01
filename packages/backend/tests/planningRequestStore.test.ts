import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'

const goalKey = 'goal-1'
const tmpBase = join(process.cwd(), 'tests', 'tmp', 'planning-request-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createPlanningRequestStore', () => {
  test('reads a missing planning-requests file as an empty Goal planning request set', async () => {
    const store = createPlanningRequestStore(testRoot())

    await expect(store.readGoalPlanningRequests(goalKey)).resolves.toEqual({
      version: 1,
      goalKey,
      requests: [],
    })
  })

  test('creates and resolves durable Goal planning requests', async () => {
    const store = createPlanningRequestStore(testRoot())

    const created = await store.createRequest(goalKey, {
      title: 'Plan auth follow-through',
      description: 'Capture the auth planning follow-through.',
      acceptanceCriteria: ['The auth plan is durable.'],
      taskRef: 'P-1',
      decisionRefs: ['auth-strategy'],
      requestedUpdates: ['design.md', 'todo.yml'],
    })
    expect(created).toMatchObject({
      requestKey: 'PR-1',
      title: 'Plan auth follow-through',
      taskRef: 'P-1',
      status: 'open',
      decisionRefs: ['auth-strategy'],
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    const resolved = await store.resolveRequest(goalKey, created.requestKey, {
      resolution: 'Planning task P-1 completed.',
    })
    expect(resolved).toMatchObject({
      requestKey: 'PR-1',
      status: 'resolved',
      resolution: 'Planning task P-1 completed.',
    })

    await expect(store.readGoalPlanningRequests(goalKey)).resolves.toMatchObject({
      goalKey,
      requests: [
        {
          requestKey: 'PR-1',
          title: 'Plan auth follow-through',
          taskRef: 'P-1',
          status: 'resolved',
          resolution: 'Planning task P-1 completed.',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        },
      ],
    })
  })

  test('supports stable custom planning request keys', async () => {
    const store = createPlanningRequestStore(testRoot())

    const created = await store.createRequest(goalKey, {
      requestKey: 'auth-follow-through',
      title: 'Plan auth follow-through',
      description: 'Capture the auth planning follow-through.',
      acceptanceCriteria: ['The auth plan is durable.'],
      taskRef: 'P-1',
    })

    expect(created).toMatchObject({
      requestKey: 'auth-follow-through',
      title: 'Plan auth follow-through',
      taskRef: 'P-1',
      status: 'open',
    })
  })

  test('supports goal.md as a requested durable update target', async () => {
    const store = createPlanningRequestStore(testRoot())

    const created = await store.createRequest(goalKey, {
      title: 'Clarify product boundaries',
      description: 'Refresh durable Goal context before more planning work continues.',
      acceptanceCriteria: ['Goal context is durable.'],
      taskRef: 'P-2',
      requestedUpdates: ['goal.md', 'design.md'],
    })

    expect(created).toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-2',
      requestedUpdates: ['goal.md', 'design.md'],
    })
    await expect(store.readGoalPlanningRequests(goalKey)).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          requestedUpdates: ['goal.md', 'design.md'],
        }),
      ],
    })
  })

  test('normalizes extra Goal-local requested update paths', async () => {
    const store = createPlanningRequestStore(testRoot())

    const created = await store.createRequest(goalKey, {
      title: 'Capture rollout notes',
      description: 'Record the rollout-specific planning notes durably.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      taskRef: 'P-3',
      requestedUpdates: ['goal.md', './notes//rollout.md', 'research.md'],
    })

    expect(created).toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-3',
      requestedUpdates: ['goal.md', 'notes/rollout.md', 'research.md'],
    })
    await expect(store.readGoalPlanningRequests(goalKey)).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          requestedUpdates: ['goal.md', 'notes/rollout.md', 'research.md'],
        }),
      ],
    })
  })

  test('rejects traversal and reserved Goal state files as requested update targets', async () => {
    const store = createPlanningRequestStore(testRoot())

    await expect(
      store.createRequest(goalKey, {
        title: 'Escape Goal docs',
        description: 'This should fail.',
        acceptanceCriteria: ['The invalid target is rejected.'],
        taskRef: 'P-4',
        requestedUpdates: ['../escape.md'],
      }),
    ).rejects.toThrow('Invalid requested update target')

    await expect(
      store.createRequest(goalKey, {
        title: 'Rewrite decision store',
        description: 'This should also fail.',
        acceptanceCriteria: ['The reserved target is rejected.'],
        taskRef: 'P-4',
        requestedUpdates: ['decisions.yml'],
      }),
    ).rejects.toThrow('Invalid requested update target')
  })

  test('supports stable planning request group keys', async () => {
    const store = createPlanningRequestStore(testRoot())

    const created = await store.createRequest(goalKey, {
      title: 'Plan auth docs',
      description: 'Coordinate auth follow-through across multiple planning tasks.',
      acceptanceCriteria: ['The auth planning split is durable.'],
      taskRef: 'P-3',
      groupKey: 'auth-follow-through',
    })

    expect(created).toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-3',
      groupKey: 'auth-follow-through',
    })
    await expect(store.readGoalPlanningRequests(goalKey)).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
        }),
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
