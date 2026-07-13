import { appendFile, mkdir, readdir, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  type RoleRunResult,
  STORED_PASS_RESULTS,
  type StoredPassResultKind,
} from '../agent/RoleRunner'
import {
  AGENT_TRANSCRIPT_ENTRY_KINDS,
  AGENT_TRANSCRIPT_TRANSPORTS,
  type AgentRuntimeEvent,
} from '../agent/runtimeEvents'
import type { GoalPackage } from '../domain/goalPackage'
import { RESPONSIBILITIES, type Responsibility } from './roleContextStager'

export const RUN_ATTEMPT_STATUSES = ['running', 'finished', 'interrupted'] as const
export type RunAttemptStatus = (typeof RUN_ATTEMPT_STATUSES)[number]

const stableIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const nullableResultSchema = z.enum(STORED_PASS_RESULTS).nullable()
const attemptManifestSchema = z
  .object({
    version: z.literal(1),
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema,
    runId: stableIdSchema,
    responsibility: z.enum(RESPONSIBILITIES),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(RUN_ATTEMPT_STATUSES),
    result: nullableResultSchema,
    summary: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    application: z.string().nullable(),
  })
  .strict()

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

const storedEventSchema = z.discriminatedUnion('kind', [
  storedMessageEventSchema,
  storedTranscriptEventSchema,
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
  finish(input: FinishRunAttemptInput): Promise<void>
  interrupt(error: unknown): Promise<void>
}

export interface RunAttemptStore {
  start(input: StartRunAttemptInput): Promise<RunAttemptRecorder>
  list(projectId: string, goalId: string, workId: string): Promise<RunAttemptSummary[]>
  countConsecutiveOperationalFailures(
    projectId: string,
    goalId: string,
    workId: string,
    after?: string | null,
  ): Promise<number>
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
  interruptRunningAttempts(): Promise<number>
}

export function operationalFailureResetAt(
  goalPackage: GoalPackage,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const target = `project:${projectId}/goal:${goalId}/work:${workId}`
  return (
    [...goalPackage.attentions.values()]
      .filter(
        (attention) =>
          attention.attributes.id.startsWith(`operational-attempts-${workId}-`) &&
          attention.attributes.target === target &&
          attention.attributes.resolvedAt !== null,
      )
      .map((attention) => attention.attributes.resolvedAt as string)
      .sort()
      .at(-1) ?? null
  )
}

export function createRunAttemptStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): RunAttemptStore {
  const attemptsRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'runs')
  const now = options.now ?? (() => new Date())

  return {
    async start(input) {
      assertIds(input.projectId, input.goalId, input.workId, input.runId)
      const expectedRoot = runRoot(
        attemptsRoot,
        input.projectId,
        input.goalId,
        input.workId,
        input.runId,
      )
      if (resolve(input.runRoot) !== expectedRoot) {
        throw new Error(`Run root does not match Attempt identity: ${input.runRoot}`)
      }

      const manifest: RunAttemptSummary = {
        version: 1,
        projectId: input.projectId,
        goalId: input.goalId,
        workId: input.workId,
        runId: input.runId,
        responsibility: input.responsibility,
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

    async list(projectId, goalId, workId) {
      assertIds(projectId, goalId, workId)
      const root = join(attemptsRoot, projectId, goalId, workId)
      const entries = await readDirectories(root)
      const attempts = await Promise.all(
        entries.map((entry) => readSummary(join(root, entry), projectId, goalId, workId, entry)),
      )
      return attempts
        .filter((attempt): attempt is RunAttemptSummary => attempt !== null)
        .sort(
          (left, right) =>
            right.startedAt.localeCompare(left.startedAt) || right.runId.localeCompare(left.runId),
        )
    },

    async countConsecutiveOperationalFailures(projectId, goalId, workId, after = null) {
      const attempts = await this.list(projectId, goalId, workId)
      let count = 0
      for (const attempt of attempts) {
        if (after && attempt.startedAt <= after) break
        // Running and interrupted records do not have a classified outcome. In
        // particular, a Coordinator restart must not erase the durable failure streak.
        if (attempt.status !== 'finished') continue
        if (attempt.application !== 'operational_failure') break
        count += 1
      }
      return count
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
      const root = runRoot(attemptsRoot, projectId, goalId, workId, runId)
      const summary = await readSummary(root, projectId, goalId, workId, runId)
      if (!summary) return null
      return {
        ...summary,
        runPrompt: await readOptionalText(join(root, 'prompt.md')),
      }
    },

    async readEvents(projectId, goalId, workId, runId) {
      assertIds(projectId, goalId, workId, runId)
      const root = runRoot(attemptsRoot, projectId, goalId, workId, runId)
      const summary = await readSummary(root, projectId, goalId, workId, runId)
      if (!summary) return null
      return readEvents(join(root, 'events.jsonl'))
    },

    async interruptRunningAttempts() {
      await mkdir(attemptsRoot, { recursive: true })
      const glob = new Bun.Glob('*/*/*/*/attempt.json')
      let count = 0
      for await (const relativePath of glob.scan({ cwd: attemptsRoot, onlyFiles: true })) {
        const path = join(attemptsRoot, relativePath)
        const manifest = await readStoredManifest(path).catch(() => null)
        if (!manifest || manifest.status !== 'running') continue
        const endedAt = now().toISOString()
        const summary = 'Coordinator stopped before recording an Attempt outcome.'
        await appendFile(
          join(resolve(path, '..'), 'events.jsonl'),
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
        ).catch(() => undefined)
        await writeManifest(path, {
          ...manifest,
          endedAt,
          status: 'interrupted',
          summary,
        })
        count += 1
      }
      return count
    },
  }
}

async function readSummary(
  root: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const manifest = await readStoredManifest(join(root, 'attempt.json')).catch(() => null)
  if (manifest) return manifest
  return readLegacySummary(root, projectId, goalId, workId, runId)
}

async function readLegacySummary(
  root: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
): Promise<RunAttemptSummary | null> {
  const contextFile = Bun.file(join(root, 'context.md'))
  if (!(await contextFile.exists())) return null
  const context = await contextFile.text()
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
    projectId,
    goalId,
    workId,
    runId,
    responsibility,
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
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const events: StoredRunAttemptEvent[] = []
  for (const line of (await file.text()).split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = storedEventSchema.safeParse(JSON.parse(line))
      if (parsed.success) events.push(parsed.data)
    } catch {
      // A partial final line after process interruption is not durable history.
    }
  }
  return events
}

async function readOptionalText(path: string) {
  const file = Bun.file(path)
  return (await file.exists()) ? await file.text() : null
}

async function readDirectories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    throw error
  }
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

function runRoot(
  attemptsRoot: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  return join(attemptsRoot, projectId, goalId, workId, runId)
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

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
