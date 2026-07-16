import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantModelRunner } from '../src/assistant/workspaceAssistant'
import { renderAttentionDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { type MvpRuntime, createMvpRuntime } from '../src/runtime/mvpRuntime'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-attention-e2e')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Reflection to operator Attention E2E', () => {
  test('keeps speaking and Reflection runners on their configured boundaries', async () => {
    const repoRoot = join(temporaryRoot, 'runner-boundary-repo')
    await initializeGitRepo(repoRoot)
    const homeRoot = join(temporaryRoot, 'runner-boundary-home')
    const mainModes: Array<string | undefined> = []
    const reflectionModes: Array<string | undefined> = []
    const mainRunner: AssistantModelRunner = {
      async run(input) {
        mainModes.push(input.toolMode)
        return { reply: 'Speaking reply.', session: codexSession('main-boundary') }
      },
    }
    const reflectionRunner: AssistantModelRunner = {
      async run(input) {
        reflectionModes.push(input.toolMode)
        return { reply: 'No handoff.', session: codexSession('reflection-boundary') }
      },
    }
    const home = createAssistantHomeStore(homeRoot, new PublicationCoordinator())
    await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
    const runtime = await createMvpRuntime({
      homeRoot,
      assistantRunner: mainRunner,
      reflectionRunner,
      start: false,
    })
    await runtime.workspace.receiveEvent({ eventId: 'EV-user', content: 'Report status.' })

    await runtime.assistant.process('EV-user')
    await runtime.workspace.createAttention({
      attributes: {
        id: 'A-runner-boundary',
        target: 'project:P-1',
        createdAt: '2026-07-14T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: 'Inspect this state change.\n',
    })
    expect(await runtime.reflection.observe({ settled: false })).toBe('started')
    await runtime.reflection.waitForIdle()

    expect(mainModes).toEqual(['main'])
    expect(reflectionModes).toEqual(['reflection'])
  })

  test('recovers an omitted handoff and projects Needs you only after the reply is durable', async () => {
    const repoRoot = join(temporaryRoot, 'repo')
    await initializeGitRepo(repoRoot)
    const homeRoot = join(temporaryRoot, 'home')
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
    const goalStore = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
    await goalStore.createGoal({ goalId: 'G-1', title: 'Release', objective: 'Ship safely.' })
    await goalStore.publishGoal('G-1', {
      supportingWrites: [],
      gateWrite: {
        path: goalStore.paths.attentionDocument('G-1', 'A-window'),
        expectedHash: null,
        content: renderAttentionDocument({
          attributes: {
            id: 'A-window',
            target: 'project:P-1/goal:G-1',
            createdAt: '2026-07-13T00:00:00Z',
            resolvedAt: null,
            notifiedAt: null,
          },
          body: '## Needs you\n\nChoose today or tomorrow.\n',
        }),
      },
    })

    const runtimeRef: { current: MvpRuntime | null } = { current: null }
    const runner: AssistantModelRunner = {
      async run(input) {
        if (input.toolMode === 'reflection') {
          return { reply: 'No handoff.', session: codexSession('reflection-e2e') }
        }
        if (!runtimeRef.current) throw new Error('Runtime is not ready')
        await runtimeRef.current.assistantTools.execute(input.toolToken, 'hopi_notify_user', {
          message: 'Choose the release window: today or tomorrow?',
        })
        return {
          reply: 'Choose the release window: today or tomorrow?',
          session: codexSession('assistant-e2e'),
        }
      },
    }
    const runtime = await createMvpRuntime({ homeRoot, assistantRunner: runner, start: false })
    runtimeRef.current = runtime

    expect(await runtime.reflection.observe({ settled: false })).toBe('started')
    await runtime.reflection.waitForIdle()
    const handoff = [...(await runtime.workspace.readWorkspace()).events.values()][0]
    expect(handoff?.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'internal',
      status: 'pending',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-window'],
      },
    })

    await runtime.assistant.process(handoff?.attributes.id ?? 'missing-event')

    expect(
      (await runtime.workspace.readEvent(handoff?.attributes.id ?? 'missing-event'))?.attributes,
    ).toMatchObject({
      visibility: 'public',
      status: 'handled',
      reply: 'Choose the release window: today or tomorrow?',
    })
    expect(
      (await runtime.projects.get('P-1')?.store.readPackage('G-1'))?.attentions.get('A-window')
        ?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })

    const state = await runtime.assistantState.read({ projectId: 'P-1', goalId: 'G-1' })
    const project = state.projects[0] as {
      goals: Array<{ works: Array<{ projection: { primaryBadge: string | null } }> }>
    }
    expect(project.goals[0]?.works[0]?.projection.primaryBadge).toBe('Needs you')
    expect(await git(repoRoot, ['status', '--porcelain'])).toBe('')
  })

  test('uses the same fallback and acknowledgement path for Workspace Attention', async () => {
    const repoRoot = join(temporaryRoot, 'workspace-repo')
    await initializeGitRepo(repoRoot)
    const homeRoot = join(temporaryRoot, 'workspace-home')
    const publisher = new PublicationCoordinator()
    const home = createAssistantHomeStore(homeRoot, publisher)
    const linked = await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
    const goalStore = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
    await goalStore.createGoal({ goalId: 'G-1', title: 'Release', objective: 'Ship safely.' })

    const runtimeRef: { current: MvpRuntime | null } = { current: null }
    const runner: AssistantModelRunner = {
      async run(input) {
        if (input.toolMode === 'reflection') {
          return { reply: 'No handoff.', session: codexSession('workspace-reflection-e2e') }
        }
        if (!runtimeRef.current) throw new Error('Runtime is not ready')
        await runtimeRef.current.assistantTools.execute(input.toolToken, 'hopi_notify_user', {
          message: 'The Project checkout needs to be rebound before work can continue.',
        })
        return {
          reply: 'The Project checkout needs to be rebound before work can continue.',
          session: codexSession('workspace-assistant-e2e'),
        }
      },
    }
    const runtime = await createMvpRuntime({ homeRoot, assistantRunner: runner, start: false })
    runtimeRef.current = runtime
    await runtime.workspace.createAttention({
      attributes: {
        id: 'A-project',
        target: 'project:P-1',
        createdAt: '2026-07-13T00:00:00Z',
        resolvedAt: null,
        notifiedAt: null,
      },
      body: 'The managed Project binding is invalid.\n',
    })

    expect(await runtime.reflection.observe({ settled: false })).toBe('started')
    await runtime.reflection.waitForIdle()
    const workspace = await runtime.workspace.readWorkspace()
    const handoff = [...workspace.events.values()][0]
    expect(handoff?.attributes.context).toMatchObject({
      attentionRefs: [`home:${workspace.homeId}/attention:A-project`],
    })

    await runtime.assistant.process(handoff?.attributes.id ?? 'missing-event')

    expect(
      (await runtime.workspace.readWorkspace()).attentions.get('A-project')?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })
    const state = await runtime.assistantState.read({ projectId: 'P-1', goalId: 'G-1' })
    const project = state.projects[0] as {
      available: boolean
      goals: Array<{
        works: Array<{
          projection: { primaryBadge: string | null; failedPredicates: string[] }
        }>
      }>
    }
    expect(project.available).toBe(false)
    expect(project.goals[0]?.works[0]?.projection).toMatchObject({
      primaryBadge: 'waiting',
      failedPredicates: ['project_ineligible'],
    })
    expect(await git(repoRoot, ['status', '--porcelain'])).toBe('')
  })

  for (const scenario of [
    {
      name: 'in the same Goal',
      slug: 'same-goal',
      oldProjectId: 'P-target',
      oldGoalId: 'G-target',
      targetProjectId: 'P-target',
      targetGoalId: 'G-target',
      restart: false,
    },
    {
      name: 'from another Goal',
      slug: 'another-goal',
      oldProjectId: 'P-target',
      oldGoalId: 'G-old',
      targetProjectId: 'P-target',
      targetGoalId: 'G-target',
      restart: false,
    },
    {
      name: 'from another Project',
      slug: 'another-project',
      oldProjectId: 'P-old',
      oldGoalId: 'G-old',
      targetProjectId: 'P-target',
      targetGoalId: 'G-target',
      restart: false,
    },
    {
      name: 'after restart',
      slug: 'restart',
      oldProjectId: 'P-target',
      oldGoalId: 'G-target',
      targetProjectId: 'P-target',
      targetGoalId: 'G-target',
      restart: true,
    },
  ] as const) {
    test(`notifies a new Goal Attention when an older handoff is blocked ${scenario.name}`, async () => {
      await verifyPoisonedHistoryIsolation(scenario)
    })
  }
})

async function verifyPoisonedHistoryIsolation(scenario: {
  slug: string
  oldProjectId: string
  oldGoalId: string
  targetProjectId: string
  targetGoalId: string
  restart: boolean
}) {
  const root = join(temporaryRoot, scenario.slug)
  const homeRoot = join(root, 'home')
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(homeRoot, publisher)
  const goals = new Map<string, Set<string>>()
  for (const [projectId, goalId] of [
    [scenario.oldProjectId, scenario.oldGoalId],
    [scenario.targetProjectId, scenario.targetGoalId],
  ] as const) {
    const projectGoals = goals.get(projectId) ?? new Set<string>()
    projectGoals.add(goalId)
    goals.set(projectId, projectGoals)
  }

  const stores = new Map<string, ReturnType<typeof createGoalPackageStore>>()
  for (const [projectId, projectGoals] of goals) {
    const repoRoot = join(root, `repo-${projectId}`)
    await initializeGitRepo(repoRoot)
    const linked = await home.linkProject({ projectId, repoPath: repoRoot })
    const store = createGoalPackageStore(linked.integrationRoot, projectId, publisher)
    stores.set(projectId, store)
    for (const goalId of projectGoals) {
      await store.createGoal({ goalId, title: goalId, objective: 'Exercise Attention delivery.' })
    }
  }

  const targetAttentionId = 'A-new-blocker'
  const targetStore = stores.get(scenario.targetProjectId)
  if (!targetStore) throw new Error('Target project store was not created')
  await targetStore.publishGoal(scenario.targetGoalId, {
    supportingWrites: [],
    gateWrite: {
      path: targetStore.paths.attentionDocument(scenario.targetGoalId, targetAttentionId),
      expectedHash: null,
      content: renderAttentionDocument({
        attributes: {
          id: targetAttentionId,
          target: `project:${scenario.targetProjectId}/goal:${scenario.targetGoalId}`,
          createdAt: '2026-07-16T00:00:00.000Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Needs you\n\nPrepare the external runtime.\n',
      }),
    },
  })

  const runtimeRef: { current: MvpRuntime | null } = { current: null }
  let oldEventAttentionId = ''
  let internalTurns = 0
  let reflectionRuns = 0
  const publicMessage = `Prepare the external runtime for ${scenario.targetProjectId}/${scenario.targetGoalId}.`
  const runner: AssistantModelRunner = {
    async run(input) {
      if (input.toolMode === 'reflection') {
        reflectionRuns += 1
        return {
          reply: 'No handoff; Coordinator may apply the unnotified-Attention fallback.',
          session: codexSession(`reflection-${scenario.slug}-${reflectionRuns}`),
        }
      }
      if (input.toolMode !== 'internal') {
        throw new Error(`Unexpected speaking mode in poisoned-history fixture: ${input.toolMode}`)
      }
      const runtime = runtimeRef.current
      if (!runtime) throw new Error('Runtime is not ready')
      internalTurns += 1
      if (internalTurns === 1) {
        await runtime.assistantTools.execute(input.toolToken, 'hopi_notify_user', {
          message: publicMessage,
        })
      }
      return {
        reply: internalTurns === 1 ? publicMessage : 'No additional operator update.',
        session: codexSession(`internal-${scenario.slug}-${internalTurns}`),
      }
    },
  }

  let runtime = await createMvpRuntime({ homeRoot, assistantRunner: runner, start: false })
  runtimeRef.current = runtime
  if (
    scenario.oldProjectId !== scenario.targetProjectId ||
    scenario.oldGoalId !== scenario.targetGoalId
  ) {
    await runtime.projects.get(scenario.oldProjectId)?.controller.pauseGoal(scenario.oldGoalId)
  }
  const oldEvent = await runtime.workspace.receiveReflectionEvent({
    eventId: 'EV-old-blocked-handoff',
    content: 'Revalidate an older state change.',
    context: { projectId: scenario.oldProjectId, goalId: scenario.oldGoalId },
  })
  oldEventAttentionId = (
    await runtime.attentions.ensureEventAttention(
      oldEvent.attributes.id,
      'The older speaking handoff failed.',
    )
  ).attributes.id

  if (scenario.restart) {
    await runtime.coordinator.stop()
    runtime = await createMvpRuntime({ homeRoot, assistantRunner: runner, start: false })
    runtimeRef.current = runtime
  }

  let converged = false
  let oldAttentionResolved = false
  let lastDiagnostic: unknown = null
  for (let step = 0; step < 20; step += 1) {
    await runtime.coordinator.reconcileOnce()
    await runtime.coordinator.waitForIdle()
    const [workspace, target] = await Promise.all([
      runtime.workspace.readWorkspace(),
      runtime.projects.get(scenario.targetProjectId)?.store.readPackage(scenario.targetGoalId),
    ])
    const targetAttention = target?.attentions.get(targetAttentionId)
    const oldAttention = workspace.attentions.get(oldEventAttentionId)
    const pending = [...workspace.events.values()].filter(
      (event) => event.attributes.status === 'pending',
    )
    lastDiagnostic = {
      step,
      targetAttention: targetAttention?.attributes,
      oldAttention: oldAttention?.attributes,
      pending: pending.map((event) => ({
        id: event.attributes.id,
        source: event.attributes.source,
        visibility: event.attributes.visibility,
      })),
      internalTurns,
      reflectionRuns,
    }
    if (
      targetAttention?.attributes.notifiedAt &&
      oldAttention?.attributes.resolvedAt === null &&
      !oldAttentionResolved
    ) {
      await runtime.workspace.resolveAttention(
        oldEventAttentionId,
        'The later Goal Attention was delivered; revalidate the older event once.',
      )
      oldAttentionResolved = true
      continue
    }
    if (
      targetAttention?.attributes.notifiedAt &&
      oldAttention?.attributes.resolvedAt &&
      pending.length === 0 &&
      !runtime.reflection.isActive()
    ) {
      converged = true
      break
    }
  }

  if (!converged) {
    throw new Error(`Poisoned-history fixture did not converge: ${JSON.stringify(lastDiagnostic)}`)
  }
  const [workspace, target] = await Promise.all([
    runtime.workspace.readWorkspace(),
    runtime.projects.get(scenario.targetProjectId)?.store.readPackage(scenario.targetGoalId),
  ])
  const targetAttention = target?.attentions.get(targetAttentionId)
  expect(targetAttention?.attributes).toMatchObject({
    resolvedAt: null,
    notifiedAt: expect.any(String),
  })
  expect(workspace.attentions.get(oldEventAttentionId)?.attributes.resolvedAt).toEqual(
    expect.any(String),
  )
  expect(workspace.attentions.size).toBe(1)
  expect(workspace.events.get(oldEvent.attributes.id)?.attributes.status).toBe('handled')
  const publicReflectionEvents = [...workspace.events.values()].filter(
    (event) => event.attributes.source === 'reflection' && event.attributes.visibility === 'public',
  )
  expect(publicReflectionEvents).toHaveLength(1)
  expect(publicReflectionEvents[0]?.attributes).toMatchObject({
    reply: publicMessage,
    context: {
      projectId: scenario.targetProjectId,
      goalId: scenario.targetGoalId,
      attentionRefs: [
        `project:${scenario.targetProjectId}/goal:${scenario.targetGoalId}/attention:${targetAttentionId}`,
      ],
    },
  })
  expect(
    [...workspace.events.values()].filter((event) => event.attributes.status === 'pending'),
  ).toEqual([])
  expect(internalTurns).toBeGreaterThanOrEqual(2)
  expect(reflectionRuns).toBeGreaterThanOrEqual(1)
  await runtime.coordinator.stop()
}

async function initializeGitRepo(repoRoot: string) {
  await mkdir(repoRoot, { recursive: true })
  await git(repoRoot, ['init', '-b', 'main'])
  await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
  await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
  await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
  await git(repoRoot, ['add', '.'])
  await git(repoRoot, ['commit', '-m', 'initial'])
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

function codexSession(sessionId: string) {
  return { transport: 'codex' as const, sessionId }
}
