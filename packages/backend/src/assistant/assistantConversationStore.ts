import { appendFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { VendorSession } from '../agent/vendorAssistantOutput'
import { readDurableJsonLines, repairDurableJsonLineTail } from '../storage/jsonLines'

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
    version: z.literal(3),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().min(1),
    contractDigest: z.string().min(1).nullable(),
    runtimeDigest: z.string().min(1).nullable(),
  })
  .strict()

const versionTwoSessionManifestSchema = z
  .object({
    version: z.literal(2),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().min(1),
    contractDigest: z.string().min(1).nullable(),
  })
  .strict()

const previousSessionManifestSchema = z
  .object({
    version: z.literal(1),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().min(1),
  })
  .strict()

const legacySessionManifestSchema = z
  .object({
    version: z.literal(1),
    threadId: z.string().min(1),
    updatedAt: z.string().datetime({ offset: true }),
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
  readSession(contractDigest?: string, runtimeDigest?: string): Promise<AssistantSession | null>
  writeSession(
    session: AssistantSession,
    contractDigest?: string,
    runtimeDigest?: string,
  ): Promise<void>
  clearSession(): Promise<void>
}

export function createAssistantConversationStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): AssistantConversationStore {
  const root = join(resolve(homeRoot), '.hopi', 'runtime', 'assistant')
  const turnsRoot = join(root, 'turns')
  const sessionPath = join(root, 'session.json')
  const now = options.now ?? (() => new Date())

  const turnRoot = (eventId: string) => join(turnsRoot, assertLocalId(eventId))
  const manifestPath = (eventId: string) => join(turnRoot(eventId), 'turn.json')
  const eventsPath = (eventId: string) => join(turnRoot(eventId), 'events.jsonl')

  return {
    async interruptRunning() {
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

    async readSession(contractDigest, runtimeDigest) {
      const file = Bun.file(sessionPath)
      if (!(await file.exists())) return null
      let source: unknown
      try {
        source = await file.json()
      } catch {
        await rm(sessionPath, { force: true })
        return null
      }
      const current = sessionManifestSchema.safeParse(source)
      if (current.success) {
        if (contractDigest && current.data.contractDigest !== contractDigest) {
          await rm(sessionPath, { force: true })
          return null
        }
        if (runtimeDigest && current.data.runtimeDigest !== runtimeDigest) {
          await rm(sessionPath, { force: true })
          return null
        }
        return {
          transport: current.data.transport,
          sessionId: current.data.sessionId,
        }
      }
      const versionTwo = versionTwoSessionManifestSchema.safeParse(source)
      if (versionTwo.success) {
        if (contractDigest || runtimeDigest) {
          await rm(sessionPath, { force: true })
          return null
        }
        const migrated: AssistantSession = {
          transport: versionTwo.data.transport,
          sessionId: versionTwo.data.sessionId,
        }
        await writeJson(sessionPath, {
          version: 3,
          ...migrated,
          contractDigest: versionTwo.data.contractDigest,
          runtimeDigest: null,
        })
        return migrated
      }
      const previous = previousSessionManifestSchema.safeParse(source)
      if (previous.success) {
        if (contractDigest || runtimeDigest) {
          await rm(sessionPath, { force: true })
          return null
        }
        const migrated: AssistantSession = {
          transport: previous.data.transport,
          sessionId: previous.data.sessionId,
        }
        await writeJson(sessionPath, {
          version: 3,
          ...migrated,
          contractDigest: null,
          runtimeDigest: null,
        })
        return migrated
      }

      const legacy = legacySessionManifestSchema.safeParse(source)
      if (!legacy.success) {
        await rm(sessionPath, { force: true })
        return null
      }
      if (contractDigest || runtimeDigest) {
        await rm(sessionPath, { force: true })
        return null
      }
      const migrated: AssistantSession = {
        transport: 'codex',
        sessionId: legacy.data.threadId,
      }
      await writeJson(sessionPath, {
        version: 3,
        ...migrated,
        contractDigest: null,
        runtimeDigest: null,
      })
      return migrated
    },

    async writeSession(session, contractDigest, runtimeDigest) {
      await mkdir(root, { recursive: true })
      const manifest = sessionManifestSchema.parse({
        version: 3,
        transport: session.transport,
        sessionId: session.sessionId.trim(),
        contractDigest: contractDigest?.trim() || null,
        runtimeDigest: runtimeDigest?.trim() || null,
      })
      await writeJson(sessionPath, manifest)
    },

    async clearSession() {
      await rm(sessionPath, { force: true })
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
