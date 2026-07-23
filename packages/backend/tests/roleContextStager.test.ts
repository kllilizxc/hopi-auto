import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  parseGoalDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderGoalDocument,
  renderInputDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { projectReleaseRef } from '../src/domain/project'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createRoleContextStager } from '../src/runtime/roleContextStager'
import { runStoragePath } from '../src/runtime/runPaths'
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
      apiOrigin: 'http://127.0.0.1:3000/internal/path',
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
    expect(prompt).toContain('## Primary Task')
    expect(prompt).toContain('### Goal Contract: Test Goal')
    expect(prompt).toContain('<planning-work>')
    expect(prompt).toContain('## Execution Boundary')
    expect(prompt).not.toContain(bundle.goalHash)
    expect(prompt).not.toContain(bundle.workHash)
    expect(occurrences(prompt, fixture.store.paths.goalDocument('goal-1'))).toBe(1)
    expect(occurrences(prompt, fixture.store.paths.workDocument('goal-1', 'plan-initial'))).toBe(1)
    expect(prompt).toContain('Goal authority and source are read-only')
    expect(prompt).toContain('kind: engineering')
    expect(prompt).toContain('Authority and evidence are immutable')
    expect(prompt).toContain('Proposal is a sparse overlay')
    expect(prompt).toContain('an absent path is unchanged')
    expect(prompt).toContain('smallest complete Engineering DAG')
    expect(prompt).toContain('Goal completion proposal protocol')
    expect(prompt).toContain('Coordinator alone changes canonical control state')
    expect(prompt).toContain('$HOPI_REPOS_FILE is the complete Project source-root map')
    const repoManifest = await Bun.file(bundle.reposFile).json()
    expect(repoManifest).toEqual({
      primaryRepoId: 'primary',
      releaseRef: projectReleaseRef('project-1'),
      repos: { primary: fixture.projectRoot },
      releaseHeads: { primary: bundle.releaseHead },
    })
    const context = await Bun.file(bundle.contextFile).text()
    expect(context).toContain(`Primary authority release snapshot: ${bundle.releaseHead}`)
    expect(context).toContain(`Project release ref in each Repo: ${projectReleaseRef('project-1')}`)
    expect(context).toContain(`Release head: ${bundle.releaseHead}`)
    expect(context).not.toContain('Integration target snapshot:')
    expect(prompt).toContain('Engineering Work document protocol')
    expect(prompt).toContain('kind: engineering')
    expect(prompt).not.toContain('repos: [<one-or-more-listed-repo-ids>]')
    expect(prompt).toContain('.hopi/docs/repos.md')
    expect(prompt).toContain('Working directory: $HOPI_SESSION_WORKSPACE')
    expect(prompt).not.toContain(bundle.runRoot)
    expect(prompt).toContain('target: project:project-1/goal:goal-1/work:plan-initial')
    expect(prompt).toContain('notifiedAt: null')
    expect(prompt).toContain('Browser harness, when installed')
    expect(prompt).toContain('$HOPI_BROWSER_HARNESS_COMMAND')
    expect(bundle.browserHarnessCommand).toBe(
      process.env.HOPI_BROWSER_HARNESS_COMMAND?.trim() ||
        Bun.which('codex-browser-harness') ||
        Bun.which('browser-harness') ||
        undefined,
    )
    expect(prompt).toContain('HOPI API: $HOPI_API_ORIGIN')
    expect(prompt).not.toContain('Retry only')
    expect(prompt).not.toContain('choose the available')
    expect(prompt).not.toContain('Planner working directory is not a Git checkout')
    expect(prompt.length).toBeLessThan(5_000)
    expect(bundle.apiOrigin).toBe('http://127.0.0.1:3000')
    expect(bundle.authorityFiles.find((file) => file.path === 'AGENTS.md')?.hash).toBeNull()

    const next = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-1-next',
      responsibility: 'planner',
      apiOrigin: 'http://127.0.0.1:3000/internal/path',
    })
    expect(await Bun.file(next.promptFile).text()).toBe(prompt)
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
    expect(bundle.extraReadableRoots).toContain(fixture.projectRoot)
    expect(bundle.extraWritableRoots).not.toContain(fixture.projectRoot)
    expect(await Bun.file(join(bundle.proposalRoot, 'AGENTS.md')).exists()).toBe(false)
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('Project guidance: AGENTS.md')
    expect(prompt).not.toContain('$HOPI_BOOTSTRAP_SOURCE_ROOT')
  })

  test('stages the formal release Preview as immutable Planner completion context', async () => {
    const fixture = await createFixture(true)
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)
    const baseline = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-preview-baseline',
      responsibility: 'planner',
    })
    const bundle = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-formal-preview',
      responsibility: 'planner',
      formalReleasePreview: {
        kind: 'session',
        session: {
          sessionId: 'preview-release-1',
          projectId: 'project-1',
          releaseHeads: { primary: baseline.releaseHead },
          status: 'running',
          surfaces: [
            { id: 'sender', label: 'Sender', url: 'http://127.0.0.1:4311/sender' },
            { id: 'receiver', label: 'Receiver', url: 'http://127.0.0.1:4312/receiver' },
          ],
          logPath: '/tmp/preview-release-1.log',
          startedAt: '2026-07-23T00:00:00.000Z',
          endedAt: null,
          error: null,
          stoppedReason: null,
          repair: null,
        },
      },
    })

    expect(bundle.formalReleasePreviewFile).toBeDefined()
    expect(await Bun.file(bundle.formalReleasePreviewFile ?? '').json()).toMatchObject({
      kind: 'session',
      session: {
        sessionId: 'preview-release-1',
        releaseHeads: { primary: baseline.releaseHead },
        status: 'running',
      },
    })
    expect((await stat(bundle.formalReleasePreviewFile ?? '')).mode & 0o222).toBe(0)
    expect(await Bun.file(bundle.contextFile).text()).toContain(
      'Surface receiver (Receiver): http://127.0.0.1:4312/receiver',
    )
    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('Formal release Preview: $HOPI_FORMAL_RELEASE_PREVIEW_FILE')
    expect(prompt).toContain(
      'Goal completion evidence comes from the supplied formal release Preview at its listed release heads',
    )
    expect(prompt).not.toContain('HTTP reachability')
    expect(prompt).not.toContain('generic healthy Preview')
    expect(bundle.repoReleaseHeads).toEqual({ primary: baseline.releaseHead })
  })

  test('stages Home preferences only for Planner without adding them to semantic guards', async () => {
    const fixture = await createFixture(true)
    const preference = '# Preferences\n\n- Prefer the smallest portable design.\n'
    await Bun.write(join(fixture.homeRoot, '.hopi', 'preference.md'), preference)
    const stager = createRoleContextStager(fixture.homeRoot, fixture.publisher)

    const planner = await stager.prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-planner-preference',
      responsibility: 'planner',
    })

    expect(planner.operatorPreferenceFile).toBeDefined()
    expect(await Bun.file(planner.operatorPreferenceFile ?? '').text()).toBe(preference)
    expect(await Bun.file(planner.promptFile).text()).toContain(
      'Operator preferences are defaults below current Input',
    )
    expect(await Bun.file(planner.contextFile).text()).toContain('Operator preference snapshot:')
    expect(planner.authorityFiles.some((file) => file.path === '.hopi/preference.md')).toBe(false)
    expect(planner.guardFiles['.hopi/preference.md']).toBeUndefined()

    await publishEngineeringWork(fixture)
    for (const responsibility of ['generator', 'reviewer'] as const) {
      const bundle = await stager.prepare({
        projectRoot: fixture.projectRoot,
        projectId: 'project-1',
        goalId: 'goal-1',
        workId: 'W-1',
        runId: `run-${responsibility}-preference`,
        responsibility,
      })
      expect(bundle.operatorPreferenceFile).toBeUndefined()
      expect(await Bun.file(bundle.promptFile).text()).not.toContain(
        'Prefer the smallest portable design.',
      )
      expect(bundle.authorityFiles.some((file) => file.path === '.hopi/preference.md')).toBe(false)
    }
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
    expect(prompt).toContain('## Primary Task')
    expect(prompt).toContain('### Accepted Inputs')
    expect(prompt).toContain('<accepted-input>')
    expect(prompt).toContain('Implement the current accepted requirement.')
    expect(prompt).not.toContain('Superseded historical requirement.')
    expect(occurrences(prompt, currentInput)).toBe(1)
  })

  test('does not repeat an accepted Input already represented in the Goal contract', async () => {
    const fixture = await createFixture(true)
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    const inputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-current')
    planning.attributes.contractRevision = 2
    planning.body = `${planning.body.trimEnd()}\n\n## Accepted Inputs\n\n- ${inputPath}\n`

    const goalPath = fixture.store.paths.goalDocument('goal-1')
    const goalSource = await Bun.file(fixture.store.paths.absolute(goalPath)).text()
    const goal = parseGoalDocument(goalSource)
    goal.attributes.contractRevision = 2
    goal.body = `${goal.body.trimEnd()}\n\n## Accepted Inbox Instruction EV-current\n\nUse the local Codex CLI.\n`

    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: inputPath,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-current',
              sourceDigest: 'c'.repeat(64),
              attachments: [],
            },
            body: 'Use the local Codex CLI.\n',
          }),
        },
        {
          path: planningPath,
          expectedHash: await hashBytes(new TextEncoder().encode(planningSource)),
          content: renderWorkDocument(planning),
        },
      ],
      gateWrite: {
        path: goalPath,
        expectedHash: await hashBytes(new TextEncoder().encode(goalSource)),
        content: renderGoalDocument(goal),
      },
    })

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-deduplicated-input',
      responsibility: 'planner',
    })
    const prompt = await Bun.file(bundle.promptFile).text()

    expect(occurrences(prompt, 'Use the local Codex CLI.')).toBe(1)
    expect(prompt).not.toContain('<accepted-input>')
    expect(
      await Bun.file(join(bundle.contextRoot, 'authority', ...inputPath.split('/'))).exists(),
    ).toBe(true)
  })

  test('stages resolved Attention provenance without expanding it as a Planning Input', async () => {
    const fixture = await createFixture(true)
    const resolutionInput = fixture.store.paths.inputDocument(
      'goal-1',
      'H-1',
      'EV-attention-recovery',
    )
    const attentionPath = fixture.store.paths.attentionDocument('goal-1', 'A-resolved')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: resolutionInput,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-attention-recovery',
              sourceDigest: 'd'.repeat(64),
              attachments: [],
            },
            body: 'Close the old Attention and continue.\n',
          }),
        },
        {
          path: attentionPath,
          expectedHash: null,
          content: renderAttentionDocument({
            attributes: {
              id: 'A-resolved',
              target: 'project:project-1/goal:goal-1/work:plan-initial',
              createdAt: '2026-07-17T00:00:00.000Z',
              resolvedAt: '2026-07-17T00:01:00.000Z',
              notifiedAt: '2026-07-17T00:00:30.000Z',
              resolutionInput,
            },
            body: 'The old route was superseded.\n',
          }),
        },
      ],
    })

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-resolution-provenance',
      responsibility: 'planner',
    })
    const prompt = await Bun.file(bundle.promptFile).text()

    expect(prompt).not.toContain('Close the old Attention and continue.')
    expect(
      await Bun.file(join(bundle.contextRoot, 'authority', ...resolutionInput.split('/'))).exists(),
    ).toBe(true)
    expect(
      await Bun.file(join(bundle.contextRoot, 'authority', ...attentionPath.split('/'))).exists(),
    ).toBe(true)
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
    expect(generator.extraReadableRoots).toContain(fixture.projectRoot)
    expect(generator.extraWritableRoots).toContain(fixture.projectRoot)
    expect(reviewer.extraReadableRoots).toContain(fixture.projectRoot)
    expect(reviewer.extraWritableRoots).not.toContain(fixture.projectRoot)
    expect(reviewerPrompt).toContain('Working directory: $HOPI_SESSION_WORKSPACE')
    expect(generatorPrompt).toContain('Working directory: $HOPI_PRIMARY_REPO_ROOT')
    expect(reviewerPrompt).not.toContain(reviewer.runRoot)
    expect(generatorPrompt).not.toContain('Git writes such as add, commit')
    expect(generatorPrompt).toContain('Current execution environment:')
    expect(generatorPrompt).toContain('__HOPI_EXECUTION_ENVELOPE__')
    expect(generatorPrompt).toContain('HOPI-managed Git metadata are Coordinator-owned')
    expect(generatorPrompt).toContain('Run scratch: $HOPI_RUN_SCRATCH')
    expect(generatorPrompt).toContain(
      'External effects require explicit Work or operator authority',
    )
    expect(generatorPrompt).toContain('### Engineering Work: Engineering Work')
    expect(generatorPrompt).not.toContain('### Goal Contract')
    expect(generatorPrompt).not.toContain('Exercise role context staging.')
    expect(generatorPrompt).not.toContain(generator.goalHash)
    expect(generatorPrompt).not.toContain(generator.workHash)
    expect(generatorPrompt).toContain('### Latest Owning Work Evidence')
    expect(generatorPrompt).toContain('Repair this first.')
    expect(generatorPrompt).toContain(
      'Allowed result for this generator Run: success, attention, or fail',
    )
    expect(await Bun.file(generator.contextFile).text()).toContain(
      fixture.store.paths.evidenceDocument('goal-1', 'E-latest'),
    )
    for (const prompt of [generatorPrompt, reviewerPrompt]) {
      expect(prompt).toContain('targeted Attention file whose stem equals its id')
      expect(prompt).toContain('id: <stable-id>')
      expect(prompt).toContain('target: project:project-1/goal:goal-1/work:W-1')
      expect(prompt).toContain('createdAt: 1970-01-01T00:00:00.000Z')
      expect(prompt).toContain('resolvedAt: null')
      expect(prompt).toContain('notifiedAt: null')
      expect(prompt).toContain('The final response is exactly one JSON object')
      expect(prompt).not.toContain('Retry only')
      expect(prompt).not.toContain('choose the available browser client')
      expect(prompt).not.toContain('Do not enter a vendor plan-approval mode')
      expect(prompt.length).toBeLessThan(5_000)
    }
    expect(generatorPrompt).toContain('implement the complete Engineering Work')
    expect(generatorPrompt).toContain(
      'Public Preview, when present, observes the integrated release',
    )
    expect(reviewerPrompt).toContain(
      'independently determine whether the Engineering Work satisfies',
    )
    expect(reviewerPrompt).toContain(`git merge-base ${projectReleaseRef('project-1')} HEAD`)
    expect(reviewerPrompt).toContain('Source, Project documents, canonical .hopi state')
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

  test('projects the latest reproducer without repeating prior Generator claims', async () => {
    const fixture = await createFixture(true)
    const artifactReference = 'artifact:R-review/reproducer.txt'
    const artifactPath = join(
      runStoragePath(fixture.homeRoot, 'R-review'),
      'artifacts',
      'reproducer.txt',
    )
    await mkdir(join(runStoragePath(fixture.homeRoot, 'R-review'), 'artifacts'), {
      recursive: true,
    })
    await Bun.write(artifactPath, 'bun test regression\n')
    await publishEngineeringWork(
      fixture,
      '## Acceptance Criteria\n\n- The implementation is verified.\n',
      [artifactReference],
    )
    const taskRoot = join(dirname(fixture.homeRoot), 'task-worktree')
    await git(fixture.projectRoot, ['worktree', 'add', '-b', 'hopi/test-task', taskRoot, 'HEAD'])
    await rm(join(taskRoot, 'src', 'index.ts'))
    await git(taskRoot, ['add', '.'])
    await git(taskRoot, ['commit', '-m', 'delete source file'])

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-repair-view',
      responsibility: 'generator',
      repoRoots: [{ repoId: 'primary', path: taskRoot, primary: true }],
    })
    const projectedPath = join(bundle.contextRoot, 'evidence-artifacts', '001-reproducer.txt')
    const prompt = await Bun.file(bundle.promptFile).text()

    expect(await Bun.file(projectedPath).text()).toBe('bun test regression\n')
    expect(prompt).toContain(`- ${artifactReference} -> ${projectedPath}`)
    expect(prompt).toContain('### Latest Owning Work Evidence (Historical Run Result)')
    expect(prompt).toContain(
      'This records the producing Run; current candidate and release state are reported separately below.',
    )
    expect(prompt).toContain('Current candidate integration preflight:')
    expect(prompt).toContain('- Repo primary')
    expect(prompt).toContain('  - Result: ready')
    expect(prompt).toContain('- primary:src/index.ts')
    expect(prompt).not.toContain('Previous Generator Attempt')
    expect(prompt).not.toContain('Observed execution commands')
  })

  test('stages transitive dependency Evidence and resolves its Run artifacts', async () => {
    const fixture = await createFixture(true)
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    planning.attributes.stage = 'done'
    const artifactReference = 'artifact:R-base/001-proof.txt'
    const artifactPath = join(
      runStoragePath(fixture.homeRoot, 'R-base'),
      'artifacts',
      '001-proof.txt',
    )
    await mkdir(join(runStoragePath(fixture.homeRoot, 'R-base'), 'artifacts'), {
      recursive: true,
    })
    await Bun.write(artifactPath, 'accepted predecessor proof\n')

    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: fixture.store.paths.evidenceDocument('goal-1', 'E-explicit'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-explicit',
              createdAt: '2026-07-16T23:57:00Z',
              producerRun: 'project:project-1/goal:goal-1/work:W-base/run:R-explicit',
              coordinatorCheck: null,
              owner: 'project:project-1/goal:goal-1/work:W-base',
              artifacts: [],
            },
            body: 'An older proof remains explicitly relevant.\n',
          }),
        },
        {
          path: fixture.store.paths.evidenceDocument('goal-1', 'E-obsolete'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-obsolete',
              createdAt: '2026-07-16T23:58:00Z',
              producerRun: 'project:project-1/goal:goal-1/work:W-base/run:R-obsolete',
              coordinatorCheck: null,
              owner: 'project:project-1/goal:goal-1/work:W-base',
              artifacts: [],
            },
            body: 'Superseded failed proof.\n',
          }),
        },
        {
          path: fixture.store.paths.evidenceDocument('goal-1', 'E-candidate'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-candidate',
              createdAt: '2026-07-16T23:59:00Z',
              producerRun: 'project:project-1/goal:goal-1/work:W-base/run:R-candidate',
              coordinatorCheck: null,
              owner: 'project:project-1/goal:goal-1/work:W-base',
              artifacts: [],
            },
            body: 'The final Generator candidate is ready.\n',
          }),
        },
        {
          path: fixture.store.paths.evidenceDocument('goal-1', 'E-base'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-base',
              createdAt: '2026-07-17T00:00:00Z',
              producerRun: 'project:project-1/goal:goal-1/work:W-base/run:R-base',
              coordinatorCheck: null,
              owner: 'project:project-1/goal:goal-1/work:W-base',
              artifacts: [artifactReference],
            },
            body: 'The base behavior is accepted.\n',
          }),
        },
        {
          path: fixture.store.paths.evidenceDocument('goal-1', 'E-middle'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-middle',
              createdAt: '2026-07-17T00:01:00Z',
              producerRun: 'project:project-1/goal:goal-1/work:W-middle/run:R-middle',
              coordinatorCheck: null,
              owner: 'project:project-1/goal:goal-1/work:W-middle',
              artifacts: [],
            },
            body: 'The middle behavior is accepted.\n',
          }),
        },
        {
          path: fixture.store.paths.workDocument('goal-1', 'W-base'),
          expectedHash: null,
          content: renderWorkDocument({
            attributes: {
              id: 'W-base',
              title: 'Base Work',
              kind: 'engineering',
              stage: 'done',
              notBefore: null,
              dependsOn: [],
              contractRevision: 1,
              evidenceRefs: ['E-explicit', 'E-obsolete', 'E-candidate', 'E-base'],
              attempts: 0,
            },
            body: 'Provide the base behavior and retain the specifically cited `E-explicit` proof.\n',
          }),
        },
        {
          path: fixture.store.paths.workDocument('goal-1', 'W-middle'),
          expectedHash: null,
          content: renderWorkDocument({
            attributes: {
              id: 'W-middle',
              title: 'Middle Work',
              kind: 'engineering',
              stage: 'done',
              notBefore: null,
              dependsOn: ['W-base'],
              contractRevision: 1,
              evidenceRefs: ['E-middle'],
              attempts: 0,
            },
            body: 'Build on the base behavior.\n',
          }),
        },
        {
          path: fixture.store.paths.workDocument('goal-1', 'W-current'),
          expectedHash: null,
          content: renderWorkDocument({
            attributes: {
              id: 'W-current',
              title: 'Current Work',
              kind: 'engineering',
              stage: 'generate',
              notBefore: null,
              dependsOn: ['W-middle'],
              contractRevision: 1,
              evidenceRefs: [],
              attempts: 0,
            },
            body: 'Use the accepted predecessor result.\n',
          }),
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
      workId: 'W-current',
      runId: 'run-dependency-context',
      responsibility: 'generator',
    })
    const authorityRoot = join(bundle.contextRoot, 'authority')
    for (const path of [
      fixture.store.paths.workDocument('goal-1', 'W-base'),
      fixture.store.paths.workDocument('goal-1', 'W-middle'),
      fixture.store.paths.evidenceDocument('goal-1', 'E-explicit'),
      fixture.store.paths.evidenceDocument('goal-1', 'E-candidate'),
      fixture.store.paths.evidenceDocument('goal-1', 'E-base'),
      fixture.store.paths.evidenceDocument('goal-1', 'E-middle'),
    ]) {
      expect(await Bun.file(join(authorityRoot, ...path.split('/'))).exists()).toBe(true)
      expect(bundle.guardFiles[path]).toBeTruthy()
    }
    const obsoletePath = fixture.store.paths.evidenceDocument('goal-1', 'E-obsolete')
    expect(await Bun.file(join(authorityRoot, ...obsoletePath.split('/'))).exists()).toBe(false)
    expect(bundle.guardFiles[obsoletePath]).toBeUndefined()
    expect(bundle.artifactManifestFile).toBeDefined()
    const projectedArtifactPath = join(
      bundle.contextRoot,
      'evidence-artifacts',
      '001-001-proof.txt',
    )
    expect(await Bun.file(bundle.artifactManifestFile ?? '').json()).toEqual({
      version: 1,
      artifacts: [
        {
          reference: artifactReference,
          path: projectedArtifactPath,
          evidence: [fixture.store.paths.evidenceDocument('goal-1', 'E-base')],
        },
      ],
    })
    expect(await Bun.file(projectedArtifactPath).text()).toBe('accepted predecessor proof\n')
    expect((await stat(projectedArtifactPath)).mode & 0o222).toBe(0)
    expect((await stat(bundle.artifactManifestFile ?? '')).mode & 0o222).toBe(0)
    expect(await Bun.file(bundle.contextFile).text()).toContain('Evidence artifact manifest:')
    expect(await Bun.file(bundle.promptFile).text()).toContain('$HOPI_EVIDENCE_ARTIFACTS_FILE')
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
      'Attached images are Goal assets with their authority-defined purpose',
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
    expect(await Bun.file(generator.promptFile).text()).toContain(
      'Attached images are Goal assets with their authority-defined purpose',
    )
    expect(await Bun.file(reviewer.promptFile).text()).toContain(
      'Attached images are Goal assets with their authority-defined purpose',
    )
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
  artifacts: string[] = [],
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
            artifacts,
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

function occurrences(value: string, fragment: string) {
  return value.split(fragment).length - 1
}
