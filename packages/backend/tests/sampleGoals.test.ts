import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBoardYaml } from '../src/domain/validation'

const goalsRoot = join(process.cwd(), '..', '..', '.hopi', 'docs', 'goals')

describe('sample goal boards', () => {
  test('all checked-in todo boards use the current schema', async () => {
    const goalKeys = await readdir(goalsRoot)

    for (const goalKey of goalKeys) {
      const todoPath = join(goalsRoot, goalKey, 'todo.yml')
      const source = await Bun.file(todoPath).text()
      expect(parseBoardYaml(source)).toMatchObject({
        version: 1,
        goal: { goalKey },
      })
    }
  })
})
