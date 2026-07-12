import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseWorkDocument,
  renderEvidenceDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { HOPI_RELEASE_REF } from '../src/domain/project'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('RoleContextStager', () => {
  test('stages immutable authority and silently exposes source when AGENTS.md is missing', async () => {
    const fixture = await createFixture(false)
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)
    const bundle = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-1',
      responsibility: 'planner',
    })

    expect(bundle.bootstrapSourceRoot).toBeDefined()
    if (!bundle.bootstrapSourceRoot) throw new Error('Expected bootstrap source')
    expect(await Bun.file(join(bundle.bootstrapSourceRoot, 'src', 'index.ts')).text()).toContain(
      'hello',
    )
    expect(await Bun.file(bundle.goalFile).exists()).toBe(true)
    expect(
      await Bun.file(join(bundle.proposalRoot, '.hopi/docs/goals/goal-1/goal.md')).exists(),
    ).toBe(false)
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('create')
    expect(prompt).toContain('AGENTS.md')
    expect(prompt).toContain('Never edit it or change contractRevision')
    expect(prompt).toContain('exactly the current Goal contractRevision')
    expect(prompt).toContain('kind engineering and stage generate')
    expect(prompt).toContain('Never create or edit evidence/** or append evidenceRefs')
    expect(prompt).toContain('proposal starts empty and is a sparse overlay')
    expect(prompt).toContain('Absence means unchanged')
    expect(prompt).toContain('Never create Planner Evidence or add its ID to the Planning Work')
    expect(prompt).toContain('Coordinator derives it from result.json during publication')
    expect(prompt).toContain('Never reconstruct or consume stale Run output')
    expect(prompt).toContain('never inspect another Goal or historical Run')
    expect(prompt).toContain('New Engineering Work frontmatter')
    expect(prompt).toContain('kind: engineering')
    expect(prompt).toContain('repos: [<one-or-more-listed-repo-ids>]')
    expect(prompt).toContain('.hopi/docs/repos.md')
    expect(prompt).toContain('New Attention frontmatter')
    expect(prompt).toContain('notifiedAt: null')
    expect(prompt).toContain('scripts/hopi/prepare is absent')
    expect(prompt).toContain('do not create a separate Init Work')
    expect(prompt).toContain('Independent testability alone does not justify a separate Work')
    expect(bundle.authorityFiles.find((file) => file.path === 'AGENTS.md')?.hash).toBeNull()
  })

  test('does not bootstrap or expose an existing AGENTS.md as a Planner write', async () => {
    const fixture = await createFixture(true, true)
    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-2',
      responsibility: 'planner',
    })

    expect(bundle.bootstrapSourceRoot).toBeUndefined()
    expect(await Bun.file(join(bundle.contextRoot, 'authority', 'AGENTS.md')).text()).toContain(
      'Existing',
    )
    expect(await Bun.file(join(bundle.proposalRoot, 'AGENTS.md')).exists()).toBe(false)
    expect(await Bun.file(bundle.promptFile).text()).toContain(
      'scripts/hopi/prepare already exists',
    )
  })

  test('stages current Planner inputs without historical Planning and Input noise', async () => {
    const fixture = await createFixture(true)
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    const currentInput = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-current')
    const oldInput = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-old')
    planning.body = `${planning.body.trimEnd()}\n\n## Accepted Inputs\n\n- ${currentInput}\n`
    const historical = parseWorkDocument(planningSource)
    historical.attributes.id = 'plan-old'
    historical.attributes.stage = 'done'
    historical.body = '## Objective\n\nHistorical reassessment.\n'
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: currentInput,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-current',
              sourceDigest: 'a'.repeat(64),
              attachments: [],
            },
            body: 'Implement the current accepted requirement.\n',
          }),
        },
        {
          path: oldInput,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-old',
              sourceDigest: 'b'.repeat(64),
              attachments: [],
            },
            body: 'Superseded historical requirement.\n',
          }),
        },
        {
          path: fixture.store.paths.workDocument('goal-1', 'plan-old'),
          expectedHash: null,
          content: renderWorkDocument(historical),
        },
      ],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
        content: renderWorkDocument(planning),
      },
    })

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-current-input',
      responsibility: 'planner',
    })

    expect(
      await Bun.file(join(bundle.contextRoot, 'authority', ...currentInput.split('/'))).exists(),
    ).toBe(true)
    expect(
      await Bun.file(join(bundle.contextRoot, 'authority', ...oldInput.split('/'))).exists(),
    ).toBe(false)
    expect(
      await Bun.file(
        join(
          bundle.contextRoot,
          'authority',
          ...fixture.store.paths.workDocument('goal-1', 'plan-old').split('/'),
        ),
      ).exists(),
    ).toBe(false)
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('## Current Assignment')
    expect(prompt).toContain('Implement the current accepted requirement.')
    expect(prompt).not.toContain('Superseded historical requirement.')
  })

  test('states the Git, Attention, and Run-scoped runtime boundaries for Engineering passes', async () => {
    const fixture = await createFixture(true)
    await publishEngineeringWork(fixture)
    const unrelatedInputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-old')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: unrelatedInputPath,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-old',
              sourceDigest: 'a'.repeat(64),
              attachments: [],
            },
            body: 'Planner-owned historical input.\n',
          }),
        },
      ],
    })
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)
    const generator = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-generator',
      responsibility: 'generator',
    })
    const reviewer = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-reviewer',
      responsibility: 'reviewer',
    })

    const generatorPrompt = await Bun.file(generator.promptFile).text()
    const reviewerPrompt = await Bun.file(reviewer.promptFile).text()
    expect(generatorPrompt).toContain('never run Git write operations')
    expect(generatorPrompt).toContain('Coordinator alone owns the Git index')
    expect(generatorPrompt).toContain('## Current Assignment')
    expect(generatorPrompt).toContain('### Latest Owning Work Evidence')
    expect(generatorPrompt).toContain('Repair this first.')
    expect(generatorPrompt).toContain(
      'Allowed result for this generator Run: success, replan, or fail',
    )
    expect(await Bun.file(generator.contextFile).text()).toContain(
      `${fixture.store.paths.evidenceDocument('goal-1', 'E-latest')} (latest)`,
    )
    expect(generatorPrompt).toContain('If you stage targeted Attention, result must be fail')
    expect(generatorPrompt).toContain('Do not rerun an unchanged passing check')
    expect(reviewerPrompt).toContain('short-lived local services for this Run')
    expect(reviewerPrompt).toContain('Decide the proof plan before installing optional tools')
    expect(reviewerPrompt).toContain('A helper-only change normally needs focused tests')
    expect(reviewerPrompt).toContain(
      'exercise that exact path through the point after the reported failure',
    )
    expect(reviewerPrompt).toContain(`git merge-base ${HOPI_RELEASE_REF} HEAD`)
    expect(reviewerPrompt).toContain('C1 owns integration')
    expect(reviewerPrompt).toContain('local port')
    expect(reviewerPrompt).toContain('$HOPI_RUN_SCRATCH')
    expect((await stat(reviewer.runtimeScratchDir)).isDirectory()).toBe(true)
    expect(
      await Bun.file(
        join(generator.contextRoot, 'authority', ...unrelatedInputPath.split('/')),
      ).exists(),
    ).toBe(false)
    expect(
      await Bun.file(
        join(
          generator.contextRoot,
          'authority',
          ...fixture.store.paths.workDocument('goal-1', 'plan-initial').split('/'),
        ),
      ).exists(),
    ).toBe(false)
    expect(
      await Bun.file(
        join(
          generator.contextRoot,
          'authority',
          ...fixture.store.paths.workDocument('goal-1', 'W-1').split('/'),
        ),
      ).exists(),
    ).toBe(true)
  })

  test('attaches only images explicitly cited by the owning Work to every responsibility pass', async () => {
    const fixture = await createFixture(true)
    const selectedBytes = pngBytes(1)
    const unrelatedBytes = pngBytes(2)
    const selectedPath = fixture.store.paths.asset(
      'goal-1',
      await hashBytes(selectedBytes),
      'layout.png',
    )
    const unrelatedPath = fixture.store.paths.asset(
      'goal-1',
      await hashBytes(unrelatedBytes),
      'unrelated.png',
    )
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    planning.body = `${planning.body.trimEnd()}\n\n## Reference Images\n\n- \`${selectedPath}\` - Match the compact layout.\n`
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        { path: selectedPath, expectedHash: null, content: selectedBytes },
        { path: unrelatedPath, expectedHash: null, content: unrelatedBytes },
      ],
      gateWrite: {
        path: planningPath,
        expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
        content: renderWorkDocument(planning),
      },
    })
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)
    const planner = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-planner-image',
      responsibility: 'planner',
    })

    expect(planner.imageFiles).toHaveLength(1)
    expect(await Bun.file(planner.imageFiles?.[0] ?? '').arrayBuffer()).toEqual(
      selectedBytes.buffer,
    )
    expect(planner.authorityFiles.some((file) => file.path === selectedPath)).toBe(true)
    expect(planner.authorityFiles.some((file) => file.path === unrelatedPath)).toBe(false)
    expect(await Bun.file(planner.promptFile).text()).toContain(
      'preserve its exact Goal asset path and purpose',
    )

    await publishEngineeringWork(
      fixture,
      `## Acceptance Criteria\n\n- Recreate the panel hierarchy.\n\n## Reference Images\n\n- \`${selectedPath}\` - Match the compact layout.\n`,
    )
    const generator = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-generator-image',
      responsibility: 'generator',
    })
    const reviewer = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-reviewer-image',
      responsibility: 'reviewer',
    })

    expect(generator.imageFiles).toHaveLength(1)
    expect(reviewer.imageFiles).toHaveLength(1)
    expect(generator.guardFiles[selectedPath]).toBeTruthy()
    expect(generator.guardFiles[unrelatedPath]).toBeUndefined()
    expect(await Bun.file(generator.promptFile).text()).toContain('follow the documented purpose')
    expect(await Bun.file(reviewer.promptFile).text()).toContain('attached original image')
  })
})

async function createFixture(withAgents: boolean, withPrepare = false) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'hopi-role-context-'))
  temporaryRoots.push(temporaryRoot)
  const homeRoot = join(temporaryRoot, 'home')
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(join(repoRoot, 'src'), { recursive: true })
  await Bun.write(join(repoRoot, 'src', 'index.ts'), 'export const hello = "hello"\n')
  if (withAgents) await Bun.write(join(repoRoot, 'AGENTS.md'), '# Existing instructions\n')
  if (withPrepare) {
    await mkdir(join(repoRoot, 'scripts', 'hopi'), { recursive: true })
    await Bun.write(
      join(repoRoot, 'scripts', 'hopi', 'prepare'),
      '#!/usr/bin/env bun\nconsole.log("ready")\n',
    )
  }
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])

  const homeStore = createAssistantHomeStore(homeRoot)
  await homeStore.initialize()
  const linked = await homeStore.linkProject({
    projectId: 'project-1',
    repoPath: repoRoot,
  })
  const publisher = new PublicationCoordinator()
  const store = createGoalPackageStore(linked.integrationRoot, 'project-1', publisher)
  await store.createGoal({
    goalId: 'goal-1',
    title: 'Test Goal',
    objective: 'Exercise role context staging.',
  })
  return { homeRoot, projectRoot: linked.integrationRoot, publisher, store }
}

async function publishEngineeringWork(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  body = '## Acceptance Criteria\n\n- The implementation is verified.\n',
) {
  const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
  const source = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
  const planning = parseWorkDocument(source)
  planning.attributes.stage = 'done'
  await fixture.store.publishGoal('goal-1', {
    supportingWrites: [
      {
        path: fixture.store.paths.evidenceDocument('goal-1', 'E-latest'),
        expectedHash: null,
        content: renderEvidenceDocument({
          attributes: {
            id: 'E-latest',
            createdAt: '2026-07-11T00:00:00Z',
            producerRun: 'project:project-1/goal:goal-1/work:W-1/run:R-review',
            coordinatorCheck: null,
            owner: 'project:project-1/goal:goal-1/work:W-1',
            artifacts: [],
          },
          body: '## Responsibility Result\n\n- Result: reject\n\n## Summary\n\nRepair this first.\n',
        }),
      },
      {
        path: fixture.store.paths.workDocument('goal-1', 'W-1'),
        expectedHash: null,
        content: renderWorkDocument({
          attributes: {
            id: 'W-1',
            title: 'Engineering Work',
            kind: 'engineering',
            stage: 'generate',
            notBefore: null,
            dependsOn: [],
            contractRevision: 1,
            evidenceRefs: ['E-latest'],
            attempts: 0,
          },
          body,
        }),
      },
    ],
    gateWrite: {
      path: planningPath,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(planning),
    },
  })
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}

function pngBytes(marker: number) {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
}
