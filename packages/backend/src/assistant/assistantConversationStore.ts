import { appendFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { VendorSession } from '../agent/vendorAssistantOutput'
import { assertStableId } from '../domain/stableId'
import { readDurableJsonLines, repairDurableJsonLineTail } from '../storage/jsonLines'
import {
  type AssistantConversationScope,
  assistantConversationScopeKey,
} from './assistantConversationScope'

const turnStatusSchema = z.enum(['running', 'interrupted', 'completed', 'failed'])

const turnManifestSchema = z
  .object({
    version: z.literal(1),
    eventId: z.string().min(1),
    status: turnStatusSchema,
    attempt: z.number().int().nonnegative(),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    error: z.string().nullable(),
  })
  .strict()

const sessionManifestSchema = z
  .object({
    version: z.literal(4),
    scope: z.string().min(1),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().min(1),
    contractDigest: z.string().min(1).nullable(),
    runtimeDigest: z.string().min(1).nullable(),
  })
  .strict()

const storedEventSchema = z
  .object({
    eventId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .passthrough()

export type AssistantTurnStatus = z.infer<typeof turnStatusSchema>
export type AssistantTurnManifest = z.infer<typeof turnManifestSchema>
export type AssistantTurnEvent = AgentRuntimeEvent & { eventId: string; createdAt: string }

export interface AssistantTurnRuntime {
  manifest: AssistantTurnManifest
  events: AssistantTurnEvent[]
}

export type AssistantSession = VendorSession

export interface AssistantConversationStore {
  interruptRunning(): Promise<void>
  begin(eventId: string): Promise<AssistantTurnManifest>
  record(eventId: string, event: AgentRuntimeEvent): Promise<AssistantTurnEvent>
  complete(eventId: string): Promise<void>
  fail(eventId: string, error: string): Promise<void>
  readTurn(eventId: string): Promise<AssistantTurnRuntime | null>
  readSession(
    scope: AssistantConversationScope,
    contractDigest?: string,
    runtimeDigest?: string,
  ): Promise<AssistantSession | null>
  writeSession(
    scope: AssistantConversationScope,
    session: AssistantSession,
    contractDigest?: string,
    runtimeDigest?: string,
  ): Promise<void>
  clearSession(scope: AssistantConversationScope): Promise<void>
  clearSessions(): Promise<void>
}

export function createAssistantConversationStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): AssistantConversationStore {
  const root = join(resolve(homeRoot), '.hopi', 'runtime', 'assistant')
  const turnsRoot = join(root, 'turns')
  const legacySessionPath = join(root, 'session.json')
  const sessionPath = (scope: AssistantConversationScope) =>
    scope.kind === 'home'
      ? join(root, 'sessions', 'home.json')
      : join(root, 'sessions', 'projects', `${projectSessionId(scope.projectId)}.json`)
  const now = options.now ?? (() => new Date())

  const turnRoot = (eventId: string) => join(turnsRoot, assertLocalId(eventId))
  const manifestPath = (eventId: string) => join(turnRoot(eventId), 'turn.json')
  const eventsPath = (eventId: string) => join(turnRoot(eventId), 'events.jsonl')

  return {
    async interruptRunning() {
      await rm(legacySessionPath, { force: true })
      await mkdir(turnsRoot, { recursive: true })
      const glob = new Bun.Glob('*/turn.json')
      for await (const relative of glob.scan({ cwd: turnsRoot, onlyFiles: true })) {
        const path = join(turnsRoot, relative)
        const manifest = await readJson(path, turnManifestSchema)
        if (!manifest || manifest.status !== 'running') continue
        const timestamp = now().toISOString()
        await writeJson(path, {
          ...manifest,
          status: 'interrupted',
          updatedAt: timestamp,
          completedAt: timestamp,
          error: 'Coordinator stopped before the Assistant turn completed.',
        })
      }
    },

    async begin(eventId) {
      const previous = await readJson(manifestPath(eventId), turnManifestSchema)
      const timestamp = now().toISOString()
      const manifest: AssistantTurnManifest = {
        version: 1,
        eventId,
        status: 'running',
        attempt: (previous?.attempt ?? 0) + 1,
        startedAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        error: null,
      }
      await mkdir(turnRoot(eventId), { recursive: true })
      await repairDurableJsonLineTail(eventsPath(eventId))
      await writeJson(manifestPath(eventId), manifest)
      await this.record(eventId, {
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content: previous
          ? `Resuming Assistant turn after ${previous.status}.`
          : 'Starting Assistant turn.',
      })
      return manifest
    },

    async record(eventId, event) {
      const stored: AssistantTurnEvent = {
        ...event,
        eventId: `AE-${crypto.randomUUID()}`,
        createdAt: now().toISOString(),
      }
      await mkdir(turnRoot(eventId), { recursive: true })
      await appendFile(eventsPath(eventId), `${JSON.stringify(stored)}\n`)
      return stored
    },

    async complete(eventId) {
      await finishManifest(manifestPath(eventId), 'completed', null, now)
    },

    async fail(eventId, error) {
      await this.record(eventId, {
        kind: 'message',
        level: 'error',
        role: 'assistant',
        content: error,
      })
      await finishManifest(manifestPath(eventId), 'failed', error, now)
    },

    async readTurn(eventId) {
      const manifest = await readJson(manifestPath(eventId), turnManifestSchema)
      if (!manifest) return null
      return { manifest, events: await readEvents(eventsPath(eventId)) }
    },

    async readSession(scope, contractDigest, runtimeDigest) {
      await rm(legacySessionPath, { force: true })
      const path = sessionPath(scope)
      const expectedScope = assistantConversationScopeKey(scope)
      const file = Bun.file(path)
      if (!(await file.exists())) return null
      let source: unknown
      try {
        source = await file.json()
      } catch {
        await rm(path, { force: true })
        return null
      }
      const current = sessionManifestSchema.safeParse(source)
      if (current.success) {
        if (current.data.scope !== expectedScope) {
          await rm(path, { force: true })
          return null
        }
        if (contractDigest && current.data.contractDigest !== contractDigest) {
          await rm(path, { force: true })
          return null
        }
        if (runtimeDigest && current.data.runtimeDigest !== runtimeDigest) {
          await rm(path, { force: true })
          return null
        }
        return {
          transport: current.data.transport,
          sessionId: current.data.sessionId,
        }
      }
      await rm(path, { force: true })
      return null
    },

    async writeSession(scope, session, contractDigest, runtimeDigest) {
      const path = sessionPath(scope)
      await mkdir(dirname(path), { recursive: true })
      const manifest = sessionManifestSchema.parse({
        version: 4,
        scope: assistantConversationScopeKey(scope),
        transport: session.transport,
        sessionId: session.sessionId.trim(),
        contractDigest: contractDigest?.trim() || null,
        runtimeDigest: runtimeDigest?.trim() || null,
      })
      await writeJson(path, manifest)
    },

    async clearSession(scope) {
      await rm(sessionPath(scope), { force: true })
    },

    async clearSessions() {
      await rm(join(root, 'sessions'), { recursive: true, force: true })
      await rm(legacySessionPath, { force: true })
    },
  }
}

async function finishManifest(
  path: string,
  status: Extract<AssistantTurnStatus, 'completed' | 'failed'>,
  error: string | null,
  now: () => Date,
) {
  const manifest = await readJson(path, turnManifestSchema)
  if (!manifest) return
  const timestamp = now().toISOString()
  await writeJson(path, {
    ...manifest,
    status,
    updatedAt: timestamp,
    completedAt: timestamp,
    error,
  })
}

async function readEvents(path: string) {
  return readDurableJsonLines(path, (value) => storedEventSchema.parse(value) as AssistantTurnEvent)
}

async function readJson<T>(path: string, schema: z.ZodType<T>) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return schema.parse(await file.json())
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(value, null, 2)}\n`)
}

function assertLocalId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid event ID: ${value}`)
  return value
}

function projectSessionId(value: string) {
  assertStableId(value, 'Project ID')
  return value
}
