import { z } from 'zod'
import type { AgentRuntimeEvent } from './agent/AgentRunner'
import type { MessageFeedItem } from './runtime/messageFeed'

export type EventClient = ReadableStreamDefaultController<Uint8Array>

const jsonHeaders = { 'content-type': 'application/json' }
const encoder = new TextEncoder()
const roleQuerySchema = z.enum(['planner', 'generator', 'reviewer', 'merger'])

export const DEFAULT_PROJECT_KEY = '__default__'

export interface GoalRouteMatch {
  projectKey?: string
  goalKey: string
  leaf: string
  extra: string[]
}

export function isProjectsRoute(parts: string[]) {
  return parts[0] === 'api' && parts[1] === 'projects' && parts.length === 2
}

export function isProjectGoalsCollectionRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    parts.length === 4
  )
}

export function isProjectSettingsRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'settings' &&
    parts.length === 4
  )
}

export function isGoalStartRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'start' &&
    parts.length === 6
  )
}

export function isGoalStopRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'stop' &&
    parts.length === 6
  )
}

export function isGoalAutomationRoute(parts: string[]) {
  return (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    Boolean(parts[2]) &&
    parts[3] === 'goals' &&
    Boolean(parts[4]) &&
    parts[5] === 'automation' &&
    parts.length === 6
  )
}

export function matchGoalRoute(parts: string[]): GoalRouteMatch | undefined {
  const legacyGoalKey = parts[2]
  const legacyLeaf = parts[3]
  if (parts[0] === 'api' && parts[1] === 'goals' && legacyGoalKey && legacyLeaf) {
    return {
      goalKey: legacyGoalKey,
      leaf: legacyLeaf,
      extra: parts.slice(4),
    }
  }

  const projectKey = parts[2]
  const projectGoalKey = parts[4]
  const projectLeaf = parts[5]
  if (
    parts[0] === 'api' &&
    parts[1] === 'projects' &&
    projectKey &&
    parts[3] === 'goals' &&
    projectGoalKey &&
    projectLeaf
  ) {
    return {
      projectKey,
      goalKey: projectGoalKey,
      leaf: projectLeaf,
      extra: parts.slice(6),
    }
  }

  return undefined
}

export function isGoalLeafRoute(route: GoalRouteMatch | undefined, leaf: string, extraLength = 0) {
  return Boolean(route && route.leaf === leaf && route.extra.length === extraLength)
}

export function requireGoalRoute(route: GoalRouteMatch | undefined) {
  if (!route) {
    throw new HttpError(404, 'Not found')
  }
  return route
}

export function requireGoalExtra(route: GoalRouteMatch | undefined, index: number) {
  return requirePathPart(requireGoalRoute(route).extra, index)
}

export function requireRouteContext<T>(context: T | undefined) {
  if (!context) {
    throw new HttpError(404, 'Not found')
  }
  return context
}

export function requirePathPart(parts: string[], index: number) {
  const value = parts[index]
  if (!value) {
    throw new HttpError(404, 'Not found')
  }
  return value
}

export function parseAssistantImageEntries(formData: FormData) {
  const images = formData
    .getAll('images[]')
    .concat(formData.getAll('images'))
    .filter((entry): entry is File => entry instanceof File)

  const unexpectedImageValue = formData
    .getAll('images[]')
    .concat(formData.getAll('images'))
    .find((entry) => !(entry instanceof File))
  if (unexpectedImageValue !== undefined) {
    throw new HttpError(400, 'Invalid request body')
  }
  return images
}

export function stringQuery(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim()
  return value ? value : undefined
}

export function numberQuery(url: URL, key: string) {
  const value = stringQuery(url, key)
  if (!value) {
    return undefined
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `Invalid query parameter: ${key}`)
  }
  return parsed
}

export function roleQuery(url: URL) {
  const value = stringQuery(url, 'role')
  if (!value) {
    return undefined
  }

  const parsed = roleQuerySchema.safeParse(value)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid query parameter: role')
  }
  return parsed.data
}

export function assistantRuntimeEventToFeedItem(
  assistantRunId: string,
  event: AgentRuntimeEvent,
): MessageFeedItem | null {
  const createdAt = new Date().toISOString()

  if (event.kind === 'message') {
    return {
      id: `assistant-runtime:${assistantRunId}:${crypto.randomUUID()}`,
      createdAt,
      kind: 'system_message',
      role: 'system',
      text: event.content,
      collapsedByDefault: true,
      label: `Assistant ${event.level ?? 'info'}`,
      details: [event.role ?? 'assistant'],
    }
  }

  if (event.kind !== 'transcript') {
    return null
  }

  if (event.entryKind === 'assistant') {
    return null
  }

  if (
    event.entryKind === 'status' &&
    (event.summary === 'thread started' ||
      event.summary === 'turn started' ||
      event.summary === 'thread completed' ||
      event.summary === 'turn completed')
  ) {
    return null
  }

  return {
    id: `assistant-runtime:${assistantRunId}:${crypto.randomUUID()}`,
    createdAt,
    kind:
      event.entryKind === 'tool_call'
        ? 'tool_call'
        : event.entryKind === 'tool_result'
          ? 'tool_result'
          : 'status',
    role: 'system',
    text: event.summary,
    collapsedByDefault: true,
    label:
      event.entryKind === 'tool_call'
        ? 'Tool call'
        : event.entryKind === 'tool_result'
          ? 'Tool result'
          : event.entryKind === 'error'
            ? 'Error'
            : 'Status',
    details: [
      ...(event.transport ? [event.transport] : []),
      ...(event.toolName ? [`tool=${event.toolName}`] : []),
      ...(event.vendorEventType ? [`vendor=${event.vendorEventType}`] : []),
    ],
    ...(event.toolName ? { toolName: event.toolName } : {}),
    ...(event.transport ? { transport: event.transport } : {}),
    ...(event.vendorEventType ? { vendorEventType: event.vendorEventType } : {}),
  }
}

export function eventsResponse(clients: Set<EventClient>) {
  let client: EventClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller
      clients.add(controller)
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
    },
    cancel() {
      if (client) {
        clients.delete(client)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

export function feedEventsResponse(
  feedClients: Map<string, Set<EventClient>>,
  scope: string,
  onStart?: (controller: EventClient) => Promise<void> | void,
) {
  let client: EventClient | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      client = controller
      const scopeClients = feedClients.get(scope) ?? new Set<EventClient>()
      scopeClients.add(controller)
      feedClients.set(scope, scopeClients)
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'))
      await onStart?.(controller)
    },
    cancel() {
      if (!client) {
        return
      }

      const scopeClients = feedClients.get(scope)
      scopeClients?.delete(client)
      if (scopeClients && scopeClients.size === 0) {
        feedClients.delete(scope)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
