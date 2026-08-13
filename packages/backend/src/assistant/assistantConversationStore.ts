import { appendFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { VendorSession } from '../agent/vendorAssistantOutput'
import { assertStableId } from '../domain/stableId'
import { writeJsonAtomically } from '../storage/atomicFile'
import { readDirectoryEntriesIfExists } from '../storage/filesystem'
import {
  readDurableJsonLines,
  repairDurableJsonLineTail,
  reportInvalidRuntimeRecord,
} from '../storage/jsonLines'
import {
  type AssistantConversationScope,
  type AssistantThreadScope,
  assistantConversationScopeKey,
  assistantThreadScopeKey,
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

const assistantSessionEpochCloseReasonSchema = z.enum([
  'contract_changed',
  'runtime_changed',
  'transport_changed',
  'session_unavailable',
  'explicit_rotation',
  'cleared',
  'replaced',
])

const assistantSessionEpochSchema = z
  .object({
    epoch: z.number().int().positive(),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().min(1),
    contractDigest: z.string().min(1).nullable(),
    runtimeDigest: z.string().min(1).nullable(),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    closeReason: assistantSessionEpochCloseReasonSchema.nullable(),
    handoffMarkdown: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((epoch, context) => {
    const closed = epoch.endedAt !== null
    if (closed !== (epoch.closeReason !== null) || closed !== (epoch.handoffMarkdown !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Session Epoch close facts must be present together',
      })
    }
  })

const assistantThreadManifestSchema = z
  .object({
    threadId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    origin: z
      .object({
        eventId: z.string().min(1),
        projectId: z.string().min(1).nullable(),
        goalId: z.string().min(1).nullable(),
      })
      .strict(),
    eventIds: z.array(z.string().min(1)),
    epochs: z.array(assistantSessionEpochSchema),
  })
  .strict()
  .superRefine((thread, context) => {
    if (new Set(thread.eventIds).size !== thread.eventIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Thread event IDs must be unique' })
    }
    if (!thread.eventIds.includes(thread.origin.eventId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Thread origin event must belong to the Thread',
      })
    }
    if (thread.origin.goalId && !thread.origin.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Thread origin Goal requires a Project',
      })
    }
    for (const [index, epoch] of thread.epochs.entries()) {
      if (epoch.epoch !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Session Epoch numbers must be contiguous',
        })
      }
      if (epoch.endedAt === null && index !== thread.epochs.length - 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Only the latest Session Epoch may remain active',
        })
      }
    }
  })

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
export type AssistantSessionEpochCloseReason = z.infer<
  typeof assistantSessionEpochCloseReasonSchema
>
export type AssistantSessionEpoch = z.infer<typeof assistantSessionEpochSchema>
export type AssistantThreadManifest = z.infer<typeof assistantThreadManifestSchema>

export interface AssistantThreadRegistration {
  threadId: string
  createdAt: string
  origin: AssistantThreadManifest['origin']
  eventIds: readonly string[]
}

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
  ensureThread(input: AssistantThreadRegistration): Promise<AssistantThreadManifest>
  readThread(scope: AssistantThreadScope): Promise<AssistantThreadManifest | null>
  readSession(
    scope: AssistantThreadScope,
    contractDigest?: string,
    runtimeDigest?: string,
  ): Promise<AssistantSession | null>
  writeSession(
    scope: AssistantThreadScope,
    session: AssistantSession,
    contractDigest?: string,
    runtimeDigest?: string,
  ): Promise<void>
  rotateSession(
    scope: AssistantThreadScope,
    input: { reason: AssistantSessionEpochCloseReason; handoffMarkdown: string },
  ): Promise<AssistantThreadManifest | null>
  clearSession(scope: AssistantThreadScope): Promise<void>
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
  const threadsRoot = join(root, 'threads')
  const threadPath = (scope: AssistantThreadScope) =>
    join(threadsRoot, `${threadFileId(scope.threadId)}.json`)
  const now = options.now ?? (() => new Date())
  const threadMutations = new Map<string, Promise<void>>()

  const turnRoot = (eventId: string) => join(turnsRoot, assertLocalId(eventId))
  const manifestPath = (eventId: string) => join(turnRoot(eventId), 'turn.json')
  const eventsPath = (eventId: string) => join(turnRoot(eventId), 'events.jsonl')
  const receiptScopeRoot = (scope: AssistantConversationScope) =>
    scope.kind === 'home'
      ? join(receiptsRoot, 'home')
      : join(receiptsRoot, 'projects', projectScopeId(scope.projectId))
  const receiptPath = (scope: AssistantConversationScope, receiptId: string) =>
    join(receiptScopeRoot(scope), `${assertLocalId(receiptId)}.json`)

  async function mutateThread<T>(
    scope: AssistantThreadScope,
    mutate: (current: AssistantThreadManifest | null) => Promise<T> | T,
  ) {
    const key = assistantThreadScopeKey(scope)
    const previous = threadMutations.get(key) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    threadMutations.set(key, queued)
    await previous
    try {
      return await mutate(await readThreadManifest(threadPath(scope), scope, true))
    } finally {
      release()
      if (threadMutations.get(key) === queued) threadMutations.delete(key)
    }
  }

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

    async ensureThread(registration) {
      const scope = { kind: 'thread', threadId: registration.threadId } as const
      return mutateThread(scope, async (current) => {
        assertStableId(registration.threadId, 'Thread ID')
        for (const eventId of registration.eventIds) assertStableId(eventId, 'Inbox event ID')
        if (!registration.eventIds.includes(registration.origin.eventId)) {
          throw new Error('Thread registration must include its origin event')
        }
        if (current && JSON.stringify(current.origin) !== JSON.stringify(registration.origin)) {
          throw new Error(`Thread origin changed: ${registration.threadId}`)
        }
        const timestamp = now().toISOString()
        const manifest = assistantThreadManifestSchema.parse({
          threadId: registration.threadId,
          createdAt: current?.createdAt ?? registration.createdAt,
          updatedAt: timestamp,
          origin: current?.origin ?? registration.origin,
          eventIds: [...new Set([...(current?.eventIds ?? []), ...registration.eventIds])],
          epochs: current?.epochs ?? [],
        })
        await writeJson(threadPath(scope), manifest)
        return manifest
      })
    },

    async readThread(scope) {
      return readThreadManifest(threadPath(scope), scope, true)
    },

    async readSession(scope, contractDigest, runtimeDigest) {
      return mutateThread(scope, async (current) => {
        const active = current?.epochs.at(-1)
        if (!current || !active || active.endedAt !== null) return null
        const invalidation =
          contractDigest && active.contractDigest !== contractDigest
            ? {
                reason: 'contract_changed' as const,
                handoff: 'The Assistant contract changed. Continue from durable Thread events.',
              }
            : runtimeDigest && active.runtimeDigest !== runtimeDigest
              ? {
                  reason: 'runtime_changed' as const,
                  handoff: 'The Assistant runtime changed. Continue from durable Thread events.',
                }
              : null
        if (invalidation) {
          const closed = closeActiveEpoch(
            current,
            invalidation.reason,
            sessionHandoff(invalidation.handoff),
            now(),
          )
          await writeJson(threadPath(scope), closed)
          return null
        }
        return { transport: active.transport, sessionId: active.sessionId }
      })
    },

    async writeSession(scope, session, contractDigest, runtimeDigest) {
      await mutateThread(scope, async (current) => {
        if (!current) throw new Error(`Thread is not registered: ${scope.threadId}`)
        const normalizedSession = {
          transport: session.transport,
          sessionId: session.sessionId.trim(),
          contractDigest: contractDigest?.trim() || null,
          runtimeDigest: runtimeDigest?.trim() || null,
        }
        const active = current.epochs.at(-1)
        if (
          active?.endedAt === null &&
          active.transport === normalizedSession.transport &&
          active.sessionId === normalizedSession.sessionId &&
          active.contractDigest === normalizedSession.contractDigest &&
          active.runtimeDigest === normalizedSession.runtimeDigest
        ) {
          return
        }
        const timestamp = now()
        const base =
          active?.endedAt === null
            ? closeActiveEpoch(
                current,
                'replaced',
                sessionHandoff('The provider replaced the active Session.'),
                timestamp,
              )
            : current
        const manifest = assistantThreadManifestSchema.parse({
          ...base,
          updatedAt: timestamp.toISOString(),
          epochs: [
            ...base.epochs,
            {
              epoch: base.epochs.length + 1,
              ...normalizedSession,
              startedAt: timestamp.toISOString(),
              endedAt: null,
              closeReason: null,
              handoffMarkdown: null,
            },
          ],
        })
        await writeJson(threadPath(scope), manifest)
      })
    },

    async rotateSession(scope, rotation) {
      return mutateThread(scope, async (current) => {
        if (!current || current.epochs.at(-1)?.endedAt !== null) return current
        const closed = closeActiveEpoch(
          current,
          rotation.reason,
          sessionHandoff(rotation.handoffMarkdown),
          now(),
        )
        await writeJson(threadPath(scope), closed)
        return closed
      })
    },

    async clearSession(scope) {
      await this.rotateSession(scope, {
        reason: 'cleared',
        handoffMarkdown:
          'The cached provider Session was cleared. Continue from durable Thread events.',
      })
    },

    async clearSessions() {
      for (const entry of await readDirectoryEntriesIfExists(threadsRoot)) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const path = join(threadsRoot, entry.name)
        const manifest = await readJson(path, assistantThreadManifestSchema, true)
        if (!manifest) continue
        await this.clearSession({ kind: 'thread', threadId: manifest.threadId })
      }
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
      const entries = await readDirectoryEntriesIfExists(directory)
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

async function readThreadManifest(path: string, scope: AssistantThreadScope, isolate: boolean) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  const manifest = await readJson(path, assistantThreadManifestSchema, isolate)
  if (!manifest || manifest.threadId !== scope.threadId) {
    if (manifest) {
      reportInvalidRuntimeRecord(
        path,
        new Error(`Thread identity mismatch: expected ${scope.threadId}, got ${manifest.threadId}`),
      )
    }
    if (isolate) await rm(path, { force: true })
    return null
  }
  return manifest
}

function closeActiveEpoch(
  thread: AssistantThreadManifest,
  reason: AssistantSessionEpochCloseReason,
  handoffMarkdown: string,
  endedAt: Date,
) {
  const active = thread.epochs.at(-1)
  if (!active || active.endedAt !== null) return thread
  const timestamp = endedAt.toISOString()
  return assistantThreadManifestSchema.parse({
    ...thread,
    updatedAt: timestamp,
    epochs: [
      ...thread.epochs.slice(0, -1),
      {
        ...active,
        endedAt: timestamp,
        closeReason: reason,
        handoffMarkdown,
      },
    ],
  })
}

function sessionHandoff(value: string) {
  const normalized = value.trim() || 'Continue from durable Thread events.'
  const bounded =
    normalized.length > 12_000 ? `${normalized.slice(0, 12_000)}\n\n[truncated]` : normalized
  return bounded.startsWith('#') ? bounded : `# Session Epoch handoff\n\n${bounded}`
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
  await writeJsonAtomically(path, value)
}

function assertLocalId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error(`Invalid event ID: ${value}`)
  return value
}

function threadFileId(value: string) {
  assertStableId(value, 'Thread ID')
  return value
}

function projectScopeId(value: string) {
  assertStableId(value, 'Project ID')
  return value
}
