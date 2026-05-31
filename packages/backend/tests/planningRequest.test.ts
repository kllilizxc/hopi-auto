import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { requestGoalPlanning, requestGoalPlanningBatch } from '../src/runtime/planningRequest'
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

  test('reuses and upgrades a generic decision follow-through when a richer planning request arrives', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan follow-through for db-provider',
        description:
          'Update design.md and todo.yml to reflect the resolved decision "Choose the database provider" before engineering continues.',
        acceptanceCriteria: [
          'design.md captures the follow-through for db-provider.',
          'todo.yml reflects the follow-through for db-provider before engineering resumes.',
        ],
        decisionRefs: ['db-provider'],
        requestedUpdates: ['design.md', 'todo.yml'],
      },
    )

    const reused = await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan database integration',
        description: 'Define the database adapter and migration work.',
        acceptanceCriteria: ['The database integration plan is visible in todo.yml.'],
        decisionRefs: ['db-provider'],
        requestedUpdates: ['design.md', 'todo.yml'],
      },
    )

    expect(reused).toMatchObject({
      created: false,
      taskCreated: false,
      request: {
        requestKey: 'PR-1',
        taskRef: 'P-1',
        title: 'Plan database integration',
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          title: 'Plan database integration',
          description: 'Define the database adapter and migration work.',
          acceptanceCriteria: ['The database integration plan is visible in todo.yml.'],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          title: 'Plan database integration',
          description: 'Define the database adapter and migration work.',
          acceptanceCriteria: ['The database integration plan is visible in todo.yml.'],
          decisionRefs: ['db-provider'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('creates grouped planning follow-through across multiple visible planning tasks', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const result = await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        decisionRefs: ['auth-strategy'],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Clarify auth goal context',
            description: 'Refresh the durable goal context before decomposition.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
          {
            taskKey: 'task-graph',
            title: 'Decompose auth task graph',
            description: 'Reshape the visible planning graph after the auth goal context is clear.',
            acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      groupKey: 'auth-follow-through',
      entries: [
        {
          taskKey: 'goal-docs',
          requestKey: 'PR-1',
          taskRef: 'P-1',
        },
        {
          taskKey: 'task-graph',
          requestKey: 'PR-2',
          taskRef: 'P-2',
        },
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-2',
          title: 'Decompose auth task graph',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('extends an existing grouped planning follow-through with one later dependent task', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        decisionRefs: ['auth-strategy'],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Clarify auth goal context',
            description: 'Refresh the durable goal context before decomposition.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
          {
            taskKey: 'task-graph',
            title: 'Decompose auth task graph',
            description: 'Reshape the visible planning graph after the auth goal context is clear.',
            acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    )

    const extension = await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        decisionRefs: ['auth-strategy'],
        requests: [
          {
            taskKey: 'review-pass',
            title: 'Review auth planning follow-through',
            description: 'Inspect the grouped planning artifacts before handoff.',
            acceptanceCriteria: ['The grouped planning review is visible.'],
            requestedUpdates: ['design.md'],
            blockedByTaskKeys: ['task-graph'],
          },
        ],
      },
    )

    expect(extension).toMatchObject({
      groupKey: 'auth-follow-through',
      entries: [
        {
          taskKey: 'review-pass',
          requestKey: 'PR-3',
          taskRef: 'P-3',
          created: true,
          taskCreated: true,
        },
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          title: 'Review auth planning follow-through',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          taskRef: 'P-1',
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          taskRef: 'P-2',
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'review-pass',
          taskRef: 'P-3',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md'],
        }),
      ],
    })
  })

  test('rejects conflicting grouped task-key reuse when one grouped request already owns the key', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Clarify auth goal context',
            description: 'Refresh the durable goal context before decomposition.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
    )

    await expect(
      requestGoalPlanningBatch(
        {
          boardStore,
          planningRequests,
        },
        {
          goalKey: 'goal-1',
          groupKey: 'auth-follow-through',
          requests: [
            {
              taskKey: 'other-key',
              title: 'Clarify auth goal context',
              description: 'Reuse the same visible task under a different durable key.',
              acceptanceCriteria: ['The auth goal context stays durable.'],
              requestedUpdates: ['goal.md', 'design.md'],
            },
          ],
        },
      ),
    ).rejects.toThrow('Grouped planning request key conflict')
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
