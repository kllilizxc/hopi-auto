import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantStateSnapshot } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import { renderWorkDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import type { RunRequest } from '../src/runtime/runRequest'
import type { WorkCompletionResult, WorkRunRequest } from '../src/scheduler/projectReconciler'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-tools-wayfinder')

const initialMap = `## Destination

Reach an accepted execution design.

## Notes

Keep the route implementation-neutral.

## Decisions so far

## Not yet specified

The publication boundary remains foggy.

## Out of scope

Visual polish.
`

const resolvedMap = `## Destination

Reach an accepted execution design.

## Notes

Keep the route implementation-neutral.

## Decisions so far

- [Choose the authority boundary](../work/W-choose-the-authority-boundary.md) — one publisher owns canonical state.

## Not yet specified

## Out of scope

Visual polish.
`

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(() => rm(temporaryRoot, { recursive: true, force: true }))

describe('Assistant Wayfinder tools', () => {
  test('creates one mapped Goal, then adds and wires precise Decision Work', async () => {
    const fixture = await setup()
    await fixture.turn('EV-create', 'Find the execution design.')

    const created = await fixture.tools.executeForEvent('EV-create', 'hopi_create_goal', {
      projectId: 'P-1',
      goalId: 'G-route',
      title: 'Find the execution route',
      objective: 'Make the route clear enough to execute.',
      mapMarkdown: initialMap,
      firstWork: {
        kind: 'decision',
        title: 'Choose the authority boundary',
        decisionType: 'grilling',
        question: 'Which component alone may publish canonical state?',
      },
      references: [],
    })

    expect(created).toMatchObject({
      changed: true,
      value: {
        effect: {
          kind: 'goal_created',
          workKind: 'decision',
          workId: 'W-choose-the-authority-boundary',
        },
      },
    })

    await fixture.turn('EV-work', 'This decision follows the authority boundary.')
    const added = await fixture.tools.executeForEvent('EV-work', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-route',
      work: {
        kind: 'decision',
        title: 'Choose the integration boundary',
        decisionType: 'research',
        question: 'Where should accepted source changes integrate?',
        dependsOn: ['W-choose-the-authority-boundary'],
      },
      references: [],
    })

    const goal = await fixture.store.readPackage('G-route')
    expect(added).toMatchObject({
      changed: true,
      value: { effect: { workKind: 'decision', workId: 'W-choose-the-integration-boundary' } },
    })
    expect(goal.works.get('W-choose-the-integration-boundary')?.attributes).toMatchObject({
      decisionType: 'research',
      dependsOn: ['W-choose-the-authority-boundary'],
    })
    expect(
      await Bun.file(
        fixture.store.paths.absolute(fixture.store.paths.designIndex('G-route')),
      ).text(),
    ).toBe(initialMap)
  })

  test('keeps the exact Map shape at the canonical publication boundary', async () => {
    const fixture = await setup()
    await fixture.turn('EV-invalid', 'Create the map.')

    await expect(
      fixture.tools.executeForEvent('EV-invalid', 'hopi_create_goal', {
        projectId: 'P-1',
        goalId: 'G-invalid',
        title: 'Invalid map',
        objective: 'Reject drift.',
        mapMarkdown: initialMap.replace('## Not yet specified', '## Open questions'),
        firstWork: {
          kind: 'decision',
          title: 'Resolve drift',
          decisionType: 'research',
          question: 'What is the valid Map shape?',
        },
        references: [],
      }),
    ).rejects.toThrow('Wayfinder Map must contain exactly these ordered headings')
  })

  test('passes only the Run contract to the Worker scheduler', async () => {
    const fixture = await setup()
    await fixture.createDirectGoal()
    await fixture.turn('EV-run', 'Start the implementation Run.')
    const request = {
      workspaceMode: 'isolated_write',
      instructionMarkdown: 'Implement the accepted contract and report evidence.',
      refs: ['docs/accepted.md'],
    } satisfies RunRequest

    const result = await fixture.tools.executeForEvent('EV-run', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-direct',
      workId: 'W-build',
      action: { kind: 'run', ...request },
    })

    expect(fixture.runRequests).toEqual([{ goalId: 'G-direct', workId: 'W-build', request }])
    expect(fixture.runRequests[0]?.request).not.toHaveProperty('kind')
    expect(result).toMatchObject({
      changed: true,
      value: { effect: { kind: 'work_run_requested', runDisposition: 'scheduled' } },
    })
  })

  test('completes one Decision and updates its Map in one tool action', async () => {
    const fixture = await setup()
    await fixture.createMappedGoal()
    await fixture.turn('EV-complete', 'Record the accepted answer.')

    const result = await fixture.tools.executeForEvent('EV-complete', 'hopi_control_work', {
      projectId: 'P-1',
      goalId: 'G-route',
      workId: 'W-choose-the-authority-boundary',
      action: {
        kind: 'complete',
        decision: 'One deterministic publisher owns canonical state.',
        mapMarkdown: resolvedMap,
      },
    })

    const goal = await fixture.store.readPackage('G-route')
    expect(result).toMatchObject({
      changed: true,
      value: { effect: { kind: 'work_completion', status: 'done', result: 'completed' } },
    })
    expect(goal.works.get('W-choose-the-authority-boundary')?.body).toContain('## Resolution')
    expect(goal.works.get('W-choose-the-authority-boundary')?.body).toContain(
      'One deterministic publisher owns canonical state.',
    )
    expect(
      await Bun.file(
        fixture.store.paths.absolute(fixture.store.paths.designIndex('G-route')),
      ).text(),
    ).toBe(resolvedMap)
  })

  test('uses Work Attention as the HITL claim and keeps it unresolved until a later judgment', async () => {
    const fixture = await setup()
    await fixture.createMappedGoal()
    await fixture.turn('EV-attention', 'Ask me the unresolved boundary question.')

    const created = await fixture.tools.executeForEvent('EV-attention', 'hopi_manage_attention', {
      projectId: 'P-1',
      change: {
        kind: 'create',
        attentionId: 'A-authority',
        goalId: 'G-route',
        workId: 'W-choose-the-authority-boundary',
        summary: 'Choose who owns canonical publication.',
        body: 'Which component should own the only canonical publication boundary?',
        refs: [],
      },
    })

    const goal = await fixture.store.readPackage('G-route')
    expect(created).toMatchObject({ changed: true, value: { resolved: false } })
    expect(goal.attentions.get('A-authority')?.attributes).toMatchObject({
      resolvedAt: null,
      target: 'project:P-1/goal:G-route/work:W-choose-the-authority-boundary',
    })
  })

  test('presents independent Work Attentions together without merging their claims', async () => {
    const fixture = await setup()
    await fixture.createMappedGoal()
    await fixture.turn('EV-grilling-round', 'Ask every independent boundary question.')
    await fixture.tools.executeForEvent('EV-grilling-round', 'hopi_create_work', {
      projectId: 'P-1',
      goalId: 'G-route',
      work: {
        kind: 'decision',
        title: 'Choose the retention boundary',
        decisionType: 'grilling',
        question: 'How long should canonical history be retained?',
        dependsOn: [],
      },
      references: [],
    })

    const authority = await fixture.tools.executeForEvent(
      'EV-grilling-round',
      'hopi_manage_attention',
      {
        projectId: 'P-1',
        change: {
          kind: 'create',
          attentionId: 'A-authority',
          goalId: 'G-route',
          workId: 'W-choose-the-authority-boundary',
          summary: 'Choose who owns canonical publication.',
          body: 'Which component should own canonical publication?',
          refs: [],
        },
      },
    )
    const retention = await fixture.tools.executeForEvent(
      'EV-grilling-round',
      'hopi_manage_attention',
      {
        projectId: 'P-1',
        change: {
          kind: 'create',
          attentionId: 'A-retention',
          goalId: 'G-route',
          workId: 'W-choose-the-retention-boundary',
          summary: 'Choose how long canonical history is retained.',
          body: 'How long should canonical history be retained?',
          refs: [],
        },
      },
    )
    const attentionRefs = [authority, retention].map(
      (result) => (result.value as { attentionRef: string }).attentionRef,
    )

    const presented = await fixture.tools.executeForEvent(
      'EV-grilling-round',
      'hopi_manage_attention',
      {
        projectId: 'P-1',
        change: { kind: 'present_attention_to_user', attentionRefs },
      },
    )

    const goal = await fixture.store.readPackage('G-route')
    expect(presented).toMatchObject({
      summary: 'Presented 2 Attention(s).',
      value: {
        effect: { kind: 'attention_presentation_staged', attentionRefs },
      },
    })
    expect(goal.attentions.get('A-authority')?.attributes.target).toBe(
      'project:P-1/goal:G-route/work:W-choose-the-authority-boundary',
    )
    expect(goal.attentions.get('A-retention')?.attributes.target).toBe(
      'project:P-1/goal:G-route/work:W-choose-the-retention-boundary',
    )
  })
})

async function setup() {
  const repoRoot = join(temporaryRoot, 'repo')
  await initRepo(repoRoot)
  const homeRoot = join(temporaryRoot, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  const workspace = createAssistantWorkspaceStore(homeRoot, publisher)
  const store = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
  const controller = createGoalController(store, {
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  })
  const runRequests: Array<{ goalId: string; workId: string; request: RunRequest }> = []

  const project = {
    projectId: 'P-1',
    projectRoot: linked.integrationRoot,
    sourceRoot: linked.integrationRoot,
    primaryRepoId: linked.primaryRepoId,
    repos: linked.repos,
    store,
    controller,
    reconciler: {
      interruptRuns() {},
      async interruptQueuedRuns() {
        return 0
      },
      liveWorkIds() {
        return new Set<string>()
      },
      async decisionWhenEligible() {
        return { kind: 'wait' as const, reasons: [] }
      },
      async requestWorkRun(goalId: string, workId: string, request: RunRequest) {
        runRequests.push({ goalId, workId, request })
        return { runId: `R-${runRequests.length}`, disposition: 'scheduled' as const }
      },
      async completeWork(
        goalId: string,
        workId: string,
        input: { sourceEventId: string; decision: string; mapMarkdown?: string },
      ): Promise<WorkCompletionResult> {
        const goal = await store.readPackage(goalId)
        const work = goal.works.get(workId)
        if (!work || work.attributes.kind !== 'decision') throw new Error('Expected Decision Work')
        const source = await Bun.file(
          store.paths.absolute(store.paths.workDocument(goalId, workId)),
        ).text()
        const completed = {
          ...work,
          attributes: { ...work.attributes, status: 'done' as const },
          body: `${work.body.trimEnd()}\n\n## Resolution\n\nAssistant event: ${input.sourceEventId}\n\n${input.decision}\n`,
        }
        await store.publishGoal(goalId, {
          supportingWrites: input.mapMarkdown
            ? [
                {
                  path: store.paths.designIndex(goalId),
                  expectedHash: await hashBytes(
                    new TextEncoder().encode(
                      await Bun.file(store.paths.absolute(store.paths.designIndex(goalId))).text(),
                    ),
                  ),
                  content: input.mapMarkdown,
                },
              ]
            : [],
          gateWrite: {
            path: store.paths.workDocument(goalId, workId),
            expectedHash: await hashBytes(new TextEncoder().encode(source)),
            content: renderWorkDocument(completed),
          },
        })
        return { kind: 'completed', commit: null, recoveredUncertainUpdate: false }
      },
      async completeGoal() {
        throw new Error('Unexpected Goal completion')
      },
    },
  }

  const emptyState: AssistantStateSnapshot = {
    observedAt: '2026-08-14T00:00:00.000Z',
    stateDigest: 'a'.repeat(64),
    conversationDigests: { home: 'b'.repeat(64), projects: {} },
    activeRuns: [],
    workspaceAttentions: [],
    projects: [],
  }
  const state = {
    async read() {
      return emptyState
    },
    async readForWake() {
      return emptyState
    },
  }
  const tools = createAssistantTools({
    home,
    workspace,
    projects: new Map([['P-1', project]]),
    publisher,
    preview: {
      async recover() {},
      async start() {
        throw new Error('Unexpected Preview start')
      },
      async stop() {
        return null
      },
      async stopAll() {},
      inspect() {
        return null
      },
    },
    state,
    onProjectTopologyChanged() {},
    async onProjectRecoveryRequested() {
      return { eligible: true }
    },
    onGoalEffect() {},
    onProjectDispatchEffect() {},
    onToolEffect() {},
    now: () => new Date('2026-08-14T00:00:00.000Z'),
  })

  return {
    store,
    tools,
    runRequests,
    turn(eventId: string, content: string) {
      return workspace.receiveEvent({ eventId, content, context: { projectId: 'P-1' } })
    },
    createMappedGoal() {
      return store.createGoal({
        goalId: 'G-route',
        title: 'Find the execution route',
        objective: 'Make the route clear enough to execute.',
        mapMarkdown: initialMap,
        firstWork: {
          id: 'W-choose-the-authority-boundary',
          title: 'Choose the authority boundary',
          kind: 'decision',
          decisionType: 'grilling',
          question: 'Which component alone may publish canonical state?',
        },
        createdAt: '2026-08-14T00:00:00.000Z',
      })
    },
    createDirectGoal() {
      return store.createGoal({
        goalId: 'G-direct',
        title: 'Build the accepted change',
        objective: 'Deliver one known change.',
        firstWork: {
          id: 'W-build',
          title: 'Build the change',
          kind: 'engineering',
          objective: 'Implement the accepted change.',
          acceptanceCriteria: ['The accepted behavior works.'],
        },
        createdAt: '2026-08-14T00:00:00.000Z',
      })
    },
  }
}

async function initRepo(path: string) {
  await mkdir(path, { recursive: true })
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'hopi@example.test'],
    ['config', 'user.name', 'HOPI Test'],
  ])
    await git(path, args)
  await Bun.write(join(path, 'README.md'), '# Repo\n')
  await git(path, ['add', '.'])
  await git(path, ['commit', '-m', 'initial'])
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
