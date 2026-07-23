import { createHash } from 'node:crypto'
import { appendFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readClaudeProviderEnvironment } from '../agent/claudeSettingsEnvironment'
import { type ExecutionEnvelope, unreportedExecutionEnvelope } from '../agent/executionEnvelope'
import { createPersistentProcessTranscriptNormalizer } from '../agent/persistentTranscriptNormalizer'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import {
  type AssistantTransport,
  type VendorAssistantTerminalError,
  isExplicitSessionFailure,
  parseVendorAssistantOutput,
} from '../agent/vendorAssistantOutput'
import { isNonFatalProcessDiagnostic } from '../agent/vendorTranscript'
import {
  NON_INTERACTIVE_CODEX_APPROVAL_POLICY,
  type RoleTransportConfig,
  appendClaudeNonInteractivePermission,
  appendCodexHttpsOnlyConfig,
  withNativeCompactionEnabled,
} from '../agent/vendorTransport'
import type { AssistantPreferenceDocument } from '../domain/assistantPreference'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import { normalizeInboxAttentionReferences } from '../domain/attentionReference'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import {
  browserAdapterEnvironment,
  browserEnvironmentRoot,
  browserHarnessAdapterCommand,
  browserTargetManifest,
  resolveBrowserHarnessBackendCommand,
  resolveManagedBrowserCommand,
} from '../runtime/browserEnvironment'
import { createProcessGroupTerminator } from '../runtime/processGroup'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import {
  assistantConversationScopeForEvent,
  assistantEventBelongsToScope,
} from './assistantConversationScope'
import type { AssistantConversationStore, AssistantSession } from './assistantConversationStore'
import type { AssistantTools } from './assistantTools'

export interface AssistantModelInput {
  eventId: string
  projectId?: string
  prompt: string
  rebuildPrompt?: string
  session: AssistantSession | null
  cwd: string
  lastMessageFile: string
  transcriptFile: string
  toolUrl: string
  toolToken: string
  imageFiles?: string[]
  readableRoots?: string[]
  toolMode?: 'main' | 'internal' | 'reflection'
  fullAccess?: boolean
  signal?: AbortSignal
  executionPlan?: AssistantModelExecutionPlan
  browserEnvironment?: AssistantBrowserEnvironment
}

export interface AssistantModelPreparationInput {
  projectId?: string
  cwd: string
  readableRoots?: string[]
  toolMode?: 'main' | 'internal' | 'reflection'
}

export interface AssistantModelExecutionPlan {
  environment: ExecutionEnvelope
  config?: RoleTransportConfig
  fullAccess?: boolean
  browserEnvironment?: AssistantBrowserEnvironment
}

export interface AssistantBrowserEnvironment {
  command: string
  backendCommand: string
  homeRoot: string
  targetsFile: string
  writableRoot: string
}

export interface AssistantModelResult {
  reply: string
  session: AssistantSession
}

export interface AssistantModelObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onSession?(session: AssistantSession): Promise<void> | void
}

export interface AssistantModelRunner {
  prepare?(input: AssistantModelPreparationInput): Promise<AssistantModelExecutionPlan>
  run(input: AssistantModelInput, observer?: AssistantModelObserver): Promise<AssistantModelResult>
}

export interface WorkspaceAssistant {
  process(eventId: string, signal?: AbortSignal): Promise<WorkspaceAssistantResult>
  finalizeNotifications?(): Promise<number>
}

export type WorkspaceAssistantResult = { kind: 'answered'; eventId: string }

export class WorkspaceAssistantError extends Error {}

export class AssistantSessionUnavailableError extends WorkspaceAssistantError {}

export function createConfiguredAssistantModelRunner(options: {
  resolveConfig(): RoleTransportConfig | Promise<RoleTransportConfig>
  resolveToolUrl(): string
  fullAccess?(projectId: string): boolean | Promise<boolean>
  homeRoot?: string
}): AssistantModelRunner {
  async function prepare(
    input: AssistantModelPreparationInput,
  ): Promise<AssistantModelExecutionPlan> {
    const config = await options.resolveConfig()
    if (
      config.transport !== 'codex' &&
      config.transport !== 'claude' &&
      config.transport !== 'opencode'
    ) {
      throw new WorkspaceAssistantError('Workspace Assistant requires a built-in vendor transport')
    }
    const fullAccess =
      input.toolMode !== 'reflection' && input.projectId
        ? ((await options.fullAccess?.(input.projectId)) ?? false)
        : false
    const browserEnvironment = resolveAssistantBrowserEnvironment(
      options.homeRoot,
      input,
      config,
      fullAccess,
    )
    return {
      config,
      fullAccess,
      browserEnvironment,
      environment: assistantExecutionEnvelope(
        config,
        input,
        fullAccess,
        browserEnvironment?.writableRoot,
      ),
    }
  }

  return {
    prepare,
    async run(input, observer) {
      const plan = input.executionPlan ?? (await prepare(input))
      const config = plan.config
      if (!config) throw new WorkspaceAssistantError('Configured Assistant plan has no transport')
      if (
        config.transport !== 'codex' &&
        config.transport !== 'claude' &&
        config.transport !== 'opencode'
      ) {
        throw new WorkspaceAssistantError(
          'Workspace Assistant requires a built-in vendor transport',
        )
      }
      const transport = config.transport
      const session = input.session?.transport === transport ? input.session : null
      const invocation = {
        ...input,
        fullAccess: plan.fullAccess ?? false,
        prompt: appendBrowserEnvironment(
          session ? input.prompt : (input.rebuildPrompt ?? input.prompt),
          plan.browserEnvironment,
        ),
        rebuildPrompt: appendBrowserEnvironment(
          input.rebuildPrompt ?? input.prompt,
          plan.browserEnvironment,
        ),
        session,
        toolUrl: options.resolveToolUrl(),
        browserEnvironment: plan.browserEnvironment,
      }
      await mkdir(input.cwd, { recursive: true })
      await rm(input.lastMessageFile, { force: true })
      if (invocation.browserEnvironment) {
        await Bun.write(
          invocation.browserEnvironment.targetsFile,
          `${JSON.stringify(browserTargetManifest(), null, 2)}\n`,
        )
      }
      await prepareAssistantWorkspace(config, invocation)
      if (transport === 'opencode') await validateOpencodeMcp(config, invocation)

      if (input.signal?.aborted)
        throw new WorkspaceAssistantError('Assistant model run interrupted')
      const command = buildAssistantCommand(config, invocation)
      const providerEnvironment =
        transport === 'claude' ? await readClaudeProviderEnvironment() : {}
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
        env: withNativeCompactionEnabled(transport, {
          ...process.env,
          ...providerEnvironment,
          ...(invocation.browserEnvironment
            ? {
                ...browserAdapterEnvironment(
                  invocation.browserEnvironment.homeRoot,
                  invocation.browserEnvironment.backendCommand,
                ),
                HOPI_BROWSER_HARNESS_COMMAND: invocation.browserEnvironment.command,
                HOPI_BROWSER_TARGETS_FILE: invocation.browserEnvironment.targetsFile,
              }
            : {}),
          ...(transport === 'opencode'
            ? {
                OPENCODE_CONFIG: assistantOpencodeConfigPath(input.cwd),
                PWD: input.cwd,
              }
            : {}),
        }),
        detached: true,
      })
      const terminate = createProcessGroupTerminator(child.pid)
      const abort = () => void terminate()
      input.signal?.addEventListener('abort', abort, { once: true })
      if (typeof child.stdin !== 'number' && child.stdin) {
        child.stdin.write(assistantPrompt(config, invocation))
        child.stdin.end()
      }

      let observedSessionId = session?.sessionId ?? null
      const stderr = new BoundedLineTail()
      let finalReply = ''
      let finalMessageId: string | undefined
      let terminalError: VendorAssistantTerminalError | undefined
      const transcriptFormat = assistantTranscriptFormat(transport)
      const transcriptNormalizer = await createPersistentProcessTranscriptNormalizer({
        stateFile: join(input.cwd, 'transcript-normalizer.json'),
        resumeState: transport === 'claude' && session?.transport === 'claude',
      })

      const consume = async (stream: 'stdout' | 'stderr', line: string) => {
        await appendFile(input.transcriptFile, `${stream}: ${line}\n`)
        if (stream === 'stdout') {
          const output = parseVendorAssistantOutput(transport, line)
          if (output.terminalError) {
            terminalError = output.terminalError
          } else {
            if (output.sessionId && output.sessionId !== observedSessionId) {
              observedSessionId = output.sessionId
              await observer?.onSession?.({ transport, sessionId: output.sessionId })
            }
            if (output.finalText) {
              finalReply = output.finalText
              finalMessageId = output.messageId
            } else if (output.assistantText) {
              if (output.messageId && output.messageId !== finalMessageId) {
                finalReply = output.assistantText
                finalMessageId = output.messageId
              } else {
                finalReply += `${finalReply ? '\n' : ''}${output.assistantText}`
              }
            }
          }
        } else if (!isNonFatalProcessDiagnostic({ format: transcriptFormat, stream, line })) {
          stderr.push(line)
        }

        for (const event of await transcriptNormalizer.normalize({
          format: transcriptFormat,
          stream,
          role: 'assistant',
          line,
        })) {
          await observer?.onEvent?.(event)
        }
      }

      let exitCode: number
      try {
        const results = await Promise.all([
          child.exited.then(async (exitCode) => {
            try {
              await terminate()
            } catch (error) {
              await consume('stderr', `Process-group cleanup failed: ${errorMessage(error)}`)
              throw error
            }
            return exitCode
          }),
          consumeLines(child.stdout as ReadableStream<Uint8Array>, (line) =>
            consume('stdout', line),
          ),
          consumeLines(child.stderr as ReadableStream<Uint8Array>, (line) =>
            consume('stderr', line),
          ),
        ])
        exitCode = results[0]
      } finally {
        input.signal?.removeEventListener('abort', abort)
      }
      if (input.signal?.aborted)
        throw new WorkspaceAssistantError('Assistant model run interrupted')
      if (terminalError) {
        const ErrorType = terminalError.sessionInvalid
          ? AssistantSessionUnavailableError
          : WorkspaceAssistantError
        throw new ErrorType(terminalError.message)
      }
      if (exitCode !== 0) {
        const detail = stderr.last() ?? 'no error detail'
        const message = `${transport} conversation exited with code ${exitCode}: ${detail}`
        if (session && isExplicitSessionFailure(detail)) {
          throw new AssistantSessionUnavailableError(message)
        }
        throw new WorkspaceAssistantError(message)
      }

      if (!observedSessionId) {
        throw new WorkspaceAssistantError(`${transport} did not report a conversation session ID`)
      }
      if (transport !== 'codex') {
        await Bun.write(input.lastMessageFile, finalReply)
      }

      const file = Bun.file(input.lastMessageFile)
      if (!(await file.exists())) {
        throw new WorkspaceAssistantError(`${transport} did not produce a final Assistant message`)
      }
      const reply = (await file.text()).trim()
      if (!reply && (input.toolMode ?? 'main') === 'main')
        throw new WorkspaceAssistantError(`${transport} produced an empty Assistant message`)
      return { reply, session: { transport, sessionId: observedSessionId } }
    },
  }
}

function resolveAssistantBrowserEnvironment(
  homeRoot: string | undefined,
  input: AssistantModelPreparationInput,
  config: Extract<RoleTransportConfig, { transport: 'codex' | 'claude' | 'opencode' }>,
  fullAccess: boolean,
): AssistantBrowserEnvironment | undefined {
  if (
    !homeRoot ||
    input.toolMode === 'reflection' ||
    (config.transport === 'opencode' && !fullAccess)
  ) {
    return undefined
  }
  const backendCommand = resolveBrowserHarnessBackendCommand()
  if (!backendCommand || !resolveManagedBrowserCommand()) return undefined
  return {
    command: browserHarnessAdapterCommand(),
    backendCommand,
    homeRoot: resolve(homeRoot),
    targetsFile: join(input.cwd, 'browser-targets.json'),
    writableRoot: browserEnvironmentRoot(homeRoot),
  }
}

function appendBrowserEnvironment(
  prompt: string,
  environment: AssistantBrowserEnvironment | undefined,
) {
  if (!environment) return prompt
  return [
    prompt,
    '',
    '## Browser environment',
    '',
    'Browser harness: $HOPI_BROWSER_HARNESS_COMMAND',
    'Browser targets: $HOPI_BROWSER_TARGETS_FILE',
  ].join('\n')
}

function assistantExecutionEnvelope(
  config: Extract<RoleTransportConfig, { transport: 'codex' | 'claude' | 'opencode' }>,
  input: AssistantModelPreparationInput,
  fullAccess: boolean,
  browserWritableRoot?: string,
): ExecutionEnvelope {
  const reflection = input.toolMode === 'reflection'
  const opencodeBounded = config.transport === 'opencode' && !fullAccess
  const mode = reflection ? 'read-only' : fullAccess ? 'unrestricted' : 'bounded'
  return {
    transport: config.transport,
    mode,
    runtimeWorkspace: input.cwd,
    runtimeWorkspaceRole: 'provider scratch space',
    runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable',
    readableRoots: fullAccess ? ['*'] : [...new Set([input.cwd, ...(input.readableRoots ?? [])])],
    writableRoots: fullAccess
      ? ['*']
      : reflection || opencodeBounded
        ? []
        : [input.cwd, ...(browserWritableRoot ? [browserWritableRoot] : [])],
    networkAccess: fullAccess || (!reflection && !opencodeBounded),
    subprocessAccess: fullAccess || (!reflection && !opencodeBounded),
    privilegeEscalation: false,
    hostEnvironmentMutation: fullAccess,
    linkedSourceAccess: fullAccess ? 'read-write' : 'read-only',
    canonicalMutation: 'hopi-tools-only',
    ...(input.toolMode ? { hopiToolMode: input.toolMode } : {}),
  }
}

export function createWorkspaceAssistant(input: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  conversation: AssistantConversationStore
  tools: AssistantTools
  runner: AssistantModelRunner
  resolveToolUrl(): string
  onTurnSettled?(eventId: string): Promise<void> | void
  now?: () => Date
}): WorkspaceAssistant {
  const now = input.now ?? (() => new Date())
  const workspaceRoot = join(resolve(input.homeRoot), '.hopi', 'runtime', 'assistant', 'workspace')
  const runtimeDigest = workspaceAssistantRuntimeDigest(input.homeRoot)
  let notificationRecoveryComplete = false
  let notificationRecoveryFailures = 0
  let notificationRecoveryRetryAt = 0

  return {
    async process(eventId, signal) {
      const workspaceState = await input.workspace.readWorkspace()
      const event = workspaceState.events.get(eventId)
      if (!event) throw new WorkspaceAssistantError(`Inbox turn not found: ${eventId}`)
      const contextDigest = workspaceAssistantContextDigest(workspaceState.preference.digest)
      if (event.attributes.source === 'user') {
        await input.tools.acceptUserAttentionReply(eventId)
      }
      if (event.attributes.status === 'handled') {
        await input.tools.acknowledgeEventAttentions(eventId, now())
        return { kind: 'answered', eventId }
      }

      await input.conversation.begin(eventId)
      const conversationScope = assistantConversationScopeForEvent(event)
      const turnRoot = join(
        resolve(input.homeRoot),
        '.hopi',
        'runtime',
        'assistant',
        'turns',
        eventId,
      )
      const toolToken = input.tools.issue(eventId)
      let usedTool = false

      const observer: AssistantModelObserver = {
        onEvent: async (runtimeEvent) => {
          if (runtimeEvent.kind === 'transcript' && runtimeEvent.entryKind === 'tool_call') {
            usedTool = true
          }
          await input.conversation.record(eventId, runtimeEvent)
        },
        onSession: (session) =>
          input.conversation.writeSession(conversationScope, session, contextDigest, runtimeDigest),
      }

      try {
        const imageFiles = await resolveEventImages(input.workspace, event)
        const projectId =
          conversationScope.kind === 'project' ? conversationScope.projectId : undefined
        const toolMode = event.attributes.source === 'reflection' ? 'internal' : 'main'
        const preparation = {
          ...(projectId ? { projectId } : {}),
          cwd: workspaceRoot,
          readableRoots: [resolve(input.homeRoot)],
          toolMode,
        } satisfies AssistantModelPreparationInput
        const executionPlan = input.runner.prepare
          ? await input.runner.prepare(preparation)
          : {
              environment: unreportedExecutionEnvelope({
                runtimeWorkspace: workspaceRoot,
                runtimeWorkspaceRole: 'provider scratch space',
                canonicalMutation: 'hopi-tools-only',
                toolMode,
              }),
            }
        let session = await input.conversation.readSession(
          conversationScope,
          contextDigest,
          runtimeDigest,
        )
        const rebuildPrompt = renderNewConversation(
          workspaceState.events,
          event,
          workspaceState.preference,
          conversationScope,
        )
        let result: AssistantModelResult
        try {
          result = await input.runner.run(
            {
              eventId,
              ...(projectId ? { projectId } : {}),
              prompt: session ? renderTurn(event) : rebuildPrompt,
              rebuildPrompt,
              session,
              cwd: workspaceRoot,
              lastMessageFile: join(turnRoot, 'last-message.txt'),
              transcriptFile: join(turnRoot, 'transcript.log'),
              toolUrl: input.resolveToolUrl(),
              toolToken,
              imageFiles,
              readableRoots: [resolve(input.homeRoot)],
              toolMode,
              executionPlan,
              signal,
            },
            observer,
          )
        } catch (error) {
          if (!session || !(error instanceof AssistantSessionUnavailableError)) throw error
          await input.conversation.record(eventId, {
            kind: 'message',
            level: 'info',
            role: 'coordinator',
            content:
              'The saved vendor session could not continue; rebuilding it from durable conversation history.',
          })
          await input.conversation.clearSession(conversationScope)
          session = null
          result = await input.runner.run(
            {
              eventId,
              ...(projectId ? { projectId } : {}),
              prompt: rebuildPrompt,
              rebuildPrompt,
              session,
              cwd: workspaceRoot,
              lastMessageFile: join(turnRoot, 'last-message.txt'),
              transcriptFile: join(turnRoot, 'transcript.log'),
              toolUrl: input.resolveToolUrl(),
              toolToken,
              imageFiles,
              readableRoots: [resolve(input.homeRoot)],
              toolMode,
              executionPlan,
              signal,
            },
            observer,
          )
        }

        let reply = result.reply.trim()
        if (!reply && event.attributes.source !== 'reflection') {
          throw new WorkspaceAssistantError('Assistant produced an empty public reply')
        }
        let internalIntent: 'silent' | 'inform' | 'request' | null = null
        if (event.attributes.source === 'reflection') {
          internalIntent = await input.tools.finalizeInternalResponse(toolToken, eventId, reply)
        }
        await input.conversation.writeSession(
          conversationScope,
          result.session,
          contextDigest,
          runtimeDigest,
        )
        await input.workspace.handleEvent(eventId, {
          reply: reply || 'No operator update.',
          disposition:
            internalIntent === 'request'
              ? 'operator-requested'
              : internalIntent === 'inform'
                ? 'notified'
                : usedTool
                  ? 'tools-used'
                  : 'answered',
          handledAt: now(),
          expose: internalIntent !== null && internalIntent !== 'silent',
        })
        await input.conversation.complete(eventId)
        if (internalIntent === 'inform' || internalIntent === 'request') {
          try {
            await input.tools.acknowledgeEventAttentions(eventId, now())
          } catch {
            notificationRecoveryComplete = false
            notificationRecoveryRetryAt = 0
          }
        }
        return { kind: 'answered', eventId }
      } catch (error) {
        await input.conversation.fail(eventId, errorMessage(error))
        throw error
      } finally {
        input.tools.revoke(toolToken)
        await input.onTurnSettled?.(eventId)
      }
    },

    async finalizeNotifications() {
      if (notificationRecoveryComplete) return 0
      const attemptedAt = now().getTime()
      if (attemptedAt < notificationRecoveryRetryAt) return 0
      const workspace = await input.workspace.readWorkspaceForControl()
      let acknowledged = 0
      let failed = false
      for (const event of workspace.events.values()) {
        if (
          event.attributes.source !== 'reflection' ||
          event.attributes.visibility !== 'public' ||
          event.attributes.status !== 'handled'
        ) {
          continue
        }
        try {
          acknowledged += (
            await input.tools.acknowledgeEventAttentions(event.attributes.id, now(), workspace)
          ).length
        } catch {
          failed = true
        }
      }
      if (failed) {
        notificationRecoveryFailures += 1
        notificationRecoveryRetryAt =
          attemptedAt + Math.min(60_000, 1_000 * 2 ** (notificationRecoveryFailures - 1))
        return acknowledged
      }
      notificationRecoveryComplete = true
      notificationRecoveryFailures = 0
      notificationRecoveryRetryAt = 0
      return acknowledged
    },
  }
}

async function prepareAssistantWorkspace(
  config: RoleTransportConfig,
  input: AssistantModelInput & { toolUrl: string },
) {
  if (config.transport !== 'claude' && config.transport !== 'opencode') return
  const server = {
    command: process.execPath,
    args: [join(import.meta.dir, 'hopiMcpServer.ts')],
    env: {
      HOPI_TOOL_URL: input.toolUrl,
      HOPI_TOOL_TOKEN: input.toolToken,
      HOPI_TOOL_MODE: input.toolMode ?? 'main',
    },
  }

  if (config.transport === 'claude') {
    await Bun.write(
      assistantClaudeMcpConfigPath(input.cwd),
      `${JSON.stringify({ mcpServers: { hopi: server } }, null, 2)}\n`,
    )
    await Bun.write(
      assistantClaudeSettingsPath(input.cwd),
      `${JSON.stringify(
        {
          sandbox:
            input.toolMode === 'reflection' || !input.fullAccess
              ? {
                  enabled: true,
                  failIfUnavailable: true,
                  autoAllowBashIfSandboxed: true,
                  allowUnsandboxedCommands: false,
                  filesystem: {
                    allowWrite:
                      input.toolMode === 'reflection'
                        ? []
                        : [
                            input.cwd,
                            ...(input.browserEnvironment
                              ? [input.browserEnvironment.writableRoot]
                              : []),
                          ],
                  },
                }
              : { enabled: false },
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  await Bun.write(
    assistantOpencodeConfigPath(input.cwd),
    `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        compaction: { auto: true },
        mcp: {
          hopi: {
            type: 'local',
            command: [server.command, ...server.args],
            enabled: true,
            environment: server.env,
          },
        },
        permission:
          input.toolMode === 'reflection' || !input.fullAccess
            ? {
                '*': 'deny',
                'hopi_*': 'allow',
                read: 'allow',
                grep: 'allow',
                glob: 'allow',
                list: 'allow',
                external_directory: externalDirectoryPermissions(input.readableRoots ?? []),
              }
            : { '*': 'allow' },
      },
      null,
      2,
    )}\n`,
  )
}

async function validateOpencodeMcp(
  config: Extract<RoleTransportConfig, { transport: 'opencode' }>,
  input: AssistantModelInput,
) {
  const mcp = await inspectOpencode(config, input, ['mcp', 'list'])
  const output = stripAnsi(mcp.stdout)
  const hopiLine = output.split(/\r?\n/).find((line) => /\bhopi\b/i.test(line))
  if (!hopiLine || !/\bconnected\b/i.test(hopiLine)) {
    throw new WorkspaceAssistantError(
      `OpenCode did not connect the injected hopi MCP server${hopiLine ? `: ${hopiLine.trim()}` : ''}`,
    )
  }
}

async function inspectOpencode(
  config: Extract<RoleTransportConfig, { transport: 'opencode' }>,
  input: AssistantModelInput,
  args: string[],
) {
  const command = [config.binary ?? 'opencode', '--pure', ...args]
  const child = Bun.spawn(command, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      OPENCODE_CONFIG: assistantOpencodeConfigPath(input.cwd),
      PWD: input.cwd,
    },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      child.kill()
      reject(
        new WorkspaceAssistantError(`OpenCode startup inspection timed out: ${args.join(' ')}`),
      )
    }, 10_000)
  })
  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]),
      timeout,
    ])
    if (exitCode !== 0) {
      throw new WorkspaceAssistantError(
        `OpenCode startup inspection failed (${args.join(' ')}): ${stderr.trim() || `exit ${exitCode}`}`,
      )
    }
    return { stdout, stderr }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function buildAssistantCommand(
  config: RoleTransportConfig,
  input: AssistantModelInput & { toolUrl: string },
) {
  if (config.transport === 'codex') return assistantCodexCommand(config, input)
  if (config.transport === 'claude') return assistantClaudeCommand(config, input)
  if (config.transport === 'opencode') return assistantOpencodeCommand(config, input)
  throw new WorkspaceAssistantError(`Unsupported transport: ${config.transport}`)
}

function assistantClaudeCommand(
  config: Extract<RoleTransportConfig, { transport: 'claude' }>,
  input: AssistantModelInput,
) {
  const command = [config.binary ?? 'claude']
  appendClaudeNonInteractivePermission(command)
  if (config.model) command.push('--model', config.model)
  command.push(
    '--mcp-config',
    assistantClaudeMcpConfigPath(input.cwd),
    '--strict-mcp-config',
    '--settings',
    assistantClaudeSettingsPath(input.cwd),
    '--setting-sources',
    '',
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
  )
  if (input.session) command.push('--resume', input.session.sessionId)
  if (!input.fullAccess) {
    const readableDirectories = new Set(input.readableRoots ?? [])
    if (input.browserEnvironment) {
      readableDirectories.add(input.browserEnvironment.writableRoot)
    }
    for (const imageFile of input.imageFiles ?? []) readableDirectories.add(dirname(imageFile))
    for (const directory of readableDirectories) command.push('--add-dir', directory)
  }
  if (input.toolMode === 'reflection') {
    command.push('--tools', 'Read,Glob,Grep', '--allowedTools', 'mcp__hopi__*,Read,Glob,Grep')
  } else if (!input.fullAccess) {
    command.push(
      '--tools',
      'Read,Glob,Grep,Bash,WebFetch,WebSearch',
      '--allowedTools',
      'mcp__hopi__*,Read,Glob,Grep,Bash,WebFetch,WebSearch',
    )
  }
  return command
}

function assistantOpencodeCommand(
  config: Extract<RoleTransportConfig, { transport: 'opencode' }>,
  input: AssistantModelInput,
) {
  const command = [config.binary ?? 'opencode', '--pure', 'run']
  if (config.model) command.push('--model', config.model)
  if (config.variant) command.push('--variant', config.variant)
  if (config.agent) command.push('--agent', config.agent)
  command.push('--format', 'json')
  if (input.session) command.push('--session', input.session.sessionId)
  for (const imageFile of input.imageFiles ?? []) command.push('--file', imageFile)
  return command
}

function assistantClaudeMcpConfigPath(cwd: string) {
  return join(cwd, 'claude-mcp.json')
}

function assistantClaudeSettingsPath(cwd: string) {
  return join(cwd, 'claude-settings.json')
}

function assistantOpencodeConfigPath(cwd: string) {
  return join(cwd, 'opencode.json')
}

function stripAnsi(value: string) {
  const escapeCharacter = String.fromCharCode(27)
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
}

function externalDirectoryPermissions(roots: readonly string[]) {
  return {
    '*': 'deny',
    ...Object.fromEntries(roots.map((root) => [`${root.replace(/\/$/, '')}/**`, 'allow'])),
  }
}

function assistantPrompt(config: RoleTransportConfig, input: AssistantModelInput) {
  if (config.transport !== 'claude' || !input.imageFiles?.length) return input.prompt
  return [
    input.prompt,
    '',
    '[Current turn local image files; inspect them with the Read tool when relevant.]',
    ...input.imageFiles.map((path) => `- ${path}`),
  ].join('\n')
}

function assistantTranscriptFormat(transport: AssistantTransport) {
  if (transport === 'claude') return 'claude_stream_json' as const
  if (transport === 'opencode') return 'opencode_json' as const
  return 'codex_jsonl' as const
}

function assistantCodexCommand(
  config: Extract<RoleTransportConfig, { transport: 'codex' }>,
  input: AssistantModelInput,
) {
  const command = [config.binary ?? 'codex']
  appendCodexHttpsOnlyConfig(command)
  appendCodexAssistantProviderConfig(command, input.toolMode ?? 'main')
  const sandbox =
    input.toolMode === 'reflection'
      ? 'read-only'
      : input.fullAccess
        ? 'danger-full-access'
        : 'workspace-write'
  command.push('-a', NON_INTERACTIVE_CODEX_APPROVAL_POLICY)
  if (sandbox === 'workspace-write') {
    command.push('-c', 'sandbox_workspace_write.network_access=true')
    if (input.browserEnvironment) {
      command.push('--add-dir', input.browserEnvironment.writableRoot)
    }
  }
  command.push('-s', sandbox)
  if (config.reasoningEffort) {
    command.push('-c', `model_reasoning_effort="${config.reasoningEffort}"`)
  }
  command.push(
    '-c',
    `mcp_servers.hopi.command=${JSON.stringify(process.execPath)}`,
    '-c',
    `mcp_servers.hopi.args=${JSON.stringify([join(import.meta.dir, 'hopiMcpServer.ts')])}`,
    '-c',
    'mcp_servers.hopi.default_tools_approval_mode="approve"',
    '-c',
    `mcp_servers.hopi.env=${tomlInlineTable({
      HOPI_TOOL_URL: input.toolUrl,
      HOPI_TOOL_TOKEN: input.toolToken,
      HOPI_TOOL_MODE: input.toolMode ?? 'main',
    })}`,
  )
  if (config.model) command.push('-m', config.model)
  if (config.profile) command.push('-p', config.profile)
  command.push('exec')
  if (input.session) command.push('resume')
  for (const imageFile of input.imageFiles ?? []) command.push('-i', imageFile)
  command.push('--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--json')
  command.push('-o', input.lastMessageFile)
  if (input.session) command.push(input.session.sessionId)
  command.push('-')
  return command
}

const CODEX_ASSISTANT_DISABLED_PRODUCT_FEATURES = [
  'apps',
  'goals',
  'memories',
  'multi_agent',
  'plugins',
] as const

const CODEX_REFLECTION_DISABLED_EXECUTION_FEATURES = [
  'browser_use',
  'computer_use',
  'image_generation',
  'workspace_dependencies',
] as const

function appendCodexAssistantProviderConfig(
  command: string[],
  toolMode: NonNullable<AssistantModelInput['toolMode']>,
) {
  command.push(
    '-c',
    'include_apps_instructions=false',
    '-c',
    'include_collaboration_mode_instructions=false',
  )
  for (const feature of CODEX_ASSISTANT_DISABLED_PRODUCT_FEATURES) {
    command.push('--disable', feature)
  }
  if (toolMode !== 'reflection') return
  command.push('-c', 'skills.include_instructions=false', '-c', 'skills.bundled.enabled=false')
  for (const feature of CODEX_REFLECTION_DISABLED_EXECUTION_FEATURES) {
    command.push('--disable', feature)
  }
}

const WORKSPACE_ASSISTANT_CONTRACT_LINES = [
  'Owned outcome: complete the current Inbox turn using its intent and the durable conversation.',
  'Page context is a location hint. Current state and canonical effects come from HOPI tools.',
  'The provider workspace is non-canonical scratch space.',
] as const

const PREFERENCE_CONTRACT_LINES = [
  'Preferences are defaults below the current turn and explicit Project or Goal authority.',
] as const

export const WORKSPACE_ASSISTANT_CONTRACT_DIGEST = createHash('sha256')
  .update([...WORKSPACE_ASSISTANT_CONTRACT_LINES, ...PREFERENCE_CONTRACT_LINES].join('\n'))
  .digest('hex')

export function workspaceAssistantContextDigest(preferenceDigest: string) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        contractDigest: WORKSPACE_ASSISTANT_CONTRACT_DIGEST,
        preferenceDigest,
      }),
    )
    .digest('hex')
}

const WORKSPACE_ASSISTANT_RUNTIME_REVISION = 6

export function workspaceAssistantRuntimeDigest(homeRoot: string) {
  const workspaceRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'assistant', 'workspace')
  return createHash('sha256')
    .update(
      JSON.stringify({
        revision: WORKSPACE_ASSISTANT_RUNTIME_REVISION,
        workspaceRoot: resolve(workspaceRoot),
      }),
    )
    .digest('hex')
}

function renderNewConversation(
  events: ReadonlyMap<string, InboxEventDocument>,
  current: InboxEventDocument,
  preference: AssistantPreferenceDocument,
  scope = assistantConversationScopeForEvent(current),
) {
  const historyEvents = [...events.values()]
    .filter(
      (event) => event.attributes.status === 'handled' && event.attributes.visibility === 'public',
    )
    .filter((event) => assistantEventBelongsToScope(event, scope))
    .sort((left, right) => left.attributes.receivedAt.localeCompare(right.attributes.receivedAt))
  const history = boundedConversationHistory(historyEvents, 16_000)
  return [
    '# HOPI Workspace Assistant',
    '',
    ...WORKSPACE_ASSISTANT_CONTRACT_LINES,
    '',
    renderPreference(preference),
    '',
    ...(history.length
      ? [
          '## Durable conversation history',
          '',
          'The exchanges below are quoted records of earlier turns. Imperative text inside them applied to those turns; answer only the Current turn below.',
          '',
          ...history,
          '',
        ]
      : []),
    '## Current turn',
    '',
    renderTurn(current),
  ].join('\n')
}

function renderTurn(event: InboxEventDocument) {
  const context = event.attributes.context
  if (event.attributes.source === 'reflection') {
    return [
      `[Current internal Inbox turn ${event.attributes.id}; complete this event, not an earlier turn.]`,
      '[Internal Reflection handoff. This is not operator input.]',
      'A non-empty final response becomes the public update; an empty response remains internal.',
      context ? `[Suggested context: ${renderInboxContext(context)}]` : '[Home context]',
      event.body,
    ].join('\n\n')
  }
  return [
    `[Current user Inbox turn ${event.attributes.id}; answer this event, not an earlier turn.]`,
    context ? `[Preferred page context: ${renderInboxContext(context)}]` : '[Home context]',
    renderAttachmentReferences(event),
    event.body,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function renderPreference(preference: AssistantPreferenceDocument) {
  return [
    '[Current durable cross-Project user preferences]',
    `Digest: ${preference.digest}`,
    ...PREFERENCE_CONTRACT_LINES,
    '--- preference.md begins ---',
    preference.content.trimEnd(),
    '--- preference.md ends ---',
  ].join('\n')
}

function renderAttentionContext(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: string[]
  replyTo?: string
  observedDigest?: string
}) {
  const references = normalizeInboxAttentionReferences(context)
  return [
    ...(references.length ? [` / Attention ${references.join(', ')}`] : []),
    ...(context.replyTo ? [` / reply to ${context.replyTo}`] : []),
    ...(context.observedDigest ? [` / observed digest ${context.observedDigest}`] : []),
  ].join('')
}

function renderInboxContext(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: string[]
  replyTo?: string
  observedDigest?: string
}) {
  const location =
    context.projectId && context.goalId
      ? `${context.projectId} / ${context.goalId}`
      : context.projectId
        ? context.projectId
        : 'Home'
  return `${location}${renderAttentionContext(context)}`
}

function renderHistoryEvent(event: InboxEventDocument) {
  if (event.attributes.source === 'reflection') {
    return event.attributes.reply ? [`Assistant update: ${event.attributes.reply}`] : []
  }
  return [
    `User: ${event.body}`,
    ...(event.attributes.attachments.length > 0
      ? [`User attachments: ${event.attributes.attachments.join(', ')}`]
      : []),
    `Assistant: ${event.attributes.reply ?? ''}`,
  ]
}

async function resolveEventImages(workspace: AssistantWorkspaceStore, event: InboxEventDocument) {
  const imageFiles: string[] = []
  for (const reference of event.attributes.attachments) {
    const attachment = await workspace.resolveAttachment(reference)
    if (attachment) imageFiles.push(attachment.absolutePath)
  }
  return imageFiles
}

function renderAttachmentReferences(event: InboxEventDocument) {
  if (event.attributes.attachments.length === 0) return ''
  return [
    '[Current turn image attachments; use these exact references in HOPI tool calls when adopting them for a Goal.]',
    ...event.attributes.attachments.map((reference) => `- ${reference}`),
  ].join('\n')
}

function boundedConversationHistory(events: InboxEventDocument[], characterBudget: number) {
  const selected: string[][] = []
  let used = 0
  for (const event of events.toReversed()) {
    const rendered = renderHistoryEvent(event)
    const size = rendered.reduce((total, line) => total + line.length + 1, 0)
    if (selected.length > 0 && used + size > characterBudget) break
    selected.push(rendered)
    used += size
  }
  return selected.toReversed().flat()
}

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  consume: (line: string) => Promise<void>,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) await consume(line)
  }
  buffered += decoder.decode()
  if (buffered) await consume(buffered)
}

function tomlInlineTable(values: Record<string, string>) {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(',')}}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
