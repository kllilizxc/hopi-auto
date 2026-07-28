import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { renderWorkDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'
import { migrateLegacyGoals } from '../src/storage/legacyGoalMigration'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'legacy-goal-migration')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(join(temporaryRoot, '.hopi/docs/goals/G-1'), { recursive: true })
  await Bun.write(
    join(temporaryRoot, '.hopi/docs/goals/G-1/goal.md'),
    '# Legacy Goal\n\nShip it.\n',
  )
  await Bun.write(join(temporaryRoot, '.hopi/docs/goals/G-1/design.md'), '# Legacy Design\n')
  await Bun.write(
    join(temporaryRoot, '.hopi/docs/goals/G-1/todo.yml'),
    [
      'version: 1',
      'goal:',
      '  goalKey: G-1',
      '  title: Legacy Goal',
      'items:',
      '  - ref: W-done',
      '    kind: engineering',
      '    status: done',
      '    title: Historical work',
      '    description: Already in the repository.',
      '  - ref: W-open',
      '    kind: engineering',
      '    status: in_progress',
      '    title: Remaining work',
      '    description: Finish the behavior.',
      '    acceptanceCriteria:',
      '      - The behavior is verified.',
      '    dependencyTaskList:',
      '      - W-done',
      '    blockedBy:',
      '      - kind: intervention',
      '        ref: W-open:agent_failed',
      '',
    ].join('\n'),
  )
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('legacy Goal migration', () => {
  test('updates only the old system initial Planning contract and converges', async () => {
    await rm(join(temporaryRoot, '.hopi/docs/goals/G-1'), { recursive: true, force: true })
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    const created = await store.createGoal({
      goalId: 'G-1',
      title: 'Canonical Goal',
      objective: 'Ship the current boundary.',
    })
    const work = created.works.get('plan-initial')
    expect(work).toBeDefined()
    if (!work) throw new Error('Expected initial Planning Work')
    const oldBody = work.body
      .replace(
        'Clarify the current Goal boundary and accepted Inputs, then update design and only the Engineering Work needed to reach it.',
        'Clarify the current Goal contract and accepted Inputs, then update design and the smallest complete Engineering Work DAG.',
      )
      .replace(
        'Design and nonterminal Engineering Work reflect the current Goal boundary.',
        'The design documents and smallest complete Engineering Work DAG are current.',
      )
      .replace(
        'Deferred or removed outcomes do not remain in current Work or completion criteria.',
        'Each Engineering Work owns one terminal proof boundary.',
      )
    await Bun.write(
      store.paths.absolute(store.paths.workDocument('G-1', 'plan-initial')),
      renderWorkDocument({ attributes: work.attributes, body: oldBody }),
    )

    await expect(
      migrateLegacyGoals(store.paths, publisher, {
        beforeGateWrite() {
          throw new Error('crash before template update')
        },
      }),
    ).rejects.toThrow('crash before template update')
    expect(
      await Bun.file(store.paths.absolute(store.paths.workDocument('G-1', 'plan-initial'))).text(),
    ).toContain('smallest complete Engineering Work DAG')
    expect(await store.migrateLegacyGoals()).toEqual([
      { goalId: 'G-1', kind: 'planning_template_updated' },
    ])
    expect((await store.readPackage('G-1')).works.get('plan-initial')?.body).toContain(
      'only the Engineering Work needed to reach it',
    )
    expect(await store.migrateLegacyGoals()).toEqual([{ goalId: 'G-1', kind: 'already_canonical' }])
  })

  test('converges todo.yml into canonical documents without fabricating completion Evidence', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)

    expect(await store.migrateLegacyGoals()).toEqual([{ goalId: 'G-1', kind: 'migrated' }])
    const goalPackage = await store.readPackage('G-1')

    expect(goalPackage.goal.attributes).toMatchObject({
      id: 'G-1',
      lifecycle: 'active',
      contractRevision: 1,
    })
    expect([...goalPackage.works.keys()].sort()).toEqual(['W-open', 'plan-migration'])
    expect(goalPackage.works.get('W-open')?.attributes).toMatchObject({
      stage: 'generate',
      dependsOn: [],
    })
    expect(goalPackage.works.get('W-open')?.attributes).not.toHaveProperty('attempts')
    expect(goalPackage.evidence.size).toBe(0)
    expect([...goalPackage.attentions.values()][0]?.attributes.target).toBe(
      'project:P-1/goal:G-1/work:W-open',
    )
    expect(
      await Bun.file(join(temporaryRoot, '.hopi/docs/goals/G-1/design/legacy-work.md')).text(),
    ).toContain('W-done')
    expect(await Bun.file(join(temporaryRoot, '.hopi/docs/goals/G-1/todo.yml')).exists()).toBe(true)
    expect(await store.migrateLegacyGoals()).toEqual([{ goalId: 'G-1', kind: 'already_canonical' }])
  })

  test('restarts safely after supporting writes land before the Planning gate', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)

    await expect(
      migrateLegacyGoals(store.paths, publisher, {
        beforeGateWrite() {
          throw new Error('crash before gate')
        },
      }),
    ).rejects.toThrow('crash before gate')
    expect(
      await Bun.file(
        store.paths.absolute(store.paths.workDocument('G-1', 'plan-migration')),
      ).exists(),
    ).toBe(false)

    expect(await store.migrateLegacyGoals()).toEqual([{ goalId: 'G-1', kind: 'migrated' }])
    expect((await store.readPackage('G-1')).works.has('plan-migration')).toBe(true)
  })
})
