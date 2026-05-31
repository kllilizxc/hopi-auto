import { join } from 'node:path'
import { z } from 'zod'
import type { AgentRunner } from './agent/AgentRunner'
import { MockAgentRunner } from './agent/AgentRunner'
import { BLOCKER_KINDS, TASK_KINDS, TASK_STATUSES } from './domain/board'
import { createAttemptStore } from './runtime/attemptStore'
import { reconcileOnce } from './scheduler/reconcileOnce'
import { createBoardStore } from './storage/boardStore'

export interface ServerOptions {
  rootDir?: string
  port?: number
  runner?: AgentRunner
}

type EventClient = ReadableStreamDefaultController<Uint8Array>

const jsonHeaders = { 'content-type': 'application/json' }
const encoder = new TextEncoder()

const blockerSchema = z.object({
  kind: z.enum(BLOCKER_KINDS),
  ref: z.string().min(1),
})

const createTaskSchema = z.object({
  ref: z.string().min(1),
  kind: z.enum(TASK_KINDS),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)),
  blockedBy: z.array(blockerSchema).default([]),
})

const moveTaskSchema = z.object({
  status: z.enum(TASK_STATUSES),
  reason: z.string().min(1).default('manual transition'),
})

export function createServer(options: ServerOptions = {}): Bun.Server<undefined> {
  const rootDir = options.rootDir ?? process.cwd()
  const store = createBoardStore(rootDir)
  const attempts = createAttemptStore(rootDir)
  const runner = options.runner ?? new MockAgentRunner()
  const clients = new Set<EventClient>()

  function broadcast(payload: unknown) {
    const message = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
    for (const client of clients) {
      try {
        client.enqueue(message)
      } catch {
        clients.delete(client)
      }
    }
  }

  return Bun.serve({
    port: options.port ?? 3000,
    async fetch(request) {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const goalKey = routeGoalKey(parts)

      try {
        if (request.method === 'GET' && url.pathname === '/') {
          return textResponse('HOPI backend')
        }

        if (request.method === 'GET' && url.pathname === '/api/events') {
          return eventsResponse(clients)
        }

        if (request.method === 'GET' && isGoalRoute(parts, 'board')) {
          const currentGoalKey = requireGoalKey(parts)
          return jsonResponse(await store.readBoard(currentGoalKey))
        }

        if (request.method === 'POST' && isGoalRoute(parts, 'tasks') && parts.length === 4) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, createTaskSchema)
          await store.mutateBoard(currentGoalKey, 'api', `create ${body.ref}`, (board) => {
            if (board.items.some((task) => task.ref === body.ref)) {
              throw new HttpError(409, `Task already exists: ${body.ref}`)
            }

            board.items.push({
              ...body,
              blockedBy: body.blockedBy ?? [],
              status: 'planned',
            })
          })
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(await store.readBoard(currentGoalKey), 201)
        }

        if (
          request.method === 'POST' &&
          isGoalRoute(parts, 'tasks') &&
          parts.length === 6 &&
          parts[5] === 'move'
        ) {
          const currentGoalKey = requireGoalKey(parts)
          const body = await parseJsonBody(request, moveTaskSchema)
          const taskRef = requirePathPart(parts, 4)
          await store.mutateBoard(
            currentGoalKey,
            'api',
            body.reason ?? 'manual transition',
            (board) => {
              const task = board.items.find((item) => item.ref === taskRef)
              if (!task) {
                throw new HttpError(404, `Task not found: ${taskRef}`)
              }
              task.status = body.status
            },
          )
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(await store.readBoard(currentGoalKey))
        }

        if (request.method === 'POST' && isGoalRoute(parts, 'reconcile')) {
          const currentGoalKey = requireGoalKey(parts)
          const result = await reconcileOnce({
            goalKey: currentGoalKey,
            store,
            attempts,
            runner,
            writer: 'api',
          })
          broadcast({ type: 'board_changed', goalKey: currentGoalKey })
          return jsonResponse(result)
        }

        return jsonResponse({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof HttpError) {
          return jsonResponse({ error: error.message }, error.status)
        }

        const correlationId = crypto.randomUUID()
        if (goalKey) {
          await store
            .appendEvent(goalKey, {
              writer: 'api',
              action: 'system_error',
              goalKey,
              systemError: {
                kind: 'route_error',
                message: errorMessage(error),
                correlationId,
              },
            })
            .catch(() => undefined)
        }

        return jsonResponse({ error: 'Internal server error', correlationId }, 500)
      }
    },
  })
}

function isGoalRoute(parts: string[], leaf: string) {
  return parts[0] === 'api' && parts[1] === 'goals' && Boolean(parts[2]) && parts[3] === leaf
}

function routeGoalKey(parts: string[]) {
  return parts[0] === 'api' && parts[1] === 'goals' ? parts[2] : undefined
}

function requireGoalKey(parts: string[]) {
  return requirePathPart(parts, 2)
}

function requirePathPart(parts: string[], index: number) {
  const value = parts[index]
  if (!value) {
    throw new HttpError(404, 'Not found')
  }
  return value
}

async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid request body')
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request body')
  }
  return parsed.data
}

function eventsResponse(clients: Set<EventClient>) {
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

if (import.meta.main) {
  const server = createServer({ rootDir: join(import.meta.dir, '..', '..', '..') })
  console.log(`[API] Server listening on http://localhost:${server.port}`)
}
