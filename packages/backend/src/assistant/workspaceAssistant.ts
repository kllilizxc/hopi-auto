import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import { normalizeProcessOutputLine } from '../agent/vendorTranscript'
import type { RoleTransportConfig } from '../agent/vendorTransport'
import type { InboxEventDocument } from '../domain/assistantWorkspaceDocuments'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { AssistantConversationStore } from './assistantConversationStore'
import type { AssistantTools } from './assistantTools'

export interface AssistantModelInput {
  eventId: string
  prompt: string
  threadId: string | null
  cwd: string
  lastMessageFile: string
  transcriptFile: string
  toolUrl: string
  toolToken: string
  imageFiles?: string[]
  toolMode?: 'main' | 'internal' | 'reflection'
  signal?: AbortSignal
}

export interface AssistantModelResult {
  reply: string
  threadId: string
}

export interface AssistantModelObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onThreadId?(threadId: string): Promise<void> | void
}

export interface AssistantModelRunner {
  run(input: AssistantModelInput, observer?: AssistantModelObserver): Promise<AssistantModelResult>
}

export interface WorkspaceAssistant {
  process(eventId: string, signal?: AbortSignal): Promise<WorkspaceAssistantResult>
}

export type WorkspaceAssistantResult = { kind: 'answered'; eventId: string }

export class WorkspaceAssistantError extends Error {}

export function createConfiguredAssistantModelRunner(options: {
  resolveConfig(): RoleTransportConfig | Promise<RoleTransportConfig>
  resolveToolUrl(): string
}): AssistantModelRunner {
  return {
    async run(input, observer) {
      const config = await options.resolveConfig()
      if (config.transport !== 'codex') {
        throw new WorkspaceAssistantError(
          'Persistent workspace conversation currently requires the Codex transport',
        )
      }
      await mkdir(input.cwd, { recursive: true })
      await rm(input.lastMessageFile, { force: true })
      if (input.signal?.aborted)
        throw new WorkspaceAssistantError('Assistant model run interrupted')
      const command = assistantCodexCommand(config, {
        ...input,
        toolUrl: options.resolveToolUrl(),
      })
      const child = Bun.spawn(command, {
        cwd: input.cwd,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'pipe',
        env: process.env,
      })
      const abort = () => child.kill()
      input.signal?.addEventListener('abort', abort, { once: true })
      if (typeof child.stdin !== 'number' && child.stdin) {
        child.stdin.write(input.prompt)
        child.stdin.end()
      }

      let observedThreadId = input.threadId
      const stderr: string[] = []
      const consume = async (stream: 'stdout' | 'stderr', line: string) => {
        await appendFile(input.transcriptFile, `${stream}: ${line}\n`)
        if (stream === 'stdout') {
          const threadId = codexThreadId(line)
          if (threadId) {
            observedThreadId = threadId
            await observer?.onThreadId?.(threadId)
          }
        } else {
          stderr.push(line)
        }
        for (const event of normalizeProcessOutputLine({
          format: 'codex_jsonl',
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
          child.exited,
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
      if (exitCode !== 0) {
        throw new WorkspaceAssistantError(
          `Codex conversation exited with code ${exitCode}: ${stderr.at(-1) ?? 'no error detail'}`,
        )
      }
      if (!observedThreadId) {
        throw new WorkspaceAssistantError('Codex did not report a conversation thread ID')
      }
      const file = Bun.file(input.lastMessageFile)
      if (!(await file.exists())) {
        throw new WorkspaceAssistantError('Codex did not produce a final Assistant message')
      }
      const reply = (await file.text()).trim()
      if (!reply) throw new WorkspaceAssistantError('Codex produced an empty Assistant message')
      return { reply, threadId: observedThreadId }
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

  return {
    async process(eventId, signal) {
      const workspaceState = await input.workspace.readWorkspace()
      const event = workspaceState.events.get(eventId)
      if (!event) throw new WorkspaceAssistantError(`Inbox turn not found: ${eventId}`)
      if (event.attributes.status === 'handled') return { kind: 'answered', eventId }

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
        onThreadId: (threadId) => input.conversation.writeThreadId(threadId),
      }

      try {
        const imageFiles = await resolveEventImages(input.workspace, event)
        let threadId = await input.conversation.readThreadId()
        let result: AssistantModelResult
        try {
          result = await input.runner.run(
            {
              eventId,
              prompt: threadId
                ? renderTurn(event)
                : renderNewConversation(workspaceState.events, event),
              threadId,
              cwd: workspaceRoot,
              lastMessageFile: join(turnRoot, 'last-message.txt'),
              transcriptFile: join(turnRoot, 'transcript.log'),
              toolUrl: input.resolveToolUrl(),
              toolToken,
              imageFiles,
              toolMode: event.attributes.source === 'reflection' ? 'internal' : 'main',
              signal,
            },
            observer,
          )
        } catch (error) {
          if (!threadId) throw error
          await input.conversation.record(eventId, {
            kind: 'message',
            level: 'info',
            role: 'coordinator',
            content:
              'The saved Codex thread could not continue; rebuilding it from durable conversation history.',
          })
          await input.conversation.clearThreadId()
          threadId = null
          result = await input.runner.run(
            {
              eventId,
              prompt: renderNewConversation(workspaceState.events, event),
              threadId,
              cwd: workspaceRoot,
              lastMessageFile: join(turnRoot, 'last-message.txt'),
              transcriptFile: join(turnRoot, 'transcript.log'),
              toolUrl: input.resolveToolUrl(),
              toolToken,
              imageFiles,
              toolMode: event.attributes.source === 'reflection' ? 'internal' : 'main',
              signal,
            },
            observer,
          )
        }

        await input.conversation.writeThreadId(result.threadId)
        await input.workspace.handleEvent(eventId, {
          reply: result.reply,
          disposition: usedTool ? 'tools-used' : 'answered',
          handledAt: now(),
        })
        await input.conversation.complete(eventId)
        return { kind: 'answered', eventId }
      } catch (error) {
        await input.conversation.fail(eventId, errorMessage(error))
        throw error
      } finally {
        input.tools.revoke(toolToken)
      }
    },
  }
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
  if (input.threadId) command.push('resume')
  for (const imageFile of input.imageFiles ?? []) command.push('-i', imageFile)
  command.push('--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--json')
  command.push('-o', input.lastMessageFile)
  if (input.threadId) command.push(input.threadId)
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
    'Continue as a normal Codex conversation for the operator.',
    'Use HOPI tools only when the operator actually requests a durable Project, Goal, Work, design, Attention, or Preview effect.',
    'Page context is the preferred target for ambiguous references such as "this" or "continue", but explicit user intent may select another Goal, create a new Goal, or stay at Workspace scope.',
    'Page context never implies a mutation. Never turn greetings, discussion, or questions into Planning.',
    'Before admission, ask only when the requested outcome, target, or operator intent is materially unclear. Once it is clear enough to admit, use the appropriate HOPI tool; Planner owns technical and delivery clarification.',
    'Do not edit HOPI canonical files or project source directly. Use HOPI tools; implementation work must go through Planning and the fixed delivery flow.',
    'Current-turn images are already visible to you. Adopt only task-relevant images through the references field of the Goal tool you already need, with a concise purpose; leave unrelated images conversation-only. Never copy an Assistant-home attachment reference into Goal, design, or Work prose: adopted references return portable Goal-local asset paths for Planning.',
    'The current Inbox turn overrides older conversation. Read scoped current HOPI state before relying on possibly stale thread facts.',
    '',
    ...(history.length ? ['## Durable conversation history', '', ...history, ''] : []),
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
      'Re-read current HOPI state before acting. Use normal HOPI tools only when the brief remains valid.',
      'Call hopi_notify_user only when the operator should see your final reply; otherwise finish silently and the turn stays hidden.',
      renderOperatorReplyContract(),
      '[Rewrite the internal brief for the operator. Do not copy its internal IDs, role names, stages, or diagnostic process unless the operator needs that detail.]',
      context
        ? `[Suggested context: ${context.projectId} / ${context.goalId}${context.attentionId ? ` / Attention ${context.attentionId}` : ''}]`
        : '[Workspace context]',
      event.body,
    ].join('\n\n')
  }
  return [
    `[Current user Inbox turn ${event.attributes.id}; answer this event, not an earlier turn.]`,
    '[HOPI effects are asynchronous: after a mutating tool accepts the request, reply without sleeping or polling; Reflection reports later completion, blockers, or decisions.]',
    renderOperatorReplyContract(),
    context
      ? `[Preferred page context: ${context.projectId} / ${context.goalId}${context.attentionId ? ` / Attention ${context.attentionId}` : ''}]`
      : '[Workspace context]',
    renderAttachmentReferences(event),
    event.body,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function renderOperatorReplyContract() {
  return [
    '[Operator-facing reply contract]',
    '- Start with what happened or the current condition in plain language.',
    "- Default to one or two short sentences. Add detail only when it changes the operator's understanding or decision, or when asked.",
    '- If the operator must act, state one concrete question or instruction. Otherwise do not invent next steps or narrate the workflow.',
    '- Omit internal IDs, responsibility names, stages, tools, document paths, and verification process unless requested or needed to disambiguate a choice.',
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

function codexThreadId(line: string) {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    if (parsed.type !== 'thread.started') return null
    return typeof parsed.thread_id === 'string' ? parsed.thread_id : null
  } catch {
    return null
  }
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
