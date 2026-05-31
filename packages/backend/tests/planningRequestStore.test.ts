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
    })
    expect(created).toMatchObject({
      requestKey: 'PR-1',
      title: 'Plan auth follow-through',
      taskRef: 'P-1',
      status: 'open',
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
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
