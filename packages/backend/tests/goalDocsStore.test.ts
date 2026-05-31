import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createGoalDocsStore } from '../src/runtime/goalDocsStore'

const tmpBase = join(process.cwd(), 'tests', 'tmp', 'goal-docs-store')

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
})

describe('createGoalDocsStore', () => {
  test('bootstraps missing goal docs and reports bootstrap status', async () => {
    const store = createGoalDocsStore(testRoot())

    const docs = await store.readGoalDocs('goal-1', 'Goal One')

    expect(docs.goal.path).toContain('.hopi/docs/goals/goal-1/goal.md')
    expect(docs.design.path).toContain('.hopi/docs/goals/goal-1/design.md')
    expect(docs.goal.status).toBe('bootstrapped')
    expect(docs.design.status).toBe('bootstrapped')
    expect(docs.goal.content).toContain('# Goal One')
    expect(docs.design.content).toContain('Durable design detail has not been recorded yet.')
  })

  test('reports customized docs after durable edits', async () => {
    const store = createGoalDocsStore(testRoot())
    const initial = await store.readGoalDocs('goal-2', 'Goal Two')

    await Bun.write(
      initial.design.path,
      '# Design: Goal Two\n\n## Problem\n\nReal design detail.\n',
    )

    const docs = await store.readGoalDocs('goal-2', 'Goal Two')

    expect(docs.goal.status).toBe('bootstrapped')
    expect(docs.design.status).toBe('curated')
    expect(docs.design.content).toContain('Real design detail.')
  })
})

function testRoot() {
  return join(tmpBase, crypto.randomUUID())
}
