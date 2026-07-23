import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import type { AssistantTransport } from '../src/agent/vendorAssistantOutput'
import { HOME_ASSISTANT_CONVERSATION_SCOPE } from '../src/assistant/assistantConversationScope'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'
import { createAssistantStateReader } from '../src/assistant/assistantState'
import { createAssistantTools } from '../src/assistant/assistantTools'
import {
  type AssistantModelRunner,
  AssistantSessionUnavailableError,
  WorkspaceAssistantError,
  createConfiguredAssistantModelRunner,
  createWorkspaceAssistant,
  workspaceAssistantContextDigest,
  workspaceAssistantRuntimeDigest,
} from '../src/assistant/workspaceAssistant'
import {
  parseWorkDocument,
  renderAttentionDocument,
  renderWorkDocument,
} from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
import { acknowledgeGoalAttention } from '../src/runtime/attentionDelivery'
import {
  browserEnvironmentRoot,
  browserHarnessAdapterCommand,
} from '../src/runtime/browserEnvironment'
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
  test('exposes browser targets as an Assistant environment without enabling Reflection', async () => {
    const fakeHarness = join(temporaryRoot, 'fake-browser-harness')
    const fakeChrome = join(temporaryRoot, 'fake-chrome')
    await Promise.all([
      Bun.write(fakeHarness, '#!/bin/sh\nexit 0\n'),
      Bun.write(fakeChrome, '#!/bin/sh\nexit 0\n'),
    ])
    await Promise.all([chmod(fakeHarness, 0o755), chmod(fakeChrome, 0o755)])
    const previousHarness = process.env.HOPI_BROWSER_HARNESS_COMMAND
    const previousChrome = process.env.HOPI_BROWSER_CHROME_COMMAND
    process.env.HOPI_BROWSER_HARNESS_COMMAND = fakeHarness
    process.env.HOPI_BROWSER_CHROME_COMMAND = fakeChrome
    try {
      const homeRoot = join(temporaryRoot, 'home')
      const cwd = join(temporaryRoot, 'assistant-browser')
      const runner = createConfiguredAssistantModelRunner({
        homeRoot,
        resolveConfig: () => ({
          transport: 'codex',
          cwdMode: 'root',
          sandbox: 'workspace-write',
          approvalPolicy: 'never',
        }),
        resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
      })
      const main = await runner.prepare?.({ cwd, toolMode: 'main' })
      const reflection = await runner.prepare?.({ cwd, toolMode: 'reflection' })

      expect(main?.browserEnvironment).toEqual({
        command: browserHarnessAdapterCommand(),
        backendCommand: fakeHarness,
        homeRoot,
        targetsFile: join(cwd, 'browser-targets.json'),
        writableRoot: browserEnvironmentRoot(homeRoot),
      })
      expect(main?.environment.writableRoots).toContain(browserEnvironmentRoot(homeRoot))
      expect(reflection?.browserEnvironment).toBeUndefined()
      expect(reflection?.environment.writableRoots).toEqual([])
    } finally {
      restoreEnvironment('HOPI_BROWSER_HARNESS_COMMAND', previousHarness)
      restoreEnvironment('HOPI_BROWSER_CHROME_COMMAND', previousChrome)
    }
  })

  test('runs Claude with isolated HOPI tools, native resume, and complete final output', async () => {
    const binary = join(temporaryRoot, 'fake-claude')
    const argsFile = join(temporaryRoot, 'claude-args.json')
    const promptFile = join(temporaryRoot, 'claude-prompt.txt')
    const finalReply = 'x'.repeat(800)
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))`,
        `await Bun.write(${JSON.stringify(promptFile)}, await Bun.stdin.text())`,
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"system",subtype:"thinking_tokens",estimated_tokens:42,session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"assistant",message:{id:"message-1",content:[{type:"thinking",thinking:"Checking the image."}]},session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"assistant",message:{content:[{type:"tool_use",id:"call-task",name:"TaskCreate",input:{subject:"Inspect the image"}}]},session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"user",message:{content:[{type:"tool_result",tool_use_id:"call-task",content:"Task #1 created successfully"}]},tool_use_result:{task:{id:"1",subject:"Inspect the image",status:"pending"}},session_id:"claude-session"}))',
        `console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-session",result:${JSON.stringify(`<thought>Private reasoning.</thought>\n${finalReply}`)}}))`,
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const imagePath = join(temporaryRoot, 'claude-image.png')
    await Bun.write(imagePath, pngBytes())
    const cwd = join(temporaryRoot, 'assistant-claude')
    const readableRoot = join(temporaryRoot, 'canonical')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'dontAsk',
        model: 'sonnet',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
      fullAccess: (projectId) => projectId === 'P-1',
    })

    const events: AgentRuntimeEvent[] = []
    const result = await runner.run(
      {
        eventId: 'EV-claude',
        projectId: 'P-1',
        prompt: 'Inspect the image.',
        session: vendorSession('claude', 'claude-session'),
        cwd,
        lastMessageFile: join(cwd, 'last-message.txt'),
        transcriptFile: join(cwd, 'transcript.log'),
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: 'claude-token',
        imageFiles: [imagePath],
        readableRoots: [readableRoot],
      },
      {
        onEvent: (event) => {
          events.push(event)
        },
      },
    )

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    const mcpConfig = await Bun.file(join(cwd, 'claude-mcp.json')).json()
    const settings = await Bun.file(join(cwd, 'claude-settings.json')).json()
    expect(result).toEqual({
      reply: finalReply,
      session: vendorSession('claude', 'claude-session'),
    })
    for (const expected of [
      '--mcp-config',
      '--strict-mcp-config',
      '--settings',
      '--resume',
      'claude-session',
    ]) {
      expect(args).toContain(expected)
    }
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--allowedTools')
    expect(settings).toEqual({ sandbox: { enabled: false } })
    expect(args).not.toContain('--add-dir')
    expect(mcpConfig.mcpServers.hopi.env.HOPI_TOOL_TOKEN).toBe('claude-token')
    expect(await Bun.file(promptFile).text()).toContain(imagePath)
    expect(await Bun.file(join(cwd, 'transcript.log')).text()).toContain('stdout: {"type":"result"')
    expect(events).toContainEqual({
      kind: 'transcript',
      transport: 'claude',
      entryKind: 'status',
      summary: 'Checking the image.',
      vendorEventType: 'assistant.thinking',
    })
    expect(events).not.toContainEqual(
      expect.objectContaining({ vendorEventType: 'system.thinking_tokens' }),
    )
    expect(events).toContainEqual({
      kind: 'plan',
      transport: 'claude',
      planId: 'claude-tasks',
      status: 'active',
      items: [{ text: 'Inspect the image', completed: false }],
      vendorEventType: 'user.task_create',
    })
    expect(events).not.toContainEqual(
      expect.objectContaining({ entryKind: 'tool_call', toolName: 'TaskCreate' }),
    )
  })

  test('throws a Claude terminal provider error instead of accepting its synthetic reply', async () => {
    const binary = join(temporaryRoot, 'fake-claude-provider-error')
    const error = 'Daily provider allocation exceeded.'
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"system",subtype:"api_retry",attempt:10,max_retries:10,error_status:429,error:"rate_limit",session_id:"claude-session"}))',
        `console.log(JSON.stringify({type:"assistant",message:{id:"synthetic",content:[{type:"text",text:${JSON.stringify(error)}}]},session_id:"claude-session"}))`,
        `console.log(JSON.stringify({type:"result",subtype:"success",is_error:true,api_error_status:429,terminal_reason:"api_error",session_id:"claude-session",result:${JSON.stringify(error)}}))`,
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-provider-error')
    const events: AgentRuntimeEvent[] = []
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'dontAsk',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await expect(
      runner.run(
        {
          eventId: 'EV-provider-error',
          prompt: 'Continue.',
          session: vendorSession('claude', 'claude-session'),
          cwd,
          lastMessageFile: join(cwd, 'last-message.txt'),
          transcriptFile: join(cwd, 'transcript.log'),
          toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
          toolToken: 'provider-error-token',
        },
        {
          onEvent: (event) => {
            events.push(event)
          },
        },
      ),
    ).rejects.toThrow(error)

    expect(events).toContainEqual(
      expect.objectContaining({
        entryKind: 'error',
        summary: error,
        vendorEventType: 'result.api_error',
      }),
    )
  })

  test('runs bounded Claude without an interactive permission channel', async () => {
    const binary = join(temporaryRoot, 'fake-claude-bounded-permissions')
    const argsFile = join(temporaryRoot, 'claude-bounded-permissions-args.json')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))`,
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-bounded"}))',
        'console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-bounded",result:"Bounded."}))',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-claude-bounded')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'default',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await runner.run({
      eventId: 'EV-claude-bounded',
      prompt: 'Inspect state.',
      session: null,
      cwd,
      lastMessageFile: join(cwd, 'last-message.txt'),
      transcriptFile: join(cwd, 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'claude-bounded-token',
    })

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--permission-mode')
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual([
      '--tools',
      'Read,Glob,Grep,Bash,WebFetch,WebSearch',
    ])
    expect(await Bun.file(join(cwd, 'claude-settings.json')).json()).toMatchObject({
      sandbox: { enabled: true, failIfUnavailable: true },
    })
  })

  test('does not persist a session identity reported only by a Claude terminal error', async () => {
    const binary = join(temporaryRoot, 'fake-claude-startup-error')
    const error = 'sandbox required but unavailable'
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `console.log(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,session_id:"unusable-session",errors:[${JSON.stringify(error)}]}))`,
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-startup-error')
    const sessions: string[] = []
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'dontAsk',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await expect(
      runner.run(
        {
          eventId: 'EV-startup-error',
          prompt: 'Continue.',
          session: null,
          cwd,
          lastMessageFile: join(cwd, 'last-message.txt'),
          transcriptFile: join(cwd, 'transcript.log'),
          toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
          toolToken: 'startup-error-token',
        },
        {
          onSession: (session) => {
            sessions.push(session.sessionId)
          },
        },
      ),
    ).rejects.toThrow(error)
    expect(sessions).toEqual([])
  })

  test('fails closed when Claude cannot separate a malformed thought envelope', async () => {
    const binary = join(temporaryRoot, 'fake-claude-malformed-thought')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-session",result:"<thought\\nPrivate reasoning followed by an indistinguishable answer."}))',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-malformed-thought')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'dontAsk',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await expect(
      runner.run({
        eventId: 'EV-malformed-thought',
        prompt: 'Continue.',
        session: vendorSession('claude', 'claude-session'),
        cwd,
        lastMessageFile: join(cwd, 'last-message.txt'),
        transcriptFile: join(cwd, 'transcript.log'),
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: 'malformed-thought-token',
      }),
    ).rejects.toThrow(
      'Claude returned a malformed thought envelope instead of a separable final reply.',
    )
    expect(await Bun.file(join(cwd, 'transcript.log')).text()).toContain('<thought')
    expect(await Bun.file(join(cwd, 'last-message.txt')).exists()).toBe(false)
  })

  test('rebuilds directly instead of resuming an incompatible vendor session', async () => {
    const binary = join(temporaryRoot, 'fake-claude-switch')
    const argsFile = join(temporaryRoot, 'claude-switch-args.json')
    const promptFile = join(temporaryRoot, 'claude-switch-prompt.txt')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))`,
        `await Bun.write(${JSON.stringify(promptFile)}, await Bun.stdin.text())`,
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-new"}))',
        'console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-new",result:"Rebuilt."}))',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-vendor-switch')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'claude',
        cwdMode: 'root',
        binary,
        permissionMode: 'dontAsk',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    const result = await runner.run({
      eventId: 'EV-switch',
      prompt: 'Only the current turn.',
      rebuildPrompt: 'Durable history plus the current turn.',
      session: codexSession('old-codex-thread'),
      cwd,
      lastMessageFile: join(cwd, 'last-message.txt'),
      transcriptFile: join(cwd, 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'switch-token',
    })

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    expect(args).not.toContain('--resume')
    expect(await Bun.file(promptFile).text()).toBe('Durable history plus the current turn.')
    expect(result).toEqual({
      reply: 'Rebuilt.',
      session: vendorSession('claude', 'claude-new'),
    })
  })

  test('runs OpenCode with isolated HOPI tools, native resume, and image files', async () => {
    const binary = join(temporaryRoot, 'fake-opencode')
    const argsFile = join(temporaryRoot, 'opencode-args.json')
    const promptFile = join(temporaryRoot, 'opencode-prompt.txt')
    const configPathFile = join(temporaryRoot, 'opencode-config-path.txt')
    const pwdFile = join(temporaryRoot, 'opencode-pwd.txt')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'const args = process.argv.slice(2)',
        'if (args.includes("mcp") && args.includes("list")) {',
        '  console.log("\\u001b[0m✓ hopi \\u001b[90mconnected")',
        '} else {',
        `  await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(args))`,
        `  await Bun.write(${JSON.stringify(promptFile)}, await Bun.stdin.text())`,
        `  await Bun.write(${JSON.stringify(configPathFile)}, process.env.OPENCODE_CONFIG ?? "")`,
        `  await Bun.write(${JSON.stringify(pwdFile)}, process.env.PWD ?? "")`,
        '  console.log(JSON.stringify({type:"text",sessionID:"ses_1",part:{id:"part-1",messageID:"msg-1",type:"text",text:"OpenCode reply."}}))',
        '}',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const imagePath = join(temporaryRoot, 'opencode-image.png')
    await Bun.write(imagePath, pngBytes())
    const cwd = join(temporaryRoot, 'assistant-opencode')
    const readableRoot = join(temporaryRoot, 'canonical')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({
        transport: 'opencode',
        cwdMode: 'root',
        binary,
        model: 'anthropic/claude-sonnet-4-5',
      }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
      fullAccess: (projectId) => projectId === 'P-1',
    })

    const result = await runner.run({
      eventId: 'EV-opencode',
      projectId: 'P-1',
      prompt: 'Continue.',
      session: vendorSession('opencode', 'ses_1'),
      cwd,
      lastMessageFile: join(cwd, 'last-message.txt'),
      transcriptFile: join(cwd, 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'opencode-token',
      imageFiles: [imagePath],
      readableRoots: [readableRoot],
    })

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    const config = await Bun.file(join(cwd, 'opencode.json')).json()
    expect(result).toEqual({
      reply: 'OpenCode reply.',
      session: vendorSession('opencode', 'ses_1'),
    })
    for (const expected of ['--pure', '--session', 'ses_1', '--file', imagePath]) {
      expect(args).toContain(expected)
    }
    expect(config.mcp.hopi.environment.HOPI_TOOL_TOKEN).toBe('opencode-token')
    expect(config.compaction).toEqual({ auto: true })
    expect(config.permission).toEqual({ '*': 'allow' })
    expect(await Bun.file(configPathFile).text()).toBe(join(cwd, 'opencode.json'))
    expect(await Bun.file(pwdFile).text()).toBe(cwd)
    expect(await Bun.file(promptFile).text()).toBe('Continue.')
    expect(await Bun.file(join(cwd, 'transcript.log')).text()).toContain('stdout: {"type":"text"')

    const boundedCwd = join(temporaryRoot, 'assistant-opencode-bounded')
    await runner.run({
      eventId: 'EV-opencode-bounded',
      projectId: 'P-2',
      prompt: 'Read state.',
      session: null,
      cwd: boundedCwd,
      lastMessageFile: join(boundedCwd, 'last-message.txt'),
      transcriptFile: join(boundedCwd, 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'opencode-bounded-token',
      readableRoots: [readableRoot],
    })
    const boundedConfig = await Bun.file(join(boundedCwd, 'opencode.json')).json()
    expect(boundedConfig.compaction).toEqual({ auto: true })
    expect(boundedConfig.permission).toEqual({
      '*': 'deny',
      'hopi_*': 'allow',
      read: 'allow',
      grep: 'allow',
      glob: 'allow',
      list: 'allow',
      external_directory: {
        '*': 'deny',
        [`${readableRoot}/**`]: 'allow',
      },
    })
    expect(JSON.stringify(boundedConfig.permission)).not.toContain('ask')
  })

  test('does not invoke an OpenCode model without the injected HOPI MCP server', async () => {
    const binary = join(temporaryRoot, 'fake-opencode-without-mcp')
    const invokedFile = join(temporaryRoot, 'opencode-model-invoked')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'const args = process.argv.slice(2)',
        'if (args.includes("mcp") && args.includes("list")) {',
        '  console.log("✗ hopi failed")',
        '} else {',
        `  await Bun.write(${JSON.stringify(invokedFile)}, "yes")`,
        '}',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-opencode-without-mcp')
    const runner = createConfiguredAssistantModelRunner({
      resolveConfig: () => ({ transport: 'opencode', cwdMode: 'root', binary }),
      resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    })

    await expect(
      runner.run({
        eventId: 'EV-opencode-without-mcp',
        prompt: 'Continue.',
        session: null,
        cwd,
        lastMessageFile: join(cwd, 'last-message.txt'),
        transcriptFile: join(cwd, 'transcript.log'),
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: 'opencode-token',
      }),
    ).rejects.toThrow('did not connect the injected hopi MCP server')
    expect(await Bun.file(invokedFile).exists()).toBe(false)
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
      session: null,
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

  test('accepts an empty configured Codex message only as silent Reflection', async () => {
    const binary = join(temporaryRoot, 'fake-codex-empty')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'const outputIndex = process.argv.indexOf("-o")',
        'await Bun.write(process.argv[outputIndex + 1], "")',
        'await Bun.write(process.argv[outputIndex + 1] + ".args", JSON.stringify(process.argv.slice(2)))',
        'console.log(JSON.stringify({type:"thread.started",thread_id:"thread-empty"}))',
        'console.log(JSON.stringify({type:"item.completed",item:{id:"item-0",type:"agent_message",text:""}}))',
        'console.log(JSON.stringify({type:"turn.completed"}))',
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

    const run = (eventId: string, toolMode?: 'reflection') => {
      const cwd = join(temporaryRoot, eventId)
      return runner.run({
        eventId,
        prompt: 'Assess the current state.',
        session: null,
        cwd,
        lastMessageFile: join(cwd, 'last-message.txt'),
        transcriptFile: join(cwd, 'transcript.log'),
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: `${eventId}-token`,
        ...(toolMode ? { toolMode } : {}),
      })
    }

    await expect(run('RF-empty', 'reflection')).resolves.toEqual({
      reply: '',
      session: codexSession('thread-empty'),
    })
    const reflectionArgs = JSON.parse(
      await Bun.file(join(temporaryRoot, 'RF-empty', 'last-message.txt.args')).text(),
    ) as string[]
    expect(reflectionArgs).toContain('read-only')
    expect(reflectionArgs).not.toContain('sandbox_workspace_write.network_access=true')
    expect(reflectionArgs).toContain('skills.include_instructions=false')
    expect(reflectionArgs).toContain('skills.bundled.enabled=false')
    for (const feature of [
      'browser_use',
      'computer_use',
      'image_generation',
      'workspace_dependencies',
    ]) {
      expect(reflectionArgs[reflectionArgs.indexOf(feature) - 1]).toBe('--disable')
    }
    await expect(run('EV-empty')).rejects.toThrow('empty Assistant message')
  })

  test('retains a Codex model refresh timeout without using it as the Assistant failure', async () => {
    const binary = join(temporaryRoot, 'fake-codex-model-refresh-timeout')
    const warning =
      '2026-07-17T16:43:47.149889Z ERROR codex_models_manager::manager: failed to refresh available models: timeout waiting for child process to exit'
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'console.error("provider connection failed")',
        `console.error(${JSON.stringify(warning)})`,
        'process.exit(1)',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-model-refresh-timeout')
    const transcriptFile = join(cwd, 'transcript.log')
    const events: AgentRuntimeEvent[] = []
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

    const run = runner.run(
      {
        eventId: 'EV-model-refresh-timeout',
        prompt: 'Continue.',
        session: null,
        cwd,
        lastMessageFile: join(cwd, 'last-message.txt'),
        transcriptFile,
        toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
        toolToken: 'model-refresh-timeout-token',
      },
      {
        onEvent: (event) => {
          events.push(event)
        },
      },
    )

    await expect(run).rejects.toThrow('provider connection failed')
    expect(events).not.toContainEqual(expect.objectContaining({ summary: warning }))
    expect(await Bun.file(transcriptFile).text()).toContain(warning)
  })

  test('bounds Assistant stderr in memory while retaining the complete transcript', async () => {
    const binary = join(temporaryRoot, 'fake-codex-verbose-failure')
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'for (let index = 0; index < 250; index += 1) console.error(`assistant-${String(index).padStart(3, "0")}`)',
        'process.exit(9)',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const cwd = join(temporaryRoot, 'assistant-verbose-failure')
    const transcriptFile = join(cwd, 'transcript.log')
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

    const run = runner.run({
      eventId: 'EV-verbose-failure',
      prompt: 'Continue.',
      session: null,
      cwd,
      lastMessageFile: join(cwd, 'last-message.txt'),
      transcriptFile,
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'verbose-failure-token',
    })

    await expect(run).rejects.toThrow('assistant-249')
    const transcript = await Bun.file(transcriptFile).text()
    expect(transcript).toContain('stderr: assistant-000')
    expect(transcript).toContain('stderr: assistant-249')
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
      session: codexSession('thread-existing'),
      cwd: join(temporaryRoot, 'assistant-image'),
      lastMessageFile: join(temporaryRoot, 'assistant-image', 'last-message.txt'),
      transcriptFile: join(temporaryRoot, 'assistant-image', 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'image-token',
      imageFiles: [imagePath],
    })

    const args = JSON.parse(await Bun.file(argsFile).text()) as string[]
    expect(args).toContain('model_provider="hopi_chatgpt_https"')
    expect(args).toContain('model_providers.hopi_chatgpt_https.supports_websockets=false')
    expect(args).not.toContain('skills.include_instructions=false')
    expect(args).not.toContain('skills.bundled.enabled=false')
    expect(args).toContain('include_apps_instructions=false')
    expect(args).toContain('include_collaboration_mode_instructions=false')
    expect(args.some((arg) => arg.startsWith('developer_instructions='))).toBe(false)
    for (const feature of ['apps', 'goals', 'memories', 'multi_agent', 'plugins']) {
      expect(args).toContain(feature)
      expect(args[args.indexOf(feature) - 1]).toBe('--disable')
    }
    for (const feature of [
      'browser_use',
      'computer_use',
      'image_generation',
      'workspace_dependencies',
    ]) {
      expect(
        args.findIndex((arg, index) => arg === feature && args[index - 1] === '--disable'),
      ).toBe(-1)
    }
    expect(args).toContain('resume')
    expect(args).toContain('workspace-write')
    expect(args).toContain('sandbox_workspace_write.network_access=true')
    expect(args.slice(args.indexOf('resume'))).toContain('-i')
    expect(args).toContain(imagePath)
  })

  test('attaches current Inbox images and names their durable references in the prompt', async () => {
    const seen: Array<{ prompt: string; imageFiles: string[] }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({ prompt: input.prompt, imageFiles: input.imageFiles ?? [] })
        await observer?.onSession?.(codexSession('thread-image'))
        return { reply: 'I can see the reference.', session: codexSession('thread-image') }
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

  test('HOPI-E2E-010 contracts conversation and page context without Goal effects', async () => {
    const seen: Array<{ sessionId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({ sessionId: input.session?.sessionId ?? null, prompt: input.prompt })
        await observer?.onSession?.(codexSession('thread-1'))
        await observer?.onEvent?.({
          kind: 'transcript',
          transport: 'codex',
          entryKind: 'assistant',
          summary: '你好。',
        })
        return { reply: '你好。', session: codexSession('thread-1') }
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
    expect(seen[0]?.sessionId).toBeNull()
    expect(seen[0]?.prompt).toContain('[Preferred page context: P-1 / G-1]')
    expect(seen[0]?.prompt).not.toContain('[Current execution environment observation]')
    expect(seen[0]?.prompt).not.toContain('[Current scoped HOPI state observation]')
    expect(seen[0]?.prompt).not.toContain('"lifecycle": "active"')
    expect(seen[0]?.prompt).toContain('Owned outcome: complete the current Inbox turn')
    expect(seen[0]?.prompt).toContain('Current state and canonical effects come from HOPI tools')
    expect(seen[0]?.prompt).toContain('provider workspace is non-canonical scratch space')
    expect(seen[0]?.prompt).not.toContain('answer without polling')
    expect(seen[0]?.prompt).not.toContain('[Operator-facing reply contract]')
    expect(seen[0]?.prompt).not.toContain('Default to one or two short sentences')
    expect(seen[0]?.prompt.length).toBeLessThan(1_500)
    expect((await fixture.conversation.readTurn('EV-1'))?.manifest.status).toBe('completed')
  })

  test('reads current Goal state only when the model requests it', async () => {
    let prompt = ''
    let stateResult: unknown
    const fixture = await setup((tools) => ({
      async run(input) {
        prompt = input.prompt
        stateResult = await tools.execute(input.toolToken, 'hopi_read_state', {
          projectId: 'P-1',
          goalId: 'G-1',
        })
        return { reply: 'Observed.', session: codexSession('thread-observation') }
      },
    }))
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-observe',
      content: 'What is the current state?',
      context: { projectId: 'P-1', goalId: 'G-1' },
    })

    await fixture.assistant.process('EV-observe')

    expect(prompt).not.toContain('[Current scoped HOPI state observation]')
    expect(JSON.stringify(stateResult)).toContain('"lifecycle":"active"')
    expect(JSON.stringify(stateResult)).toContain('"eventId":"EV-observe"')
  })

  test('resumes one persistent vendor session for later turns', async () => {
    const sessionIds: Array<string | null> = []
    const prompts: string[] = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        sessionIds.push(input.session?.sessionId ?? null)
        prompts.push(input.prompt)
        await observer?.onSession?.(codexSession('thread-1'))
        return { reply: `reply-${sessionIds.length}`, session: codexSession('thread-1') }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'First' })
    await fixture.assistant.process('EV-1')
    await fixture.workspace.receiveEvent({ eventId: 'EV-2', content: 'Second' })
    await fixture.assistant.process('EV-2')

    expect(sessionIds).toEqual([null, 'thread-1'])
    expect(prompts[0]).toContain('Owned outcome: complete the current Inbox turn')
    expect(prompts[1]).not.toContain('# HOPI Workspace Assistant')
    expect(prompts[1]).not.toContain('[Operator-facing reply contract]')
    expect(prompts[1]).not.toContain('[Current durable cross-Project user preferences]')
    expect(prompts[1]).toContain('[Current user Inbox turn EV-2')
    expect((await fixture.workspace.readEvent('EV-2'))?.attributes.reply).toBe('reply-2')
  })

  test('keeps Home and Project provider sessions and rebuild history isolated by page scope', async () => {
    const calls: Array<{
      eventId: string
      projectId?: string
      sessionId: string | null
      prompt: string
    }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        calls.push({
          eventId: input.eventId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          sessionId: input.session?.sessionId ?? null,
          prompt: input.prompt,
        })
        const session = codexSession(input.projectId ? 'thread-project-1' : 'thread-home')
        await observer?.onSession?.(session)
        return { reply: `Handled ${input.eventId}.`, session }
      },
    }))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project-first',
      content: 'PROJECT_ONLY_MARKER',
      context: { projectId: 'P-1' },
    })
    await fixture.assistant.process('EV-project-first')
    await fixture.workspace.receiveEvent({ eventId: 'EV-home', content: 'HOME_ONLY_MARKER' })
    await fixture.assistant.process('EV-home')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project-resume',
      content: 'Continue this Project.',
      context: { projectId: 'P-1' },
    })
    await fixture.assistant.process('EV-project-resume')

    expect(calls.map(({ sessionId }) => sessionId)).toEqual([null, null, 'thread-project-1'])
    expect(await fixture.conversation.readSession({ kind: 'project', projectId: 'P-1' })).toEqual(
      codexSession('thread-project-1'),
    )
    expect(await fixture.conversation.readSession(HOME_ASSISTANT_CONVERSATION_SCOPE)).toEqual(
      codexSession('thread-home'),
    )

    await fixture.conversation.clearSession({ kind: 'project', projectId: 'P-1' })
    await fixture.workspace.receiveEvent({
      eventId: 'EV-project-rebuild',
      content: 'Rebuild this Project.',
      context: { projectId: 'P-1' },
    })
    await fixture.assistant.process('EV-project-rebuild')

    expect(calls.at(-1)?.prompt).toContain('PROJECT_ONLY_MARKER')
    expect(calls.at(-1)?.prompt).not.toContain('HOME_ONLY_MARKER')
  })

  test('rebuilds a persisted session when the initial Assistant contract changes', async () => {
    const calls: Array<{ sessionId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        calls.push({ sessionId: input.session?.sessionId ?? null, prompt: input.prompt })
        await observer?.onSession?.(codexSession('thread-current'))
        return { reply: 'Current contract applied.', session: codexSession('thread-current') }
      },
    }))
    await fixture.conversation.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      codexSession('thread-old'),
      'stale-contract',
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-contract', content: 'Continue.' })

    await fixture.assistant.process('EV-contract')

    expect(calls).toEqual([
      expect.objectContaining({
        sessionId: null,
        prompt: expect.stringContaining('# HOPI Workspace Assistant'),
      }),
    ])
    expect(
      await fixture.conversation.readSession(
        HOME_ASSISTANT_CONVERSATION_SCOPE,
        await currentAssistantContextDigest(fixture.workspace),
      ),
    ).toEqual(codexSession('thread-current'))
  })

  test('puts preferences in session bootstrap and rebuilds after they change', async () => {
    const seen: Array<{ eventId: string; sessionId: string | null; prompt: string }> = []
    const fixture = await setup((tools) => ({
      async run(input, observer) {
        seen.push({
          eventId: input.eventId,
          sessionId: input.session?.sessionId ?? null,
          prompt: input.prompt,
        })
        if (input.eventId === 'EV-preference') {
          const digest = input.prompt.match(/Digest: ([a-f0-9]{64})/)?.[1]
          if (!digest) throw new Error('Preference digest was not injected')
          await observer?.onEvent?.({
            kind: 'transcript',
            transport: 'codex',
            entryKind: 'tool_call',
            summary: 'Tool call: hopi_write_preferences',
            toolName: 'hopi_write_preferences',
          })
          await tools.execute(input.toolToken, 'hopi_write_preferences', {
            content: '# Preferences\n\n- Keep replies concise across Projects.\n',
            expectedDigest: digest,
          })
        }
        await observer?.onSession?.(codexSession('thread-preference'))
        return { reply: 'Preference handled.', session: codexSession('thread-preference') }
      },
    }))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-preference',
      content: 'From now on, keep replies concise across projects.',
    })
    await fixture.assistant.process('EV-preference')

    await fixture.workspace.receiveEvent({ eventId: 'EV-next', content: 'What is next?' })
    await fixture.assistant.process('EV-next')
    await fixture.workspace.receiveEvent({ eventId: 'EV-resume', content: 'Continue.' })
    await fixture.assistant.process('EV-resume')
    await fixture.conversation.clearSession(HOME_ASSISTANT_CONVERSATION_SCOPE)
    await fixture.workspace.receiveEvent({ eventId: 'EV-rebuild', content: 'Continue.' })
    await fixture.assistant.process('EV-rebuild')

    expect(seen.map(({ sessionId }) => sessionId)).toEqual([null, null, 'thread-preference', null])
    expect(seen[0]?.prompt).toContain(
      'Preferences are defaults below the current turn and explicit Project or Goal authority',
    )
    expect(seen[1]?.prompt).toContain('- Keep replies concise across Projects.')
    expect(seen[2]?.prompt).not.toContain('[Current durable cross-Project user preferences]')
    expect(seen[3]?.prompt).toContain('- Keep replies concise across Projects.')
    expect(
      (
        await createAssistantWorkspaceStore(
          fixture.homeRoot,
          new PublicationCoordinator(),
        ).readWorkspace()
      ).preference.content,
    ).toContain('Keep replies concise across Projects.')
    expect((await fixture.workspace.readEvent('EV-preference'))?.attributes.disposition).toBe(
      'tools-used',
    )
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
        return { reply: 'No decision is needed.', session: codexSession('thread-1') }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Do I need to decide?' })

    await fixture.assistant.process('EV-1')

    expect((await fixture.workspace.readEvent('EV-1'))?.attributes.disposition).toBe('tools-used')
  })

  test('rebuilds a missing vendor session from durable conversation history', async () => {
    const calls: Array<{ sessionId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        calls.push({ sessionId: input.session?.sessionId ?? null, prompt: input.prompt })
        if (input.session) throw new AssistantSessionUnavailableError('session not found')
        await observer?.onSession?.(codexSession('thread-rebuilt'))
        return { reply: 'Recovered.', session: codexSession('thread-rebuilt') }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-old', content: 'Old turn' })
    await fixture.workspace.handleEvent('EV-old', {
      reply: 'Old reply',
      disposition: 'answered',
    })
    await fixture.conversation.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      codexSession('missing-thread'),
      await currentAssistantContextDigest(fixture.workspace),
      workspaceAssistantRuntimeDigest(fixture.homeRoot),
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Continue' })

    await fixture.assistant.process('EV-1')

    expect(calls.map((call) => call.sessionId)).toEqual(['missing-thread', null])
    expect(calls[1]?.prompt).toContain('User: Old turn')
    expect(calls[1]?.prompt).toContain('Assistant: Old reply')
    expect(
      await fixture.conversation.readSession(
        HOME_ASSISTANT_CONVERSATION_SCOPE,
        await currentAssistantContextDigest(fixture.workspace),
      ),
    ).toEqual(codexSession('thread-rebuilt'))
  })

  test('rebuilds a context-exhausted vendor session once from bounded history', async () => {
    const calls: Array<{ sessionId: string | null; prompt: string }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        calls.push({ sessionId: input.session?.sessionId ?? null, prompt: input.prompt })
        if (input.session) {
          throw new AssistantSessionUnavailableError(
            "This model's maximum context length is 1048565 tokens; the request exceeded it.",
          )
        }
        await observer?.onSession?.(codexSession('thread-after-context-rebuild'))
        return {
          reply: 'Recovered from bounded history.',
          session: codexSession('thread-after-context-rebuild'),
        }
      },
    }))
    await fixture.workspace.receiveEvent({ eventId: 'EV-old', content: 'Earlier request' })
    await fixture.workspace.handleEvent('EV-old', {
      reply: 'Earlier answer',
      disposition: 'answered',
    })
    await fixture.conversation.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      codexSession('thread-context-exhausted'),
      await currentAssistantContextDigest(fixture.workspace),
      workspaceAssistantRuntimeDigest(fixture.homeRoot),
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-context', content: 'Continue' })

    await fixture.assistant.process('EV-context')

    expect(calls.map((call) => call.sessionId)).toEqual(['thread-context-exhausted', null])
    expect(calls[1]?.prompt).toContain('User: Earlier request')
    expect(calls[1]?.prompt).toContain('Assistant: Earlier answer')
    expect(
      await fixture.conversation.readSession(
        HOME_ASSISTANT_CONVERSATION_SCOPE,
        await currentAssistantContextDigest(fixture.workspace),
      ),
    ).toEqual(codexSession('thread-after-context-rebuild'))
  })

  test('does not rebuild a cached session after a terminal provider failure', async () => {
    const calls: Array<string | null> = []
    const fixture = await setup(() => ({
      async run(input) {
        calls.push(input.session?.sessionId ?? null)
        throw new WorkspaceAssistantError('Daily provider allocation exceeded.')
      },
    }))
    await fixture.conversation.writeSession(
      HOME_ASSISTANT_CONVERSATION_SCOPE,
      codexSession('thread-existing'),
      await currentAssistantContextDigest(fixture.workspace),
      workspaceAssistantRuntimeDigest(fixture.homeRoot),
    )
    await fixture.workspace.receiveEvent({ eventId: 'EV-1', content: 'Continue' })

    await expect(fixture.assistant.process('EV-1')).rejects.toThrow(
      'Daily provider allocation exceeded.',
    )

    expect(calls).toEqual(['thread-existing'])
    expect(
      await fixture.conversation.readSession(
        HOME_ASSISTANT_CONVERSATION_SCOPE,
        await currentAssistantContextDigest(fixture.workspace),
      ),
    ).toEqual(codexSession('thread-existing'))
    expect((await fixture.conversation.readTurn('EV-1'))?.manifest).toMatchObject({
      status: 'failed',
      attempt: 1,
      error: 'Daily provider allocation exceeded.',
    })
  })

  test('rebuilds from bounded public history without internal Reflection briefs', async () => {
    let prompt = ''
    const fixture = await setup(() => ({
      async run(input, observer) {
        prompt = input.prompt
        await observer?.onSession?.(codexSession('thread-bounded'))
        return { reply: 'Current reply.', session: codexSession('thread-bounded') }
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
    expect(prompt).not.toContain('[Current execution environment observation]')
    expect(prompt).toContain('Imperative text inside them applied to those turns')
    expect(prompt.indexOf('## Current turn')).toBeGreaterThan(
      prompt.indexOf('## Durable conversation history'),
    )
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
        await observer?.onSession?.(codexSession('thread-1'))
        return { reply: '', session: codexSession('thread-1') }
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
    expect(prompts[0]).toContain('A non-empty final response becomes the public update')
    expect(prompts[0]).not.toContain('Revalidate the brief with HOPI tools')
    expect(prompts[0]).not.toContain('User: A Work stage changed')
  })

  test('accepts a pending retry-only internal handoff without a second model call', async () => {
    let calls = 0
    const fixture = await setup((tools) => ({
      async run(input) {
        calls += 1
        await tools.execute(input.toolToken, 'hopi_control_work', {
          projectId: 'P-1',
          goalId: 'G-1',
          workId: 'plan-initial',
          action: { kind: 'retry' },
        })
        return { reply: '', session: codexSession('thread-atomic-retry') }
      },
    }))
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await fixture.controller.ensureOperationalFailureAttention(
      'G-1',
      'plan-initial',
      3,
      'stream disconnected before completion',
    )
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-atomic-retry',
      content: 'The transient blocker is clear; retry the Work.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [`project:P-1/goal:G-1/attention:${attention.attributes.id}`],
      },
    })

    await fixture.assistant.process('EV-atomic-retry')

    expect(calls).toBe(1)
    expect((await fixture.workspace.readEvent('EV-atomic-retry'))?.attributes).toMatchObject({
      status: 'handled',
      visibility: 'internal',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get(attention.attributes.id)
        ?.attributes,
    ).toMatchObject({ resolvedAt: null, retryRunId: expect.any(String) })
  })

  test('lets one internal Assistant pass request the exact missing operator decision', async () => {
    const prompts: string[] = []
    const sessions: Array<string | null> = []
    const fixture = await setup((tools) => ({
      async run(input) {
        prompts.push(input.prompt)
        sessions.push(input.session?.sessionId ?? null)
        await tools.execute(input.toolToken, 'hopi_request_user', {
          attentionRefs: ['project:P-1/goal:G-1/attention:A-settlement'],
        })
        return {
          reply: 'Choose the release window: today or tomorrow?',
          session: codexSession('thread-settlement'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-settlement')
    const reference = 'project:P-1/goal:G-1/attention:A-settlement'
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-settlement',
      content: 'Ask the operator for the unresolved choice.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })

    await fixture.assistant.process('EV-settlement')

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('A non-empty final response becomes the public update')
    expect(prompts[0]).not.toContain('call hopi_request_user')
    expect(sessions).toEqual([null])
    expect((await fixture.workspace.readEvent('EV-settlement'))?.attributes).toMatchObject({
      status: 'handled',
      visibility: 'public',
      reply: 'Choose the release window: today or tomorrow?',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-settlement')?.attributes,
    ).toMatchObject({
      notifiedAt: expect.any(String),
      operatorRequest: expect.stringContaining('/event:EV-settlement'),
      resolvedAt: null,
    })
  })

  test('publishes one notification after the Assistant resolves verified-clear Attention', async () => {
    let calls = 0
    const fixture = await setup((tools) => ({
      async run(input) {
        calls += 1
        await tools.execute(input.toolToken, 'hopi_resolve_attention', {
          attentionRef: 'project:P-1/goal:G-1/attention:A-revised-notification',
          resolution: 'The represented blocker was verified clear.',
        })
        return {
          reply: 'The blocker was cleared and internal work has resumed.',
          session: codexSession('thread-revised-notification'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-revised-notification')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-revised-notification',
      content: 'Reassess and continue this blocker.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-revised-notification'],
      },
    })

    await fixture.assistant.process('EV-revised-notification')

    expect(calls).toBe(1)
    expect(
      (await fixture.workspace.readEvent('EV-revised-notification'))?.attributes,
    ).toMatchObject({
      status: 'handled',
      visibility: 'public',
      disposition: 'notified',
      reply: 'The blocker was cleared and internal work has resumed.',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-revised-notification')
        ?.attributes.resolvedAt,
    ).not.toBeNull()
  })

  test('uses a fresh operator request when prior informational delivery did not settle Attention', async () => {
    const prompts: string[] = []
    const fixture = await setup((tools) => ({
      async run(input) {
        prompts.push(input.prompt)
        await tools.execute(input.toolToken, 'hopi_request_user', {
          attentionRefs: ['project:P-1/goal:G-1/attention:A-informational-owner'],
        })
        return {
          reply: 'Choose the release window: today or tomorrow?',
          session: codexSession('thread-informational-owner'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-informational-owner')
    await acknowledgeGoalAttention(
      fixture.goalStore,
      'G-1',
      'A-informational-owner',
      new Date('2026-07-11T01:00:00Z'),
    )
    const reference = 'project:P-1/goal:G-1/attention:A-informational-owner'
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-informational-owner',
      content: 'Continue the internally owned blocker after its earlier status update.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })

    await fixture.assistant.process('EV-informational-owner')

    expect(prompts).toHaveLength(1)
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-informational-owner')
        ?.attributes,
    ).toMatchObject({
      notifiedAt: '2026-07-11T01:00:00.000Z',
      operatorRequest: expect.stringContaining('/event:EV-informational-owner'),
      resolvedAt: null,
    })
  })

  test('continues the same Session once when the first internal response leaves Attention open', async () => {
    const prompts: string[] = []
    const sessions: Array<string | null> = []
    let calls = 0
    const fixture = await setup(() => ({
      async run(input) {
        calls += 1
        prompts.push(input.prompt)
        sessions.push(input.session?.sessionId ?? null)
        return calls === 1
          ? {
              reply: 'I will settle the blocker next.',
              session: codexSession('thread-omission-first'),
            }
          : {
              reply: 'I am continuing with the repair.',
              session: codexSession('thread-omission-corrected'),
            }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-omission')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-omission',
      content: 'Settle this blocker.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-omission'],
      },
    })

    await fixture.assistant.process('EV-omission')

    expect((await fixture.workspace.readEvent('EV-omission'))?.attributes).toMatchObject({
      status: 'handled',
      visibility: 'public',
      reply: 'I am continuing with the repair.',
    })
    expect(calls).toBe(2)
    expect(sessions).toEqual([null, 'thread-omission-first'])
    expect(prompts[1]).toContain('selected Attention still owns scheduling')
    expect(prompts[1]).toContain('recorded neither settlement nor operator ownership')
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-omission')?.attributes,
    ).toMatchObject({ notifiedAt: expect.any(String), resolvedAt: null })
  })

  test('publishes the corrected result after the continued Session settles Attention', async () => {
    const reference = 'project:P-1/goal:G-1/attention:A-corrected-settlement'
    let calls = 0
    const fixture = await setup((tools) => ({
      async run(input) {
        calls += 1
        if (calls === 1) {
          return {
            reply: 'I will clear the blocker.',
            session: codexSession('thread-correction-first'),
          }
        }
        expect(input.session).toEqual(codexSession('thread-correction-first'))
        await tools.execute(input.toolToken, 'hopi_resolve_attention', {
          attentionRef: reference,
          resolution: 'The continued turn verified and cleared the represented condition.',
        })
        return {
          reply: 'The blocker is cleared.',
          session: codexSession('thread-correction-settled'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-corrected-settlement')
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-corrected-settlement',
      content: 'Settle this blocker.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [reference],
      },
    })

    await fixture.assistant.process('EV-corrected-settlement')

    expect(calls).toBe(2)
    expect(
      (await fixture.workspace.readEvent('EV-corrected-settlement'))?.attributes,
    ).toMatchObject({
      status: 'handled',
      visibility: 'public',
      reply: 'The blocker is cleared.',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-corrected-settlement')
        ?.attributes.resolvedAt,
    ).not.toBeNull()
  })

  test('publishes only the explicit operator request before transferring linked Attention', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        await tools.execute(input.toolToken, 'hopi_request_user', {
          attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
        })
        return {
          reply: 'Choose the release window: today or tomorrow?',
          session: codexSession('thread-notify'),
        }
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
      disposition: 'operator-requested',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-choice')?.attributes,
    ).toMatchObject({
      notifiedAt: expect.any(String),
      operatorRequest: expect.stringContaining('/event:EV-notify'),
      resolvedAt: null,
    })
  })

  test('HOPI-E2E-013 contracts one Attention notification, durable answer, and continuation', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        if (input.eventId === 'EV-notify') {
          await tools.execute(input.toolToken, 'hopi_request_user', {
            attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
          })
          return {
            reply: 'Which release window should I use: today or tomorrow?',
            session: codexSession('thread-attention'),
          }
        }
        if (input.eventId === 'EV-info') {
          await tools.execute(input.toolToken, 'hopi_read_state', {
            projectId: 'P-1',
            goalId: 'G-1',
          })
          return {
            reply: 'The current output is available in Preview.',
            session: codexSession('thread-attention'),
          }
        }
        await tools.execute(input.toolToken, 'hopi_create_work', {
          projectId: 'P-1',
          goalId: 'G-1',
          work: {
            kind: 'planning',
            mode: 'new_contract_revision',
            contractChange: 'Replace the prior direction.',
          },
        })
        await tools.execute(input.toolToken, 'hopi_resolve_attention', {
          attentionRef: 'project:P-1/goal:G-1/attention:A-choice',
          resolution: 'The operator replaced the prior direction and Planning now represents it.',
        })
        return {
          reply: 'I dropped the old direction and requested the revised plan.',
          session: codexSession('thread-attention'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-choice')
    await fixture.goalStore.createGoal({
      goalId: 'G-other',
      title: 'Other Goal',
      objective: 'Keep unrelated page context.',
    })
    await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-notify',
      content: 'Ask the operator for the release window.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
      },
    })

    await fixture.assistant.process('EV-notify')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-info',
      content: 'Where can I inspect the current output?',
      context: {
        projectId: 'P-1',
        goalId: 'G-other',
      },
    })
    await fixture.assistant.process('EV-info')
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-choice')?.attributes
        .resolvedAt,
    ).toBeNull()

    const operatorRequest = (await fixture.goalStore.readPackage('G-1')).attentions.get('A-choice')
      ?.attributes.operatorRequest
    if (!operatorRequest) throw new Error('Expected an operator request')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-answer',
      content: 'The result is poor. Drop that direction and revise the plan.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
        replyTo: operatorRequest,
      },
    })
    await fixture.assistant.process('EV-answer')

    const goalPackage = await fixture.goalStore.readPackage('G-1')
    expect((await fixture.workspace.readEvent('EV-notify'))?.attributes).toMatchObject({
      visibility: 'public',
      status: 'handled',
      reply: 'Which release window should I use: today or tomorrow?',
    })
    expect((await fixture.workspace.readEvent('EV-answer'))?.attributes).toMatchObject({
      status: 'handled',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: ['project:P-1/goal:G-1/attention:A-choice'],
        replyTo: operatorRequest,
      },
      reply: 'I dropped the old direction and requested the revised plan.',
    })
    expect(goalPackage.attentions.get('A-choice')?.attributes).toMatchObject({
      notifiedAt: expect.any(String),
      operatorRequest: null,
      resolvedAt: expect.any(String),
    })
    expect(goalPackage.inputs).toHaveLength(1)
    expect(goalPackage.inputs[0]?.body).toBe(
      'The result is poor. Drop that direction and revise the plan.\n',
    )
  })

  test('applies an explicit Attention reply in one Assistant pass', async () => {
    let calls = 0
    const prompts: string[] = []
    const reference = 'project:P-1/goal:G-1/attention:A-explicit-reply'
    const fixture = await setup((tools) => ({
      async run(input) {
        calls += 1
        prompts.push(input.prompt)
        await tools.execute(input.toolToken, 'hopi_resolve_attention', {
          attentionRef: reference,
          resolution: 'The operator explicitly chose to continue.',
        })
        return {
          reply: 'The answer was applied and the original responsibility can continue.',
          session: codexSession('thread-explicit-reply'),
        }
      },
    }))
    await createGoalAttention(fixture.goalStore, 'G-1', 'A-explicit-reply')
    const request = await fixture.workspace.receiveReflectionEvent({
      eventId: 'EV-explicit-question',
      content: 'Ask for the exact answer.',
      context: { projectId: 'P-1', goalId: 'G-1', attentionRefs: [reference] },
    })
    await fixture.workspace.handleEvent(request.attributes.id, {
      reply: 'Please answer this blocker.',
      disposition: 'operator-requested',
      expose: true,
    })
    await fixture.tools.acknowledgeEventAttentions(request.attributes.id)
    const operatorRequest = (await fixture.goalStore.readPackage('G-1')).attentions.get(
      'A-explicit-reply',
    )?.attributes.operatorRequest
    if (!operatorRequest) throw new Error('Expected the exact operator request')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-explicit-answer',
      content: 'Continue.',
      context: {
        projectId: 'P-1',
        goalId: 'G-1',
        attentionRefs: [reference],
        replyTo: operatorRequest,
      },
    })

    await fixture.assistant.process('EV-explicit-answer')

    expect(calls).toBe(1)
    expect(prompts).toHaveLength(1)
    expect((await fixture.workspace.readEvent('EV-explicit-answer'))?.attributes).toMatchObject({
      status: 'handled',
      reply: 'The answer was applied and the original responsibility can continue.',
    })
    expect(
      (await fixture.goalStore.readPackage('G-1')).attentions.get('A-explicit-reply')?.attributes,
    ).toMatchObject({ operatorRequest: null, resolvedAt: expect.any(String) })
  })

  test('keeps a Reflection turn internal and Attention unnotified when speech fails', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        await tools.execute(input.toolToken, 'hopi_request_user', {
          attentionRefs: ['project:P-1/goal:G-1/attention:A-failed'],
        })
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
        await tools.execute(input.toolToken, 'hopi_request_user', {
          attentionRefs: ['project:P-1/goal:G-1/attention:A-retry-ack'],
        })
        return {
          reply: 'Choose the release window.',
          session: codexSession('thread-retry-ack'),
        }
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
    home,
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
  return { homeRoot, workspace, conversation, goalStore, controller, tools, assistant }
}

async function currentAssistantContextDigest(
  workspace: ReturnType<typeof createAssistantWorkspaceStore>,
) {
  return workspaceAssistantContextDigest((await workspace.readWorkspace()).preference.digest)
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
          operatorRequest: null,
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

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
}

function vendorSession(transport: AssistantTransport, sessionId: string) {
  return { transport, sessionId }
}

function codexSession(sessionId: string) {
  return vendorSession('codex', sessionId)
}
