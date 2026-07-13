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
        await runtimeRef.current.assistantTools.execute(input.toolToken, 'hopi_notify_user', {})
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
        await runtimeRef.current.assistantTools.execute(input.toolToken, 'hopi_notify_user', {})
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
      goals: Array<{ works: Array<{ projection: { primaryBadge: string | null } }> }>
    }
    expect(project.goals[0]?.works[0]?.projection.primaryBadge).toBe('Needs you')
    expect(await git(repoRoot, ['status', '--porcelain'])).toBe('')
  })
})

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
