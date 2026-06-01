import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  answerGoalDecision,
  answerGoalDecisions,
  requestGoalDecision,
  resolveGoalDecision,
} from '../src/runtime/decisionRequest'
import {
  requestGoalPlanning,
  requestGoalPlanningBatch,
  requestGoalPlanningWorkflows,
} from '../src/runtime/planningRequest'
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

  test('resolving a planning-linked decision with explicit follow-through reuses the current planning surface', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed planning task', (board) => {
      board.items.push({
        ref: 'P-4',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
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
          title: 'Clarify auth goal context',
          description: 'Refresh durable Goal context and rollout notes after the auth answer.',
          acceptanceCriteria: ['Goal context captures the auth direction.'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
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
        taskRefs: ['P-4'],
        blockerTaskRefs: ['P-4'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-4',
          title: 'Clarify auth goal context',
          description: 'Refresh durable Goal context and rollout notes after the auth answer.',
          acceptanceCriteria: ['Goal context captures the auth direction.'],
          blockedBy: [],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-4',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
      ],
    })
  })

  test('resolving a mixed planning and engineering decision without explicit follow-through preserves the current default behavior', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard(
      'goal-1',
      'test',
      'seed planning and engineering tasks',
      (board) => {
        board.items.push({
          ref: 'P-4',
          kind: 'planning',
          status: 'planned',
          title: 'Plan auth integration',
          description: 'Wait for the auth answer before planning continues.',
          acceptanceCriteria: ['Planning continues after the auth answer.'],
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        })
        board.items.push({
          ref: 'T-9',
          kind: 'engineering',
          status: 'planned',
          title: 'Implement auth integration',
          description: 'Wait for planner follow-through before engineering continues.',
          acceptanceCriteria: ['The auth path is implemented.'],
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        })
      },
    )
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
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
      blockerRemoved: true,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-5'],
        blockerTaskRefs: ['P-5'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-4',
          title: 'Plan auth integration',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-5',
          title: 'Plan follow-through for auth-strategy',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-5' }],
        }),
      ]),
    })
  })

  test('resolving an unlinked decision with explicit follow-through creates standalone planning work', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await decisions.createDecision('goal-1', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
    })

    const result = await resolveGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        decisionKey: 'rollout-strategy',
        answer: 'Use a staged Bun-first rollout.',
        followThrough: {
          kind: 'planning',
          title: 'Capture rollout answer',
          description: 'Record the rollout answer across Goal docs and decomposition.',
          acceptanceCriteria: ['The rollout answer is durable before execution continues.'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md', 'todo.yml'],
        },
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'rollout-strategy',
        status: 'resolved',
      },
      blockerRemoved: false,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-1'],
        blockerTaskRefs: ['P-1'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Capture rollout answer',
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['rollout-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('answering a new durable topic can create standalone grouped planner follow-through without a preexisting decision key', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const result = await answerGoalDecision(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        summary: 'Choose the rollout strategy',
        answer: 'Use a staged Bun-first rollout.',
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'rollout-follow-through',
          requests: [
            {
              taskKey: 'goal-docs',
              title: 'Capture rollout answer',
              description: 'Record the rollout answer across Goal docs and rollout notes.',
              acceptanceCriteria: ['The rollout answer is durable.'],
              requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
            },
            {
              taskKey: 'task-graph',
              title: 'Decompose rollout task graph',
              description: 'Reflect the rollout answer in todo.yml before execution continues.',
              acceptanceCriteria: ['The rollout task graph is visible in todo.yml.'],
              requestedUpdates: ['todo.yml'],
              blockedByTaskKeys: ['goal-docs'],
            },
          ],
        },
      },
    )

    expect(result).toMatchObject({
      created: true,
      decision: {
        decisionKey: 'D-1',
        summary: 'Choose the rollout strategy',
        status: 'resolved',
        answer: 'Use a staged Bun-first rollout.',
      },
      blockerRemoved: false,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'rollout-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-2'],
      },
    })
    await expect(decisions.readGoalDecisions('goal-1')).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Choose the rollout strategy',
          status: 'resolved',
          answer: 'Use a staged Bun-first rollout.',
        }),
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          title: 'Capture rollout answer',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-2',
          title: 'Decompose rollout task graph',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['D-1'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['D-1'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('answering multiple durable topics can create shared grouped planner follow-through', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    const result = await answerGoalDecisions(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        answers: [
          {
            decisionKey: 'auth-strategy',
            summary: 'Choose the auth strategy',
            answer: 'Use Bun-native auth.',
          },
          {
            decisionKey: 'rollout-strategy',
            summary: 'Choose the rollout strategy',
            answer: 'Use a staged rollout.',
          },
        ],
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          requests: [
            {
              taskKey: 'goal-docs',
              title: 'Capture auth rollout goal context',
              description: 'Record the auth and rollout answers across Goal docs.',
              acceptanceCriteria: ['The auth and rollout answers are durable.'],
              requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
            },
            {
              taskKey: 'task-graph',
              title: 'Decompose auth rollout task graph',
              description: 'Reflect the auth and rollout answers in todo.yml.',
              acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
              requestedUpdates: ['todo.yml'],
              blockedByTaskKeys: ['goal-docs'],
            },
          ],
        },
      },
    )

    expect(result).toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          status: 'resolved',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          status: 'resolved',
          answer: 'Use a staged rollout.',
        }),
      ],
      createdDecisionKeys: ['rollout-strategy'],
      blockerRemoved: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-2'],
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
          title: 'Capture auth rollout goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-2',
          title: 'Decompose auth rollout task graph',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('answering multiple durable topics can reuse one linked planning surface for explicit follow-through', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed planning task', (board) => {
      board.items.push({
        ref: 'P-4',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
    })

    const result = await answerGoalDecisions(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        answers: [
          {
            decisionKey: 'auth-strategy',
            summary: 'Choose the auth strategy',
            answer: 'Use Bun-native auth.',
          },
          {
            decisionKey: 'rollout-strategy',
            summary: 'Choose the rollout strategy',
            answer: 'Use a staged rollout.',
          },
        ],
        followThrough: {
          kind: 'planning',
          title: 'Capture auth rollout goal context',
          description: 'Refresh Goal docs after the auth and rollout answers.',
          acceptanceCriteria: ['Goal docs capture the auth and rollout direction.'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        },
      },
    )

    expect(result).toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          status: 'resolved',
        }),
      ],
      createdDecisionKeys: ['rollout-strategy'],
      blockerRemoved: true,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-4'],
        blockerTaskRefs: ['P-4'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-4',
          title: 'Capture auth rollout goal context',
          blockedBy: [],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-4',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
      ],
    })
  })

  test('answering multiple durable topics can attach non-decision captured answers to shared follow-through', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed engineering task', (board) => {
      board.items.push({
        ref: 'T-9',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })

    const result = await answerGoalDecisions(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        answers: [
          {
            decisionKey: 'auth-strategy',
            summary: 'Choose the auth strategy',
            answer: 'Use Bun-native auth.',
          },
          {
            decisionKey: 'rollout-strategy',
            summary: 'Choose the rollout strategy',
            answer: 'Use a staged rollout.',
          },
        ],
        followThrough: {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            },
          ],
          requests: [
            {
              taskKey: 'goal-docs',
              title: 'Capture auth rollout goal context',
              description: 'Record the auth and rollout answers across Goal docs.',
              acceptanceCriteria: ['The auth and rollout answers are durable.'],
              requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
            },
            {
              taskKey: 'task-graph',
              title: 'Decompose auth rollout task graph',
              description: 'Reflect the auth and rollout answers in todo.yml.',
              acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
              requestedUpdates: ['todo.yml'],
              blockedByTaskKeys: ['goal-docs'],
            },
          ],
        },
      },
    )

    expect(result).toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          status: 'resolved',
        }),
      ],
      createdDecisionKeys: ['rollout-strategy'],
      blockerRemoved: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-2'],
      },
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            },
          ],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            },
          ],
          requestedUpdates: ['todo.yml'],
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

  test('resolving an engineering-linked decision can fan one answer out into multiple planner workflows', async () => {
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
          kind: 'workflow_batch',
          workflows: [
            {
              kind: 'planning',
              title: 'Capture auth answer',
              description: 'Record the auth answer across Goal docs before execution resumes.',
              acceptanceCriteria: ['The auth answer is durable in Goal docs.'],
              requestedUpdates: ['goal.md', 'design.md'],
            },
            {
              kind: 'planning_batch',
              groupKey: 'auth-rollout-follow-through',
              requests: [
                {
                  taskKey: 'task-graph',
                  title: 'Decompose auth task graph',
                  description: 'Reflect the auth answer in todo.yml.',
                  acceptanceCriteria: ['The auth task graph is visible in todo.yml.'],
                  requestedUpdates: ['todo.yml'],
                },
                {
                  taskKey: 'rollout-notes',
                  title: 'Capture auth rollout notes',
                  description: 'Record rollout notes after the task graph is visible.',
                  acceptanceCriteria: ['The auth rollout notes are durable.'],
                  requestedUpdates: ['notes/rollout.md'],
                  blockedByTaskKeys: ['task-graph'],
                },
              ],
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
        kind: 'workflow_batch',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-1', 'P-3'],
        workflows: [
          expect.objectContaining({
            kind: 'planning',
            taskRefs: ['P-1'],
          }),
          expect.objectContaining({
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            taskRefs: ['P-2', 'P-3'],
          }),
        ],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [
            { kind: 'task', ref: 'P-1' },
            { kind: 'task', ref: 'P-3' },
          ],
        }),
        expect.objectContaining({
          ref: 'P-1',
          title: 'Capture auth answer',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-2',
          title: 'Decompose auth task graph',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-3',
          title: 'Capture auth rollout notes',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ],
    })
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
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['notes/rollout.md'],
        }),
      ],
    })
  })

  test('answering multiple durable topics can share one non-decision answer across a workflow graph', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    const result = await answerGoalDecisions(
      {
        boardStore,
        decisions,
        planningRequests,
      },
      {
        goalKey: 'goal-1',
        answers: [
          {
            decisionKey: 'auth-strategy',
            summary: 'Choose the auth strategy',
            answer: 'Use Bun-native auth.',
          },
          {
            decisionKey: 'rollout-strategy',
            summary: 'Choose the rollout strategy',
            answer: 'Use a staged rollout.',
          },
        ],
        followThrough: {
          kind: 'workflow_batch',
          workflowKey: 'auth-rollout-follow-through',
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
          ],
          workflows: [
            {
              kind: 'planning_batch',
              groupKey: 'auth-rollout-follow-through',
              answers: [
                {
                  summary: 'Rollback trigger',
                  answer: 'Abort after two regressions.',
                },
              ],
              requests: [
                {
                  taskKey: 'goal-docs',
                  title: 'Capture auth rollout goal context',
                  description: 'Record the auth and rollout answers across Goal docs.',
                  acceptanceCriteria: ['The auth and rollout answers are durable.'],
                  requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
                },
                {
                  taskKey: 'task-graph',
                  title: 'Decompose auth rollout task graph',
                  description: 'Reflect the auth and rollout answers in todo.yml.',
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
      },
    )

    expect(result).toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          status: 'resolved',
        }),
      ],
      followThrough: {
        kind: 'workflow_batch',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-2', 'P-3'],
      },
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            {
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
            {
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
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

  test('resolving an engineering-linked decision can create a durable workflow graph that later direct planning extends', async () => {
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
          kind: 'workflow_batch',
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
      },
    )

    expect(result).toMatchObject({
      decision: {
        decisionKey: 'auth-strategy',
        status: 'resolved',
      },
      blockerRemoved: true,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        groupKeys: ['rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-3'],
        workflows: [
          expect.objectContaining({
            kind: 'planning_batch',
            groupKey: 'rollout-follow-through',
            blockerTaskRefs: ['P-2'],
          }),
          expect.objectContaining({
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            blockerTaskRefs: ['P-3'],
          }),
        ],
      },
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'rollout-follow-through',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'rollout-follow-through',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
          decisionRefs: ['auth-strategy'],
        }),
      ]),
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-3' }],
        }),
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
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
      workflowKey: 'auth-rollout-follow-through',
      requestKeys: ['PR-1', 'PR-2', 'PR-4', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-4', 'P-3'],
      blockerTaskRefs: ['P-3'],
      workflows: [
        expect.objectContaining({
          kind: 'planning_batch',
          groupKey: 'rollout-follow-through',
          blockerTaskRefs: ['P-4'],
        }),
        expect.objectContaining({
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          blockerTaskRefs: ['P-3'],
        }),
      ],
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-3' }],
        }),
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

  test('resolving a planning-linked decision with grouped follow-through reuses the current planning task and still rewires engineering blockers', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard(
      'goal-1',
      'test',
      'seed planning and engineering tasks',
      (board) => {
        board.items.push({
          ref: 'P-4',
          kind: 'planning',
          status: 'planned',
          title: 'Plan auth integration',
          description: 'Wait for the auth answer before planning continues.',
          acceptanceCriteria: ['Planning continues after the auth answer.'],
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        })
        board.items.push({
          ref: 'T-9',
          kind: 'engineering',
          status: 'planned',
          title: 'Implement auth integration',
          description: 'Wait for planner follow-through before engineering continues.',
          acceptanceCriteria: ['The auth path is implemented.'],
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        })
      },
    )
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
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
        taskRefs: ['P-4', 'P-5'],
        blockerTaskRefs: ['P-5'],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-4',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-5',
          title: 'Decompose auth task graph',
          blockedBy: [{ kind: 'task', ref: 'P-4' }],
        }),
        expect.objectContaining({
          ref: 'T-9',
          blockedBy: [{ kind: 'task', ref: 'P-5' }],
        }),
      ]),
    })
  })

  test('resolving a planning-linked decision can reuse the current planning surface as the first workflow in a multi-workflow answer', async () => {
    const rootDir = testRoot()
    const boardStore = createBoardStore(rootDir)
    const decisions = createDecisionStore(rootDir)
    const planningRequests = createPlanningRequestStore(rootDir)

    await boardStore.mutateBoard('goal-1', 'test', 'seed planning task', (board) => {
      board.items.push({
        ref: 'P-4',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      })
    })
    await decisions.createDecision('goal-1', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
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
          kind: 'workflow_batch',
          workflows: [
            {
              kind: 'planning',
              title: 'Clarify auth goal context',
              description: 'Refresh durable Goal context after the auth answer.',
              acceptanceCriteria: ['Goal context captures the auth direction.'],
              requestedUpdates: ['goal.md', 'design.md'],
            },
            {
              kind: 'planning',
              title: 'Capture auth research follow-up',
              description: 'Record deeper auth research after the goal context is stable.',
              acceptanceCriteria: ['The auth research follow-up is durable.'],
              requestedUpdates: ['research.md'],
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
        kind: 'workflow_batch',
        groupKeys: [],
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-4', 'P-5'],
        blockerTaskRefs: ['P-4', 'P-5'],
        workflows: [
          expect.objectContaining({
            kind: 'planning',
            taskRefs: ['P-4'],
          }),
          expect.objectContaining({
            kind: 'planning',
            taskRefs: ['P-5'],
          }),
        ],
      },
    })
    await expect(boardStore.readBoard('goal-1')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-4',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-5',
          title: 'Capture auth research follow-up',
          blockedBy: [],
        }),
      ],
    })
    await expect(planningRequests.readGoalPlanningRequests('goal-1')).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-4',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-5',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['research.md'],
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
