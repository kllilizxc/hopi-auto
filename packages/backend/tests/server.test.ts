import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner } from '../src/agent/AgentRunner'
import { ProcessAgentRunner } from '../src/agent/ProcessAgentRunner'
import type { TaskItem, TodoBoard } from '../src/domain/board'
import { createServer } from '../src/index'
import { createAssistantThreadStore } from '../src/runtime/assistantThreadStore'
import { requestGoalPlanning, requestGoalPlanningBatch } from '../src/runtime/planningRequest'
import { createRunHistoryStore } from '../src/runtime/runHistoryStore'
import { createWorktreeManager } from '../src/runtime/worktreeManager'
import { createWriteTraceStore } from '../src/runtime/writeTraceStore'
import { createBoardStore } from '../src/storage/boardStore'
import { createDecisionStore } from '../src/storage/decisionStore'
import { createPlanningRequestStore } from '../src/storage/planningRequestStore'
import { createPreferenceStore } from '../src/storage/preferenceStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'server')
const servers: Array<ReturnType<typeof createServer>> = []
let workspaceCounter = 0
let activeRootDir: string | undefined

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
  activeRootDir = undefined
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
      answers: [
        {
          summary: 'Auth scope',
          prompt: 'What should the auth scope be?',
          answer: 'Support enterprise SSO first.',
        },
      ],
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
          answers: [
            {
              summary: 'Auth scope',
              prompt: 'What should the auth scope be?',
              answer: 'Support enterprise SSO first.',
            },
          ],
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

  test('materializes interpreted planner answers through the direct planning-request API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse: 'Start with five enterprise customers before broader launch.',
      sourceResponseFormat: 'single_pending',
      answers: [{ summary: 'Pilot scope' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: [
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ],
        }),
      ],
    })
  })

  test('materializes planner answers through the direct planning-request API from auto-detected question spans', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse: [
        'Which customers should pilot first before broader launch?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'auto',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'Which customers should pilot first before broader launch?',
        },
      ],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'Which customers should pilot first before broader launch?',
          answer:
            'Start with five enterprise customers before broader launch. That keeps early support manageable.',
        },
      ],
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: [
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'Which customers should pilot first before broader launch?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            }),
          ],
        }),
      ],
    })
  })

  test('materializes durable answers through the API from auto-detected ordered items when question and topic surfaces never match any consumer', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: ['1. Use Bun-native auth', '2. Use a staged rollout'].join('\n'),
      sourceResponseFormat: 'auto',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
      blockerRemoved: false,
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
  })

  test('materializes planner answers through the direct planning-request API from explicit matching runs', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse: [
        'Pilot scope should start with five enterprise customers, that keeps support manageable, rollback trigger should be two regressions in one hour, that keeps the rollback boundary explicit.',
      ].join(' '),
      sourceResponseFormat: 'matching_runs',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer:
            'Pilot scope should start with five enterprise customers, that keeps support manageable',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer:
            'rollback trigger should be two regressions in one hour, that keeps the rollback boundary explicit.',
        },
      ],
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: [
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer:
                'Pilot scope should start with five enterprise customers, that keeps support manageable',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              prompt: 'What should the rollback trigger be?',
              answer:
                'rollback trigger should be two regressions in one hour, that keeps the rollback boundary explicit.',
            }),
          ],
        }),
      ],
    })
  })

  test('rejects direct decision answers through the API when auto-detected labeled sections would leave unmatched labels unconsumed', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy: Use Bun-native auth',
        'Rollout strategy: Use a staged rollout',
        'Pilot scope: Start with five enterprise customers before broader launch.',
      ].join('\n'),
      sourceResponseFormat: 'auto',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(
        'sourceResponseFormat auto could not deterministically match decision answer bundle. Provide an explicit sourceResponseFormat.',
      ),
    })
  })

  test('rejects direct decision answers through the API when auto-detected question clauses would otherwise fall back to weaker surfaces', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy? Use Bun-native auth. Rollout strategy? Use a staged rollout. Pilot scope? Start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'auto',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(
        'sourceResponseFormat auto could not deterministically match decision answer bundle. Provide an explicit sourceResponseFormat.',
      ),
    })
  })

  test('rejects direct decision answers through the API when incomplete answer sources would otherwise fall back to raw sourceResponse surfaces', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy: Use Bun-native auth',
        'Rollout strategy: Use a staged rollout',
      ].join('\n'),
      answerSources: [
        {
          answerSourceKey: 'auth-answer',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth',
        },
        {
          answerSourceKey: 'rollout-answer',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout',
        },
        {
          answerSourceKey: 'pilot-answer',
          summary: 'Pilot scope',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'auto',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining(
        'sourceResponseFormat auto could not deterministically match decision answer bundle. Provide an explicit sourceResponseFormat.',
      ),
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from one pending-clause reply', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse:
        'Start with five enterprise customers before broader launch; Abort after two regressions.',
      sourceResponseFormat: 'pending_clauses',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from one pending-paragraph reply', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse: [
        'Start with five enterprise customers before broader launch. That keeps support manageable.',
        'Abort after two regressions. That keeps the rollback boundary explicit.',
      ].join('\n\n'),
      sourceResponseFormat: 'pending_paragraphs',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer:
            'Start with five enterprise customers before broader launch. That keeps support manageable.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'Abort after two regressions. That keeps the rollback boundary explicit.',
        },
      ],
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from one pending-sentence reply', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse:
        'Start with five enterprise customers before broader launch. Abort after two regressions.',
      sourceResponseFormat: 'pending_sentences',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from one pending-conjunction reply', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      sourceResponse:
        'Start with five enterprise customers before broader launch and abort after two regressions.',
      sourceResponseFormat: 'pending_conjunctions',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'abort after two regressions.',
        },
      ],
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from ordered pending answer sources', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          answer: 'Abort after two regressions.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('materializes multiple pending planner answers through the direct planning-request API from matching answer sources without per-topic mapping', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'rollback-trigger-answer',
          answer: 'Abort after two regressions.',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      answers: [{ summary: 'Pilot scope' }, { summary: 'Rollback trigger' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('materializes planner answers through the direct planning-request API from matching answer sources by durable summaryKey', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          summaryKey: 'pilot-scope',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      answers: [{ summary: 'Early access cohort plan', summaryKey: 'pilot-scope' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Early access cohort plan',
          summaryKey: 'pilot-scope',
          prompt: 'What should the early access cohort plan be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
  })

  test('materializes planner answers through the direct planning-request API from matching answer sources by durable answerKey', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answerKey: 'pilot-scope',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      answers: [{ summary: 'Early access cohort plan', answerKey: 'pilot-scope' }],
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Early access cohort plan',
          answerKey: 'pilot-scope',
          prompt: 'What should the early access cohort plan be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from remaining pending answer sources without explicit summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          matchHints: ['revert point'],
          answer: 'Abort after two regressions.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          matchHints: ['revert point'],
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from canonical-prompt answer sources without explicit summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          prompt: 'What should the rollback trigger be?',
          matchHints: ['revert point'],
          answer: 'Abort after two regressions.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Rollback trigger',
          prompt: 'What should the rollback trigger be?',
          matchHints: ['revert point'],
          answer: 'Abort after two regressions.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from question-shaped prompt answer sources without explicit summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          prompt: 'Which customers should pilot first before broader launch?',
          matchHints: ['early customer set'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Which customers should pilot first before broader launch?',
          prompt: 'Which customers should pilot first before broader launch?',
          matchHints: ['early customer set'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from one stable match hint without explicit summary or prompt', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          matchHints: ['early customer set'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Early customer set',
          prompt: 'What should the early customer set be?',
          matchHints: ['early customer set'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from stable answerSourceKey without explicit summary, prompt, or match hints', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'pilot-scope-answer',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'early-customer-set-answer',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Early customer set',
          summaryKey: 'early-customer-set',
          prompt: 'What should the early customer set be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
  })

  test('infers remaining planner answers through the direct planning-request API from explicit summaryKey without explicit summary, prompt, match hints, or stable answerSourceKey', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests', {
      title: 'Capture rollout notes',
      description: 'Record rollout details before more planning work continues.',
      acceptanceCriteria: ['Rollout notes are durable.'],
      answerSources: [
        {
          answerSourceKey: 'source-1',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          answerSourceKey: 'source-2',
          summaryKey: 'early-customer-set',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'pending_answer_sources',
      answers: [{ summary: 'Pilot scope' }],
      inferRemainingAnswers: true,
      requestedUpdates: ['goal.md', 'notes/rollout.md'],
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      requestKey: 'PR-1',
      taskRef: 'P-1',
      answers: [
        {
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
        {
          summary: 'Early customer set',
          prompt: 'What should the early customer set be?',
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
    })
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
      workflowKey: 'W-1',
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
          workflowKey: 'W-1',
          decisionRefs: ['rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers.',
            }),
          ]),
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          workflowKey: 'W-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Auth scope',
              answer: 'Support enterprise SSO first.',
            }),
          ]),
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          workflowKey: 'W-1',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Auth scope',
              answer: 'Support enterprise SSO first.',
            }),
          ]),
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('materializes interpreted shared planner answers through the direct workflow API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
      sourceResponse: 'Start with five enterprise customers before broader launch.',
      sourceResponseFormat: 'single_pending',
      answers: [{ summary: 'Pilot scope' }],
      workflows: [
        {
          kind: 'planning',
          title: 'Capture rollout notes',
          description: 'Record rollout details before more planning work continues.',
          acceptanceCriteria: ['Rollout notes are durable.'],
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
        },
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
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
      workflowKey: 'W-1',
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'W-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'W-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'W-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
          requestedUpdates: ['todo.yml'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
          requestedUpdates: ['design.md'],
        }),
      ],
    })
  })

  test('lists durable planning workflow graphs through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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

    expect(createResponse.status).toBe(201)

    const response = await fetch(apiUrl(server, '/api/goals/test/planning-requests/workflows'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      goalKey: 'test',
      workflows: [
        {
          kind: 'workflow_batch',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedDecisionRefs: ['auth-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            },
          ],
          groupKeys: ['auth-follow-through'],
          requestKeys: ['PR-1', 'PR-2', 'PR-3'],
          taskRefs: ['P-1', 'P-2', 'P-3'],
          blockerTaskRefs: ['P-2', 'P-3'],
          workflows: [
            {
              kind: 'planning_batch',
              groupKey: 'auth-follow-through',
              blockedByWorkflowKeys: [],
              blockerTaskRefs: ['P-2'],
              requests: [
                expect.objectContaining({
                  requestKey: 'PR-1',
                  groupTaskKey: 'goal-docs',
                }),
                expect.objectContaining({
                  requestKey: 'PR-2',
                  groupTaskKey: 'task-graph',
                }),
              ],
            },
            {
              kind: 'planning',
              workflowTaskKey: 'handoff-review',
              blockedByWorkflowKeys: [],
              blockerTaskRefs: ['P-3'],
              request: expect.objectContaining({
                requestKey: 'PR-3',
                title: 'Review auth rollout readiness',
              }),
            },
          ],
        },
      ],
    })
  })

  test('reads one durable decision-backed workflow graph through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/decisions/answers', {
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
    })

    expect(createResponse.status).toBe(201)

    const response = await fetch(
      apiUrl(server, '/api/goals/test/planning-requests/workflows/auth-rollout-follow-through'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      workflowSharedDecisionRefs: ['auth-strategy', 'rollout-strategy'],
      workflowSharedAnswers: [
        {
          summary: 'Pilot scope',
          answer: 'Start with five enterprise customers before broader rollout.',
        },
      ],
      groupKeys: ['auth-rollout-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'auth-rollout-follow-through',
          blockedByWorkflowKeys: [],
          blockerTaskRefs: ['P-2'],
        },
        {
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          blockedByWorkflowKeys: [],
          blockerTaskRefs: ['P-3'],
          request: expect.objectContaining({
            requestKey: 'PR-3',
            decisionRefs: ['auth-strategy', 'rollout-strategy'],
          }),
        },
      ],
    })

    const missingResponse = await fetch(
      apiUrl(server, '/api/goals/test/planning-requests/workflows/missing-workflow'),
    )
    expect(missingResponse.status).toBe(404)
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

  test('records inferred shared workflow answers through the API from remaining question blocks', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Rollback trigger?',
        '',
        'Abort after two regressions.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            answers: [
              {
                summary: 'Rollback trigger',
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
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records inferred shared workflow answers through the API from remaining question closing spans', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Auth strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Rollout strategy?',
        'Abort after two regressions.',
        'Rollback trigger?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
        'Pilot scope?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            answers: [
              {
                summary: 'Rollback trigger',
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
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records inferred shared workflow answers through the API from remaining question closing blocks', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Auth strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Rollout strategy?',
        '',
        'Abort after two regressions.',
        '',
        'Rollback trigger?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
        '',
        'Pilot scope?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
        workflows: [
          {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            answers: [
              {
                summary: 'Rollback trigger',
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
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('reuses an existing grouped planning surface as the first workflow through the API', async () => {
    const workspaceRoot = rootDir()
    const planningRequests = createPlanningRequestStore(workspaceRoot)
    const boardStore = createBoardStore(workspaceRoot)

    await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'test',
        groupKey: 'auth-follow-through',
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

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
      workflowKey: 'auth-rollout-follow-through',
      reuseGroupKey: 'auth-follow-through',
      decisionRefs: ['auth-strategy'],
      workflows: [
        {
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requests: [],
        },
        {
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          title: 'Review auth rollout readiness',
          description: 'Inspect the reused auth workflow before handoff.',
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
      createdRequestKeys: ['PR-3'],
      createdTaskRefs: ['P-3'],
      workflows: [
        expect.objectContaining({
          kind: 'planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
          blockerTaskRefs: ['P-2'],
        }),
        expect.objectContaining({
          kind: 'planning',
          workflowTaskKey: 'handoff-review',
          requestKeys: ['PR-3'],
          taskRefs: ['P-3'],
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
          workflowSharedDecisionRefs: ['auth-strategy'],
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedDecisionRefs: ['auth-strategy'],
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedDecisionRefs: ['auth-strategy'],
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
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
          blockedBy: expect.arrayContaining([
            { kind: 'task', ref: 'P-2' },
            { kind: 'task', ref: 'P-3' },
          ]),
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

  test('creates, lists, and resolves Goal decisions through the API', async () => {
    const workspaceRoot = rootDir()
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-5',
        kind: 'planning',
        status: 'planned',
        title: 'Decide auth provider',
        description: 'Wait for the auth provider decision.',
        acceptanceCriteria: ['The auth provider choice is visible.'],
        blockedBy: [],
      }),
    ])
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'auth-provider',
      summary: 'Choose auth provider',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-5',
    })
    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      decisionKey: 'auth-provider',
      summary: 'Choose auth provider',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-5',
      status: 'open',
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-provider',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        }),
      ],
    })

    const listResponse = await fetch(apiUrl(server, '/api/goals/test/decisions'))
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      goalKey: 'test',
      decisions: [
        {
          decisionKey: 'auth-provider',
          summary: 'Choose auth provider',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
          status: 'open',
        },
      ],
    })

    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-provider/resolve',
      { answer: 'Use Bun-native sessions.' },
    )
    expect(resolveResponse.status).toBe(200)
    await expect(resolveResponse.json()).resolves.toMatchObject({
      decision: expect.objectContaining({
        decisionKey: 'auth-provider',
        prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        status: 'resolved',
        answer: 'Use Bun-native sessions.',
      }),
      blockerRemoved: true,
    })
  })

  test('upgrades a synthesized Goal decision prompt when the API later resolves it with an explicit question', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const createResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'auth-provider',
      summary: 'Choose auth provider',
    })
    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toMatchObject({
      decisionKey: 'auth-provider',
      summary: 'Choose auth provider',
      prompt: 'What should the auth provider be?',
      status: 'open',
    })

    const resolveResponse = await postJson(
      server,
      '/api/goals/test/decisions/auth-provider/resolve',
      {
        answer: 'Use Bun-native sessions.',
        prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      },
    )
    expect(resolveResponse.status).toBe(200)
    await expect(resolveResponse.json()).resolves.toMatchObject({
      decision: expect.objectContaining({
        decisionKey: 'auth-provider',
        prompt: 'Which auth provider should we adopt for the Bun-first product path?',
        status: 'resolved',
        answer: 'Use Bun-native sessions.',
      }),
    })

    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-provider',
          prompt: 'Which auth provider should we adopt for the Bun-first product path?',
          status: 'resolved',
          answer: 'Use Bun-native sessions.',
        }),
      ],
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
    await expect(resolveResponse.json()).resolves.toMatchObject({
      decision: expect.objectContaining({
        decisionKey: 'auth-strategy',
        status: 'resolved',
        answer: 'Use Bun-native auth.',
      }),
      blockerRemoved: true,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-1'],
        blockerTaskRefs: ['P-1'],
      },
    })
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
        prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
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
    await expect(resolveResponse.json()).resolves.toMatchObject({
      decision: expect.objectContaining({
        decisionKey: 'auth-strategy',
        prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
        status: 'resolved',
        answer: 'Use Bun-native auth.',
      }),
      blockerRemoved: true,
      followThrough: {
        kind: 'planning',
        requestKeys: ['PR-1'],
        taskRefs: ['P-1'],
        blockerTaskRefs: ['P-1'],
      },
    })
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
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
          status: 'resolved',
          answer: 'Use Bun-native auth.',
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
      decision: expect.objectContaining({
        decisionKey: 'D-1',
        summary: 'Choose the rollout strategy',
        status: 'resolved',
        answer: 'Use a staged Bun-first rollout.',
      }),
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'rollout-follow-through',
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-2'],
      },
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            }),
          ]),
          requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            }),
          ]),
          requestedUpdates: ['todo.yml'],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from one shared source response', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const sharedResponse =
      'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: sharedResponse,
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: sharedResponse,
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: sharedResponse,
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: sharedResponse,
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: sharedResponse,
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from named answer sources', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'rollout-strategy-answer',
          answer: 'Use a staged rollout.',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          answer: 'Start with five enterprise customers before broader rollout.',
        },
      ],
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          answerSourceKey: 'rollout-strategy-answer',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            answerSourceKey: 'pilot-scope-answer',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from excerpt-backed answer sources', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const sourceResponse =
      'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse,
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use Bun-native auth',
        },
        {
          answerSourceKey: 'rollout-strategy-answer',
          sourceExcerpt: 'a staged rollout',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          sourceExcerpt: 'five enterprise customers before broader launch.',
        },
      ],
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          answerSourceKey: 'rollout-strategy-answer',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            answerSourceKey: 'pilot-scope-answer',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from direct item source excerpts', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const sourceResponse =
      'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse,
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          sourceExcerpt: 'Use Bun-native auth',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          sourceExcerpt: 'a staged rollout',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            sourceExcerpt: 'five enterprise customers before broader launch.',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from labeled source sections without per-topic mapping', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const sourceResponse = [
      'Auth strategy: Use Bun-native auth',
      'Rollout strategy: Use a staged rollout',
      'Pilot scope: Start with five enterprise customers before broader launch.',
    ].join('\n')

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse,
      sourceResponseFormat: 'labeled_sections',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from labeled source sections without repeating per-decision entries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy: Use Bun-native auth',
        'Rollout strategy: Use a staged rollout',
        'Pilot scope: Start with five enterprise customers before broader launch.',
      ].join('\n'),
      sourceResponseFormat: 'labeled_sections',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
          status: 'resolved',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question spans by exact durable prompt text', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Should we use Bun-native auth or an external auth provider?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Should we use Bun-native auth or an external auth provider?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Should rollout happen in stages or all at once?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Should we use Bun-native auth or an external auth provider?',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          prompt: 'Should rollout happen in stages or all at once?',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question spans by durable prompt core text', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'What auth provider should we adopt?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'How should rollout happen?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question spans by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Should we adopt the auth provider for the Bun-first product path?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Should rollout be all at once or in stages?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question middle spans by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Keep the runtime simple.',
        'Should we adopt the auth provider for the Bun-first product path?',
        'Use Bun-native auth.',
        'Launch in phases.',
        'Should rollout be all at once or in stages?',
        'Use a staged rollout.',
        'Keep support load manageable.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'question_middle_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Keep the runtime simple. Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Launch in phases. Use a staged rollout.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question middle blocks by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const decisionStore = createDecisionStore(workspaceRoot)
    await decisionStore.createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })
    await decisionStore.createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Keep the runtime simple.',
        '',
        'Should we adopt the auth provider for the Bun-first product path?',
        '',
        'Use Bun-native auth.',
        '',
        'Launch in phases.',
        '',
        'Should rollout be all at once or in stages?',
        '',
        'Use a staged rollout.',
      ].join('\n'),
      sourceResponseFormat: 'question_middle_blocks',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
        }),
      ],
    })
    await expect(decisionStore.readGoalDecisions('test')).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Keep the runtime simple.', 'Use Bun-native auth.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Launch in phases.', 'Use a staged rollout.'].join('\n\n'),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question closing spans by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Should we adopt the auth provider for the Bun-first product path?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Should rollout be all at once or in stages?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
        'Pilot scope?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question closing blocks by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const decisionStore = createDecisionStore(workspaceRoot)
    await decisionStore.createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })
    await decisionStore.createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Should we adopt the auth provider for the Bun-first product path?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Should rollout be all at once or in stages?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(decisionStore.readGoalDecisions('test')).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from repeated matching runs without duplicating one consumer', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const decisionStore = createDecisionStore(workspaceRoot)
    await decisionStore.createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })
    await decisionStore.createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy should use Bun-native auth.',
        '',
        'The auth strategy should stay close to Bun-native primitives.',
        '',
        'Rollout strategy should use a staged rollout.',
        '',
        'The rollout strategy should stay reversible.',
      ].join('\n'),
      sourceResponseFormat: 'matching_runs',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'Auth strategy should use Bun-native auth.',
            'The auth strategy should stay close to Bun-native primitives.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Rollout strategy should use a staged rollout.',
            'The rollout strategy should stay reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(decisionStore.readGoalDecisions('test')).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'Auth strategy should use Bun-native auth.',
            'The auth strategy should stay close to Bun-native primitives.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Rollout strategy should use a staged rollout.',
            'The rollout strategy should stay reversible.',
          ].join('\n\n'),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining labeled sections without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy: Use Bun-native auth',
        'Rollout strategy: Use a staged rollout',
        'Pilot scope: Start with five enterprise customers before broader launch.',
      ].join('\n'),
      sourceResponseFormat: 'labeled_sections',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining question blocks without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining question spans without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Rollout strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining question closing spans without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Auth strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Rollout strategy?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
        'Pilot scope?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining question closing blocks without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Auth strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Rollout strategy?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
        '',
        'Pilot scope?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [{ summary: 'Pilot scope' }],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          summary: 'Auth strategy',
          prompt: 'Auth strategy?',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          summary: 'Rollout strategy',
          prompt: 'Rollout strategy?',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from inline topic clauses without per-topic mapping', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy should use Bun-native auth;',
        'rollout strategy should use a staged rollout;',
        'pilot scope should start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'inline_topics',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining inline topic clauses without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy should use Bun-native auth;',
        'rollout strategy should use a staged rollout;',
        'pilot scope should start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'inline_topics',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'rollout strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic clauses without sentence boundaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy,',
        'use a staged rollout for rollout strategy,',
        'start with five enterprise customers before broader launch for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_clauses',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth for auth strategy',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'use a staged rollout for rollout strategy',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'start with five enterprise customers before broader launch for pilot scope.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'start with five enterprise customers before broader launch for pilot scope.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from topic clauses by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const decisionStore = createDecisionStore(workspaceRoot)
    await decisionStore.createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })
    await decisionStore.createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Adopt the Bun-native auth provider for the Bun-first product path auth provider,',
        'rollout should happen in stages rather than once.',
      ].join(' '),
      sourceResponseFormat: 'topic_clauses',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Adopt the Bun-native auth provider for the Bun-first product path auth provider',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'rollout should happen in stages rather than once.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic clauses without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy,',
        'use a staged rollout for rollout strategy,',
        'start with five enterprise customers before broader launch for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_clauses',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth for auth strategy',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'use a staged rollout for rollout strategy',
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic sentences without inline labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        'Use a staged rollout for rollout strategy.',
        'Start with five enterprise customers before broader launch for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_sentences',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'We should use Bun-native auth for auth strategy.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout for rollout strategy.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch for pilot scope.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch for pilot scope.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic spans without block boundaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
        'Start with five enterprise customers before broader launch for pilot scope.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'topic_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic middle spans with anchor sentences in the middle', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Keep the runtime simple.',
        'We should use Bun-native auth for auth strategy.',
        'That avoids extra infra.',
        'Launch in phases.',
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
        'Keep support load manageable.',
        'Start with five enterprise customers before broader launch for pilot scope.',
        'That keeps the pilot focused.',
      ].join(' '),
      sourceResponseFormat: 'topic_middle_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer:
            'Keep the runtime simple. We should use Bun-native auth for auth strategy. That avoids extra infra.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer:
            'Launch in phases. Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Keep support load manageable. Start with five enterprise customers before broader launch for pilot scope. That keeps the pilot focused.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Keep support load manageable. Start with five enterprise customers before broader launch for pilot scope. That keeps the pilot focused.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic closing spans without front-loaded topic anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
        'Use a staged rollout.',
        'That keeps the launch reversible for rollout strategy.',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_closing_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'We should use Bun-native auth. That keeps the runtime simple for auth strategy.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible for rollout strategy.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic closing blocks without front-loaded topic anchor paragraphs', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth.',
        '',
        'That keeps the runtime simple for auth strategy.',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible for rollout strategy.',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable for pilot scope.',
      ].join('\n'),
      sourceResponseFormat: 'topic_closing_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'We should use Bun-native auth.',
            'That keeps the runtime simple for auth strategy.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Use a staged rollout.',
            'That keeps the launch reversible for rollout strategy.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable for pilot scope.',
              ].join('\n\n'),
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable for pilot scope.',
              ].join('\n\n'),
            }),
          ]),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic paragraphs without per-sentence topic labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
        '',
        'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_paragraphs',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records matching open decisions through the API from topic paragraphs by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Adopt the Bun-native auth provider for the Bun-first product path. That keeps the runtime simple.',
        '',
        'Rollout should happen in stages, not once. That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_paragraphs',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer:
            'Adopt the Bun-native auth provider for the Bun-first product path. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Rollout should happen in stages, not once. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('records matching open decisions and planner answers through the API from topic paragraphs by durable match hints', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt:
        'Which authentication provider should the Bun-first runtime adopt before coding continues?',
      matchHints: ['login path'],
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should launch happen in waves or all at once after readiness review?',
      matchHints: ['launch shape'],
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Login path should use Bun-native auth. That keeps the runtime simple.',
        '',
        'Launch shape should use a staged rollout. That keeps the launch reversible.',
        '',
        'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_paragraphs',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            prompt: 'Which cohort should we expose first after readiness review?',
            matchHints: ['early customer set'],
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

    expect(response.status).toBe(200)
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          matchHints: ['login path'],
          answer: 'Login path should use Bun-native auth. That keeps the runtime simple.',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          matchHints: ['launch shape'],
          answer: 'Launch shape should use a staged rollout. That keeps the launch reversible.',
          status: 'resolved',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which cohort should we expose first after readiness review?',
              matchHints: ['early customer set'],
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which cohort should we expose first after readiness review?',
              matchHints: ['early customer set'],
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records inferred planner answers through the API from remaining topic paragraphs with synthesized prompts', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Login path should use Bun-native auth. That keeps the runtime simple.',
        '',
        'Launch shape should use a staged rollout. That keeps the launch reversible.',
        '',
        'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_paragraphs',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          matchHints: ['login path'],
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
          matchHints: ['launch shape'],
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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
          answers: [
            {
              summary: 'Early customer set',
              prompt: 'What should the early customer set be?',
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Early customer set',
              prompt: 'What should the early customer set be?',
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic sentences without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        'Use a staged rollout for rollout strategy.',
        'Start with five enterprise customers before broader launch for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_sentences',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'We should use Bun-native auth for auth strategy.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout for rollout strategy.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic spans without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
        'Use a staged rollout for rollout strategy.',
        'That keeps the launch reversible.',
        'Start with five enterprise customers before broader launch for pilot scope.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'topic_spans',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic closing spans without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
        'Use a staged rollout.',
        'That keeps the launch reversible for rollout strategy.',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable for pilot scope.',
      ].join(' '),
      sourceResponseFormat: 'topic_closing_spans',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'We should use Bun-native auth. That keeps the runtime simple for auth strategy.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible for rollout strategy.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable for pilot scope.',
            }),
          ]),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic closing blocks without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth.',
        '',
        'That keeps the runtime simple for auth strategy.',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible for rollout strategy.',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable for pilot scope.',
      ].join('\n'),
      sourceResponseFormat: 'topic_closing_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'We should use Bun-native auth.',
            'That keeps the runtime simple for auth strategy.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Use a staged rollout.',
            'That keeps the launch reversible for rollout strategy.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable for pilot scope.',
              ].join('\n\n'),
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable for pilot scope.',
              ].join('\n\n'),
            }),
          ]),
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining topic blocks without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        '',
        'That keeps the runtime simple.',
        '',
        'Use a staged rollout for rollout strategy.',
        '',
        'That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch for pilot scope.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'We should use Bun-native auth for auth strategy.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Use a staged rollout for rollout strategy.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch for pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch for pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining leading topic blocks without trailing topic labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy should use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout strategy should use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Pilot scope should start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'Auth strategy should use Bun-native auth.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Rollout strategy should use a staged rollout.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Pilot scope should start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Pilot scope should start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining prefixed topic blocks without trailing topic labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'For auth strategy, use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Regarding rollout strategy, use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'About pilot scope, start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'For auth strategy, use Bun-native auth.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Regarding rollout strategy, use a staged rollout.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'About pilot scope, start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'About pilot scope, start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining as-topic blocks without trailing topic labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth as the auth strategy.',
        '',
        'That keeps the runtime simple.',
        '',
        'Use a staged rollout as the rollout strategy.',
        '',
        'That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch as the pilot scope.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'Use Bun-native auth as the auth strategy.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Use a staged rollout as the rollout strategy.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch as the pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch as the pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining copular topic blocks without trailing topic labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Bun-native auth should be the auth strategy.',
        '',
        'That keeps the runtime simple.',
        '',
        'A staged rollout should be the rollout strategy.',
        '',
        'That keeps the launch reversible.',
        '',
        'Five enterprise customers should be the pilot scope.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
            description: 'Reflect the auth rollout answers in todo.yml.',
            acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'Bun-native auth should be the auth strategy.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'A staged rollout should be the rollout strategy.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Five enterprise customers should be the pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Five enterprise customers should be the pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from topic blocks with continuation paragraphs', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'We should use Bun-native auth for auth strategy.',
        '',
        'That keeps the runtime simple.',
        '',
        'Use a staged rollout for rollout strategy.',
        '',
        'That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch for pilot scope.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'We should use Bun-native auth for auth strategy.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Use a staged rollout for rollout strategy.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch for pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch for pilot scope.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records matching open decisions through the API from topic blocks by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Adopt the Bun-native auth provider for the Bun-first product path.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout should happen in stages, not once.',
        '',
        'That keeps the launch reversible.',
        '',
        'Start with five enterprise customers before broader launch for pilot scope.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'Adopt the Bun-native auth provider for the Bun-first product path.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Rollout should happen in stages, not once.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from ordered blocks without labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'ordered_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from question blocks without repeating topic names in answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from question clauses without sentence or paragraph boundaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy? Use Bun-native auth,',
        'Rollout strategy? Use a staged rollout,',
        'Pilot scope? Start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'question_clauses',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Auth strategy?',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          prompt: 'Rollout strategy?',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: 'Start with five enterprise customers before broader launch.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: 'Start with five enterprise customers before broader launch.',
            },
          ],
        }),
      ],
    })
  })

  test('records inferred planner answers through the API from remaining question blocks without explicit follow-through summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Rollout strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
      followThrough: expect.objectContaining({
        kind: 'planning_batch',
      }),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records matching open decisions through the API from question clauses by durable prompt keyword anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'What auth provider should we adopt for the Bun-first product path? Use Bun-native auth,',
        'Should rollout happen in stages or all at once? Use a staged rollout.',
      ].join(' '),
      sourceResponseFormat: 'question_clauses',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records one pending open decision through the API from a single-pending shared reply without anchors', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth decision before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Use Bun-native auth. That keeps the runtime simple.',
      sourceResponseFormat: 'single_pending',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: [],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
      ],
    })
  })

  test('returns HTTP 400 when single-pending interpretation sees more than one pending open decision', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Use Bun-native auth. That keeps the runtime simple.',
      sourceResponseFormat: 'single_pending',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'sourceResponseFormat single_pending requires exactly one pending answer consumer.',
    })
  })

  test('records new durable decision topics through the API from remaining question clauses without explicit answers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy? Use Bun-native auth,',
        'Rollout strategy? Use a staged rollout,',
        'Pilot scope? Start with five enterprise customers before broader launch.',
      ].join(' '),
      sourceResponseFormat: 'question_clauses',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1', 'D-2'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          prompt: 'Auth strategy?',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          prompt: 'Rollout strategy?',
          answer: 'Use a staged rollout',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining matching answer sources without explicit answer mapping', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          answer: 'Start with five enterprise customers before broader launch.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining matching answer sources by canonical prompt without explicit summary', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'pilot-scope-answer',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          answer: 'Start with five enterprise customers before broader launch.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Pilot scope',
          prompt: 'What should the pilot scope be?',
          matchHints: ['launch cohort'],
          answer: 'Start with five enterprise customers before broader launch.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from remaining matching answer sources by question-shaped prompt without explicit summary', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'rollout-answer',
          prompt: 'How should rollout happen?',
          matchHints: ['launch shape'],
          answer: 'Use a staged rollout.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'How should rollout happen?',
          prompt: 'How should rollout happen?',
          matchHints: ['launch shape'],
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from one stable match hint without explicit summary or prompt', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'rollout-answer',
          matchHints: ['launch shape'],
          answer: 'Use a staged rollout.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Launch shape',
          prompt: 'What should the launch shape be?',
          matchHints: ['launch shape'],
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from stable answerSourceKey without explicit summary, prompt, or match hints', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'launch-shape-answer',
          answer: 'Use a staged rollout.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Launch shape',
          prompt: 'What should the launch shape be?',
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records new durable decision topics through the API from explicit summaryKey without explicit summary, prompt, match hints, or stable answerSourceKey', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          answer: 'Use Bun-native auth.',
        },
        {
          answerSourceKey: 'source-2',
          summaryKey: 'launch-shape',
          answer: 'Use a staged rollout.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      createdDecisionKeys: ['D-1'],
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Launch shape',
          prompt: 'What should the launch shape be?',
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records matching open decisions through the API from matching answer sources by durable summaryKey', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const decisionResponse = await postJson(server, '/api/goals/test/decisions', {
      decisionKey: 'launch-sequencing',
      summary: 'Choose the launch sequencing',
      summaryKey: 'launch-shape',
      prompt: 'How should we phase the launch to users?',
    })
    expect(decisionResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'source-1',
          summaryKey: 'launch-shape',
          answer: 'Use a staged rollout.',
        },
      ],
      sourceResponseFormat: 'matching_answer_sources',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(200)
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'launch-sequencing',
          summary: 'Choose the launch sequencing',
          summaryKey: 'launch-shape',
          prompt: 'How should we phase the launch to users?',
          status: 'resolved',
          answer: 'Use a staged rollout.',
        }),
      ],
    })
  })

  test('records inferred planner answers through the API from remaining question closing spans without explicit follow-through summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Auth strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Rollout strategy?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
        'Pilot scope?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records inferred planner answers through the API from remaining question closing blocks without explicit follow-through summaries', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Auth strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Rollout strategy?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
        '',
        'Pilot scope?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      inferOpenDecisions: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
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

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from question spans without question paragraphs', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Rollout strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Pilot scope?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from question closing spans without front-loaded question sentences', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Auth strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Rollout strategy?',
        'Start with five enterprise customers before broader launch.',
        'That keeps early support manageable.',
        'Pilot scope?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Auth strategy?',
          answer: 'Use Bun-native auth. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          prompt: 'Rollout strategy?',
          answer: 'Use a staged rollout. That keeps the launch reversible.',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from question closing blocks without front-loaded question paragraphs', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Auth strategy?',
        '',
        'Use a staged rollout.',
        '',
        'That keeps the launch reversible.',
        '',
        'Rollout strategy?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
        '',
        'Pilot scope?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Auth strategy?',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          prompt: 'Rollout strategy?',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API from ordered items without labels', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        '- Use Bun-native auth',
        '- Use a staged rollout',
        '- Start with five enterprise customers before broader launch.',
      ].join('\n'),
      sourceResponseFormat: 'ordered_items',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
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
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            },
          ],
        }),
      ],
    })
  })

  test('returns HTTP 400 when answer-driven interpretation omits both item answers and sourceResponse', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
          },
        ],
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth answer across Goal docs.',
            acceptanceCriteria: ['The auth answer is durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Missing answer text for decision answer auth-strategy. Provide item.answer, answerSourceKey, or sourceResponse.',
    })
  })

  test('returns HTTP 400 when answer-driven interpretation references an unknown answer source key', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'rollout-strategy-answer',
          answer: 'Use a staged rollout.',
        },
      ],
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Unknown answerSourceKey "auth-strategy-answer" for decision answer auth-strategy.',
    })
  })

  test('returns HTTP 400 when excerpt-backed answer sources do not match sourceResponse', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Use Bun-native auth with a staged rollout.',
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use OAuth device flow',
        },
      ],
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'sourceExcerpt for answerSourceKey "auth-strategy-answer" was not found in sourceResponse.',
    })
  })

  test('returns HTTP 400 when excerpt-backed answer sources omit sourceResponse', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answerSources: [
        {
          answerSourceKey: 'auth-strategy-answer',
          sourceExcerpt: 'Use Bun-native auth',
        },
      ],
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          answerSourceKey: 'auth-strategy-answer',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'sourceExcerpt for answerSourceKey "auth-strategy-answer" requires sourceResponse.',
    })
  })

  test('returns HTTP 400 when direct item source excerpts omit sourceResponse', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
          sourceExcerpt: 'Use Bun-native auth',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'sourceExcerpt for decision answer auth-strategy requires sourceResponse.',
    })
  })

  test('returns HTTP 400 when labeled source sections omit one requested topic', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    const sourceResponse = [
      'Auth strategy: Use Bun-native auth',
      'Pilot scope: Start with five enterprise customers before broader launch.',
    ].join('\n')

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse,
      sourceResponseFormat: 'labeled_sections',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'No labeled section matched decision answer rollout-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when inferOpenDecisions is used without labeled-section interpretation', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
    })

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy: Use Bun-native auth',
      inferOpenDecisions: true,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "single_pending", "pending_clauses", "pending_paragraphs", "pending_sentences", "pending_conjunctions", "pending_answer_sources", "matching_answer_sources", "matching_runs", "ordered_items", "ordered_blocks", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "inline_topics", "topic_clauses", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
    })
  })

  test('returns HTTP 400 when inferDecisionTopics is used without labeled-section interpretation', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy: Use Bun-native auth',
      sourceResponseFormat: 'ordered_items',
      inferDecisionTopics: true,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'inferDecisionTopics requires sourceResponseFormat "pending_answer_sources", "matching_answer_sources", "labeled_sections", "inline_topics", "topic_clauses", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
    })
  })

  test('returns HTTP 400 when inferDecisionTopics is mixed with followThrough.inferRemainingAnswers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        inferRemainingAnswers: true,
        requests: [
          {
            taskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'followThrough.inferRemainingAnswers cannot be combined with inferDecisionTopics. Pick one authority for the remaining sourceResponse items.',
    })
  })

  test('returns HTTP 400 when inferDecisionTopics is mixed with workflow_batch inferRemainingAnswers', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        '',
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple.',
        '',
        'Pilot scope?',
        '',
        'Start with five enterprise customers before broader launch.',
        '',
        'That keeps early support manageable.',
      ].join('\n'),
      sourceResponseFormat: 'question_blocks',
      inferDecisionTopics: true,
      followThrough: {
        kind: 'workflow_batch',
        inferRemainingAnswers: true,
        workflows: [
          {
            kind: 'planning',
            workflowTaskKey: 'goal-docs',
            title: 'Capture auth rollout goal context',
            description: 'Record the auth and rollout answers across Goal docs.',
            acceptanceCriteria: ['The auth and rollout answers are durable.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
        ],
      },
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'followThrough.inferRemainingAnswers cannot be combined with inferDecisionTopics. Pick one authority for the remaining sourceResponse items.',
    })
  })

  test('returns HTTP 400 when inline-topic interpretation omits one requested topic', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy should use Bun-native auth.',
      sourceResponseFormat: 'inline_topics',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'No inline topic clause matched decision answer rollout-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-sentence interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy.',
        'Document Bun-native fallback decisions for auth strategy.',
      ].join(' '),
      sourceResponseFormat: 'topic_sentences',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Multiple topic sentences matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-span interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy.',
        'That keeps the runtime simple.',
        'Document Bun-native fallback decisions for auth strategy.',
        'That keeps incident recovery explicit.',
      ].join(' '),
      sourceResponseFormat: 'topic_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Multiple topic spans matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-closing-span interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'That keeps the runtime simple for auth strategy.',
        'Document Bun-native fallback decisions.',
        'That keeps incident recovery explicit for auth strategy.',
      ].join(' '),
      sourceResponseFormat: 'topic_closing_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Multiple topic closing spans matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-closing-block interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'That keeps the runtime simple for auth strategy.',
        '',
        'Document Bun-native fallback decisions.',
        '',
        'That keeps incident recovery explicit for auth strategy.',
      ].join('\n'),
      sourceResponseFormat: 'topic_closing_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Multiple topic closing blocks matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-paragraph interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy. That keeps the runtime simple.',
        '',
        'Document Bun-native fallback decisions for auth strategy. That keeps incident recovery explicit.',
      ].join('\n'),
      sourceResponseFormat: 'topic_paragraphs',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Multiple topic paragraphs matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when topic-block interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth for auth strategy.',
        '',
        'That keeps the runtime simple.',
        '',
        'Document Bun-native fallback decisions for auth strategy.',
        '',
        'That keeps incident recovery explicit.',
      ].join('\n'),
      sourceResponseFormat: 'topic_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Multiple topic blocks matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when ordered-block interpretation runs out of blocks', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: ['Use Bun-native auth.', '', 'That keeps the runtime simple.'].join('\n'),
      sourceResponseFormat: 'ordered_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'No ordered block remained for decision answer rollout-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when question-block interpretation omits the answer block for a matched question', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy?',
      sourceResponseFormat: 'question_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Question block "Auth strategy?" in sourceResponse did not include an answer block.',
    })
  })

  test('returns HTTP 400 when question-span interpretation omits the answer sentences for a matched question', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy?',
      sourceResponseFormat: 'question_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Question span "Auth strategy?" in sourceResponse did not include an answer sentence.',
    })
  })

  test('returns HTTP 400 when question-clause interpretation omits the answer text for a matched question', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Auth strategy?',
      sourceResponseFormat: 'question_clauses',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Question clause "Auth strategy?" in sourceResponse did not include answer text.',
    })
  })

  test('returns HTTP 400 when question-closing-span interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        'Auth strategy?',
        'Use external auth.',
        'Auth strategy?',
      ].join(' '),
      sourceResponseFormat: 'question_closing_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Multiple question closing spans matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when question-closing-block interpretation matches one requested topic more than once', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Use Bun-native auth.',
        '',
        'Auth strategy?',
        '',
        'Use external auth.',
        '',
        'Auth strategy?',
      ].join('\n'),
      sourceResponseFormat: 'question_closing_blocks',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error:
        'Multiple question closing blocks matched decision answer auth-strategy in sourceResponse.',
    })
  })

  test('returns HTTP 400 when ordered-item interpretation runs out of items', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: 'Use Bun-native auth',
      sourceResponseFormat: 'ordered_items',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'No ordered item remained for decision answer rollout-strategy in sourceResponse.',
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
      decision: expect.objectContaining({
        decisionKey: 'D-1',
        summary: 'Choose the auth strategy',
        status: 'resolved',
        answer: 'Use Bun-native auth.',
      }),
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'W-1',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-1', 'P-3'],
      },
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

  test('records a durable answer through the API and explicitly reuses a current planning surface in a workflow graph', async () => {
    const workspaceRoot = rootDir()
    await requestGoalPlanning(
      {
        boardStore: createBoardStore(workspaceRoot),
        planningRequests: createPlanningRequestStore(workspaceRoot),
      },
      {
        goalKey: 'test',
        title: 'Plan rollout baseline',
        description: 'Create the first visible rollout planning surface.',
        acceptanceCriteria: ['The rollout baseline is visible.'],
      },
    )
    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/decisions/answer', {
      summary: 'Choose the rollout strategy',
      answer: 'Use a staged Bun-first rollout.',
      followThrough: {
        kind: 'workflow_batch',
        reuseTaskRef: 'P-1',
        workflows: [
          {
            kind: 'planning',
            title: 'Capture rollout answer',
            description: 'Upgrade the current rollout planning surface with the final answer.',
            acceptanceCriteria: ['The rollout answer is durable in Goal docs.'],
            requestedUpdates: ['goal.md', 'design.md'],
          },
          {
            kind: 'planning',
            workflowTaskKey: 'handoff-review',
            title: 'Review rollout readiness',
            description: 'Inspect rollout readiness after the answer is durable.',
            acceptanceCriteria: ['The rollout review is visible.'],
            requestedUpdates: ['notes/rollout.md'],
          },
        ],
      },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      decision: expect.objectContaining({
        decisionKey: 'D-1',
        status: 'resolved',
      }),
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'W-1',
        groupKeys: [],
        requestKeys: ['PR-1', 'PR-2'],
        taskRefs: ['P-1', 'P-2'],
        blockerTaskRefs: ['P-1', 'P-2'],
      },
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
          title: 'Review rollout readiness',
          blockedBy: [],
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
          workflowKey: 'W-1',
          decisionRefs: ['D-1'],
          requestedUpdates: ['goal.md', 'design.md'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          workflowKey: 'W-1',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['D-1'],
          requestedUpdates: ['notes/rollout.md'],
        }),
      ],
    })
  })

  test('records multiple durable answers through the API and shares one non-decision answer across a workflow graph', async () => {
    const workspaceRoot = rootDir()
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
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
      createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-2', 'P-3'],
      },
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
      ],
    })
  })

  test('persists answer-driven workflow-root context across later API extensions', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const firstResponse = await postJson(server, '/api/goals/test/decisions/answers', {
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
        ],
      },
    })

    expect(firstResponse.status).toBe(201)

    const response = await postJson(server, '/api/goals/test/planning-requests/workflows', {
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
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      kind: 'workflow_batch',
      workflowKey: 'auth-rollout-follow-through',
      groupKeys: ['auth-rollout-follow-through'],
      requestKeys: ['PR-1', 'PR-2', 'PR-3'],
      taskRefs: ['P-1', 'P-2', 'P-3'],
      blockerTaskRefs: ['P-2', 'P-3'],
      createdRequestKeys: ['PR-3'],
      createdTaskRefs: ['P-3'],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
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
      `# Preferences

\`\`\`yaml
version: 1
preferences:
  - preferenceKey: prefer-deterministic-workflows
    status: active
    summary: Prefer deterministic workflows.
\`\`\`
`,
    )

    const server = startServer(undefined, workspaceRoot)

    const beforeResponse = await fetch(apiUrl(server, '/api/preferences'))
    expect(beforeResponse.status).toBe(200)
    await expect(beforeResponse.json()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'active',
          summary: 'Prefer deterministic workflows.',
        },
      ],
    })

    const updateResponse = await postJson(server, '/api/preferences', {
      content: `# Preferences

\`\`\`yaml
version: 1
preferences:
  - preferenceKey: prefer-bun-first
    status: active
    summary: Prefer Bun-first APIs.
  - preferenceKey: keep-goal-docs-file-native
    status: active
    summary: Keep Goal docs file-native.
\`\`\`
`,
    })
    expect(updateResponse.status).toBe(200)
    await expect(updateResponse.json()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-bun-first',
          status: 'active',
          summary: 'Prefer Bun-first APIs.',
        },
        {
          preferenceKey: 'keep-goal-docs-file-native',
          status: 'active',
          summary: 'Keep Goal docs file-native.',
        },
      ],
    })

    await expect(createPreferenceStore(workspaceRoot).readPreferences()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-bun-first',
          status: 'active',
          summary: 'Prefer Bun-first APIs.',
        },
        {
          preferenceKey: 'keep-goal-docs-file-native',
          status: 'active',
          summary: 'Keep Goal docs file-native.',
        },
      ],
    })
  })

  test('records and retires structured repo preferences through the API', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const recordResponse = await postJson(server, '/api/preferences/record', {
      preferenceKey: 'prefer-deterministic-workflows',
      summary: 'Prefer deterministic workflows.',
    })
    expect(recordResponse.status).toBe(200)
    await expect(recordResponse.json()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'active',
          summary: 'Prefer deterministic workflows.',
        },
      ],
    })

    const supersedingResponse = await postJson(server, '/api/preferences/record', {
      preferenceKey: 'prefer-bun-first',
      summary: 'Prefer Bun-first APIs.',
      rationale: 'Bun is the runtime boundary.',
      supersedes: ['prefer-deterministic-workflows'],
    })
    expect(supersedingResponse.status).toBe(200)
    await expect(supersedingResponse.json()).resolves.toMatchObject({
      entries: [
        {
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'retired',
          retiredReason: 'Superseded by prefer-bun-first.',
          supersededBy: 'prefer-bun-first',
        },
        {
          preferenceKey: 'prefer-bun-first',
          status: 'active',
          summary: 'Prefer Bun-first APIs.',
          rationale: 'Bun is the runtime boundary.',
        },
      ],
    })

    const retireResponse = await postJson(server, '/api/preferences/retire', {
      preferenceKey: 'prefer-bun-first',
      reason: 'The runtime boundary is now fixed elsewhere.',
    })
    expect(retireResponse.status).toBe(200)
    await expect(retireResponse.json()).resolves.toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({
          preferenceKey: 'prefer-bun-first',
          status: 'retired',
          summary: 'Prefer Bun-first APIs.',
          retiredReason: 'The runtime boundary is now fixed elsewhere.',
        }),
      ]),
    })
  })

  test('records planner answers through the API from question spans by durable planner prompt text', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const response = await postJson(server, '/api/goals/test/decisions/answers', {
      sourceResponse: [
        'Auth strategy?',
        'Use Bun-native auth.',
        'That keeps the runtime simple.',
        'Rollout strategy?',
        'Use a staged rollout.',
        'That keeps the launch reversible.',
        'Which customers should pilot first before broader launch?',
        'Start with five enterprise customers.',
        'That keeps early support manageable.',
      ].join(' '),
      sourceResponseFormat: 'question_spans',
      answers: [
        {
          decisionKey: 'auth-strategy',
          summary: 'Choose the auth strategy',
        },
        {
          decisionKey: 'rollout-strategy',
          summary: 'Choose the rollout strategy',
        },
      ],
      followThrough: {
        kind: 'planning_batch',
        groupKey: 'auth-rollout-follow-through',
        answers: [
          {
            summary: 'Pilot scope',
            prompt: 'Which customers should pilot first before broader launch?',
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
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which customers should pilot first before broader launch?',
              answer: 'Start with five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which customers should pilot first before broader launch?',
              answer: 'Start with five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('returns HTTP 400 for invalid structured preference mutations', async () => {
    const workspaceRoot = rootDir()
    const server = startServer(undefined, workspaceRoot)

    const invalidWriteResponse = await postJson(server, '/api/preferences', {
      content: '# Preferences\n\nnot valid structured content\n',
    })
    expect(invalidWriteResponse.status).toBe(400)
    await expect(invalidWriteResponse.json()).resolves.toMatchObject({
      error: 'Invalid preference.md format: expected a fenced yaml preference document.',
    })

    const invalidRetireResponse = await postJson(server, '/api/preferences/retire', {
      preferenceKey: 'missing-preference',
      reason: 'No longer applies.',
    })
    expect(invalidRetireResponse.status).toBe(400)
    await expect(invalidRetireResponse.json()).resolves.toMatchObject({
      error: 'Unknown preference key to retire: missing-preference',
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
    await createPreferenceStore(workspaceRoot).recordPreference({
      preferenceKey: 'prefer-deterministic-workflows',
      summary: 'Prefer deterministic workflows.',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('db-provider')) throw new Error('missing decision topic'); if (!prompt.includes('Use Postgres and create planning work.')) throw new Error('missing user message'); if (!prompt.includes('prefer-deterministic-workflows')) throw new Error('missing structured preference key'); await Bun.write(outcomeFile, JSON.stringify({ message: 'Use Postgres and create visible planning work.', actions: [{ kind: 'resolve_decision', decisionKey: 'db-provider', summary: 'Choose the database provider', taskRef: 'T-2', answer: 'Use Postgres.' }, { kind: 'request_planning', title: 'Plan database integration', description: 'Define the database adapter and migration work.', acceptanceCriteria: ['The database integration plan is visible in todo.yml.'], decisionRefs: ['db-provider'], requestedUpdates: ['design.md', 'todo.yml'] }, { kind: 'record_preference', preferenceKey: 'prefer-bun-native-services', summary: 'Prefer Bun-native services when they meet the Goal requirements.', rationale: 'The runtime boundary is Bun-first.' }, { kind: 'retire_preference', preferenceKey: 'prefer-deterministic-workflows', reason: 'Structured workflow authority now governs deterministic execution.' }] })); console.log('assistant finished')",
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
        preferenceKey?: string
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
          preferenceKey: 'prefer-bun-native-services',
        }),
        expect.objectContaining({
          kind: 'retire_preference',
          preferenceKey: 'prefer-deterministic-workflows',
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
          prompt: 'What should the database provider be?',
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
        expect.objectContaining({
          kind: 'action',
          actionType: 'retire_preference',
        }),
        expect.objectContaining({
          kind: 'action_result',
          actionType: 'retire_preference',
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
          preferenceKey: 'prefer-bun-native-services',
        }),
        expect.objectContaining({
          kind: 'retire_preference',
          preferenceKey: 'prefer-deterministic-workflows',
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
          actionCount: 4,
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
          preferenceKey: 'prefer-bun-native-services',
        }),
        expect.objectContaining({
          kind: 'retire_preference',
          preferenceKey: 'prefer-deterministic-workflows',
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
      entries: [
        expect.objectContaining({
          preferenceKey: 'prefer-deterministic-workflows',
          status: 'retired',
          retiredReason: 'Structured workflow authority now governs deterministic execution.',
        }),
        expect.objectContaining({
          preferenceKey: 'prefer-bun-native-services',
          status: 'active',
          summary: 'Prefer Bun-native services when they meet the Goal requirements.',
          rationale: 'The runtime boundary is Bun-first.',
        }),
      ],
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Plan auth integration')) throw new Error('missing planning context'); if (!prompt.includes('We need one auth decision before planning can continue.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the visible planning task and opened one decision topic before planning continues.', actions: [{ kind: 'request_planning', title: 'Plan auth integration', description: 'Clarify the auth integration plan.', acceptanceCriteria: ['The auth planning path is visible.'] }, { kind: 'request_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', prompt: 'Which auth strategy should we adopt before implementation continues?', taskRef: 'P-7' }] })); console.log('assistant decision requested')",
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
          prompt: 'Which auth strategy should we adopt before implementation continues?',
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
          workflowKey: 'W-1',
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
          workflowKey: 'W-1',
          decisionRefs: ['rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          workflowKey: 'W-1',
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Auth scope',
              answer: 'Support enterprise SSO first.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          taskRef: 'P-3',
          workflowKey: 'W-1',
          groupKey: 'auth-follow-through',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Auth scope',
              answer: 'Support enterprise SSO first.',
            }),
          ]),
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
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

  test('runs the configured Goal assistant and reuses the current grouped planning surface as the first workflow', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    const planningRequests = createPlanningRequestStore(workspaceRoot)
    const boardStore = createBoardStore(workspaceRoot)

    await requestGoalPlanningBatch(
      {
        boardStore,
        planningRequests,
      },
      {
        goalKey: 'test',
        groupKey: 'auth-follow-through',
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

    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Reuse the current grouped planning surface and extend it with one review workflow.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the current grouped planning surface and extended it with one review workflow.', actions: [{ kind: 'request_planning_workflows', workflowKey: 'auth-rollout-follow-through', reuseGroupKey: 'auth-follow-through', decisionRefs: ['auth-strategy'], workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', requests: [] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the reused auth workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] }] })); console.log('assistant grouped workflow reuse requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Reuse the current grouped planning surface and extend it with one review workflow.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I reused the current grouped planning surface and extended it with one review workflow.',
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
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy'],
        }),
      ],
    })
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
          blockedBy: expect.arrayContaining([
            { kind: 'task', ref: 'P-2' },
            { kind: 'task', ref: 'P-3' },
          ]),
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use Bun-native auth and split the follow-through.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the auth decision and split the durable planning follow-through into two visible stages.', actions: [{ kind: 'resolve_decision', decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', prompt: 'Which auth strategy should we adopt for the Bun-first runtime?', taskRef: 'T-7', answer: 'Use Bun-native auth.', followThrough: { kind: 'planning_batch', groupKey: 'auth-follow-through', requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context and rollout notes before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the auth context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
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
          blockerRemoved: true,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-1', 'P-2'],
            blockerTaskRefs: ['P-2'],
          },
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          prompt: 'Which auth strategy should we adopt for the Bun-first runtime?',
          status: 'resolved',
          answer: 'Use Bun-native auth.',
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
          blockerRemoved: true,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'auth-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-8', 'P-9'],
            blockerTaskRefs: ['P-9'],
          },
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
          blockerRemoved: false,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'rollout-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-1', 'P-2'],
            blockerTaskRefs: ['P-2'],
          },
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
          created: true,
          blockerRemoved: false,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'rollout-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-1', 'P-2'],
            blockerTaskRefs: ['P-2'],
          },
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
    const responseBody = await response.json()
    expect(responseBody.message).toBe(
      'I recorded the auth answer and opened two independent planner workflows.',
    )
    expect(responseBody.actionResults[0]).toMatchObject({
      kind: 'record_answer',
      decisionKey: 'D-1',
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'W-1',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-1', 'P-3'],
      },
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

  test('runs the configured Goal assistant and explicitly reuses a current grouped planning surface in a decision-backed workflow graph', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await requestGoalPlanningBatch(
      {
        boardStore: createBoardStore(workspaceRoot),
        planningRequests: createPlanningRequestStore(workspaceRoot),
      },
      {
        goalKey: 'test',
        groupKey: 'auth-follow-through',
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
            acceptanceCriteria: ['The auth task graph is visible.'],
            requestedUpdates: ['todo.yml'],
            blockedByTaskKeys: ['goal-docs'],
          },
        ],
      },
    )
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Answer rollout and reuse the grouped auth planning surface.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded the rollout answer and reused the grouped auth planning surface.', actions: [{ kind: 'record_answer', summary: 'Choose the rollout strategy', answer: 'Use a staged Bun-first rollout.', followThrough: { kind: 'workflow_batch', workflowKey: 'rollout-review', reuseGroupKey: 'auth-follow-through', workflows: [{ kind: 'planning_batch', groupKey: 'auth-follow-through', requests: [] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the reused grouped workflow before handoff.', acceptanceCriteria: ['The rollout review is visible.'], requestedUpdates: ['notes/rollout.md'] }] } }] })); console.log('assistant reused grouped workflow')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Answer rollout and reuse the grouped auth planning surface.',
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.message).toBe(
      'I recorded the rollout answer and reused the grouped auth planning surface.',
    )
    expect(responseBody.actionResults[0]).toMatchObject({
      kind: 'record_answer',
      decisionKey: 'D-1',
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'rollout-review',
        groupKeys: ['auth-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-2', 'P-3'],
      },
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'rollout-review',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['D-1'],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'rollout-review',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['D-1'],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'rollout-review',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['D-1'],
          requestedUpdates: ['notes/rollout.md'],
        }),
      ],
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
    const firstResponseBody = await firstResponse.json()
    expect(firstResponseBody.message).toBe(
      'I recorded the auth answer and opened one durable workflow graph.',
    )
    expect(firstResponseBody.actionResults[0]).toMatchObject({
      kind: 'record_answer',
      decisionKey: 'D-1',
      created: true,
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        groupKeys: ['rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-3'],
      },
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

  test('runs the configured Goal assistant and shares one non-decision answer across a decision-backed workflow graph', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve auth and rollout, and keep the pilot scope on the workflow graph.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I recorded both decisions and shared the pilot scope across one workflow graph.', actions: [{ kind: 'record_answers', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', answer: 'Use Bun-native auth.' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answer: 'Use a staged rollout.' }], followThrough: { kind: 'workflow_batch', workflowKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', answer: 'Start with five enterprise customers before broader rollout.' }], workflows: [{ kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Rollback trigger', answer: 'Abort after two regressions.' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the shared auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] } }] })); console.log('assistant shared decision workflow context requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Resolve auth and rollout, and keep the pilot scope on the workflow graph.',
    })

    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody.message).toBe(
      'I recorded both decisions and shared the pilot scope across one workflow graph.',
    )
    expect(responseBody.actionResults[0]).toMatchObject({
      kind: 'record_answers',
      decisionKeys: ['auth-strategy', 'rollout-strategy'],
      createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
      blockerRemoved: false,
      followThrough: {
        kind: 'workflow_batch',
        workflowKey: 'auth-rollout-follow-through',
        groupKeys: ['auth-rollout-follow-through'],
        requestKeys: ['PR-1', 'PR-2', 'PR-3'],
        taskRefs: ['P-1', 'P-2', 'P-3'],
        blockerTaskRefs: ['P-2', 'P-3'],
      },
    })

    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'goal-docs',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          workflowKey: 'auth-rollout-follow-through',
          groupKey: 'auth-rollout-follow-through',
          groupTaskKey: 'task-graph',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
            expect.objectContaining({
              summary: 'Rollback trigger',
              answer: 'Abort after two regressions.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared workflow answers from remaining question blocks', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-block reply and infer the shared workflow answers without explicit shared summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared workflow answers from the remaining question blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy?', '', 'Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Rollout strategy?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Rollback trigger?', '', 'Abort after two regressions.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'question_blocks', inferOpenDecisions: true, followThrough: { kind: 'workflow_batch', workflowKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, workflows: [{ kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Rollback trigger' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the shared auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-block reply and infer the shared workflow answers without explicit shared summaries.',
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared workflow answers from remaining question closing spans', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-span reply and infer the shared workflow answers without explicit shared summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared workflow answers from the remaining question closing spans.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', 'That keeps the runtime simple.', 'Auth strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Rollout strategy?', 'Abort after two regressions.', 'Rollback trigger?', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable.', 'Pilot scope?'].join(' '), sourceResponseFormat: 'question_closing_spans', inferOpenDecisions: true, followThrough: { kind: 'workflow_batch', workflowKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, workflows: [{ kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Rollback trigger' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the shared auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-span reply and infer the shared workflow answers without explicit shared summaries.',
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared workflow answers from remaining question closing blocks', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-block reply and infer the shared workflow answers without explicit shared summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared workflow answers from the remaining question closing blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Auth strategy?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Rollout strategy?', '', 'Abort after two regressions.', '', 'Rollback trigger?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.', '', 'Pilot scope?'].join('\\n'), sourceResponseFormat: 'question_closing_blocks', inferOpenDecisions: true, followThrough: { kind: 'workflow_batch', workflowKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, workflows: [{ kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Rollback trigger' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }, { kind: 'planning', workflowTaskKey: 'handoff-review', title: 'Review auth rollout readiness', description: 'Inspect the shared auth rollout workflow before handoff.', acceptanceCriteria: ['The auth rollout review is visible.'], requestedUpdates: ['design.md'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-block reply and infer the shared workflow answers without explicit shared summaries.',
    })

    expect(response.status).toBe(200)
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-rollout-follow-through',
          workflowKey: 'auth-rollout-follow-through',
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
            {
              summary: 'Rollback trigger',
              prompt: 'Rollback trigger?',
              answer: 'Abort after two regressions.',
            },
          ],
        }),
        expect.objectContaining({
          requestKey: 'PR-3',
          workflowKey: 'auth-rollout-follow-through',
          workflowTaskKey: 'handoff-review',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          workflowSharedAnswers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
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
          createdDecisionKeys: ['rollout-strategy'],
          blockerRemoved: true,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-1', 'P-2'],
            blockerTaskRefs: ['P-2'],
          },
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
          createdDecisionKeys: ['rollout-strategy'],
          blockerRemoved: true,
          followThrough: {
            kind: 'planning_batch',
            groupKey: 'auth-rollout-follow-through',
            requestKeys: ['PR-1', 'PR-2'],
            taskRefs: ['P-1', 'P-2'],
            blockerTaskRefs: ['P-2'],
          },
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          taskRef: 'P-2',
          groupKey: 'auth-rollout-follow-through',
          decisionRefs: ['auth-strategy', 'rollout-strategy'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before wider rollout.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses one shared source response across decision and planner answers', async () => {
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one shared reply across auth, rollout, and pilot scope.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I captured one shared reply and routed it across the auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one shared reply across auth, rollout, and pilot scope.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I captured one shared reply and routed it across the auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['rollout-strategy'],
        }),
      ]),
    })

    const sharedResponse =
      'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.'
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: sharedResponse,
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: sharedResponse,
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: sharedResponse,
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: sharedResponse,
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses named answer sources across decision and planner answers', async () => {
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Extract reusable answer sources for auth, rollout, and pilot scope.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I extracted reusable answer sources and routed them across auth rollout follow-through.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'rollout-strategy-answer', answer: 'Use a staged rollout.' }, { answerSourceKey: 'pilot-scope-answer', answer: 'Start with five enterprise customers before broader rollout.' }], answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', answerSourceKey: 'auth-strategy-answer' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answerSourceKey: 'rollout-strategy-answer' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', answerSourceKey: 'pilot-scope-answer' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Extract reusable answer sources for auth, rollout, and pilot scope.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I extracted reusable answer sources and routed them across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth.',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader rollout.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses excerpt-backed answer sources across decision and planner answers', async () => {
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Ground reusable answer sources in one raw reply for auth, rollout, and pilot scope.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I grounded reusable answer sources in the raw reply and routed them across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.', answerSources: [{ answerSourceKey: 'auth-strategy-answer', sourceExcerpt: 'Use Bun-native auth' }, { answerSourceKey: 'rollout-strategy-answer', sourceExcerpt: 'a staged rollout' }, { answerSourceKey: 'pilot-scope-answer', sourceExcerpt: 'five enterprise customers before broader launch.' }], answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', answerSourceKey: 'auth-strategy-answer' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', answerSourceKey: 'rollout-strategy-answer' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', answerSourceKey: 'pilot-scope-answer' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Ground reusable answer sources in one raw reply for auth, rollout, and pilot scope.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I grounded reusable answer sources in the raw reply and routed them across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses direct item source excerpts across decision and planner answers', async () => {
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Ground each answer directly in one raw reply without defining named sources.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I grounded each answer directly in the raw reply and routed them across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth with a staged rollout to five enterprise customers before broader launch.', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy', sourceExcerpt: 'Use Bun-native auth' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy', sourceExcerpt: 'a staged rollout' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', sourceExcerpt: 'five enterprise customers before broader launch.' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Ground each answer directly in one raw reply without defining named sources.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I grounded each answer directly in the raw reply and routed them across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses labeled source sections across decision and planner answers', async () => {
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
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one labeled reply for auth, rollout, and pilot scope without per-topic mapping.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I used the labeled reply directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy: Use Bun-native auth', 'Rollout strategy: Use a staged rollout', 'Pilot scope: Start with five enterprise customers before broader launch.'].join('\\n'), sourceResponseFormat: 'labeled_sections', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one labeled reply for auth, rollout, and pilot scope without per-topic mapping.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I used the labeled reply directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          requestKey: 'PR-1',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from labeled source sections', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one labeled reply and infer the current open auth and rollout decisions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from the labeled reply.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy: Use Bun-native auth', 'Rollout strategy: Use a staged rollout', 'Pilot scope: Start with five enterprise customers before broader launch.'].join('\\n'), sourceResponseFormat: 'labeled_sections', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one labeled reply and infer the current open auth and rollout decisions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred the current open auth and rollout decisions from the labeled reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
          status: 'resolved',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from question blocks by exact durable prompt text', async () => {
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
      prompt: 'Should we use Bun-native auth or an external auth provider?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-block reply and infer the current open auth and rollout decisions from their exact questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from their exact question blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Should we use Bun-native auth or an external auth provider?', '', 'Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Should rollout happen in stages or all at once?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'question_blocks', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-block reply and infer the current open auth and rollout decisions from their exact questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I inferred the current open auth and rollout decisions from their exact question blocks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
          status: 'resolved',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from question blocks by durable prompt core text', async () => {
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-block reply and infer the current open auth and rollout decisions from their prompt cores.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from their durable prompt cores.', actions: [{ kind: 'record_answers', sourceResponse: ['What auth provider should we adopt?', '', 'Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'How should rollout happen?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'question_blocks', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-block reply and infer the current open auth and rollout decisions from their prompt cores.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I inferred the current open auth and rollout decisions from their durable prompt cores.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
          status: 'resolved',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from question blocks by durable prompt keyword anchors', async () => {
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-block reply and infer the current open auth and rollout decisions from durable prompt keywords.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from durable prompt keywords.', actions: [{ kind: 'record_answers', sourceResponse: ['Should we adopt the auth provider for the Bun-first product path?', '', 'Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Should rollout be all at once or in stages?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'question_blocks', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-block reply and infer the current open auth and rollout decisions from durable prompt keywords.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I inferred the current open auth and rollout decisions from durable prompt keywords.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
          status: 'resolved',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers new durable decision topics from remaining labeled sections', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one labeled reply and infer new decision topics from the remaining sections.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred new durable decision topics from the remaining labeled reply sections.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy: Use Bun-native auth', 'Rollout strategy: Use a staged rollout', 'Pilot scope: Start with five enterprise customers before broader launch.'].join('\\n'), sourceResponseFormat: 'labeled_sections', inferDecisionTopics: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one labeled reply and infer new decision topics from the remaining sections.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred new durable decision topics from the remaining labeled reply sections.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          createdDecisionKeys: ['D-1', 'D-2'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers new durable decision topics from remaining question blocks', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-block reply and infer new decision topics from the remaining questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred new durable decision topics from the remaining question blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy?', '', 'Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Rollout strategy?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'question_blocks', inferDecisionTopics: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-block reply and infer new decision topics from the remaining questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred new durable decision topics from the remaining question blocks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          createdDecisionKeys: ['D-1', 'D-2'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          prompt: 'Auth strategy?',
          answer: ['Use Bun-native auth.', 'That keeps the runtime simple.'].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          prompt: 'Rollout strategy?',
          answer: ['Use a staged rollout.', 'That keeps the launch reversible.'].join('\n\n'),
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          decisionRefs: ['D-1', 'D-2'],
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared planner answers from remaining question spans', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-span reply and infer the remaining planner answers without explicit follow-through summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared planner answers from the remaining question spans.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy?', 'Use Bun-native auth.', 'That keeps the runtime simple.', 'Rollout strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Pilot scope?', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable.'].join(' '), sourceResponseFormat: 'question_spans', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-span reply and infer the remaining planner answers without explicit follow-through summaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred shared planner answers from the remaining question spans.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared planner answers from remaining question closing spans', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-span reply and infer the remaining planner answers without explicit follow-through summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared planner answers from the remaining question closing spans.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', 'That keeps the runtime simple.', 'Auth strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Rollout strategy?', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable.', 'Pilot scope?'].join(' '), sourceResponseFormat: 'question_closing_spans', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-span reply and infer the remaining planner answers without explicit follow-through summaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred shared planner answers from the remaining question closing spans.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer:
                'Start with five enterprise customers before broader launch. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers shared planner answers from remaining question closing blocks', async () => {
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
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-block reply and infer the remaining planner answers without explicit follow-through summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred shared planner answers from the remaining question closing blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Auth strategy?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Rollout strategy?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.', '', 'Pilot scope?'].join('\\n'), sourceResponseFormat: 'question_closing_blocks', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', inferRemainingAnswers: true, requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-block reply and infer the remaining planner answers without explicit follow-through summaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred shared planner answers from the remaining question closing blocks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Pilot scope?',
              answer: [
                'Start with five enterprise customers before broader launch.',
                'That keeps early support manageable.',
              ].join('\n\n'),
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses question spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-span reply for auth, rollout, and pilot scope without question paragraphs.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question spans directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy?', 'Use Bun-native auth.', 'That keeps the runtime simple.', 'Rollout strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Pilot scope?', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable.'].join(' '), sourceResponseFormat: 'question_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-span reply for auth, rollout, and pilot scope without question paragraphs.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question spans directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses question clauses across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-clause reply for auth, rollout, and pilot scope without sentence or paragraph boundaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question clauses directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy? Use Bun-native auth,', 'Rollout strategy? Use a staged rollout,', 'Pilot scope? Start with five enterprise customers before broader launch.'].join(' '), sourceResponseFormat: 'question_clauses', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-clause reply for auth, rollout, and pilot scope without sentence or paragraph boundaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question clauses directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves one pending open decision from a single-pending shared reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one single-pending shared reply to answer the open auth decision without repeating its question.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the single pending auth decision from one shared reply.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth. That keeps the runtime simple.', sourceResponseFormat: 'single_pending', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await seedBoard(workspaceRoot, [
      task({
        ref: 'T-7',
        kind: 'engineering',
        status: 'planned',
        title: 'Implement auth rollout',
        description: 'Wait for the auth decision before engineering continues.',
        acceptanceCriteria: ['The auth rollout path is implemented.'],
        blockedBy: [{ kind: 'decision', ref: 'auth-strategy' }],
      }),
    ])
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one single-pending shared reply to answer the open auth decision without repeating its question.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved the single pending auth decision from one shared reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from one pending-clause shared reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one pending-clause shared reply to answer both open auth and rollout decisions without repeating their questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from one shared clause reply.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth; Use a staged rollout.', sourceResponseFormat: 'pending_clauses', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one pending-clause shared reply to answer both open auth and rollout decisions without repeating their questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from one shared clause reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from one pending-paragraph shared reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one pending-paragraph shared reply to answer both open auth and rollout decisions without repeating their questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from one shared paragraph reply.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth. That keeps the runtime simple.', 'Use a staged rollout. That keeps the launch reversible.'].join('\\n\\n'), sourceResponseFormat: 'pending_paragraphs', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one pending-paragraph shared reply to answer both open auth and rollout decisions without repeating their questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from one shared paragraph reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from one pending-sentence shared reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one pending-sentence shared reply to answer both open auth and rollout decisions without repeating their questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from one shared sentence reply.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth. Use a staged rollout.', sourceResponseFormat: 'pending_sentences', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one pending-sentence shared reply to answer both open auth and rollout decisions without repeating their questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from one shared sentence reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from one pending-conjunction shared reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one pending-conjunction shared reply to answer both open auth and rollout decisions without repeating their questions.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from one shared conjunction reply.', actions: [{ kind: 'record_answers', sourceResponse: 'Use Bun-native auth and use a staged rollout.', sourceResponseFormat: 'pending_conjunctions', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one pending-conjunction shared reply to answer both open auth and rollout decisions without repeating their questions.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from one shared conjunction reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from ordered pending answer sources without per-topic mapping', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve both open auth and rollout decisions from ordered reusable answer sources without mapping them per topic.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from ordered reusable answer sources.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'source-1', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'source-2', answer: 'Use a staged rollout.' }], sourceResponseFormat: 'pending_answer_sources', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve both open auth and rollout decisions from ordered reusable answer sources without mapping them per topic.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from ordered reusable answer sources.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves an open decision from matching answer sources by durable summaryKey', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open launch-sequencing decision from matching reusable answer sources by durable summaryKey.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open launch-sequencing decision from matching reusable answer sources by durable summaryKey.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'source-1', summaryKey: 'launch-shape', answer: 'Use a staged rollout.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'launch-sequencing',
      summary: 'Choose the launch sequencing',
      summaryKey: 'launch-shape',
      prompt: 'How should we phase the launch to users?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open launch-sequencing decision from matching reusable answer sources by durable summaryKey.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open launch-sequencing decision from matching reusable answer sources by durable summaryKey.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['launch-sequencing'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and resolves multiple pending open decisions from matching answer sources without per-topic mapping', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve both open auth and rollout decisions from matching reusable answer sources without mapping them per topic.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved both pending decisions from matching reusable answer sources.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'rollout-strategy-answer', answer: 'Use a staged rollout.' }, { answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve both open auth and rollout decisions from matching reusable answer sources without mapping them per topic.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I resolved both pending decisions from matching reusable answer sources.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from remaining matching answer sources without explicit answer mapping', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new pilot-scope decision from remaining matching answer sources.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new pilot-scope decision from remaining matching answer sources.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'pilot-scope-answer', summary: 'Pilot scope', prompt: 'What should the pilot scope be?', matchHints: ['launch cohort'], answer: 'Start with five enterprise customers before broader launch.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new pilot-scope decision from remaining matching answer sources.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new pilot-scope decision from remaining matching answer sources.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from canonical-prompt matching answer sources without explicit summary', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new pilot-scope decision from canonical-prompt matching answer sources.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new pilot-scope decision from canonical-prompt matching answer sources.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'pilot-scope-answer', prompt: 'What should the pilot scope be?', matchHints: ['launch cohort'], answer: 'Start with five enterprise customers before broader launch.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new pilot-scope decision from canonical-prompt matching answer sources.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new pilot-scope decision from canonical-prompt matching answer sources.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from question-shaped matching answer sources without explicit summary', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new rollout decision from question-shaped matching answer sources.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new rollout decision from question-shaped matching answer sources.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'rollout-answer', prompt: 'How should rollout happen?', matchHints: ['launch shape'], answer: 'Use a staged rollout.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new rollout decision from question-shaped matching answer sources.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new rollout decision from question-shaped matching answer sources.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from one stable match hint without explicit summary or prompt', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new rollout decision from one stable match hint.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new rollout decision from one stable match hint.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'rollout-answer', matchHints: ['launch shape'], answer: 'Use a staged rollout.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new rollout decision from one stable match hint.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new rollout decision from one stable match hint.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from stable answerSourceKey without explicit summary, prompt, or match hints', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new launch-shape decision from stable answerSourceKey authority.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new launch-shape decision from stable answerSourceKey authority.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'launch-shape-answer', answer: 'Use a staged rollout.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new launch-shape decision from stable answerSourceKey authority.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new launch-shape decision from stable answerSourceKey authority.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and records new durable decision topics from explicit summaryKey without explicit summary, prompt, match hints, or stable answerSourceKey', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Resolve the open auth decision and infer one new launch-shape decision from explicit summaryKey authority.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I resolved the open auth decision and inferred the new launch-shape decision from explicit summaryKey authority.', actions: [{ kind: 'record_answers', answerSources: [{ answerSourceKey: 'auth-strategy-answer', answer: 'Use Bun-native auth.' }, { answerSourceKey: 'source-2', summaryKey: 'launch-shape', answer: 'Use a staged rollout.' }], sourceResponseFormat: 'matching_answer_sources', inferOpenDecisions: true, inferDecisionTopics: true }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'auth-strategy',
      summary: 'Choose the auth strategy',
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Resolve the open auth decision and infer one new launch-shape decision from explicit summaryKey authority.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I resolved the open auth decision and inferred the new launch-shape decision from explicit summaryKey authority.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'D-1'],
          createdDecisionKeys: ['D-1'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses question middle spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-middle-span reply for auth, rollout, and pilot scope with one leading sentence and one trailing sentence around each question anchor.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question middle spans directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Keep the runtime simple.', 'Auth strategy?', 'Use Bun-native auth.', 'Launch in phases.', 'Rollout strategy?', 'Use a staged rollout.', 'Keep support load manageable.', 'Pilot scope?', 'Start with five enterprise customers before broader launch.'].join(' '), sourceResponseFormat: 'question_middle_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-middle-span reply for auth, rollout, and pilot scope with one leading sentence and one trailing sentence around each question anchor.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question middle spans directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses question middle blocks across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-middle-block reply for auth, rollout, and pilot scope with one leading paragraph and one trailing paragraph around each question anchor paragraph.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question middle blocks directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Keep the runtime simple.', '', 'Auth strategy?', '', 'Use Bun-native auth.', '', 'Launch in phases.', '', 'Rollout strategy?', '', 'Use a staged rollout.', '', 'Keep support load manageable.', '', 'Pilot scope?', '', 'Start with five enterprise customers before broader launch.'].join('\\n'), sourceResponseFormat: 'question_middle_blocks', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-middle-block reply for auth, rollout, and pilot scope with one leading paragraph and one trailing paragraph around each question anchor paragraph.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question middle blocks directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses question closing spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-span reply for auth, rollout, and pilot scope without front-loaded question sentences.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question closing spans directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', 'That keeps the runtime simple.', 'Auth strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Rollout strategy?', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable.', 'Pilot scope?'].join(' '), sourceResponseFormat: 'question_closing_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-span reply for auth, rollout, and pilot scope without front-loaded question sentences.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question closing spans directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses question closing blocks across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-closing-block reply for auth, rollout, and pilot scope without front-loaded question paragraphs.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the question closing blocks directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', '', 'That keeps the runtime simple.', '', 'Auth strategy?', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', 'Rollout strategy?', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.', '', 'Pilot scope?'].join('\\n'), sourceResponseFormat: 'question_closing_blocks', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one question-closing-block reply for auth, rollout, and pilot scope without front-loaded question paragraphs.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the question closing blocks directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses planner prompts across question spans', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one question-span reply where pilot scope is grounded by planner prompt text.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the planner prompt across the question spans.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy?', 'Use Bun-native auth.', 'That keeps the runtime simple.', 'Rollout strategy?', 'Use a staged rollout.', 'That keeps the launch reversible.', 'Which customers should pilot first before broader launch?', 'Start with five enterprise customers.', 'That keeps early support manageable.'].join(' '), sourceResponseFormat: 'question_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', prompt: 'Which customers should pilot first before broader launch?' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one question-span reply where pilot scope is grounded by planner prompt text.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the planner prompt across the question spans.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which customers should pilot first before broader launch?',
              answer: 'Start with five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which customers should pilot first before broader launch?',
              answer: 'Start with five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses inline topic clauses across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one inline topic reply for auth, rollout, and pilot scope.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the inline topic reply across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Auth strategy should use Bun-native auth;', 'rollout strategy should use a staged rollout;', 'pilot scope should start with five enterprise customers before broader launch.'].join(' '), sourceResponseFormat: 'inline_topics', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one inline topic reply for auth, rollout, and pilot scope.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the inline topic reply across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic clauses across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-clause reply for auth, rollout, and pilot scope without sentence boundaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic clauses across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth for auth strategy,', 'use a staged rollout for rollout strategy,', 'start with five enterprise customers before broader launch for pilot scope.'].join(' '), sourceResponseFormat: 'topic_clauses', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-clause reply for auth, rollout, and pilot scope without sentence boundaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic clauses across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic sentences across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-sentence reply for auth, rollout, and pilot scope without inline labels.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic sentences across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy.', 'Use a staged rollout for rollout strategy.', 'Start with five enterprise customers before broader launch for pilot scope.'].join(' '), sourceResponseFormat: 'topic_sentences', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-sentence reply for auth, rollout, and pilot scope without inline labels.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic sentences across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-span reply for auth, rollout, and pilot scope without blank-line block boundaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic spans across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy.', 'That keeps the runtime simple.', 'Use a staged rollout for rollout strategy.', 'That keeps the launch reversible.', 'Start with five enterprise customers before broader launch for pilot scope.', 'That keeps early support manageable.'].join(' '), sourceResponseFormat: 'topic_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-span reply for auth, rollout, and pilot scope without blank-line block boundaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic spans across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic middle spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-middle-span reply for auth, rollout, and pilot scope with one leading sentence and one trailing sentence around each topic anchor.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic middle spans across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Keep the runtime simple.', 'We should use Bun-native auth for auth strategy.', 'That avoids extra infra.', 'Launch in phases.', 'Use a staged rollout for rollout strategy.', 'That keeps the launch reversible.', 'Keep support load manageable.', 'Start with five enterprise customers before broader launch for pilot scope.', 'That keeps the pilot focused.'].join(' '), sourceResponseFormat: 'topic_middle_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-middle-span reply for auth, rollout, and pilot scope with one leading sentence and one trailing sentence around each topic anchor.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic middle spans across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic closing spans across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-closing-span reply for auth, rollout, and pilot scope without front-loaded topic anchors.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic closing spans across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth.', 'That keeps the runtime simple for auth strategy.', 'Use a staged rollout.', 'That keeps the launch reversible for rollout strategy.', 'Start with five enterprise customers before broader launch.', 'That keeps early support manageable for pilot scope.'].join(' '), sourceResponseFormat: 'topic_closing_spans', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-closing-span reply for auth, rollout, and pilot scope without front-loaded topic anchors.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic closing spans across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic closing blocks across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-closing-block reply for auth, rollout, and pilot scope without front-loaded topic anchor paragraphs.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic closing blocks across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth.', '', 'That keeps the runtime simple for auth strategy.', '', 'Use a staged rollout.', '', 'That keeps the launch reversible for rollout strategy.', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable for pilot scope.'].join('\\n'), sourceResponseFormat: 'topic_closing_blocks', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-closing-block reply for auth, rollout, and pilot scope without front-loaded topic anchor paragraphs.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic closing blocks across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses topic paragraphs across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-paragraph reply for auth, rollout, and pilot scope without repeating the topic in every sentence.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic paragraphs across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy. That keeps the runtime simple.', '', 'Use a staged rollout for rollout strategy. That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_paragraphs', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-paragraph reply for auth, rollout, and pilot scope without repeating the topic in every sentence.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic paragraphs across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and auto-detects topic paragraphs across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one shared reply and let runtime auto-detect the deterministic surface for auth, rollout, and pilot scope.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I let runtime auto-detect the shared reply surface across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy. That keeps the runtime simple.', '', 'Use a staged rollout for rollout strategy. That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'auto', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one shared reply and let runtime auto-detect the deterministic surface for auth, rollout, and pilot scope.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I let runtime auto-detect the shared reply surface across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from topic sentences by durable prompt keyword anchors', async () => {
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-sentence reply and infer the current open auth and rollout decisions from durable prompt keywords.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from durable prompt keywords in topic sentences.', actions: [{ kind: 'record_answers', sourceResponse: ['Adopt the Bun-native auth provider for the Bun-first product path.', 'Rollout should happen in stages, not once.', 'Start with five enterprise customers before broader launch for pilot scope.'].join(' '), sourceResponseFormat: 'topic_sentences', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-sentence reply and infer the current open auth and rollout decisions from durable prompt keywords.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I inferred the current open auth and rollout decisions from durable prompt keywords in topic sentences.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Adopt the Bun-native auth provider for the Bun-first product path.',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Rollout should happen in stages, not once.',
          status: 'resolved',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers new durable decision topics from remaining topic paragraphs', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-paragraph reply and infer new decision topics from the remaining topic summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred new durable decision topics from the remaining topic paragraphs.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy. That keeps the runtime simple.', '', 'Use a staged rollout for rollout strategy. That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope. That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_paragraphs', inferDecisionTopics: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-paragraph reply and infer new decision topics from the remaining topic summaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred new durable decision topics from the remaining topic paragraphs.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          createdDecisionKeys: ['D-1', 'D-2'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          prompt: 'What should the auth strategy be?',
          answer: 'We should use Bun-native auth for auth strategy. That keeps the runtime simple.',
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          prompt: 'What should the rollout strategy be?',
          answer: 'Use a staged rollout for rollout strategy. That keeps the launch reversible.',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and infers new durable decision topics from remaining topic blocks', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-block reply and infer new decision topics from the remaining topic summaries.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred new durable decision topics from the remaining topic blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy.', '', 'That keeps the runtime simple.', '', 'Use a staged rollout for rollout strategy.', '', 'That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_blocks', inferDecisionTopics: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-block reply and infer new decision topics from the remaining topic summaries.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I inferred new durable decision topics from the remaining topic blocks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          createdDecisionKeys: ['D-1', 'D-2'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'D-1',
          summary: 'Auth strategy',
          answer: [
            'We should use Bun-native auth for auth strategy.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
        }),
        expect.objectContaining({
          decisionKey: 'D-2',
          summary: 'Rollout strategy',
          answer: [
            'Use a staged rollout for rollout strategy.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses topic blocks across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-block reply for auth, rollout, and pilot scope with continuation paragraphs.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the topic blocks across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['We should use Bun-native auth for auth strategy.', '', 'That keeps the runtime simple.', '', 'Use a staged rollout for rollout strategy.', '', 'That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_blocks', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-block reply for auth, rollout, and pilot scope with continuation paragraphs.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the topic blocks across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and infers matching open decisions from topic blocks by durable prompt keyword anchors', async () => {
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
      prompt: 'Which auth provider should we adopt for the Bun-first product path?',
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should rollout happen in stages or all at once?',
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-block reply and infer the current open auth and rollout decisions from durable prompt keywords.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I inferred the current open auth and rollout decisions from durable prompt keywords in topic blocks.', actions: [{ kind: 'record_answers', sourceResponse: ['Adopt the Bun-native auth provider for the Bun-first product path.', '', 'That keeps the runtime simple.', '', 'Rollout should happen in stages, not once.', '', 'That keeps the launch reversible.', '', 'Start with five enterprise customers before broader launch for pilot scope.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_blocks', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-block reply and infer the current open auth and rollout decisions from durable prompt keywords.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message:
        'I inferred the current open auth and rollout decisions from durable prompt keywords in topic blocks.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: [
            'Adopt the Bun-native auth provider for the Bun-first product path.',
            'That keeps the runtime simple.',
          ].join('\n\n'),
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: [
            'Rollout should happen in stages, not once.',
            'That keeps the launch reversible.',
          ].join('\n\n'),
          status: 'resolved',
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses durable match hints across topic paragraphs', async () => {
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
      prompt:
        'Which authentication provider should the Bun-first runtime adopt before coding continues?',
      matchHints: ['login path'],
      taskRef: 'T-7',
    })
    await createDecisionStore(workspaceRoot).createDecision('test', {
      decisionKey: 'rollout-strategy',
      summary: 'Choose the rollout strategy',
      prompt: 'Should launch happen in waves or all at once after readiness review?',
      matchHints: ['launch shape'],
      taskRef: 'T-7',
    })
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one topic-paragraph reply and infer the current open auth and rollout decisions from durable match hints.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused durable match hints across the auth rollout topic paragraphs.', actions: [{ kind: 'record_answers', sourceResponse: ['Login path should use Bun-native auth. That keeps the runtime simple.', '', 'Launch shape should use a staged rollout. That keeps the launch reversible.', '', 'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'topic_paragraphs', inferOpenDecisions: true, followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope', prompt: 'Which cohort should we expose first after readiness review?', matchHints: ['early customer set'] }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Use one topic-paragraph reply and infer the current open auth and rollout decisions from durable match hints.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused durable match hints across the auth rollout topic paragraphs.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: [],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          matchHints: ['login path'],
          answer: 'Login path should use Bun-native auth. That keeps the runtime simple.',
          status: 'resolved',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          matchHints: ['launch shape'],
          answer: 'Launch shape should use a staged rollout. That keeps the launch reversible.',
          status: 'resolved',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which cohort should we expose first after readiness review?',
              matchHints: ['early customer set'],
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
        expect.objectContaining({
          answers: [
            {
              summary: 'Pilot scope',
              prompt: 'Which cohort should we expose first after readiness review?',
              matchHints: ['early customer set'],
              answer:
                'Early customer set should stay limited to five enterprise customers. That keeps early support manageable.',
            },
          ],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and reuses ordered blocks across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one ordered-block reply for auth, rollout, and pilot scope without labels.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the ordered blocks directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['Use Bun-native auth.', '', 'That keeps the runtime simple.', '', '', 'Use a staged rollout.', '', 'That keeps the launch reversible.', '', '', 'Start with five enterprise customers before broader launch.', '', 'That keeps early support manageable.'].join('\\n'), sourceResponseFormat: 'ordered_blocks', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one ordered-block reply for auth, rollout, and pilot scope without labels.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the ordered blocks directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
  })

  test('runs the configured Goal assistant and reuses ordered reply items across decisions and planner answers', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Use one ordered reply for auth, rollout, and pilot scope without labels.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I reused the ordered reply items directly across auth rollout follow-through.', actions: [{ kind: 'record_answers', sourceResponse: ['- Use Bun-native auth', '- Use a staged rollout', '- Start with five enterprise customers before broader launch.'].join('\\n'), sourceResponseFormat: 'ordered_items', answers: [{ decisionKey: 'auth-strategy', summary: 'Choose the auth strategy' }, { decisionKey: 'rollout-strategy', summary: 'Choose the rollout strategy' }], followThrough: { kind: 'planning_batch', groupKey: 'auth-rollout-follow-through', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Capture auth rollout goal context', description: 'Record the auth and rollout answers across Goal docs.', acceptanceCriteria: ['The auth and rollout answers are durable.'], requestedUpdates: ['goal.md', 'design.md', 'notes/rollout.md'] }, { taskKey: 'task-graph', title: 'Decompose auth rollout task graph', description: 'Reflect the auth and rollout answers in todo.yml.', acceptanceCriteria: ['The auth rollout task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] } }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Use one ordered reply for auth, rollout, and pilot scope without labels.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I reused the ordered reply items directly across auth rollout follow-through.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'record_answers',
          decisionKeys: ['auth-strategy', 'rollout-strategy'],
          createdDecisionKeys: ['auth-strategy', 'rollout-strategy'],
        }),
      ]),
    })
    await expect(
      createDecisionStore(workspaceRoot).readGoalDecisions('test'),
    ).resolves.toMatchObject({
      decisions: [
        expect.objectContaining({
          decisionKey: 'auth-strategy',
          answer: 'Use Bun-native auth',
        }),
        expect.objectContaining({
          decisionKey: 'rollout-strategy',
          answer: 'Use a staged rollout',
        }),
      ],
    })
    await expect(
      createPlanningRequestStore(workspaceRoot).readGoalPlanningRequests('test'),
    ).resolves.toMatchObject({
      requests: [
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
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

  test('runs the configured Goal assistant and materializes grouped planning answers from one shared single-pending reply', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Split the auth planning work and capture one shared pilot-scope reply without repeating any planner question.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I split the auth planning work and reused one shared pilot-scope reply.', actions: [{ kind: 'request_planning_batch', groupKey: 'auth-follow-through', sourceResponse: 'Start with five enterprise customers before broader launch.', sourceResponseFormat: 'single_pending', answers: [{ summary: 'Pilot scope' }], requests: [{ taskKey: 'goal-docs', title: 'Clarify auth goal context', description: 'Refresh durable Goal context before decomposition.', acceptanceCriteria: ['Goal context captures the auth direction.'], requestedUpdates: ['goal.md', 'design.md'] }, { taskKey: 'task-graph', title: 'Decompose auth task graph', description: 'Reshape todo.yml after the goal context is stable.', acceptanceCriteria: ['The auth task graph is visible in todo.yml.'], requestedUpdates: ['todo.yml'], blockedByTaskKeys: ['goal-docs'] }] }] })); console.log('assistant grouped planning requested')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content:
        'Split the auth planning work and capture one shared pilot-scope reply without repeating any planner question.',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'I split the auth planning work and reused one shared pilot-scope reply.',
      actionResults: expect.arrayContaining([
        expect.objectContaining({
          kind: 'request_planning_batch',
          groupKey: 'auth-follow-through',
          requestKeys: ['PR-1', 'PR-2'],
          taskRefs: ['P-1', 'P-2'],
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
        }),
        expect.objectContaining({
          requestKey: 'PR-2',
          groupKey: 'auth-follow-through',
          groupTaskKey: 'task-graph',
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Pilot scope',
              prompt: 'What should the pilot scope be?',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Rollout note',
              answer: 'Gate the first rollout behind pilot feedback.',
            }),
          ]),
          requestedUpdates: ['goal.md', 'notes/rollout.md'],
        }),
      ],
    })
  })

  test('runs the configured Goal assistant and materializes planner answers from matching answer sources by durable answerKey', async () => {
    const workspaceRoot = await initGitRepo(rootDir())
    await writeAdapterConfig(workspaceRoot, {
      version: 1,
      assistant: {
        cmd: [
          'bun',
          '-e',
          "const [promptFile, outcomeFile] = process.argv.slice(1); const prompt = await Bun.file(promptFile).text(); if (!prompt.includes('Capture rollout notes from matching reusable answer sources by durable answerKey.')) throw new Error('missing user message'); await Bun.write(outcomeFile, JSON.stringify({ message: 'I captured rollout notes from matching reusable answer sources by durable answerKey.', actions: [{ kind: 'request_planning', title: 'Capture rollout notes', description: 'Record rollout details before more planning work continues.', acceptanceCriteria: ['Rollout notes are durable.'], answerSources: [{ answerSourceKey: 'source-1', answerKey: 'pilot-scope', answer: 'Start with five enterprise customers before broader launch.' }], sourceResponseFormat: 'matching_answer_sources', answers: [{ summary: 'Early access cohort plan', answerKey: 'pilot-scope' }], requestedUpdates: ['goal.md', 'notes/rollout.md'] }] })); console.log('assistant finished')",
          '${PROMPT_FILE}',
          '${OUTCOME_FILE}',
        ],
        cwdMode: 'root',
      },
      roles: {},
    })

    const server = startServer(undefined, workspaceRoot)
    const response = await postJson(server, '/api/goals/test/assistant/run', {
      content: 'Capture rollout notes from matching reusable answer sources by durable answerKey.',
    })

    expect(response.status).toBe(200)
    const result = await readJson<{
      message: string
      actionResults: Array<{ kind: string; requestKey?: string; taskRef?: string }>
    }>(response)
    expect(result.message).toBe(
      'I captured rollout notes from matching reusable answer sources by durable answerKey.',
    )
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
          answers: expect.arrayContaining([
            expect.objectContaining({
              summary: 'Early access cohort plan',
              answerKey: 'pilot-scope',
              answer: 'Start with five enterprise customers before broader launch.',
            }),
          ]),
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
  params: {
    item: {
      type: 'local_shell_call',
      tool_name: 'Bash',
      call_id: 'shell-1',
      command: 'bun test packages/backend/tests/server.test.ts',
    },
  },
}))
console.log(JSON.stringify({
  method: 'item/completed',
  params: {
    item: {
      type: 'local_shell_call_output',
      tool_name: 'Bash',
      call_id: 'shell-1',
      content: 'Command completed successfully.',
    },
  },
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
              toolInvocationKey: 'shell-1',
              summary: 'Tool call: Bash (bun test packages/backend/tests/server.test.ts)',
              vendorEventType: 'item/completed',
            },
            {
              transport: 'codex',
              kind: 'tool_result',
              toolName: 'Bash',
              toolInvocationKey: 'shell-1',
              summary: 'Command completed successfully.',
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
  activeRootDir ??= join(tmpBase, `workspace-${++workspaceCounter}`)
  return activeRootDir
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
  return server.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
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
