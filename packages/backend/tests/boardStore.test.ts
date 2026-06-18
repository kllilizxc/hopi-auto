import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskItem } from '../src/domain/board'
import { createBoardStore } from '../src/storage/boardStore'

const tmpRoot = join(process.cwd(), 'tests', 'tmp', 'board-store')

function task(ref: string): TaskItem {
  return {
    ref,
    kind: 'engineering',
    status: 'planned',
    title: `Task ${ref}`,
    description: `Description for ${ref}`,
    acceptanceCriteria: [`${ref} passes`],
    blockedBy: [],
  }
}

async function resetTmpRoot() {
  await rm(tmpRoot, { recursive: true, force: true })
}

afterEach(async () => {
  await resetTmpRoot()
})

describe('createBoardStore', () => {
  test('reads a missing board as an empty goal board', async () => {
    const store = createBoardStore(tmpRoot)
    const board = await store.readBoard('missing-goal')

    expect(board).toEqual({
      version: 1,
      goal: { goalKey: 'missing-goal', title: 'Goal: missing-goal' },
      items: [],
    })
  })

  test('writes a mutated board and appends an event', async () => {
    const store = createBoardStore(tmpRoot)

    await store.mutateBoard('g', 'test', 'add task', (board) => {
      board.items.push(task('T-1'))
    })

    const board = await store.readBoard('g')
    expect(board.items.map((item) => item.ref)).toEqual(['T-1'])

    const events = await Bun.file(store.paths.eventsPath('g')).text()
    const lines = events.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      writer: 'test',
      action: 'board_mutated',
      goalKey: 'g',
      reason: 'add task',
    })
  })

  test('reads legacy pending task status as planned', async () => {
    const store = createBoardStore(tmpRoot)
    await Bun.write(
      store.paths.todoPath('g'),
      `version: 1
goal:
  goalKey: g
  title: Goal
items:
  - ref: T-1
    kind: engineering
    status: pending
    title: Task T-1
    description: Description for T-1
    acceptanceCriteria:
      - T-1 passes
`,
    )

    const board = await store.readBoard('g')

    expect(board.items[0]?.status).toBe('planned')
  })

  test('supports explicit event appends', async () => {
    const store = createBoardStore(tmpRoot)

    const event = await store.appendEvent('g', {
      writer: 'test',
      action: 'system_error',
      goalKey: 'g',
      systemError: {
        kind: 'schema_validation_failed',
        message: 'Invalid board',
        correlationId: 'c-1',
      },
    })

    expect(event.id).toBeTruthy()
    expect(event.timestamp).toBeTruthy()

    const events = await Bun.file(store.paths.eventsPath('g')).text()
    expect(JSON.parse(events.trim())).toMatchObject({
      action: 'system_error',
      systemError: { correlationId: 'c-1' },
    })
  })

  test('serializes concurrent board mutations behind the lock', async () => {
    const store = createBoardStore(tmpRoot)
    const refs = Array.from({ length: 10 }, (_, index) => `T-${index + 1}`)

    await Promise.all(
      refs.map((ref) =>
        store.mutateBoard('g', 'test', `add ${ref}`, (board) => {
          board.items.push(task(ref))
        }),
      ),
    )

    const board = await store.readBoard('g')
    expect(board.items.map((item) => item.ref).sort()).toEqual(refs.sort())

    const events = await Bun.file(store.paths.eventsPath('g')).text()
    expect(events.trim().split('\n')).toHaveLength(10)
  })

  test('migrates legacy events out of durable goal docs before appending new runtime events', async () => {
    const store = createBoardStore(tmpRoot)
    const legacyPath = join(tmpRoot, '.hopi', 'docs', 'goals', 'g', 'events.jsonl')
    await mkdir(join(tmpRoot, '.hopi', 'docs', 'goals', 'g'), { recursive: true })
    await writeFile(
      legacyPath,
      `${JSON.stringify({
        id: 'legacy-1',
        timestamp: '2026-06-16T00:00:00.000Z',
        writer: 'legacy',
        action: 'board_mutated',
        goalKey: 'g',
        reason: 'legacy append',
      })}\n`,
      'utf8',
    )

    await store.appendEvent('g', {
      writer: 'test',
      action: 'system_error',
      goalKey: 'g',
      systemError: {
        kind: 'schema_validation_failed',
        message: 'Invalid board',
        correlationId: 'c-1',
      },
    })

    const runtimePath = store.paths.eventsPath('g')
    const runtimeEvents = await Bun.file(runtimePath).text()
    expect(runtimeEvents.trim().split('\n')).toHaveLength(2)
    expect(await Bun.file(legacyPath).exists()).toBeFalse()
  })
})
