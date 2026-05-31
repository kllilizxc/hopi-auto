import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { requestGoalPlanning } from '../src/runtime/planningRequest'
import { createBoardStore } from '../src/storage/boardStore'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'planning-request')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('requestGoalPlanning', () => {
  test('reuses one open planning request while merging richer decision lineage and update targets', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const created = await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan database integration',
        description: 'Turn the database answer into durable planning work.',
        acceptanceCriteria: ['Database planning follow-through is visible.'],
        decisionRefs: ['db-provider'],
        requestedUpdates: ['design.md'],
      },
    )

    expect(created).toMatchObject({
      created: true,
      taskCreated: true,
      request: {
        requestKey: 'PR-1',
        taskRef: 'P-1',
        decisionRefs: ['db-provider'],
        requestedUpdates: ['design.md'],
      },
    })

    const reused = await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan database integration',
        description: 'Capture the schema and migration impact.',
        acceptanceCriteria: ['Database planning follow-through is visible.'],
        decisionRefs: ['migration-strategy'],
        requestedUpdates: ['todo.yml'],
      },
    )

    expect(reused).toMatchObject({
      created: false,
      taskCreated: false,
      request: {
        requestKey: 'PR-1',
        taskRef: 'P-1',
        decisionRefs: ['db-provider', 'migration-strategy'],
        requestedUpdates: ['design.md', 'todo.yml'],
      },
    })

    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          title: 'Plan database integration',
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          decisionRefs: ['db-provider', 'migration-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
