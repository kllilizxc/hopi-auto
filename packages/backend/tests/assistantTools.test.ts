import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantStateReader } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import type { InboxContext } from '../src/domain/assistantWorkspaceDocuments'
import { goalAttentionReference } from '../src/domain/attentionReference'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createPreviewManager } from '../src/runtime/previewManager'
import type { Responsibility } from '../src/runtime/roleContextStager'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
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
    ).rejects.toThrow('cannot cite an Assistant-home attachment path')
    expect(await fixture.goalStore.readGoal('G-invalid-image-path')).toBeNull()
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

  test('interrupts obsolete Goal Runs only after a material contract revision', async () => {
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

  test('refuses to resolve exhausted Work Attention before its blocker changes', async () => {
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

    await fixture.tools.executeForEvent('EV-1', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-1',
      workId: 'plan-initial',
      operation: 'retry',
    })
    expect(
      await fixture.tools.executeForEvent('EV-1', 'hopi_resolve_attention', resolution),
    ).toMatchObject({ changed: true })
    const resolvedPackage = await fixture.goalStore.readPackage('G-1')
    expect(resolvedPackage.attentions.get(attention.attributes.id)?.attributes).toMatchObject({
      resolvedAt: expect.any(String),
      resolutionInput: expect.stringContaining('/EV-1.md'),
    })
    expect(resolvedPackage.inputs).toHaveLength(1)
    expect(resolvedPackage.inputs[0]?.body).toBe('Retry this Work and clear the blocker.\n')
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
    expect(await fixture.tools.execute(mainToken, 'hopi_notify_user', {})).toMatchObject({
      changed: false,
      value: {
        requested: true,
        attentionRefs: ['project:P-1/goal:G-1/attention:A-1'],
      },
    })
    expect(fixture.tools.notificationRequested(mainToken)).toBe(true)
    expect((await fixture.workspace.readEvent(event.attributes.id))?.attributes).toMatchObject({
      visibility: 'internal',
      status: 'pending',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({ notifiedAt: null, resolvedAt: null })

    await fixture.workspace.handleEvent(event.attributes.id, {
      reply: 'Choose a release window.',
      disposition: 'tools-used',
      expose: true,
    })
    expect(await fixture.tools.acknowledgeEventAttentions(event.attributes.id)).toEqual([
      'project:P-1/goal:G-1/attention:A-1',
    ])
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attentionId)?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })
  })

  test('rejects notify_user for an ordinary public turn', async () => {
    const fixture = await setup()
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Hello.' })

    await expect(fixture.tools.executeForEvent('EV-1', 'hopi_notify_user', {})).rejects.toThrow(
      'only for an internal Reflection turn',
    )
  })

  test('reads current control state without inlining durable history', async () => {
    const active = new Map<string, Responsibility>()
    const fixture = await setup({ activeRuns: () => active })
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const runRoot = join(
      fixture.homeRoot,
      '.hopi',
      'runtime',
      'runs',
      'P-1',
      'G-1',
      'plan-initial',
      'R-live',
    )
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

  test('reads bounded Attempt diagnostics and stable local log paths', async () => {
    const fixture = await setup()
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const runRoot = join(
      fixture.homeRoot,
      '.hopi',
      'runtime',
      'runs',
      'P-1',
      'G-1',
      'plan-initial',
      'R-1',
    )
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

    await Bun.write(join(runRoot, 'transcript.log'), 'stdout: changed raw diagnostics only\n')
    const second = await fixture.tools.executeForEvent('EV-read', 'hopi_read_state', {
      projectId: 'P-1',
      goalId: 'G-1',
    })
    expect((second.value as { stateDigest: string }).stateDigest).toBe(snapshot.stateDigest)
  })
})

async function setup(
  options: {
    activeRuns?: () => ReadonlyMap<string, Responsibility>
    trackInterrupts?: boolean
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
  const restoredProjectIds: string[] = []
  const projects = new Map([
    [
      'P-1',
      {
        projectId: 'P-1',
        projectRoot: linked.integrationRoot,
        store: goalStore,
        controller,
        ...(options.trackInterrupts
          ? {
              reconciler: {
                interruptRuns(goalId?: string) {
                  if (goalId) interruptedGoalIds.push(goalId)
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
  const attempts = createRunAttemptStore(homeRoot)
  const state = createAssistantStateReader({
    homeRoot,
    workspace,
    projects,
    publisher,
    attempts,
    activeRuns: options.activeRuns,
  })
  const tools = createAssistantTools({
    workspace,
    publisher,
    preview: createPreviewManager(homeRoot),
    projects,
    state,
    onProjectAttentionResolved: (projectId) => restoredProjectIds.push(projectId),
  })
  return {
    homeRoot,
    workspace,
    goalStore,
    controller,
    attempts,
    tools,
    interruptedGoalIds,
    restoredProjectIds,
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

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr || stdout)
}

function pngBytes(marker = 0) {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker])
}
