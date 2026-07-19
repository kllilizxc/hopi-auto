import { createHash } from 'node:crypto'
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
import { isNonFatalProcessDiagnostic, normalizeProcessOutputLine } from '../agent/vendorTranscript'
import { type RoleTransportConfig, appendCodexHttpsOnlyConfig } from '../agent/vendorTransport'
import type { AssistantPreferenceDocument } from '../domain/assistantPreference'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import { normalizeInboxAttentionReferences } from '../domain/attentionReference'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { createProcessGroupTerminator } from '../runtime/processGroup'
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
        } else if (!isNonFatalProcessDiagnostic({ format: transcriptFormat, stream, line })) {
          stderr.push(line)
        }

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
  let notificationRecoveryComplete = false

  return {
    async process(eventId, signal) {
      const workspaceState = await input.workspace.readWorkspace()
      const event = workspaceState.events.get(eventId)
      if (!event) throw new WorkspaceAssistantError(`Inbox turn not found: ${eventId}`)
      if (event.attributes.source === 'user') {
        await input.tools.acceptUserAttentionReply(eventId)
      }
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
        onSession: (session) =>
          input.conversation.writeSession(session, WORKSPACE_ASSISTANT_CONTRACT_DIGEST),
      }

      try {
        const imageFiles = await resolveEventImages(input.workspace, event)
        let session = await input.conversation.readSession(WORKSPACE_ASSISTANT_CONTRACT_DIGEST)
        const rebuildPrompt = renderNewConversation(
          workspaceState.events,
          event,
          workspaceState.preference,
        )
        let result: AssistantModelResult
        try {
          result = await input.runner.run(
            {
              eventId,
              prompt: session ? renderTurn(event, workspaceState.preference) : rebuildPrompt,
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

        await input.conversation.writeSession(result.session, WORKSPACE_ASSISTANT_CONTRACT_DIGEST)
        let notificationMessage = input.tools.notificationMessage(toolToken)
        let notificationIntent = input.tools.notificationIntent(toolToken)
        if (event.attributes.source === 'reflection') {
          let assistantOwnedAttentionRefs = await input.tools.assistantOwnedAttentionRefs(eventId)
          if (
            assistantOwnedAttentionRefs.length > 0 &&
            notificationIntent !== 'request' &&
            !input.tools.hasDurableEffect(toolToken)
          ) {
            await input.conversation.record(eventId, {
              kind: 'message',
              level: 'info',
              role: 'coordinator',
              content:
                'Continuing the Assistant turn because referenced Attention still has no internal continuation or exact operator request.',
            })
            result = await input.runner.run(
              {
                eventId,
                prompt: renderAttentionSettlementCorrection(assistantOwnedAttentionRefs),
                rebuildPrompt,
                session: result.session,
                cwd: workspaceRoot,
                lastMessageFile: join(turnRoot, 'last-message.txt'),
                transcriptFile: join(turnRoot, 'transcript.log'),
                toolUrl: input.resolveToolUrl(),
                toolToken,
                imageFiles,
                readableRoots: [resolve(input.homeRoot)],
                toolMode: 'internal',
                signal,
              },
              observer,
            )
            await input.conversation.writeSession(
              result.session,
              WORKSPACE_ASSISTANT_CONTRACT_DIGEST,
            )
            notificationMessage = input.tools.notificationMessage(toolToken)
            notificationIntent = input.tools.notificationIntent(toolToken)
            assistantOwnedAttentionRefs = await input.tools.assistantOwnedAttentionRefs(eventId)
            if (
              assistantOwnedAttentionRefs.length > 0 &&
              notificationIntent !== 'request' &&
              !input.tools.hasDurableEffect(toolToken)
            ) {
              throw new WorkspaceAssistantError(
                'Assistant left referenced Attention without a durable internal continuation or exact operator request',
              )
            }
          }
        }
        const reply = notificationMessage ?? result.reply.trim()
        if (!reply && event.attributes.source !== 'reflection') {
          throw new WorkspaceAssistantError('Assistant produced an empty public reply')
        }
        await input.workspace.handleEvent(eventId, {
          reply: reply || 'No operator update.',
          disposition:
            notificationIntent === 'request'
              ? 'operator-requested'
              : notificationIntent === 'inform'
                ? 'notified'
                : usedTool
                  ? 'tools-used'
                  : 'answered',
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
        await input.onTurnSettled?.(eventId)
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
  const command = [config.binary ?? 'codex']
  appendCodexHttpsOnlyConfig(command)
  command.push('-a', config.approvalPolicy, '-s', 'read-only')
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

const WORKSPACE_ASSISTANT_CONTRACT_LINES = [
  'Continue as one normal Assistant conversation for the operator.',
  'Use HOPI tools only for a requested durable effect. Page context disambiguates references but never implies mutation; explicit intent may choose another scope or Goal.',
  'Inbox already preserves every public turn. Keep discussion, questions, optional suggestions, and future ideas in conversation unless the operator intends to change current authority. Request Planning only when current plan or delivery should change.',
  'Ask before admission only when outcome, target, or operator intent is materially unclear; Planner owns later technical and delivery clarification.',
  'Do not edit HOPI canonical files or project source directly. Use HOPI tools; implementation work must go through Planning and the fixed delivery flow.',
  'MCP descriptions and schemas are the sole authority for tool arguments; never inspect files or transcripts to rediscover them.',
  '[Mandatory Attention check before every final reply]',
  'Inspect every exact Attention reference attached to the current Inbox turn and every remainingAttentionRefs value returned by tools in this turn. Reconcile each reference before ending the turn; do not silently carry it past a successful mutation.',
  'When the current instruction or a successful effect satisfies or supersedes its blocker, settle it before replying. Work retry/cancel settles only Attention targeted exactly at affected Work. Request Planning settles only a current-turn Attention reference targeted exactly at the Planning Work it installs; for every other blocker you MUST call hopi_resolve_attention with the exact scope and IDs. Changing a Goal never closes Attention by itself.',
  'Retry means another invocation in the same Work lineage; it does not rebuild, reset, or prove synchronization. For an unchanged task-branch defect in an internal Reflection handoff, request Planning instead. Claim repair only after later state or Attempt evidence proves it.',
  'set_not_before only defers dispatch; it never terminates Work or clears a Planning guard. Cancel Work only when the operator or accepted plan explicitly abandons it, never as operational recovery. After Work control, trust the returned stage, notBefore, terminal, and failedPredicates instead of inferring success from the requested operation.',
  'If a referenced Attention still blocks, keep ownership with Assistant while HOPI can repair or schedule it. Use hopi_request_user only for one exact decision, authorization, or external action Assistant cannot supply. Claim it cleared only after the applicable control or hopi_resolve_attention tool succeeds and its reference is no longer returned as open.',
  'hopi_notify_user and hopi_request_user update one turn-local final public-message slot; a later successful call may revise it after fresh state changes the conclusion. Only the final slot is published when the turn ends.',
  'Every hopi_request_user message must stand alone in the visible conversation: preserve enough material cause and consequence to explain what changed, why HOPI cannot continue, the exact answer or action needed, and any non-obvious effect of viable alternatives. Include a recommendation when one exists. Be proportional; concise never means stripping the context needed to decide.',
  'Read state at current page scope by omitting IDs; for another explicit scope copy complete canonical IDs. Follow exact returned document or diagnostic paths only when their body is needed; never scan runtime history broadly.',
  'For every completed Goal update, and whenever asked for a report, output, preview, or other deliverable, call hopi_read_state for that exact Goal with includeEvidence: true and select it from Work Evidence artifacts. Link at least one relevant returned operatorUrl in Markdown when available; if none resolves, say no linked artifact was produced. Never substitute inspectionPath, a design, Work, plan, or latest-Attempt path for the deliverable.',
  'Adopt only task-relevant current images through the references field of the Goal tool already needed, with a concise purpose. Keep unrelated images in conversation and use returned Goal-local paths in authority.',
  'The current Inbox turn overrides older conversation. Read scoped current HOPI state before relying on possibly stale session facts.',
] as const

export const WORKSPACE_ASSISTANT_CONTRACT_DIGEST = createHash('sha256')
  .update(WORKSPACE_ASSISTANT_CONTRACT_LINES.join('\n'))
  .digest('hex')

function renderNewConversation(
  events: ReadonlyMap<string, InboxEventDocument>,
  current: InboxEventDocument,
  preference: AssistantPreferenceDocument,
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
    ...WORKSPACE_ASSISTANT_CONTRACT_LINES,
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
    renderTurn(current, preference),
  ].join('\n')
}

function renderTurn(event: InboxEventDocument, preference: AssistantPreferenceDocument) {
  const context = event.attributes.context
  if (event.attributes.source === 'reflection') {
    return [
      `[Current internal Inbox turn ${event.attributes.id}; complete this event, not an earlier turn.]`,
      '[Internal Reflection handoff. This is not operator input.]',
      'Re-read current state and referenced Attention. Resolve what code and authority can answer; change design or request Planning when needed. Ask the operator only for a decision or external action Assistant cannot supply.',
      'If stale or already resolved, finish silently. Use hopi_notify_user only for a concise informational update alongside real internal progress. Use hopi_request_user only for one exact decision, authorization, or external action Assistant cannot supply; all other output stays hidden.',
      'A hopi_request_user message is the complete public turn. Translate the brief into a self-contained decision request with the material cause, blocking consequence, exact need, alternative effects when non-obvious, and a recommendation when one exists. Do not expose irrelevant internal IDs or process narration.',
      'If the brief reports Goal completion, read the exact Goal with includeEvidence: true before notifying. Include a relevant available operatorUrl in Markdown; when none resolves, explicitly say no linked artifact was produced.',
      renderPreference(preference, false),
      renderOperatorReplyContract(),
      '[Translate the brief into its useful outcome or required action; omit internal IDs and process unless needed.]',
      context ? `[Suggested context: ${renderInboxContext(context)}]` : '[Workspace context]',
      event.body,
    ].join('\n\n')
  }
  return [
    `[Current user Inbox turn ${event.attributes.id}; answer this event, not an earlier turn.]`,
    '[HOPI effects are asynchronous: after a mutating tool accepts the request, reply without sleeping or polling; Reflection reports later completion, blockers, or decisions.]',
    renderPreference(preference, true),
    renderOperatorReplyContract(),
    context ? `[Preferred page context: ${renderInboxContext(context)}]` : '[Workspace context]',
    renderAttachmentReferences(event),
    event.body,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function renderAttentionSettlementCorrection(references: readonly string[]) {
  return [
    '[Attention settlement correction for the current internal turn.]',
    'The previous response left the exact Assistant-owned Attention references below open without a durable internal continuation or actionable operator request.',
    references.join('\n'),
    'Re-read current state. Resolve each blocker that is now false or superseded. Otherwise create the durable internal repair/retry/planning effect that continues it. Only if one exact decision, authorization, or external action remains, call hopi_request_user with one proportional, self-contained request that preserves the material cause, blocking consequence, exact need, non-obvious alternative effects, and a recommendation when one exists. hopi_notify_user alone does not settle this check. Do not finish as a no-op.',
  ].join('\n\n')
}

function renderPreference(preference: AssistantPreferenceDocument, writable: boolean) {
  return [
    '[Current durable cross-Project user preferences]',
    `Digest: ${preference.digest}`,
    'Apply relevant defaults; current turn and explicit Project/Goal authority override them.',
    ...(writable
      ? [
          'For a reusable cross-Project default, call hopi_write_preferences with the complete updated Markdown and this exact digest; preserve valid entries. Exclude one-off, current-task, and Project-specific rules. Remembering does not change current delivery; use design or Planning separately when both effects are intended.',
        ]
      : ['This internal turn may use these defaults for communication but cannot modify them.']),
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
    context.projectId && context.goalId ? `${context.projectId} / ${context.goalId}` : 'Workspace'
  return `${location}${renderAttentionContext(context)}`
}

function renderOperatorReplyContract() {
  return [
    '[Operator-facing reply contract]',
    "- Start with the outcome or current condition in the operator's language; do not repeat the request.",
    '- Default to one or two short sentences. Add only detail that changes understanding or a decision, unless asked.',
    '- If the operator must act, state one concrete question or instruction. Otherwise do not invent next steps or narrate the workflow.',
    '- Omit internal IDs and process unless requested or needed; if an effect lands in another Goal, include its name and exact Goal ID.',
    '- For a deliverable link, use a returned operatorUrl in Markdown; never link inspectionPath or any machine-local path.',
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
