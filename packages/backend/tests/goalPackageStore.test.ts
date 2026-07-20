import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseGoalDocument,
  parseWorkDocument,
  renderGoalDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { GoalPackageValidationError } from '../src/domain/goalPackage'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import type { PublicationRoot } from '../src/publication/types'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'goal-package-store')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('createGoalPackageStore', () => {
  test('creates Goal, design, and Planning Work through the initial Planning gate', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)

    const goalPackage = await store.createGoal({
      goalId: 'G-1',
      title: 'Align HOPI with the MVP',
      objective: 'Replace every legacy workflow authority.',
      constraints: ['Never mutate a user checkout.'],
      successCriteria: ['All MVP acceptance scenarios pass.'],
      priority: 10,
    })

    expect(goalPackage.goal.attributes).toEqual({
      id: 'G-1',
      title: 'Align HOPI with the MVP',
      lifecycle: 'active',
      priority: 10,
      contractRevision: 1,
      completionAttentionId: null,
    })
    expect([...goalPackage.works.values()].map((work) => work.attributes)).toEqual([
      expect.objectContaining({ id: 'plan-initial', kind: 'planning', stage: 'plan' }),
    ])
    expect(goalPackage.goal.body).toContain('## Constraints\n\n- Never mutate a user checkout.')
    expect(goalPackage.goal.body).toContain(
      '## Success Criteria\n\n- All MVP acceptance scenarios pass.',
    )
    expect(goalPackage.goal.body).not.toContain('## Non-Goals')
    const planning = [...goalPackage.works.values()][0]
    expect(planning?.body).toContain('Clarify the current Goal contract and accepted Inputs')
    expect(planning?.body).not.toContain('Replace every legacy workflow authority.')
    expect(await Bun.file(store.paths.absolute(store.paths.designIndex('G-1'))).text()).toContain(
      '## Current Design',
    )
    expect(await Bun.file(join(temporaryRoot, '.hopi/docs/goals/G-1/todo.yml')).exists()).toBe(
      false,
    )
  })

  test('creates a new Goal through one Assistant-dispatched Engineering gate', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)

    const goalPackage = await store.createGoal({
      goalId: 'G-direct',
      title: 'Direct delivery',
      objective: 'Deliver one bounded change.',
      acceptedInput: {
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: 'EV-1',
          sourceDigest: 'a'.repeat(64),
          attachments: [],
        },
        body: 'Deliver one bounded change.\n',
      },
      initialEngineeringWork: {
        id: 'W-direct',
        title: 'Deliver the bounded change',
        objective: 'Implement the accepted bounded change.',
        acceptanceCriteria: ['The bounded change works as requested.'],
        repos: ['repo'],
        assistantDispatch: 'home:H-1/event:EV-1',
      },
    })

    expect([...goalPackage.works.values()]).toHaveLength(1)
    expect(goalPackage.works.get('W-direct')?.attributes).toMatchObject({
      kind: 'engineering',
      stage: 'generate',
      repos: ['repo'],
      assistantDispatch: 'home:H-1/event:EV-1',
    })
    expect(goalPackage.works.get('W-direct')?.body).toContain('/H-1/EV-1.md')
    expect(goalPackage.works.has('plan-initial')).toBe(false)
  })

  test('keeps Assistant dispatch provenance immutable', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await store.createGoal({
      goalId: 'G-direct',
      title: 'Direct delivery',
      objective: 'Deliver one bounded change.',
      acceptedInput: {
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: 'EV-1',
          sourceDigest: 'a'.repeat(64),
          attachments: [],
        },
        body: 'Deliver one bounded change.\n',
      },
      initialEngineeringWork: {
        id: 'W-direct',
        title: 'Deliver the bounded change',
        objective: 'Implement the accepted bounded change.',
        acceptanceCriteria: ['The bounded change works as requested.'],
        repos: ['repo'],
        assistantDispatch: 'home:H-1/event:EV-1',
      },
    })
    const path = store.paths.workDocument('G-direct', 'W-direct')
    const source = await Bun.file(store.paths.absolute(path)).text()
    const work = parseWorkDocument(source)
    if (work.attributes.kind !== 'engineering') throw new Error('Expected Engineering Work')
    work.attributes.assistantDispatch = undefined

    await expect(
      store.publishGoal('G-direct', {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(work),
        },
      }),
    ).rejects.toBeInstanceOf(GoalPackageValidationError)
    expect(
      parseWorkDocument(await Bun.file(store.paths.absolute(path)).text()).attributes,
    ).toHaveProperty('assistantDispatch', 'home:H-1/event:EV-1')
  })

  test('rejects a second nonterminal Planning Work without publishing it', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    const created = await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    expect(created.goal.body).not.toContain('## Constraints')
    expect(created.goal.body).not.toContain('## Non-Goals')
    expect(created.goal.body).not.toContain('## Success Criteria')
    expect(created.works.get('plan-initial')?.body).not.toContain('Ship it.')
    const secondPlanningPath = store.paths.workDocument('G-1', 'plan-second')

    await expect(
      publisher.publish({
        root: store.paths.publicationRoot,
        supportingWrites: [],
        gateWrite: {
          path: secondPlanningPath,
          expectedHash: null,
          content: renderWorkDocument({
            attributes: {
              id: 'plan-second',
              title: 'Plan again',
              kind: 'planning',
              stage: 'plan',
              notBefore: null,
              dependsOn: [],
              contractRevision: 1,
              evidenceRefs: [],
              attempts: 0,
            },
            body: 'Plan again.\n',
          }),
        },
        validateCandidate: async (candidate) => {
          const { readAndValidateGoalPackage } = await import('../src/domain/goalPackage')
          await readAndValidateGoalPackage(candidate, store.paths, 'G-1')
        },
      }),
    ).rejects.toBeInstanceOf(GoalPackageValidationError)

    expect(await Bun.file(store.paths.absolute(secondPlanningPath)).exists()).toBe(false)
  })

  test('rejects nonterminal Work more than one revision ahead of its Planning guard', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const planningPath = store.paths.workDocument('G-1', 'plan-initial')
    const currentSource = await Bun.file(store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(currentSource)
    planning.attributes.contractRevision = 3

    await expect(
      publisher.publish({
        root: store.paths.publicationRoot,
        supportingWrites: [],
        gateWrite: {
          path: planningPath,
          expectedHash: await hashBytes(new TextEncoder().encode(currentSource)),
          content: renderWorkDocument(planning),
        },
        validateCandidate: async (candidate) => {
          const { readAndValidateGoalPackage } = await import('../src/domain/goalPackage')
          await readAndValidateGoalPackage(candidate, store.paths, 'G-1')
        },
      }),
    ).rejects.toThrow('invalid contractRevision')

    expect(await Bun.file(store.paths.absolute(planningPath)).text()).toBe(currentSource)
  })

  test('keeps routed Inputs byte-immutable after their first publication', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const inputPath = store.paths.inputDocument('G-1', 'H-1', 'EV-1')
    const inputSource = renderInputDocument({
      attributes: {
        sourceHomeId: 'H-1',
        sourceEventId: 'EV-1',
        sourceDigest: 'a'.repeat(64),
        attachments: [],
      },
      body: 'Original user instruction.\n',
    })
    await store.publishGoal('G-1', {
      supportingWrites: [{ path: inputPath, expectedHash: null, content: inputSource }],
    })

    await expect(
      store.publishGoal('G-1', {
        supportingWrites: [
          {
            path: inputPath,
            expectedHash: await hashBytes(new TextEncoder().encode(inputSource)),
            content: inputSource.replace('Original', 'Rewritten'),
          },
        ],
      }),
    ).rejects.toThrow('Input is immutable')

    expect(await Bun.file(store.paths.absolute(inputPath)).text()).toBe(inputSource)
  })

  test('preserves permanent dependency edges across later Work publications', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const planningPath = store.paths.workDocument('G-1', 'plan-initial')
    const planningSource = await Bun.file(store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    planning.attributes.stage = 'done'
    const firstWork = engineeringWork('W-1', [])
    const secondWork = engineeringWork('W-2', ['W-1'])
    const secondWorkPath = store.paths.workDocument('G-1', 'W-2')

    await store.publishGoal('G-1', {
      supportingWrites: [
        {
          path: store.paths.workDocument('G-1', 'W-1'),
          expectedHash: null,
          content: renderWorkDocument(firstWork),
        },
        {
          path: secondWorkPath,
          expectedHash: null,
          content: renderWorkDocument(secondWork),
        },
      ],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
        content: renderWorkDocument(planning),
      },
    })

    const secondSource = await Bun.file(store.paths.absolute(secondWorkPath)).text()
    secondWork.attributes.dependsOn = []
    await expect(
      store.publishGoal('G-1', {
        supportingWrites: [],
        gateWrite: {
          path: secondWorkPath,
          expectedHash: await hashBytes(new TextEncoder().encode(secondSource)),
          content: renderWorkDocument(secondWork),
        },
      }),
    ).rejects.toThrow('dependency history was removed')
    expect(await Bun.file(store.paths.absolute(secondWorkPath)).text()).toBe(secondSource)
  })

  test('requires a contract revision when Goal contract Markdown changes', async () => {
    const publisher = new PublicationCoordinator()
    const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const goalPath = store.paths.goalDocument('G-1')
    const source = await Bun.file(store.paths.absolute(goalPath)).text()
    const goal = parseGoalDocument(source)
    goal.body += '\nNew success criterion.\n'

    await expect(
      store.publishGoal('G-1', {
        supportingWrites: [],
        gateWrite: {
          path: goalPath,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderGoalDocument(goal),
        },
      }),
    ).rejects.toThrow('without a contractRevision increment')
  })

  test('reuses the Coordinator reconciliation snapshot until publication changes', async () => {
    const publisher = new CountingPublicationCoordinator()
    const writer = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    await writer.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const reader = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
    publisher.snapshotTreeReads = 0

    expect([...(await reader.readReconciliationSnapshot()).keys()]).toEqual(['G-1'])
    expect([...(await reader.readReconciliationSnapshot()).keys()]).toEqual(['G-1'])
    expect(publisher.snapshotTreeReads).toBe(1)

    await publisher.publish({
      root: reader.paths.publicationRoot,
      supportingWrites: [
        {
          path: `${reader.paths.designRoot('G-1')}/notes.md`,
          expectedHash: null,
          content: '# Notes\n',
        },
      ],
      validateCandidate() {},
    })
    expect([...(await reader.readReconciliationSnapshot()).keys()]).toEqual(['G-1'])
    expect(publisher.snapshotTreeReads).toBe(2)
  })
})

class CountingPublicationCoordinator extends PublicationCoordinator {
  snapshotTreeReads = 0

  override snapshotTreeAtGeneration(root: PublicationRoot, prefix = '') {
    this.snapshotTreeReads += 1
    return super.snapshotTreeAtGeneration(root, prefix)
  }
}

function engineeringWork(id: string, dependsOn: string[]) {
  return {
    attributes: {
      id,
      title: `Build ${id}`,
      kind: 'engineering' as const,
      stage: 'generate' as const,
      notBefore: null,
      dependsOn,
      contractRevision: 1,
      evidenceRefs: [],
      attempts: 0,
    },
    body: `Implement ${id}.\n`,
  }
}
