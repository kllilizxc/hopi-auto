import { appendFile } from 'node:fs/promises'
import { createEnvironmentSecretRedactor } from '../agent/environmentSecretRedactor'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { createProcessGroupTerminator } from '../runtime/processGroup'

export interface CodexAssistantForkInput {
  command: string[]
  cwd: string
  environment: Record<string, string | undefined>
  parentSessionId: string
  prompt: string
  imageFiles?: readonly string[]
  model?: string
  reasoningEffort?: string
  fullAccess: boolean
  transcriptFile: string
  lastMessageFile: string
  signal?: AbortSignal
}

export interface CodexAssistantForkObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onSession?(sessionId: string): Promise<void> | void
}

export async function runCodexAssistantFork(
  input: CodexAssistantForkInput,
  observer?: CodexAssistantForkObserver,
) {
  const redact = createEnvironmentSecretRedactor(input.environment)
  const child = Bun.spawn(input.command, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'pipe',
    env: input.environment,
    detached: true,
  })
  const terminate = createProcessGroupTerminator(child.pid, { trackDescendants: true })
  const stderr = new BoundedLineTail()
  let branchSessionId: string | null = null
  let finalReply = ''
  let completed = false
  let rejectCompletion: (error: Error) => void = () => undefined
  let resolveCompletion: () => void = () => undefined
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  const send = (message: unknown) => {
    if (typeof child.stdin === 'number' || !child.stdin) {
      throw new Error('Codex app-server stdin is unavailable')
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }
  const fail = (error: unknown) => {
    if (completed) return
    completed = true
    rejectCompletion(error instanceof Error ? error : new Error(String(error)))
  }
  const finish = () => {
    if (completed) return
    completed = true
    resolveCompletion()
  }
  const abort = () => {
    fail(new Error('Assistant supervision fork interrupted'))
    void terminate()
  }
  input.signal?.addEventListener('abort', abort, { once: true })

  const stdoutTask = consumeLines(child.stdout as ReadableStream<Uint8Array>, async (line) => {
    await appendFile(input.transcriptFile, `stdout: ${redact(line)}\n`)
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (!isRecord(message)) return

    if (message.id === 0) {
      if (message.error) {
        fail(new Error(`Codex app-server initialization failed: ${errorText(message.error)}`))
        return
      }
      send({ method: 'initialized', params: {} })
      send({
        method: 'thread/fork',
        id: 1,
        params: {
          threadId: input.parentSessionId,
          cwd: input.cwd,
          ...(input.model ? { model: input.model } : {}),
          approvalPolicy: 'never',
          sandbox: input.fullAccess ? 'danger-full-access' : 'workspace-write',
          ephemeral: true,
          excludeTurns: true,
        },
      })
      return
    }

    if (message.id === 1) {
      if (message.error) {
        fail(new Error(`Codex native fork failed: ${errorText(message.error)}`))
        return
      }
      const result = isRecord(message.result) ? message.result : null
      const thread = result && isRecord(result.thread) ? result.thread : null
      const threadId = thread && typeof thread.id === 'string' ? thread.id : null
      if (!threadId) {
        fail(new Error('Codex native fork did not return a branch thread ID'))
        return
      }
      branchSessionId = threadId
      await observer?.onSession?.(threadId)
      send({
        method: 'turn/start',
        id: 2,
        params: {
          threadId,
          input: [
            { type: 'text', text: input.prompt, text_elements: [] },
            ...(input.imageFiles ?? []).map((path) => ({ type: 'localImage', path })),
          ],
          cwd: input.cwd,
          approvalPolicy: 'never',
          ...(input.model ? { model: input.model } : {}),
          ...(input.reasoningEffort ? { effort: input.reasoningEffort } : {}),
        },
      })
      return
    }

    if (message.id === 2 && message.error) {
      fail(new Error(`Codex fork turn failed to start: ${errorText(message.error)}`))
      return
    }

    const method = typeof message.method === 'string' ? message.method : null
    const params = isRecord(message.params) ? message.params : null
    if (!method || !params) return
    if (method === 'item/completed' || method === 'item/started') {
      const item = isRecord(params.item) ? params.item : null
      if (!item) return
      const event = codexItemEvent(item, method)
      if (event) await observer?.onEvent?.(event)
      if (
        method === 'item/completed' &&
        item.type === 'agentMessage' &&
        typeof item.text === 'string'
      ) {
        finalReply = item.text
      }
      return
    }
    if (method === 'turn/completed' && params.threadId === branchSessionId) {
      const turn = isRecord(params.turn) ? params.turn : null
      if (!turn || turn.status !== 'completed') {
        fail(
          new Error(
            `Codex fork turn ${turn?.status === 'failed' ? `failed: ${errorText(turn.error)}` : `ended as ${String(turn?.status ?? 'unknown')}`}`,
          ),
        )
        return
      }
      if (Array.isArray(turn.items)) {
        for (const item of turn.items) {
          if (isRecord(item) && item.type === 'agentMessage' && typeof item.text === 'string') {
            finalReply = item.text
          }
        }
      }
      finish()
      return
    }
    if (method === 'error') {
      await observer?.onEvent?.({
        kind: 'transcript',
        transport: 'codex',
        entryKind: 'error',
        summary: errorText(params),
        vendorEventType: method,
      })
    }
  }).catch((error) => {
    fail(error)
  })

  const stderrTask = consumeLines(child.stderr as ReadableStream<Uint8Array>, async (line) => {
    const diagnostic = redact(line)
    stderr.push(diagnostic)
    await appendFile(input.transcriptFile, `stderr: ${diagnostic}\n`)
  }).catch((error) => {
    fail(error)
  })
  const exitTask = child.exited.then((exitCode) => {
    if (!completed) {
      fail(
        new Error(
          `Codex app-server exited before the fork settled (${exitCode}): ${stderr.last() ?? 'no error detail'}`,
        ),
      )
    }
    return exitCode
  })

  try {
    send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: { name: 'hopi', title: 'HOPI', version: '0.1.0' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    })
    await completion
    const settledBranchSessionId = branchSessionId as string | null
    if (!settledBranchSessionId) throw new Error('Codex supervision fork has no branch session')
    await Bun.write(input.lastMessageFile, finalReply)
    return { reply: finalReply.trim(), sessionId: settledBranchSessionId }
  } finally {
    input.signal?.removeEventListener('abort', abort)
    await terminate().catch(() => undefined)
    await Promise.allSettled([stdoutTask, stderrTask, exitTask])
  }
}

function codexItemEvent(
  item: Record<string, unknown>,
  method: 'item/started' | 'item/completed',
): AgentRuntimeEvent | null {
  const completed = method === 'item/completed'
  const itemId = typeof item.id === 'string' ? item.id : undefined
  if (item.type === 'agentMessage' && completed && typeof item.text === 'string') {
    return {
      kind: 'transcript',
      transport: 'codex',
      entryKind: 'assistant',
      summary: item.text,
      vendorEventType: method,
    }
  }
  if (item.type === 'commandExecution') {
    return {
      kind: 'transcript',
      transport: 'codex',
      entryKind: completed ? (item.status === 'failed' ? 'error' : 'tool_result') : 'tool_call',
      summary: completed
        ? compactText(
            typeof item.aggregatedOutput === 'string'
              ? item.aggregatedOutput
              : `Command ${String(item.status ?? 'completed')}`,
          )
        : String(item.command ?? 'Command'),
      toolName: 'command',
      ...(itemId ? { toolInvocationKey: itemId } : {}),
      vendorEventType: method,
    }
  }
  if (item.type === 'mcpToolCall') {
    const tool = typeof item.tool === 'string' ? item.tool : 'mcp'
    return {
      kind: 'transcript',
      transport: 'codex',
      entryKind: completed ? (item.status === 'failed' ? 'error' : 'tool_result') : 'tool_call',
      summary: completed
        ? compactText(errorText(item.error ?? item.result ?? item.status))
        : `Using ${tool}`,
      toolName: tool,
      ...(itemId ? { toolInvocationKey: itemId } : {}),
      vendorEventType: method,
    }
  }
  if (item.type === 'fileChange') {
    return {
      kind: 'transcript',
      transport: 'codex',
      entryKind: completed ? 'tool_result' : 'tool_call',
      summary: completed
        ? `File changes ${String(item.status ?? 'completed')}`
        : 'Applying file changes',
      toolName: 'apply_patch',
      ...(itemId ? { toolInvocationKey: itemId } : {}),
      vendorEventType: method,
    }
  }
  if (item.type === 'plan' && typeof item.text === 'string') {
    return {
      kind: 'plan',
      transport: 'codex',
      planId: itemId ?? 'codex-plan',
      status: completed ? 'completed' : 'active',
      items: [{ text: item.text, completed }],
      vendorEventType: method,
    }
  }
  return null
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

function compactText(value: string) {
  const normalized = value.trim()
  return normalized.length > 2_000 ? `${normalized.slice(0, 2_000)}...` : normalized
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value)) {
    for (const key of ['message', 'error', 'detail', 'additionalDetails']) {
      const candidate = value[key]
      if (typeof candidate === 'string') return candidate
    }
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
