import { describe, expect, test } from 'bun:test'
import { parseBoardYaml, stringifyBoardYaml, validateBoard } from '../src/domain/validation'

function engineeringTask(ref: string, blockedBy: { kind: 'task'; ref: string }[] = []) {
  return {
    ref,
    kind: 'engineering',
    status: 'planned',
    title: `Task ${ref}`,
    description: `Description for ${ref}`,
    acceptanceCriteria: [`${ref} passes`],
    blockedBy,
  }
}

function validBoard() {
  return {
    version: 1,
    goal: { goalKey: 'g', title: 'Goal' },
    items: [
      engineeringTask('T-1'),
      {
        ref: 'T-2',
        kind: 'planning',
        status: 'planned',
        title: 'Plan the next task',
        description: 'Produce a proposal for follow-up work.',
        acceptanceCriteria: ['Proposal includes task refs and acceptance criteria.'],
        blockedBy: [{ kind: 'task', ref: 'T-1' }],
      },
    ],
  }
}

describe('validateBoard', () => {
  test('accepts the phase 1 task schema', () => {
    const board = validateBoard(validBoard())

    expect(board.goal.goalKey).toBe('g')
    expect(board.items).toHaveLength(2)
    expect(board.items[0]?.kind).toBe('engineering')
    expect(board.items[1]?.blockedBy).toEqual([{ kind: 'task', ref: 'T-1' }])
  })

  test('defaults blockedBy to an empty array', () => {
    const raw = {
      version: 1,
      goal: { goalKey: 'g', title: 'Goal' },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'Implement atomic writes',
          description: 'Make writes safe under concurrent calls.',
          acceptanceCriteria: ['Concurrent writes do not corrupt todo.yml.'],
        },
      ],
    }

    const board = validateBoard(raw)

    expect(board.items[0]?.blockedBy).toEqual([])
  })

  test('rejects duplicate task refs', () => {
    const raw = {
      version: 1,
      goal: { goalKey: 'g', title: 'Goal' },
      items: [engineeringTask('T-1'), engineeringTask('T-1')],
    }

    expect(() => validateBoard(raw)).toThrow('Duplicate task ref found: T-1')
  })

  test('rejects task blockers that reference missing tasks', () => {
    const raw = {
      version: 1,
      goal: { goalKey: 'g', title: 'Goal' },
      items: [
        engineeringTask('T-1'),
        {
          ...engineeringTask('T-2'),
          blockedBy: [{ kind: 'task', ref: 'T-missing' }],
        },
      ],
    }

    expect(() => validateBoard(raw)).toThrow("Task 'T-2' is blocked by unknown task 'T-missing'")
  })

  test('rejects task blocker cycles', () => {
    const board = {
      version: 1,
      goal: { goalKey: 'g', title: 'Goal' },
      items: [
        {
          ref: 'T-1',
          kind: 'engineering',
          status: 'planned',
          title: 'One',
          description: 'One',
          acceptanceCriteria: ['One passes'],
          blockedBy: [{ kind: 'task', ref: 'T-2' }],
        },
        {
          ref: 'T-2',
          kind: 'engineering',
          status: 'planned',
          title: 'Two',
          description: 'Two',
          acceptanceCriteria: ['Two passes'],
          blockedBy: [{ kind: 'task', ref: 'T-1' }],
        },
      ],
    }

    expect(() => validateBoard(board)).toThrow('Task blocker cycle detected: T-1 -> T-2 -> T-1')
  })
})

describe('YAML helpers', () => {
  test('round-trips board YAML through validation', () => {
    const yaml = stringifyBoardYaml(validateBoard(validBoard()))
    const board = parseBoardYaml(yaml)

    expect(board.items.map((item) => item.ref)).toEqual(['T-1', 'T-2'])
  })
})
