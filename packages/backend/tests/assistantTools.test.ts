import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssistantStateReader } from '../src/assistant/assistantState'
import { AssistantToolRequestError } from '../src/assistant/assistantToolRequestError'
import { type AssistantTools, createAssistantTools } from '../src/assistant/assistantTools'
import type { InboxContext } from '../src/domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  workspaceAttentionReference,
} from '../src/domain/attentionReference'
import {
  isEngineeringWork,
  isPlanningWork,
  parseGoalDocument,
  parseWorkDocument,
  renderAttentionDocument,
  renderEvidenceDocument,
  renderGoalDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { inboxEventReference } from '../src/domain/inboxEventReference'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { clearGoalAttentionOperatorRequest } from '../src/runtime/attentionDelivery'
import { createGoalController } from '../src/runtime/goalController'
import { createPreviewManager } from '../src/runtime/previewManager'
import type { Responsibility } from '../src/runtime/roleContextStager'
import { type RunAttemptStore, createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { runStoragePath } from '../src/runtime/runPaths'
import { createStableWorktreeManager } from '../src/runtime/stableWorktreeManager'
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
      change: {
        kind: 'add_repo',
        projectId: 'P-1',
        repo: { repoId: 'api', repoPath: repoRoot },
      },
    })
    expect(linked).toMatchObject({
      changed: true,
      value: {
        effect: { kind: 'add_repo', projectId: 'P-1' },
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
      change: {
        kind: 'add_repo',
        projectId: 'P-1',
        repo: { repoId: 'api', repoPath: repoRoot },
      },
    })
    expect(repeated).toMatchObject({ changed: false, value: { runtimeRefresh: 'not_needed' } })
    expect(fixture.topologyChangedEventIds).toEqual(['EV-project'])

    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal-project',
      content: 'Change Project topology without operator intent.',
    })
    await expect(
      fixture.tools.executeForEvent('EV-internal-project', 'hopi_manage_project', {
        change: {
          kind: 'rebind_repos',
          projectId: 'P-1',
          repos: [{ repoId: 'primary', repoPath: repoRoot }],
        },
      }),
    ).rejects.toThrow('not available for this reflection turn')
  })

  test('initializes an explicitly named missing repository while adding it to a Project', async () => {
    const fixture = await setup()
    const parentRoot = await mkdtemp(join(tmpdir(), 'hopi-assistant-init-'))
    const repoRoot = join(parentRoot, 'missing-repo')
    try {
      await fixture.workspace.receiveEvent({
        eventId: 'EV-initialize',
        content: `Add ${repoRoot} to P-1 as generated.`,
      })
      const result = await fixture.tools.executeForEvent('EV-initialize', 'hopi_manage_project', {
        change: {
          kind: 'add_repo',
          projectId: 'P-1',
          repo: { repoId: 'generated', repoPath: repoRoot },
        },
      })
      expect(result).toMatchObject({
        changed: true,
        value: {
          effect: { kind: 'add_repo', projectId: 'P-1' },
        },
      })
      expect(
        (result.value as { project: { repos: Array<Record<string, unknown>> } }).project.repos,
      ).toContainEqual({
        repoId: 'generated',
        repoPath: await realpath(repoRoot),
        projectPath: '.',
        primary: false,
      })
      expect(await git(repoRoot, ['branch', '--show-current'])).toBe('main')
      expect(
        await fixture.tools.executeForEvent('EV-initialize', 'hopi_manage_project', {
          change: {
            kind: 'add_repo',
            projectId: 'P-1',
            repo: { repoId: 'generated', repoPath: repoRoot },
          },
        }),
      ).toMatchObject({ changed: false })
    } finally {
      await rm(parentRoot, { recursive: true, force: true })
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
      change: {
        kind: 'add_repo',
        projectId: 'P-1',
        repo: { repoId: 'api', repoPath: apiRepo },
      },
    })

    const movedPrimary = join(temporaryRoot, 'moved-primary')
    const movedApi = join(temporaryRoot, 'moved-api')
    await rename(fixture.repoRoot, movedPrimary)
    await rename(apiRepo, movedApi)
    expect(
      await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
        change: {
          kind: 'rebind_repos',
          projectId: 'P-1',
          repos: [
            { repoId: 'primary', repoPath: movedPrimary },
            { repoId: 'api', repoPath: movedApi },
          ],
        },
      }),
    ).toMatchObject({ changed: true })

    const finalPrimary = join(temporaryRoot, 'final-primary')
    await rename(movedPrimary, finalPrimary)
    const reboundPrimary = await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
      change: {
        kind: 'rebind_repos',
        projectId: 'P-1',
        repos: [{ repoId: 'primary', repoPath: finalPrimary }],
      },
    })
    expect(reboundPrimary).toMatchObject({ changed: true })
    expect(
      (reboundPrimary.value as { project: { repos: unknown[] } }).project.repos,
    ).toContainEqual({
      repoId: 'primary',
      repoPath: finalPrimary,
      projectPath: '.',
      primary: true,
    })

    const finalApi = join(temporaryRoot, 'final-api')
    await rename(movedApi, finalApi)
    const reboundApi = await fixture.tools.executeForEvent('EV-rebind', 'hopi_manage_project', {
      change: {
        kind: 'rebind_repos',
        projectId: 'P-1',
        repos: [{ repoId: 'api', repoPath: finalApi }],
      },
    })
    expect(reboundApi).toMatchObject({ changed: true })
    expect((reboundApi.value as { project: { repos: unknown[] } }).project.repos).toContainEqual({
      repoId: 'api',
      repoPath: finalApi,
      projectPath: '.',
      primary: false,
    })
    expect(fixture.topologyChangedEventIds).toEqual([
      'EV-rebind',
      'EV-rebind',
      'EV-rebind',
      'EV-rebind',
    ])
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
    ).rejects.toThrow('not available for this reflection turn')
  })

  test('derives a readable Goal ID when the Assistant omits it', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-readable', content: '优化整体前端样式。' })

    const result = await fixture.tools.executeForEvent('EV-readable', 'hopi_create_goal', {
      projectId: 'P-1',
      title: '优化整体前端样式',
      objective: '统一并优化整个前端界面。',
      firstWork: planningFirstWork('规划整体前端样式优化。'),
    })

    expect(result).toMatchObject({
      changed: true,
      value: {
        effect: { kind: 'goal_created', projectId: 'P-1', goalId: 'G-优化整体前端样式' },
      },
    })
    expect((await fixture.goalStore.readGoal('G-优化整体前端样式'))?.attributes.title).toBe(
      '优化整体前端样式',
    )
    expect(fixture.goalEffects).toEqual([
      { eventId: 'EV-readable', projectId: 'P-1', goalId: 'G-优化整体前端样式' },
    ])
  })

  test('creates a Goal and preserves the source turn as Goal Input', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Create the launch Goal.' })

    const result = await fixture.tools.executeForEvent('EV-1', 'hopi_create_goal', {
      projectId: 'P-1',
      goalId: 'G-launch',
      title: 'Launch',
      objective: 'Ship the first release.',
      firstWork: { kind: 'planning' },
    })

    const goalPackage = await fixture.goalStore.readPackage('G-launch')
    expect(result).toMatchObject({
      changed: true,
      value: { effect: { kind: 'goal_created', goalId: 'G-launch' } },
    })
    expect(goalPackage.goal.attributes.title).toBe('Launch')
    expect(goalPackage.inputs).toHaveLength(1)
    expect(goalPackage.inputs[0]?.body).toBe('Create the launch Goal.\n')
    expect(goalPackage.works.get('plan-initial')?.body).toContain('## Accepted Inputs')
    expect(goalPackage.works.get('plan-initial')?.body).toContain('/EV-1.md')
    expect(goalPackage.works.get('plan-initial')?.attributes.title).toBe(
      'Clarify and plan the Goal',
    )
    expect(goalPackage.works.get('plan-initial')?.body).toContain(
      'Clarify the current Goal contract and accepted Inputs',
    )
    expect(goalPackage.works.get('plan-initial')?.body).toContain(
      'The design documents and sparse Engineering Work DAG are current.',
    )
  })

  test('creates a Goal with one direct Engineering Work instead of initial Planning', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-direct-goal',
      content: 'Rename the reader entry and preserve every other label.',
    })

    const result = await fixture.tools.executeForEvent('EV-direct-goal', 'hopi_create_goal', {
      projectId: 'P-1',
      goalId: 'G-direct',
      title: 'Rename the reader entry',
      objective: 'Use the requested reader-facing title without changing other labels.',
      firstWork: {
        kind: 'engineering',
        title: 'Rename the reader entry',
        objective: 'Change the reader entry title and preserve every unrelated label.',
        acceptanceCriteria: [
          'The reader entry uses the requested title and unrelated labels remain unchanged.',
        ],
        repos: [fixture.primaryRepoId],
      },
    })

    const goalPackage = await fixture.goalStore.readPackage('G-direct')
    const works = [...goalPackage.works.values()]
    expect(result).toMatchObject({
      changed: true,
      value: {
        effect: {
          kind: 'goal_created',
          goalId: 'G-direct',
          workId: 'W-rename-the-reader-entry',
        },
      },
    })
    expect(works).toHaveLength(1)
    expect(works[0]?.attributes).toMatchObject({
      kind: 'engineering',
      stage: 'generate',
      repos: [fixture.primaryRepoId],
      assistantDispatch: expect.stringMatching(/^home:.+\/event:EV-direct-goal$/),
    })
    expect(works[0]?.body).toContain('## Accepted Inputs')
    expect(works[0]?.body).toContain('/EV-direct-goal.md')
    expect(goalPackage.inputs).toHaveLength(1)
  })

  test('replays an inferred direct Goal ID without deriving a suffixed Goal', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({
      eventId: 'EV-inferred-direct-goal',
      content: 'Rename the reader entry.',
    })
    const args = {
      projectId: 'P-1',
      title: 'Rename the reader entry',
      objective: 'Use the requested reader-facing title.',
      firstWork: {
        kind: 'engineering',
        title: 'Rename the reader entry',
        objective: 'Change the reader entry title.',
        acceptanceCriteria: ['The reader entry uses the requested title.'],
        repos: [fixture.primaryRepoId],
      },
    }

    const first = await fixture.tools.executeForEvent(
      'EV-inferred-direct-goal',
      'hopi_create_goal',
      args,
    )
    const repeated = await fixture.tools.executeForEvent(
      'EV-inferred-direct-goal',
      'hopi_create_goal',
      args,
    )

    expect(first).toMatchObject({
      changed: true,
      value: { effect: { kind: 'goal_created', goalId: 'G-rename-the-reader-entry' } },
    })
    expect(repeated).toMatchObject({
      changed: false,
      value: { effect: { kind: 'goal_created', goalId: 'G-rename-the-reader-entry' } },
    })
    expect(await fixture.goalStore.listGoalIds()).toEqual(['G-rename-the-reader-entry'])
  })

  test('directly admits one incremental Engineering Work into an existing Goal', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Guide', objective: 'Improve it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await publishEngineeringWork(fixture.goalStore, 'G-1', 'W-existing')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-increment',
      content: 'Add the career-stage option after the existing delivery.',
    })

    const result = await fixture.tools.executeForEvent('EV-increment', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: {
        kind: 'engineering',
        title: 'Add career-stage option',
        objective: 'Add the requested career-stage option using the current interaction pattern.',
        acceptanceCriteria: ['The option is available without changing existing choices.'],
        repos: [fixture.primaryRepoId],
        dependsOn: ['W-existing'],
      },
    })

    const goalPackage = await fixture.goalStore.readPackage('G-1')
    const created = goalPackage.works.get('W-add-career-stage-option')
    expect(result).toMatchObject({
      changed: true,
      value: {
        effect: {
          kind: 'engineering_created',
          goalId: 'G-1',
          workId: 'W-add-career-stage-option',
        },
      },
    })
    expect(created?.attributes).toMatchObject({
      kind: 'engineering',
      stage: 'generate',
      dependsOn: ['W-existing'],
      contractRevision: 1,
      assistantDispatch: expect.stringMatching(/^home:.+\/event:EV-increment$/),
    })
    expect(
      [...goalPackage.works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(0)
  })

  test('makes exact direct admission replay idempotent and rejects a second Work for the Input', async () => {
    const fixture = await setup()
    for (const goalId of ['G-1', 'G-2']) {
      await fixture.goalStore.createGoal({ goalId, title: goalId, objective: 'Improve it.' })
      await finishInitialPlanning(fixture.goalStore, goalId)
    }
    await fixture.workspace.receiveEvent({ eventId: 'EV-one-work', content: 'Ship one increment.' })
    const args = {
      projectId: 'P-1',
      goalId: 'G-1',
      work: {
        kind: 'engineering' as const,
        title: 'Ship one increment',
        objective: 'Implement the bounded increment.',
        acceptanceCriteria: ['The bounded increment works as requested.'],
        repos: [fixture.primaryRepoId],
      },
    }

    const first = await fixture.tools.executeForEvent('EV-one-work', 'hopi_create_work', args)
    const repeated = await fixture.tools.executeForEvent('EV-one-work', 'hopi_create_work', args)
    expect(first.changed).toBe(true)
    expect(repeated.changed).toBe(false)
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) =>
          isEngineeringWork(work.attributes) &&
          work.attributes.assistantDispatch?.endsWith('/event:EV-one-work'),
      ),
    ).toHaveLength(1)

    await expect(
      fixture.tools.executeForEvent('EV-one-work', 'hopi_create_work', {
        ...args,
        goalId: 'G-2',
        work: { ...args.work, title: 'Ship another increment' },
      }),
    ).rejects.toThrow('request Planning for additional Work')
  })

  test('serializes concurrent direct admissions and publishes only one Work', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Improve it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.workspace.receiveEvent({ eventId: 'EV-race', content: 'Apply one change.' })
    const baseWork = {
      kind: 'engineering' as const,
      objective: 'Apply the bounded change.',
      acceptanceCriteria: ['The bounded change is complete.'],
      repos: [fixture.primaryRepoId],
    }

    const outcomes = await Promise.allSettled([
      fixture.tools.executeForEvent('EV-race', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { ...baseWork, title: 'First direct change' },
      }),
      fixture.tools.executeForEvent('EV-race', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { ...baseWork, title: 'Second direct change' },
      }),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) =>
          isEngineeringWork(work.attributes) &&
          work.attributes.assistantDispatch?.endsWith('/event:EV-race'),
      ),
    ).toHaveLength(1)
  })

  test('rejects direct admission while Planning owns the Goal', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Improve it.' })
    await fixture.workspace.receiveEvent({ eventId: 'EV-guarded', content: 'Add one change.' })

    await expect(
      fixture.tools.executeForEvent('EV-guarded', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: {
          kind: 'engineering',
          title: 'Add one change',
          objective: 'Apply the bounded change.',
          acceptanceCriteria: ['The change works as requested.'],
          repos: [fixture.primaryRepoId],
        },
      }),
    ).rejects.toThrow('cannot bypass current Planning Work')
    expect((await fixture.goalStore.readPackage('G-1')).inputs).toHaveLength(0)
  })

  test('rejects direct admission for inactive Goals and unlinked Repos without partial writes', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Improve it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.controller.pauseGoal('G-1')
    await fixture.workspace.receiveEvent({ eventId: 'EV-paused', content: 'Add one change.' })
    const baseWork = {
      kind: 'engineering' as const,
      title: 'Add one change',
      objective: 'Apply the bounded change.',
      acceptanceCriteria: ['The change works as requested.'],
    }

    await expect(
      fixture.tools.executeForEvent('EV-paused', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { ...baseWork, repos: [fixture.primaryRepoId] },
      }),
    ).rejects.toThrow('requires an active Goal')
    expect((await fixture.goalStore.readPackage('G-1')).inputs).toHaveLength(0)

    await fixture.workspace.receiveEvent({ eventId: 'EV-repo', content: 'Use another Repo.' })
    await expect(
      fixture.tools.executeForEvent('EV-repo', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { ...baseWork, repos: ['missing-repo'] },
      }),
    ).rejects.toThrow('unlinked Repo missing-repo')
    expect((await fixture.goalStore.readPackage('G-1')).inputs).toHaveLength(0)
  })

  test('atomically supersedes an obsolete completion proposal when direct Work is admitted', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Improve it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    const attentionId = 'A-old-completion'
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: fixture.goalStore.paths.attentionDocument('G-1', attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: null,
            createdAt: '2026-07-19T00:00:00Z',
            resolvedAt: null,
            notifiedAt: null,
            operatorRequest: null,
          },
          body: '## Completion\n\nThe previous delivery appeared complete.\n',
        }),
      },
    })
    await fixture.workspace.receiveEvent({ eventId: 'EV-more', content: 'Add one more increment.' })

    await fixture.tools.executeForEvent('EV-more', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: {
        kind: 'engineering',
        title: 'Add one more increment',
        objective: 'Deliver the requested increment within the current Goal.',
        acceptanceCriteria: ['The new increment works as requested.'],
        repos: [fixture.primaryRepoId],
      },
    })

    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.attentions.get(attentionId)?.attributes.resolvedAt).not.toBeNull()
    expect(goalPackage.attentions.get(attentionId)?.body).toContain(
      'Superseded by a newly admitted Engineering Work.',
    )
    expect(goalPackage.works.has('W-add-one-more-increment')).toBe(true)
    expect(goalPackage.inputs).toHaveLength(1)
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
      firstWork: planningFirstWork('Plan how to recreate the selected board reference.'),
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
        firstWork: planningFirstWork('Plan how to recreate the selected layout reference.'),
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
        firstWork: planningFirstWork('Plan how to recreate the generated layout reference.'),
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
      changes: references.map((reference) => ({ kind: 'attachment' as const, ...reference })),
    })
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) => work.attributes.stage === 'plan',
      ),
    ).toHaveLength(0)

    await fixture.tools.executeForEvent('EV-image', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
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
      changes: [
        {
          kind: 'attachment',
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
      changes: [
        {
          kind: 'document',
          path: 'theme.md',
          content: '# Theme\n\nUse ink surfaces.',
        },
      ],
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

    await fixture.tools.executeForEvent('EV-1', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
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
    await fixture.tools.executeForEvent('EV-2', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
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

    await fixture.tools.executeForEvent('EV-plan', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
    })
    expect(fixture.interruptedGoalIds).toEqual([])

    await fixture.workspace.receiveEvent({
      eventId: 'EV-revise',
      content: 'Add a new success criterion.',
    })
    await fixture.tools.executeForEvent('EV-revise', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'new_contract_revision' },
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
      fixture.tools.executeForEvent('EV-revise', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { kind: 'planning', mode: 'new_contract_revision' },
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
      action: { kind: 'reopen' },
    })
    const reopenedPackage = await fixture.goalStore.readPackage('G-1')
    expect(reopenedPackage.goal.attributes).toMatchObject({
      lifecycle: 'active',
      contractRevision: 2,
    })
    expect(
      [...reopenedPackage.works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(1)
    await expect(
      fixture.tools.executeForEvent('EV-revise', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: {
          kind: 'engineering',
          title: 'Bypass reopened planning',
          objective: 'Attempt a direct delivery while Planning owns the Goal.',
          acceptanceCriteria: ['The delivery is complete.'],
          repos: [fixture.primaryRepoId],
        },
      }),
    ).rejects.toThrow('cannot bypass current Planning Work')
    const planned = await fixture.tools.executeForEvent('EV-revise', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'new_contract_revision' },
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
    await fixture.tools.executeForEvent('EV-1', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
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
    await fixture.tools.executeForEvent('EV-2', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
    })

    expect(fixture.interruptedGoalIds).toEqual([])
    expect(fixture.interruptedWorkTargets).toEqual([
      { goalId: 'G-1', workId: planning.attributes.id },
    ])

    await fixture.tools.executeForEvent('EV-2', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
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
      changes: [
        { kind: 'document', path: canonical, content: '# Superseded' },
        { kind: 'document', path: 'index.md', content: '# Current Design' },
      ],
    })

    expect(result.value).toMatchObject({ documents: ['index.md'] })
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
      action: { kind: 'pause' },
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
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
      },
    })
    const attentionRef = goalAttentionReference('P-1', 'G-1', attention.attributes.id)

    const retried = await fixture.tools.executeForEvent('EV-1', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      action: { kind: 'retry' },
    })
    expect(retried.value).toMatchObject({
      effect: { kind: 'work_retried', workId: 'plan-initial', stage: 'plan' },
      settledAttentionRefs: [attentionRef],
    })
    const resolvedPackage = await fixture.goalStore.readPackage('G-1')
    expect(resolvedPackage.works.get('plan-initial')?.attributes.attempts).toBe(0)
    expect(resolvedPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: null,
    })
    expect(resolvedPackage.inputs).toHaveLength(0)
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
        action: { kind: 'retry' },
      },
    )

    expect(retried.value).toMatchObject({
      effect: { kind: 'work_retried', workId: 'plan-initial', stage: 'plan' },
      settledAttentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
    })
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.works.get('plan-initial')?.attributes).toMatchObject({
      attempts: 0,
      notBefore: null,
    })
    expect(goalPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: null,
    })
    expect(goalPackage.inputs).toHaveLength(0)
  })

  test('does not route a retry turn into the controlled Goal as accepted Input', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({
      goalId: 'G-target',
      title: 'Target',
      objective: 'Ship it.',
    })
    await fixture.goalStore.createGoal({ goalId: 'G-page', title: 'Page', objective: 'Keep it.' })
    const attention = await fixture.controller.ensureOperationalFailureAttention(
      'G-target',
      'plan-initial',
      3,
      'provider recovered after a transient outage',
    )
    await fixture.workspace.receiveEvent({
      eventId: 'EV-unrelated-page',
      content: 'Continue the unrelated page task.',
      context: { projectId: 'P-1', goalId: 'G-page' },
    })

    await fixture.tools.executeForEvent('EV-unrelated-page', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-target',
      workId: 'plan-initial',
      action: { kind: 'retry' },
    })

    const target = await fixture.goalStore.readPackage('G-target')
    expect(target.inputs).toHaveLength(0)
    expect(target.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: null,
    })
    expect((await fixture.goalStore.readPackage('G-page')).inputs).toHaveLength(0)
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
      action: { kind: 'cancel' },
    })

    expect(cancelled.value).toMatchObject({
      effect: { kind: 'work_cancelled', stage: 'cancelled' },
      settledAttentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
    })
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.works.get('W-cancel')?.attributes.stage).toBe('cancelled')
    expect(goalPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: expect.stringContaining('/EV-cancel-work.md'),
    })
  })

  test('returns canonical nonterminal state after deferring Planning Work', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-defer-planning',
      content: 'Defer Planning until next year.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    const deferred = await fixture.tools.executeForEvent('EV-defer-planning', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      action: { kind: 'defer', notBefore: '2099-01-01T00:00:00.000Z' },
    })

    expect(deferred.value).toMatchObject({
      effect: {
        stage: 'plan',
        notBefore: '2099-01-01T00:00:00.000Z',
      },
      settledAttentionRefs: [],
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).works.get('plan-initial')?.attributes,
    ).toMatchObject({ stage: 'plan', notBefore: '2099-01-01T00:00:00.000Z' })
    expect((await fixture.goalStore.readPackage('G-1')).inputs).toHaveLength(0)
  })

  test('starting Planning preserves attached Attention', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'The current implementation lineage needs a new represented plan.',
    )
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-replan-attention',
      content: 'Create a distinct Engineering Work instead of retrying the old lineage.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attention.attributes.id)],
      },
    })

    const planned = await fixture.tools.executeForEvent('EV-replan-attention', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'new_contract_revision' },
    })

    expect(planned.value).toMatchObject({
      effect: { kind: 'planning_created', workId: 'plan-initial' },
    })
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(goalPackage.works.get('plan-initial')?.body).toContain('/EV-replan-attention.md')
    expect(goalPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: null,
      operatorRequest: null,
    })
  })

  test('rejects the removed implicit Planning Attention settlement option', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'The current implementation lineage needs a new represented plan.',
    )
    const reference = goalAttentionReference('P-1', 'G-1', attention.attributes.id)
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-preserve-attention',
      content: 'Record partial context but keep the current question open.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })

    await expect(
      fixture.tools.executeForEvent('EV-preserve-attention', 'hopi_create_work', {
        projectId: 'P-1',
        goalId: 'G-1',
        work: { kind: 'planning', mode: 'same_contract' },
        resolveAttention: false,
      }),
    ).rejects.toThrow('resolveAttention')
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.resolvedAt,
    ).toBeNull()
  })

  test('answers a blocked Planner with one represented material revision', async () => {
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

    const planned = await fixture.tools.executeForEvent('EV-revise', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'new_contract_revision' },
    })
    expect(planned.value).toMatchObject({
      effect: { kind: 'planning_created', mode: 'new_contract_revision' },
    })
    await fixture.tools.executeForEvent('EV-revise', 'hopi_resolve_attention', {
      attentionRef: reference,
      resolution: 'The accepted material revision is now represented by Planning.',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).works.get('plan-initial')?.attributes,
    ).toMatchObject({ attempts: 0, contractRevision: 2 })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.resolvedAt,
    ).not.toBeNull()
  })

  test('records Project Attention resolution and requests reconciliation exactly once', async () => {
    const fixture = await setup()
    const attention = await createWorkspaceAttentionController(
      fixture.workspace,
    ).ensureProjectAttention('P-1', 'The managed integration root is invalid.')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project-repaired',
      content: 'I repaired the Project. Resume it.',
    })
    const homeId = (await fixture.workspace.readWorkspace()).homeId
    const resolution = {
      attentionRef: workspaceAttentionReference(homeId, attention.attributes.id),
      resolution: 'The managed integration root was repaired and verified.',
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
      value: { attentionRef: resolution.attentionRef },
    })
    expect(repeated.changed).toBe(false)
    expect(resolved?.attributes.resolvedAt).not.toBeNull()
    expect(resolved?.body).toContain('## Resolution')
    expect(fixture.restoredProjectIds).toEqual(['P-1'])
    expect(fixture.projectDispatchEffects).toEqual([
      { eventId: 'EV-project-repaired', projectId: 'P-1' },
    ])
  })

  test('accepts an exact queued Reply after a newer notification replaces operatorRequest', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'Choose the recovery.',
    )
    const reference = goalAttentionReference('P-1', 'G-1', attention.attributes.id)
    const first = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-request-first',
      content: 'Ask for recovery.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    await fixture.workspace.handleEvent(first.attributes.id, {
      reply: 'Retry, revise, or cancel?',
      disposition: 'operator-requested',
      expose: true,
    })
    await fixture.tools.acknowledgeEventAttentions(first.attributes.id)
    const firstRequest = inboxEventReference(
      (await fixture.workspace.readWorkspace()).homeId,
      first.attributes.id,
    )
    await fixture.workspace.receiveEvent({
      eventId: 'EV-queued-answer',
      content: 'Retry.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [reference],
        replyTo: firstRequest,
      },
    })
    await clearGoalAttentionOperatorRequest(
      fixture.goalStore,
      'G-1',
      attention.attributes.id,
      firstRequest,
    )

    const second = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-request-second',
      content: 'Revalidate recovery.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    await fixture.workspace.handleEvent(second.attributes.id, {
      reply: 'Retry, revise, or cancel after revalidation?',
      disposition: 'operator-requested',
      expose: true,
    })
    await fixture.tools.acknowledgeEventAttentions(second.attributes.id)
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.operatorRequest,
    ).toContain(`/event:${second.attributes.id}`)

    expect(await fixture.tools.acceptUserAttentionReply('EV-queued-answer')).toEqual([reference])
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.operatorRequest,
    ).toBeNull()
  })

  test('allows Planning and verified Attention resolution in one Assistant turn', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'Choose recovery.',
    )
    await fixture.workspace.receiveEvent({
      eventId: 'EV-no-double-planning',
      content: 'Reconsider the blocker.',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })
    const token = fixture.tools.issue('EV-no-double-planning')
    await fixture.tools.execute(token, 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
    })

    await fixture.tools.execute(token, 'hopi_resolve_attention', {
      attentionRef: goalAttentionReference('P-1', 'G-1', attention.attributes.id),
      resolution: 'The new Planning run now represents the blocker.',
    })
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(1)
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes.resolvedAt,
    ).not.toBeNull()
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
        projectId: 'H-home',
      }),
    ).rejects.toBeInstanceOf(AssistantToolRequestError)
    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_read_state', {
        projectId: 'H-home',
      }),
    ).rejects.toThrow(
      'Current page context is P-1 / G-2; omit projectId and goalId to use it exactly',
    )
  })

  test('keeps selected checkout state outside the Project state contract', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-state', content: 'Read state.' })

    const current = await fixture.tools.executeForEvent('EV-state', 'hopi_read_state', {
      projectId: 'P-1',
    })
    expect(current.value).toMatchObject({
      projects: [{ available: true, repos: [{ repoId: 'primary' }] }],
    })
    expect(JSON.stringify(current.value)).not.toContain('delivery')

    await git(fixture.repoRoot, ['switch', '-c', 'local-experiment'])
    const pending = await fixture.tools.executeForEvent('EV-state', 'hopi_read_state', {
      projectId: 'P-1',
    })
    expect(pending.value).toMatchObject({
      projects: [{ available: true, repos: [{ repoId: 'primary' }] }],
    })
    expect(JSON.stringify(pending.value)).not.toContain('delivery')
  })

  test('exposes the current C1 source preflight for a nonterminal Engineering Work', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await publishEngineeringWork(fixture.goalStore, 'G-1', 'W-1')
    const task = await createStableWorktreeManager(fixture.homeRoot).prepare({
      projectRoot: fixture.goalStore.paths.projectRoot,
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'W-1',
      repoId: fixture.primaryRepoId,
      primaryRepoId: fixture.primaryRepoId,
    })
    await rm(join(task.path, 'README.md'))
    await git(task.path, ['add', '.'])
    await git(task.path, ['commit', '-m', 'delete source file'])
    await fixture.workspace.receiveEvent({
      eventId: 'EV-candidate',
      content: 'Inspect the current candidate.',
    })

    const state = await fixture.tools.executeForEvent('EV-candidate', 'hopi_read_state', {
      projectId: 'P-1',
    })
    expect(state.value).toMatchObject({
      projects: [
        {
          goals: [
            {
              works: [
                {
                  attributes: { id: 'W-1' },
                  currentCandidateIntegration: [
                    {
                      repoId: fixture.primaryRepoId,
                      kind: 'observed',
                      result: { kind: 'ready' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
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
        action: { kind: 'pause' },
      }),
    ).rejects.toThrow('Reflection cannot call')
    await expect(
      fixture.tools.execute(reflectionToken, 'hopi_handoff_to_main', {
        brief: 'The latest Attempt needs a speaking-thread decision.',
        context: { attentionRefs: [goalAttentionReference('P-1', 'G-1', attentionId)] },
      }),
    ).rejects.toThrow('exact projectId and goalId')
    const handoff = await fixture.tools.execute(reflectionToken, 'hopi_handoff_to_main', {
      brief: 'The latest Attempt needs a speaking-thread decision.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [goalAttentionReference('P-1', 'G-1', attentionId)],
      },
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
    await expect(
      fixture.tools.execute(mainToken, 'hopi_request_user', {
        attentionRefs: ['project:P-1/goal:G-1/attention:A-other'],
      }),
    ).rejects.toThrow('exactly the Attention references selected')
    expect(
      await fixture.tools.execute(mainToken, 'hopi_request_user', {
        attentionRefs: ['project:P-1/goal:G-1/attention:A-1'],
      }),
    ).toMatchObject({
      changed: false,
      value: {
        staged: true,
        attentionRefs: ['project:P-1/goal:G-1/attention:A-1'],
      },
    })
    expect(
      await fixture.tools.finalizeInternalResponse(
        mainToken,
        event.attributes.id,
        'Choose a release window after reviewing the deployment risk.',
      ),
    ).toBe('request')
    expect((await fixture.workspace.readEvent(event.attributes.id))?.attributes).toMatchObject({
      visibility: 'internal',
      status: 'pending',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({ notifiedAt: null, resolvedAt: null })

    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Choose a release window after reviewing the deployment risk.',
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

    await fixture.tools.executeForEvent('EV-answer', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      work: { kind: 'planning', mode: 'same_contract' },
    })
    expect(
      [...(await fixture.goalStore.readPackage('G-1')).works.values()].filter(
        (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
      ),
    ).toHaveLength(1)

    const answered = await fixture.tools.executeForEvent('EV-answer', 'hopi_resolve_attention', {
      attentionRef: goalAttentionReference('P-1', 'G-1', attentionId),
      resolution: 'The operator supplied the requested release window.',
    })
    expect(answered.value).toMatchObject({
      attentionRef: goalAttentionReference('P-1', 'G-1', attentionId),
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes
        .resolvedAt,
    ).not.toBeNull()
  })

  test('rejects request_user for an ordinary public turn', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Hello.' })

    await expect(
      fixture.tools.executeForEvent('EV-1', 'hopi_request_user', {
        attentionRefs: ['home:H-1/attention:A-1'],
      }),
    ).rejects.toThrow('not available for this user turn')
  })

  test('allows a completion handoff but never treats completion as an operator request', async () => {
    const fixture = await setup()
    const completion = await publishCompletedGoalArtifact(fixture)
    const reference = goalAttentionReference('P-1', 'G-1', completion.attentionId)
    const prepared: { current: { brief: string; context?: InboxContext } | null } = {
      current: null,
    }
    const reflectionToken = fixture.tools.issueReflection('RF-completion', (handoff) => {
      prepared.current = handoff
    })

    await expect(
      fixture.tools.execute(reflectionToken, 'hopi_handoff_to_main', {
        brief: 'The completed Goal needs one operator-facing summary.',
        context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
      }),
    ).resolves.toMatchObject({ changed: false })
    const event = await fixture.workspace.receiveReflectionEvent({
      content: prepared.current?.brief ?? '',
      context: prepared.current?.context,
    })
    const mainToken = fixture.tools.issue(event.attributes.id)

    await expect(
      fixture.tools.execute(mainToken, 'hopi_request_user', { attentionRefs: [reference] }),
    ).rejects.toThrow('Completion Attention cannot request operator input')
  })

  test('rejects an empty or stale request_user final response', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'Choose the recovery direction.',
    )
    const reference = goalAttentionReference('P-1', 'G-1', attention.attributes.id)
    const event = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-request-validation',
      content: 'Ask for the missing decision.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    const token = fixture.tools.issue(event.attributes.id)
    await fixture.tools.execute(token, 'hopi_request_user', { attentionRefs: [reference] })

    await expect(
      fixture.tools.finalizeInternalResponse(token, event.attributes.id, ''),
    ).rejects.toThrow('requires a non-empty final response')

    await fixture.tools.execute(token, 'hopi_resolve_attention', {
      attentionRef: reference,
      resolution: 'The same turn verified that no operator decision is needed.',
    })
    await expect(
      fixture.tools.finalizeInternalResponse(
        token,
        event.attributes.id,
        'Choose the recovery direction.',
      ),
    ).rejects.toThrow('already resolved')
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
    expect(
      await fixture.tools.finalizeInternalResponse(
        token,
        event.attributes.id,
        'The internal repair is underway; no action is required.',
      ),
    ).toBe('inform')
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

  test('requires an available artifact link in every completed Goal notification', async () => {
    const fixture = await setup()
    const completion = await publishCompletedGoalArtifact(fixture)
    const reference = goalAttentionReference('P-1', 'G-1', completion.attentionId)
    const event = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-completed-artifact',
      content: 'The Goal completed successfully.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    const token = fixture.tools.issue(event.attributes.id)

    await expect(
      fixture.tools.finalizeInternalResponse(token, event.attributes.id, 'The Goal is complete.'),
    ).rejects.toThrow('Include at least one relevant operatorUrl')

    const state = await fixture.tools.execute(token, 'hopi_read_state', {
      projectId: 'P-1',
      goalId: 'G-1',
      includeEvidence: true,
    })
    expect(JSON.stringify(state.value)).toContain(completion.operatorUrl)
    expect(
      await fixture.tools.finalizeInternalResponse(
        token,
        event.attributes.id,
        `The Goal is complete. [Open the deliverable](${completion.operatorUrl})`,
      ),
    ).toBe('inform')
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
    expect(current).not.toHaveProperty('assistantCodingDefaults')
    expect(current).not.toHaveProperty('assistantCodingDefaultsInherited')
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
    ).value as {
      activeRuns: unknown[]
      projects: Array<{
        goals: Array<{
          works: unknown[]
          latestPlanningOutcome: {
            attributes: { id: string; stage: string }
            runtime: { latestAttempt: { status: string } | null }
          } | null
        }>
      }>
    }
    expect(after.activeRuns).toEqual([])
    expect(after.projects[0]?.goals[0]?.works).toEqual([])
    expect(after.projects[0]?.goals[0]?.latestPlanningOutcome).toMatchObject({
      attributes: { id: 'plan-initial', stage: 'done' },
      runtime: { latestAttempt: { status: 'interrupted' } },
    })
  })

  test('projects complete canonical references for every open Attention', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const goalAttention = await fixture.controller.ensureResponsibilityFailureAttention(
      'G-1',
      'plan-initial',
      'planner',
      'Choose recovery.',
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-blocked', content: 'Blocked event.' })
    const workspaceAttention = await createWorkspaceAttentionController(
      fixture.workspace,
    ).ensureEventAttention('EV-blocked', `Inspect the failed event. ${'x'.repeat(2_000)}`)
    await fixture.workspace.receiveEvent({ eventId: 'EV-read-refs', content: 'Inspect Attention.' })

    const homeState = (await fixture.tools.executeForEvent('EV-read-refs', 'hopi_read_state', {}))
      .value as {
      workspaceAttentions: Array<{ id: string; reference: string; creationRationale: string }>
      projects: Array<{
        goals: Array<{
          goal: { attributes: { id: string }; body?: string }
          attentions: Array<{
            reference: string
            attributes: { id: string }
            creationRationale: string
          }>
        }>
      }>
    }
    const goalState = (
      await fixture.tools.executeForEvent('EV-read-refs', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
      })
    ).value as {
      workspaceAttentions: Array<{ id: string; reference: string }>
      projects: Array<{
        goals: Array<{
          goal: { attributes: { id: string }; body: string }
          attentions: Array<{
            reference: string
            attributes: { id: string }
            creationRationale: string
          }>
        }>
      }>
    }
    const homeId = (await fixture.workspace.readWorkspace()).homeId

    expect(homeState.workspaceAttentions).toContainEqual(
      expect.objectContaining({
        id: workspaceAttention.attributes.id,
        reference: workspaceAttentionReference(homeId, workspaceAttention.attributes.id),
      }),
    )
    expect(homeState.workspaceAttentions[0]?.creationRationale.length).toBeLessThanOrEqual(323)
    expect(homeState.projects[0]?.goals[0]?.goal).not.toHaveProperty('body')
    expect(homeState.projects[0]?.goals[0]?.attentions).toContainEqual(
      expect.objectContaining({
        reference: goalAttentionReference('P-1', 'G-1', goalAttention.attributes.id),
        attributes: expect.objectContaining({ id: goalAttention.attributes.id }),
        creationRationale: expect.stringContaining('Choose recovery.'),
      }),
    )
    expect(goalState.workspaceAttentions).toEqual([])
    expect(goalState.projects[0]?.goals[0]?.goal.body).toContain('Ship it.')
    expect(goalState.projects[0]?.goals[0]?.attentions).toContainEqual(
      expect.objectContaining({
        reference: goalAttentionReference('P-1', 'G-1', goalAttention.attributes.id),
        attributes: expect.objectContaining({ id: goalAttention.attributes.id }),
        creationRationale: expect.stringContaining('Choose recovery.'),
      }),
    )
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
            evidence?: {
              count: number
              latest: {
                id: string
                producerRun: string
                artifactCount: number
                path: string
              } | null
            }
          }>
        }>
      }>
    }
    const compactEvidence = scoped.projects[0]?.goals[0]?.works.find(
      (candidate) => candidate.attributes.id === 'W-report',
    )?.evidence
    expect(compactEvidence).toEqual({
      count: 1,
      latest: {
        id: 'E-report',
        producerRun: 'project:P-1/goal:G-1/work:W-report/run:R-report',
        artifactCount: 2,
        path: fixture.goalStore.paths.absolute(
          fixture.goalStore.paths.evidenceDocument('G-1', 'E-report'),
        ),
      },
    })
    expect(JSON.stringify(scoped)).not.toContain('The full report is attached.')
    expect(JSON.stringify(scoped)).not.toContain(runReportPath)
    expect(
      scoped.projects[0]?.goals[0]?.works.find(
        (candidate) => candidate.attributes.id === 'W-report',
      )?.attributes,
    ).not.toHaveProperty('evidenceRefs')

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

  test('returns only the latest finished Planning outcome as compact continuation context', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    const next = await fixture.controller.ensurePlanning('G-1', 'Reassess the current blocker.')
    const path = fixture.goalStore.paths.workDocument('G-1', next.attributes.id)
    const source = await Bun.file(fixture.goalStore.paths.absolute(path)).text()
    const completed = parseWorkDocument(source)
    completed.attributes.stage = 'done'
    await fixture.goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path,
        expectedHash: await hashBytes(new TextEncoder().encode(source)),
        content: renderWorkDocument(completed),
      },
    })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-latest-planning',
      content: 'What did Planning conclude?',
    })

    const state = (
      await fixture.tools.executeForEvent('EV-latest-planning', 'hopi_read_state', {
        projectId: 'P-1',
        goalId: 'G-1',
      })
    ).value as {
      projects: Array<{
        goals: Array<{
          works: unknown[]
          latestPlanningOutcome: { attributes: { id: string; stage: string } } | null
        }>
      }>
    }
    expect(state.projects[0]?.goals[0]?.works).toEqual([])
    expect(state.projects[0]?.goals[0]?.latestPlanningOutcome).toMatchObject({
      attributes: { id: next.attributes.id, stage: 'done' },
    })
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
  const goalEffects: Array<{ eventId: string; projectId: string; goalId: string }> = []
  const projectDispatchEffects: Array<{ eventId: string; projectId: string }> = []
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
  })
  const rawTools = createAssistantTools({
    home,
    workspace,
    publisher,
    preview: createPreviewManager(homeRoot),
    projects,
    state,
    onProjectTopologyChanged: (eventId) => {
      topologyChangedEventIds.push(eventId)
    },
    onProjectAttentionResolved: (projectId) => {
      restoredProjectIds.push(projectId)
    },
    onGoalEffect: (eventId, projectId, goalId) => {
      goalEffects.push({ eventId, projectId, goalId })
    },
    onProjectDispatchEffect: (eventId, projectId) => {
      projectDispatchEffects.push({ eventId, projectId })
    },
  })
  const tools: AssistantTools = rawTools
  return {
    homeRoot,
    repoRoot,
    primaryRepoId: linked.primaryRepoId,
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
    goalEffects,
    projectDispatchEffects,
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

async function publishCompletedGoalArtifact(fixture: Awaited<ReturnType<typeof setup>>) {
  await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
  await finishInitialPlanning(fixture.goalStore, 'G-1')
  await publishEngineeringWork(fixture.goalStore, 'G-1', 'W-deliverable')
  const runId = 'R-deliverable'
  const evidenceId = 'E-deliverable'
  const artifactName = 'deliverable.md'
  const artifactRoot = join(runStoragePath(fixture.homeRoot, runId), 'artifacts')
  await mkdir(artifactRoot, { recursive: true })
  await Bun.write(join(artifactRoot, artifactName), '# Delivered result\n')

  const workPath = fixture.goalStore.paths.workDocument('G-1', 'W-deliverable')
  const workSource = await Bun.file(fixture.goalStore.paths.absolute(workPath)).text()
  const work = parseWorkDocument(workSource)
  work.attributes.stage = 'done'
  work.attributes.evidenceRefs = [evidenceId]
  await fixture.goalStore.publishGoal('G-1', {
    supportingWrites: [
      {
        path: fixture.goalStore.paths.evidenceDocument('G-1', evidenceId),
        expectedHash: null,
        content: renderEvidenceDocument({
          attributes: {
            id: evidenceId,
            createdAt: '2026-07-19T00:00:00Z',
            producerRun: `project:P-1/goal:G-1/work:W-deliverable/run:${runId}`,
            coordinatorCheck: null,
            owner: 'project:P-1/goal:G-1/work:W-deliverable',
            artifacts: [`artifact:${runId}/${artifactName}`],
          },
          body: '## Summary\n\nThe requested deliverable is complete.\n',
        }),
      },
    ],
    gateWrite: {
      path: workPath,
      expectedHash: await hashBytes(new TextEncoder().encode(workSource)),
      content: renderWorkDocument(work),
    },
  })

  const attentionId = 'A-completion'
  const goalPath = fixture.goalStore.paths.goalDocument('G-1')
  const goalSource = await Bun.file(fixture.goalStore.paths.absolute(goalPath)).text()
  const goal = parseGoalDocument(goalSource)
  goal.attributes.lifecycle = 'done'
  goal.attributes.completionAttentionId = attentionId
  await fixture.goalStore.publishGoal('G-1', {
    supportingWrites: [
      {
        path: fixture.goalStore.paths.attentionDocument('G-1', attentionId),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: attentionId,
            target: null,
            createdAt: '2026-07-19T00:01:00Z',
            resolvedAt: null,
            notifiedAt: null,
            operatorRequest: null,
          },
          body: '## Completion\n\nThe Goal is complete with linked Evidence.\n',
        }),
      },
    ],
    gateWrite: {
      path: goalPath,
      expectedHash: await hashBytes(new TextEncoder().encode(goalSource)),
      content: renderGoalDocument(goal),
    },
  })

  return {
    attentionId,
    operatorUrl: `/api/projects/P-1/goals/G-1/evidence/${evidenceId}/artifacts/0`,
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

function planningFirstWork(_objective: string) {
  return { kind: 'planning' as const }
}
