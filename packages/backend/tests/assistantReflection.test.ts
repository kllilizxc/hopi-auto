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
    const seen: Array<{ mode: string | undefined; threadId: string | null }> = []
    const fixture = await setup(
      () => ({ digest }),
      (tools) => ({
        async run(input, observer) {
          seen.push({ mode: input.toolMode, threadId: input.threadId })
          await observer?.onEvent?.({
            kind: 'transcript',
            transport: 'codex',
            entryKind: 'assistant',
            summary: 'Inspecting the latest state change.',
          })
          await tools.execute(input.toolToken, 'hopi_handoff_to_main', {
            brief: 'Work W-1 finished with a failure that needs main-thread assessment.',
          })
          return { reply: 'Reflection complete.', threadId: 'disposable-thread' }
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
    expect(seen).toEqual([{ mode: 'reflection', threadId: null }])
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
          return { reply: 'No handoff.', threadId: 'reflection-delta' }
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
          target: 'project:P-1',
          resolvedAt: null,
          notifiedAt: null,
          body: 'Coordinator needs safe repair.',
        },
      ],
      projects: [
        {
          projectId: 'P-1',
          available: false,
          goals: [],
          design: 'UNRELATED-DESIGN-BODY'.repeat(10_000),
        },
      ],
    }
    expect(await fixture.reflection.observe({ settled: false })).toBe('started')
    await fixture.reflection.waitForIdle()

    expect(prompt).toContain('## Trigger')
    expect(prompt).toContain('Unnotified workspace Attention A-1')
    expect(prompt).toContain('## Changed Facts Since Last Assessment')
    expect(prompt).toContain('whether operator action is required')
    expect(prompt).toContain('translate only the useful outcome and required action')
    expect(prompt).toContain('User: Keep public context.')
    expect(prompt).not.toContain('INTERNAL-BRIEF-MUST-NOT-RECUR')
    expect(prompt).not.toContain('UNRELATED-DESIGN-BODY')
    expect(prompt.length).toBeLessThan(30_000)
  })

  test('does not assess an interrupted digest and retries it from a fresh Run', async () => {
    let digest = 'a'.repeat(64)
    let calls = 0
    const fixture = await setup(
      () => ({ digest }),
      () => ({
        async run(input) {
          calls += 1
          if (calls === 1 && !input.signal?.aborted) {
            await new Promise<void>((resolve) =>
              input.signal?.addEventListener('abort', () => resolve(), { once: true }),
            )
          }
          return { reply: 'No handoff.', threadId: `reflection-${calls}` }
        },
      }),
    )

    expect(await fixture.reflection.observe({ settled: true })).toBe('baseline')
    digest = 'c'.repeat(64)
    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    fixture.reflection.interruptForUser()
    await fixture.reflection.waitForIdle()
    expect(fixture.reflection.isActive()).toBe(false)

    expect(await fixture.reflection.observe({ settled: true })).toBe('started')
    await fixture.reflection.waitForIdle()
    expect(calls).toBe(2)
  })

  test('defers ordinary changes without assessing them, then runs the same digest when settled', async () => {
    let digest = 'a'.repeat(64)
    let calls = 0
    const fixture = await setup(
      () => ({ digest }),
      () => ({
        async run() {
          calls += 1
          return { reply: 'No handoff.', threadId: `reflection-${calls}` }
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

  test('starts unsettled snapshots only for immediate signals, including after startup', async () => {
    let state: TestState = { digest: 'a'.repeat(64) }
    let calls = 0
    const fixture = await setup(
      () => state,
      () => ({
        async run() {
          calls += 1
          return { reply: 'Assessed.', threadId: `reflection-${calls}` }
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
    expect(await fixture.reflection.observe({ settled: false })).toBe('deferred')
    expect(calls).toBe(4)
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
) {
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(temporaryRoot, publisher)
  await home.initialize()
  const workspace = createAssistantWorkspaceStore(temporaryRoot, publisher)
  const state: AssistantStateReader = {
    async read() {
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
    workspace,
    projects: new Map(),
    publisher,
    preview: createPreviewManager(temporaryRoot),
    state,
  })
  const reflection = createAssistantReflection({
    homeRoot: temporaryRoot,
    workspace,
    state,
    tools,
    runner: buildRunner(tools),
    resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    minObserveIntervalMs: 0,
  })
  return { workspace, tools, reflection }
}
