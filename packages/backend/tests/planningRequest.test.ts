import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  requestGoalPlanning,
  requestGoalPlanningBatch,
  requestGoalPlanningWorkflows,
} from '../src/runtime/planningRequest'
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
        answers: [{ summary: 'Database direction', answer: 'Use Postgres with Bun.sql.' }],
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
        answers: [{ summary: 'Database direction', answer: 'Use Postgres with Bun.sql.' }],
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
        answers: [{ summary: 'Migration policy', answer: 'Avoid compatibility shims.' }],
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
        answers: [
          { summary: 'Database direction', answer: 'Use Postgres with Bun.sql.' },
          { summary: 'Migration policy', answer: 'Avoid compatibility shims.' },
        ],
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
          answers: [
            { summary: 'Database direction', answer: 'Use Postgres with Bun.sql.' },
            { summary: 'Migration policy', answer: 'Avoid compatibility shims.' },
          ],
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

  test('binds a planning request to an existing planning task surface', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed planning task', (board) => {
      board.items.push({
        ref: 'P-7',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })

    const result = await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Clarify auth goal context',
        description: 'Refresh durable Goal context and rollout notes after the auth answer.',
        acceptanceCriteria: ['Goal context captures the auth direction.'],
        decisionRefs: ['auth-strategy'],
        requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        reuseTaskRef: 'P-7',
      },
    )

    expect(result).toMatchObject({
      created: true,
      taskCreated: false,
      request: {
        requestKey: 'PR-1',
        taskRef: 'P-7',
        decisionRefs: ['auth-strategy'],
        requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-7',
          kind: 'planning',
          title: 'Clarify auth goal context',
          description: 'Refresh durable Goal context and rollout notes after the auth answer.',
          acceptanceCriteria: ['Goal context captures the auth direction.'],
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
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
        answers: [
          { summary: 'Auth direction', answer: 'Use Bun-native auth with SSO-first scope.' },
        ],
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
          answers: [
            { summary: 'Auth direction', answer: 'Use Bun-native auth with SSO-first scope.' },
          ],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          answers: [
            { summary: 'Auth direction', answer: 'Use Bun-native auth with SSO-first scope.' },
          ],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('creates more than one independent planning workflow atomically', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflows: [
          {
            kind: 'planning',
            title: 'Capture rollout notes',
            description: 'Record rollout details before more planning work continues.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: ['rollout-strategy'],
            answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers.' }],
            requestedUpdates: ['goal.md', 'notes/rollout.md'],
          },
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['auth-strategy'],
            answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-1', 'P-3'],
      createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
      createdTaskRefs: ['P-1', 'P-2', 'P-3'],
      workflows: [
        {
          kind: 'planning',
          requestKeys: ['PR-1'],
          taskRefs: ['P-1'],
          blockerTaskRefs: ['P-1'],
        },
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-2', 'PR-3'],
          taskRefs: ['P-2', 'P-3'],
          blockerTaskRefs: ['P-3'],
        },
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['rollout-strategy'],
          answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers.' }],
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          title: 'Capture rollout notes',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-2',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-3',
          title: 'Decompose auth task graph',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ],
    })
  })

  test('applies workflow-root decision lineage and captured answers across every direct workflow child', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        decisionRefs: ['auth-strategy'],
        answers: [
          {
            summary: 'Pilot scope',
            answer: 'Start with five enterprise customers before broader rollout.',
          },
        ],
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['rollout-strategy'],
            answers: [{ summary: 'Rollback trigger', answer: 'Abort after two regressions.' }],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Capture auth rollout goal context',
                description: 'Record the auth and rollout workflow context across Goal docs.',
                acceptanceCriteria: ['The auth rollout context is durable.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth rollout task graph',
                description: 'Reflect the auth rollout workflow in todo.yml.',
                acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review auth rollout readiness',
            description: 'Inspect the shared auth rollout workflow before handoff.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
      createdTaskRefs: ['P-1', 'P-2', 'P-3'],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            { summary: 'Rollback trigger', answer: 'Abort after two regressions.' },
          ],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            { summary: 'Rollback trigger', answer: 'Abort after two regressions.' },
          ],
          requestedUpdates: ['todo.yml'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
          ],
          requestedUpdates: ['design.md'],
        }),
      ],
    })
  })

  test('persists workflow-root shared context across later direct workflow extensions', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        decisionRefs: ['auth-strategy'],
        answers: [
          {
            summary: 'Pilot scope',
            answer: 'Start with five enterprise customers before broader rollout.',
          },
        ],
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            answers: [{ summary: 'Rollback trigger', answer: 'Abort after two regressions.' }],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Capture auth rollout goal context',
                description: 'Record the shared auth rollout context across Goal docs.',
                acceptanceCriteria: ['The auth rollout context is durable.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth rollout task graph',
                description: 'Reflect the shared auth rollout context in todo.yml.',
                acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
        ],
      },
    )

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review auth rollout readiness',
            description: 'Inspect the persisted auth rollout workflow before handoff.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-3'],
      createdTaskRefs: ['P-3'],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            { summary: 'Rollback trigger', answer: 'Abort after two regressions.' },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            { summary: 'Rollback trigger', answer: 'Abort after two regressions.' },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
          ],
        }),
      ],
    })
  })

  test('reuses an existing planning surface as the first workflow in a direct workflow batch', async () => {
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
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        reuseTaskRef: 'P-1',
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['auth-strategy'],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
          {
            kind: 'planning',
            title: 'Capture rollout notes',
            description: 'Record rollout details in parallel with auth planning.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: ['rollout-strategy'],
            requestedUpdates: ['notes/rollout.md'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-2', 'PR-3'],
      createdTaskRefs: ['P-2', 'P-3'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
          createdRequestKeys: ['PR-2'],
          createdTaskRefs: ['P-2'],
        },
        {
          kind: 'planning',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
          blockerTaskRefs: ['P-3'],
          createdRequestKeys: ['PR-3'],
          createdTaskRefs: ['P-3'],
        },
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
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          decisionRefs: ['rollout-strategy'],
          requestedUpdates: ['notes/rollout.md'],
        }),
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
        expect.objectContaining({
          ref: 'P-3',
          title: 'Capture rollout notes',
          blockedBy: [],
        }),
      ],
    })
  })

  test('fans engineering blockers out to every current sink when a reused planning surface expands into direct workflow batch', async () => {
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
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering blocker', (board) => {
      board.items.push({
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for every workflow sink before engineering resumes.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      })
    })

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        reuseTaskRef: 'P-1',
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['auth-strategy'],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
          {
            kind: 'planning',
            title: 'Capture rollout notes',
            description: 'Record rollout details in parallel with auth planning.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: ['rollout-strategy'],
            requestedUpdates: ['notes/rollout.md'],
          },
        ],
      },
    )

    expect(result.blockerTaskRefs).toEqual(['P-2', 'P-3'])
    const board = await boardStore.readBoard('goal-1')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-1',
          blockedBy: [
            { kind: 'task', ref: 'P-2' },
            { kind: 'task', ref: 'P-3' },
          ],
        }),
      ]),
    )
  })

  test('extends an existing direct workflow batch through a stable workflow key', async () => {
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
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering blocker', (board) => {
      board.items.push({
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for every workflow sink before engineering resumes.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      })
    })

    await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        reuseTaskRef: 'P-1',
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['auth-strategy'],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
          {
            kind: 'planning',
            title: 'Capture rollout notes',
            description: 'Record rollout details in parallel with auth planning.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: ['rollout-strategy'],
            requestedUpdates: ['notes/rollout.md'],
          },
        ],
      },
    )

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning',
            title: 'Review auth rollout readiness',
            description: 'Inspect the current auth rollout workflow before handoff.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
      taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
      blockerTaskRefs: ['P-2', 'P-3', 'P-4'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        },
        {
          kind: 'planning',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
          blockerTaskRefs: ['P-3'],
        },
        {
          kind: 'planning',
          requestKeys: ['PR-4'],
          taskRefs: ['P-4'],
          blockerTaskRefs: ['P-4'],
        },
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-4',
          workflowKey: 'auth-rollout-follow-through',
        }),
      ],
    })
    const board = await boardStore.readBoard('goal-1')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-1',
          blockedBy: [
            { kind: 'task', ref: 'P-2' },
            { kind: 'task', ref: 'P-3' },
            { kind: 'task', ref: 'P-4' },
          ],
        }),
      ]),
    )
  })

  test('reuses a standalone direct workflow child through a stable workflow task key', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'rollout-notes',
            title: 'Capture rollout notes',
            description: 'Record rollout details before more planning work continues.',
            acceptanceCriteria: ['Rollout notes are durable.'],
            decisionRefs: ['rollout-strategy'],
            requestedUpdates: ['notes/rollout.md'],
          },
          {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            decisionRefs: ['auth-strategy'],
            requests: [
              {
                taskKey: 'goal-docs',
                title: 'Clarify auth goal context',
                description: 'Refresh durable Goal context before decomposition.',
                acceptanceCriteria: ['Goal context captures the auth direction.'],
                requestedUpdates: ['goal.md', 'design.md'],
              },
              {
                taskKey: 'task-graph',
                title: 'Decompose auth task graph',
                description: 'Reshape todo.yml after the goal context is stable.',
                acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['goal-docs'],
              },
            ],
          },
        ],
      },
    )

    const result = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'rollout-notes',
            title: 'Prepare rollout readiness package',
            description: 'Upgrade the rollout notes into a reusable readiness package.',
            acceptanceCriteria: ['The rollout readiness package is durable.'],
            requestedUpdates: ['notes/rollout.md', 'design.md'],
          },
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review auth rollout readiness',
            description: 'Inspect the full auth rollout workflow before handoff.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
          },
        ],
      },
    )

    expect(result).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
      taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
      blockerTaskRefs: ['P-1', 'P-3', 'P-4'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
      workflows: [
        {
          kind: 'planning',
          workflowTaskKey: 'rollout-notes',
          requestKeys: ['PR-1'],
          taskRefs: ['P-1'],
          blockerTaskRefs: ['P-1'],
        },
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-2', 'PR-3'],
          taskRefs: ['P-2', 'P-3'],
          blockerTaskRefs: ['P-3'],
        },
        {
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-4'],
          taskRefs: ['P-4'],
          blockerTaskRefs: ['P-4'],
        },
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'rollout-notes',
          title: 'Prepare rollout readiness package',
          description: 'Upgrade the rollout notes into a reusable readiness package.',
          requestedUpdates: ['notes/rollout.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
        }),
        expect.objectContaining({
          requestKey: 'PR-4',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          title: 'Review auth rollout readiness',
        }),
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-1',
          title: 'Prepare rollout readiness package',
          description: 'Upgrade the rollout notes into a reusable readiness package.',
          acceptanceCriteria: ['The rollout readiness package is durable.'],
        }),
        expect.objectContaining({
          ref: 'P-4',
          title: 'Review auth rollout readiness',
        }),
      ]),
    })
  })

  test('keeps a direct workflow child blocked on the current sink of an upstream workflow child', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const initial = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'rollout-follow-through',
            requests: [
              {
                taskKey: 'capture-notes',
                title: 'Capture rollout notes',
                description: 'Record rollout details before review.',
                acceptanceCriteria: ['Rollout notes are durable.'],
                requestedUpdates: ['notes/rollout.md'],
              },
              {
                taskKey: 'validate-plan',
                title: 'Validate rollout plan',
                description: 'Check the rollout notes before handoff review.',
                acceptanceCriteria: ['The rollout plan is validated.'],
                requestedUpdates: ['design.md'],
                blockedByTaskKeys: ['capture-notes'],
              },
            ],
          },
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review auth rollout readiness',
            description: 'Inspect the rollout workflow after the rollout child finishes.',
            acceptanceCriteria: ['The auth rollout review is visible.'],
            requestedUpdates: ['design.md'],
            blockedByWorkflowKeys: ['rollout-follow-through'],
          },
        ],
      },
    )

    expect(initial).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['rollout-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-3'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        },
        {
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
          blockerTaskRefs: ['P-3'],
        },
      ],
    })

    const extension = await requestGoalPlanningWorkflows(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        workflowKey: 'auth-rollout-follow-through',
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'rollout-follow-through',
            requests: [
              {
                taskKey: 'finalize-plan',
                title: 'Finalize rollout plan',
                description: 'Add the final rollout stage before handoff review.',
                acceptanceCriteria: ['The rollout plan is finalized.'],
                requestedUpdates: ['todo.yml'],
                blockedByTaskKeys: ['validate-plan'],
              },
            ],
          },
        ],
      },
    )

    expect(extension).toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['rollout-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-4', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-4', 'P-3'],
      blockerTaskRefs: ['P-3'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2', 'PR-4'],
          taskRefs: ['P-1', 'P-2', 'P-4'],
          blockerTaskRefs: ['P-4'],
        },
        {
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
          blockerTaskRefs: ['P-3'],
        },
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
        }),
        expect.objectContaining({
          requestKey: 'PR-4',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'finalize-plan',
        }),
      ]),
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'task', ref: 'P-4' }],
        }),
        expect.objectContaining({
          ref: 'P-4',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    })
  })

  test('reuses an existing planning task as the first grouped planning stage', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed planning task', (board) => {
      board.items.push({
        ref: 'P-7',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })

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
            description: 'Refresh durable Goal context and rollout notes after the auth answer.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
          },
          {
            taskKey: 'task-graph',
            title: 'Decompose auth task graph',
            description: 'Reshape todo.yml after the auth context is stable.',
            acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
        reuseTaskRefByTaskKey: {
          'goal-docs': 'P-7',
        },
      },
    )

    expect(result).toMatchObject({
      groupKey: 'auth-follow-through',
      entries: [
        {
          taskKey: 'goal-docs',
          requestKey: 'PR-1',
          taskRef: 'P-7',
        },
        {
          taskKey: 'task-graph',
          requestKey: 'PR-2',
          taskRef: 'P-8',
        },
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-7',
          title: 'Clarify auth goal context',
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        }),
        expect.objectContaining({
          ref: 'P-8',
          title: 'Decompose auth task graph',
          blockedBy: [{ kind: 'task', ref: 'P-7' }],
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
