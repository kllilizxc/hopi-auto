import type {
  RoleRunInput,
  RoleRunObserver,
  RoleRunResult,
  RoleRunner,
} from '../../src/agent/RoleRunner'
import type {
  AssistantModelInput,
  AssistantModelObserver,
  AssistantModelResult,
  AssistantModelRunner,
} from '../../src/assistant/workspaceAssistant'
import type { Responsibility } from '../../src/runtime/roleContextStager'

export type AssistantScript = (
  input: AssistantModelInput,
  observer?: AssistantModelObserver,
) => Promise<AssistantModelResult>

export type RoleScript = (input: RoleRunInput, observer?: RoleRunObserver) => Promise<RoleRunResult>

export class ScriptedAssistantRunner implements AssistantModelRunner {
  readonly modes: string[] = []
  private readonly publicScripts: AssistantScript[]

  constructor(publicScripts: AssistantScript[]) {
    this.publicScripts = [...publicScripts]
  }

  get remainingPublicScripts() {
    return this.publicScripts.length
  }

  async run(
    input: AssistantModelInput,
    observer?: AssistantModelObserver,
  ): Promise<AssistantModelResult> {
    const mode = input.toolMode ?? 'main'
    this.modes.push(mode)
    if (mode !== 'main') {
      return {
        reply: 'No user action is required for this deterministic state change.',
        session: { transport: 'codex', sessionId: `e2e-${mode}` },
      }
    }

    const script = this.publicScripts.shift()
    if (!script) throw new Error(`Unexpected public Assistant Run for event ${input.eventId}`)
    return script(input, observer)
  }
}

export class ScriptedRoleRunner implements RoleRunner {
  readonly responsibilities: Responsibility[] = []

  constructor(private readonly scripts: Record<Responsibility, RoleScript>) {}

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    this.responsibilities.push(input.responsibility)
    await observer?.onEvent?.({
      kind: 'message',
      level: 'info',
      role: input.responsibility,
      content: `Running deterministic ${input.responsibility} script.`,
    })
    return this.scripts[input.responsibility](input, observer)
  }
}

export async function callAssistantTool(
  input: AssistantModelInput,
  observer: AssistantModelObserver | undefined,
  name: string,
  args: unknown,
) {
  const invocationKey = `${input.eventId}:${name}`
  await observer?.onEvent?.({
    kind: 'transcript',
    transport: 'codex',
    entryKind: 'tool_call',
    summary: name,
    toolName: name,
    toolInvocationKey: invocationKey,
  })
  const response = await fetch(input.toolUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: input.toolToken, name, arguments: args }),
  })
  const result = await response.json()
  await observer?.onEvent?.({
    kind: 'transcript',
    transport: 'codex',
    entryKind: response.ok ? 'tool_result' : 'error',
    summary: response.ok ? `${name} completed` : `${name} failed`,
    toolName: name,
    toolInvocationKey: invocationKey,
  })
  if (!response.ok) {
    throw new Error(
      `Assistant tool ${name} failed with ${response.status}: ${JSON.stringify(result)}`,
    )
  }
  return result
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`)
  return body as T
}

export async function waitForValue<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  options: { timeoutMs?: number; intervalMs?: number; description: string },
) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 25
  const deadline = Date.now() + timeoutMs
  let lastValue: T | undefined
  while (Date.now() < deadline) {
    lastValue = await read()
    if (accepts(lastValue)) return lastValue
    await Bun.sleep(intervalMs)
  }
  throw new Error(
    `Timed out waiting for ${options.description}. Last value: ${safeJson(lastValue)}`,
  )
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
