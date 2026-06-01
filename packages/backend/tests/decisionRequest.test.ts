import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { requestGoalDecision, resolveGoalDecision } from '../src/runtime/decisionRequest'
import { requestGoalPlanning, requestGoalPlanningBatch } from '../src/runtime/planningRequest'
import { createBoardStore } from '../src/storage/boardStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'decision-request')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('requestGoalDecision', () => {
  test('enriches an open planning request with decision lineage and default update targets', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan auth integration',
        description: 'Clarify the auth path before decomposition.',
        acceptanceCriteria: ['The auth planning path is visible.'],
      },
    )

    const result = await requestGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        summary: 'Choose the auth strategy',
        taskRef: 'P-1',
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'auth-strategy',
        taskRef: 'P-1',
        status: 'open',
      },
      blockerAdded: true,
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('preserves explicit requested updates when enriching an open planning request', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        title: 'Plan auth integration',
        description: 'Clarify the auth path before decomposition.',
        acceptanceCriteria: ['The auth planning path is visible.'],
        requestedUpdates: ['todo.yml'],
      },
    )

    await requestGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        summary: 'Choose the auth strategy',
        taskRef: 'P-1',
      },
    )

    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('enriches grouped sibling planning requests with the same decision lineage', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        title: 'Clarify auth goal context',
        description: 'Refresh durable Goal context first.',
        acceptanceCriteria: ['Goal context is durable.'],
        requestedUpdates: ['goal.md', 'design.md'],
      },
    )
    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        groupKey: 'auth-follow-through',
        title: 'Decompose auth task graph',
        description: 'Reshape todo.yml after the goal context is ready.',
        acceptanceCriteria: ['The auth task graph is visible.'],
      },
    )

    await requestGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        summary: 'Choose the auth strategy',
        taskRef: 'P-1',
      },
    )

    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('resolving an engineering-linked decision creates visible planner follow-through and rewires blockers', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    const result = await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        answer: 'Use Bun-native auth.',
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'auth-strategy',
        status: 'resolved',
        answer: 'Use Bun-native auth.',
      },
      blockerRemoved: true,
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('resolving an engineering-linked decision accepts one explicit planning follow-through', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    const result = await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        answer: 'Use Bun-native auth.',
        followThrough: {
          kind: 'planning',
          title: 'Roll auth answer into durable docs',
          description:
            'Capture the auth answer across durable Goal docs before engineering continues.',
          acceptanceCriteria: ['The auth answer is durable before engineering resumes.'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md', 'todo.yml'],
        },
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'auth-strategy',
        status: 'resolved',
      },
      blockerRemoved: true,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-1'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Roll auth answer into durable docs',
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('resolving an engineering-linked decision can create grouped planner follow-through from explicit metadata', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    const result = await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        answer: 'Use Bun-native auth.',
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requests: [
            {
              taskKey: 'goal-docs',
              title: 'Clarify auth goal context',
              description: 'Refresh durable Goal context and rollout notes before decomposition.',
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
        },
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'auth-strategy',
        status: 'resolved',
      },
      blockerRemoved: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
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
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
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

  test('retargets engineering blockers to the current grouped planning tail when follow-through is extended', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        answer: 'Use Bun-native auth.',
      },
    )

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
    )

    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    })

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

    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-3' }],
        }),
      ]),
    })
  })

  test('fans engineering blockers out to each current grouped planning leaf', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'auth-strategy',
        answer: 'Use Bun-native auth.',
      },
    )

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
            description: 'Refresh durable Goal context before decomposition.',
            acceptanceCriteria: ['Goal context captures the auth direction.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
          {
            taskKey: 'api-shape',
            title: 'Plan auth API shape',
            description: 'Define the Bun API contract after Goal context is stable.',
            acceptanceCriteria: ['The auth API plan is visible.'],
            requestedUpdates: ['design.md'],
            blockedByTaskKeys: ['goal-docs'],
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
    )

    const board = await boardStore.readBoard('goal-1')
    const engineeringTask = board.items.find((item) => item.ref === 'T-9')
    expect(engineeringTask).toBeDefined()
    expect(engineeringTask?.blockedBy).toEqual(
      expect.arrayContaining([
        { kind: 'task', ref: 'P-2' },
        { kind: 'task', ref: 'P-3' },
      ]),
    )
    expect(engineeringTask?.blockedBy).toHaveLength(2)
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
