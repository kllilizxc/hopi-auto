import { appendFile, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { VendorSession } from '../agent/vendorAssistantOutput'
import { assertStableId } from '../domain/stableId'
import {
  readDurableJsonLines,
  repairDurableJsonLineTail,
  reportInvalidRuntimeRecord,
} from '../storage/jsonLines'
import {
  type AssistantConversationScope,
  assistantConversationScopeKey,
} from './assistantConversationScope'

const turnStatusSchema = z.enum(['running', 'interrupted', 'completed', 'failed'])

const turnManifestSchema = z
  .object({
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

const actionReceiptSchema = z
  .object({
    receiptId: z.string().min(1),
    scope: z.string().min(1),
    eventId: z.string().min(1),
    kind: z.enum(['tool', 'reply']),
    summary: z.string().min(1),
    detail: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    deliveredAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()

export type AssistantTurnStatus = z.infer<typeof turnStatusSchema>
export type AssistantTurnManifest = z.infer<typeof turnManifestSchema>
export type AssistantTurnEvent = AgentRuntimeEvent & { eventId: string; createdAt: string }
export type AssistantActionReceipt = z.infer<typeof actionReceiptSchema>

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
  recordActionReceipt(
    scope: AssistantConversationScope,
    receipt: Omit<AssistantActionReceipt, 'scope' | 'createdAt' | 'deliveredAt'>,
  ): Promise<AssistantActionReceipt>
  readPendingActionReceipts(scope: AssistantConversationScope): Promise<AssistantActionReceipt[]>
  acknowledgeActionReceipts(
    scope: AssistantConversationScope,
    receiptIds: readonly string[],
  ): Promise<void>
}

export function createAssistantConversationStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): AssistantConversationStore {
  const root = join(resolve(homeRoot), '.hopi', 'runtime', 'assistant')
  const turnsRoot = join(root, 'turns')
  const receiptsRoot = join(root, 'receipts')
  const sessionPath = (scope: AssistantConversationScope) =>
    scope.kind === 'home'
      ? join(root, 'sessions', 'home.json')
      : join(root, 'sessions', 'projects', `${projectSessionId(scope.projectId)}.json`)
  const now = options.now ?? (() => new Date())

  const turnRoot = (eventId: string) => join(turnsRoot, assertLocalId(eventId))
  const manifestPath = (eventId: string) => join(turnRoot(eventId), 'turn.json')
  const eventsPath = (eventId: string) => join(turnRoot(eventId), 'events.jsonl')
  const receiptScopeRoot = (scope: AssistantConversationScope) =>
    scope.kind === 'home'
      ? join(receiptsRoot, 'home')
      : join(receiptsRoot, 'projects', projectSessionId(scope.projectId))
  const receiptPath = (scope: AssistantConversationScope, receiptId: string) =>
    join(receiptScopeRoot(scope), `${assertLocalId(receiptId)}.json`)

  return {
    async interruptRunning() {
      await mkdir(turnsRoot, { recursive: true })
      const glob = new Bun.Glob('*/turn.json')
      for await (const relative of glob.scan({ cwd: turnsRoot, onlyFiles: true })) {
        const path = join(turnsRoot, relative)
        const manifest = await readJson(path, turnManifestSchema, true)
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
      const previous = await readJson(manifestPath(eventId), turnManifestSchema, true)
      const timestamp = now().toISOString()
      const manifest: AssistantTurnManifest = {
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
      const manifest = await readJson(manifestPath(eventId), turnManifestSchema, true)
      if (!manifest) return null
      return { manifest, events: await readEvents(eventsPath(eventId)) }
    },

    async readSession(scope, contractDigest, runtimeDigest) {
      const path = sessionPath(scope)
      const expectedScope = assistantConversationScopeKey(scope)
      const file = Bun.file(path)
      if (!(await file.exists())) return null
      let current: z.infer<typeof sessionManifestSchema>
      try {
        current = sessionManifestSchema.parse(await file.json())
      } catch (error) {
        reportInvalidRuntimeRecord(path, error)
        await rm(path, { force: true })
        return null
      }
      if (current.scope !== expectedScope) {
        await rm(path, { force: true })
        return null
      }
      if (contractDigest && current.contractDigest !== contractDigest) {
        await rm(path, { force: true })
        return null
      }
      if (runtimeDigest && current.runtimeDigest !== runtimeDigest) {
        await rm(path, { force: true })
        return null
      }
      return {
        transport: current.transport,
        sessionId: current.sessionId,
      }
    },

    async writeSession(scope, session, contractDigest, runtimeDigest) {
      const path = sessionPath(scope)
      await mkdir(dirname(path), { recursive: true })
      const manifest = sessionManifestSchema.parse({
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
    },

    async recordActionReceipt(scope, receipt) {
      const path = receiptPath(scope, receipt.receiptId)
      const expectedScope = assistantConversationScopeKey(scope)
      const existing = await readJson(path, actionReceiptSchema, true)
      if (existing?.scope === expectedScope) return existing
      if (existing) {
        reportInvalidRuntimeRecord(
          path,
          new Error(
            `Action receipt scope mismatch: expected ${expectedScope}, got ${existing.scope}`,
          ),
        )
      }
      const stored = actionReceiptSchema.parse({
        ...receipt,
        scope: expectedScope,
        createdAt: now().toISOString(),
        deliveredAt: null,
      })
      await writeJson(path, stored)
      return stored
    },

    async readPendingActionReceipts(scope) {
      const directory = receiptScopeRoot(scope)
      const expectedScope = assistantConversationScopeKey(scope)
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      const receipts = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(async (entry) => {
            const path = join(directory, entry.name)
            const receipt = await readJson(path, actionReceiptSchema, true)
            if (receipt && receipt.scope !== expectedScope) {
              reportInvalidRuntimeRecord(
                path,
                new Error(
                  `Action receipt scope mismatch: expected ${expectedScope}, got ${receipt.scope}`,
                ),
              )
              return null
            }
            return receipt
          }),
      )
      return receipts
        .filter(
          (receipt): receipt is AssistantActionReceipt =>
            receipt !== null && receipt.deliveredAt === null,
        )
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.receiptId.localeCompare(right.receiptId),
        )
    },

    async acknowledgeActionReceipts(scope, receiptIds) {
      const deliveredAt = now().toISOString()
      const expectedScope = assistantConversationScopeKey(scope)
      for (const receiptId of [...new Set(receiptIds)]) {
        const path = receiptPath(scope, receiptId)
        const receipt = await readJson(path, actionReceiptSchema, true)
        if (receipt && receipt.scope !== expectedScope) {
          reportInvalidRuntimeRecord(
            path,
            new Error(
              `Action receipt scope mismatch: expected ${expectedScope}, got ${receipt.scope}`,
            ),
          )
          continue
        }
        if (!receipt || receipt.deliveredAt !== null) {
          continue
        }
        await writeJson(path, { ...receipt, deliveredAt })
      }
    },
  }
}

async function finishManifest(
  path: string,
  status: Extract<AssistantTurnStatus, 'completed' | 'failed'>,
  error: string | null,
  now: () => Date,
) {
  const manifest = await readJson(path, turnManifestSchema, true)
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

async function readJson<T>(path: string, schema: z.ZodType<T>, isolate = false) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    return schema.parse(await file.json())
  } catch (error) {
    if (!isolate) throw error
    reportInvalidRuntimeRecord(path, error)
    return null
  }
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

function assertLocalId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid event ID: ${value}`)
  return value
}

function projectSessionId(value: string) {
  assertStableId(value, 'Project ID')
  return value
}
