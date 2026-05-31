import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { requestGoalDecision, resolveGoalDecision } from '../src/runtime/decisionRequest'
import { requestGoalPlanning } from '../src/runtime/planningRequest'
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
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
