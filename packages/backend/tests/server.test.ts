import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner } from '../src/agent/AgentRunner'
import { ProcessAgentRunner } from '../src/agent/ProcessAgentRunner'
import type { TaskItem, TodoBoard } from '../src/domain/board'
import { createServer } from '../src/index'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'
import { requestGoalPlanning } from '../src/runtime/planningRequest'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'
import { createWorktreeManager } from '../src/runtime/worktreeManager'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createBoardStore } from '../src/storage/boardStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'
import { createPreferenceStore } from '../src/storage/preferenceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'server')
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createServer', () => {
  test('serves the Bun UI shell at root', async () => {
    const server = startServer()

    const response = await fetch(apiUrl(server, '/'))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('HOPI')
  })

  test('returns an empty board for a missing goal', async () => {
    const server = startServer()

    const response = await fetch(apiUrl(server, '/api/goals/test/board'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      version: 1,
      goal: { goalKey: 'test', title: 'Goal: test' },
      items: [],
    })
  })

  test('returns bootstrapped goal docs through the API', async () => {
    const server = startServer()

    const response = await fetch(apiUrl(server, '/api/goals/test/docs'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      goalKey: 'test',
      goal: {
        status: 'bootstrapped',
        content: expect.stringContaining('# Goal: test'),
      },
      design: {
        status: 'bootstrapped',
        content: expect.stringContaining('Durable design detail has not been recorded yet.'),
      },
    })
  })

  test('creates and lists durable planning requests through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Plan auth follow-through',
      description: 'Turn the auth answer into durable planning work.',
      acceptanceCriteria: ['The auth follow-through is visible in todo.yml.'],
      decisionRefs: ['auth-strategy'],
      answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      title: 'Plan auth follow-through',
      taskRef: 'P-1',
      status: 'open',
      decisionRefs: ['auth-strategy'],
      answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    const listResponse = await fetch(apiUrl(server, '/api/goals/test/planning-requests'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          title: 'Plan auth follow-through',
          taskRef: 'P-1',
          status: 'open',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Plan auth follow-through',
        }),
      ],
    })

    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('requestKey: PR-1')
    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('decisionRefs:')
    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('answers:')
    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('requestedUpdates:')
  })

  test('accepts goal.md as a requested durable update through the planning-request API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Clarify product boundaries',
      description: 'Refresh durable Goal context before planning continues.',
      acceptanceCriteria: ['Goal context is durable.'],
      requestedUpdates: ['goal.md', 'design.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      requestedUpdates: ['goal.md', 'design.md'],
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          requestedUpdates: ['goal.md', 'design.md'],
        }),
      ],
    })
  })

  test('accepts extra Goal-local requested update paths through the planning-request API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      requestedUpdates: ['goal.md', './notes//rollout.md', 'research.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      requestedUpdates: ['goal.md', 'notes/rollout.md', 'research.md'],
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          requestedUpdates: ['goal.md', 'notes/rollout.md', 'research.md'],
        }),
      ],
    })
  })

  test('accepts planning request group keys through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Clarify auth goal context',
      description: 'Coordinate auth follow-through across multiple planning tasks.',
      acceptanceCriteria: ['The grouped auth follow-through is durable.'],
      groupKey: 'auth-follow-through',
      groupTaskKey: 'goal-docs',
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      groupKey: 'auth-follow-through',
      groupTaskKey: 'goal-docs',
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
        }),
      ],
    })
  })

  test('creates more than one independent planning workflow through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-1', 'P-3'],
      createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
      createdTaskRefs: ['P-1', 'P-2', 'P-3'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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
  })

  test('applies workflow-root decision lineage and captured answers across every direct workflow child through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-1', 'PR-2', 'PR-3'],
      createdTaskRefs: ['P-1', 'P-2', 'P-3'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('reuses an existing planning surface as the first workflow through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const seedResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Draft auth goal context',
      description: 'Capture the current auth context before decomposition.',
      acceptanceCriteria: ['The current auth context is visible.'],
      requestedUpdates: ['goal.md'],
    })

    expect(seedResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-2', 'PR-3'],
      createdTaskRefs: ['P-2', 'P-3'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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
  })

  test('fans engineering blockers out to every current sink when direct workflow reuse happens through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const seedResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Draft auth goal context',
      description: 'Capture the current auth context before decomposition.',
      acceptanceCriteria: ['The current auth context is visible.'],
      requestedUpdates: ['goal.md'],
    })

    expect(seedResponse.status).toBe(201)

    const taskResponse = await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement auth integration',
      description: 'Wait for every workflow sink before engineering resumes.',
      acceptanceCriteria: ['The auth path is implemented.'],
      blockedBy: [{ kind: 'task', ref: 'P-1' }],
    })

    expect(taskResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      blockerTaskRefs: ['P-2', 'P-3'],
    })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
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

  test('extends an existing direct workflow batch through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const seedResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Draft auth goal context',
      description: 'Capture the current auth context before decomposition.',
      acceptanceCriteria: ['The current auth context is visible.'],
      requestedUpdates: ['goal.md'],
    })

    expect(seedResponse.status).toBe(201)

    const taskResponse = await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement auth integration',
      description: 'Wait for every workflow sink before engineering resumes.',
      acceptanceCriteria: ['The auth path is implemented.'],
      blockedBy: [{ kind: 'task', ref: 'P-1' }],
    })

    expect(taskResponse.status).toBe(201)

    const firstResponse = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(firstResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
      taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
      blockerTaskRefs: ['P-2', 'P-3', 'P-4'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
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

  test('reuses a direct workflow child through the API with a stable workflow task key', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(firstResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
          description: 'Inspect the current auth rollout workflow before handoff.',
          acceptanceCriteria: ['The auth rollout review is visible.'],
          requestedUpdates: ['design.md'],
        },
      ],
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
      taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
      blockerTaskRefs: ['P-1', 'P-3', 'P-4'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
      workflows: [
        expect.objectContaining({
          kind: 'planning',
          workflowTaskKey: 'rollout-notes',
          requestKeys: ['PR-1'],
          taskRefs: ['P-1'],
        }),
        expect.objectContaining({
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-2', 'PR-3'],
          taskRefs: ['P-2', 'P-3'],
        }),
        expect.objectContaining({
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-4'],
          taskRefs: ['P-4'],
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'rollout-notes',
          title: 'Prepare rollout readiness package',
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

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-1',
          title: 'Prepare rollout readiness package',
          acceptanceCriteria: ['The rollout readiness package is durable.'],
        }),
        expect.objectContaining({
          ref: 'P-4',
          title: 'Review auth rollout readiness',
        }),
      ]),
    )
  })

  test('keeps a direct workflow child blocked on the current sink of an upstream workflow child through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(firstResponse.status).toBe(201)
    await expect(firstResponse.json()).resolves.toMatchObject({
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
    })

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['rollout-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-4', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-4', 'P-3'],
      blockerTaskRefs: ['P-3'],
      createdRequestKeys: ['PR-4'],
      createdTaskRefs: ['P-4'],
      workflows: [
        expect.objectContaining({
          kind: 'planning_batch',
          groupKey: 'rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2', 'PR-4'],
          blockerTaskRefs: ['P-4'],
        }),
        expect.objectContaining({
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-3'],
          blockerTaskRefs: ['P-3'],
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
        }),
      ]),
    })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'task', ref: 'P-4' }],
        }),
        expect.objectContaining({
          ref: 'P-4',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    )
  })

  test('creates tasks through the API', async () => {
    const server = startServer()

    const createResponse = await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement atomic writes',
      description: 'Make writes safe.',
      acceptanceCriteria: ['Concurrent writes are safe.'],
      blockedBy: [],
    })

    expect(createResponse.status).toBe(201)
    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items).toEqual([
      {
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement atomic writes',
        description: 'Make writes safe.',
        acceptanceCriteria: ['Concurrent writes are safe.'],
        blockedBy: [],
      },
    ])
  })

  test('advances a task through reconcile', async () => {
    const server = startServer()
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through generator.',
      acceptanceCriteria: ['Task reaches review.'],
      blockedBy: [],
    })

    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})

    expect(reconcileResponse.status).toBe(200)
    await expect(reconcileResponse.json()).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items[0]).toMatchObject({ status: 'in_review' })
  })

  test('moves a task through the manual move API', async () => {
    const server = startServer()
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move manually.',
      acceptanceCriteria: ['Task moves.'],
      blockedBy: [],
    })

    const moveResponse = await postJson(server, '/api/goals/test/tasks/T-1/move', {
      status: 'in_review',
      reason: 'manual transition',
    })

    expect(moveResponse.status).toBe(200)
    const board = await readJson<TodoBoard>(moveResponse)
    expect(board.items[0]).toMatchObject({ status: 'in_review' })
  })

  test('lists and resolves Goal decisions through the API', async () => {
    const workspaceRoot = rootDir()
    const decisions = createDecisionStore(workspaceRoot)
    const created = await decisions.createDecision('test', {
      summary: 'Choose auth provider',
      taskRef: 'T-5',
    })

    const server = startServer(undefined, workspaceRoot)

    const listResponse = await fetch(apiUrl(server, '/api/goals/test/decisions'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      decisions: [
        {
          decisionKey: created.decisionKey,
          summary: 'Choose auth provider',
          status: 'open',
        },
      ],
    })

    const resolveResponse = await postJson(
      server,
      `/api/goals/test/decisions/${created.decisionKey}/resolve`,
      { answer: 'Use Bun-native sessions.' },
    )
    expect(resolveResponse.status).toBe(200)
    await expect(resolveResponse.json()).resolves.toMatchObject({
      decisionKey: created.decisionKey,
      status: 'resolved',
      answer: 'Use Bun-native sessions.',
    })
  })

  test('resolving a decision through the API immediately removes linked board blockers', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-4',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth decision.',
        acceptanceCriteria: ['The planning path is visible.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-4',
    })

    const server = startServer(undefined, workspaceRoot)
    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      { answer: 'Use Bun-native auth.' },
    )

    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-4',
          blockedBy: [],
        }),
      ],
    })
  })

  test('resolving an engineering decision through the API creates visible planner follow-through', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision before engineering continues.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      { answer: 'Use Bun-native auth.' },
    )

    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('resolving an engineering decision through the API accepts explicit follow-through metadata', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for the auth decision before engineering continues.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      {
        answer: 'Use Bun-native auth.',
        followThrough: {
          kind: 'planning',
          title: 'Capture auth answer in durable docs',
          description: 'Record the auth answer across Goal docs before engineering resumes.',
          acceptanceCriteria: ['The auth answer is durable before engineering resumes.'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md', 'todo.yml'],
        },
      },
    )

    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Capture auth answer in durable docs',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('resolving a planning-linked decision through the API reuses the current planning surface for explicit follow-through', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-8',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-8',
    })

    const server = startServer(undefined, workspaceRoot)
    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      {
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

    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-8',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-8',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
      ],
    })
  })

  test('resolving an unlinked decision through the API can create standalone planner follow-through', async () => {
    const workspaceRoot = rootDir()
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
    })

    const server = startServer(undefined, workspaceRoot)
    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/rollout-strategy/resolve',
      {
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

    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Capture rollout answer',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('records a durable answer through the API and opens grouped planner follow-through without a preexisting decision topic', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/decisions/answer', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      decisionKey: 'D-1',
      summary: 'Choose the rollout strategy',
      status: 'resolved',
      answer: 'Use a staged Bun-first rollout.',
    })
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
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
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'goal-docs',
          taskRef: 'P-1',
          decisionRefs: ['D-1'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'task-graph',
          taskRef: 'P-2',
          decisionRefs: ['D-1'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API and opens shared planner follow-through', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/decisions/answers', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      goalKey: 'test',
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
    })
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-7',
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
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('records multiple durable answers through the API and captures extra non-decision answers on follow-through', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/decisions/answers', {
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
    })

    expect(response.status).toBe(201)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('records a durable answer through the API and fans one answer out into multiple planner workflows', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/decisions/answer', {
      summary: 'Choose the auth strategy',
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      decisionKey: 'D-1',
      summary: 'Choose the auth strategy',
      status: 'resolved',
      answer: 'Use Bun-native auth.',
    })
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
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
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['D-1'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['D-1'],
          requestedUpdates: ['todo.yml'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['D-1'],
          requestedUpdates: ['notes/rollout.md'],
        }),
      ],
    })
  })

  test('resolving a decision through the API can create a durable workflow graph that later direct planning extends', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const taskResponse = await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-9',
      kind: 'engineering',
      title: 'Implement auth integration',
      description: 'Wait for the auth decision.',
      acceptanceCriteria: ['The auth path is implemented.'],
      blockedBy: [],
    })
    expect(taskResponse.status).toBe(201)

    const decisionResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-9',
    })
    expect(decisionResponse.status).toBe(201)

    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      {
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

    expect(resolveResponse.status).toBe(200)

    const extensionResponse = await postJson(
      server,
      '/api/goals/test/planning-requests/workflows',
      {
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

    expect(extensionResponse.status).toBe(201)
    await expect(extensionResponse.json()).resolves.toMatchObject({
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
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
          decisionRefs: ['auth-strategy'],
        }),
      ]),
    })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items).toEqual(
      expect.arrayContaining([
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
    )
  })

  test('creates and links Goal decisions through the API', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-3',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Clarify the auth path before decomposition.',
        acceptanceCriteria: ['The auth planning path is visible.'],
      }),
    ])

    const server = startServer(undefined, workspaceRoot)
    const planningResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Plan auth integration',
      description: 'Clarify the auth path before decomposition.',
      acceptanceCriteria: ['The auth planning path is visible.'],
    })
    expect(planningResponse.status).toBe(201)

    const createResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-3',
    })
    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      status: 'open',
      taskRef: 'P-3',
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      goalKey: 'test',
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          status: 'open',
          taskRef: 'P-3',
        }),
      ],
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          taskRef: 'P-3',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })
  })

  test('grouped planning requests gain shared decision lineage through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Clarify auth goal context',
      description: 'Refresh durable Goal context first.',
      acceptanceCriteria: ['Goal context is durable.'],
      groupKey: 'auth-follow-through',
      requestedUpdates: ['goal.md', 'design.md'],
    })
    expect(firstResponse.status).toBe(201)

    const secondResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Decompose auth task graph',
      description: 'Reshape todo.yml after the goal context is ready.',
      acceptanceCriteria: ['The auth task graph is visible.'],
      groupKey: 'auth-follow-through',
    })
    expect(secondResponse.status).toBe(201)

    const createDecisionResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-1',
    })
    expect(createDecisionResponse.status).toBe(201)

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('reads and updates repo preferences through the API', async () => {
    const workspaceRoot = rootDir()
    await createPreferenceStore(workspaceRoot).writePreferences(
      '# Preferences\n\n- Prefer deterministic workflows.\n',
    )

    const server = startServer(undefined, workspaceRoot)

    const beforeResponse = await fetch(apiUrl(server, '/api/preferences'))
    expect(beforeResponse.status).toBe(200)
    await expect(beforeResponse.json()).resolves.toMatchObject({
      content: '# Preferences\n\n- Prefer deterministic workflows.\n',
    })

    const updateResponse = await postJson(server, '/api/preferences', {
      content: '# Preferences\n\n- Prefer Bun-first APIs.\n- Keep Goal docs file-native.\n',
    })
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      content: '# Preferences\n\n- Prefer Bun-first APIs.\n- Keep Goal docs file-native.\n',
    })

    await expect(createPreferenceStore(workspaceRoot).readPreferences()).resolves.toMatchObject({
      content: '# Preferences\n\n- Prefer Bun-first APIs.\n- Keep Goal docs file-native.\n',
    })
  })

  test('reads the Goal assistant thread and appends a user message through the API', async () => {
    const workspaceRoot = rootDir()
    const threadStore = createAssistantThreadStore(workspaceRoot)
    await threadStore.appendEntry('test', {
      kind: 'assistant_message',
      content: 'Current blockers explained.',
    })

    const server = startServer(undefined, workspaceRoot)

    const beforeResponse = await fetch(apiUrl(server, '/api/goals/test/assistant/thread'))
    expect(beforeResponse.status).toBe(200)
    await expect(beforeResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      entries: [{ kind: 'assistant_message', content: 'Current blockers explained.' }],
    })

    const appendResponse = await postJson(server, '/api/goals/test/assistant/messages', {
      content: 'Please create planning work for auth.',
    })
    expect(appendResponse.status).toBe(201)
    await expect(appendResponse.json()).resolves.toMatchObject({
      kind: 'user_message',
      content: 'Please create planning work for auth.',
    })

    const afterResponse = await fetch(apiUrl(server, '/api/goals/test/assistant/thread'))
    await expect(afterResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      entries: [
        { kind: 'assistant_message', content: 'Current blockers explained.' },
        { kind: 'user_message', content: 'Please create planning work for auth.' },
      ],
    })
  })

  test('runs the configured Goal assistant and applies constrained durable actions', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-2',
        status: 'planned',
        title: 'Integrate the database',
        description: 'Pick the provider and plan the work.',
        acceptanceCriteria: ['The database provider is chosen.'],
        blockedBy: [{ kind: 'decision', ref: 'db-provider' }],
      }),
    ])
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('db-provider')) throw new Error('missing decision topic'); if (!prompt.includes('Use Postgres and create planning work.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'Use Postgres and create visible planning work.', actions: [{ kind: 'resolve_decision', decisionKey: 'db-provider', summary: 'Choose the database provider', taskRef: 'T-2', answer: 'Use Postgres.' }, { kind: 'request_planning', title: 'Plan database integration', description: 'Define the database adapter and migration work.', acceptanceCriteria: ['The database integration plan is visible in todo.yml.'], decisionRefs: ['db-provider'], requestedUpdates: ['design.md', 'todo.yml'] }, { kind: 'record_preference', summary: 'Prefer Bun-native services when they meet the Goal requirements.' }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use Postgres and create planning work.',
    })

    expect(response.status).toBe(200)
    const result = await readJson<{
      goalKey: string
      assistantRunId: string
      message: string
      events: Array<{ kind: string; role?: string; content?: string }>
      actionResults: Array<{
        kind: string
        taskRef?: string
        requestKey?: string
        decisionKey?: string
      }>
    }>(response)
    expect(result.goalKey).toBe('test')
    expect(result.assistantRunId).toBeString()
    expect(result.message).toBe('Use Postgres and create visible planning work.')
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message',
          role: 'assistant',
          content: 'assistant finished',
        }),
      ]),
    )
    expect(result.actionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'db-provider',
        }),
        expect.objectContaining({
          kind: 'request_planning',
          requestKey: 'PR-1',
          taskRef: 'P-1',
        }),
        expect.objectContaining({
          kind: 'record_preference',
        }),
      ]),
    )

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      goalKey: 'test',
      decisions: [
        {
          decisionKey: 'db-provider',
          status: 'resolved',
          answer: 'Use Postgres.',
          taskRef: 'T-2',
        },
      ],
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-1',
          kind: 'planning',
          status: 'planned',
          title: 'Plan database integration',
        }),
      ]),
    )
    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('requestKey: PR-1')
    await expect(
      Bun.file(
        join(workspaceRoot, '.hopi', 'docs', 'goals', 'test', 'planning-requests.yml'),
      ).text(),
    ).resolves.toContain('taskRef: P-1')
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          decisionRefs: ['db-provider'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })

    const thread = await createAssistantThreadStore(workspaceRoot).readThread('test')
    expect(thread.goalKey).toBe('test')
    expect(thread.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'user_message',
          content: 'Use Postgres and create planning work.',
        }),
        expect.objectContaining({
          kind: 'assistant_message',
          content: 'Use Postgres and create visible planning work.',
        }),
        expect.objectContaining({ kind: 'action', actionType: 'resolve_decision' }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'resolve_decision',
        }),
        expect.objectContaining({
          kind: 'action',
          actionType: 'request_planning',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'request_planning',
        }),
        expect.objectContaining({
          kind: 'action',
          actionType: 'record_preference',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'record_preference',
        }),
      ]),
    )

    await expect(
      Bun.file(
        join(
          workspaceRoot,
          '.hopi',
          'runtime',
          'goals',
          'test',
          'assistant',
          'runs',
          result.assistantRunId,
          'result.json',
        ),
      ).json(),
    ).resolves.toMatchObject({
      goalKey: 'test',
      assistantRunId: result.assistantRunId,
      requestContent: 'Use Postgres and create planning work.',
      message: 'Use Postgres and create visible planning work.',
      status: 'completed',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'db-provider',
        }),
        expect.objectContaining({
          kind: 'request_planning',
          taskRef: 'P-1',
        }),
        expect.objectContaining({
          kind: 'record_preference',
        }),
      ]),
    })

    const runsResponse = await fetch(apiUrl(server, '/api/goals/test/assistant/runs'))
    expect(runsResponse.status).toBe(200)
    await expect(runsResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      runs: [
        {
          assistantRunId: result.assistantRunId,
          status: 'completed',
          message: 'Use Postgres and create visible planning work.',
          actionCount: 3,
        },
      ],
    })

    const detailResponse = await fetch(
      apiUrl(server, `/api/goals/test/assistant/runs/${result.assistantRunId}`),
    )
    expect(detailResponse.status).toBe(200)
    await expect(detailResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      assistantRunId: result.assistantRunId,
      requestContent: 'Use Postgres and create planning work.',
      status: 'completed',
      message: 'Use Postgres and create visible planning work.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'db-provider',
        }),
        expect.objectContaining({
          kind: 'request_planning',
          taskRef: 'P-1',
        }),
        expect.objectContaining({
          kind: 'record_preference',
        }),
      ]),
    })
    const bundleResponse = await fetch(
      apiUrl(server, `/api/goals/test/assistant/runs/${result.assistantRunId}/bundle`),
    )
    expect(bundleResponse.status).toBe(200)
    await expect(bundleResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      assistantRunId: result.assistantRunId,
      context: {
        path: expect.stringContaining(`/assistant/runs/${result.assistantRunId}/context.md`),
        content: expect.stringContaining('Current decisions.yml'),
      },
      prompt: {
        path: expect.stringContaining(`/assistant/runs/${result.assistantRunId}/prompt.md`),
        content: expect.stringContaining('# HOPI Goal Assistant Prompt'),
      },
      outcome: {
        path: expect.stringContaining(`/assistant/runs/${result.assistantRunId}/outcome.json`),
        content: expect.stringContaining(
          '"message":"Use Postgres and create visible planning work."',
        ),
      },
      result: {
        path: expect.stringContaining(`/assistant/runs/${result.assistantRunId}/result.json`),
        content: expect.stringContaining('"assistantRunId"'),
      },
    })

    await expect(createPreferenceStore(workspaceRoot).readPreferences()).resolves.toMatchObject({
      content: expect.stringContaining(
        'Prefer Bun-native services when they meet the Goal requirements.',
      ),
    })
  })

  test('runs the configured Goal assistant and follows through with a visible decision request', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-7',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Clarify the auth integration plan.',
        acceptanceCriteria: ['The auth planning path is visible.'],
      }),
    ])
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Plan auth integration')) throw new Error('missing planning context'); if (!prompt.includes('We need one auth decision before planning can continue.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the visible planning task and opened one decision topic before planning continues.', actions: [{ kind: 'request_planning', title: 'Plan auth integration', description: 'Clarify the auth integration plan.', acceptanceCriteria: ['The auth planning path is visible.'] }, { kind: 'request_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', taskRef: 'P-7' }] })); console.log('assistant decision requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'We need one auth decision before planning can continue.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I reused the visible planning task and opened one decision topic before planning continues.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning',
          taskRef: 'P-7',
        }),
        expect.objectContaining({
          kind: 'request_decision',
          decisionKey: 'auth-strategy',
        }),
      ]),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          status: 'open',
          taskRef: 'P-7',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          taskRef: 'P-7',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['design.md', 'todo.yml'],
        }),
      ],
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          ref: 'P-7',
          blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
        }),
      ],
    })

    const thread = await createAssistantThreadStore(workspaceRoot).readThread('test')
    expect(thread.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'request_decision',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'request_decision',
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and creates grouped planning follow-through', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Split the auth planning work into durable stages.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I split the auth planning follow-through into two coordinated visible planning tasks.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] })); console.log('assistant grouped planning requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Split the auth planning work into durable stages.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I split the auth planning follow-through into two coordinated visible planning tasks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
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
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })

    const thread = await createAssistantThreadStore(workspaceRoot).readThread('test')
    expect(thread.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'request_planning_batch',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'request_planning_batch',
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and creates more than one independent planning workflow', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Open independent rollout and auth planning workflows.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I opened two independent durable planning workflows.', actions: [{ kind: 'request_planning_workflows', workflows: [{ kind: 'planning', title: 'Capture rollout notes', description: 'Record rollout details before more planning work continues.', acceptanceCriteria: ['Rollout notes are durable.'], decisionRefs: ['rollout-strategy'], answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers.' }], requestedUpdates: ['goal.md', 'notes/rollout.md'] }, { kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] }] })); console.log('assistant workflow batch requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Open independent rollout and auth planning workflows.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I opened two independent durable planning workflows.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          groupKeys: ['auth-follow-through'],
          requestKeys: ['PR-1', 'PR-2', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-3'],
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['rollout-strategy'],
          answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers.' }],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: [{ summary: 'Auth scope', answer: 'Support enterprise SSO first.' }],
        }),
      ],
    })

    const thread = await createAssistantThreadStore(workspaceRoot).readThread('test')
    expect(thread.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'request_planning_workflows',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'request_planning_workflows',
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and applies workflow-root shared context across direct workflow children', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Open one shared auth rollout workflow graph.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I opened one shared auth rollout workflow graph.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', decisionRefs: ['auth-strategy'], answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers before broader rollout.' }], workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['rollout-strategy'], answers: [{ summary: 'Rollback trigger', answer: 'Abort after two regressions.' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout workflow context across Goal docs.', acceptanceCriteria: ['The auth rollout context is durable.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth rollout workflow in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the shared auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] }] })); console.log('assistant shared workflow context requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Open one shared auth rollout workflow graph.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I opened one shared auth rollout workflow graph.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          workflowKey: 'auth-rollout-follow-through',
          groupKeys: ['auth-follow-through'],
          requestKeys: ['PR-1', 'PR-2', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-3'],
          blockerTaskRefs: ['P-2', 'P-3'],
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('runs the configured Goal assistant and reuses the current planning surface as the first workflow', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const planningRequests = createPlanningRequestStore(workspaceRoot)
    const boardStore = createBoardStore(workspaceRoot)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'test',
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Reuse the current planning surface and split it into independent workflows.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the current planning surface and opened two independent durable planning workflows.', actions: [{ kind: 'request_planning_workflows', reuseTaskRef: 'P-1', workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', title: 'Capture rollout notes', description: 'Record rollout details in parallel with auth planning.', acceptanceCriteria: ['Rollout notes are durable.'], decisionRefs: ['rollout-strategy'], requestedUpdates: ['notes/rollout.md'] }] }] })); console.log('assistant workflow batch reuse requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Reuse the current planning surface and split it into independent workflows.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I reused the current planning surface and opened two independent durable planning workflows.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          groupKeys: ['auth-follow-through'],
          requestKeys: ['PR-1', 'PR-2', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-3'],
          blockerTaskRefs: ['P-2', 'P-3'],
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          decisionRefs: ['rollout-strategy'],
        }),
      ],
    })

    const thread = await createAssistantThreadStore(workspaceRoot).readThread('test')
    expect(thread.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'request_planning_workflows',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'request_planning_workflows',
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and fans engineering blockers out to every reused workflow sink', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const planningRequests = createPlanningRequestStore(workspaceRoot)
    const boardStore = createBoardStore(workspaceRoot)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'test',
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
      }),
      task({
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for every workflow sink before engineering resumes.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      }),
    ])

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Reuse the current planning blocker and split it into independent workflows.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the current planning blocker and opened two independent durable planning workflows.', actions: [{ kind: 'request_planning_workflows', reuseTaskRef: 'P-1', workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', title: 'Capture rollout notes', description: 'Record rollout details in parallel with auth planning.', acceptanceCriteria: ['Rollout notes are durable.'], decisionRefs: ['rollout-strategy'], requestedUpdates: ['notes/rollout.md'] }] }] })); console.log('assistant workflow batch blocker propagation requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Reuse the current planning blocker and split it into independent workflows.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          blockerTaskRefs: ['P-2', 'P-3'],
        }),
      ]),
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
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

  test('runs the configured Goal assistant and extends an existing direct workflow batch', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const planningRequests = createPlanningRequestStore(workspaceRoot)
    const boardStore = createBoardStore(workspaceRoot)

    await requestGoalPlanning(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'test',
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
        requestedUpdates: ['goal.md'],
      },
    )

    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-1',
        kind: 'planning',
        status: 'planned',
        title: 'Draft auth goal context',
        description: 'Capture the current auth context before decomposition.',
        acceptanceCriteria: ['The current auth context is visible.'],
      }),
      task({
        ref: 'T-1',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for every workflow sink before engineering resumes.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'task', ref: 'P-1' }],
      }),
    ])

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Extend the existing auth rollout workflow with a final review step.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I extended the existing auth rollout workflow with one final review step.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning', title: 'Review auth rollout readiness', description: 'Inspect the current auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] }] })); console.log('assistant workflow batch extended'); process.exit(0); } if (prompt.includes('Reuse the current planning blocker and open the auth rollout workflow.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the current planning blocker and opened the auth rollout workflow.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', reuseTaskRef: 'P-1', workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', title: 'Capture rollout notes', description: 'Record rollout details in parallel with auth planning.', acceptanceCriteria: ['Rollout notes are durable.'], decisionRefs: ['rollout-strategy'], requestedUpdates: ['notes/rollout.md'] }] }] })); console.log('assistant workflow batch requested'); process.exit(0); } throw new Error('missing user message');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Reuse the current planning blocker and open the auth rollout workflow.',
    })
    expect(firstResponse.status).toBe(200)

    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Extend the existing auth rollout workflow with a final review step.',
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.message).toBe(
      'I extended the existing auth rollout workflow with one final review step.',
    )
    expect(responseBody.actionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          workflowKey: 'auth-rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
          taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
          blockerTaskRefs: ['P-2', 'P-3', 'P-4'],
        }),
      ]),
    )

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-4',
          workflowKey: 'auth-rollout-follow-through',
          title: 'Review auth rollout readiness',
        }),
      ]),
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
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

  test('runs the configured Goal assistant and reuses a direct workflow child through a stable workflow task key', async () => {
    const workspaceRoot = await initGitRepo(rootDir())

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Upgrade the rollout child and add one final review child.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I upgraded the rollout child and added a final review child.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning', workflowTaskKey: 'rollout-notes', title: 'Prepare rollout readiness package', description: 'Upgrade the rollout notes into a reusable readiness package.', acceptanceCriteria: ['The rollout readiness package is durable.'], requestedUpdates: ['notes/rollout.md', 'design.md'] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the current auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] }] })); console.log('assistant workflow child reused'); process.exit(0); } if (prompt.includes('Open the auth rollout workflow with one rollout child and one grouped auth child.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I opened the auth rollout workflow with one rollout child and one grouped auth child.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning', workflowTaskKey: 'rollout-notes', title: 'Capture rollout notes', description: 'Record rollout details before more planning work continues.', acceptanceCriteria: ['Rollout notes are durable.'], decisionRefs: ['rollout-strategy'], requestedUpdates: ['notes/rollout.md'] }, { kind: 'planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] }] })); console.log('assistant workflow child opened'); process.exit(0); } throw new Error('missing user message');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Open the auth rollout workflow with one rollout child and one grouped auth child.',
    })
    expect(firstResponse.status).toBe(200)

    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Upgrade the rollout child and add one final review child.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I upgraded the rollout child and added a final review child.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          workflowKey: 'auth-rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2', 'PR-3', 'PR-4'],
          taskRefs: ['P-1', 'P-2', 'P-3', 'P-4'],
          blockerTaskRefs: ['P-1', 'P-3', 'P-4'],
          workflows: [
            expect.objectContaining({
              kind: 'planning',
              workflowTaskKey: 'rollout-notes',
              requestKeys: ['PR-1'],
            }),
            expect.objectContaining({
              kind: 'planning_batch',
              groupKey: 'auth-follow-through',
              requestKeys: ['PR-2', 'PR-3'],
            }),
            expect.objectContaining({
              kind: 'planning',
              workflowTaskKey: 'handoff-review',
              requestKeys: ['PR-4'],
            }),
          ],
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'rollout-notes',
          title: 'Prepare rollout readiness package',
          requestedUpdates: ['notes/rollout.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
        }),
        expect.objectContaining({
          requestKey: 'PR-4',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          title: 'Review auth rollout readiness',
        }),
      ],
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-1',
          title: 'Prepare rollout readiness package',
        }),
        expect.objectContaining({
          ref: 'P-4',
          title: 'Review auth rollout readiness',
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and keeps a dependent workflow child wired to the current upstream sink', async () => {
    const workspaceRoot = await initGitRepo(rootDir())

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Extend the rollout child with a final stage before review.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I extended the rollout child with a final stage before review.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'finalize-plan', title: 'Finalize rollout plan', description: 'Add the final rollout stage before handoff review.', acceptanceCriteria: ['The rollout plan is finalized.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['validate-plan'] }] }] }] })); console.log('assistant workflow dependency extended'); process.exit(0); } if (prompt.includes('Open the rollout workflow with a dependent review child.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I opened the rollout workflow with a dependent review child.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'capture-notes', title: 'Capture rollout notes', description: 'Record rollout details before review.', acceptanceCriteria: ['Rollout notes are durable.'], requestedUpdates: ['notes/rollout.md'] }, { taskKey: 'validate-plan', title: 'Validate rollout plan', description: 'Check the rollout notes before handoff review.', acceptanceCriteria: ['The rollout plan is validated.'], requestedUpdates: ['design.md'], blockedByTaskKeys: ['capture-notes'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the rollout workflow after the rollout child finishes.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'], blockedByWorkflowKeys: ['rollout-follow-through'] }] }] })); console.log('assistant workflow dependency opened'); process.exit(0); } throw new Error('missing user message');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Open the rollout workflow with a dependent review child.',
    })
    expect(firstResponse.status).toBe(200)

    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Extend the rollout child with a final stage before review.',
    })

    expect(response.status).toBe(200)
    const dependentResponseBody = await response.json()
    expect(dependentResponseBody.message).toBe(
      'I extended the rollout child with a final stage before review.',
    )
    expect(dependentResponseBody.actionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
          workflowKey: 'auth-rollout-follow-through',
          requestKeys: ['PR-1', 'PR-2', 'PR-4', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-4', 'P-3'],
          blockerTaskRefs: ['P-3'],
          workflows: [
            expect.objectContaining({
              kind: 'planning_batch',
              groupKey: 'rollout-follow-through',
              requestKeys: ['PR-1', 'PR-2', 'PR-4'],
              blockerTaskRefs: ['P-4'],
            }),
            expect.objectContaining({
              kind: 'planning',
              workflowTaskKey: 'handoff-review',
              requestKeys: ['PR-3'],
              blockerTaskRefs: ['P-3'],
            }),
          ],
        }),
      ]),
    )

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
        }),
      ]),
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'task', ref: 'P-4' }],
        }),
        expect.objectContaining({
          ref: 'P-4',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and resolves a decision into grouped planning follow-through', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for planner follow-through before engineering continues.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use Bun-native auth and split the follow-through.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the auth decision and split the durable planning follow-through into two visible stages.', actions: [{ kind: 'resolve_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', taskRef: 'T-7', answer: 'Use Bun-native auth.', followThrough: { kind: 'planning_batch', groupKey: 'auth-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context and rollout notes before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the auth context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use Bun-native auth and split the follow-through.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the auth decision and split the durable planning follow-through into two visible stages.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'auth-strategy',
          followThroughGroupKeys: ['auth-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-7',
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
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          taskRef: 'P-1',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          taskRef: 'P-2',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses the current planning task for planning-linked decision follow-through', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-8',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth answer before planning continues.',
        acceptanceCriteria: ['Planning continues after the auth answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for planner follow-through before engineering continues.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-8',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use Bun-native auth and turn the current planning task into staged follow-through.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the auth decision and reused the current planning task as the first planner stage.', actions: [{ kind: 'resolve_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', taskRef: 'P-8', answer: 'Use Bun-native auth.', followThrough: { kind: 'planning_batch', groupKey: 'auth-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context and rollout notes after the auth answer.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the auth context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use Bun-native auth and turn the current planning task into staged follow-through.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the auth decision and reused the current planning task as the first planner stage.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'auth-strategy',
          followThroughGroupKeys: ['auth-follow-through'],
          followThroughTaskRefs: ['P-8', 'P-9'],
        }),
      ]),
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-8',
          title: 'Clarify auth goal context',
          blockedBy: [],
        }),
        expect.objectContaining({
          ref: 'P-9',
          title: 'Decompose auth task graph',
          blockedBy: [{ kind: 'task', ref: 'P-8' }],
        }),
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-9' }],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          taskRef: 'P-8',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          taskRef: 'P-9',
          decisionRefs: ['auth-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and creates planner follow-through for a newly answered standalone decision', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Record the rollout answer and open planner follow-through.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded the rollout answer as a durable decision and opened visible planner follow-through.', actions: [{ kind: 'resolve_decision', decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answer: 'Use a staged Bun-first rollout.', followThrough: { kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Capture rollout answer', description: 'Record the rollout answer across Goal docs and rollout notes.', acceptanceCriteria: ['The rollout answer is durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose rollout task graph', description: 'Reflect the rollout answer in todo.yml before execution continues.', acceptanceCriteria: ['The rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Record the rollout answer and open planner follow-through.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I recorded the rollout answer as a durable decision and opened visible planner follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolve_decision',
          decisionKey: 'rollout-strategy',
          followThroughGroupKeys: ['rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          status: 'resolved',
          answer: 'Use a staged Bun-first rollout.',
        }),
      ],
    })
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
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
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'goal-docs',
          taskRef: 'P-1',
          decisionRefs: ['rollout-strategy'],
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'rollout-follow-through',
          groupTaskKey: 'task-graph',
          taskRef: 'P-2',
          decisionRefs: ['rollout-strategy'],
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and records an answer-first durable workflow before any explicit decision key exists', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Record the rollout answer before any explicit decision topic exists.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded the rollout answer as a new durable decision and opened grouped planner follow-through.', actions: [{ kind: 'record_answer', summary: 'Choose the rollout strategy', answer: 'Use a staged Bun-first rollout.', followThrough: { kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Capture rollout answer', description: 'Record the rollout answer across Goal docs and rollout notes.', acceptanceCriteria: ['The rollout answer is durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose rollout task graph', description: 'Reflect the rollout answer in todo.yml before execution continues.', acceptanceCriteria: ['The rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Record the rollout answer before any explicit decision topic exists.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I recorded the rollout answer as a new durable decision and opened grouped planner follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answer',
          decisionKey: 'D-1',
          followThroughGroupKeys: ['rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Choose the rollout strategy',
          status: 'resolved',
          answer: 'Use a staged Bun-first rollout.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'rollout-follow-through',
          decisionRefs: ['D-1'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'rollout-follow-through',
          decisionRefs: ['D-1'],
        }),
      ],
    })
    await expect(
      createAssistantThreadStore(workspaceRoot).readThread('test'),
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'record_answer',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'record_answer',
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and fans one answer out into multiple independent planner workflows', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use Bun-native auth and open more than one planner workflow.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded the auth answer and opened two independent planner workflows.', actions: [{ kind: 'record_answer', summary: 'Choose the auth strategy', answer: 'Use Bun-native auth.', followThrough: { kind: 'workflow_batch', workflows: [{ kind: 'planning', title: 'Capture auth answer', description: 'Record the auth answer across Goal docs before execution resumes.', acceptanceCriteria: ['The auth answer is durable in Goal docs.'], requestedUpdates: ['goal.md', 'design.md'] }, { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', requests: [{ taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reflect the auth answer in todo.yml.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'] }, { taskKey: 'rollout-notes', title: 'Capture auth rollout notes', description: 'Record rollout notes after the task graph is visible.', acceptanceCriteria: ['The auth rollout notes are durable.'], requestedUpdates: ['notes/rollout.md'], blockedByTaskKeys: ['task-graph'] }] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use Bun-native auth and open more than one planner workflow.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I recorded the auth answer and opened two independent planner workflows.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answer',
          decisionKey: 'D-1',
          followThroughGroupKeys: ['auth-rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2', 'P-3'],
        }),
      ]),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Choose the auth strategy',
          status: 'resolved',
          answer: 'Use Bun-native auth.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          decisionRefs: ['D-1'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['D-1'],
          requestedUpdates: ['todo.yml'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['D-1'],
          requestedUpdates: ['notes/rollout.md'],
        }),
      ],
    })
    await expect(
      createAssistantThreadStore(workspaceRoot).readThread('test'),
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'record_answer',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'record_answer',
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and creates a durable decision-backed workflow graph that later planning extends', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Extend the durable auth workflow with a final rollout stage.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I extended the durable auth workflow with a final rollout stage.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'finalize-plan', title: 'Finalize rollout plan', description: 'Add the final rollout stage before handoff review.', acceptanceCriteria: ['The rollout plan is finalized.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['validate-plan'] }] }] }] })); console.log('assistant workflow extended'); process.exit(0); } if (!prompt.includes('Use Bun-native auth and open one durable workflow graph.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded the auth answer and opened one durable workflow graph.', actions: [{ kind: 'record_answer', summary: 'Choose the auth strategy', answer: 'Use Bun-native auth.', followThrough: { kind: 'workflow_batch', workflowKey: 'auth-rollout-follow-through', workflows: [{ kind: 'planning_batch', groupKey: 'rollout-follow-through', requests: [{ taskKey: 'capture-notes', title: 'Capture rollout notes', description: 'Record rollout details before review.', acceptanceCriteria: ['Rollout notes are durable.'], requestedUpdates: ['notes/rollout.md'] }, { taskKey: 'validate-plan', title: 'Validate rollout plan', description: 'Check the rollout notes before handoff review.', acceptanceCriteria: ['The rollout plan is validated.'], requestedUpdates: ['design.md'], blockedByTaskKeys: ['capture-notes'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the rollout workflow after the rollout child finishes.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'], blockedByWorkflowKeys: ['rollout-follow-through'] }] } }] })); console.log('assistant finished');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const firstResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use Bun-native auth and open one durable workflow graph.',
    })

    expect(firstResponse.status).toBe(200)
    await expect(firstResponse.json()).resolves.toMatchObject({
      message: 'I recorded the auth answer and opened one durable workflow graph.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answer',
          decisionKey: 'D-1',
          followThroughGroupKeys: ['rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2', 'P-3'],
        }),
      ]),
    })

    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Extend the durable auth workflow with a final rollout stage.',
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.message).toBe(
      'I extended the durable auth workflow with a final rollout stage.',
    )
    expect(responseBody.actionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_workflows',
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
        }),
      ]),
    )

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: expect.arrayContaining([
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: ['rollout-follow-through'],
          decisionRefs: ['D-1'],
        }),
      ]),
    })

    const board = await createBoardStore(workspaceRoot).readBoard('test')
    expect(board.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          blockedBy: [{ kind: 'task', ref: 'P-4' }],
        }),
        expect.objectContaining({
          ref: 'P-4',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    )
  })

  test('runs the configured Goal assistant and records multiple durable answers into shared planner follow-through', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve both auth and rollout answers in one move.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded both answers and opened shared planner follow-through.', actions: [{ kind: 'record_answers', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', answer: 'Use Bun-native auth.' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answer: 'Use a staged rollout.' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Resolve both auth and rollout answers in one move.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I recorded both answers and opened shared planner follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          followThroughGroupKeys: ['auth-rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
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
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          taskRef: 'P-1',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
        }),
      ],
    })
    await expect(
      createAssistantThreadStore(workspaceRoot).readThread('test'),
    ).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: 'action',
          actionType: 'record_answers',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'record_answers',
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and mixes decision answers with captured non-decision follow-through answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth and rollout decisions before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [
          { kind: 'decision', ref: 'auth-strategy' },
          { kind: 'decision', ref: 'rollout-strategy' },
        ],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve both auth and rollout answers, and keep the pilot scope durable.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded both decisions and kept the pilot scope on the durable planner follow-through.', actions: [{ kind: 'record_answers', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', answer: 'Use Bun-native auth.' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answer: 'Use a staged rollout.' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers before wider rollout.' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Resolve both auth and rollout answers, and keep the pilot scope durable.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I recorded both decisions and kept the pilot scope on the durable planner follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          followThroughGroupKeys: ['auth-rollout-follow-through'],
          followThroughTaskRefs: ['P-1', 'P-2'],
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and enriches grouped planning requests with one decision', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Split the auth planning work and capture one missing decision.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I split the planning work and linked one auth decision across the grouped follow-through.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'request_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', taskRef: 'P-1' }] })); console.log('assistant grouped decision requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Split the auth planning work and capture one missing decision.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I split the planning work and linked one auth decision across the grouped follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_batch',
          groupKey: 'auth-follow-through',
        }),
        expect.objectContaining({
          kind: 'request_decision',
          decisionKey: 'auth-strategy',
        }),
      ]),
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('runs the configured Goal assistant and extends an existing grouped planning follow-through', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Add one grouped planning review step after the task graph.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I added one later grouped planning review step after the task graph stage.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'review-pass', title: 'Review auth planning follow-through', description: 'Inspect the grouped planning artifacts before handoff.', acceptanceCriteria: ['The grouped planning review is visible.'], requestedUpdates: ['design.md'], blockedByTaskKeys: ['task-graph'] }] }] })); console.log('assistant grouped planning extended'); process.exit(0); } if (prompt.includes('Split the auth planning work into durable stages.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I split the auth planning follow-through into two coordinated visible planning tasks.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] })); console.log('assistant grouped planning requested'); process.exit(0); } throw new Error('missing user message');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)

    const initialResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Split the auth planning work into durable stages.',
    })
    expect(initialResponse.status).toBe(200)

    const extensionResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Add one grouped planning review step after the task graph.',
    })

    expect(extensionResponse.status).toBe(200)
    await expect(extensionResponse.json()).resolves.toMatchObject({
      message: 'I added one later grouped planning review step after the task graph stage.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
        }),
      ]),
    })

    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'P-3',
          title: 'Review auth planning follow-through',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
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

  test('grouped planning extension keeps engineering blocked on the current grouped tail through the API path', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth integration',
        description: 'Wait for planner follow-through before engineering continues.',
        acceptanceCriteria: ['The auth path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (prompt.includes('Add one grouped planning review step after the task graph.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I added one later grouped planning review step after the task graph stage.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'review-pass', title: 'Review auth planning follow-through', description: 'Inspect the grouped planning artifacts before handoff.', acceptanceCriteria: ['The grouped planning review is visible.'], requestedUpdates: ['design.md'], blockedByTaskKeys: ['task-graph'] }] }] })); console.log('assistant grouped planning extended'); process.exit(0); } if (prompt.includes('Split the auth planning work into durable stages.')) { await Bun.write(outcomeFile, JSON.stringify({ message: 'I split the auth planning follow-through into two coordinated visible planning tasks.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] })); console.log('assistant grouped planning requested'); process.exit(0); } throw new Error('missing user message');",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)

    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-strategy/resolve',
      { answer: 'Use Bun-native auth.' },
    )
    expect(resolveResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-1' }],
        }),
      ]),
    })

    const initialResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Split the auth planning work into durable stages.',
    })
    expect(initialResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-2' }],
        }),
      ]),
    })

    const extensionResponse = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Add one grouped planning review step after the task graph.',
    })
    expect(extensionResponse.status).toBe(200)
    await expect(createBoardStore(workspaceRoot).readBoard('test')).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          ref: 'T-7',
          blockedBy: [{ kind: 'task', ref: 'P-3' }],
        }),
      ]),
    })
  })

  test('accepts custom Goal-local requested update paths from assistant planning actions', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Capture rollout notes before planning continues.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I created one planning follow-through request with durable rollout notes.', actions: [{ kind: 'request_planning', title: 'Capture rollout notes', description: 'Record rollout details before more planning work continues.', acceptanceCriteria: ['Rollout notes are durable.'], answers: [{ summary: 'Rollout note', answer: 'Gate the first rollout behind pilot feedback.' }], requestedUpdates: ['goal.md', 'notes/rollout.md'] }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Capture rollout notes before planning continues.',
    })

    expect(response.status).toBe(200)
    const result = await readJson<{
      actionResults: Array<{ kind: string; requestKey?: string; taskRef?: string }>
    }>(response)
    expect(result.actionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning',
          requestKey: 'PR-1',
          taskRef: 'P-1',
        }),
      ]),
    )

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: [
            { summary: 'Rollout note', answer: 'Gate the first rollout behind pilot feedback.' },
          ],
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
        }),
      ],
    })
  })

  test('a resolved decision leaves linked planning work dispatchable on the next reconcile', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [
      task({
        ref: 'P-8',
        kind: 'planning',
        status: 'planned',
        title: 'Plan auth integration',
        description: 'Wait for the auth decision before planning continues.',
        acceptanceCriteria: ['Planning continues after the decision answer.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      taskRef: 'P-8',
    })

    const server = startServer(undefined, workspaceRoot)
    await postJson(server, '/api/goals/test/decisions/auth-strategy/resolve', {
      answer: 'Use Bun-native auth.',
    })

    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})
    expect(reconcileResponse.status).toBe(200)
    await expect(reconcileResponse.json()).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'P-8',
      from: 'planned',
      to: 'in_review',
    })
  })

  test('returns HTTP 400 for invalid request bodies', async () => {
    const server = startServer()

    const response = await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid request body' })
  })

  test('returns HTTP 500 for system errors without mutating task state', async () => {
    const runner: AgentRunner = {
      async run() {
        throw new Error('adapter exploded')
      },
    }
    const server = startServer(runner)
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through generator.',
      acceptanceCriteria: ['Task reaches review.'],
      blockedBy: [],
    })

    const response = await postJson(server, '/api/goals/test/reconcile', {})

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'Internal server error' })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items[0]).toMatchObject({ status: 'planned' })

    const events = await Bun.file(
      join(rootDir(), '.hopi', 'docs', 'goals', 'test', 'events.jsonl'),
    ).text()
    expect(events).toContain('"action":"system_error"')
    expect(events).toContain('adapter exploded')
  })

  test('returns run summaries and run details for reconciled work', async () => {
    const runner: AgentRunner = {
      async run(input, observer) {
        await observer?.onEvent?.({
          kind: 'worktree_prepared',
          path: `.hopi/worktrees/${input.taskRef}`,
          branch: `task/${input.taskRef}`,
          baseBranch: 'main',
        })
        await observer?.onEvent?.({
          kind: 'message',
          level: 'info',
          role: input.role,
          content: 'Generated patch for review',
        })
        await observer?.onEvent?.({
          kind: 'artifact',
          ref: `patch:${input.taskRef}`,
          label: 'Generated patch',
        })
        return { kind: 'success', artifactRef: `patch:${input.taskRef}` }
      },
    }
    const server = startServer(runner)
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through generator.',
      acceptanceCriteria: ['Task reaches review.'],
      blockedBy: [],
    })

    await postJson(server, '/api/goals/test/reconcile', {})

    const runsResponse = await fetch(apiUrl(server, '/api/goals/test/runs'))
    expect(runsResponse.status).toBe(200)

    const runs = await readJson<{
      goalKey: string
      runs: Array<{ runId: string; taskRef: string; status: string; stepCount: number }>
    }>(runsResponse)
    expect(runs.goalKey).toBe('test')
    expect(runs.runs).toHaveLength(1)
    const firstRun = runs.runs[0]
    if (!firstRun) {
      throw new Error('Expected first run')
    }

    expect(firstRun).toMatchObject({
      taskRef: 'T-1',
      status: 'active',
      stepCount: 1,
    })

    const detailResponse = await fetch(apiUrl(server, `/api/goals/test/runs/${firstRun.runId}`))
    expect(detailResponse.status).toBe(200)
    await expect(detailResponse.json()).resolves.toMatchObject({
      runId: firstRun.runId,
      taskRef: 'T-1',
      steps: [
        {
          role: 'generator',
          statusBefore: 'planned',
          statusAfter: 'in_review',
          outcome: 'success',
          execution: {
            worktree: {
              path: '.hopi/worktrees/T-1',
              branch: 'task/T-1',
              baseBranch: 'main',
            },
            artifacts: [{ ref: 'patch:T-1', label: 'Generated patch' }],
          },
          messages: [
            { kind: 'system', role: 'system', content: 'generator dispatched for T-1' },
            { kind: 'info', role: 'generator', content: 'Generated patch for review' },
            { kind: 'system', role: 'system', content: 'T-1 advanced to in_review' },
          ],
        },
      ],
    })
  })

  test('serves ProcessAgentRunner execution evidence through the API', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const runner = new ProcessAgentRunner({
      rootDir: workspaceRoot,
      worktrees: createWorktreeManager(workspaceRoot),
      resolveCommand(input) {
        return {
          cmd: [
            'bun',
            '-e',
            `await Bun.write('generated.txt', 'Generated patch for ${input.taskRef}'); console.log('Generated patch for ${input.taskRef}')`,
          ],
          cwdMode: 'worktree',
          successArtifactRef: `patch:${input.taskRef}`,
          successArtifactLabel: 'Generated patch',
        }
      },
    })
    const server = startServer(runner)
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through generator.',
      acceptanceCriteria: ['Task reaches review.'],
      blockedBy: [],
    })

    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})
    expect(reconcileResponse.status).toBe(200)

    const runsResponse = await fetch(apiUrl(server, '/api/goals/test/runs'))
    const runs = await readJson<{
      goalKey: string
      runs: Array<{ runId: string }>
    }>(runsResponse)
    const firstRun = runs.runs[0]
    if (!firstRun) {
      throw new Error('Expected first run')
    }

    const detailResponse = await fetch(apiUrl(server, `/api/goals/test/runs/${firstRun.runId}`))
    expect(detailResponse.status).toBe(200)
    const detail = await detailResponse.json()
    const execution = detail.steps?.[0]?.execution
    expect(execution).toMatchObject({
      artifacts: [{ ref: 'patch:T-1', label: 'Generated patch' }],
    })
    expect(detail.steps?.[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'info',
          role: 'generator',
          content: 'Generated patch for T-1',
        }),
      ]),
    )

    const worktreePath = execution?.worktree?.path
    expect(worktreePath).toBeString()
    expect(worktreePath).toContain('.hopi/worktrees/test/T-1/')
    if (!worktreePath) {
      throw new Error('Expected worktree path')
    }
    expect(await pathExists(worktreePath)).toBeTrue()
    await expect(createWriteTraceStore(workspaceRoot).readGoalTrace('test')).resolves.toMatchObject(
      {
        goalKey: 'test',
        entries: [
          {
            taskRef: 'T-1',
            role: 'generator',
            targetPaths: ['generated.txt'],
            changes: [{ path: 'generated.txt', kind: 'added' }],
            resultSummary: 'exit 0 (1 changed file)',
          },
        ],
      },
    )
  })

  test('uses configured role adapters as the default runner when adapter config exists', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      roles: {
        generator: {
          cmd: [
            'bun',
            '-e',
            "const [contextFile, outcomeFile] = process.argv.slice(1); const context = await Bun.file(contextFile).text(); await Bun.write('generated.txt', context); await Bun.write(outcomeFile, JSON.stringify({ kind: 'success', artifactRef: 'patch:T-1', artifactLabel: 'Generated patch' }));",
            '${CONTEXT_FILE}',
            '${OUTCOME_FILE}',
          ],
          cwdMode: 'worktree',
        },
      },
    })

    const server = startServer(undefined, workspaceRoot)
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through configured generator.',
      acceptanceCriteria: ['Task reaches review through configured adapters.'],
      blockedBy: [],
    })

    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})
    expect(reconcileResponse.status).toBe(200)
    await expect(reconcileResponse.json()).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-1',
      from: 'planned',
      to: 'in_review',
    })

    const runsResponse = await fetch(apiUrl(server, '/api/goals/test/runs'))
    const runs = await readJson<{ runs: Array<{ runId: string }> }>(runsResponse)
    const firstRun = runs.runs[0]
    if (!firstRun) {
      throw new Error('Expected first configured run')
    }

    const detailResponse = await fetch(apiUrl(server, `/api/goals/test/runs/${firstRun.runId}`))
    await expect(detailResponse.json()).resolves.toMatchObject({
      taskRef: 'T-1',
      steps: [
        {
          role: 'generator',
          statusAfter: 'in_review',
          outcome: 'success',
          execution: {
            artifacts: [{ ref: 'patch:T-1', label: 'Generated patch' }],
          },
        },
      ],
    })

    await expect(createWriteTraceStore(workspaceRoot).readGoalTrace('test')).resolves.toMatchObject(
      {
        goalKey: 'test',
        entries: [
          {
            taskRef: 'T-1',
            targetPaths: ['generated.txt'],
          },
        ],
      },
    )
  })

  test('returns normalized transcript entries on run detail for built-in codex transports', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const mockCodexPath = join(workspaceRoot, 'mock-codex')
    await writeFile(
      mockCodexPath,
      `#!/usr/bin/env bun
console.log(JSON.stringify({
  method: 'item/completed',
  params: { item: { type: 'agent_message', text: 'Implemented the server patch.' } },
}))
console.log(JSON.stringify({
  method: 'item/completed',
  params: { item: { type: 'local_shell_call', tool_name: 'Bash' } },
}))
await Bun.write(
  process.env.HOPI_OUTCOME_FILE!,
  JSON.stringify({ kind: 'success', artifactRef: 'patch:T-1', artifactLabel: 'Codex patch' }),
)
`,
      'utf8',
    )
    await chmod(mockCodexPath, 0o755)

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      roles: {
        generator: {
          transport: 'codex',
          binary: mockCodexPath,
          cwdMode: 'worktree',
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        },
      },
    })

    const server = startServer(undefined, workspaceRoot)
    await postJson(server, '/api/goals/test/tasks', {
      ref: 'T-1',
      kind: 'engineering',
      title: 'Implement task',
      description: 'Move through built-in codex transport.',
      acceptanceCriteria: ['Task reaches review with transcript history.'],
      blockedBy: [],
    })

    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})
    expect(reconcileResponse.status).toBe(200)

    const runsResponse = await fetch(apiUrl(server, '/api/goals/test/runs'))
    const runs = await readJson<{
      goalKey: string
      runs: Array<{ runId: string }>
    }>(runsResponse)
    const firstRun = runs.runs[0]
    if (!firstRun) {
      throw new Error('Expected first run')
    }

    const detailResponse = await fetch(apiUrl(server, `/api/goals/test/runs/${firstRun.runId}`))
    expect(detailResponse.status).toBe(200)
    await expect(detailResponse.json()).resolves.toMatchObject({
      runId: firstRun.runId,
      steps: [
        {
          role: 'generator',
          transcript: [
            {
              transport: 'codex',
              kind: 'assistant',
              summary: 'Implemented the server patch.',
              vendorEventType: 'item/completed',
            },
            {
              transport: 'codex',
              kind: 'tool_call',
              toolName: 'Bash',
              summary: 'Tool call: Bash',
              vendorEventType: 'item/completed',
            },
          ],
        },
      ],
    })
  })

  test('returns filtered durable write traces through the API', async () => {
    const workspaceRoot = rootDir()
    const traces = createWriteTraceStore(workspaceRoot)
    await traces.appendEntry('test', {
      runId: 'run-1',
      stepId: 'step-1',
      taskRef: 'T-1',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/1',
      toolName: 'process',
      callId: 'step-1',
      targetPaths: ['a.ts'],
      changes: [{ path: 'a.ts', kind: 'added' }],
      argumentSummary: 'cmd 1',
      resultSummary: 'exit 0 (1 changed file)',
    })
    await traces.appendEntry('test', {
      runId: 'run-1',
      stepId: 'step-2',
      taskRef: 'T-1',
      role: 'reviewer',
      agent: 'process_runner',
      cwd: '/tmp/2',
      toolName: 'process',
      callId: 'step-2',
      targetPaths: ['b.ts'],
      changes: [{ path: 'b.ts', kind: 'modified' }],
      argumentSummary: 'cmd 2',
      resultSummary: 'exit 0 (1 changed file)',
    })
    await traces.appendEntry('test', {
      runId: 'run-2',
      stepId: 'step-3',
      taskRef: 'T-9',
      role: 'generator',
      agent: 'process_runner',
      cwd: '/tmp/3',
      toolName: 'process',
      callId: 'step-3',
      targetPaths: ['c.ts'],
      changes: [{ path: 'c.ts', kind: 'deleted' }],
      argumentSummary: 'cmd 3',
      resultSummary: 'exit 0 (1 changed file)',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await fetch(
      apiUrl(server, '/api/goals/test/write-traces?runId=run-1&role=reviewer&limit=1'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      goalKey: 'test',
      entries: [
        {
          runId: 'run-1',
          stepId: 'step-2',
          role: 'reviewer',
          targetPaths: ['b.ts'],
        },
      ],
    })
  })

  test('executes a real configured merger flow through the API before marking work done', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await seedBoard(workspaceRoot, [task({ ref: 'T-9', status: 'merging' })])
    const history = createRunHistoryStore(workspaceRoot)
    const runId = await seedActiveMergingRun(history, 'T-9')
    const worktrees = createWorktreeManager(workspaceRoot)
    const prepared = await worktrees.prepare({
      goalKey: 'test',
      taskRef: 'T-9',
      runId,
    })

    await writeFile(join(prepared.path, 'merged.txt'), 'server merged output\n', 'utf8')
    await git(prepared.path, ['add', 'merged.txt'])
    await git(prepared.path, ['commit', '-m', 'merge candidate'])

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      roles: {
        merger: {
          cmd: [
            'bun',
            '-e',
            "const [, outcomeFile] = process.argv.slice(1); await Bun.write(outcomeFile, JSON.stringify({ kind: 'success' }));",
            '${CONTEXT_FILE}',
            '${OUTCOME_FILE}',
          ],
          cwdMode: 'root',
        },
      },
    })

    const server = startServer(undefined, workspaceRoot)
    const reconcileResponse = await postJson(server, '/api/goals/test/reconcile', {})
    expect(reconcileResponse.status).toBe(200)
    await expect(reconcileResponse.json()).resolves.toEqual({
      kind: 'advanced',
      taskRef: 'T-9',
      from: 'merging',
      to: 'done',
    })

    const boardResponse = await fetch(apiUrl(server, '/api/goals/test/board'))
    const board = await readJson<TodoBoard>(boardResponse)
    expect(board.items[0]).toMatchObject({ ref: 'T-9', status: 'done' })
    expect(await Bun.file(join(workspaceRoot, 'merged.txt')).text()).toBe('server merged output\n')
    expect(await pathExists(prepared.path)).toBeFalse()
  })

  test('returns HTTP 404 for an unknown run id', async () => {
    const server = startServer()

    const response = await fetch(apiUrl(server, '/api/goals/test/runs/run-missing'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'Run not found: run-missing' })
  })
})

function startServer(runner?: AgentRunner, customRootDir?: string) {
  const server = createServer({ rootDir: customRootDir ?? rootDir(), port: 0, runner })
  servers.push(server)
  return server
}

function rootDir() {
  return join(tmpBase, 'workspace')
}

async function initGitRepo(rootDir: string) {
  await mkdir(rootDir, { recursive: true })
  await git(rootDir, ['init'])
  await git(rootDir, ['config', 'user.name', 'HOPI Tests'])
  await git(rootDir, ['config', 'user.email', 'hopi@example.com'])
  await writeFile(join(rootDir, 'README.md'), '# test repo\n', 'utf8')
  await git(rootDir, ['add', 'README.md'])
  await git(rootDir, ['commit', '-m', 'init'])
  return rootDir
}

function apiUrl(server: ReturnType<typeof createServer>, path: string) {
  return `http://127.0.0.1:${server.port}${path}`
}

async function postJson(server: ReturnType<typeof createServer>, path: string, body: unknown) {
  return fetch(apiUrl(server, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

async function writeAdapterConfig(rootDir: string, config: unknown) {
  await mkdir(join(rootDir, '.hopi', 'runtime'), { recursive: true })
  await Bun.write(
    join(rootDir, '.hopi', 'runtime', 'agent-adapters.json'),
    `${JSON.stringify(config, null, 2)}\n`,
  )
}

async function seedBoard(rootDir: string, items: TaskItem[]) {
  const store = createBoardStore(rootDir)
  await store.mutateBoard('test', 'test', 'seed board', (board) => {
    board.goal.title = 'Test Goal'
    board.items = items
  })
}

async function seedActiveMergingRun(
  history: ReturnType<typeof createRunHistoryStore>,
  taskRef: string,
) {
  const generated = await history.startStep({
    goalKey: 'test',
    taskRef,
    taskKind: 'engineering',
    role: 'generator',
    statusBefore: 'planned',
    message: systemMessage('generator dispatched'),
  })
  await history.finishStep({
    goalKey: 'test',
    runId: generated.runId,
    stepId: generated.stepId,
    statusAfter: 'in_review',
    outcome: 'success',
    message: systemMessage('generator succeeded'),
  })

  const reviewed = await history.startStep({
    goalKey: 'test',
    taskRef,
    taskKind: 'engineering',
    role: 'reviewer',
    statusBefore: 'in_review',
    message: systemMessage('reviewer dispatched'),
  })
  await history.finishStep({
    goalKey: 'test',
    runId: reviewed.runId,
    stepId: reviewed.stepId,
    statusAfter: 'merging',
    outcome: 'success',
    message: systemMessage('reviewer accepted'),
  })

  return generated.runId
}

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    ref: 'T-1',
    kind: 'engineering',
    status: 'planned',
    title: 'Task',
    description: 'Do the task',
    acceptanceCriteria: ['Task is complete'],
    blockedBy: [],
    ...overrides,
  }
}

function systemMessage(content: string) {
  return {
    kind: 'system' as const,
    role: 'system' as const,
    content,
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }

  return stdout.trim()
}

async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
