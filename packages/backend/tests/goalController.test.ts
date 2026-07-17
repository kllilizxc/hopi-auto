import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderAttentionDocument,
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

  test('reuses one open retry Attention and creates a new identity for a later retry cycle', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const planningPath = store.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(source)
    planning.attributes.attempts = 3
    await store.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(planning),
      },
    })

    const first = await controller.ensureAttemptsAttention('G-1', 'plan-initial')
    const second = await controller.ensureAttemptsAttention('G-1', 'plan-initial')

    expect(second).toEqual(first)
    expect(first.attributes).toMatchObject({
      target: 'project:P-1/goal:G-1/work:plan-initial',
      resolvedAt: null,
    })
    expect(first.attributes.id).toStartWith('attempts-plan-initial-3-')

    const attentionPath = store.paths.attentionDocument('G-1', first.attributes.id)
    const attentionSource = await Bun.file(store.paths.absolute(attentionPath)).text()
    first.attributes.resolvedAt = '2026-07-11T00:01:00Z'
    await store.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: attentionPath,
        expectedHash: await hashBytes(new TextEncoder().encode(attentionSource)),
        content: renderAttentionDocument(first),
      },
    })
    await controller.retryWork('G-1', 'plan-initial', null)
    const retrySource = await Bun.file(store.paths.absolute(planningPath)).text()
    const retriedPlanning = parseWorkDocument(retrySource)
    retriedPlanning.attributes.attempts = 3
    await store.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(retrySource)),
        content: renderWorkDocument(retriedPlanning),
      },
    })

    const laterCycle = await controller.ensureAttemptsAttention('G-1', 'plan-initial')
    expect(laterCycle.attributes.id).not.toBe(first.attributes.id)
    expect(laterCycle.attributes.id).toStartWith('attempts-plan-initial-3-')
  })

  test('uses ordinary Work Attention for operational exhaustion', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })

    const first = await controller.ensureOperationalFailureAttention(
      'G-1',
      'plan-initial',
      3,
      'The configured runtime command exited before producing output.',
    )
    const reused = await controller.ensureOperationalFailureAttention(
      'G-1',
      'plan-initial',
      4,
      'A later failure should not create duplicate Attention.',
    )

    expect(reused.attributes.id).toBe(first.attributes.id)
    expect(first.attributes.id).toStartWith('A-')
    expect(first.attributes.id).not.toContain('operational')
    expect(first.body).toContain('3 consecutive operational failures')
    expect(first.body).toContain('configured runtime command exited')
  })

  test('uses one ordinary Work Attention for a responsibility semantic failure', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })

    const first = await controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'The proposal did not satisfy its document contract.',
    )
    const reused = await controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'A duplicate wake-up must not create duplicate Attention.',
    )
    const planning = (await store.readPackage('G-1')).works.get('plan-initial')

    expect(reused.attributes.id).toBe(first.attributes.id)
    expect(first.attributes).toMatchObject({
      target: 'project:P-1/goal:G-1/work:plan-initial',
      resolvedAt: null,
      notifiedAt: null,
    })
    expect(first.attributes.id).toStartWith('failure-plan-initial-')
    expect(first.body).toContain('planner could not complete Work plan-initial')
    expect(first.body).toContain('proposal did not satisfy its document contract')
    expect(planning?.attributes.attempts).toBe(0)
  })

  test('installs Planning before a material revision and invalidates nonterminal Work', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'review',
      attempts: 2,
      dependsOn: [],
    })

    const revised = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      content: 'Add a measurable latency criterion before implementation continues.',
    })
    const goalPackage = await store.readPackage('G-1')

    expect(revised.attributes.contractRevision).toBe(2)
    expect(revised.body).toContain('## Accepted Inbox Instruction EV-revise')
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 0,
      contractRevision: 2,
    })
    expect(
      [...goalPackage.works.values()].find(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      )?.attributes.contractRevision,
    ).toBe(2)

    const repeated = await controller.applyMaterialInstruction('G-1', {
      eventId: 'EV-revise',
      content: 'Add a measurable latency criterion before implementation continues.',
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
      content: 'Adopt the revised requirement.',
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
      attempts: 0,
      dependsOn: [],
    })
    await publishEngineering(store, 'G-1', {
      id: 'W-2',
      stage: 'generate',
      attempts: 0,
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

  test('cancels one Engineering dependency subtree and guards replanning', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      attempts: 0,
      dependsOn: [],
    })
    await publishEngineering(store, 'G-1', {
      id: 'W-2',
      stage: 'generate',
      attempts: 0,
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
    ).toHaveLength(1)
  })

  test('finishes Planning recovery when Work cancellation landed before its guard', async () => {
    const { store, controller } = setup()
    await store.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await markPlanningDone(store, 'G-1', 'plan-initial')
    await publishEngineering(store, 'G-1', {
      id: 'W-1',
      stage: 'generate',
      attempts: 0,
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
    ).toHaveLength(1)
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
      content: 'Reopen because the supported platform scope changed.',
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
    attempts: number
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
          attempts: input.attempts,
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
