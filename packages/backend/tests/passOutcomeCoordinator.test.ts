import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
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
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const stagedPlanningPath = join(context.proposalRoot, ...planningPath.split('/'))
    const planning = parseWorkDocument(
      await Bun.file(fixture.store.paths.absolute(planningPath)).text(),
    )
    planning.attributes.stage = 'done'
    await mkdir(dirname(stagedPlanningPath), { recursive: true })
    await Bun.write(stagedPlanningPath, renderWorkDocument(planning))
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

  test('stales a Planner result when a new Goal Input arrives after staging', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-new-input', 'planner')
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const stagedPlanningPath = join(context.proposalRoot, ...planningPath.split('/'))
    const planning = parseWorkDocument(
      await Bun.file(fixture.store.paths.absolute(planningPath)).text(),
    )
    planning.attributes.stage = 'done'
    await mkdir(dirname(stagedPlanningPath), { recursive: true })
    await Bun.write(stagedPlanningPath, renderWorkDocument(planning))

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
    expect(goalPackage.evidence.has('E-run-new-input')).toBe(true)
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
    expect(work?.attributes.attempts).toBe(0)
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
    const goals = createGoalController(fixture.store, { verifyCompletion: () => false })
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
    expect(goalPackage.evidence.has('E-run-new-design')).toBe(true)
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
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Needs you\n\nChoose the durable storage format.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-attention', 'generator', context, 'attention'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toEqual({
      kind: 'attention',
      evidenceId: 'E-run-attention',
      attentionId: 'A-storage',
    })
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 0,
      evidenceRefs: [],
    })
    expect(goalPackage.evidence.has('E-run-attention')).toBe(true)
  })

  test('rejects targeted Attention combined with Generator success', async () => {
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
          notifiedAt: null,
        },
        body: '## Needs you\n\nA technical command failed.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-invalid-attention', 'generator', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.attentions.has('A-invalid-success')).toBe(false)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 1,
    })
  })

  test('normalizes Engineering Attention targeting outside its owning Work to failure', async () => {
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
          notifiedAt: null,
        },
        body: '## Needs you\n\nChoose the durable storage format.\n',
      }),
    )

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-wrong-attention-target', 'generator', context, 'attention'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.attentions.has('A-wrong-target')).toBe(false)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 1,
    })
    expect(goalPackage.evidence.get('E-run-wrong-attention-target')?.body).toContain(
      'Engineering Attention must target its owning Work: project:project-1/goal:goal-1/work:W-1',
    )
  })

  test('normalizes malformed Generator Attention to a failed attempt', async () => {
    const fixture = await createEngineeringFixture('generate')
    const context = await fixture.stage('W-1', 'run-malformed-attention', 'generator')
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-malformed')
    const stagedAttentionPath = join(context.proposalRoot, ...attentionPath.split('/'))
    await mkdir(dirname(stagedAttentionPath), { recursive: true })
    await Bun.write(stagedAttentionPath, '# Missing frontmatter\n\nRegistry access failed.\n')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-malformed-attention', 'generator', context, 'attention'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.attentions.has('A-malformed')).toBe(false)
    expect(goalPackage.works.get('W-1')?.attributes).toMatchObject({
      stage: 'generate',
      attempts: 1,
    })
    expect(goalPackage.evidence.get('E-run-malformed-attention')?.body).toContain(
      'Invalid staged proposal: Attention document is missing YAML front matter',
    )
  })

  test('normalizes malformed Planner Work to a failed attempt', async () => {
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

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      stage: 'plan',
      attempts: 1,
    })
  })

  test('preserves stale Evidence without applying an old Work transition', async () => {
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
    expect(goalPackage.evidence.has('E-run-stale')).toBe(true)
  })

  test('normalizes paused Reviewer success before C1 to stale', async () => {
    const fixture = await createEngineeringFixture('review')
    const context = await fixture.stage('W-1', 'run-review-paused', 'reviewer')
    const goals = createGoalController(fixture.store, { verifyCompletion: () => false })
    await goals.pauseGoal('goal-1')

    const result = await fixture.outcomes.apply(
      fixture.input('W-1', 'run-review-paused', 'reviewer', context, 'success'),
    )
    const goalPackage = await fixture.store.readPackage('goal-1')

    expect(result).toMatchObject({ kind: 'stale', reason: 'Goal is paused' })
    expect(goalPackage.works.get('W-1')?.attributes.stage).toBe('review')
    expect(goalPackage.works.get('W-1')?.attributes.evidenceRefs).toEqual([])
    expect(goalPackage.evidence.has('E-run-review-paused')).toBe(true)
  })

  test('normalizes an invalid Planner success proposal to a failed attempt', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-invalid', 'planner')

    const result = await fixture.outcomes.apply(
      fixture.input('plan-initial', 'run-invalid', 'planner', context, 'success'),
    )
    const work = (await fixture.store.readPackage('goal-1')).works.get('plan-initial')

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect(work?.attributes.attempts).toBe(1)
    expect(work?.attributes.stage).toBe('plan')
  })

  test('rejects Planner output that leaks an Assistant-home attachment into Work', async () => {
    const fixture = await createFixture()
    const context = await fixture.stage('plan-initial', 'run-home-image', 'planner')
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planning = parseWorkDocument(
      await Bun.file(fixture.store.paths.absolute(planningPath)).text(),
    )
    planning.attributes.stage = 'done'
    const proposedWork = engineeringWork('W-image', 'generate')
    proposedWork.body =
      'Use `.hopi/docs/assistant/attachments/hash/reference.png` as the visual source.\n'
    await mkdir(dirname(join(context.proposalRoot, ...planningPath.split('/'))), {
      recursive: true,
    })
    await Bun.write(
      join(context.proposalRoot, ...planningPath.split('/')),
      renderWorkDocument(planning),
    )
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

    expect(result).toMatchObject({ kind: 'published', result: 'fail' })
    expect((await fixture.store.readPackage('goal-1')).works.has('W-image')).toBe(false)
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
      result: 'success' | 'reject' | 'attention' | 'fail',
    ) {
      return {
        goalId: 'goal-1',
        workId,
        runId,
        responsibility,
        context,
        outcome: { result, summary: `${responsibility} ${result}`, artifacts: [], exitCode: 0 },
      }
    },
  }
}

function engineeringWork(id: string, stage: 'generate' | 'review') {
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
      attempts: 0,
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
