import { appendFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { readClaudeProviderEnvironment } from '../agent/claudeSettingsEnvironment'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import {
  type AssistantTransport,
  type VendorAssistantTerminalError,
  isExplicitSessionFailure,
  parseVendorAssistantOutput,
} from '../agent/vendorAssistantOutput'
import { normalizeProcessOutputLine } from '../agent/vendorTranscript'
import type { RoleTransportConfig } from '../agent/vendorTransport'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import { normalizeInboxAttentionReferences } from '../domain/attentionReference'
import { terminateProcessGroup } from '../runtime/processGroup'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { AssistantConversationStore, AssistantSession } from './assistantConversationStore'
import type { AssistantTools } from './assistantTools'

export interface AssistantModelInput {
  eventId: string
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
  signal?: AbortSignal
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
}): AssistantModelRunner {
  return {
    async run(input, observer) {
      const config = await options.resolveConfig()
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
        prompt: session ? input.prompt : (input.rebuildPrompt ?? input.prompt),
        session,
        toolUrl: options.resolveToolUrl(),
      }
      await mkdir(input.cwd, { recursive: true })
      await rm(input.lastMessageFile, { force: true })
      await prepareAssistantWorkspace(config, invocation)

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
        env: { ...process.env, ...providerEnvironment },
        detached: true,
      })
      const abort = () => void terminateProcessGroup(child.pid)
      input.signal?.addEventListener('abort', abort, { once: true })
      if (typeof child.stdin !== 'number' && child.stdin) {
        child.stdin.write(assistantPrompt(config, invocation))
        child.stdin.end()
      }

      let observedSessionId = session?.sessionId ?? null
      const stderr: string[] = []
      let finalReply = ''
      let finalMessageId: string | undefined
      let terminalError: VendorAssistantTerminalError | undefined

      const consume = async (stream: 'stdout' | 'stderr', line: string) => {
        await appendFile(input.transcriptFile, `${stream}: ${line}\n`)
        if (stream === 'stdout') {
          const output = parseVendorAssistantOutput(transport, line)
          if (output.sessionId && output.sessionId !== observedSessionId) {
            observedSessionId = output.sessionId
            await observer?.onSession?.({ transport, sessionId: output.sessionId })
          }
          if (output.terminalError) {
            terminalError = output.terminalError
          } else if (output.finalText) {
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
        } else {
          stderr.push(line)
        }

        const transcriptFormat = assistantTranscriptFormat(transport)
        for (const event of normalizeProcessOutputLine({
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
            await terminateProcessGroup(child.pid)
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
        const detail = stderr.at(-1) ?? 'no error detail'
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

export function createWorkspaceAssistant(input: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  conversation: AssistantConversationStore
  tools: AssistantTools
  runner: AssistantModelRunner
  resolveToolUrl(): string
  now?: () => Date
}): WorkspaceAssistant {
  const now = input.now ?? (() => new Date())
  const workspaceRoot = join(resolve(input.homeRoot), '.hopi', 'runtime', 'assistant', 'workspace')
  let notificationRecoveryComplete = false

  return {
    async process(eventId, signal) {
      const workspaceState = await input.workspace.readWorkspace()
      const event = workspaceState.events.get(eventId)
      if (!event) throw new WorkspaceAssistantError(`Inbox turn not found: ${eventId}`)
      if (event.attributes.status === 'handled') {
        await input.tools.acknowledgeEventAttentions(eventId, now())
        return { kind: 'answered', eventId }
      }

      await input.conversation.begin(eventId)
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
        onSession: (session) => input.conversation.writeSession(session),
      }

      try {
        const imageFiles = await resolveEventImages(input.workspace, event)
        let session = await input.conversation.readSession()
        const rebuildPrompt = renderNewConversation(workspaceState.events, event)
        let result: AssistantModelResult
        try {
          result = await input.runner.run(
            {
              eventId,
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
              toolMode: event.attributes.source === 'reflection' ? 'internal' : 'main',
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
          await input.conversation.clearSession()
          session = null
          result = await input.runner.run(
            {
              eventId,
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
              toolMode: event.attributes.source === 'reflection' ? 'internal' : 'main',
              signal,
            },
            observer,
          )
        }

        await input.conversation.writeSession(result.session)
        const notificationMessage = input.tools.notificationMessage(toolToken)
        const reply = notificationMessage ?? result.reply.trim()
        if (!reply && event.attributes.source !== 'reflection') {
          throw new WorkspaceAssistantError('Assistant produced an empty public reply')
        }
        await input.workspace.handleEvent(eventId, {
          reply: reply || 'No operator update.',
          disposition: usedTool ? 'tools-used' : 'answered',
          handledAt: now(),
          expose: notificationMessage !== null,
        })
        await input.conversation.complete(eventId)
        if (notificationMessage !== null) {
          try {
            await input.tools.acknowledgeEventAttentions(eventId, now())
          } catch {
            notificationRecoveryComplete = false
          }
        }
        return { kind: 'answered', eventId }
      } catch (error) {
        await input.conversation.fail(eventId, errorMessage(error))
        throw error
      } finally {
        input.tools.revoke(toolToken)
      }
    },

    async finalizeNotifications() {
      if (notificationRecoveryComplete) return 0
      const workspace = await input.workspace.readWorkspace()
      let acknowledged = 0
      for (const event of workspace.events.values()) {
        if (
          event.attributes.source !== 'reflection' ||
          event.attributes.visibility !== 'public' ||
          event.attributes.status !== 'handled'
        ) {
          continue
        }
        try {
          acknowledged += (await input.tools.acknowledgeEventAttentions(event.attributes.id, now()))
            .length
        } catch {
          notificationRecoveryComplete = false
          return acknowledged
        }
      }
      notificationRecoveryComplete = true
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
    return
  }

  await Bun.write(
    join(input.cwd, 'opencode.json'),
    `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          hopi: {
            type: 'local',
            command: [server.command, ...server.args],
            enabled: true,
            environment: server.env,
          },
        },
        permission: {
          '*': 'deny',
          'hopi_*': 'allow',
          read: 'allow',
          grep: 'allow',
          glob: 'allow',
          list: 'allow',
          external_directory: externalDirectoryPermissions(input.readableRoots ?? []),
        },
      },
      null,
      2,
    )}\n`,
  )
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
  if (config.permissionMode === 'bypassPermissions') {
    command.push('--dangerously-skip-permissions')
  } else {
    command.push('--permission-mode', config.permissionMode)
  }
  if (config.model) command.push('--model', config.model)
  command.push(
    '--mcp-config',
    assistantClaudeMcpConfigPath(input.cwd),
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--allowedTools',
    'mcp__hopi__*,Read,Glob,Grep',
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
  )
  if (input.session) command.push('--resume', input.session.sessionId)
  const readableDirectories = new Set(input.readableRoots ?? [])
  for (const imageFile of input.imageFiles ?? []) readableDirectories.add(dirname(imageFile))
  for (const directory of readableDirectories) command.push('--add-dir', directory)
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
  const command = [config.binary ?? 'codex', '-a', config.approvalPolicy, '-s', 'read-only']
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

function renderNewConversation(
  events: ReadonlyMap<string, InboxEventDocument>,
  current: InboxEventDocument,
) {
  const historyEvents = [...events.values()]
    .filter(
      (event) => event.attributes.status === 'handled' && event.attributes.visibility === 'public',
    )
    .sort((left, right) => left.attributes.receivedAt.localeCompare(right.attributes.receivedAt))
  const history = boundedConversationHistory(historyEvents, 16_000)
  return [
    '# HOPI Workspace Assistant',
    '',
    'Continue as one normal Assistant conversation for the operator.',
    'Use HOPI tools only when the operator actually requests a durable Project, Goal, Work, design, Attention, or Preview effect.',
    'Page context is the preferred target for ambiguous references such as "this" or "continue", but explicit user intent may select another Goal, create a new Goal, or stay at Workspace scope.',
    'Page context never implies a mutation. Never turn greetings, discussion, or questions into Planning.',
    'When an accepted mutation creates or changes a Goal other than the preferred page Goal, make the effect locatable by naming that Goal and its exact returned Goal ID in the final reply.',
    'Every public turn is already durably remembered in Assistant Inbox. Leave optional suggestions, future ideas, and reference-only comments in conversation unless the operator intends them to change current authority.',
    'Calling hopi_request_planning adopts the current turn as Goal Input and may invalidate an active Planner. Use it only when the current plan or delivery should change; do not call it merely to remember a note.',
    'Before admission, ask only when the requested outcome, target, or operator intent is materially unclear. Once it is clear enough to admit, use the appropriate HOPI tool; Planner owns technical and delivery clarification.',
    'Do not edit HOPI canonical files or project source directly. Use HOPI tools; implementation work must go through Planning and the fixed delivery flow.',
    'The injected HOPI MCP tool descriptions and JSON schemas are the sole authority for tool arguments. Call those tools with their advertised fields; never search project files, .hopi/runtime, transcripts, or source code to rediscover a tool schema.',
    'For Project Attention, inspect current state and apply the repair you judge sufficient, then call hopi_resolve_attention. A successful repair or shell command does not itself remove Attention; claim the Project is unblocked only after hopi_resolve_attention returns success.',
    'Use exact document or diagnostic paths returned by hopi_read_state only when their body is needed. Never broadly search .hopi/runtime for control facts already returned by the state tool.',
    'For the preferred current page, call hopi_read_state without projectId or goalId so the tool applies that exact context. When another scope is explicit, copy its complete canonical IDs and never remove P- or G- prefixes.',
    'Current-turn images are already visible to you. Adopt only task-relevant images through the references field of the Goal tool you already need, with a concise purpose; leave unrelated images conversation-only. Never copy an Assistant-home attachment reference into Goal, design, or Work prose: adopted references return portable Goal-local asset paths for Planning.',
    'The current Inbox turn overrides older conversation. Read scoped current HOPI state before relying on possibly stale session facts.',
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
      'Re-read current HOPI state and every referenced unresolved Attention before acting. Attention is an internal request for Assistant management, not automatically a user question.',
      'Resolve what current code and canonical documents can answer. Update design or request Planning when needed. Ask the operator only for a decision or external action that Assistant cannot safely supply.',
      'When the brief is stale or all referenced Attention is already resolved, finish silently.',
      'Call hopi_notify_user with the exact concise message only when the operator should see an update; otherwise finish silently and the turn stays hidden. Other text from this internal turn is never shown.',
      renderOperatorReplyContract(),
      '[Rewrite the internal brief for the operator. Do not copy its internal IDs, role names, stages, or diagnostic process unless the operator needs that detail.]',
      context ? `[Suggested context: ${renderInboxContext(context)}]` : '[Workspace context]',
      event.body,
    ].join('\n\n')
  }
  return [
    `[Current user Inbox turn ${event.attributes.id}; answer this event, not an earlier turn.]`,
    '[HOPI effects are asynchronous: after a mutating tool accepts the request, reply without sleeping or polling; Reflection reports later completion, blockers, or decisions.]',
    renderOperatorReplyContract(),
    context ? `[Preferred page context: ${renderInboxContext(context)}]` : '[Workspace context]',
    renderAttachmentReferences(event),
    event.body,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function renderAttentionContext(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: string[]
  observedDigest?: string
}) {
  const references = normalizeInboxAttentionReferences(context)
  return [
    ...(references.length ? [` / Attention ${references.join(', ')}`] : []),
    ...(context.observedDigest ? [` / observed digest ${context.observedDigest}`] : []),
  ].join('')
}

function renderInboxContext(context: {
  projectId?: string
  goalId?: string
  attentionId?: string
  attentionRefs?: string[]
  observedDigest?: string
}) {
  const location =
    context.projectId && context.goalId ? `${context.projectId} / ${context.goalId}` : 'Workspace'
  return `${location}${renderAttentionContext(context)}`
}

function renderOperatorReplyContract() {
  return [
    '[Operator-facing reply contract]',
    '- Start with what happened or the current condition in plain language.',
    "- Default to one or two short sentences. Add detail only when it changes the operator's understanding or decision, or when asked.",
    '- If the operator must act, state one concrete question or instruction. Otherwise do not invent next steps or narrate the workflow.',
    '- Omit internal IDs, responsibility names, stages, tools, document paths, and verification process unless requested or needed to disambiguate a choice.',
    '- If an accepted effect landed in a Goal other than the preferred page Goal, include that Goal name and exact Goal ID so the operator can find it.',
    "- Use the operator's language. Do not repeat their request.",
  ].join('\n')
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
