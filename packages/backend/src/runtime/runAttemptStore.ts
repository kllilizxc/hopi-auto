import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import {
  type RoleExecutionIdentity,
  type RoleRunResult,
  STORED_PASS_RESULTS,
  type StoredPassResultKind,
} from '../agent/RoleRunner'
import {
  AGENT_TRANSCRIPT_ENTRY_KINDS,
  AGENT_TRANSCRIPT_TRANSPORTS,
  type AgentRuntimeEvent,
} from '../agent/runtimeEvents'
import { codingReasoningEffortSchema } from '../domain/projectCodingDefaults'
import { stableIdSchema } from '../domain/stableId'
import { readDurableJsonLines, repairDurableJsonLineTail } from '../storage/jsonLines'
import { RESPONSIBILITIES, type Responsibility } from './roleContextStager'
import { cleanupRunScratch } from './runArtifacts'
import { type RunAttemptDiagnostics, readRunAttemptDiagnostics } from './runAttemptDiagnostics'
import { legacyRunStoragePath, runStoragePath, runStorageRoot } from './runPaths'

export const RUN_ATTEMPT_STATUSES = ['running', 'finished', 'interrupted'] as const
export type RunAttemptStatus = (typeof RUN_ATTEMPT_STATUSES)[number]

const nullableResultSchema = z.enum(STORED_PASS_RESULTS).nullable()
const roleExecutionIdentitySchema = z
  .object({
    transport: z.enum(AGENT_TRANSCRIPT_TRANSPORTS),
    model: z.string().min(1).nullable(),
    reasoningEffort: codingReasoningEffortSchema.nullable().default(null),
  })
  .strict()
const attemptManifestSchema = z
  .object({
    version: z.literal(1),
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema,
    runId: stableIdSchema,
    responsibility: z.enum(RESPONSIBILITIES),
    execution: roleExecutionIdentitySchema.nullable().default(null),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(RUN_ATTEMPT_STATUSES),
    result: nullableResultSchema,
    summary: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    application: z.string().nullable(),
  })
  .strict()
const attemptIdentitySchema = attemptManifestSchema.pick({
  projectId: true,
  goalId: true,
  workId: true,
  runId: true,
})

const storedMessageEventSchema = z
  .object({
    eventId: stableIdSchema,
    createdAt: z.string().datetime(),
    kind: z.literal('message'),
    level: z.enum(['info', 'error']),
    role: z.string().min(1),
    content: z.string(),
  })
  .strict()

const storedTranscriptEventSchema = z
  .object({
    eventId: stableIdSchema,
    createdAt: z.string().datetime(),
    kind: z.literal('transcript'),
    transport: z.enum(AGENT_TRANSCRIPT_TRANSPORTS),
    entryKind: z.enum(AGENT_TRANSCRIPT_ENTRY_KINDS),
    summary: z.string(),
    toolName: z.string().min(1).optional(),
    toolInvocationKey: z.string().min(1).optional(),
    vendorEventType: z.string().min(1).optional(),
  })
  .strict()

const storedPlanEventSchema = z
  .object({
    eventId: stableIdSchema,
    createdAt: z.string().datetime(),
    kind: z.literal('plan'),
    transport: z.enum(AGENT_TRANSCRIPT_TRANSPORTS),
    planId: z.string().min(1),
    status: z.enum(['active', 'completed']),
    items: z
      .array(
        z
          .object({
            text: z.string().min(1),
            completed: z.boolean(),
          })
          .strict(),
      )
      .min(1),
    vendorEventType: z.string().min(1).optional(),
  })
  .strict()

const storedEventSchema = z.discriminatedUnion('kind', [
  storedMessageEventSchema,
  storedTranscriptEventSchema,
  storedPlanEventSchema,
])
const legacyResultSchema = z
  .object({
    result: z.enum(STORED_PASS_RESULTS),
    summary: z.string(),
    artifacts: z.array(z.string()).optional(),
  })
  .passthrough()

export type RunAttemptSummary = z.infer<typeof attemptManifestSchema>
export type StoredRunAttemptEvent = z.infer<typeof storedEventSchema>
export interface RunAttemptDetail extends RunAttemptSummary {
  events: StoredRunAttemptEvent[]
  runPrompt: string | null
}

export interface RunAttemptMetadata extends RunAttemptSummary {
  runPrompt: string | null
}

export interface StartRunAttemptInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  runRoot: string
}

export interface FinishRunAttemptInput {
  outcome: Pick<RoleRunResult, 'result' | 'summary' | 'exitCode'>
  application: string
}

export interface RunAttemptRecorder {
  record(event: AgentRuntimeEvent): Promise<void>
  setExecution(execution: RoleExecutionIdentity): Promise<void>
  finish(input: FinishRunAttemptInput): Promise<void>
  interrupt(error: unknown): Promise<void>
}

export interface RunAttemptSnapshot {
  running(): readonly RunAttemptSummary[]
  list(projectId: string, goalId: string, workId: string): readonly RunAttemptSummary[]
  listGoal(projectId: string, goalId: string): ReadonlyMap<string, readonly RunAttemptSummary[]>
}

export interface RunAttemptStore {
  start(input: StartRunAttemptInput): Promise<RunAttemptRecorder>
  snapshot(): Promise<RunAttemptSnapshot>
  list(projectId: string, goalId: string, workId: string): Promise<RunAttemptSummary[]>
  listGoal(projectId: string, goalId: string): Promise<Map<string, RunAttemptSummary[]>>
  read(
    projectId: string,
    goalId: string,
    workId: string,
    runId: string,
  ): Promise<RunAttemptDetail | null>
  readMetadata(
    projectId: string,
    goalId: string,
    workId: string,
    runId: string,
  ): Promise<RunAttemptMetadata | null>
  readEvents(
    projectId: string,
    goalId: string,
    workId: string,
    runId: string,
  ): Promise<StoredRunAttemptEvent[] | null>
  readDiagnostics(
    projectId: string,
    goalId: string,
    workId: string,
    runId: string,
  ): Promise<RunAttemptDiagnostics | null>
  interruptRunningAttempts(): Promise<number>
}

export function createRunAttemptStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): RunAttemptStore {
  const attemptsRoot = runStorageRoot(homeRoot)
  const now = options.now ?? (() => new Date())
  const finishedDiagnostics = new Map<string, RunAttemptDiagnostics>()

  return {
    async start(input) {
      assertIds(input.projectId, input.goalId, input.workId, input.runId)
      const expectedRoot = runStoragePath(homeRoot, input.runId)
      if (resolve(input.runRoot) !== expectedRoot) {
        throw new Error(`Run root does not match Attempt identity: ${input.runRoot}`)
      }

      let manifest: RunAttemptSummary = {
        version: 1,
        projectId: input.projectId,
        goalId: input.goalId,
        workId: input.workId,
        runId: input.runId,
        responsibility: input.responsibility,
        execution: null,
        startedAt: now().toISOString(),
        endedAt: null,
        status: 'running',
        result: null,
        summary: null,
        exitCode: null,
        application: null,
      }
      const manifestPath = join(expectedRoot, 'attempt.json')
      const eventsPath = join(expectedRoot, 'events.jsonl')
      await mkdir(expectedRoot, { recursive: true })
      await writeManifest(manifestPath, manifest)
      await Bun.write(eventsPath, '')

      let closed = false
      let writeTail: Promise<void> = Promise.resolve()
      const enqueue = (event: AgentRuntimeEvent) => {
        if (closed) return writeTail
        const stored = storeEvent(event, now())
        writeTail = writeTail
          .catch(() => undefined)
          .then(() => appendFile(eventsPath, `${JSON.stringify(stored)}\n`))
          .catch(() => undefined)
        return writeTail
      }
      const close = async (next: RunAttemptSummary, event: AgentRuntimeEvent) => {
        if (closed) return
        await enqueue(event)
        closed = true
        await writeTail
        await writeManifest(manifestPath, next)
      }

      await enqueue({
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content: `${input.responsibility} Attempt started.`,
      })

      return {
        record: enqueue,
        async setExecution(execution) {
          if (closed) return
          manifest = { ...manifest, execution }
          await writeManifest(manifestPath, manifest)
        },
        async finish({ outcome, application }) {
          const endedAt = now().toISOString()
          await close(
            {
              ...manifest,
              endedAt,
              status: 'finished',
              result: outcome.result,
              summary: outcome.summary,
              exitCode: outcome.exitCode,
              application,
            },
            {
              kind: 'message',
              level: outcome.result === 'fail' ? 'error' : 'info',
              role: 'coordinator',
              content: `${input.responsibility} Attempt finished with ${outcome.result}: ${outcome.summary}`,
            },
          )
        },
        async interrupt(error) {
          const summary = errorMessage(error)
          await close(
            {
              ...manifest,
              endedAt: now().toISOString(),
              status: 'interrupted',
              summary,
            },
            {
              kind: 'message',
              level: 'error',
              role: 'coordinator',
              content: `Attempt interrupted: ${summary}`,
            },
          )
        },
      }
    },

    async snapshot() {
      return createAttemptSnapshot(await readAllAttemptSummaries(attemptsRoot))
    },

    async list(projectId, goalId, workId) {
      assertIds(projectId, goalId, workId)
      const snapshot = createAttemptSnapshot(await readAllAttemptSummaries(attemptsRoot))
      return [...snapshot.list(projectId, goalId, workId)]
    },

    async listGoal(projectId, goalId) {
      assertScopeIds(projectId, goalId)
      const snapshot = createAttemptSnapshot(await readAllAttemptSummaries(attemptsRoot))
      return new Map(
        [...snapshot.listGoal(projectId, goalId)].map(([workId, attempts]) => [
          workId,
          [...attempts],
        ]),
      )
    },

    async read(projectId, goalId, workId, runId) {
      const metadata = await this.readMetadata(projectId, goalId, workId, runId)
      if (!metadata) return null
      return {
        ...metadata,
        events: (await this.readEvents(projectId, goalId, workId, runId)) ?? [],
      }
    },

    async readMetadata(projectId, goalId, workId, runId) {
      assertIds(projectId, goalId, workId, runId)
      const root = await locateRunRoot(homeRoot, projectId, goalId, workId, runId)
      if (!root) return null
      const summary = await readSummary(root, projectId, goalId, workId, runId)
      if (!summary) return null
      return {
        ...summary,
        runPrompt: await readOptionalText(join(root, 'prompt.md')),
      }
    },

    async readEvents(projectId, goalId, workId, runId) {
      assertIds(projectId, goalId, workId, runId)
      const root = await locateRunRoot(homeRoot, projectId, goalId, workId, runId)
      if (!root) return null
      const summary = await readSummary(root, projectId, goalId, workId, runId)
      if (!summary) return null
      return readEvents(join(root, 'events.jsonl'))
    },

    async readDiagnostics(projectId, goalId, workId, runId) {
      assertIds(projectId, goalId, workId, runId)
      const cacheKey = `${projectId}\u0000${goalId}\u0000${workId}\u0000${runId}`
      const cached = finishedDiagnostics.get(cacheKey)
      if (cached) return cached
      const root = await locateRunRoot(homeRoot, projectId, goalId, workId, runId)
      if (!root) return null
      const summary = await readSummary(root, projectId, goalId, workId, runId)
      if (!summary) return null
      const events = await readEvents(join(root, 'events.jsonl'))
      const diagnostics = await readRunAttemptDiagnostics(root, summary, events, now())
      if (summary.endedAt) finishedDiagnostics.set(cacheKey, diagnostics)
      return diagnostics
    },

    async interruptRunningAttempts() {
      await mkdir(attemptsRoot, { recursive: true })
      let count = 0
      const manifestPaths = new Set<string>()
      for (const pattern of ['*/attempt.json', '*/*/*/*/attempt.json']) {
        for await (const relativePath of new Bun.Glob(pattern).scan({
          cwd: attemptsRoot,
          onlyFiles: true,
        })) {
          manifestPaths.add(join(attemptsRoot, relativePath))
        }
      }
      for (const path of manifestPaths) {
        const manifest = await readStoredManifest(path).catch(() => null)
        if (!manifest || manifest.status !== 'running') continue
        const endedAt = now().toISOString()
        const summary = 'Coordinator stopped before recording an Attempt outcome.'
        const eventsPath = join(resolve(path, '..'), 'events.jsonl')
        await repairDurableJsonLineTail(eventsPath)
          .then(() =>
            appendFile(
              eventsPath,
              `${JSON.stringify(
                storeEvent(
                  {
                    kind: 'message',
                    level: 'error',
                    role: 'coordinator',
                    content: summary,
                  },
                  new Date(endedAt),
                ),
              )}\n`,
            ),
          )
          .catch(() => undefined)
        await writeManifest(path, {
          ...manifest,
          endedAt,
          status: 'interrupted',
          summary,
        })
        await cleanupRunScratch(join(resolve(path, '..'), 'scratch')).catch(() => undefined)
        count += 1
      }
      return count
    },
  }
}

const RUN_MANIFEST_READ_CONCURRENCY = 32
const ATTEMPT_MANIFEST_PATTERNS = ['*/attempt.json', '*/*/*/*/attempt.json'] as const
const LEGACY_CONTEXT_PATTERNS = ['*/context.md', '*/*/*/*/context.md'] as const

async function readAllAttemptSummaries(attemptsRoot: string) {
  const manifestPaths = await scanAttemptPaths(attemptsRoot, ATTEMPT_MANIFEST_PATTERNS)
  const parsedManifests = await mapWithConcurrency(
    manifestPaths,
    RUN_MANIFEST_READ_CONCURRENCY,
    async (path) => ({
      root: dirname(path),
      attempt: await readStoredManifest(path).catch(() => null),
    }),
  )
  const manifestRoots = new Set(
    parsedManifests.flatMap(({ root, attempt }) => (attempt ? [root] : [])),
  )
  const contextPaths = await scanAttemptPaths(attemptsRoot, LEGACY_CONTEXT_PATTERNS)
  const legacyAttempts = await mapWithConcurrency(
    contextPaths.filter((path) => !manifestRoots.has(dirname(path))),
    RUN_MANIFEST_READ_CONCURRENCY,
    (path) => readLegacySnapshotSummary(attemptsRoot, dirname(path)),
  )
  return [
    ...parsedManifests.flatMap(({ attempt }) => (attempt ? [attempt] : [])),
    ...legacyAttempts.filter((attempt): attempt is RunAttemptSummary => attempt !== null),
  ]
}

function createAttemptSnapshot(attempts: readonly RunAttemptSummary[]): RunAttemptSnapshot {
  const grouped = new Map<string, Map<string, Map<string, RunAttemptSummary>>>()
  for (const attempt of attempts) {
    const goalKey = `${attempt.projectId}\u0000${attempt.goalId}`
    const byWork = grouped.get(goalKey) ?? new Map<string, Map<string, RunAttemptSummary>>()
    const byRun = byWork.get(attempt.workId) ?? new Map<string, RunAttemptSummary>()
    if (!byRun.has(attempt.runId)) byRun.set(attempt.runId, attempt)
    byWork.set(attempt.workId, byRun)
    grouped.set(goalKey, byWork)
  }
  const sorted = new Map<string, Map<string, readonly RunAttemptSummary[]>>()
  for (const [goalKey, byWork] of grouped) {
    sorted.set(
      goalKey,
      new Map([...byWork].map(([workId, byRun]) => [workId, sortAttempts([...byRun.values()])])),
    )
  }
  const running = sortAttempts(
    [...sorted.values()].flatMap((byWork) =>
      [...byWork.values()].flatMap((workAttempts) =>
        workAttempts.filter((attempt) => attempt.status === 'running'),
      ),
    ),
  )
  return {
    running() {
      return running
    },
    list(projectId, goalId, workId) {
      return sorted.get(`${projectId}\u0000${goalId}`)?.get(workId) ?? []
    },
    listGoal(projectId, goalId) {
      return new Map(sorted.get(`${projectId}\u0000${goalId}`) ?? [])
    },
  }
}

async function scanAttemptPaths(root: string, patterns: readonly string[]) {
  const paths = new Set<string>()
  try {
    for (const pattern of patterns) {
      for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
        paths.add(join(root, path))
      }
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
  return [...paths]
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(values[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

async function readLegacySnapshotSummary(attemptsRoot: string, root: string) {
  const segments = relative(attemptsRoot, root).split(sep)
  const fallback =
    segments.length === 4
      ? {
          projectId: segments[0],
          goalId: segments[1],
          workId: segments[2],
          runId: segments[3],
        }
      : segments.length === 1
        ? { runId: segments[0] }
        : {}
  return readLegacySummaryWithFallback(root, fallback)
}

async function readSummary(
  root: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const manifest = await readStoredManifest(join(root, 'attempt.json')).catch(() => null)
  if (manifest) {
    return manifest.projectId === projectId &&
      manifest.goalId === goalId &&
      manifest.workId === workId &&
      manifest.runId === runId
      ? manifest
      : null
  }
  return readLegacySummary(root, projectId, goalId, workId, runId)
}

async function readLegacySummary(
  root: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
): Promise<RunAttemptSummary | null> {
  const attempt = await readLegacySummaryWithFallback(root, {
    projectId,
    goalId,
    workId,
    runId,
  })
  return attempt?.projectId === projectId &&
    attempt.goalId === goalId &&
    attempt.workId === workId &&
    attempt.runId === runId
    ? attempt
    : null
}

async function readLegacySummaryWithFallback(
  root: string,
  fallback: Partial<Pick<RunAttemptSummary, 'projectId' | 'goalId' | 'workId' | 'runId'>>,
): Promise<RunAttemptSummary | null> {
  const contextFile = Bun.file(join(root, 'context.md'))
  if (!(await contextFile.exists())) return null
  const context = await contextFile.text()
  const identity = {
    projectId: context.match(/^- Project: (.+)$/m)?.[1] ?? fallback.projectId,
    goalId: context.match(/^- Goal: (.+)$/m)?.[1] ?? fallback.goalId,
    workId: context.match(/^- Work: (.+)$/m)?.[1] ?? fallback.workId,
    runId: context.match(/^- Run: (.+)$/m)?.[1] ?? fallback.runId,
  }
  const parsedIdentity = attemptIdentitySchema.safeParse(identity)
  if (!parsedIdentity.success) return null
  const responsibility = z
    .enum(RESPONSIBILITIES)
    .safeParse(context.match(/^- Responsibility: (.+)$/m)?.[1]).data
  if (!responsibility) return null
  const contextStats = await stat(join(root, 'context.md'))
  const resultPath = join(root, 'result.json')
  const resultFile = Bun.file(resultPath)
  const source = (await resultFile.exists()) ? await resultFile.text() : ''
  const parsed = parseLegacyResult(source)
  const resultStats = source.trim() ? await stat(resultPath).catch(() => null) : null
  return {
    version: 1,
    ...parsedIdentity.data,
    responsibility,
    execution: null,
    startedAt: contextStats.mtime.toISOString(),
    endedAt: resultStats?.mtime.toISOString() ?? contextStats.mtime.toISOString(),
    status: source.trim() ? 'finished' : 'interrupted',
    result: parsed?.result ?? null,
    summary:
      parsed?.summary ??
      (source.trim() ? 'Invalid legacy result.json.' : 'Attempt ended without a recorded outcome.'),
    exitCode: null,
    application: null,
  }
}

function parseLegacyResult(
  source: string,
): { result: StoredPassResultKind; summary: string } | null {
  if (!source.trim()) return null
  try {
    const parsed = legacyResultSchema.safeParse(JSON.parse(source))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

async function readStoredManifest(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return attemptManifestSchema.parse(await file.json())
}

async function readEvents(path: string) {
  return readDurableJsonLines(path, (value) => storedEventSchema.parse(value))
}

async function readOptionalText(path: string) {
  const file = Bun.file(path)
  return (await file.exists()) ? await file.text() : null
}

async function writeManifest(path: string, manifest: RunAttemptSummary) {
  const validated = attemptManifestSchema.parse(manifest)
  await mkdir(resolve(path, '..'), { recursive: true })
  const temporaryPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`)
  await rename(temporaryPath, path)
}

function storeEvent(event: AgentRuntimeEvent, createdAt: Date): StoredRunAttemptEvent {
  return storedEventSchema.parse({
    eventId: `AE-${crypto.randomUUID()}`,
    createdAt: createdAt.toISOString(),
    ...event,
  })
}

async function locateRunRoot(
  homeRoot: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const candidates = [
    runStoragePath(homeRoot, runId),
    legacyRunStoragePath(homeRoot, projectId, goalId, workId, runId),
  ]
  for (const candidate of candidates) {
    if (await readSummary(candidate, projectId, goalId, workId, runId)) return candidate
  }
  return null
}

function assertIds(projectId: string, goalId: string, workId: string, runId?: string) {
  for (const [label, value] of [
    ['projectId', projectId],
    ['goalId', goalId],
    ['workId', workId],
    ...(runId ? ([['runId', runId]] as const) : []),
  ] as const) {
    if (!stableIdSchema.safeParse(value).success) throw new Error(`Invalid ${label}: ${value}`)
  }
}

function assertScopeIds(projectId: string, goalId: string) {
  for (const [label, value] of [
    ['projectId', projectId],
    ['goalId', goalId],
  ] as const) {
    if (!stableIdSchema.safeParse(value).success) throw new Error(`Invalid ${label}: ${value}`)
  }
}

function sortAttempts(attempts: RunAttemptSummary[]) {
  return attempts.sort(
    (left, right) =>
      right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId),
  )
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
