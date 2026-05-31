import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner } from '../src/agent/AgentRunner'
import { ProcessAgentRunner } from '../src/agent/ProcessAgentRunner'
import type { TaskItem, TodoBoard } from '../src/domain/board'
import { createServer } from '../src/index'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'
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
      requestedUpdates: ['design.md', 'todo.yml'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      title: 'Plan auth follow-through',
      taskRef: 'P-1',
      status: 'open',
      decisionRefs: ['auth-strategy'],
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
    ).resolves.toContain('requestedUpdates:')
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
