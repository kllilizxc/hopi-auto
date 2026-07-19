import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantStateReader } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import type { InboxContext } from '../src/domain/assistantWorkspaceDocuments'
import { goalAttentionReference } from '../src/domain/attentionReference'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { normalizeProjectCodingDefaults } from '../src/domain/projectCodingDefaults'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createPreviewManager } from '../src/runtime/previewManager'
import type { Responsibility } from '../src/runtime/roleContextStager'
import { type RunAttemptStore, createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { runStoragePath } from '../src/runtime/runPaths'
import { createWorkspaceAttentionController } from '../src/runtime/workspaceAttentionController'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-tools')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Assistant HOPI tools', () => {
  test('manages Project topology only from an explicit public turn', async () => {
    const fixture = await setup()
    const repoRoot = await createTestRepo(join(temporaryRoot, 'api'))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project',
      content: 'Add this repository to P-1 as api.',
    })

    const linked = await fixture.tools.executeForEvent('EV-project', 'hopi_manage_project', {
      operation: 'link_repo',
      projectId: 'P-1',
      repoId: 'api',
      repoPath: repoRoot,
    })
    expect(linked).toMatchObject({
      changed: true,
      value: {
        operation: 'link_repo',
        runtimeRefresh: 'after_current_turn',
        project: {
          projectId: 'P-1',
          repos: [
            { repoId: 'api', primary: false },
            { repoId: 'primary', primary: true },
          ],
        },
      },
    })
    expect(fixture.topologyChangedEventIds).toEqual(['EV-project'])
    expect((await fixture.home.readProject('P-1')).repos.map((repo) => repo.repoId)).toEqual([
      'primary',
      'api',
    ])

    const repeated = await fixture.tools.executeForEvent('EV-project', 'hopi_manage_project', {
      operation: 'link_repo',
      projectId: 'P-1',
      repoId: 'api',
      repoPath: repoRoot,
    })
    expect(repeated).toMatchObject({ changed: false, value: { runtimeRefresh: 'not_needed' } })
    expect(fixture.topologyChangedEventIds).toEqual(['EV-project'])

    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal-project',
      content: 'Change Project topology without operator intent.',
    })
    await expect(
      fixture.tools.executeForEvent('EV-internal-project', 'hopi_manage_project', {
        operation: 'rebind_project',
        projectId: 'P-1',
        repoPath: repoRoot,
      }),
    ).rejects.toThrow('only from a public user turn')
  })

  test('initializes an explicitly named empty repository through Project management', async () => {
    const fixture = await setup()
    const repoRoot = await mkdtemp(join(tmpdir(), 'hopi-assistant-init-'))
    try {
      await fixture.workspace.receiveEvent({
        eventId: 'EV-initialize',
        content: `Initialize ${repoRoot} as a Git repository.`,
      })
      expect(
        await fixture.tools.executeForEvent('EV-initialize', 'hopi_manage_project', {
          operation: 'initialize_repository',
          path: repoRoot,
        }),
      ).toMatchObject({
        changed: true,
        value: {
          operation: 'initialize_repository',
          selection: { repoPath: repoRoot, projectPath: '.' },
        },
      })
      expect(await git(repoRoot, ['branch', '--show-current'])).toBe('main')
      expect(
        await fixture.tools.executeForEvent('EV-initialize', 'hopi_manage_project', {
          operation: 'initialize_repository',
          path: repoRoot,
        }),
      ).toMatchObject({ changed: false })
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  test('supports whole-Project, single-Repo, and complete-set rebinding', async () => {
    const fixture = await setup()
    const apiRepo = await createTestRepo(join(temporaryRoot, 'rebind-api'))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-rebind',
      content: 'Move the linked repositories to these new paths.',
    })
    await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
      operation: 'link_repo',
      projectId: 'P-1',
      repoId: 'api',
      repoPath: apiRepo,
    })

    const movedPrimary = join(temporaryRoot, 'moved-primary')
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(fixture.repoRoot, movedPrimary)
    await rename(apiRepo, movedApi)
    expect(
      await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
        operation: 'rebind_repos',
        projectId: 'P-1',
        repos: [
          { repoId: 'primary', repoPath: movedPrimary },
          { repoId: 'api', repoPath: movedApi },
        ],
      }),
    ).toMatchObject({ changed: true })

    const finalPrimary = join(temporaryRoot, 'final-primary')
    await rename(movedPrimary, finalPrimary)
    const reboundPrimary = await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
      operation: 'rebind_project',
      projectId: 'P-1',
      repoPath: finalPrimary,
    })
    expect(reboundPrimary).toMatchObject({ changed: true })
    expect(
      (reboundPrimary.value as { project: { repos: unknown[] } }).project.repos,
    ).toContainEqual({
      repoId: 'primary',
      repoPath: finalPrimary,
      projectPath: '.',
      deliveryBranch: 'main',
      primary: true,
    })

    const finalApi = join(temporaryRoot, 'final-api')
    await rename(movedApi, finalApi)
    const reboundApi = await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
      operation: 'rebind_repo',
      projectId: 'P-1',
      repoId: 'api',
      repoPath: finalApi,
    })
    expect(reboundApi).toMatchObject({ changed: true })
    expect((reboundApi.value as { project: { repos: unknown[] } }).project.repos).toContainEqual({
      repoId: 'api',
      repoPath: finalApi,
      projectPath: '.',
      deliveryBranch: 'main',
      primary: false,
    })
    expect(fixture.topologyChangedEventIds).toEqual([
      'EV-rebind',
      'EV-rebind',
      'EV-rebind',
      'EV-rebind',
    ])
  })

  test('configures Assistant and Project models and exposes current settings in state', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-models',
      content: 'Use Claude for Assistant and a smaller Codex model for P-1.',
    })

    expect(
      await fixture.tools.executeForEvent('EV-models', 'hopi_configure_model', {
        scope: 'assistant',
        codingDefaults: { transport: 'claude', model: 'sonnet' },
      }),
    ).toMatchObject({
      changed: true,
      value: {
        scope: 'assistant',
        codingDefaults: { transport: 'claude', model: 'sonnet' },
        inherited: false,
      },
    })
    expect(
      await fixture.tools.executeForEvent('EV-models', 'hopi_configure_model', {
        scope: 'project',
        projectId: 'P-1',
        codingDefaults: { transport: 'codex', model: 'gpt-5.3-codex', reasoningEffort: 'high' },
      }),
    ).toMatchObject({
      changed: true,
      value: {
        scope: 'project',
        projectId: 'P-1',
        codingDefaults: {
          transport: 'codex',
          model: 'gpt-5.3-codex',
          reasoningEffort: 'high',
        },
        inherited: false,
      },
    })

    const state = await fixture.tools.executeForEvent('EV-models', 'hopi_read_state', {
      projectId: 'P-1',
    })
    expect(state.value).toMatchObject({
      assistantCodingDefaults: { transport: 'claude', model: 'sonnet' },
      assistantCodingDefaultsInherited: false,
      projects: [
        {
          projectId: 'P-1',
          primaryRepoId: 'primary',
          repos: [{ repoId: 'primary', primary: true }],
          codingDefaults: {
            transport: 'codex',
            model: 'gpt-5.3-codex',
            reasoningEffort: 'high',
          },
          codingDefaultsInherited: false,
        },
      ],
    })

    expect(
      await fixture.tools.executeForEvent('EV-models', 'hopi_configure_model', {
        scope: 'project',
        projectId: 'P-1',
        codingDefaults: null,
      }),
    ).toMatchObject({ changed: true, value: { inherited: true } })
    expect(
      await fixture.tools.executeForEvent('EV-models', 'hopi_configure_model', {
        scope: 'assistant',
        codingDefaults: null,
      }),
    ).toMatchObject({ changed: true, value: { inherited: true } })
  })

  test('lets only a public user turn replace durable preferences without Goal effects', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-preference',
      content: 'Across projects, keep your replies concise.',
    })
    const initial = (await fixture.workspace.readWorkspace()).preference

    const result = await fixture.tools.executeForEvent('EV-preference', 'hopi_write_preferences', {
      content: '# Preferences\n\n- Keep replies concise.\n',
      expectedDigest: initial.digest,
    })

    expect(result).toMatchObject({
      changed: true,
      value: { path: '.hopi/preference.md', digest: expect.any(String) },
    })
    expect((await fixture.workspace.readWorkspace()).preference.content).toContain(
      'Keep replies concise.',
    )
    expect(await fixture.goalStore.listGoalIds()).toEqual([])

    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal-preference',
      content: 'Invent a preference.',
    })
    await expect(
      fixture.tools.executeForEvent('EV-internal-preference', 'hopi_write_preferences', {
        content: '# Preferences\n\n- Invented internally.\n',
        expectedDigest: (await fixture.workspace.readWorkspace()).preference.digest,
      }),
    ).rejects.toThrow('only from a public user turn')
  })

  test('derives a readable Goal ID when the Assistant omits it', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-readable', content: '优化整体前端样式。' })

    const result = await fixture.tools.executeForEvent('EV-readable', 'hopi_create_goal', {
      projectId: 'P-1',
      title: '优化整体前端样式',
      objective: '统一并优化整个前端界面。',
    })

    expect(result).toMatchObject({
      changed: true,
      value: { projectId: 'P-1', goalId: 'G-优化整体前端样式' },
    })
    expect((await fixture.goalStore.readGoal('G-优化整体前端样式'))?.attributes.title).toBe(
      '优化整体前端样式',
    )
  })

  test('creates a Goal and preserves the source turn as Goal Input', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Create the launch Goal.' })

    const result = await fixture.tools.executeForEvent('EV-1', 'hopi_create_goal', {
      projectId: 'P-1',
      goalId: 'G-launch',
      title: 'Launch',
      objective: 'Ship the first release.',
    })

    const goalPackage = await fixture.goalStore.readPackage('G-launch')
    expect(result).toMatchObject({ changed: true, value: { goalId: 'G-launch' } })
    expect(goalPackage.goal.attributes.title).toBe('Launch')
    expect(goalPackage.inputs).toHaveLength(1)
    expect(goalPackage.inputs[0]?.body).toBe('Create the launch Goal.\n')
    expect(goalPackage.works.get('plan-initial')?.body).toContain('## Accepted Inputs')
    expect(goalPackage.works.get('plan-initial')?.body).toContain('/EV-1.md')
  })

  test('atomically adopts only selected Inbox images before initial Planning', async () => {
    const fixture = await setup()
    const event = await fixture.workspace.receiveEvent({
      eventId: 'EV-image',
      content: 'Recreate this board layout.',
      images: [
        new File([pngBytes(1)], 'board.png', { type: 'image/png' }),
        new File([pngBytes(2)], 'unrelated.png', { type: 'image/png' }),
      ],
    })
    const selectedRef = event.attributes.attachments[0] ?? ''
    const unselectedRef = event.attributes.attachments[1] ?? ''

    const result = await fixture.tools.executeForEvent('EV-image', 'hopi_create_goal', {
      projectId: 'P-1',
      goalId: 'G-image',
      title: 'Reference board',
      objective: 'Recreate the board layout.',
      references: [
        {
          attachmentRef: selectedRef,
          purpose: 'Match the information hierarchy, not the original branding.',
        },
      ],
    })

    const selected = await fixture.workspace.resolveAttachment(selectedRef)
    const unselected = await fixture.workspace.resolveAttachment(unselectedRef)
    const assetPath = fixture.goalStore.paths.asset(
      'G-image',
      selected?.contentHash ?? '',
      selected?.fileName ?? '',
    )
    const unselectedPath = fixture.goalStore.paths.asset(
      'G-image',
      unselected?.contentHash ?? '',
      unselected?.fileName ?? '',
    )
    const goalPackage = await fixture.goalStore.readPackage('G-image')
    const referencesPath = `${fixture.goalStore.paths.designRoot('G-image')}/references.md`

    expect(result.value).toMatchObject({ references: [{ path: assetPath }] })
    expect(await Bun.file(fixture.goalStore.paths.absolute(assetPath)).exists()).toBe(true)
    expect(await Bun.file(fixture.goalStore.paths.absolute(unselectedPath)).exists()).toBe(false)
    expect(await Bun.file(fixture.goalStore.paths.absolute(referencesPath)).text()).toContain(
      'Match the information hierarchy, not the original branding.',
    )
    expect(goalPackage.works.get('plan-initial')?.body).toContain(assetPath)
    expect(goalPackage.works.get('plan-initial')?.body).toContain(
      'Match the information hierarchy, not the original branding.',
    )
  })

  test('rejects non-portable Assistant-home attachment paths in Goal prose', async () => {
    const fixture = await setup()
    const event = await fixture.workspace.receiveEvent({
      eventId: 'EV-image-path',
      content: 'Use this screenshot.',
      images: [new File([pngBytes(9)], 'layout.png', { type: 'image/png' })],
    })
    const attachmentRef = event.attributes.attachments[0] ?? ''

    expect(
      fixture.tools.executeForEvent('EV-image-path', 'hopi_create_goal', {
        projectId: 'P-1',
        goalId: 'G-invalid-image-path',
        title: 'Reference layout',
        objective: `Recreate ${attachmentRef}.`,
        references: [
          {
            attachmentRef,
            purpose: 'Match the layout hierarchy.',
          },
        ],
      }),
    ).rejects.toThrow('cannot cite non-portable image path')
    expect(await fixture.goalStore.readGoal('G-invalid-image-path')).toBeNull()
  })

  test('rejects machine-local absolute image paths in Goal prose', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-local-image-path',
      content: 'Use the generated reference.',
    })

    expect(
      fixture.tools.executeForEvent('EV-local-image-path', 'hopi_create_goal', {
        projectId: 'P-1',
        goalId: 'G-local-image-path',
        title: 'Reference layout',
        objective: 'Recreate /home/user/.codex/generated_images/reference.png.',
      }),
    ).rejects.toThrow('/home/user/.codex/generated_images/reference.png')
    expect(await fixture.goalStore.readGoal('G-local-image-path')).toBeNull()
  })

  test('can adopt an image as design-only context and later reuse it for Planning', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    const event = await fixture.workspace.receiveEvent({
      eventId: 'EV-image',
      content: 'Keep this visual reference in the design, then implement it.',
      images: [new File([pngBytes(3)], 'layout.png', { type: 'image/png' })],
    })
    const references = [
      {
        attachmentRef: event.attributes.attachments[0] ?? '',
        purpose: 'Use the compact panel proportions.',
      },
    ]

    await fixture.tools.executeForEvent('EV-image', 'hopi_write_design', {
      projectId: 'P-1',
      goalId: 'G-1',
      references,
    })
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) => work.attributes.stage === 'plan',
      ),
    ).toHaveLength(0)

    await fixture.tools.executeForEvent('EV-image', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      references,
    })
    const planning = [...(await fixture.goalStore.readPackage('G-1')).works.values()].find(
      (work) => work.attributes.stage === 'plan',
    )
    expect(planning?.body).toContain('Use the compact panel proportions.')
    expect(planning?.body).toContain('/assets/')
  })

  test('reuses a durable image from an earlier public Inbox turn', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const source = await fixture.workspace.receiveEvent({
      eventId: 'EV-source',
      content: 'Here is the reference.',
      images: [new File([pngBytes(4)], 'earlier.png', { type: 'image/png' })],
    })
    await fixture.workspace.handleEvent('EV-source', {
      reply: 'Reference received.',
      disposition: 'answered',
    })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-use',
      content: 'Use the image from my earlier message in this Goal.',
    })

    await fixture.tools.executeForEvent('EV-use', 'hopi_write_design', {
      projectId: 'P-1',
      goalId: 'G-1',
      references: [
        {
          attachmentRef: source.attributes.attachments[0],
          purpose: 'Reuse the earlier visual hierarchy.',
        },
      ],
    })

    const referenceDocument = await Bun.file(
      fixture.goalStore.paths.absolute(
        `${fixture.goalStore.paths.designRoot('G-1')}/references.md`,
      ),
    ).text()
    expect(referenceDocument).toContain('Inbox `EV-source`')
    expect(referenceDocument).toContain('Reuse the earlier visual hierarchy.')
    expect((await fixture.goalStore.readPackage('G-1')).inputs[0]?.attributes.sourceEventId).toBe(
      'EV-use',
    )
  })

  test('keeps design writing separate from requesting implementation', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-1',
      content: 'Change the design and then implement it.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    await fixture.tools.executeForEvent('EV-1', 'hopi_write_design', {
      projectId: 'P-1',
      goalId: 'G-1',
      writes: [{ path: 'theme.md', content: '# Theme\n\nUse ink surfaces.' }],
    })

    let goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(
      await Bun.file(
        fixture.goalStore.paths.absolute(`${fixture.goalStore.paths.designRoot('G-1')}/theme.md`),
      ).text(),
    ).toContain('Use ink surfaces.')
    expect(goalPackage.inputs).toHaveLength(1)
    expect(
      [...goalPackage.works.values()].filter((work) => work.attributes.stage === 'plan'),
    ).toHaveLength(0)

    await fixture.tools.executeForEvent('EV-1', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })

    goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.inputs).toHaveLength(1)
    expect(
      [...goalPackage.works.values()].filter((work) => work.attributes.stage === 'plan'),
    ).toHaveLength(1)
    expect(
      [...goalPackage.works.values()].find((work) => work.attributes.stage === 'plan')?.body,
    ).toContain('/EV-1.md')

    await fixture.workspace.receiveEvent({
      eventId: 'EV-2',
      content: 'Also preserve the compact layout.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })
    await fixture.tools.executeForEvent('EV-2', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })
    goalPackage = await fixture.goalStore.readPackage('G-1')
    const openPlanning = [...goalPackage.works.values()].filter(
      (work) => work.attributes.stage === 'plan',
    )
    expect(openPlanning).toHaveLength(1)
    expect(openPlanning[0]?.body).toContain('/EV-1.md')
    expect(openPlanning[0]?.body).toContain('/EV-2.md')
  })

  test('interrupts every obsolete Goal Run only after a material contract revision', async () => {
    const fixture = await setup({ trackInterrupts: true })
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-plan',
      content: 'Reassess the existing contract.',
    })

    await fixture.tools.executeForEvent('EV-plan', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })
    expect(fixture.interruptedGoalIds).toEqual([])

    await fixture.workspace.receiveEvent({
      eventId: 'EV-revise',
      content: 'Add a new success criterion.',
    })
    await fixture.tools.executeForEvent('EV-revise', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: true,
    })

    expect((await fixture.goalStore.readGoal('G-1'))?.attributes.contractRevision).toBe(2)
    expect(fixture.interruptedGoalIds).toEqual(['G-1'])
  })

  test('recovers a terminal Goal planning conflict within the same Assistant turn', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await fixture.controller.cancelGoal('G-1')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-revise',
      content: 'Change the accepted outcome.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    await expect(
      fixture.tools.executeForEvent('EV-revise', 'hopi_request_planning', {
        projectId: 'P-1',
        goalId: 'G-1',
        materialContractChange: true,
      }),
    ).rejects.toThrow('Terminal Goal must be explicitly reopened')

    const current = await fixture.tools.executeForEvent('EV-revise', 'hopi_read_state', {
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect(current.value).toMatchObject({
      projects: [
        {
          goals: [
            {
              goal: { attributes: { id: 'G-1', lifecycle: 'cancelled' } },
            },
          ],
        },
      ],
    })

    await fixture.tools.executeForEvent('EV-revise', 'hopi_control_goal', {
      projectId: 'P-1',
      goalId: 'G-1',
      operation: 'reopen',
    })
    const planned = await fixture.tools.executeForEvent('EV-revise', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: true,
    })

    expect(planned.changed).toBe(true)
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.goal.attributes.lifecycle).toBe('active')
    expect(goalPackage.inputs).toHaveLength(1)
  })

  test('interrupts only the current Planner when same-revision input changes Planning authority', async () => {
    const fixture = await setup({ trackInterrupts: true })
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Plan the current delivery.' })
    await fixture.tools.executeForEvent('EV-1', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })
    const planning = [...(await fixture.goalStore.readPackage('G-1')).works.values()].find(
      (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
    )
    if (!planning) throw new Error('Expected an active Planning Work')
    expect(fixture.interruptedWorkTargets).toEqual([])

    await fixture.workspace.receiveEvent({
      eventId: 'EV-2',
      content: 'Include the compact layout in this plan.',
    })
    await fixture.tools.executeForEvent('EV-2', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })

    expect(fixture.interruptedGoalIds).toEqual([])
    expect(fixture.interruptedWorkTargets).toEqual([
      { goalId: 'G-1', workId: planning.attributes.id },
    ])

    await fixture.tools.executeForEvent('EV-2', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: false,
    })
    expect(fixture.interruptedWorkTargets).toHaveLength(1)
  })

  test('normalizes an exact canonical design path without creating a nested control root', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Update the design.' })
    const canonical = '.hopi/docs/goals/G-1/design/index.md'

    const result = await fixture.tools.executeForEvent('EV-1', 'hopi_write_design', {
      projectId: 'P-1',
      goalId: 'G-1',
      writes: [
        { path: canonical, content: '# Superseded' },
        { path: 'index.md', content: '# Current Design' },
      ],
    })

    expect(result.value).toMatchObject({ writes: ['index.md'] })
    expect(
      await Bun.file(
        fixture.goalStore.paths.absolute(fixture.goalStore.paths.designIndex('G-1')),
      ).text(),
    ).toBe('# Current Design\n')
    expect(
      await Bun.file(
        fixture.goalStore.paths.absolute(
          `${fixture.goalStore.paths.designRoot('G-1')}/${canonical}`,
        ),
      ).exists(),
    ).toBe(false)
  })

  test('applies Goal controls without direct Kanban transitions', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Pause it.' })

    await fixture.tools.executeForEvent('EV-1', 'hopi_control_goal', {
      projectId: 'P-1',
      goalId: 'G-1',
      operation: 'pause',
    })

    expect((await fixture.goalStore.readGoal('G-1'))?.attributes.lifecycle).toBe('paused')
    expect((await fixture.goalStore.readPackage('G-1')).inputs).toHaveLength(1)
  })

  test('atomically retries exhausted Work and resolves its exact Attention', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const path = fixture.goalStore.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(fixture.goalStore.paths.absolute(path)).text()
    const work = parseWorkDocument(source)
    work.attributes.attempts = 3
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(work),
      },
    })
    const attention = await fixture.controller.ensureAttemptsAttention('G-1', 'plan-initial')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-1',
      content: 'Retry this Work and clear the blocker.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionId: attention.attributes.id },
    })
    const resolution = {
      scope: 'goal' as const,
      projectId: 'P-1',
      goalId: 'G-1',
      attentionId: attention.attributes.id,
      resolution: 'The operator requested a retry.',
    }

    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_resolve_attention', resolution),
    ).rejects.toThrow('is still exhausted')
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.resolvedAt,
    ).toBeNull()

    const retried = await fixture.tools.executeForEvent('EV-1', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      operation: 'retry',
    })
    expect(retried.value).toMatchObject({
      remainingAttentionRefs: [],
    })
    expect(
      await fixture.tools.executeForEvent('EV-1', 'hopi_resolve_attention', resolution),
    ).toMatchObject({ changed: false, value: { remainingAttentionRefs: [] } })
    const resolvedPackage = await fixture.goalStore.readPackage('G-1')
    expect(resolvedPackage.works.get('plan-initial')?.attributes.attempts).toBe(0)
    expect(resolvedPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: expect.stringContaining('/EV-1.md'),
    })
    expect(resolvedPackage.inputs).toHaveLength(1)
    expect(resolvedPackage.inputs[0]?.body).toBe('Retry this Work and clear the blocker.\n')
  })

  test('settles operational Attention even when retry changes no Work fields', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureOperationalFailureAttention(
      'G-1',
      'plan-initial',
      3,
      'stream disconnected before completion',
    )
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-operational-retry',
      content: 'Connectivity recovered. Retry the same Work.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
      },
    })

    const retried = await fixture.tools.executeForEvent(
      'EV-operational-retry',
      'hopi_control_work',
      {
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'plan-initial',
        operation: 'retry',
      },
    )

    expect(retried.value).toMatchObject({ inputChanged: true, remainingAttentionRefs: [] })
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      attempts: 0,
      notBefore: null,
    })
    expect(goalPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: expect.stringContaining('/EV-operational-retry.md'),
    })
    expect(goalPackage.inputs.map((input) => input.body)).toEqual([
      'Connectivity recovered. Retry the same Work.\n',
    ])
  })

  test('settles exact Work Attention when cancellation makes the Work terminal', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await publishEngineeringWork(fixture.goalStore, 'G-1', 'W-cancel')
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'W-cancel',
      'generator',
      'The current direction cannot continue.',
    )
    await fixture.workspace.receiveEvent({
      eventId: 'EV-cancel-work',
      content: 'Cancel this Work and abandon that direction.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
      },
    })

    const cancelled = await fixture.tools.executeForEvent('EV-cancel-work', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-cancel',
      operation: 'cancel',
    })

    expect(cancelled.value).toMatchObject({ inputChanged: true, remainingAttentionRefs: [] })
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.works.get('W-cancel')?.attributes.stage).toBe('cancelled')
    expect(goalPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: expect.stringContaining('/EV-cancel-work.md'),
    })
  })

  test('surfaces a superseded Work Attention after material Planning until Assistant settles it', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const workPath = fixture.goalStore.paths.workDocument('G-1', 'plan-initial')
    const source = await Bun.file(fixture.goalStore.paths.absolute(workPath)).text()
    const work = parseWorkDocument(source)
    work.attributes.attempts = 3
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: workPath,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(work),
      },
    })
    const attention = await fixture.controller.ensureAttemptsAttention('G-1', 'plan-initial')
    const reference = goalAttentionReference('P-1', 'G-1', attention.attributes.id)
    await fixture.workspace.receiveEvent({
      eventId: 'EV-revise',
      content: 'The result is poor. Abandon that direction and try the model native task.',
      context: { projectId: 'P-1', goalId: 'G-other' },
    })

    const planned = await fixture.tools.executeForEvent('EV-revise', 'hopi_request_planning', {
      projectId: 'P-1',
      goalId: 'G-1',
      materialContractChange: true,
    })
    expect(planned.value).toMatchObject({ remainingAttentionRefs: [reference] })
    expect(
      (await fixture.goalStore.readPackage('G-1')).works.get('plan-initial')?.attributes,
    ).toMatchObject({ attempts: 0, contractRevision: 2 })

    const settled = await fixture.tools.executeForEvent('EV-revise', 'hopi_resolve_attention', {
      scope: 'goal',
      projectId: 'P-1',
      goalId: 'G-1',
      attentionId: attention.attributes.id,
      resolution: 'The accepted revision supersedes the exhausted direction.',
    })
    expect(settled).toMatchObject({
      changed: true,
      value: { remainingAttentionRefs: [] },
    })
  })

  test('resolves Project Attention optimistically and restores eligibility exactly once', async () => {
    const fixture = await setup()
    const attention = await createWorkspaceAttentionController(
      fixture.workspace,
    ).ensureProjectAttention('P-1', 'The managed integration root is invalid.')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project-repaired',
      content: 'I repaired the Project. Resume it.',
    })
    const resolution = {
      scope: 'workspace' as const,
      attentionId: attention.attributes.id,
      resolution: 'The Assistant inspected the repair and judged the Project ready to resume.',
    }

    const result = await fixture.tools.executeForEvent(
      'EV-project-repaired',
      'hopi_resolve_attention',
      resolution,
    )
    const repeated = await fixture.tools.executeForEvent(
      'EV-project-repaired',
      'hopi_resolve_attention',
      resolution,
    )
    const resolved = (await fixture.workspace.readWorkspace()).attentions.get(
      attention.attributes.id,
    )

    expect(result).toMatchObject({
      changed: true,
      value: { attentionId: attention.attributes.id, projectId: 'P-1' },
    })
    expect(repeated.changed).toBe(false)
    expect(resolved?.attributes.resolvedAt).not.toBeNull()
    expect(resolved?.body).toContain('## Resolution')
    expect(fixture.restoredProjectIds).toEqual(['P-1'])
  })

  test('requires a live per-turn capability for MCP calls', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Read state.' })
    const token = fixture.tools.issue('EV-1')

    expect(await fixture.tools.execute(token, 'hopi_read_state', {})).toMatchObject({
      changed: false,
    })
    fixture.tools.revoke(token)
    await expect(fixture.tools.execute(token, 'hopi_read_state', {})).rejects.toThrow(
      'invalid or expired',
    )
  })

  test('uses page context as the default read-state scope', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'First', objective: 'First.' })
    await fixture.goalStore.createGoal({ goalId: 'G-2', title: 'Second', objective: 'Second.' })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-1',
      content: 'What is happening here?',
      context: { projectId: 'P-1', goalId: 'G-2' },
    })

    const result = await fixture.tools.executeForEvent('EV-1', 'hopi_read_state', {})
    const goals = (
      result.value as {
        projects: Array<{ goals: Array<{ goal: { attributes: { id: string } } }> }>
      }
    ).projects[0]?.goals
    expect(goals?.map((goal) => goal.goal.attributes.id)).toEqual(['G-2'])

    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_read_state', {
        projectId: 'live-conversation',
      }),
    ).rejects.toThrow(
      'Current page context is P-1 / G-2; omit projectId and goalId to use it exactly',
    )
  })

  test('limits Reflection to one internal handoff and lets only main expose it', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attentionId = 'A-1'
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: fixture.goalStore.paths.attentionDocument('G-1', attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: 'project:P-1/goal:G-1',
            createdAt: '2026-07-11T00:00:00Z',
            resolvedAt: null,
            notifiedAt: null,
          },
          body: '## Needs you\n\nChoose a release window.\n',
        }),
      },
    })
    const prepared: {
      current: {
        brief: string
        context?: InboxContext
      } | null
    } = { current: null }
    const reflectionToken = fixture.tools.issueReflection('RF-1', (handoff) => {
      prepared.current = handoff
    })

    await expect(
      fixture.tools.execute(reflectionToken, 'hopi_control_goal', {
        projectId: 'P-1',
        goalId: 'G-1',
        operation: 'pause',
      }),
    ).rejects.toThrow('Reflection cannot call')
    const handoff = await fixture.tools.execute(reflectionToken, 'hopi_handoff_to_main', {
      brief: 'The latest Attempt needs a speaking-thread decision.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })
    expect(handoff.changed).toBe(false)
    expect(prepared.current).not.toBeNull()
    const event = await fixture.workspace.receiveReflectionEvent({
      content: prepared.current?.brief ?? '',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attentionId)],
      },
    })
    expect(event.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'internal',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-1'],
      },
    })
    await expect(
      fixture.tools.execute(reflectionToken, 'hopi_handoff_to_main', { brief: 'Again.' }),
    ).rejects.toThrow('already handed off')

    const mainToken = fixture.tools.issue(event.attributes.id)
    expect(
      await fixture.tools.execute(mainToken, 'hopi_request_user', {
        message: 'Choose a release window.',
      }),
    ).toMatchObject({
      changed: false,
      value: {
        requested: true,
        message: 'Choose a release window.',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-1'],
      },
    })
    expect(fixture.tools.notificationMessage(mainToken)).toBe('Choose a release window.')
    expect(fixture.tools.notificationIntent(mainToken)).toBe('request')
    expect((await fixture.workspace.readEvent(event.attributes.id))?.attributes).toMatchObject({
      visibility: 'internal',
      status: 'pending',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({ notifiedAt: null, resolvedAt: null })

    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Choose a release window.',
      disposition: 'operator-requested',
      expose: true,
    })
    expect(await fixture.tools.acknowledgeEventAttentions(event.attributes.id)).toEqual([
      'project:P-1/goal:G-1/attention:A-1',
    ])
    const requestedAttention = (await fixture.goalStore.readPackage('G-1')).attentions.get(
      attentionId,
    )
    const operatorRequest = requestedAttention?.attributes.operatorRequest
    expect(requestedAttention?.attributes).toMatchObject({
      notifiedAt: expect.any(String),
      resolvedAt: null,
    })
    expect(operatorRequest).toContain(`/event:${event.attributes.id}`)
    if (typeof operatorRequest !== 'string') throw new Error('Operator request was not recorded')

    await fixture.workspace.receiveEvent({
      eventId: 'EV-answer',
      content: 'Tomorrow.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attentionId)],
        replyTo: operatorRequest,
      },
    })
    expect(await fixture.tools.acceptUserAttentionReply('EV-answer')).toEqual([
      'project:P-1/goal:G-1/attention:A-1',
    ])
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({ operatorRequest: null, resolvedAt: null })
  })

  test('rejects notify_user for an ordinary public turn', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Hello.' })

    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_notify_user', { message: 'Hello.' }),
    ).rejects.toThrow('only for an internal Reflection turn')
    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_request_user', { message: 'Choose.' }),
    ).rejects.toThrow('only for an internal Reflection turn')
  })

  test('keeps informational delivery owned by Assistant', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attentionId = 'A-internal-repair'
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: fixture.goalStore.paths.attentionDocument('G-1', attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: 'project:P-1/goal:G-1',
            createdAt: '2026-07-11T00:00:00Z',
            resolvedAt: null,
            notifiedAt: null,
            operatorRequest: null,
          },
          body: 'Assistant must repair the internal invoker.\n',
        }),
      },
    })
    const reference = goalAttentionReference('P-1', 'G-1', attentionId)
    const event = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-info',
      content: 'Report internal repair progress.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    const token = fixture.tools.issue(event.attributes.id)
    await fixture.tools.execute(token, 'hopi_notify_user', {
      message: 'The internal repair is underway; no action is required.',
    })
    expect(fixture.tools.notificationIntent(token)).toBe('inform')
    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'The internal repair is underway; no action is required.',
      disposition: 'notified',
      expose: true,
    })
    expect(await fixture.tools.acknowledgeEventAttentions(event.attributes.id)).toEqual([reference])
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({
      notifiedAt: expect.any(String),
      operatorRequest: null,
      resolvedAt: null,
    })
  })

  test('reads current control state without inlining durable history', async () => {
    const active = new Map<string, Responsibility>()
    const fixture = await setup({ activeRuns: () => active })
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const runRoot = join(fixture.homeRoot, '.hopi', 'runtime', 'runs', 'R-live')
    const attempt = await fixture.attempts.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      runId: 'R-live',
      responsibility: 'planner',
      runRoot,
    })
    active.set('P-1/G-1/plan-initial', 'planner')
    await fixture.workspace.receiveEvent({ eventId: 'EV-read', content: 'Inspect current state.' })

    const current = (
      await fixture.tools.executeForEvent('EV-read', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
      })
    ).value as {
      currentTurn: {
        eventId: string
        source: string
        context: { projectId: string; goalId: string } | null
        attachments: string[]
        body: string
      }
      activeRuns: Array<{
        projectId: string
        goalId: string
        workId: string
        responsibility: string
        runId: string | null
      }>
      projects: Array<{
        goals: Array<{
          works: Array<{ path: string; body?: unknown }>
          design?: Array<{ path: string; content?: unknown }>
          evidence?: unknown
        }>
      }>
    }
    expect(current.activeRuns).toEqual([
      {
        projectId: 'P-1',
        goalId: 'G-1',
        workId: 'plan-initial',
        responsibility: 'planner',
        runId: 'R-live',
      },
    ])
    expect(current.currentTurn).toEqual({
      eventId: 'EV-read',
      source: 'user',
      context: null,
      attachments: [],
      body: 'Inspect current state.\n',
    })
    expect(current.projects[0]?.goals[0]?.works).toHaveLength(1)
    expect(current.projects[0]?.goals[0]?.works[0]?.path).toContain(
      '.hopi/docs/goals/G-1/work/plan-initial.md',
    )
    expect(current.projects[0]?.goals[0]?.works[0]).not.toHaveProperty('body')
    expect(current.projects[0]?.goals[0]?.design?.[0]).not.toHaveProperty('content')
    expect(current.projects[0]?.goals[0]).not.toHaveProperty('evidence')

    await attempt.interrupt(new Error('test interruption'))
    active.clear()
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    const after = (
      await fixture.tools.executeForEvent('EV-read', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
      })
    ).value as { activeRuns: unknown[]; projects: Array<{ goals: Array<{ works: unknown[] }> }> }
    expect(after.activeRuns).toEqual([])
    expect(after.projects[0]?.goals[0]?.works).toEqual([])
  })

  test('keeps referenced Evidence compact until exact artifacts are requested', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await publishEngineeringWork(fixture.goalStore, 'G-1', 'W-report')
    const runRoot = runStoragePath(fixture.homeRoot, 'R-report')
    const runReportPath = join(runRoot, 'artifacts', '001-report.md')
    const projectReportPath = join(
      fixture.goalStore.paths.projectRoot,
      'reports',
      'stage-report.md',
    )
    await mkdir(join(runRoot, 'artifacts'), { recursive: true })
    await mkdir(join(projectReportPath, '..'), { recursive: true })
    await Bun.write(runReportPath, '# Run report\n')
    await Bun.write(projectReportPath, '# Project report\n')

    const workPath = fixture.goalStore.paths.workDocument('G-1', 'W-report')
    const workSource = await Bun.file(fixture.goalStore.paths.absolute(workPath)).text()
    const work = parseWorkDocument(workSource)
    work.attributes.stage = 'review'
    work.attributes.evidenceRefs = ['E-report']
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [
        {
          path: fixture.goalStore.paths.evidenceDocument('G-1', 'E-report'),
          expectedHash: null,
          content: renderEvidenceDocument({
            attributes: {
              id: 'E-report',
              createdAt: '2026-07-18T00:00:00Z',
              producerRun: 'project:P-1/goal:G-1/work:W-report/run:R-report',
              coordinatorCheck: null,
              owner: 'project:P-1/goal:G-1/work:W-report',
              artifacts: ['artifact:R-report/001-report.md', 'reports/stage-report.md'],
            },
            body: '## Responsibility Result\n\n- Responsibility: generator\n- Result: success\n\n## Summary\n\nThe full report is attached.\n',
          }),
        },
      ],
      gateWrite: {
        path: workPath,
        expectedHash: await hashBytes(new TextEncoder().encode(workSource)),
        content: renderWorkDocument(work),
      },
    })
    await fixture.workspace.receiveEvent({ eventId: 'EV-report', content: 'Where is the report?' })

    const scoped = (
      await fixture.tools.executeForEvent('EV-report', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
      })
    ).value as {
      projects: Array<{
        goals: Array<{
          works: Array<{
            attributes: { id: string }
            evidence?: Array<{
              id: string
              producerRun: string
              artifactCount: number
              path: string
            }>
          }>
        }>
      }>
    }
    const compactEvidence = scoped.projects[0]?.goals[0]?.works.find(
      (candidate) => candidate.attributes.id === 'W-report',
    )?.evidence
    expect(compactEvidence).toEqual([
      {
        id: 'E-report',
        producerRun: 'project:P-1/goal:G-1/work:W-report/run:R-report',
        artifactCount: 2,
        path: fixture.goalStore.paths.absolute(
          fixture.goalStore.paths.evidenceDocument('G-1', 'E-report'),
        ),
      },
    ])
    expect(JSON.stringify(scoped)).not.toContain('The full report is attached.')
    expect(JSON.stringify(scoped)).not.toContain(runReportPath)

    const detailed = (
      await fixture.tools.executeForEvent('EV-report', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
        includeEvidence: true,
      })
    ).value as {
      projects: Array<{
        goals: Array<{
          works: Array<{
            attributes: { id: string }
            evidence?: Array<{
              body: string
              artifacts: Array<{
                reference: string
                available: boolean
                fileName?: string
                inspectionPath?: string
                operatorUrl?: string
              }>
            }>
          }>
        }>
      }>
    }
    const evidence = detailed.projects[0]?.goals[0]?.works.find(
      (candidate) => candidate.attributes.id === 'W-report',
    )?.evidence
    expect(evidence?.[0]?.body).toContain('The full report is attached.')
    expect(evidence?.[0]?.artifacts).toEqual([
      {
        reference: 'artifact:R-report/001-report.md',
        available: true,
        fileName: '001-report.md',
        inspectionPath: runReportPath,
        operatorUrl: '/api/projects/P-1/goals/G-1/evidence/E-report/artifacts/0',
      },
      {
        reference: 'reports/stage-report.md',
        available: true,
        fileName: 'stage-report.md',
        inspectionPath: projectReportPath,
        operatorUrl: '/api/projects/P-1/goals/G-1/evidence/E-report/artifacts/1',
      },
    ])

    const workspaceWide = (
      await fixture.tools.executeForEvent('EV-report', 'hopi_read_state', { projectId: 'P-1' })
    ).value as { projects: Array<{ goals: Array<{ works: Array<Record<string, unknown>> }> }> }
    expect(
      workspaceWide.projects[0]?.goals[0]?.works.every((candidate) => !('evidence' in candidate)),
    ).toBe(true)
  })

  test('reads bounded Attempt diagnostics and stable local log paths', async () => {
    const fixture = await setup({ trackAttemptReads: true })
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const runRoot = join(fixture.homeRoot, '.hopi', 'runtime', 'runs', 'R-1')
    await mkdir(runRoot, { recursive: true })
    const attempt = await fixture.attempts.start({
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      runId: 'R-1',
      responsibility: 'planner',
      runRoot,
    })
    await Bun.write(join(runRoot, 'context.md'), '# Context\n')
    await Bun.write(join(runRoot, 'prompt.md'), '# Prompt\n')
    await Bun.write(join(runRoot, 'result.json'), '{}\n')
    await Bun.write(join(runRoot, 'transcript.log'), 'stdout: full raw detail\n')
    await attempt.finish({
      outcome: { result: 'fail', summary: 'Planner failed.', exitCode: 1 },
      application: 'failed',
    })
    await fixture.workspace.receiveEvent({ eventId: 'EV-read', content: 'Inspect current state.' })

    const first = await fixture.tools.executeForEvent('EV-read', 'hopi_read_state', {
      projectId: 'P-1',
      goalId: 'G-1',
    })
    const snapshot = first.value as {
      stateDigest: string
      projects: Array<{
        goals: Array<{
          works: Array<{
            runtime: {
              latestAttempt: { runId: string; status: string } | null
              paths: { transcript?: string; events?: string }
            }
          }>
        }>
      }>
    }
    const runtime = snapshot.projects.at(0)?.goals.at(0)?.works.at(0)?.runtime
    if (!runtime) throw new Error('Expected Work runtime diagnostics')
    expect(snapshot.stateDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(runtime.latestAttempt).toMatchObject({ runId: 'R-1', status: 'finished' })
    expect(runtime.paths.transcript).toBe(join(runRoot, 'transcript.log'))
    expect(runtime.paths.events).toBe(join(runRoot, 'events.jsonl'))
    expect(fixture.attemptReads).toEqual({ snapshots: 1, lists: 0, eventReads: 0 })

    await Bun.write(join(runRoot, 'transcript.log'), 'stdout: changed raw diagnostics only\n')
    const second = await fixture.tools.executeForEvent('EV-read', 'hopi_read_state', {
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect((second.value as { stateDigest: string }).stateDigest).toBe(snapshot.stateDigest)
    expect(fixture.attemptReads).toEqual({ snapshots: 2, lists: 0, eventReads: 0 })
  })
})

async function setup(
  options: {
    activeRuns?: () => ReadonlyMap<string, Responsibility>
    trackInterrupts?: boolean
    trackAttemptReads?: boolean
  } = {},
) {
  const repoRoot = join(temporaryRoot, 'repo')
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  const goalStore = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
  const controller = createGoalController(goalStore, { verifyCompletion: () => false })
  const interruptedGoalIds: string[] = []
  const interruptedWorkTargets: Array<{ goalId: string; workId: string }> = []
  const restoredProjectIds: string[] = []
  const topologyChangedEventIds: string[] = []
  let assistantCodingDefaults = normalizeProjectCodingDefaults()
  let assistantCodingDefaultsInherited = true
  const readAssistantModelSettings = async () => ({
    codingDefaults: assistantCodingDefaults,
    inherited: assistantCodingDefaultsInherited,
  })
  const readProjectModelSettings = async (projectId: string) => {
    const project = await home.readProject(projectId)
    return {
      codingDefaults: project.codingDefaults ?? normalizeProjectCodingDefaults(),
      inherited: project.codingDefaults === undefined,
    }
  }
  const projects = new Map([
    [
      'P-1',
      {
        projectId: 'P-1',
        primaryRepoId: linked.primaryRepoId,
        repos: linked.repos,
        projectRoot: linked.integrationRoot,
        sourceRoot: linked.integrationRoot,
        store: goalStore,
        controller,
        ...(options.trackInterrupts
          ? {
              reconciler: {
                interruptRuns(goalId?: string, workId?: string) {
                  if (goalId && workId) interruptedWorkTargets.push({ goalId, workId })
                  else if (goalId) interruptedGoalIds.push(goalId)
                },
                operationallyDeferredWorkIds() {
                  return new Set<string>()
                },
              },
            }
          : {}),
      },
    ],
  ])
  const storedAttempts = createRunAttemptStore(homeRoot)
  const attemptReads = { snapshots: 0, lists: 0, eventReads: 0 }
  const attempts: RunAttemptStore = options.trackAttemptReads
    ? {
        ...storedAttempts,
        async snapshot() {
          attemptReads.snapshots += 1
          return storedAttempts.snapshot()
        },
        async list(...args: Parameters<RunAttemptStore['list']>) {
          attemptReads.lists += 1
          return storedAttempts.list(...args)
        },
        async readEvents(...args: Parameters<RunAttemptStore['readEvents']>) {
          attemptReads.eventReads += 1
          return storedAttempts.readEvents(...args)
        },
      }
    : storedAttempts
  const state = createAssistantStateReader({
    homeRoot,
    workspace,
    projects,
    publisher,
    attempts,
    activeRuns: options.activeRuns,
    readAssistantCodingDefaults: readAssistantModelSettings,
    readProjectCodingDefaults: readProjectModelSettings,
  })
  const tools = createAssistantTools({
    home,
    workspace,
    publisher,
    preview: createPreviewManager(homeRoot),
    projects,
    state,
    readAssistantCodingDefaults: readAssistantModelSettings,
    readProjectCodingDefaults: readProjectModelSettings,
    updateAssistantCodingDefaultsForTurn: async (_eventId, input) => {
      assistantCodingDefaults = normalizeProjectCodingDefaults(input ?? undefined)
      assistantCodingDefaultsInherited = input === null
    },
    onProjectTopologyChanged: (eventId) => topologyChangedEventIds.push(eventId),
    onProjectAttentionResolved: (projectId) => restoredProjectIds.push(projectId),
  })
  return {
    homeRoot,
    repoRoot,
    home,
    workspace,
    goalStore,
    controller,
    attempts,
    attemptReads,
    tools,
    interruptedGoalIds,
    interruptedWorkTargets,
    restoredProjectIds,
    topologyChangedEventIds,
  }
}

async function finishInitialPlanning(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
) {
  const path = store.paths.workDocument(goalId, 'plan-initial')
  const source = await Bun.file(store.paths.absolute(path)).text()
  const work = parseWorkDocument(source)
  work.attributes.stage = 'done'
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(work),
    },
  })
}

async function publishEngineeringWork(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  workId: string,
) {
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.workDocument(goalId, workId),
      expectedHash: null,
      content: renderWorkDocument({
        attributes: {
          id: workId,
          title: `Build ${workId}`,
          kind: 'engineering',
          stage: 'generate',
          notBefore: null,
          dependsOn: [],
          contractRevision: 1,
          evidenceRefs: [],
          attempts: 0,
        },
        body: `Implement ${workId}.\n`,
      }),
    },
  })
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
  return stdout.trim()
}

async function createTestRepo(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, ['init', '-b', 'main'])
  await git(path, ['config', 'user.email', 'hopi@example.test'])
  await git(path, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(path, 'README.md'), '# Repo\n')
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', 'initial'])
  return path
}

function pngBytes(marker = 0) {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
}
