import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  type EngineeringWorkAttributes,
  parseWorkDocument,
  renderAttentionDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createPassOutcomeCoordinator } from '../src/runtime/passOutcomeCoordinator'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('PassOutcomeCoordinator', () => {
  test('publishes a complete Planner proposal before its Planning Work gate', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-plan', 'planner')
    await Bun.write(
      join(context.proposalRoot, ...fixture.store.paths.workDocument('goal-1', 'W-1').split('/')),
      renderWorkDocument(engineeringWork('W-1', 'generate')),
    )
    await Bun.write(join(context.proposalRoot, 'AGENTS.md'), '# Project instructions\n')
    await Bun.write(
      join(context.proposalRoot, '.hopi', 'docs', 'repos.md'),
      '# Project Repositories\n\n- `primary`: product source.\n',
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-plan', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.works.get('plan-initial')?.attributes.stage).toBe('done')
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('generate')
    expect(goalPackage.works.get('plan-initial')?.attributes.evidenceRefs).toEqual(['E-run-plan'])
    expect(await Bun.file(join(fixture.projectRoot, 'AGENTS.md')).text()).toContain('instructions')
    expect(await Bun.file(join(fixture.projectRoot, '.hopi', 'docs', 'repos.md')).text()).toContain(
      '`primary`',
    )
  })

  test('publishes Planner project context atomically with targeted Attention', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-plan-attention', 'planner')
    await Bun.write(
      join(context.proposalRoot, '.hopi', 'docs', 'repos.md'),
      [
        '# Project Repositories',
        '',
        'The product Preview enters through the host and composes the child plus local backend.',
        '',
      ].join('\n'),
    )
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-runtime-choice')
    await Bun.write(
      join(context.proposalRoot, ...attentionPath.split('/')),
      renderAttentionDocument({
        attributes: {
          id: 'A-runtime-choice',
          target: 'project:project-1/goal:goal-1/work:plan-initial',
          createdAt: '2099-12-31T23:59:59Z',
          resolvedAt: null,
          summary: 'The local identity source needs an operator decision.',
        },
        body: '## Observed condition\n\nThe local identity source needs an operator decision.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-plan-attention', 'planner', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toEqual({
      kind: 'attention',
      evidenceId: 'E-run-plan-attention',
      attentionIds: ['A-runtime-choice'],
    })
    expect(goalPackage.works.get('plan-initial')?.attributes.stage).toBe('plan')
    expect(await Bun.file(join(fixture.projectRoot, '.hopi', 'docs', 'repos.md')).text()).toContain(
      'host and composes the child plus local backend',
    )
  })

  test('rejects a Planner Attention proposal that also stages executable Work', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-plan-attention-work', 'planner')
    await Bun.write(
      join(context.proposalRoot, ...fixture.store.paths.workDocument('goal-1', 'W-1').split('/')),
      renderWorkDocument(engineeringWork('W-1', 'generate')),
    )
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-runtime-choice')
    await Bun.write(
      join(context.proposalRoot, ...attentionPath.split('/')),
      renderAttentionDocument({
        attributes: {
          id: 'A-runtime-choice',
          target: 'project:project-1/goal:goal-1/work:plan-initial',
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          summary: 'The executable topology still needs an operator decision.',
        },
        body: '## Needs you\n\nChoose the executable topology.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-plan-attention-work', 'planner', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toEqual({
      kind: 'invalid',
      reason:
        'Planner Attention proposal may not create or rewrite Work; unresolved planning must settle before executable Work is published',
    })
    expect(goalPackage.works.has('W-1')).toBe(false)
    expect(goalPackage.attentions.has('A-runtime-choice')).toBe(false)
    expect(goalPackage.evidence.has('E-run-plan-attention-work')).toBe(false)
  })

  test('retains Planner project context while an existing Attention keeps Planning open', async () => {
    const fixture = await createFixture()
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-existing')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: attentionPath,
          expectedHash: null,
          content: renderAttentionDocument({
            attributes: {
              id: 'A-existing',
              target: 'project:project-1/goal:goal-1/work:plan-initial',
              createdAt: '2026-07-10T00:00:00.000Z',
              resolvedAt: null,
              summary: 'Restore the operator-owned local identity.',
            },
            body: '## Observed condition\n\nRestore the operator-owned local identity.\n',
          }),
        },
      ],
    })
    const context = await fixture.stage('plan-initial', 'run-existing-attention', 'planner')
    await Bun.write(
      join(context.proposalRoot, '.hopi', 'docs', 'repos.md'),
      '# Project Repositories\n\n- `primary`: real application and Preview adapter.\n',
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-existing-attention', 'planner', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.attentions.get('A-existing')?.attributes.resolvedAt).toBeNull()
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'plan',
      evidenceRefs: ['E-run-existing-attention'],
      contextRefs: [],
      ownerMessages: [],
    })
    expect(await Bun.file(join(fixture.projectRoot, '.hopi', 'docs', 'repos.md')).text()).toContain(
      'real application and Preview adapter',
    )
  })

  test('lets Planner atomically rewire current dependencies around cancelled Work', async () => {
    const fixture = await createFixture()
    const base = engineeringWork('W-base', 'generate')
    const dependent = engineeringWork('W-dependent', 'generate')
    dependent.attributes.dependsOn = ['W-base']
    const independent = engineeringWork('W-independent', 'generate')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [base, dependent, independent].map((work) => ({
        path: fixture.store.paths.workDocument('goal-1', work.attributes.id),
        expectedHash: null,
        content: renderWorkDocument(work),
      })),
    })
    const context = await fixture.stage('plan-initial', 'run-cancel-closure', 'planner')
    await Bun.write(
      join(
        context.proposalRoot,
        ...fixture.store.paths.workDocument('goal-1', 'W-base').split('/'),
      ),
      renderWorkDocument({
        ...base,
        attributes: { ...base.attributes, stage: 'cancelled' },
        body: '# Cancelled route\n\nSuperseded by the rewired current plan.\n',
      }),
    )
    await Bun.write(
      join(
        context.proposalRoot,
        ...fixture.store.paths.workDocument('goal-1', 'W-dependent').split('/'),
      ),
      renderWorkDocument({
        ...dependent,
        attributes: { ...dependent.attributes, dependsOn: [] },
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-cancel-closure', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.works.get('W-base')?.attributes.stage).toBe('cancelled')
    expect(goalPackage.works.get('W-base')?.body).toContain(
      'Superseded by the rewired current plan',
    )
    expect(goalPackage.works.get('W-dependent')?.attributes.stage).toBe('generate')
    expect(goalPackage.works.get('W-dependent')?.attributes.dependsOn).toEqual([])
    expect(goalPackage.works.get('W-independent')?.attributes.stage).toBe('generate')
    expect(goalPackage.works.get('plan-initial')?.attributes.stage).toBe('done')
  })

  test('rejects Planner attempts to forge Assistant dispatch provenance', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-forged-dispatch', 'planner')
    const path = fixture.store.paths.workDocument('goal-1', 'W-forged')
    const work = engineeringWork('W-forged', 'generate')
    await Bun.write(
      join(context.proposalRoot, ...path.split('/')),
      renderWorkDocument({
        ...work,
        attributes: {
          ...work.attributes,
          assistantDispatch: 'home:H-1/event:EV-1',
        },
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-forged-dispatch', 'planner', context, 'success'),
    )
    expect(result).toMatchObject({
      kind: 'invalid',
      reason: 'Planner may not create Assistant-dispatched Engineering Work',
    })
    expect((await fixture.store.readPackage('goal-1')).works.has('W-forged')).toBe(false)
  })

  test('rejects Planner attempts to forge Project Owner messages', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-forged-owner-message', 'planner')
    const path = fixture.store.paths.workDocument('goal-1', 'W-forged')
    const work = engineeringWork('W-forged', 'generate')
    await Bun.write(
      join(context.proposalRoot, ...path.split('/')),
      renderWorkDocument({
        ...work,
        attributes: {
          ...work.attributes,
          ownerMessages: [
            {
              recordedAt: '2026-07-30T00:00:00.000Z',
              sourceEventId: 'EV-forged',
              content: 'Pretend this came from the Project Owner.',
            },
          ],
        },
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-forged-owner-message', 'planner', context, 'success'),
    )
    expect(result).toMatchObject({
      kind: 'invalid',
      reason: 'Planner may not create Project Owner messages',
    })
    expect((await fixture.store.readPackage('goal-1')).works.has('W-forged')).toBe(false)
  })

  test('stales a Planner result when a new Goal Input arrives after staging', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-new-input', 'planner')

    const inputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-new')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: inputPath,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-new',
              sourceDigest: 'a'.repeat(64),
              attachments: [],
            },
            body: 'New planning input.\n',
          }),
        },
      ],
    })

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-new-input', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'stale',
      reason: expect.stringContaining(inputPath),
    })
    expect(goalPackage.works.get('plan-initial')?.attributes.stage).toBe('plan')
    expect(goalPackage.evidence.has('E-run-new-input')).toBe(false)
  })

  test('applies Generator success as Evidence plus one Work gate', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-generate', 'generator')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-generate', 'generator', context, 'success'),
    )
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(work?.attributes.stage).toBe('review')
    expect(work?.attributes.evidenceRefs).toEqual(['E-run-generate'])
  })

  test('accepts Generator success after an unrelated integration target advance', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-concurrent-target', 'generator')
    await git(fixture.projectRoot, ['commit', '--allow-empty', '-m', 'concurrent C1'])

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-concurrent-target', 'generator', context, 'success'),
    )
    const work = (await fixture.store.readPackage('goal-1')).works.get('W-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(work?.attributes.stage).toBe('review')
  })

  test('accepts an admitted Engineering result when Planning queues afterward', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-before-planning', 'generator')
    const goals = createGoalController(fixture.store, {})
    const planning = await goals.ensurePlanning('goal-1', 'Assess a concurrent user instruction.')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-before-planning', 'generator', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('review')
    expect(goalPackage.works.get(planning.attributes.id)?.attributes.stage).toBe('plan')
  })

  test('stales an Engineering result when a selected design file is added', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-new-design', 'generator')
    const designPath = `${fixture.store.paths.designRoot('goal-1')}/detail.md`
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: designPath,
          expectedHash: null,
          content: '# New design authority\n',
        },
      ],
    })

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-new-design', 'generator', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'stale',
      reason: expect.stringContaining(designPath),
    })
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('generate')
    expect(goalPackage.evidence.has('E-run-new-design')).toBe(false)
  })

  test('publishes targeted Attention without advancing Work or consuming the Run', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-attention', 'generator')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-storage')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(
      stagedAttentionPath,
      renderAttentionDocument({
        attributes: {
          id: 'A-storage',
          target: 'project:project-1/goal:goal-1/work:W-1',
          createdAt: '2099-12-31T23:59:59Z',
          resolvedAt: null,
          summary: 'Choose the durable storage format.',
        },
        body: '## Needs you\n\nChoose the durable storage format.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-attention', 'generator', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toEqual({
      kind: 'attention',
      evidenceId: 'E-run-attention',
      attentionIds: ['A-storage'],
    })
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    })
    expect(goalPackage.attentions.get('A-storage')?.attributes.createdAt).toBe(
      '2026-07-11T00:00:00.000Z',
    )
    expect(goalPackage.attentions.get('A-storage')?.attributes.summary).toBe(
      'Choose the durable storage format.',
    )
    expect(goalPackage.evidence.has('E-run-attention')).toBe(true)
  })

  test('publishes multiple independent targeted Attentions from one result', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-multi-attention', 'generator')
    for (const id of ['A-storage', 'A-credential']) {
      const attentionPath = fixture.store.paths.attentionDocument('goal-1', id)
      const stagedPath = join(context.proposalRoot, ...attentionPath.split('/'))
      await mkdir(dirname(stagedPath), { recursive: true })
      await Bun.write(
        stagedPath,
        renderAttentionDocument({
          attributes: {
            id,
            target: 'project:project-1/goal:goal-1/work:W-1',
            createdAt: '1970-01-01T00:00:00.000Z',
            resolvedAt: null,
            summary: `${id} requires separate Assistant judgment.`,
          },
          body: `## Observed condition\n\n${id} requires separate Assistant judgment.\n`,
        }),
      )
    }

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-multi-attention', 'generator', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'attention',
      attentionIds: ['A-credential', 'A-storage'],
    })
    expect(goalPackage.attentions.has('A-storage')).toBe(true)
    expect(goalPackage.attentions.has('A-credential')).toBe(true)
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('generate')
  })

  test('rejects a Planner document path target with the exact owning Work target', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-planner-path-target', 'planner')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-choice')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(
      stagedAttentionPath,
      renderAttentionDocument({
        attributes: {
          id: 'A-choice',
          target: '.hopi/docs/goals/goal-1/work/plan-initial.md',
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          summary: 'Choose compact or verbose.',
        },
        body: '## Needs you\n\nChoose compact or verbose.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-planner-path-target', 'planner', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'invalid',
      reason:
        'Targeted Attention must use owning Work target: project:project-1/goal:goal-1/work:plan-initial',
    })
    expect(goalPackage.attentions.has('A-choice')).toBe(false)
    expect(goalPackage.evidence.has('E-run-planner-path-target')).toBe(false)
  })

  test('uses a targeted Attention proposal as the concrete effect regardless of result label', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-invalid-attention', 'generator')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-invalid-success')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(
      stagedAttentionPath,
      renderAttentionDocument({
        attributes: {
          id: 'A-invalid-success',
          target: 'project:project-1/goal:goal-1/work:W-1',
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          summary: 'A technical command failed.',
        },
        body: '## Needs you\n\nA technical command failed.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-invalid-attention', 'generator', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'attention',
      attentionIds: ['A-invalid-success'],
    })
    expect(goalPackage.attentions.has('A-invalid-success')).toBe(true)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
    })
  })

  test('settles Generator failure without inventing Attention', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-unmaterialized-attention', 'generator')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-unmaterialized-attention', 'generator', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.attentions.size).toBe(0)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      evidenceRefs: ['E-run-unmaterialized-attention'],
      contextRefs: [],
      ownerMessages: [],
    })
  })

  test('does not complete Planning from failure without Attention', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage(
      'plan-initial',
      'run-unmaterialized-planner-attention',
      'planner',
    )

    const result = await fixture.outcomes.apply(
      fixture.input(
        'plan-initial',
        'run-unmaterialized-planner-attention',
        'planner',
        context,
        'fail',
      ),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'plan',
      evidenceRefs: ['E-run-unmaterialized-planner-attention'],
      contextRefs: [],
      ownerMessages: [],
    })
  })

  test('rejects Engineering Attention targeting outside its owning Work as invalid', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-wrong-attention-target', 'generator')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-wrong-target')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(
      stagedAttentionPath,
      renderAttentionDocument({
        attributes: {
          id: 'A-wrong-target',
          target: 'project:project-1/goal:goal-1',
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          summary: 'Choose the durable storage format.',
        },
        body: '## Needs you\n\nChoose the durable storage format.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-wrong-attention-target', 'generator', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'invalid',
      reason:
        'Targeted Attention must use owning Work target: project:project-1/goal:goal-1/work:W-1',
    })
    expect(goalPackage.attentions.has('A-wrong-target')).toBe(false)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
    })
    expect(goalPackage.evidence.has('E-run-wrong-attention-target')).toBe(false)
  })

  test('rejects malformed Generator Attention as invalid', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-malformed-attention', 'generator')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-malformed')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(stagedAttentionPath, '# Missing frontmatter\n\nRegistry access failed.\n')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-malformed-attention', 'generator', context, 'fail'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'invalid',
      reason: 'Attention document is missing YAML front matter',
    })
    expect(goalPackage.attentions.has('A-malformed')).toBe(false)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
    })
    expect(goalPackage.evidence.has('E-run-malformed-attention')).toBe(false)
  })

  test('rejects malformed Planner Work as invalid', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-malformed-work', 'planner')
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const stagedPlanningPath = join(context.proposalRoot, ...planningPath.split('/'))
    await mkdir(dirname(stagedPlanningPath), { recursive: true })
    await Bun.write(stagedPlanningPath, '# Missing frontmatter\n')

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-malformed-work', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({
      kind: 'invalid',
      reason: 'Work document is missing YAML front matter',
    })
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'plan',
    })
  })

  test('keeps a stale result out of canonical Evidence and Work', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-stale', 'generator')
    const goalPath = fixture.store.paths.goalDocument('goal-1')
    const source = await Bun.file(fixture.store.paths.absolute(goalPath)).text()
    const { parseGoalDocument, renderGoalDocument } = await import(
      '../src/domain/canonicalDocuments'
    )
    const goal = parseGoalDocument(source)
    goal.attributes.lifecycle = 'paused'
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [],
      gateWrite: {
        path: goalPath,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderGoalDocument(goal),
      },
    })

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-stale', 'generator', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result.kind).toBe('stale')
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('generate')
    expect(goalPackage.works.get('W-1')?.attributes.evidenceRefs).toEqual([])
    expect(goalPackage.evidence.has('E-run-stale')).toBe(false)
  })

  test('lets Planner leave an older Engineering route visibly stale', async () => {
    const fixture = await createEngineeringFixture('review')
    const goals = createGoalController(fixture.store, {})
    const acceptedInputPath = fixture.store.paths.inputDocument('goal-1', 'home-1', 'EV-revise')
    await goals.applyMaterialInstruction('goal-1', {
      contractChange: 'Change the required behavior.',
      acceptedInput: {
        path: acceptedInputPath,
        write: {
          path: acceptedInputPath,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'home-1',
              sourceEventId: 'EV-revise',
              sourceDigest: 'a'.repeat(64),
              attachments: [],
            },
            body: 'Change the required behavior.\n',
          }),
        },
      },
    })
    let goalPackage = await fixture.store.readPackage('goal-1')
    const planning = [...goalPackage.works.values()].find(
      (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
    )
    if (!planning) throw new Error('Expected current Planning Work')

    const context = await fixture.stage(
      planning.attributes.id,
      'run-stale-work-left-visible',
      'planner',
    )
    const result = await fixture.outcomes.apply(
      fixture.input(
        planning.attributes.id,
        'run-stale-work-left-visible',
        'planner',
        context,
        'success',
      ),
    )
    goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.evidence.has('E-run-stale-work-left-visible')).toBe(true)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'review',
      contractRevision: 1,
    })
    expect(goalPackage.works.get(planning.attributes.id)?.attributes).toMatchObject({
      stage: 'done',
      contractRevision: 2,
    })
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
  })

  test('normalizes paused Reviewer success before C1 to stale', async () => {
    const fixture = await createEngineeringFixture('review')
    const context = await fixture.stage('W-1', 'run-review-paused', 'reviewer')
    const goals = createGoalController(fixture.store, {})
    await goals.pauseGoal('goal-1')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-review-paused', 'reviewer', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'stale', reason: 'Goal is paused' })
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('review')
    expect(goalPackage.works.get('W-1')?.attributes.evidenceRefs).toEqual([])
    expect(goalPackage.evidence.has('E-run-review-paused')).toBe(false)
  })

  test('finishes Planning from an empty sparse proposal when the existing DAG is complete', async () => {
    const fixture = await createFixture()
    const engineeringPath = fixture.store.paths.workDocument('goal-1', 'W-existing')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: engineeringPath,
          expectedHash: null,
          content: renderWorkDocument(engineeringWork('W-existing', 'generate')),
        },
      ],
    })
    const before = (await fixture.store.readPackage('goal-1')).works.get('W-existing')
    const context = await fixture.stage('plan-initial', 'run-empty-existing-dag', 'planner')

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-empty-existing-dag', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'done',
      evidenceRefs: ['E-run-empty-existing-dag'],
      contextRefs: [],
      ownerMessages: [],
    })
    expect(goalPackage.works.get('W-existing')).toEqual(before)
  })

  test('completes the Goal directly when final Planning finds no remaining Engineering Work', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-empty-incomplete', 'planner')

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-empty-incomplete', 'planner', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'success' })
    expect(goalPackage.goal.attributes).toMatchObject({
      lifecycle: 'done',
    })
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'done',
      evidenceRefs: ['E-run-empty-incomplete'],
      contextRefs: [],
      ownerMessages: [],
    })
  })

  test('rejects a Planner result that names a Work absent from current authority and proposal', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-stale-proposal', 'planner')
    const missingWork = fixture.store.paths.workDocument('goal-1', 'W-written-to-another-run')

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-stale-proposal', 'planner', context, 'success', [
        missingWork,
      ]),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toEqual({
      kind: 'invalid',
      reason: `Planner result names a Goal document outside the current authority and proposal: ${missingWork}`,
    })
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
    expect(goalPackage.works.get('plan-initial')?.attributes.stage).toBe('plan')
    expect(goalPackage.works.has('W-written-to-another-run')).toBe(false)
  })

  test('rejects Planner writes to Planning Work without converting invalid output to Evidence', async () => {
    const fixture = await createFixture()
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planningBody = parseWorkDocument(planningSource).body
    const invalidContext = await fixture.stage('plan-initial', 'run-owning-work', 'planner')
    const invalidPlanning = parseWorkDocument(planningSource)
    invalidPlanning.attributes.stage = 'done'
    await mkdir(dirname(join(invalidContext.proposalRoot, ...planningPath.split('/'))), {
      recursive: true,
    })
    await Bun.write(
      join(invalidContext.proposalRoot, ...planningPath.split('/')),
      renderWorkDocument(invalidPlanning),
    )

    const invalidResult = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-owning-work', 'planner', invalidContext, 'success'),
    )
    const failedPlanning = (await fixture.store.readPackage('goal-1')).works.get('plan-initial')

    expect(invalidResult).toMatchObject({
      kind: 'invalid',
      reason: 'Planner may propose Engineering Work but may not write Planning Work',
    })
    expect(failedPlanning?.attributes).toMatchObject({ stage: 'plan' })
    expect(failedPlanning?.attributes.evidenceRefs).toEqual([])

    const retryContext = await fixture.stage('plan-initial', 'run-retry', 'planner')
    await Bun.write(
      join(
        retryContext.proposalRoot,
        ...fixture.store.paths.workDocument('goal-1', 'W-retry').split('/'),
      ),
      renderWorkDocument(engineeringWork('W-retry', 'generate')),
    )
    const retryResult = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-retry', 'planner', retryContext, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')
    const completedPlanning = goalPackage.works.get('plan-initial')

    expect(retryResult).toMatchObject({ kind: 'published', result: 'success' })
    expect(completedPlanning?.attributes).toMatchObject({ stage: 'done' })
    expect(completedPlanning?.attributes.evidenceRefs).toEqual(['E-run-retry'])
    expect(completedPlanning?.body).toBe(planningBody)
    expect(goalPackage.works.get('W-retry')?.attributes.stage).toBe('generate')
    expect(goalPackage.evidence.has('E-run-owning-work')).toBe(false)
  })

  test('rejects Planner output that leaks an Assistant-home attachment into Work', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-home-image', 'planner')
    const proposedWork = engineeringWork('W-image', 'generate')
    proposedWork.body =
      'Use `.hopi/docs/assistant/attachments/hash/reference.png` as the visual source.\n'
    await Bun.write(
      join(
        context.proposalRoot,
        ...fixture.store.paths.workDocument('goal-1', 'W-image').split('/'),
      ),
      renderWorkDocument(proposedWork),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-home-image', 'planner', context, 'success'),
    )

    expect(result).toMatchObject({ kind: 'invalid' })
    expect((await fixture.store.readPackage('goal-1')).works.has('W-image')).toBe(false)
  })

  test('rejects Planner output that leaks a machine-local image path into Work', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-local-image', 'planner')
    const proposedWork = engineeringWork('W-local-image', 'generate')
    proposedWork.body =
      'Use `/Users/operator/.codex/generated_images/reference.webp` as the visual source.\n'
    await Bun.write(
      join(
        context.proposalRoot,
        ...fixture.store.paths.workDocument('goal-1', 'W-local-image').split('/'),
      ),
      renderWorkDocument(proposedWork),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-local-image', 'planner', context, 'success'),
    )

    expect(result).toMatchObject({ kind: 'invalid' })
    expect((await fixture.store.readPackage('goal-1')).works.has('W-local-image')).toBe(false)
  })
})

async function createEngineeringFixture(stage: 'generate' | 'review') {
  const fixture = await createFixture()
  const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
  const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
  const planning = parseWorkDocument(planningSource)
  planning.attributes.stage = 'done'
  await fixture.store.publishGoal('goal-1', {
    supportingWrites: [
      {
        path: fixture.store.paths.workDocument('goal-1', 'W-1'),
        expectedHash: null,
        content: renderWorkDocument(engineeringWork('W-1', stage)),
      },
    ],
    gateWrite: {
      path: planningPath,
      expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
      content: renderWorkDocument(planning),
    },
  })
  return fixture
}

async function createFixture() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-pass-outcome-'))
  temporaryRoots.push(temporaryRoot)
  const homeRoot = join(temporaryRoot, 'home')
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'index.ts'), 'export const value = 1\n')
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const home = createAssistantHomeStore(homeRoot)
  await home.initialize()
  const linked = await home.linkProject({ projectId: 'project-1', repoPath: repoRoot })
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({ goalId: 'goal-1', title: 'Goal', objective: 'Ship the feature.' })
  const outcomes = createPassOutcomeCoordinator(store, publisher, {
    now: () => new Date('2026-07-11T00:00:00Z'),
  })
  const stager = createRoleContextStager(homeRoot, publisher)

  return {
    homeRoot,
    projectRoot: linked.integrationRoot,
    store,
    outcomes,
    stage(workId: string, runId: string, responsibility: 'planner' | 'generator' | 'reviewer') {
      return stager.prepare({
        projectRoot: linked.integrationRoot,
        primaryRepoId: 'primary',
        repoRoots: [{ repoId: 'primary', path: linked.integrationRoot, primary: true }],
        projectId: 'project-1',
        goalId: 'goal-1',
        workId,
        runId,
        responsibility,
      })
    },
    input(
      workId: string,
      runId: string,
      responsibility: 'planner' | 'generator' | 'reviewer',
      context: Awaited<ReturnType<typeof stager.prepare>>,
      result: 'success' | 'reject' | 'fail',
      artifacts: readonly string[] = [],
    ) {
      return {
        goalId: 'goal-1',
        workId,
        runId,
        responsibility,
        context,
        outcome: { result, summary: `${responsibility} ${result}`, artifacts, exitCode: 0 },
      }
    },
  }
}

function engineeringWork(
  id: string,
  stage: 'generate' | 'review',
): { attributes: EngineeringWorkAttributes; body: string } {
  return {
    attributes: {
      id,
      title: `Build ${id}`,
      kind: 'engineering' as const,
      stage,
      notBefore: null,
      dependsOn: [],
      contractRevision: 1,
      evidenceRefs: [],
      contextRefs: [],
      ownerMessages: [],
    },
    body: '## Acceptance Criteria\n\n- The feature works.\n',
  }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}
