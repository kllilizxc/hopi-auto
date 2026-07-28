import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'goal-controller')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('GoalController', () => {
  test('refreshes the reused Planning objective to the latest trigger', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })

    await controller.ensurePlanning('G-1', 'Assess the first trigger.')
    const first = (await store.readPackage('G-1')).works.get('plan-initial')
    expect(first?.body).toContain('Assess the first trigger.')

    await controller.ensurePlanning('G-1', 'Reconcile the latest accepted instruction.')
    const latest = (await store.readPackage('G-1')).works.get('plan-initial')
    expect(latest?.body).toContain('Reconcile the latest accepted instruction.')
    expect(latest?.body).not.toContain('Assess the first trigger.')
    expect(latest?.body).toContain('## Acceptance Criteria')
  })

  test('Pause and Resume retain lifecycle simplicity and ensure Planning before activation', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const initialPlanning = await markPlanningDone(store, 'G-1', 'plan-initial')

    await expect(controller.pauseGoal('G-1')).resolves.toMatchObject({
      attributes: { lifecycle: 'paused' },
    })
    const resumed = await controller.resumeGoal('G-1')
    const goalPackage = await store.readPackage('G-1')

    expect(resumed.attributes.lifecycle).toBe('active')
    expect(initialPlanning.attributes.stage).toBe('done')
    expect(
      [...goalPackage.works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(1)
  })

  test('installs current Planning and leaves prior Engineering authority stale', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'review',
      dependsOn: [],
    })

    const revised = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      contractChange: 'Add a measurable latency criterion before implementation continues.',
    })
    const goalPackage = await store.readPackage('G-1')

    expect(revised.attributes.contractRevision).toBe(2)
    expect(revised.body).toBe('## Objective\n\nShip it.\n')
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'review',
      contractRevision: 1,
    })
    const currentPlanning = [...goalPackage.works.values()].find(
      (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
    )
    expect(currentPlanning?.attributes.contractRevision).toBe(2)
    expect(currentPlanning?.body).toContain(
      'Add a measurable latency criterion before implementation continues.',
    )

    const repeated = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      contractChange: 'Add a measurable latency criterion before implementation continues.',
    })
    expect(repeated.attributes.contractRevision).toBe(2)
  })

  test('applies a material revision after its Inbox Input was already accepted', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const inputPath = store.paths.inputDocument('G-1', 'H-1', 'EV-revise')
    const inputWrite = {
      path: inputPath,
      expectedHash: null,
      content: renderInputDocument({
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: 'EV-revise',
          sourceDigest: 'a'.repeat(64),
          attachments: [],
        },
        body: 'Use a local Project Preview assembled from all linked services.\n',
      }),
    }
    await controller.ensurePlanning('G-1', 'Assess the current contract.', {
      path: inputPath,
      write: inputWrite,
    })

    const revised = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      contractChange: 'Exercise all linked services in the local Project Preview.',
      acceptedInput: { path: inputPath, write: null },
    })
    const goalPackage = await store.readPackage('G-1')
    const planning = [...goalPackage.works.values()].find(
      (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
    )

    expect(revised.attributes.contractRevision).toBe(2)
    expect(planning?.attributes.contractRevision).toBe(2)
    expect(planning?.body).toContain('Exercise all linked services in the local Project Preview.')
    expect(planning?.body).not.toContain('Reassess accepted Inbox event')

    const repeated = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      contractChange: 'Exercise all linked services in the local Project Preview.',
      acceptedInput: { path: inputPath, write: null },
    })
    expect(repeated.attributes.contractRevision).toBe(2)
  })

  test('consumes next-revision Work support left before the Goal revision gate', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const path = store.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(store.paths.absolute(path)).text()
    const staged = parseWorkDocument(source)
    staged.attributes.contractRevision = 2
    await store.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(staged),
      },
    })

    const goal = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-recover',
      contractChange: 'Adopt the revised requirement.',
    })

    expect(goal.attributes.contractRevision).toBe(2)
    expect(
      (await store.readPackage('G-1')).works.get('plan-initial')?.attributes.contractRevision,
    ).toBe(2)
  })

  test('guards cancellation first and then cancels dependents before prerequisites', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      dependsOn: [],
    })
    await publishEngineering(store, 'G-1', {
      id: 'W-2',
      stage: 'generate',
      dependsOn: ['W-1'],
    })

    await controller.cancelGoal('G-1')
    const goalPackage = await store.readPackage('G-1')

    expect(goalPackage.goal.attributes.lifecycle).toBe('cancelled')
    expect([...goalPackage.works.values()].map((work) => work.attributes.stage).sort()).toEqual([
      'cancelled',
      'cancelled',
      'done',
    ])
    await expect(controller.cancelGoal('G-1')).resolves.toMatchObject({
      attributes: { lifecycle: 'cancelled' },
    })
  })

  test('cancels one Engineering dependency subtree without changing Goal planning', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      dependsOn: [],
    })
    await publishEngineering(store, 'G-1', {
      id: 'W-2',
      stage: 'generate',
      dependsOn: ['W-1'],
    })

    const cancelled = await controller.cancelWork('G-1', 'W-1')
    const goalPackage = await store.readPackage('G-1')

    expect(cancelled.map((work) => work.attributes.id)).toEqual(['W-2', 'W-1'])
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('cancelled')
    expect(goalPackage.works.get('W-2')?.attributes.stage).toBe('cancelled')
    expect(
      [...goalPackage.works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(0)
  })

  test('cancels one nonterminal Planning Work', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })

    const cancelled = await controller.cancelWork('G-1', 'plan-initial')
    const goalPackage = await store.readPackage('G-1')

    expect(cancelled.map((work) => work.attributes.id)).toEqual(['plan-initial'])
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      kind: 'planning',
      stage: 'cancelled',
    })
  })

  test('changes nonterminal dependencies and rejects a cyclic graph', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      dependsOn: [],
    })
    await publishEngineering(store, 'G-1', {
      id: 'W-2',
      stage: 'generate',
      dependsOn: [],
    })

    await expect(controller.setWorkDependencies('G-1', 'W-2', ['W-1'])).resolves.toMatchObject({
      attributes: { dependsOn: ['W-1'] },
    })
    await expect(controller.setWorkDependencies('G-1', 'W-1', ['W-2'])).rejects.toThrow(
      'Engineering Work dependency cycle includes W-1',
    )

    const goalPackage = await store.readPackage('G-1')
    expect(goalPackage.works.get('W-1')?.attributes.dependsOn).toEqual([])
    expect(goalPackage.works.get('W-2')?.attributes.dependsOn).toEqual(['W-1'])
  })

  test('appends a source-traced message to nonterminal Work', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })

    const updated = await controller.appendWorkMessage('G-1', 'plan-initial', {
      sourceEventId: 'EV-guidance',
      content: 'Check the current API response before changing the contract.',
    })

    expect(updated.body).toContain('## HOPI Project Owner Messages')
    expect(updated.body).toContain('### 2026-07-11T00:00:00.000Z')
    expect(updated.body).toContain('Source event: EV-guidance')
    expect(updated.body).toContain('Check the current API response before changing the contract.')
  })

  test('repeats an already durable Work cancellation without creating Planning', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      dependsOn: [],
    })
    const path = store.paths.workDocument('G-1', 'W-1')
    const source = await Bun.file(store.paths.absolute(path)).text()
    const work = parseWorkDocument(source)
    work.attributes.stage = 'cancelled'
    await store.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(work),
      },
    })

    expect(await controller.cancelWork('G-1', 'W-1')).toEqual([])
    const goalPackage = await store.readPackage('G-1')
    expect(
      [...goalPackage.works.values()].filter(
        (candidate) =>
          candidate.attributes.kind === 'planning' && candidate.attributes.stage === 'plan',
      ),
    ).toHaveLength(0)
  })

  test('commits Goal done only from a final Planner proposal and structural verification', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const planningPath = store.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(source)
    planning.attributes.stage = 'done'
    const completion = {
      attributes: {
        id: 'A-complete',
        target: null,
        createdAt: '2026-07-11T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: '## Complete\n\nAll Goal criteria are satisfied.\n',
    }
    await store.publishGoal('G-1', {
      supportingWrites: [
        {
          path: store.paths.attentionDocument('G-1', 'A-complete'),
          expectedHash: null,
          content: renderAttentionDocument(completion),
        },
      ],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(planning),
      },
    })

    const goal = await controller.completeGoal('G-1', 'A-complete')

    expect(goal.attributes).toMatchObject({
      lifecycle: 'done',
      completionAttentionId: 'A-complete',
    })

    const reopened = await controller.reopenGoal('G-1', {
      eventId: 'EV-reopen',
      contractChange: 'The supported platform scope changed.',
    })
    const reopenedPackage = await store.readPackage('G-1')
    expect(reopened.attributes).toMatchObject({
      lifecycle: 'active',
      contractRevision: 2,
      completionAttentionId: null,
    })
    expect(
      [...reopenedPackage.works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(1)
    expect(reopenedPackage.attentions.get('A-complete')?.attributes.resolvedAt).not.toBeNull()
  })
})

function setup() {
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(temporaryRoot, 'P-1', publisher)
  const controller = createGoalController(store, {
    now: () => new Date('2026-07-11T00:00:00Z'),
    verifyCompletion: () => true,
  })
  return { store, controller }
}

async function publishEngineering(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  input: {
    id: string
    stage: 'generate' | 'review'
    dependsOn: string[]
  },
) {
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.workDocument(goalId, input.id),
      expectedHash: null,
      content: renderWorkDocument({
        attributes: {
          id: input.id,
          title: `Build ${input.id}`,
          kind: 'engineering',
          stage: input.stage,
          notBefore: null,
          dependsOn: input.dependsOn,
          contractRevision: 1,
          evidenceRefs: [],
        },
        body: `Implement ${input.id}.\n`,
      }),
    },
  })
}

async function markPlanningDone(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  workId: string,
) {
  const path = store.paths.workDocument(goalId, workId)
  const source = await Bun.file(store.paths.absolute(path)).text()
  const planning = parseWorkDocument(source)
  planning.attributes.stage = 'done'
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(planning),
    },
  })
  return planning
}
