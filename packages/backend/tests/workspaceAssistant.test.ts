import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentRuntimeEvent } from '../src/agent/runtimeEvents'
import type { AssistantTransport } from '../src/agent/vendorAssistantOutput'
import { HOME_ASSISTANT_CONVERSATION_SCOPE } from '../src/assistant/assistantConversationScope'
import { createAssistantConversationStore } from '../src/assistant/assistantConversationStore'
import {
  type AssistantStateReader,
  type AssistantStateSnapshot,
  createAssistantStateReader,
} from '../src/assistant/assistantState'
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
import { parseWorkDocument, renderWorkDocument } from '../src/domain/canonicalDocuments'
import { PublicationCoordinator, hashBytes } from '../src/publication/publisher'
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
import { publishTestWorkAttention } from './helpers/testGoalAttention'

const temporaryRoot = join(process.cwd(), 'tests', 'tmp', 'workspace-assistant')

beforeEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
  await mkdir(temporaryRoot, { recursive: true })
})

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true })
})

describe('WorkspaceAssistant conversation', () => {
  test('exposes the same browser environment to user and system turns', async () => {
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
      const internal = await runner.prepare?.({ cwd, toolMode: 'internal' })

      expect(main?.browserEnvironment).toEqual({
        command: browserHarnessAdapterCommand(),
        backendCommand: fakeHarness,
        homeRoot,
        targetsFile: join(cwd, 'browser-targets.json'),
        writableRoot: browserEnvironmentRoot(homeRoot),
      })
      expect(main?.environment.writableRoots).toContain(browserEnvironmentRoot(homeRoot))
      expect(internal?.browserEnvironment).toEqual(main?.browserEnvironment)
      expect(internal?.environment).toMatchObject({
        ...main?.environment,
        hopiToolMode: 'internal',
      })
    } finally {
      restoreEnvironment('HOPI_BROWSER_HARNESS_COMMAND', previousHarness)
      restoreEnvironment('HOPI_BROWSER_CHROME_COMMAND', previousChrome)
    }
  })

  test('runs Claude with isolated HOPI tools, native resume, and complete final output', async () => {
    const binary = join(temporaryRoot, 'fake-claude')
    const argsFile = join(temporaryRoot, 'claude-args.json')
    const promptFile = join(temporaryRoot, 'claude-prompt.txt')
    const cacheFile = join(temporaryRoot, 'claude-cache.txt')
    const homeRoot = join(temporaryRoot, 'home')
    const finalReply = 'x'.repeat(800)
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        `await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)))`,
        `await Bun.write(${JSON.stringify(promptFile)}, await Bun.stdin.text())`,
        `await Bun.write(${JSON.stringify(cacheFile)}, process.env.HOPI_CACHE_DIR ?? "")`,
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
      homeRoot,
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
    const systemPrompt = args[args.indexOf('--append-system-prompt') + 1]
    expect(systemPrompt).toContain('Role: HOPI Project owner')
    expect(systemPrompt).toContain('Each Engineering Work receives every Repo binding')
    expect(systemPrompt).toContain('do not create or replace Goal or Engineering Work delivery')
    expect(args).not.toContain('--allowedTools')
    expect(settings).toEqual({ sandbox: { enabled: false } })
    expect(args).not.toContain('--add-dir')
    expect(mcpConfig.mcpServers.hopi.env.HOPI_TOOL_TOKEN).toBe('claude-token')
    expect(await Bun.file(promptFile).text()).toContain(imagePath)
    expect(await Bun.file(cacheFile).text()).toBe(join(homeRoot, '.hopi', 'cache'))
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

  test('redacts inherited secrets from Assistant diagnostics and public output', async () => {
    const binary = join(temporaryRoot, 'fake-claude-secret-output')
    const secret = 'assistant-secret-value'
    await Bun.write(
      binary,
      [
        '#!/usr/bin/env bun',
        'console.log(JSON.stringify({type:"system",subtype:"init",session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:process.env.HOPI_TEST_SECRET_TOKEN}]},session_id:"claude-session"}))',
        'console.log(JSON.stringify({type:"result",subtype:"success",session_id:"claude-session",result:process.env.HOPI_TEST_SECRET_TOKEN}))',
        '',
      ].join('\n'),
    )
    await chmod(binary, 0o755)
    const previous = process.env.HOPI_TEST_SECRET_TOKEN
    process.env.HOPI_TEST_SECRET_TOKEN = secret
    try {
      const cwd = join(temporaryRoot, 'assistant-secret')
      const runner = createConfiguredAssistantModelRunner({
        resolveConfig: () => ({
          transport: 'claude',
          cwdMode: 'root',
          binary,
          permissionMode: 'dontAsk',
        }),
        resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
      })
      const events: AgentRuntimeEvent[] = []

      const result = await runner.run(
        {
          eventId: 'EV-secret',
          prompt: 'Report the environment.',
          session: null,
          cwd,
          lastMessageFile: join(cwd, 'last-message.txt'),
          transcriptFile: join(cwd, 'transcript.log'),
          toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
          toolToken: 'assistant-tool-token',
        },
        {
          onEvent: (event) => {
            events.push(event)
          },
        },
      )

      expect(result.reply).toBe('[REDACTED_SECRET]')
      expect(await Bun.file(join(cwd, 'last-message.txt')).text()).toBe('[REDACTED_SECRET]')
      expect(await Bun.file(join(cwd, 'transcript.log')).text()).not.toContain(secret)
      expect(JSON.stringify(events)).not.toContain(secret)
    } finally {
      restoreEnvironment('HOPI_TEST_SECRET_TOKEN', previous)
    }
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
    expect(config.instructions).toEqual([join(cwd, 'hopi-assistant-instructions.md')])
    const opencodeInstructions = await Bun.file(config.instructions[0]).text()
    expect(opencodeInstructions).toContain('Role: HOPI Project owner')
    expect(opencodeInstructions).toContain('Each Engineering Work receives every Repo binding')
    expect(opencodeInstructions).toContain(
      'do not create or replace Goal or Engineering Work delivery',
    )
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
      eventId: 'EV-system-1',
      prompt: 'Inspect the Project event.',
      session: null,
      cwd: join(temporaryRoot, 'internal'),
      lastMessageFile: join(temporaryRoot, 'internal', 'last-message.txt'),
      transcriptFile: join(temporaryRoot, 'internal', 'transcript.log'),
      toolUrl: 'http://127.0.0.1:3000/api/internal/assistant-tool',
      toolToken: 'internal-token',
      toolMode: 'internal',
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 20)

    await expect(run).rejects.toThrow('interrupted')
  })

  test('accepts an empty configured Codex message only for an internal wake', async () => {
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

    const run = (eventId: string, toolMode?: 'internal') => {
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

    await expect(run('EV-internal-empty', 'internal')).resolves.toEqual({
      reply: '',
      session: codexSession('thread-empty'),
    })
    const internalArgs = JSON.parse(
      await Bun.file(join(temporaryRoot, 'EV-internal-empty', 'last-message.txt.args')).text(),
    ) as string[]
    expect(internalArgs).toContain('workspace-write')
    expect(internalArgs).toContain('sandbox_workspace_write.network_access=true')
    expect(internalArgs).not.toContain('skills.include_instructions=false')
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
    expect(args).toContain('shell_environment_policy.inherit=all')
    expect(args).not.toContain('skills.include_instructions=false')
    expect(args).not.toContain('skills.bundled.enabled=false')
    expect(args).toContain('include_apps_instructions=false')
    expect(args).not.toContain('agents.enabled=false')
    expect(args).not.toContain('include_collaboration_mode_instructions=false')
    const developerInstructions = args.find((arg) => arg.startsWith('developer_instructions='))
    expect(developerInstructions).toContain('Role: HOPI Project owner')
    expect(developerInstructions).toContain('Each Engineering Work receives every Repo binding')
    expect(developerInstructions).toContain(
      'do not create or replace Goal or Engineering Work delivery',
    )
    for (const feature of ['apps', 'goals', 'memories', 'plugins']) {
      expect(args).toContain(feature)
      expect(args[args.indexOf(feature) - 1]).toBe('--disable')
    }
    expect(args).toContain('multi_agent')
    expect(args[args.indexOf('multi_agent') - 1]).toBe('--disable')
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

  test('HOPI-E2E-010 supplies bounded page context without inventing Goal effects', async () => {
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
    await fixture.goalStore.createGoal({
      goalId: 'G-1',
      title: 'Goal',
      objective: 'Ship it.',
      acceptedInput: {
        attributes: {
          sourceHomeId: 'H-1',
          sourceEventId: 'EV-accepted',
          sourceDigest: 'a'.repeat(64),
          attachments: [],
        },
        body: 'Use the current repository configuration.\n',
      },
    })
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
    expect(goalPackage.inputs).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({ sourceEventId: 'EV-accepted' }),
      }),
    ])
    expect(
      [...goalPackage.works.values()].filter((work) => work.attributes.stage === 'plan'),
    ).toHaveLength(0)
    expect(seen[0]?.sessionId).toBeNull()
    expect(seen[0]?.prompt).toContain('[Preferred page context: P-1 / G-1]')
    expect(seen[0]?.prompt).not.toContain('[Current execution environment observation]')
    expect(seen[0]?.prompt).not.toContain('[Current scoped HOPI state observation]')
    expect(seen[0]?.prompt).toContain('[Current Project state and unresolved Attention')
    expect(seen[0]?.prompt).toContain('"lifecycle": "active"')
    expect(seen[0]?.prompt).toContain('"acceptedInputs"')
    expect(seen[0]?.prompt).toContain('Use the current repository configuration.')
    expect(seen[0]?.prompt).toContain('EV-accepted.md')
    expect(seen[0]?.prompt).not.toContain('Role: HOPI Project owner')
    expect(seen[0]?.prompt).not.toContain('Each Engineering Work receives every Repo binding')
    expect(seen[0]?.prompt).toContain(
      'holds new responsibility dispatch for that Project until this turn settles',
    )
    expect(seen[0]?.prompt).toContain(
      'A Work requested in this turn can start only after the turn settles',
    )
    expect(seen[0]?.prompt).toContain('Inspect proposed Work bodies, not only DAG shape')
    expect(seen[0]?.prompt).toContain(
      'request same-contract Planning and name the mixed boundaries',
    )
    expect(seen[0]?.prompt).toContain(
      'A named test suite, browser harness, adapter, or application is a proof container',
    )
    expect(seen[0]?.prompt).toContain(
      'useful buildable candidate with intentionally deferred behavior',
    )
    expect(seen[0]?.prompt).toContain('Do not demand headings or formulaic output')
    expect(seen[0]?.prompt).toContain('Current authority is ordered by meaning, not recency')
    expect(seen[0]?.prompt).toContain(
      'current turn and current Goal accepted Inputs, design/runbook, and current source facts outrank Project conversation history',
    )
    expect(seen[0]?.prompt).toContain(
      'Do not resolve and recreate the same condition as workspace Attention merely to paraphrase it',
    )
    expect(seen[0]?.prompt).toContain(
      'verify that current authority or a concrete current source consumer establishes what it is and how it is consumed',
    )
    expect(seen[0]?.prompt).toContain(
      'put the complete operator action in the Attention summary or decisionPrompt',
    )
    expect(seen[0]?.prompt).not.toContain('Assistant shell effects end with the turn')
    expect(seen[0]?.prompt).not.toContain('Reply with outcome and action in 1-2 sentences')
    expect(seen[0]?.prompt).toContain('normal user entry opens')
    expect(seen[0]?.prompt).toContain('authentication may be mocked')
    expect(seen[0]?.prompt).toContain('useful data is visible')
    expect(seen[0]?.prompt).toContain('Prefer local data; fall back to DEV')
    expect(seen[0]?.prompt).toContain('only entries the operator should open as surfaces')
    expect(seen[0]?.prompt).toContain('docs/hopi/preview/runbook.md is free-form Project guidance')
    expect(seen[0]?.prompt).toContain(
      'A user-initiated Preview Start already requests a working Preview',
    )
    expect(seen[0]?.prompt).toContain('read only the session status and bounded log summary')
    expect(seen[0]?.prompt).toContain(
      'do not inspect source, reproduce services, or find the root cause in Assistant',
    )
    expect(seen[0]?.prompt).toContain('immediately create the smallest experience-oriented Goal')
    expect(seen[0]?.prompt).toContain(
      'Generator owns exploration, reproduction, runbook maintenance',
    )
    expect(seen[0]?.prompt).toContain('Do not wait for a second repair message')
    expect(seen[0]?.prompt).toContain('A Preview failure is only evidence')
    expect(seen[0]?.prompt).toContain('does not define the Goal around the failing service')
    expect(seen[0]?.prompt).toContain(
      'Create Preview Goal and Work contracts in experience terms only',
    )
    expect(seen[0]?.prompt).toContain('do not prescribe services, root causes, live authentication')
    expect(seen[0]?.prompt).toContain('do not prohibit mock authentication or local sample data')
    expect(seen[0]?.prompt).toContain(
      'Old runbook and adapter implementation restrictions are revisable technical history',
    )
    expect(seen[0]?.prompt).toContain('runbook and source first, then relevant knowledge')
    expect(seen[0]?.prompt).toContain(
      'one short question only when a necessary fact remains unavailable',
    )
    expect(seen[0]?.prompt).toContain('shortest working path')
    expect(seen[0]?.prompt).toContain('may mock authentication or provide local sample data')
    expect(seen[0]?.prompt).toContain('browser-checks before broad builds or test suites')
    expect(seen[0]?.prompt).toContain('page opens with useful data and one basic interaction works')
    expect(seen[0]?.prompt).toContain('Do not expand it to unrelated services')
    expect(seen[0]?.prompt).toContain('transport reachability alone cannot pass')
    expect(seen[0]?.prompt).toContain('do not add a database approval gate')
    expect(seen[0]?.prompt).not.toContain(
      'must not replace a missing fact with exhaustive discovery',
    )
    expect(seen[0]?.prompt).not.toContain('omit internals unless asked or decision-relevant')
    expect(seen[0]?.prompt).not.toContain('Only HOPI operatorUrl is linkable')
    expect(seen[0]?.prompt).toContain('task worktrees are disposable')
    expect(seen[0]?.prompt).toContain('$HOPI_CACHE_DIR persists')
    expect(seen[0]?.prompt).toContain('detached descendants have no HOPI lifecycle')
    expect(seen[0]?.prompt).toContain('Provider workspace and task worktrees are disposable')
    expect(seen[0]?.prompt).not.toContain('answer without polling')
    expect(seen[0]?.prompt).not.toContain('[Operator-facing reply contract]')
    expect(seen[0]?.prompt).not.toContain('Default to one or two short sentences')
    expect(seen[0]?.prompt.length).toBeLessThan(10_000)
    expect((await fixture.conversation.readTurn('EV-1'))?.manifest.status).toBe('completed')
  })

  test('lets the model refresh current Goal state when it requests it', async () => {
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

    expect(prompt).toContain('[Current Project state and unresolved Attention')
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
    expect(prompts[0]).not.toContain('Role: HOPI Project owner')
    expect(prompts[0]).toContain(
      'holds new responsibility dispatch for that Project until this turn settles',
    )
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

  test('rebuilds from bounded public history without internal Wake briefs', async () => {
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
    await fixture.workspace.receiveSystemEvent({
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

  test('publishes a presented Attention even when the model adds no duplicate reply text', async () => {
    const fixture = await setup((tools) => ({
      async run(input) {
        const created = await tools.execute(input.toolToken, 'hopi_manage_attention', {
          projectId: 'P-1',
          change: {
            kind: 'create',
            attentionId: 'A-choice',
            summary: 'Choose the deployment owner.',
            body: 'The external deployment requires operator authority.',
            refs: [],
          },
        })
        await tools.execute(input.toolToken, 'hopi_manage_attention', {
          projectId: 'P-1',
          change: {
            kind: 'present_attention_to_user',
            attentionRefs: [(created.value as { attentionRef: string }).attentionRef],
          },
        })
        return { reply: '', session: codexSession('thread-attention-transfer') }
      },
    }))
    await fixture.workspace.receiveEvent({
      eventId: 'EV-attention-transfer',
      content: 'Prepare the deployment decision.',
      context: { projectId: 'P-1' },
    })

    await fixture.assistant.process('EV-attention-transfer')

    expect((await fixture.workspace.readEvent('EV-attention-transfer'))?.attributes).toMatchObject({
      status: 'handled',
      visibility: 'public',
      reply: 'Your input is needed.',
      attentionRequest: {
        attentionRefs: [expect.stringContaining('/attention:A-choice')],
      },
    })
  })

  test('processes a system event in the Project session without treating it as user speech', async () => {
    const prompts: string[] = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        prompts.push(input.prompt)
        await observer?.onSession?.(codexSession('thread-1'))
        return { reply: '', session: codexSession('thread-1') }
      },
    }))
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-system',
      content: 'A Work stage changed; revalidate whether action is useful.',
    })

    await fixture.assistant.process('EV-system')

    const event = await fixture.workspace.readEvent('EV-system')
    expect(event?.attributes).toMatchObject({
      source: 'system',
      visibility: 'internal',
      status: 'handled',
    })
    expect(prompts[0]).toContain('Project system event. This is not operator input.')
    expect(prompts[0]).toContain('A non-empty final response becomes the public update')
    expect(prompts[0]).not.toContain('User: A Work stage changed')
  })

  test('processes a durable internal observation against current state after its digest advances', async () => {
    let modelCalls = 0
    const prompts: string[] = []
    const fixture = await setup(() => ({
      async run(input) {
        modelCalls += 1
        prompts.push(input.prompt)
        return { reply: '', session: codexSession('thread-current') }
      },
    }))
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-stale-observation',
      content: 'A previously observed Project failure.',
      context: {
        projectId: 'P-1',
        observedDigest: '0'.repeat(64),
      },
    })

    expect(await fixture.assistant.process('EV-stale-observation')).toEqual({
      kind: 'answered',
      eventId: 'EV-stale-observation',
    })

    expect(modelCalls).toBe(1)
    expect(await fixture.conversation.readTurn('EV-stale-observation')).not.toBeNull()
    expect(prompts[0]).toContain('A previously observed Project failure.')
    expect(prompts[0]).toContain('[Current supervision facts;')
    expect((await fixture.workspace.readEvent('EV-stale-observation'))?.attributes).toMatchObject({
      source: 'system',
      visibility: 'internal',
      status: 'handled',
      reply: null,
      disposition: 'silent',
    })

    const currentDigest = (await fixture.state.read({ projectId: 'P-1', attemptHistoryLimit: 12 }))
      .conversationDigests.projects['P-1']
    if (!currentDigest) throw new Error('Missing current Project conversation digest')
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-current-observation',
      content: 'The current Project observation.',
      context: {
        projectId: 'P-1',
        observedDigest: currentDigest,
      },
    })

    await fixture.assistant.process('EV-current-observation')

    expect(modelCalls).toBe(2)
    expect((await fixture.workspace.readEvent('EV-current-observation'))?.attributes).toMatchObject(
      {
        status: 'handled',
        visibility: 'internal',
        disposition: 'silent',
      },
    )
  })

  test('supplies a complete compact state index instead of slicing away later failed Work', async () => {
    const prompts: string[] = []
    const stateReads: Array<{
      projectId?: string
      goalId?: string
      attemptHistoryLimit?: number
    }> = []
    const oversizedArchiveBody = `archive-${'x'.repeat(40_000)}-archive-end`
    const snapshot = {
      observedAt: '2026-07-26T15:09:24.000Z',
      stateDigest: 'a'.repeat(64),
      conversationDigests: {
        home: 'b'.repeat(64),
        projects: { 'P-1': 'c'.repeat(64) },
      },
      activeRuns: [],
      workspaceAttentions: [],
      projects: [
        {
          projectId: 'P-1',
          projectRoot: '/canonical/project',
          available: true,
          releaseHead: 'release-head',
          goals: [
            {
              goal: {
                attributes: { id: 'G-1', lifecycle: 'active' },
                body: oversizedArchiveBody,
                path: '/canonical/G-1/goal.md',
              },
              acceptedInputs: [],
              design: [],
              attentions: [],
              latestPlanningOutcome: null,
              works: [
                {
                  attributes: { id: 'W-a', stage: 'generate' },
                  body: oversizedArchiveBody,
                  path: '/canonical/G-1/works/W-a.md',
                  projection: { failedPredicates: [] },
                  runtime: {
                    activeResponsibility: null,
                    latestAttempt: null,
                    attemptCount: 0,
                    recentAttempts: [],
                  },
                },
                {
                  attributes: { id: 'W-z-failed', stage: 'review' },
                  path: '/canonical/G-1/works/W-z-failed.md',
                  projection: { failedPredicates: ['failed_attempt'] },
                  runtime: {
                    activeResponsibility: null,
                    latestAttempt: {
                      runId: 'R-failed',
                      responsibility: 'reviewer',
                      status: 'finished',
                      result: 'fail',
                      application: 'operational_failure',
                      summary: 'stream disconnected before completion',
                    },
                    attemptCount: 1,
                    recentAttempts: [],
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as AssistantStateSnapshot
    const fixture = await setup(
      () => ({
        async run(input, observer) {
          prompts.push(input.prompt)
          await observer?.onSession?.(codexSession('thread-complete-state'))
          return { reply: '', session: codexSession('thread-complete-state') }
        },
      }),
      {
        assistantState: {
          async read(input = {}) {
            stateReads.push(input)
            return snapshot
          },
          async readForWake() {
            return snapshot
          },
        },
      },
    )
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-complete-state',
      content: 'Revalidate current Project state.',
      context: { projectId: 'P-1' },
    })

    await fixture.assistant.process('EV-complete-state')

    expect(stateReads).toEqual([{ projectId: 'P-1', attemptHistoryLimit: 12 }])
    const encoded = prompts[0]?.match(/```json\n([\s\S]*?)\n```/)?.[1]
    expect(encoded).toBeDefined()
    const current = JSON.parse(encoded ?? '{}')
    expect(current.projects[0].goals[0].works).toHaveLength(2)
    expect(current.projects[0].goals[0].works[0].body).toContain('archive-')
    expect(current.projects[0].goals[0].works[0].body).toContain(
      '[content omitted; inspect the canonical path for the full document]',
    )
    expect(current.projects[0].goals[0].works[1]).toMatchObject({
      path: '/canonical/G-1/works/W-z-failed.md',
      projection: { failedPredicates: ['failed_attempt'] },
      runtime: {
        latestAttempt: {
          runId: 'R-failed',
          result: 'fail',
          application: 'operational_failure',
        },
      },
    })
    expect(current.projects[0].goals[0].works[1]).not.toHaveProperty('schedulingEffect')
    expect(prompts[0]).not.toContain('archive-end')
    expect(prompts[0]).not.toContain('... truncated')
  })

  test('accepts a transient continuation-only internal handoff without a second model call', async () => {
    let calls = 0
    const fixture = await setup((tools) => ({
      async run(input) {
        calls += 1
        await tools.execute(input.toolToken, 'hopi_control_work', {
          projectId: 'P-1',
          goalId: 'G-1',
          workId: 'plan-initial',
          action: { kind: 'continue' },
        })
        return { reply: '', session: codexSession('thread-atomic-retry') }
      },
    }))
    await fixture.goalStore.createGoal({ goalId: 'G-1', title: 'Goal', objective: 'Ship it.' })
    const attention = await publishTestWorkAttention(
      fixture.goalStore,
      'G-1',
      'plan-initial',
      3,
      'stream disconnected before completion',
    )
    await fixture.workspace.receiveSystemEvent({
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
    const current = (await fixture.goalStore.readPackage('G-1')).attentions.get(
      attention.attributes.id,
    )
    expect(current?.attributes.resolvedAt).toBeNull()
  })

  test('keeps supervision on a native branch and delivers only its action receipt to speaking', async () => {
    const seen: Array<{
      eventId: string
      invocation: string | undefined
      sessionId: string | null
      prompt: string
    }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({
          eventId: input.eventId,
          invocation: input.invocation,
          sessionId: input.session?.sessionId ?? null,
          prompt: input.prompt,
        })
        if (input.invocation === 'supervision') {
          await observer?.onSession?.(codexSession('thread-branch'))
          return {
            reply: 'Adjusted the Work contract.',
            session: codexSession('thread-branch'),
          }
        }
        await observer?.onSession?.(codexSession('thread-parent'))
        return {
          reply: input.eventId === 'EV-user-1' ? 'Started.' : 'Current state is aligned.',
          session: codexSession('thread-parent'),
        }
      },
    }))
    const context = { projectId: 'P-1' }
    const scope = { kind: 'project', projectId: 'P-1' } as const
    await fixture.workspace.receiveEvent({
      eventId: 'EV-user-1',
      content: 'Start.',
      context,
    })
    await fixture.assistant.process('EV-user-1')
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-wake-1',
      content: 'A Reviewer rejected the current candidate.',
      context,
    })
    await fixture.assistant.process('EV-wake-1')

    expect(await fixture.conversation.readSession({ kind: 'project', projectId: 'P-1' })).toEqual(
      codexSession('thread-parent'),
    )
    expect(await fixture.conversation.readPendingActionReceipts(scope)).toMatchObject([
      {
        eventId: 'EV-wake-1',
        kind: 'reply',
        summary: 'Adjusted the Work contract.',
      },
    ])

    await fixture.workspace.receiveEvent({
      eventId: 'EV-user-2',
      content: 'What changed?',
      context,
    })
    await fixture.assistant.process('EV-user-2')

    expect(seen).toMatchObject([
      { eventId: 'EV-user-1', invocation: 'speaking', sessionId: null },
      { eventId: 'EV-wake-1', invocation: 'supervision', sessionId: 'thread-parent' },
      { eventId: 'EV-user-2', invocation: 'speaking', sessionId: 'thread-parent' },
    ])
    expect(seen[2]?.prompt).toContain('Confirmed actions completed by supervision forks')
    expect(seen[2]?.prompt).toContain('Adjusted the Work contract.')
    expect(await fixture.conversation.readPendingActionReceipts(scope)).toEqual([])
  })

  test('bootstraps the scoped speaking session from the first internal event', async () => {
    const seen: Array<{
      eventId: string
      invocation: string | undefined
      sessionId: string | null
    }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({
          eventId: input.eventId,
          invocation: input.invocation,
          sessionId: input.session?.sessionId ?? null,
        })
        if (input.invocation === 'supervision') {
          await observer?.onSession?.(codexSession('thread-branch'))
          return { reply: '', session: codexSession('thread-branch') }
        }
        await observer?.onSession?.(codexSession('thread-parent'))
        return {
          reply: input.eventId === 'EV-user' ? 'Current state.' : '',
          session: codexSession('thread-parent'),
        }
      },
    }))
    const context = { projectId: 'P-1' }
    const scope = { kind: 'project', projectId: 'P-1' } as const
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-bootstrap',
      content: 'The first Project runtime event.',
      context,
    })
    await fixture.assistant.process('EV-bootstrap')
    expect(await fixture.conversation.readSession(scope)).toEqual(codexSession('thread-parent'))
    const bootstrapTurn = await fixture.conversation.readTurn('EV-bootstrap')
    expect(bootstrapTurn?.events).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'coordinator',
        content:
          'Established native codex speaking Session thread-parent from the internal bootstrap.',
      }),
    )
    expect(
      bootstrapTurn?.events.some(
        (event) => event.kind === 'message' && event.content.startsWith('Forked speaking Session'),
      ),
    ).toBe(false)
    expect((await fixture.workspace.readEvent('EV-bootstrap'))?.attributes).toMatchObject({
      source: 'system',
      visibility: 'internal',
      status: 'handled',
    })

    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-follow-up',
      content: 'A later Project runtime event.',
      context,
    })
    await fixture.assistant.process('EV-follow-up')
    await fixture.workspace.receiveEvent({
      eventId: 'EV-user',
      content: 'What is the current state?',
      context,
    })
    await fixture.assistant.process('EV-user')

    expect(seen).toEqual([
      { eventId: 'EV-bootstrap', invocation: 'speaking', sessionId: null },
      { eventId: 'EV-follow-up', invocation: 'supervision', sessionId: 'thread-parent' },
      { eventId: 'EV-user', invocation: 'speaking', sessionId: 'thread-parent' },
    ])
  })

  test('bootstraps from an internal event after the cached session contract is invalidated', async () => {
    const seen: Array<{
      invocation: string | undefined
      sessionId: string | null
    }> = []
    const fixture = await setup(() => ({
      async run(input, observer) {
        seen.push({
          invocation: input.invocation,
          sessionId: input.session?.sessionId ?? null,
        })
        await observer?.onSession?.(codexSession('thread-rebuilt'))
        return { reply: '', session: codexSession('thread-rebuilt') }
      },
    }))
    const scope = { kind: 'project', projectId: 'P-1' } as const
    await fixture.conversation.writeSession(
      scope,
      codexSession('thread-stale'),
      'stale-contract-digest',
      'stale-runtime-digest',
    )
    await fixture.workspace.receiveSystemEvent({
      eventId: 'EV-contract-change',
      content: 'A material Project fact arrived after the Assistant contract changed.',
      context: { projectId: 'P-1' },
    })

    await fixture.assistant.process('EV-contract-change')

    expect(seen).toEqual([{ invocation: 'speaking', sessionId: null }])
    expect(await fixture.conversation.readSession(scope)).toEqual(codexSession('thread-rebuilt'))
    expect((await fixture.workspace.readEvent('EV-contract-change'))?.attributes).toMatchObject({
      source: 'system',
      visibility: 'internal',
      status: 'handled',
      disposition: 'silent',
    })
  })
})

async function setup(
  buildRunner: (tools: ReturnType<typeof createAssistantTools>) => AssistantModelRunner,
  options: { assistantState?: AssistantStateReader } = {},
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
  const controller = createGoalController(goalStore, {})
  const preview = createPreviewManager(homeRoot)
  const attempts = createRunAttemptStore(homeRoot)
  const projects = new Map([
    [
      'P-1',
      {
        projectId: 'P-1',
        projectRoot: linked.integrationRoot,
        sourceRoot: linked.integrationRoot,
        primaryRepoId: linked.primaryRepoId,
        repos: linked.repos,
        store: goalStore,
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
          async settledFailureWorkIds() {
            return new Set<string>()
          },
          async requestWorkRun(goalId: string, workId: string) {
            return attempts.reserve({
              projectId: 'P-1',
              goalId,
              workId,
              runId: 'R-transient-retry',
              responsibility: 'planner',
              workHash: 'a'.repeat(64),
            })
          },
        },
      },
    ],
  ])
  const state = createAssistantStateReader({
    homeRoot,
    workspace,
    projects,
    publisher,
    attempts,
  })
  const tools = createAssistantTools({
    home,
    workspace,
    publisher,
    preview,
    projects,
    state,
    onProjectTopologyChanged() {},
    async onProjectRecoveryRequested() {
      return { eligible: true }
    },
    onGoalEffect() {},
    onProjectDispatchEffect() {},
    onToolEffect() {},
  })
  const assistant = createWorkspaceAssistant({
    homeRoot,
    workspace,
    conversation,
    tools,
    state: options.assistantState ?? state,
    runner: buildRunner(tools),
    resolveToolUrl: () => 'http://127.0.0.1:3000/api/internal/assistant-tool',
    onTurnSettled() {},
    now: () => new Date('2026-07-11T00:00:00Z'),
  })
  return { homeRoot, workspace, conversation, goalStore, controller, tools, state, assistant }
}

async function currentAssistantContextDigest(
  workspace: ReturnType<typeof createAssistantWorkspaceStore>,
) {
  return workspaceAssistantContextDigest((await workspace.readWorkspace()).preference.digest)
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
