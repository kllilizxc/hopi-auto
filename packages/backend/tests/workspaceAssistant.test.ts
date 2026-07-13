import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'
import { createAssistantStateReader } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import {
  type AssistantModelRunner,
  createConfiguredAssistantModelRunner,
  createWorkspaceAssistant,
} from '../src/assistant/workspaceAssistant'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { createGoalController } from '../src/runtime/goalController'
import { createPreviewManager } from '../src/runtime/previewManager'
import { createRunAttemptStore } from '../src/runtime/runAttemptStore'
import { createAssistantHomeStore } from '../src/storage/assistantHomeStore'
import { createAssistantWorkspaceStore } from '../src/storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../src/storage/goalPackageStore'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'workspace-assistant')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('WorkspaceAssistant conversation', () => {
  test('rejects a non-Codex speaking transport instead of fabricating a thread', async () => {
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        permissionMode: 'dontAsk',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await expect(
      runner.run({
        eventId: 'EV-claude',
        prompt: 'Hello.',
        threadId: null,
        cwd: join(temporaryRoot, 'assistant-claude'),
        lastMessageFile: join(temporaryRoot, 'assistant-claude', 'last-message.txt'),
        transcriptFile: join(temporaryRoot, 'assistant-claude', 'transcript.log'),
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: 'token',
      }),
    ).rejects.toThrow('Workspace Assistant requires Codex transport')
  })

  test('terminates a configured Codex subprocess when its signal is aborted', async () => {
    const binary = join(temporaryRoot, 'fake-codex')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'console.log(JSON.stringify({type:"thread.started",thread_id:"thread-abort"}))',
        'await Bun.sleep(30_000)',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'codex',
        cwdMode: 'root',
        binary,
        sandbox: 'read-only',
        approvalPolicy: 'never',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })
    const controller = new AbortController()
    const run = runner.run({
      eventId: 'RF-1',
      prompt: 'Reflect.',
      threadId: null,
      cwd: join(temporaryRoot, 'reflection'),
      lastMessageFile: join(temporaryRoot, 'reflection', 'last-message.txt'),
      transcriptFile: join(temporaryRoot, 'reflection', 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'reflection-token',
      toolMode: 'reflection',
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)

    await expect(run).rejects.toThrow('interrupted')
  })

  test('passes images to a resumed configured Codex conversation', async () => {
    const binary = join(temporaryRoot, 'fake-codex-image')
    const argsFile = join(temporaryRoot, 'codex-args.json')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))`,
        'const outputIndex = process.argv.indexOf("-o")',
        'await Bun.write(process.argv[outputIndex + 1], "Image received.")',
        'console.log(JSON.stringify({type:"thread.started",thread_id:"thread-image"}))',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const imagePath = join(temporaryRoot, 'reference.png')
    await Bun.write(imagePath, pngBytes())
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'codex',
        cwdMode: 'root',
        binary,
        sandbox: 'read-only',
        approvalPolicy: 'never',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await runner.run({
      eventId: 'EV-image',
      prompt: 'Inspect the image.',
      threadId: 'thread-existing',
      cwd: join(temporaryRoot, 'assistant-image'),
      lastMessageFile: join(temporaryRoot, 'assistant-image', 'last-message.txt'),
      transcriptFile: join(temporaryRoot, 'assistant-image', 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'image-token',
      imageFiles: [imagePath],
    })

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    expect(args).toContain('resume')
    expect(args.slice(args.indexOf('resume'))).toContain('-i')
    expect(args).toContain(imagePath)
  })

  test('attaches current Inbox images and names their durable references in the prompt', async () => {
    const seen: Array<{ prompt: string; imageFiles: string[] }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({ prompt: input.prompt, imageFiles: input.imageFiles ?? [] })
        await observer?.onThreadId?.('thread-image')
        return { reply: 'I can see the reference.', threadId: 'thread-image' }
      },
    }))
    const event = await fixture.workspace.receiveEvent({
      eventId: 'EV-image',
      content: 'Use this screenshot.',
      images: [new File([pngBytes()], 'layout.png', { type: 'image/png' })],
    })

    await fixture.assistant.process('EV-image')

    expect(seen[0]?.imageFiles).toHaveLength(1)
    expect(await Bun.file(seen[0]?.imageFiles[0] ?? '').exists()).toBe(true)
    expect(seen[0]?.prompt).toContain(event.attributes.attachments[0] ?? 'missing-reference')
    expect(seen[0]?.prompt).toContain('use these exact references in HOPI tool calls')
  })

  test('answers a contextual greeting without creating Goal effects', async () => {
    const seen: Array<{ threadId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({ threadId: input.threadId, prompt: input.prompt })
        await observer?.onThreadId?.('thread-1')
        await observer?.onEvent?.({
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'assistant',
          summary: '你好。',
        })
        return { reply: '你好。', threadId: 'thread-1' }
      },
    }))
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await finishInitialPlanning(fixture.goalStore, 'G-1')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-1',
      content: 'hi',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    expect(await fixture.assistant.process('EV-1')).toEqual({ kind: 'answered', eventId: 'EV-1' })

    const event = await fixture.workspace.readEvent('EV-1')
    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect(event?.attributes).toMatchObject({
      status: 'handled',
      context: { projectId: 'P-1', goalId: 'G-1' },
      reply: '你好。',
      disposition: 'answered',
    })
    expect(event?.attributes.routeClaim).toBeUndefined()
    expect(goalPackage.inputs).toHaveLength(0)
    expect(
      [...goalPackage.works.values()].filter((work) => work.attributes.stage === 'plan'),
    ).toHaveLength(0)
    expect(seen[0]?.threadId).toBeNull()
    expect(seen[0]?.prompt).toContain('[Preferred page context: P-1 / G-1]')
    expect(seen[0]?.prompt).toContain(
      'explicit user intent may select another Goal, create a new Goal, or stay at Workspace scope',
    )
    expect(seen[0]?.prompt).toContain('reply without sleeping or polling')
    expect(seen[0]?.prompt).toContain(
      'MCP tool descriptions and JSON schemas are the sole authority',
    )
    expect(seen[0]?.prompt).toContain('never search project files, .hopi/runtime, transcripts')
    expect(seen[0]?.prompt).toContain('[Operator-facing reply contract]')
    expect(seen[0]?.prompt).toContain('Default to one or two short sentences')
    expect(seen[0]?.prompt).toContain('Omit internal IDs')
    expect((await fixture.conversation.readTurn('EV-1'))?.manifest.status).toBe('completed')
  })

  test('resumes one persistent Codex thread for later turns', async () => {
    const threadIds: Array<string | null> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        threadIds.push(input.threadId)
        await observer?.onThreadId?.('thread-1')
        return { reply: `reply-${threadIds.length}`, threadId: 'thread-1' }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'First' })
    await fixture.assistant.process('EV-1')
    await fixture.workspace.receiveEvent({ eventId: 'EV-2', content: 'Second' })
    await fixture.assistant.process('EV-2')

    expect(threadIds).toEqual([null, 'thread-1'])
    expect((await fixture.workspace.readEvent('EV-2'))?.attributes.reply).toBe('reply-2')
  })

  test('records tool use without claiming that an effect was applied', async () => {
    const fixture = await setup(() => ({
      async run(_input, observer) {
        await observer?.onEvent?.({
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'tool_call',
          summary: 'Tool call: hopi_read_state',
          toolName: 'hopi_read_state',
        })
        return { reply: 'No decision is needed.', threadId: 'thread-1' }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Do I need to decide?' })

    await fixture.assistant.process('EV-1')

    expect((await fixture.workspace.readEvent('EV-1'))?.attributes.disposition).toBe('tools-used')
  })

  test('rebuilds a missing vendor thread from durable conversation history', async () => {
    const calls: Array<{ threadId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        calls.push({ threadId: input.threadId, prompt: input.prompt })
        if (input.threadId) throw new Error('session not found')
        await observer?.onThreadId?.('thread-rebuilt')
        return { reply: 'Recovered.', threadId: 'thread-rebuilt' }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-old', content: 'Old turn' })
    await fixture.workspace.handleEvent('EV-old', {
      reply: 'Old reply',
      disposition: 'answered',
    })
    await fixture.conversation.writeThreadId('missing-thread')
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Continue' })

    await fixture.assistant.process('EV-1')

    expect(calls.map((call) => call.threadId)).toEqual(['missing-thread', null])
    expect(calls[1]?.prompt).toContain('User: Old turn')
    expect(calls[1]?.prompt).toContain('Assistant: Old reply')
    expect(await fixture.conversation.readThreadId()).toBe('thread-rebuilt')
  })

  test('rebuilds from bounded public history without internal Reflection briefs', async () => {
    let prompt = ''
    const fixture = await setup(() => ({
      async run(input, observer) {
        prompt = input.prompt
        await observer?.onThreadId?.('thread-bounded')
        return { reply: 'Current reply.', threadId: 'thread-bounded' }
      },
    }))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-old',
      content: `OLD-HISTORY-${'x'.repeat(10_000)}`,
    })
    await fixture.workspace.handleEvent('EV-old', {
      reply: 'Old reply.',
      disposition: 'answered',
    })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-new',
      content: `NEW-HISTORY-${'y'.repeat(10_000)}`,
    })
    await fixture.workspace.handleEvent('EV-new', {
      reply: 'New reply.',
      disposition: 'answered',
    })
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-internal',
      content: 'INTERNAL-BRIEF-MUST-NOT-REBUILD',
    })
    await fixture.workspace.handleEvent('EV-internal', {
      reply: 'Hidden outcome.',
      disposition: 'answered',
    })
    await fixture.workspace.receiveEvent({ eventId: 'EV-current', content: 'Current turn.' })

    await fixture.assistant.process('EV-current')

    expect(prompt).toContain('NEW-HISTORY-')
    expect(prompt).not.toContain('OLD-HISTORY-')
    expect(prompt).not.toContain('INTERNAL-BRIEF-MUST-NOT-REBUILD')
    expect(prompt).toContain('Before admission, ask only when')
  })

  test('keeps a failed turn pending with visible runtime failure', async () => {
    const fixture = await setup(() => ({
      async run() {
        throw new Error('model unavailable')
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Hello' })

    await expect(fixture.assistant.process('EV-1')).rejects.toThrow('model unavailable')

    expect((await fixture.workspace.readEvent('EV-1'))?.attributes.status).toBe('pending')
    const turn = await fixture.conversation.readTurn('EV-1')
    expect(turn?.manifest).toMatchObject({ status: 'failed', error: 'model unavailable' })
    expect(turn?.events.some((event) => event.kind === 'message' && event.level === 'error')).toBe(
      true,
    )
  })

  test('processes a Reflection brief in the main thread without treating it as user speech', async () => {
    const prompts: string[] = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        prompts.push(input.prompt)
        await observer?.onThreadId?.('thread-1')
        return { reply: 'No operator interruption is needed.', threadId: 'thread-1' }
      },
    }))
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-reflection',
      content: 'A Work stage changed; revalidate whether action is useful.',
    })

    await fixture.assistant.process('EV-reflection')

    const event = await fixture.workspace.readEvent('EV-reflection')
    expect(event?.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'internal',
      status: 'handled',
    })
    expect(prompts[0]).toContain('Internal Reflection handoff. This is not operator input.')
    expect(prompts[0]).toContain('Rewrite the internal brief for the operator')
    expect(prompts[0]).not.toContain('User: A Work stage changed')
  })

  test('publishes the complete Reflection reply before acknowledging linked Attention', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        await tools.execute(input.toolToken, 'hopi_notify_user', {})
        return { reply: 'Choose the release window: today or tomorrow?', threadId: 'thread-notify' }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-choice')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-notify',
      content: 'The operator must choose a release window.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
      },
    })

    await fixture.assistant.process('EV-notify')

    expect((await fixture.workspace.readEvent('EV-notify'))?.attributes).toMatchObject({
      source: 'reflection',
      visibility: 'public',
      status: 'handled',
      reply: 'Choose the release window: today or tomorrow?',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-choice')?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })
  })

  test('keeps a Reflection turn internal and Attention unnotified when speech fails', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        await tools.execute(input.toolToken, 'hopi_notify_user', {})
        throw new Error('reply generation failed')
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-failed')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-failed-notify',
      content: 'Prepare an operator question.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-failed'],
      },
    })

    await expect(fixture.assistant.process('EV-failed-notify')).rejects.toThrow(
      'reply generation failed',
    )

    expect((await fixture.workspace.readEvent('EV-failed-notify'))?.attributes).toMatchObject({
      visibility: 'internal',
      status: 'pending',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-failed')?.attributes,
    ).toMatchObject({ notifiedAt: null, resolvedAt: null })
  })

  test('keeps a durable public reply successful when cross-root acknowledgement retries later', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        await tools.execute(input.toolToken, 'hopi_notify_user', {})
        return { reply: 'Choose the release window.', threadId: 'thread-retry-ack' }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-retry-ack')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-retry-ack',
      content: 'Prepare a decision request.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-retry-ack'],
      },
    })
    const acknowledge = fixture.tools.acknowledgeEventAttentions.bind(fixture.tools)
    let failOnce = true
    fixture.tools.acknowledgeEventAttentions = async (...args) => {
      if (failOnce) {
        failOnce = false
        throw new Error('Project root temporarily unavailable')
      }
      return acknowledge(...args)
    }

    await expect(fixture.assistant.process('EV-retry-ack')).resolves.toMatchObject({
      kind: 'answered',
    })
    expect((await fixture.workspace.readEvent('EV-retry-ack'))?.attributes).toMatchObject({
      visibility: 'public',
      status: 'handled',
      reply: 'Choose the release window.',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-retry-ack')?.attributes
        .notifiedAt,
    ).toBeNull()

    expect(await fixture.assistant.finalizeNotifications?.()).toBe(1)
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-retry-ack')?.attributes
        .notifiedAt,
    ).not.toBeNull()
  })

  test('recovers legacy local-ID Attention context from an already handled public reply', async () => {
    const fixture = await setup(() => ({
      async run() {
        throw new Error('the handled event must not rerun')
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-recover')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-recover',
      content: 'Deliver a decision request.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: ['A-recover'] },
    })
    await fixture.workspace.handleEvent('EV-recover', {
      reply: 'Choose the deployment target.',
      disposition: 'tools-used',
      expose: true,
    })

    expect(await fixture.assistant.finalizeNotifications?.()).toBe(1)
    expect(await fixture.assistant.finalizeNotifications?.()).toBe(0)
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-recover')?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })
  })
})

async function setup(
  buildRunner: (tools: ReturnType<typeof createAssistantTools>) => AssistantModelRunner,
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
  const conversation = createAssistantConversationStore(homeRoot, {
    now: () => new Date('2026-07-11T00:00:00Z'),
  })
  const goalStore = createGoalPackageStore(linked.integrationRoot, 'P-1', publisher)
  const controller = createGoalController(goalStore, { verifyCompletion: () => false })
  const preview = createPreviewManager(homeRoot)
  const projects = new Map([
    [
      'P-1',
      {
        projectId: 'P-1',
        projectRoot: linked.integrationRoot,
        store: goalStore,
        controller,
      },
    ],
  ])
  const state = createAssistantStateReader({
    homeRoot,
    workspace,
    projects,
    publisher,
    attempts: createRunAttemptStore(homeRoot),
  })
  const tools = createAssistantTools({
    workspace,
    publisher,
    preview,
    projects,
    state,
  })
  const assistant = createWorkspaceAssistant({
    homeRoot,
    workspace,
    conversation,
    tools,
    runner: buildRunner(tools),
    resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    now: () => new Date('2026-07-11T00:00:00Z'),
  })
  return { homeRoot, workspace, conversation, goalStore, tools, assistant }
}

async function createGoalAttention(
  store: ReturnType<typeof createGoalPackageStore>,
  goalId: string,
  attentionId: string,
) {
  await store.createGoal({ goalId, title: 'Goal', objective: 'Ship it.' })
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.attentionDocument(goalId, attentionId),
      expectedHash: null,
      content: renderAttentionDocument({
        attributes: {
          id: attentionId,
          target: `project:P-1/goal:${goalId}`,
          createdAt: '2026-07-11T00:00:00Z',
          resolvedAt: null,
          notifiedAt: null,
        },
        body: '## Needs you\n\nChoose one option.\n',
      }),
    },
  })
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

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
}
