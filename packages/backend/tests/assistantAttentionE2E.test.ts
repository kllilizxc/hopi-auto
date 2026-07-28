import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AssistantModelRunner } from '../src/assistant/workspaceAssistant'
import type { WorkspaceAttentionDocument } from '../src/domain/assistantWorkspaceDocuments'
import { PublicationCoordinator } from '../src/publication/publisher'
import { type MvpRuntime, createMvpRuntime } from '../src/runtime/mvpRuntime'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-attention-e2e')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Project Assistant wake and Attention E2E', () => {
  test('drains unresolved Attention through native forks of one speaking session', async () => {
    const calls: Array<{
      mode: string | undefined
      invocation: string | undefined
      sessionId: string | null
    }> = []
    let supervisionCalls = 0
    const runtime = await setupRuntime({
      async run(input) {
        calls.push({
          mode: input.toolMode,
          invocation: input.invocation,
          sessionId: input.session?.sessionId ?? null,
        })
        if (input.invocation !== 'supervision') {
          return {
            reply: 'I will supervise this Project.',
            session: codexSession('project-session'),
          }
        }
        supervisionCalls += 1
        return {
          reply:
            supervisionCalls === 1
              ? 'The Project todo remains in progress.'
              : '<NeedsYou attentionId="A-choice">Choose the release window.</NeedsYou>',
          session: codexSession(`fork-${supervisionCalls}`),
        }
      },
    })

    try {
      await runtime.workspace.receiveEvent({
        eventId: 'EV-user',
        content: 'Track this Project.',
        context: { projectId: 'P-1' },
      })
      await runtime.assistant.process('EV-user')
      await runtime.workspace.createAttention(attention('A-choice', 'Choose the release window.'))
      runtime.coordinator.start()
      await runtime.coordinator.waitForIdle()

      expect(calls).toEqual([
        { mode: 'main', invocation: 'speaking', sessionId: null },
        { mode: 'internal', invocation: 'supervision', sessionId: 'project-session' },
        { mode: 'internal', invocation: 'supervision', sessionId: 'project-session' },
      ])
      const events = [...(await runtime.workspace.readWorkspace()).events.values()]
        .filter((event) => event.attributes.source === 'system')
        .toSorted((left, right) =>
          left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
        )
      expect(events).toHaveLength(2)
      expect(events.every((event) => event.attributes.status === 'handled')).toBe(true)
      expect(events[1]?.attributes.context?.attentionRefs).toHaveLength(1)

      runtime.coordinator.wake()
      await runtime.coordinator.waitForIdle()
      expect(calls).toHaveLength(3)
    } finally {
      await runtime.coordinator.stop()
      await runtime.preview.stopAll()
    }
  })

  test('uses one persistent Project session for user speech and internal supervision', async () => {
    const calls: Array<{ mode: string | undefined; sessionId: string | null }> = []
    const runner: AssistantModelRunner = {
      async run(input) {
        calls.push({ mode: input.toolMode, sessionId: input.session?.sessionId ?? null })
        return {
          reply:
            input.toolMode === 'internal'
              ? '<NeedsYou attentionId="A-choice">Choose the release window.</NeedsYou>'
              : 'I will supervise this Project.',
          session: codexSession('project-session'),
        }
      },
    }
    const runtime = await setupRuntime(runner)

    try {
      await runtime.workspace.receiveEvent({
        eventId: 'EV-user',
        content: 'Track this Project.',
        context: { projectId: 'P-1' },
      })
      await runtime.assistant.process('EV-user')
      await runtime.workspace.createAttention(attention('A-choice', 'Choose the release window.'))

      expect(await runtime.reflection.observe({ settled: false })).toBe('started')
      await runtime.reflection.waitForIdle()
      const wakeEvent = [...(await runtime.workspace.readWorkspace()).events.values()].find(
        (event) => event.attributes.source === 'system',
      )
      if (!wakeEvent) throw new Error('Expected one Project wake event')
      await runtime.assistant.process(wakeEvent.attributes.id)

      expect(calls).toEqual([
        { mode: 'main', sessionId: null },
        { mode: 'internal', sessionId: 'project-session' },
      ])
      expect(
        (await runtime.workspace.readEvent(wakeEvent.attributes.id))?.attributes,
      ).toMatchObject({
        visibility: 'public',
        status: 'handled',
        reply: '<NeedsYou attentionId="A-choice">Choose the release window.</NeedsYou>',
      })
    } finally {
      await runtime.coordinator.stop()
      await runtime.preview.stopAll()
    }
  })

  test('delivers a confirmed supervision tool effect to the next speaking turn', async () => {
    let runtime: MvpRuntime | null = null
    let receiptPrompt = ''
    const runner: AssistantModelRunner = {
      async run(input) {
        if (input.invocation === 'supervision') {
          if (!runtime) throw new Error('Runtime is not bound')
          const preference = (await runtime.workspace.readWorkspace()).preference
          await runtime.assistantTools.execute(input.toolToken, 'hopi_write_preferences', {
            content: '# Preferences\n\n- Prefer concise status updates.\n',
            expectedDigest: preference.digest,
          })
          return { reply: '', session: codexSession('fork-session') }
        }
        if (input.eventId === 'EV-user-receipt') receiptPrompt = input.prompt
        return {
          reply: 'Speaking turn complete.',
          session: codexSession('project-session'),
        }
      },
    }
    runtime = await setupRuntime(runner)

    try {
      await runtime.workspace.receiveEvent({
        eventId: 'EV-user-bootstrap',
        content: 'Track this Project.',
        context: { projectId: 'P-1' },
      })
      await runtime.assistant.process('EV-user-bootstrap')
      await runtime.workspace.receiveSystemEvent({
        eventId: 'EV-supervision-tool',
        content: 'A Project preference needs correction.',
        context: { projectId: 'P-1' },
      })
      await runtime.assistant.process('EV-supervision-tool')

      const scope = { kind: 'project', projectId: 'P-1' } as const
      expect(await runtime.assistantConversation.readPendingActionReceipts(scope)).toMatchObject([
        {
          eventId: 'EV-supervision-tool',
          kind: 'tool',
          summary: expect.stringContaining('hopi_write_preferences'),
        },
      ])

      await runtime.workspace.receiveEvent({
        eventId: 'EV-user-receipt',
        content: 'What changed?',
        context: { projectId: 'P-1' },
      })
      await runtime.assistant.process('EV-user-receipt')

      expect(receiptPrompt).toContain('Confirmed actions completed by supervision forks')
      expect(receiptPrompt).toContain('hopi_write_preferences')
      expect(await runtime.assistantConversation.readPendingActionReceipts(scope)).toEqual([])
    } finally {
      await runtime.coordinator.stop()
      await runtime.preview.stopAll()
    }
  })

  test('keeps user replies and Attention resolution as separate Assistant judgments', async () => {
    const runtime = await setupRuntime({
      async run() {
        return { reply: 'I recorded your answer.', session: codexSession('project-session') }
      },
    })

    try {
      await runtime.workspace.createAttention(attention('A-choice', 'Choose A or B.'))
      const homeId = (await runtime.workspace.readWorkspace()).homeId
      await runtime.workspace.receiveEvent({
        eventId: 'EV-answer',
        content: 'Choose B.',
        context: {
          projectId: 'P-1',
          attentionRefs: [`home:${homeId}/attention:A-choice`],
        },
      })
      await runtime.assistant.process('EV-answer')
      expect(
        (await runtime.workspace.readWorkspace()).attentions.get('A-choice')?.attributes.resolvedAt,
      ).toBeNull()

      await runtime.workspace.receiveEvent({
        eventId: 'EV-settle',
        content: 'Apply the recorded choice.',
        context: { projectId: 'P-1' },
      })
      await runtime.assistantTools.executeForEvent('EV-settle', 'hopi_manage_attention', {
        projectId: 'P-1',
        change: {
          kind: 'resolve',
          attentionId: 'A-choice',
          resolution: 'Choice B was applied.',
        },
      })
      expect(
        (await runtime.workspace.readWorkspace()).attentions.get('A-choice')?.attributes.resolvedAt,
      ).not.toBeNull()
    } finally {
      await runtime.coordinator.stop()
      await runtime.preview.stopAll()
    }
  })
})

async function setupRuntime(assistantRunner: AssistantModelRunner): Promise<MvpRuntime> {
  const repoRoot = join(temporaryRoot, 'repo')
  const homeRoot = join(temporaryRoot, 'home')
  await initializeGitRepo(repoRoot)
  const home = createAssistantHomeStore(homeRoot, new PublicationCoordinator())
  await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  return createMvpRuntime({
    homeRoot,
    assistantRunner,
    start: false,
  })
}

function attention(id: string, body: string): WorkspaceAttentionDocument {
  const timestamp = '2026-07-25T00:00:00.000Z'
  return {
    attributes: {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      resolvedAt: null,
      refs: ['project:P-1'],
      target: 'project:P-1',
      notifiedAt: null,
      operatorRequest: null,
    },
    body: `${body}\n`,
  }
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
}

function codexSession(sessionId: string) {
  return { transport: 'codex' as const, sessionId }
}
