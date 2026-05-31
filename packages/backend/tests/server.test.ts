import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRunner } from '../src/agent/AgentRunner'
import { createServer } from '../src/index'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'server')
const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createServer', () => {
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
    const board = await boardResponse.json()
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
    const board = await boardResponse.json()
    expect(board.items[0].status).toBe('in_review')
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
    const board = await moveResponse.json()
    expect(board.items[0].status).toBe('in_review')
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
    const board = await boardResponse.json()
    expect(board.items[0].status).toBe('planned')

    const events = await Bun.file(
      join(rootDir(), '.hopi', 'docs', 'goals', 'test', 'events.jsonl'),
    ).text()
    expect(events).toContain('"action":"system_error"')
    expect(events).toContain('adapter exploded')
  })
})

function startServer(runner?: AgentRunner) {
  const server = createServer({ rootDir: rootDir(), port: 0, runner })
  servers.push(server)
  return server
}

function rootDir() {
  return join(tmpBase, 'workspace')
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
