import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantReflection } from '../src/assistant/assistantReflection'
import type { AssistantStateReader, AssistantStateSnapshot } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import type { AssistantModelRunner } from '../src/assistant/workspaceAssistant'
import { PublicationCoordinator } from '../src/publication/publisher'
import { createPreviewManager } from '../src/runtime/previewManager'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'assistant-reflection')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('Assistant Reflection', () => {
  test('establishes a baseline and hands useful state changes to the speaking thread', async () => {
    let digest = 'a'.repeat(64)
    const seen: Array<{ mode: string | undefined; sessionId: string | null }> = []
    const fixture = await setup(
      () => ({ digest }),
      (tools) => ({
        async run(input, observer) {
          seen.push({ mode: input.toolMode, sessionId: input.session?.sessionId ?? null })
          await observer?.onEvent?.({
            kind: 'transcript',
            transport: 'codex',
            entryKind: 'assistant',
            summary: 'Inspecting the latest state change.',
          })
          await tools.execute(input.toolToken, 'hopi_handoff_to_main', {
            brief: 'Work W-1 finished with a failure that needs main-thread assessment.',
          })
          return { reply: 'Reflection complete.', session: codexSession('disposable-thread') }
        },
      }),
    )

    expect(await fixture.reflection.observe({ settled: true })).toBe('baseline')
    expect(seen).toHaveLength(0)
    digest = 'b'.repeat(64)
    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    await fixture.reflection.waitForIdle()

    const events = [...(await fixture.workspace.readWorkspace()).events.values()]
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'internal',
      status: 'pending',
    })
    expect(seen).toEqual([{ mode: 'reflection', sessionId: null }])
    expect(await fixture.reflection.listRuns()).toMatchObject([
      {
        manifest: { status: 'completed', stateDigest: 'b'.repeat(64) },
        events: [{ entryKind: 'assistant', summary: 'Inspecting the latest state change.' }],
      },
    ])
    expect(await fixture.reflection.observe({ settled: true })).toBe('unchanged')
  })

  test('prompts from a semantic delta without feeding internal Reflection history back', async () => {
    let state: TestState = { digest: 'a'.repeat(64) }
    let prompt = ''
    const fixture = await setup(
      () => state,
      () => ({
        async run(input) {
          prompt = input.prompt
          return { reply: 'No handoff.', session: codexSession('reflection-delta') }
        },
      }),
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-user', content: 'Keep public context.' })
    await fixture.workspace.handleEvent('EV-user', {
      reply: 'Public reply.',
      disposition: 'answered',
    })
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal',
      content: 'INTERNAL-BRIEF-MUST-NOT-RECUR',
    })
    await fixture.workspace.handleEvent('EV-internal', {
      reply: 'Hidden internal outcome.',
      disposition: 'answered',
    })

    expect(await fixture.reflection.observe({ settled: true })).toBe('baseline')
    state = {
      digest: 'b'.repeat(64),
      workspaceAttentions: [
        {
          id: 'A-1',
          target: 'home:H-1/event:EV-blocked',
          resolvedAt: null,
          notifiedAt: null,
          body: 'Coordinator needs safe repair.',
        },
      ],
      projects: [
        {
          projectId: 'P-1',
          available: false,
          goals: [
            {
              goal: {
                attributes: {
                  id: 'G-1',
                  title: 'Compact delta',
                  lifecycle: 'active',
                  contractRevision: 1,
                },
              },
              works: [
                {
                  attributes: {
                    id: 'W-1',
                    title: 'Verify compaction',
                    kind: 'engineering',
                    stage: 'review',
                    notBefore: null,
                    dependsOn: [],
                    contractRevision: 1,
                    attempts: 1,
                    evidenceRefs: ['E-1', 'E-2'],
                  },
                  projection: { column: 'Review', ready: true, responsibility: 'reviewer' },
                  runtime: {
                    activeResponsibility: null,
                    latestAttempt: {
                      runId: 'R-1',
                      responsibility: 'generator',
                      status: 'finished',
                      result: 'success',
                      summary: 'Candidate implementation completed.',
                    },
                    paths: { transcript: 'SECRET-RUNTIME-PATH' },
                    stale: false,
                  },
                },
              ],
              attentions: [],
            },
          ],
          design: 'UNRELATED-DESIGN-BODY'.repeat(10_000),
        },
      ],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    expect(prompt).toContain('## Trigger')
    expect(prompt).toContain('Assistant-owned workspace Attention A-1')
    expect(prompt).toContain('targeting home:H-1/event:EV-blocked')
    expect(prompt).toContain('## Changed Facts Since Last Assessment')
    expect(prompt).toContain('whether operator action is required')
    expect(prompt).toContain('restore an event-target Workspace Attention first')
    expect(prompt).toContain('operator action is required only when human input')
    expect(prompt).toContain('useful outcome or required action')
    expect(prompt).not.toContain('User: Keep public context.')
    expect(prompt).not.toContain('## Recent Public Conversation')
    expect(prompt).not.toContain('## Relevant Current State')
    expect(prompt).not.toContain('INTERNAL-BRIEF-MUST-NOT-RECUR')
    expect(prompt).not.toContain('UNRELATED-DESIGN-BODY')
    expect(prompt).toContain('"evidenceCount":2')
    expect(prompt).toContain('"latestEvidenceRef":"E-2"')
    expect(prompt).toContain('Candidate implementation completed.')
    expect(prompt).not.toContain('"evidenceRefs"')
    expect(prompt).not.toContain('SECRET-RUNTIME-PATH')
    expect(prompt.length).toBeLessThan(5_000)
  })

  test('does not interrupt for a newer state and discards the stale handoff before rerunning', async () => {
    let digest = 'a'.repeat(64)
    let calls = 0
    let releaseFirst: (() => void) | undefined
    const fixture = await setup(
      () => ({ digest }),
      (tools) => ({
        async run(input) {
          calls += 1
          await tools.execute(input.toolToken, 'hopi_handoff_to_main', {
            brief: `Assessment ${calls}.`,
          })
          if (calls === 1) {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          }
          return { reply: 'Handoff prepared.', session: codexSession(`reflection-${calls}`) }
        },
      }),
    )

    expect(await fixture.reflection.observe({ settled: true })).toBe('baseline')
    digest = 'c'.repeat(64)
    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    digest = 'd'.repeat(64)
    expect(await fixture.reflection.observe({ settled: true })).toBe('running')
    while (!releaseFirst) await Bun.sleep(1)
    releaseFirst?.()
    await fixture.reflection.waitForIdle()
    expect(fixture.reflection.isActive()).toBe(false)
    expect([...(await fixture.workspace.readWorkspace()).events.values()]).toHaveLength(0)

    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(2)
    expect([...(await fixture.workspace.readWorkspace()).events.values()]).toHaveLength(1)
  })

  test('defers ordinary changes without assessing them, then runs the same digest when settled', async () => {
    let digest = 'a'.repeat(64)
    let calls = 0
    const fixture = await setup(
      () => ({ digest }),
      () => ({
        async run() {
          calls += 1
          return { reply: 'No handoff.', session: codexSession(`reflection-${calls}`) }
        },
      }),
    )

    expect(await fixture.reflection.observe({ settled: true })).toBe('baseline')
    digest = 'b'.repeat(64)
    expect(await fixture.reflection.observe({ settled: false })).toBe('deferred')
    expect(calls).toBe(0)

    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(1)
    expect(await fixture.reflection.observe({ settled: true })).toBe('unchanged')
  })

  test('keeps transport backoff across semantic changes and probes at the capped interval', async () => {
    let clock = 0
    let digest = 'f'.repeat(64)
    let calls = 0
    const fixture = await setup(
      () => ({
        digest,
        workspaceAttentions: [{ id: 'A-workspace', resolvedAt: null, notifiedAt: null }],
      }),
      () => ({
        async run() {
          calls += 1
          if (calls <= 3) throw new Error('temporary model failure')
          return { reply: 'Recovered.', session: codexSession(`reflection-${calls}`) }
        },
      }),
      {
        now: () => new Date(clock),
        failureRetryBaseMs: 100,
        failureRetryMaxMs: 1_000,
        failuresBeforeMaxBackoff: 3,
      },
    )

    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    digest = 'e'.repeat(64)
    clock = 99
    expect(await fixture.reflection.observe({ settled: false })).toBe('unchanged')
    clock = 100
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    digest = 'd'.repeat(64)
    clock = 299
    expect(await fixture.reflection.observe({ settled: false })).toBe('unchanged')
    clock = 300
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    digest = 'c'.repeat(64)
    clock = 1_299
    expect(await fixture.reflection.observe({ settled: false })).toBe('unchanged')
    expect(calls).toBe(3)

    clock = 1_300
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(4)
    expect(await fixture.reflection.observe({ settled: false })).toBe('unchanged')
  })

  test('forces Reflection state reads to use the compact Evidence view', async () => {
    const digest = 'f'.repeat(64)
    const fixture = await setup(
      () => ({
        digest,
        workspaceAttentions: [{ id: 'A-workspace', resolvedAt: null, notifiedAt: null }],
      }),
      (tools) => ({
        async run(input) {
          await tools.execute(input.toolToken, 'hopi_read_state', {
            projectId: 'P-1',
            goalId: 'G-1',
            includeEvidence: true,
          })
          return { reply: 'No handoff.', session: codexSession('reflection-compact-state') }
        },
      }),
    )

    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(fixture.stateReads).toContainEqual({
      projectId: 'P-1',
      goalId: 'G-1',
      includeEvidence: false,
    })
  })

  test('bounds a consecutive handoff chain while its predecessors remain unhandled', async () => {
    let digest = 'a'.repeat(64)
    const exhausted: Array<{ eventId: string; message: string }> = []
    const fixture = await setup(
      () => ({
        digest,
        workspaceAttentions: [{ id: 'A-workspace', resolvedAt: null, notifiedAt: null }],
      }),
      (tools) => ({
        async run(input) {
          await tools.execute(input.toolToken, 'hopi_handoff_to_main', {
            brief: `Assessment for ${digest.slice(0, 1)}.`,
          })
          return { reply: 'Handoff prepared.', session: codexSession(`reflection-${digest[0]}`) }
        },
      }),
      {
        maxConsecutiveHandoffs: 3,
        onLoopExhausted: async (eventId, message) => {
          exhausted.push({ eventId, message })
        },
      },
    )

    for (const marker of ['a', 'b', 'c']) {
      digest = marker.repeat(64)
      expect(await fixture.reflection.observe({ settled: false })).toBe('started')
      await fixture.reflection.waitForIdle()
    }

    const events = [...(await fixture.workspace.readWorkspace()).events.values()]
    expect(events).toHaveLength(3)
    expect(exhausted).toHaveLength(1)
    expect(events.map((event) => event.attributes.id)).toContain(exhausted[0]?.eventId ?? '')
    expect(exhausted[0]?.message).toBe(
      'Background Reflection handed off 3 consecutive state changes without converging.',
    )
  })

  test('treats each handled speaking handoff as convergence for loop detection', async () => {
    let digest = 'a'.repeat(64)
    const exhausted: string[] = []
    const fixture = await setup(
      () => ({
        digest,
        workspaceAttentions: [{ id: 'A-workspace', resolvedAt: null, notifiedAt: null }],
      }),
      (tools) => ({
        async run(input) {
          await tools.execute(input.toolToken, 'hopi_handoff_to_main', {
            brief: `Assessment for ${digest.slice(0, 1)}.`,
          })
          return { reply: 'Handoff prepared.', session: codexSession(`reflection-${digest[0]}`) }
        },
      }),
      {
        maxConsecutiveHandoffs: 3,
        onLoopExhausted: async (eventId) => {
          exhausted.push(eventId)
        },
      },
    )

    for (const marker of ['a', 'b', 'c', 'd']) {
      digest = marker.repeat(64)
      expect(await fixture.reflection.observe({ settled: false })).toBe('started')
      await fixture.reflection.waitForIdle()
      const event = [...(await fixture.workspace.readWorkspace()).events.values()].find(
        (candidate) => candidate.attributes.status === 'pending',
      )
      expect(event).toBeDefined()
      await fixture.workspace.handleEvent(event?.attributes.id ?? 'missing-event', {
        reply: 'Speaking Assistant revalidated the current state.',
        disposition: 'answered',
      })
    }

    expect(exhausted).toEqual([])
  })

  test('creates a Goal-scoped fallback with exact Attention references when the model omits handoff', async () => {
    const fixture = await setup(
      () => ({
        digest: 'a'.repeat(64),
        projects: [
          {
            projectId: 'P-1',
            available: true,
            goals: [
              {
                goal: { attributes: { id: 'G-1' } },
                attentions: [
                  { attributes: { id: 'A-1', resolvedAt: null, notifiedAt: null } },
                  { attributes: { id: 'A-2', resolvedAt: null, notifiedAt: null } },
                ],
                works: [],
              },
            ],
          },
        ],
      }),
      () => ({
        async run() {
          return { reply: 'No handoff.', session: codexSession('reflection-no-handoff') }
        },
      }),
      { linkProject: true },
    )

    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    const events = [...(await fixture.workspace.readWorkspace()).events.values()]
    expect(events).toHaveLength(1)
    expect(events[0]?.attributes.context).toMatchObject({
      projectId: 'P-1',
      goalId: 'G-1',
      attentionRefs: ['project:P-1/goal:G-1/attention:A-1', 'project:P-1/goal:G-1/attention:A-2'],
      observedDigest: 'a'.repeat(64),
    })
    expect(events[0]?.body).toContain('Assistant-owned Attention remains open')
  })

  test('starts unsettled snapshots only for immediate signals, including after startup', async () => {
    let state: TestState = { digest: 'a'.repeat(64) }
    let calls = 0
    const fixture = await setup(
      () => state,
      () => ({
        async run() {
          calls += 1
          return { reply: 'Assessed.', session: codexSession(`reflection-${calls}`) }
        },
      }),
    )

    state = {
      digest: 'b'.repeat(64),
      workspaceAttentions: [{ resolvedAt: null, notifiedAt: null }],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    state = {
      digest: 'c'.repeat(64),
      projects: [
        {
          available: true,
          goals: [
            {
              attentions: [{ attributes: { resolvedAt: null, notifiedAt: null } }],
              works: [],
            },
          ],
        },
      ],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    state = {
      digest: 'd'.repeat(64),
      projects: [{ available: false, goals: [] }],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    state = {
      digest: 'e'.repeat(64),
      projects: [
        {
          available: true,
          goals: [{ attentions: [], works: [{ runtime: { stale: true } }] }],
        },
      ],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(4)

    state = {
      digest: 'f'.repeat(64),
      workspaceAttentions: [{ resolvedAt: null, notifiedAt: '2026-07-11T00:00:00.000Z' }],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(5)

    state = {
      digest: '1'.repeat(64),
      workspaceAttentions: [
        {
          resolvedAt: null,
          notifiedAt: '2026-07-11T00:00:00.000Z',
          operatorRequest: 'home:H-1/event:EV-request',
        },
      ],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('deferred')
    expect(calls).toBe(5)
  })
})

interface TestState {
  digest: string
  workspaceAttentions?: unknown[]
  projects?: unknown[]
}

async function setup(
  readState: () => TestState,
  buildRunner: (tools: ReturnType<typeof createAssistantTools>) => AssistantModelRunner,
  reflectionOptions: {
    now?: () => Date
    failureRetryBaseMs?: number
    failureRetryMaxMs?: number
    failuresBeforeMaxBackoff?: number
    maxConsecutiveHandoffs?: number
    onLoopExhausted?(eventId: string, message: string): Promise<void> | void
    linkProject?: boolean
  } = {},
) {
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(temporaryRoot, publisher)
  await home.initialize()
  if (reflectionOptions.linkProject) {
    const repoRoot = join(temporaryRoot, 'repo')
    await mkdir(repoRoot, { recursive: true })
    await git(repoRoot, ['init', '-b', 'main'])
    await git(repoRoot, ['config', 'user.email', 'hopi@example.test'])
    await git(repoRoot, ['config', 'user.name', 'HOPI Test'])
    await Bun.write(join(repoRoot, 'README.md'), '# Repo\n')
    await git(repoRoot, ['add', '.'])
    await git(repoRoot, ['commit', '-m', 'initial'])
    await home.linkProject({ projectId: 'P-1', repoPath: repoRoot })
  }
  const workspace = createAssistantWorkspaceStore(temporaryRoot, publisher)
  const stateReads: Array<{ projectId?: string; goalId?: string; includeEvidence?: boolean }> = []
  const state: AssistantStateReader = {
    async read(input = {}) {
      stateReads.push(input)
      const current = readState()
      return {
        observedAt: '2026-07-11T00:00:00.000Z',
        stateDigest: current.digest,
        activeRuns: [],
        workspaceAttentions: current.workspaceAttentions ?? [],
        projects: current.projects ?? [],
      } satisfies AssistantStateSnapshot
    },
  }
  const tools = createAssistantTools({
    home,
    workspace,
    projects: new Map(),
    publisher,
    preview: createPreviewManager(temporaryRoot),
    state,
    readAssistantCodingDefaults: async () => ({
      codingDefaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
      inherited: true,
    }),
    readProjectCodingDefaults: async () => ({
      codingDefaults: { transport: 'codex', model: 'gpt-5.4', reasoningEffort: 'xhigh' },
      inherited: true,
    }),
    updateAssistantCodingDefaultsForTurn: async () => undefined,
  })
  const reflection = createAssistantReflection({
    homeRoot: temporaryRoot,
    workspace,
    state,
    tools,
    runner: buildRunner(tools),
    resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    minObserveIntervalMs: 0,
    ...(reflectionOptions.now ? { now: reflectionOptions.now } : {}),
    ...(reflectionOptions.failureRetryBaseMs !== undefined
      ? { failureRetryBaseMs: reflectionOptions.failureRetryBaseMs }
      : {}),
    ...(reflectionOptions.failureRetryMaxMs !== undefined
      ? { failureRetryMaxMs: reflectionOptions.failureRetryMaxMs }
      : {}),
    ...(reflectionOptions.failuresBeforeMaxBackoff !== undefined
      ? { failuresBeforeMaxBackoff: reflectionOptions.failuresBeforeMaxBackoff }
      : {}),
    ...(reflectionOptions.maxConsecutiveHandoffs !== undefined
      ? { maxConsecutiveHandoffs: reflectionOptions.maxConsecutiveHandoffs }
      : {}),
    ...(reflectionOptions.onLoopExhausted
      ? { onLoopExhausted: reflectionOptions.onLoopExhausted }
      : {}),
  })
  return { workspace, tools, reflection, stateReads }
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
  if (exitCode !== 0) throw new Error(stderr)
}

function codexSession(sessionId: string) {
  return { transport: 'codex' as const, sessionId }
}
