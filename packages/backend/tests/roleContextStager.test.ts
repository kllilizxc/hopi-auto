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
import {
  browserEnvironmentRoot,
  browserHarnessAdapterCommand,
  browserTargetManifest,
  resolveBrowserHarnessBackendCommand,
  resolveManagedBrowserCommand,
} from '../src/runtime/browserEnvironment'
import { createRoleContextStager as createProductionRoleContextStager } from '../src/runtime/roleContextStager'
import { runStoragePath } from '../src/runtime/runPaths'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoots: string[] = []

type ProductionRoleContextStager = ReturnType<typeof createProductionRoleContextStager>
type TestPrepareRoleContextInput = Omit<
  Parameters<ProductionRoleContextStager['prepare']>[0],
  'primaryRepoId' | 'repoRoots'
> &
  Partial<
    Pick<Parameters<ProductionRoleContextStager['prepare']>[0], 'primaryRepoId' | 'repoRoots'>
  >
type TestRoleContextStager = Omit<ProductionRoleContextStager, 'prepare'> & {
  prepare(input: TestPrepareRoleContextInput): ReturnType<ProductionRoleContextStager['prepare']>
}

function createRoleContextStager(
  ...args: Parameters<typeof createProductionRoleContextStager>
): TestRoleContextStager {
  const stager = createProductionRoleContextStager(...args)
  return {
    prepare(input: TestPrepareRoleContextInput) {
      return stager.prepare({
        ...input,
        primaryRepoId: input.primaryRepoId ?? 'primary',
        repoRoots: input.repoRoots ?? [
          { repoId: 'primary', path: input.projectRoot, primary: true },
        ],
      })
    },
  }
}

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
    expect(prompt).toContain('Authority and evidence are immutable')
    expect(prompt).toContain('Proposal is a sparse overlay')
    expect(prompt).toContain(
      'Only paths and exact control-field values declared by $HOPI_PROPOSAL_CAPABILITIES_FILE can be published',
    )
    expect(prompt).toContain('an absent path is unchanged')
    expect(prompt).toContain(
      'only the Engineering Work required to reach the current Goal boundary',
    )
    expect(prompt).not.toContain('plan separate Work for independent outcomes')
    expect(prompt).toContain('Coordinator alone changes canonical control state')
    expect(prompt).toContain('$HOPI_REPOS_FILE is the complete Project root map')
    expect(prompt).toContain('Read only its roots')
    expect(prompt).toContain('never scan parents/siblings')
    expect(prompt).toContain(
      'preserve that baseline and runbook boundary in design and Repo context',
    )
    expect(prompt).toContain(
      'If source conflicts or missing authority can materially change the plan',
    )
    expect(prompt).toContain('propose no Work in the same result')
    expect(prompt).toContain('reuse or update the smallest Attention')
    expect(prompt).toContain(
      'smallest real delivery supported by current source and toolchain facts',
    )
    expect(prompt).toContain('one coherent durable candidate and one primary verification strategy')
    expect(prompt).toContain('stable contract, artifact, or proof boundary')
    expect(prompt).toContain('Rehearse every proposed Work')
    expect(prompt).toContain('Split independent flows, state machines, operation families')
    expect(prompt).toContain('keep each accepted intermediate release buildable')
    expect(prompt).toContain('durable candidate, deliberately deferred behavior')
    expect(prompt).toContain('Use judgment, not quotas or prescribed headings')
    expect(prompt).toContain('named test suite is only a container, not a proof boundary')
    expect(prompt).toContain('One aggregate suite cannot make independently failing')
    expect(prompt).toContain('Do not turn a one-time deliverable into a general parser')
    expect(prompt).toContain('finite accepted input grammar and material invariants')
    expect(prompt).toContain(
      '.hopi/docs/repos.md records Repo responsibilities, important commands, shared contracts, and combined runtime topology',
    )
    const proposalCapabilities = await Bun.file(bundle.proposalCapabilitiesFile).json()
    expect(
      proposalCapabilities.writable.map((capability: { type: string }) => capability.type),
    ).toEqual(expect.arrayContaining(['engineering-work', 'targeted-attention']))
    expect(await Bun.file(bundle.resultSchemaFile).json()).toMatchObject({
      properties: { result: { enum: ['success', 'fail'] } },
    })
    const repoManifest = await Bun.file(bundle.reposFile).json()
    expect(repoManifest).toEqual({
      projection: 'release',
      primaryRepoId: 'primary',
      releaseRef: projectReleaseRef('project-1'),
      repos: { primary: fixture.projectRoot },
      releaseHeads: { primary: bundle.releaseHead },
      guidance: {},
    })
    const context = await Bun.file(bundle.contextFile).text()
    expect(context).toContain(`Primary authority release snapshot: ${bundle.releaseHead}`)
    expect(context).toContain(`Project release ref in each Repo: ${projectReleaseRef('project-1')}`)
    expect(context).toContain('Repo workspace projection: release')
    expect(context).toContain(`Projection head: ${bundle.releaseHead}`)
    expect(context).toContain(`Base release head: ${bundle.releaseHead}`)
    expect(context).toContain('Immutable authority root: $HOPI_AUTHORITY_ROOT')
    expect(context).toContain('Writable proposal root: $HOPI_PROPOSAL_ROOT')
    expect(context).toContain('Repo workspace manifest: $HOPI_REPOS_FILE')
    expect(context).not.toContain(bundle.runRoot)
    expect(context).not.toContain('Integration target snapshot:')
    expect(prompt).not.toContain('repos: [<one-or-more-listed-repo-ids>]')
    expect(proposalCapabilities.writable).toContainEqual({
      type: 'project-repo-context',
      path: '.hopi/docs/repos.md',
      purpose: 'Repo ownership, important commands, shared contracts, and combined runtime shape',
    })
    expect(prompt).toContain('Working directory: $HOPI_SESSION_WORKSPACE')
    expect(prompt).not.toContain(bundle.runRoot)
    expect(proposalCapabilities.writable).toContainEqual(
      expect.objectContaining({
        type: 'targeted-attention',
        pathPattern: expect.stringMatching(/\/attention\/\{id\}\.md$/),
        fields: expect.objectContaining({
          id: '{id}',
          decisionPrompt: {
            questions: [
              expect.objectContaining({
                id: 'scope',
                question: 'Which scope should the implementation use?',
                options: expect.arrayContaining([
                  expect.objectContaining({ recommended: true }),
                  expect.objectContaining({ id: 'alternative' }),
                ]),
              }),
            ],
          },
        }),
        fieldConstraints: {
          decisionPrompt: 'optional or null; 1-8 questions; 2-3 options per question',
        },
        target: 'project:project-1/goal:goal-1/work:plan-initial',
      }),
    )
    expect(prompt).not.toContain('Reviewer success')
    expect(prompt).not.toContain('terminal proof boundary')
    expect(prompt).toContain('never the future checkpoint identity')
    expect(prompt).toContain('Coordinator Evidence owns it')
    expect(prompt).toContain('owns the nonterminal dependsOn DAG')
    expect(prompt).toContain('leave it acyclic')
    expect(await Bun.file(bundle.resultSchemaFile).json()).toMatchObject({
      properties: {
        summary: {
          type: 'string',
          minLength: 1,
          maxLength: 600,
        },
      },
    })
    expect(prompt).toContain('Browser harness, when installed')
    expect(prompt).toContain('$HOPI_BROWSER_HARNESS_COMMAND')
    const browserHarnessBackend = resolveBrowserHarnessBackendCommand()
    const browserAvailable = Boolean(browserHarnessBackend && resolveManagedBrowserCommand())
    expect(bundle.browserHarnessBackendCommand).toBe(
      browserAvailable ? browserHarnessBackend : undefined,
    )
    expect(bundle.browserHarnessCommand).toBe(
      browserAvailable ? browserHarnessAdapterCommand() : undefined,
    )
    expect(bundle.browserHome).toBe(browserAvailable ? fixture.homeRoot : undefined)
    expect(bundle.browserTargetsFile).toBe(
      browserAvailable ? join(bundle.contextRoot, 'browser-targets.json') : undefined,
    )
    if (bundle.browserTargetsFile) {
      expect(await Bun.file(bundle.browserTargetsFile).json()).toEqual(browserTargetManifest())
      expect(prompt).toContain('Browser targets: $HOPI_BROWSER_TARGETS_FILE')
      expect(bundle.extraWritableRoots).toContain(browserEnvironmentRoot(fixture.homeRoot))
    }
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
    expect(prompt).toContain('Primary Project guidance: AGENTS.md')
    expect(prompt).toContain(
      `Applicable Repo guidance primary: ${join(fixture.projectRoot, 'AGENTS.md')}`,
    )
    expect(prompt).not.toContain('$HOPI_BOOTSTRAP_SOURCE_ROOT')
  })

  test('exposes guidance paths from every linked Repo without classifying their contents', async () => {
    const fixture = await createFixture(true)
    const knowledgeRoot = join(dirname(fixture.homeRoot), 'knowledge-repo')
    await mkdir(join(knowledgeRoot, 'runbooks'), { recursive: true })
    await Bun.write(
      join(knowledgeRoot, 'AGENTS.md'),
      '# Knowledge guidance\n\nUse the relevant runbook for the owned outcome.\n',
    )
    await Bun.write(
      join(knowledgeRoot, 'runbooks', 'local-preview.md'),
      '# Local Preview\n\nService startup knowledge.\n',
    )
    await git(knowledgeRoot, ['init', '-b', 'main'])
    await git(knowledgeRoot, ['config', 'user.email', 'hopi@example.test'])
    await git(knowledgeRoot, ['config', 'user.name', 'HOPI Test'])
    await git(knowledgeRoot, ['add', '.'])
    await git(knowledgeRoot, ['commit', '-m', 'knowledge'])
    await git(knowledgeRoot, ['update-ref', projectReleaseRef('project-1'), 'HEAD'])

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-multi-repo-guidance',
      responsibility: 'planner',
      repoRoots: [
        { repoId: 'primary', path: fixture.projectRoot, primary: true },
        { repoId: 'knowledge', path: knowledgeRoot, primary: false },
      ],
    })
    const prompt = await Bun.file(bundle.promptFile).text()
    const context = await Bun.file(bundle.contextFile).text()
    const manifest = await Bun.file(bundle.reposFile).json()

    expect(manifest.guidance).toEqual({
      primary: join(fixture.projectRoot, 'AGENTS.md'),
      knowledge: join(knowledgeRoot, 'AGENTS.md'),
    })
    expect(prompt).toContain(
      `Applicable Repo guidance knowledge: ${join(knowledgeRoot, 'AGENTS.md')}`,
    )
    expect(context).toContain(
      `Applicable Repo guidance knowledge: ${join(knowledgeRoot, 'AGENTS.md')}`,
    )
    expect(prompt).toContain('They may contain source or knowledge')
    expect(prompt).not.toContain('local-preview.md')
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
      'Preferences rank below current Input',
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
    planning.attributes.contextRefs = [
      { path: currentInput, purpose: 'Current accepted requirement' },
    ]
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
    expect(occurrences(prompt, currentInput)).toBe(2)
  })

  test('stages explicit Input even when its prose overlaps the Work contract', async () => {
    const fixture = await createFixture(true)
    const planningPath = fixture.store.paths.workDocument('goal-1', 'plan-initial')
    const planningSource = await Bun.file(fixture.store.paths.absolute(planningPath)).text()
    const planning = parseWorkDocument(planningSource)
    const inputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-current')
    planning.attributes.contractRevision = 2
    planning.attributes.contextRefs = [{ path: inputPath, purpose: 'Current accepted requirement' }]
    planning.body = 'Use the local Codex CLI.\n'

    const goalPath = fixture.store.paths.goalDocument('goal-1')
    const goalSource = await Bun.file(fixture.store.paths.absolute(goalPath)).text()
    const goal = parseGoalDocument(goalSource)
    goal.attributes.contractRevision = 2

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

    expect(occurrences(prompt, 'Use the local Codex CLI.')).toBe(2)
    expect(prompt).toContain('<accepted-input>')
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
              resolutionInput,
              summary: 'The old route was superseded.',
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

  test('exposes the previous application fact without turning it into Evidence', async () => {
    const fixture = await createFixture(true, true)
    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'plan-initial',
      runId: 'run-after-invalid',
      responsibility: 'planner',
      previousAttempt: {
        runId: 'run-invalid',
        responsibility: 'planner',
        result: 'success',
        application: 'invalid',
        summary: 'Application rejected: Work document is missing YAML front matter.',
      },
    })

    const prompt = await Bun.file(bundle.promptFile).text()
    expect(prompt).toContain('### Previous Application')
    expect(prompt).toContain('- Application: invalid')
    expect(prompt).toContain('Work document is missing YAML front matter.')
    expect(prompt).not.toContain('### Latest Owning Work Evidence')
  })

  test('states the Git, Attention, and Run-scoped runtime boundaries for Engineering passes', async () => {
    const fixture = await createFixture(true)
    const acceptedInputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-engineering')
    const unrelatedInputPath = fixture.store.paths.inputDocument('goal-1', 'H-1', 'EV-old')
    await fixture.store.publishGoal('goal-1', {
      supportingWrites: [
        {
          path: acceptedInputPath,
          expectedHash: null,
          content: renderInputDocument({
            attributes: {
              sourceHomeId: 'H-1',
              sourceEventId: 'EV-engineering',
              sourceDigest: 'b'.repeat(64),
              attachments: [],
            },
            body: 'Open the host application, mount the child, and connect the local backend.\n',
          }),
        },
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
    await publishEngineeringWork(
      fixture,
      'The implementation is verified.\n',
      [],
      [{ path: acceptedInputPath, purpose: 'Accepted implementation instruction' }],
    )
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
    expect(generatorPrompt).toContain('Preview goal:')
    expect(generatorPrompt).toContain('normal user entry running quickly')
    expect(generatorPrompt).toContain('mockable authentication')
    expect(generatorPrompt).toContain('visible useful data')
    expect(generatorPrompt).toContain('Prefer local data; fall back to DEV')
    expect(generatorPrompt).toContain('Read or create docs/hopi/preview/runbook.md')
    expect(generatorPrompt).toContain('Explore current source first, then relevant knowledge')
    expect(generatorPrompt).toContain(
      'one short question only if a necessary fact remains unavailable',
    )
    expect(generatorPrompt).toContain('shortest working launch path')
    expect(generatorPrompt).toContain('failed adapter topology')
    expect(generatorPrompt).toContain(
      'old runbook implementation restrictions are revisable history',
    )
    expect(generatorPrompt).toContain('Mock authentication and local sample data are valid')
    expect(generatorPrompt).toContain('Start and browser-check before broad builds or test suites')
    expect(generatorPrompt).toContain('page, data, and one basic interaction')
    expect(generatorPrompt).toContain('Check from fresh browser state')
    expect(generatorPrompt).toContain('required user/session state must come from Preview')
    expect(generatorPrompt).toContain('not manual test-browser seeding')
    expect(generatorPrompt).toContain(
      'stop product exploration and finish focused checks and cleanup',
    )
    expect(generatorPrompt).toContain('do not open or repair extra routes or features')
    expect(generatorPrompt).toContain('Keep edits small and coherent')
    expect(generatorPrompt).toContain('retry only that file')
    expect(generatorPrompt).toContain('never resend one large multi-file patch')
    expect(generatorPrompt).toContain('optional scripts/hopi/prepare')
    expect(generatorPrompt).toContain('foreground scripts/hopi/preview')
    expect(generatorPrompt).toContain(
      'HOPI_PREVIEW_SURFACES=<nonempty JSON array of {id,label,url}>',
    )
    expect(generatorPrompt).toContain('after the Preview is usable')
    expect(generatorPrompt).toContain('stays alive until Stop')
    expect(generatorPrompt).toContain('Entries are normal user routes, never docs/logs/health')
    expect(generatorPrompt).toContain('verify process/port/resource cleanup')
    expect(generatorPrompt).toContain('never await natural exit')
    expect(reviewerPrompt).toContain('browser-use every surface')
    expect(reviewerPrompt).toContain(
      'current Goal, intended-experience authority, and Engineering Work contract',
    )
    expect(reviewerPrompt).toContain('compare the runbook and surfaces with accepted authority')
    expect(reviewerPrompt).toContain('authentication works including by mock')
    expect(reviewerPrompt).toContain('useful data is visible')
    expect(reviewerPrompt).toContain('one basic interaction works')
    expect(reviewerPrompt).toContain('Prefer local data; DEV data is acceptable')
    expect(reviewerPrompt).toContain('Do not require production-equivalent infrastructure')
    expect(reviewerPrompt).toContain('live authentication, or every product capability')
    expect(reviewerPrompt).toContain('Start from fresh browser state')
    expect(reviewerPrompt).toContain('reject manual test-browser seeding')
    expect(reviewerPrompt).toContain('stop product exploration')
    expect(reviewerPrompt).toContain('do not inspect additional routes or features')
    expect(reviewerPrompt).toContain('HTTP/process/port evidence alone cannot pass')
    expect(reviewerPrompt).toContain('reject a blank, broken, or data-empty experience')
    expect(reviewerPrompt).toContain('Stop and verify process/port/resource cleanup')
    expect(reviewerPrompt).toContain('never await natural exit')
    expect(reviewerPrompt).toContain(
      'Reject if browser-based experience verification is unavailable',
    )
    expect(generatorPrompt).not.toContain('no mock or local-preview/test/demo/fixture substitutes')
    expect(reviewerPrompt).not.toContain('Reject mocks')
    expect(generatorPrompt).toContain('Run scratch: $HOPI_RUN_SCRATCH')
    expect(generatorPrompt).toContain('Task worktrees are disposable source projections')
    expect(generatorPrompt).toContain('$HOPI_CACHE_DIR persists across responsibility Attempts')
    expect(generatorPrompt).toContain(
      'A detached shell descendant is not an independent Work Attempt',
    )
    expect(generatorPrompt).toContain(
      'Non-Preview external effects require explicit Work or operator authority',
    )
    expect(generatorPrompt).toContain('### Engineering Work: Engineering Work')
    expect(generatorPrompt).toContain(
      `Source: $HOPI_AUTHORITY_ROOT/${fixture.store.paths.workDocument('goal-1', 'W-1')}`,
    )
    expect(generatorPrompt).toContain(
      `Goal source: $HOPI_AUTHORITY_ROOT/${fixture.store.paths.goalDocument('goal-1')}`,
    )
    expect(generatorPrompt).not.toContain('### Goal Contract')
    expect(generatorPrompt).not.toContain('Exercise role context staging.')
    expect(generatorPrompt).not.toContain(generator.goalHash)
    expect(generatorPrompt).not.toContain(generator.workHash)
    expect(generatorPrompt).toContain('### Latest Owning Work Evidence')
    expect(generatorPrompt).toContain('Repair this first.')
    expect(await Bun.file(generator.resultSchemaFile).json()).toMatchObject({
      properties: { result: { enum: ['success', 'fail'] } },
    })
    expect(await Bun.file(generator.contextFile).text()).toContain(
      fixture.store.paths.evidenceDocument('goal-1', 'E-latest'),
    )
    for (const prompt of [generatorPrompt, reviewerPrompt]) {
      expect(prompt).toContain('Proposal capabilities: $HOPI_PROPOSAL_CAPABILITIES_FILE')
      expect(prompt).toContain('Terminal result schema: $HOPI_RESULT_SCHEMA_FILE')
      expect(prompt).toContain('Run artifact output: $HOPI_ARTIFACT_DIR')
      expect(prompt).not.toContain('Retry only')
      expect(prompt).not.toContain('choose the available browser client')
      expect(prompt).not.toContain('Do not enter a vendor plan-approval mode')
      expect(prompt).toContain('ends on completion, failure, termination, or its selected timeout')
      expect(prompt.length).toBeLessThan(5_500)
    }
    const generatorCapabilities = await Bun.file(generator.proposalCapabilitiesFile).json()
    expect(generatorCapabilities).toMatchObject({
      writable: [
        {
          type: 'targeted-attention',
          pathPattern: expect.stringMatching(/\/attention\/\{id\}\.md$/),
          fields: { id: '{id}' },
          target: 'project:project-1/goal:goal-1/work:W-1',
        },
      ],
    })
    expect(generatorCapabilities.writable[0].guidance).toBeUndefined()
    expect(generatorPrompt).toContain('Implement Engineering Work')
    expect(reviewerPrompt).toContain(`git merge-base ${projectReleaseRef('project-1')} HEAD`)
    expect(reviewerPrompt).toContain('Source, Project docs, canonical .hopi state')
    expect((await stat(reviewer.runtimeScratchDir)).isDirectory()).toBe(true)
    expect(
      await Bun.file(
        join(generator.contextRoot, 'authority', ...unrelatedInputPath.split('/')),
      ).exists(),
    ).toBe(false)
    for (const bundle of [generator, reviewer]) {
      expect(
        await Bun.file(
          join(bundle.contextRoot, 'authority', ...acceptedInputPath.split('/')),
        ).text(),
      ).toContain('Open the host application, mount the child, and connect the local backend.')
    }
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

  test('binds Engineering Repo paths to their exact candidate heads instead of older release heads', async () => {
    const fixture = await createFixture(true)
    await publishEngineeringWork(fixture)
    const taskRoot = join(dirname(fixture.homeRoot), 'candidate-worktree')
    await git(fixture.projectRoot, [
      'worktree',
      'add',
      '-b',
      'hopi/test-candidate',
      taskRoot,
      'HEAD',
    ])
    await Bun.write(join(taskRoot, 'src', 'candidate.ts'), 'export const candidate = true\n')
    await git(taskRoot, ['add', '.'])
    await git(taskRoot, ['commit', '-m', 'candidate source'])
    const candidateHead = await gitText(taskRoot, ['rev-parse', 'HEAD'])

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-candidate-projection',
      responsibility: 'generator',
      repoRoots: [{ repoId: 'primary', path: taskRoot, primary: true }],
    })
    const manifest = await Bun.file(bundle.reposFile).json()
    const context = await Bun.file(bundle.contextFile).text()

    expect(bundle.repoProjection).toBe('candidate')
    expect(bundle.repoProjectionHeads).toEqual({ primary: candidateHead })
    expect(bundle.repoReleaseHeads.primary).not.toBe(candidateHead)
    expect(manifest).toMatchObject({
      projection: 'candidate',
      repos: { primary: taskRoot },
      releaseHeads: { primary: candidateHead },
    })
    expect(context).toContain(`Projection head: ${candidateHead}`)
    expect(context).toContain(`Base release head: ${bundle.repoReleaseHeads.primary}`)
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

  test('projects a retained directory artifact as a read-only subtree', async () => {
    const fixture = await createFixture(true)
    const artifactReference = 'artifact:R-review/snapshot-proof'
    const artifactPath = join(
      runStoragePath(fixture.homeRoot, 'R-review'),
      'artifacts',
      'snapshot-proof',
    )
    await mkdir(join(artifactPath, 'pages'), { recursive: true })
    await Bun.write(join(artifactPath, 'ledger.json'), '{"phase":"validated"}\n')
    await Bun.write(join(artifactPath, 'pages', 'trade-cal.json'), '{}\n')
    await publishEngineeringWork(
      fixture,
      '## Acceptance Criteria\n\n- The retained snapshot can be inspected.\n',
      [artifactReference],
    )

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-directory-evidence',
      responsibility: 'reviewer',
    })
    const projectedPath = join(bundle.contextRoot, 'evidence-artifacts', '001-snapshot-proof')

    expect(await Bun.file(join(projectedPath, 'ledger.json')).text()).toContain('validated')
    expect(await Bun.file(join(projectedPath, 'pages', 'trade-cal.json')).text()).toBe('{}\n')
    expect((await stat(join(projectedPath, 'ledger.json'))).mode & 0o222).toBe(0)
    expect(await Bun.file(bundle.artifactManifestFile ?? '').json()).toEqual({
      artifacts: [
        {
          reference: artifactReference,
          path: projectedPath,
          kind: 'directory',
          evidence: [fixture.store.paths.evidenceDocument('goal-1', 'E-latest')],
        },
      ],
    })
  })

  test('lets the Agent judge Evidence with unavailable artifact references', async () => {
    const fixture = await createFixture(true)
    const missingReference = 'artifact:R-mixed/missing-proof.txt'
    const availableReference = 'artifact:R-mixed/002-proof.txt'
    const availablePath = join(
      runStoragePath(fixture.homeRoot, 'R-mixed'),
      'artifacts',
      '002-proof.txt',
    )
    await mkdir(dirname(availablePath), { recursive: true })
    await Bun.write(availablePath, 'available proof\n')
    await publishEngineeringWork(
      fixture,
      '## Acceptance Criteria\n\n- Judge the available evidence.\n',
      [missingReference, availableReference],
    )

    const bundle = await createRoleContextStager(fixture.homeRoot, fixture.publisher).prepare({
      projectRoot: fixture.projectRoot,
      projectId: 'project-1',
      goalId: 'goal-1',
      workId: 'W-1',
      runId: 'run-mixed-evidence',
      responsibility: 'generator',
    })
    const projectedPath = join(bundle.contextRoot, 'evidence-artifacts', '001-002-proof.txt')
    const prompt = await Bun.file(bundle.promptFile).text()

    expect(await Bun.file(projectedPath).text()).toBe('available proof\n')
    expect(prompt).toContain(`- ${availableReference} -> ${projectedPath}`)
    expect(prompt).toContain('### Unavailable Referenced Material')
    expect(prompt).toContain(
      `${missingReference} (from ${fixture.store.paths.evidenceDocument('goal-1', 'E-latest')})`,
    )
    expect(prompt).toContain('Decide whether they matter for the current responsibility.')
    expect(await Bun.file(bundle.artifactManifestFile ?? '').json()).toEqual({
      artifacts: [
        {
          reference: availableReference,
          path: projectedPath,
          kind: 'file',
          evidence: [fixture.store.paths.evidenceDocument('goal-1', 'E-latest')],
        },
      ],
      unavailable: [
        {
          reference: missingReference,
          evidence: [fixture.store.paths.evidenceDocument('goal-1', 'E-latest')],
          reason: 'The retained Run artifact is unavailable on this machine.',
        },
      ],
    })
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
              contextRefs: [],
              ownerMessages: [],
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
              contextRefs: [],
              ownerMessages: [],
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
              contextRefs: [],
              ownerMessages: [],
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
      fixture.store.paths.evidenceDocument('goal-1', 'E-obsolete'),
    ]) {
      expect(await Bun.file(join(authorityRoot, ...path.split('/'))).exists()).toBe(true)
      expect(bundle.guardFiles[path]).toBeTruthy()
    }
    expect(bundle.artifactManifestFile).toBeDefined()
    const projectedArtifactPath = join(
      bundle.contextRoot,
      'evidence-artifacts',
      '001-001-proof.txt',
    )
    expect(await Bun.file(bundle.artifactManifestFile ?? '').json()).toEqual({
      artifacts: [
        {
          reference: artifactReference,
          path: projectedArtifactPath,
          kind: 'file',
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
    planning.attributes.contextRefs = [{ path: selectedPath, purpose: 'Match the compact layout' }]
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
      'Recreate the panel hierarchy.\n',
      [],
      [{ path: selectedPath, purpose: 'Match the compact layout' }],
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
  contextRefs: Array<{ path: string; purpose: string }> = [],
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
            contextRefs,
            ownerMessages: [],
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

async function gitText(cwd: string, args: string[]) {
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
  return stdout.trim()
}

function pngBytes(marker: number) {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
}

function occurrences(value: string, fragment: string) {
  return value.split(fragment).length - 1
}
