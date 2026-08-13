import { appendFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import {
  PASS_RESULTS,
  type PassResultKind,
  RUN_TERMINATIONS,
  type ResponsibilitySession,
  type RoleExecutionIdentity,
  type RunTermination,
} from '../agent/RoleRunner'
import {
  AGENT_TRANSCRIPT_ENTRY_KINDS,
  AGENT_TRANSCRIPT_TRANSPORTS,
  type AgentRuntimeEvent,
} from '../agent/runtimeEvents'
import { codingReasoningEffortSchema } from '../domain/projectCodingDefaults'
import { stableIdSchema } from '../domain/stableId'
import { writeJsonAtomically } from '../storage/atomicFile'
import {
  readDurableJsonLines,
  repairDurableJsonLineTail,
  reportInvalidRuntimeRecord,
} from '../storage/jsonLines'
import { RESPONSIBILITIES, type Responsibility } from './roleContextStager'
import { cleanupRunScratch, readRunArtifactManifest } from './runArtifacts'
import { type RunAttemptDiagnostics, readRunAttemptDiagnostics } from './runAttemptDiagnostics'
import { type RunChangeSet, createRunChangeSetStore } from './runChangeSet'
import {
  RUN_PROTOCOLS,
  RUN_WORKSPACE_MODES,
  type RunDirective,
  defaultLegacyRunDirective,
  runDirectiveSchema,
} from './runDirective'
import { runStoragePath, runStorageRoot } from './runPaths'

export const RUN_ATTEMPT_STATUSES = ['queued', 'running', 'finished', 'interrupted'] as const
export type RunAttemptStatus = (typeof RUN_ATTEMPT_STATUSES)[number]

const nullableResultSchema = z.enum(PASS_RESULTS).nullable()
const roleExecutionIdentitySchema = z
  .object({
    transport: z.enum(AGENT_TRANSCRIPT_TRANSPORTS),
    provider: z.enum(AGENT_TRANSCRIPT_TRANSPORTS).optional(),
    model: z.string().min(1).nullable(),
    reasoningEffort: codingReasoningEffortSchema.nullable(),
    permissionBoundary: z.enum(['bounded', 'unrestricted']).optional(),
  })
  .strict()
  .transform((execution) => ({
    ...execution,
    provider: execution.provider ?? execution.transport,
    permissionBoundary: execution.permissionBoundary ?? ('bounded' as const),
  }))
const sessionEpochSchema = z
  .object({
    epoch: z.number().int().positive(),
    transport: z.enum(['codex', 'claude', 'opencode']),
    sessionId: z.string().trim().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable().default(null),
    closeReason: z.string().trim().min(1).nullable().default(null),
    handoffMarkdown: z.string().trim().min(1).nullable().default(null),
  })
  .strict()
const attemptManifestSchema = z
  .object({
    projectId: stableIdSchema,
    goalId: stableIdSchema,
    workId: stableIdSchema,
    runId: stableIdSchema,
    responsibility: z.enum(RESPONSIBILITIES),
    protocol: z.enum(RUN_PROTOCOLS).optional(),
    profile: z.enum(RESPONSIBILITIES).optional(),
    workspaceMode: z.enum(RUN_WORKSPACE_MODES).optional(),
    instructionMarkdown: z.string().trim().min(1).max(64_000).optional(),
    inputRefs: z.array(z.string().trim().min(1).max(1_000)).max(128).optional(),
    baseChangeSetId: stableIdSchema.nullable().optional(),
    workHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    requestedExecution: roleExecutionIdentitySchema.nullable().default(null),
    execution: roleExecutionIdentitySchema.nullable(),
    sessionEpochs: z.array(sessionEpochSchema).default([]),
    requestedAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(RUN_ATTEMPT_STATUSES),
    termination: z.enum(RUN_TERMINATIONS).nullable().default(null),
    result: nullableResultSchema,
    summary: z.string().nullable(),
    reportMarkdown: z.string().nullable().default(null),
    exitCode: z.number().int().nullable(),
    application: z.string().nullable(),
    changeSetId: stableIdSchema.nullable().default(null),
  })
  .strict()
  .transform((attempt) => {
    const legacy = defaultLegacyRunDirective(attempt.responsibility)
    return {
      ...attempt,
      protocol: attempt.protocol ?? legacy.protocol,
      profile: attempt.profile ?? attempt.responsibility,
      workspaceMode: attempt.workspaceMode ?? legacy.workspaceMode,
      instructionMarkdown: attempt.instructionMarkdown ?? legacy.instructionMarkdown,
      inputRefs: attempt.inputRefs ?? [],
      baseChangeSetId: attempt.baseChangeSetId ?? null,
    }
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
export type RunAttemptSummary = z.infer<typeof attemptManifestSchema>
export type StoredRunAttemptEvent = z.infer<typeof storedEventSchema>
export interface RunAttemptDetail extends RunAttemptMetadata {
  events: StoredRunAttemptEvent[]
}

export interface RunAttemptMetadata extends RunAttemptSummary {
  runPrompt: string | null
  changeSet: RunChangeSet | null
  artifacts: {
    preserved: Array<{
      reference: string
      kind: 'file' | 'directory'
      sizeBytes: number
    }>
    unavailable: Array<{ reference: string; reason: string }>
  }
}

export interface StartRunAttemptInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  runRoot: string
  workHash?: string | null
}

export interface ReserveRunAttemptInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  workHash: string
  allowSuccessor?: boolean
  directive?: RunDirective
}

export interface FinishRunAttemptInput {
  outcome: {
    result: PassResultKind | null
    summary: string
    exitCode: number | null
    termination?: RunTermination
    reportMarkdown?: string
  }
  application: string
  workHash?: string | null
}

export interface RunAttemptRecorder {
  record(event: AgentRuntimeEvent): Promise<void>
  setExecution(execution: RoleExecutionIdentity): Promise<void>
  recordSession(session: ResponsibilitySession): Promise<void>
  rotateSession(input: { reason: string; handoffMarkdown: string }): Promise<void>
  setChangeSet(changeSetId: string): Promise<void>
  finish(input: FinishRunAttemptInput): Promise<void>
  interrupt(error: unknown): Promise<void>
}

export interface RunAttemptSnapshot {
  running(): readonly RunAttemptSummary[]
  queued(): readonly RunAttemptSummary[]
  list(projectId: string, goalId: string, workId: string): readonly RunAttemptSummary[]
  listGoal(projectId: string, goalId: string): ReadonlyMap<string, readonly RunAttemptSummary[]>
}

export interface RunAttemptStore {
  reserve(input: ReserveRunAttemptInput): Promise<{
    runId: string
    disposition: 'scheduled' | 'already_scheduled' | 'already_active'
  }>
  start(input: StartRunAttemptInput): Promise<RunAttemptRecorder>
  interruptQueued(input?: {
    projectId?: string
    goalId?: string
    workId?: string
    reason?: string
  }): Promise<number>
  generation(): number
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

export function deriveRunSchedulingFacts(attempts: readonly RunAttemptSummary[]) {
  return {
    requestedRunProfiles: new Map(
      attempts
        .filter((attempt) => attempt.status === 'queued')
        .map((attempt) => [attempt.workId, attempt.profile] as const),
    ),
    supervisorManagedWorkIds: new Set(
      attempts.filter((attempt) => attempt.protocol === 'report').map((attempt) => attempt.workId),
    ),
  }
}

interface SharedAttemptIndex {
  generation: number
  tail: Promise<void>
}

const sharedAttemptIndexes = new Map<string, SharedAttemptIndex>()

function sharedAttemptIndex(attemptsRoot: string) {
  const root = resolve(attemptsRoot)
  const existing = sharedAttemptIndexes.get(root)
  if (existing) return existing
  const created: SharedAttemptIndex = {
    generation: 0,
    tail: Promise.resolve(),
  }
  sharedAttemptIndexes.set(root, created)
  return created
}

export function createRunAttemptStore(
  homeRoot: string,
  options: { now?: () => Date } = {},
): RunAttemptStore {
  const attemptsRoot = runStorageRoot(homeRoot)
  const now = options.now ?? (() => new Date())
  const finishedDiagnostics = new Map<string, RunAttemptDiagnostics>()
  const changeSets = createRunChangeSetStore(homeRoot)
  const index = sharedAttemptIndex(attemptsRoot)
  const generationBase = index.generation

  const withIndexLock = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = index.tail.then(operation, operation)
    index.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const readIndexedSnapshot = () =>
    withIndexLock(async () => {
      return createAttemptSnapshot(await readAllAttemptSummaries(attemptsRoot))
    })

  const recordIndexedAttempt = (_attempt: RunAttemptSummary) =>
    withIndexLock(async () => {
      index.generation += 1
    })

  return {
    async reserve(input) {
      assertIds(input.projectId, input.goalId, input.workId, input.runId)
      return withIndexLock(async () => {
        const attempts = sortAttempts(
          (await readAllAttemptSummaries(attemptsRoot)).filter(
            (attempt) =>
              attempt.projectId === input.projectId &&
              attempt.goalId === input.goalId &&
              attempt.workId === input.workId,
          ),
        )
        const active = attempts.find(
          (attempt) =>
            attempt.responsibility === input.responsibility &&
            (attempt.status === 'queued' || attempt.status === 'running'),
        )
        if (active?.status === 'running' && !input.allowSuccessor) {
          return { runId: active.runId, disposition: 'already_active' as const }
        }
        const directive = input.directive
          ? runDirectiveSchema.parse(input.directive)
          : defaultLegacyRunDirective(input.responsibility)
        if (
          active?.status === 'queued' &&
          active.workHash === input.workHash &&
          sameRunDirective(active, directive)
        ) {
          return { runId: active.runId, disposition: 'already_scheduled' as const }
        }
        for (const stale of attempts.filter((attempt) => attempt.status === 'queued')) {
          await interruptQueuedManifest(
            homeRoot,
            stale,
            'Queued Attempt was superseded by a newer continuation.',
            now(),
          )
        }

        const requestedAt = now()
        const manifest: RunAttemptSummary = {
          projectId: input.projectId,
          goalId: input.goalId,
          workId: input.workId,
          runId: input.runId,
          responsibility: input.responsibility,
          protocol: directive.protocol,
          profile: directive.profile,
          workspaceMode: directive.workspaceMode,
          instructionMarkdown: directive.instructionMarkdown,
          inputRefs: directive.refs,
          baseChangeSetId: directive.baseChangeSetId,
          workHash: input.workHash ?? null,
          requestedExecution: null,
          execution: null,
          sessionEpochs: [],
          requestedAt: requestedAt.toISOString(),
          startedAt: null,
          endedAt: null,
          status: 'queued',
          termination: null,
          result: null,
          summary: null,
          reportMarkdown: null,
          exitCode: null,
          application: null,
          changeSetId: null,
        }
        const root = runStoragePath(homeRoot, input.runId)
        await mkdir(root, { recursive: true })
        await writeManifest(join(root, 'attempt.json'), manifest)
        await Bun.write(
          join(root, 'events.jsonl'),
          `${JSON.stringify(
            storeEvent(
              {
                kind: 'message',
                level: 'info',
                role: 'coordinator',
                content: `${input.responsibility} Attempt queued.`,
              },
              requestedAt,
            ),
          )}\n`,
        )
        index.generation += 1
        return { runId: input.runId, disposition: 'scheduled' as const }
      })
    },

    async start(input) {
      assertIds(input.projectId, input.goalId, input.workId, input.runId)
      const expectedRoot = runStoragePath(homeRoot, input.runId)
      if (resolve(input.runRoot) !== expectedRoot) {
        throw new Error(`Run root does not match Attempt identity: ${input.runRoot}`)
      }

      const manifestPath = join(expectedRoot, 'attempt.json')
      const eventsPath = join(expectedRoot, 'events.jsonl')
      let manifest = await withIndexLock(async () => {
        const existing = await readStoredManifest(manifestPath)
        if (
          existing &&
          (existing.projectId !== input.projectId ||
            existing.goalId !== input.goalId ||
            existing.workId !== input.workId ||
            existing.runId !== input.runId ||
            existing.responsibility !== input.responsibility ||
            existing.status !== 'queued')
        ) {
          throw new Error(`Attempt cannot start from ${existing.status}: ${input.runId}`)
        }
        const startedAt = now()
        const defaultDirective = defaultLegacyRunDirective(input.responsibility)
        const claimed: RunAttemptSummary = existing
          ? {
              ...existing,
              workHash: input.workHash ?? existing.workHash,
              startedAt: startedAt.toISOString(),
              status: 'running',
            }
          : {
              projectId: input.projectId,
              goalId: input.goalId,
              workId: input.workId,
              runId: input.runId,
              responsibility: input.responsibility,
              protocol: defaultDirective.protocol,
              profile: defaultDirective.profile,
              workspaceMode: defaultDirective.workspaceMode,
              instructionMarkdown: defaultDirective.instructionMarkdown,
              inputRefs: defaultDirective.refs,
              baseChangeSetId: defaultDirective.baseChangeSetId,
              workHash: input.workHash ?? null,
              requestedExecution: null,
              execution: null,
              sessionEpochs: [],
              requestedAt: startedAt.toISOString(),
              startedAt: startedAt.toISOString(),
              endedAt: null,
              status: 'running',
              termination: null,
              result: null,
              summary: null,
              reportMarkdown: null,
              exitCode: null,
              application: null,
              changeSetId: null,
            }
        await mkdir(expectedRoot, { recursive: true })
        await writeManifest(manifestPath, claimed)
        if (!existing) await Bun.write(eventsPath, '')
        index.generation += 1
        return claimed
      })

      let closed = false
      let writeTail: Promise<void> = Promise.resolve()
      const enqueue = (event: AgentRuntimeEvent) => {
        if (closed) return writeTail
        const stored = storeEvent(event, now())
        const write = writeTail
          .catch(() => undefined)
          .then(() => appendFile(eventsPath, `${JSON.stringify(stored)}\n`))
        writeTail = write
        return write
      }
      const close = async (next: RunAttemptSummary, event: AgentRuntimeEvent) => {
        if (closed) return
        const finalEventWrite = enqueue(event)
        closed = true
        await finalEventWrite
        await writeTail
        await writeManifest(manifestPath, next)
        manifest = next
        await recordIndexedAttempt(next)
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
          manifest = {
            ...manifest,
            requestedExecution: manifest.requestedExecution ?? execution,
            execution,
          }
          await writeManifest(manifestPath, manifest)
          await recordIndexedAttempt(manifest)
        },
        async recordSession(session) {
          if (closed) return
          const current = manifest.sessionEpochs.at(-1)
          if (
            current?.endedAt === null &&
            current.transport === session.transport &&
            current.sessionId === session.sessionId
          ) {
            return
          }
          const observedAt = now().toISOString()
          const priorEpochs = closeOpenSessionEpoch(
            manifest.sessionEpochs,
            observedAt,
            'provider_rotated',
            '# Session Epoch handoff\n\nThe provider reported a replacement Session identity in the same Run.',
          )
          manifest = {
            ...manifest,
            sessionEpochs: [
              ...priorEpochs,
              {
                epoch: priorEpochs.length + 1,
                transport: session.transport,
                sessionId: session.sessionId,
                startedAt: observedAt,
                endedAt: null,
                closeReason: null,
                handoffMarkdown: null,
              },
            ],
          }
          await writeManifest(manifestPath, manifest)
          await recordIndexedAttempt(manifest)
        },
        async rotateSession(rotation) {
          if (closed) return
          const observedAt = now().toISOString()
          const nextEpochs = closeOpenSessionEpoch(
            manifest.sessionEpochs,
            observedAt,
            rotation.reason.trim(),
            normalizeEpochHandoff(rotation.handoffMarkdown),
          )
          if (nextEpochs === manifest.sessionEpochs) return
          manifest = { ...manifest, sessionEpochs: nextEpochs }
          await writeManifest(manifestPath, manifest)
          await recordIndexedAttempt(manifest)
        },
        async setChangeSet(changeSetId) {
          if (closed) return
          const validated = stableIdSchema.parse(changeSetId)
          if (manifest.changeSetId && manifest.changeSetId !== validated) {
            throw new Error(`Attempt already references another ChangeSet: ${manifest.changeSetId}`)
          }
          if (manifest.changeSetId === validated) return
          manifest = { ...manifest, changeSetId: validated }
          await writeManifest(manifestPath, manifest)
          await recordIndexedAttempt(manifest)
        },
        async finish({ outcome, application, workHash }) {
          const endedAt = now().toISOString()
          const termination = outcome.termination ?? defaultTermination(application)
          await close(
            {
              ...manifest,
              endedAt,
              status: 'finished',
              termination,
              result: outcome.result,
              summary: outcome.summary,
              reportMarkdown: normalizeReport(outcome.reportMarkdown, outcome.summary),
              exitCode: outcome.exitCode,
              application,
              workHash: workHash ?? manifest.workHash,
              sessionEpochs: closeOpenSessionEpoch(
                manifest.sessionEpochs,
                endedAt,
                termination,
                null,
              ),
            },
            {
              kind: 'message',
              level: outcome.result === 'fail' ? 'error' : 'info',
              role: 'coordinator',
              content: `${input.responsibility} Attempt finished${outcome.result ? ` with ${outcome.result}` : ''}: ${outcome.summary}`,
            },
          )
        },
        async interrupt(error) {
          const summary = errorMessage(error)
          const endedAt = now().toISOString()
          await close(
            {
              ...manifest,
              endedAt,
              status: 'interrupted',
              termination: 'interrupted',
              summary,
              reportMarkdown: normalizeReport(null, summary),
              sessionEpochs: closeOpenSessionEpoch(
                manifest.sessionEpochs,
                endedAt,
                'interrupted',
                null,
              ),
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

    async interruptQueued(input = {}) {
      return withIndexLock(async () => {
        const queued = (await readAllAttemptSummaries(attemptsRoot)).filter(
          (attempt) =>
            attempt.status === 'queued' &&
            (!input.projectId || attempt.projectId === input.projectId) &&
            (!input.goalId || attempt.goalId === input.goalId) &&
            (!input.workId || attempt.workId === input.workId),
        )
        for (const attempt of queued) {
          await interruptQueuedManifest(
            homeRoot,
            attempt,
            input.reason ?? 'Queued Attempt was interrupted before dispatch.',
            now(),
          )
        }
        if (queued.length > 0) index.generation += 1
        return queued.length
      })
    },

    generation() {
      return index.generation - generationBase
    },

    async snapshot() {
      return readIndexedSnapshot()
    },

    async list(projectId, goalId, workId) {
      assertIds(projectId, goalId, workId)
      const snapshot = await readIndexedSnapshot()
      return [...snapshot.list(projectId, goalId, workId)]
    },

    async listGoal(projectId, goalId) {
      assertScopeIds(projectId, goalId)
      const snapshot = await readIndexedSnapshot()
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
      const artifactManifest = await readRunArtifactManifest(root)
      return {
        ...summary,
        runPrompt: await readOptionalText(join(root, 'prompt.md')),
        changeSet: await changeSets.read(runId),
        artifacts: {
          preserved:
            artifactManifest?.artifacts.map(({ reference, kind, sizeBytes }) => ({
              reference,
              kind,
              sizeBytes,
            })) ?? [],
          unavailable: artifactManifest?.unavailable ?? [],
        },
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

    interruptRunningAttempts() {
      return withIndexLock(async () => {
        await mkdir(attemptsRoot, { recursive: true })
        let count = 0
        const manifestPaths = new Set<string>()
        for await (const relativePath of new Bun.Glob(ATTEMPT_MANIFEST_PATTERN).scan({
          cwd: attemptsRoot,
          onlyFiles: true,
        })) {
          manifestPaths.add(join(attemptsRoot, relativePath))
        }
        for (const path of manifestPaths) {
          const manifest = await readStoredManifest(path)
          if (!manifest || manifest.status !== 'running') continue
          const endedAt = now().toISOString()
          const summary = 'Coordinator stopped before recording an Attempt outcome.'
          const eventsPath = join(resolve(path, '..'), 'events.jsonl')
          await repairDurableJsonLineTail(eventsPath)
          await appendFile(
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
          )
          await writeManifest(path, {
            ...manifest,
            endedAt,
            status: 'interrupted',
            termination: 'interrupted',
            summary,
            reportMarkdown: normalizeReport(null, summary),
            sessionEpochs: closeOpenSessionEpoch(
              manifest.sessionEpochs,
              endedAt,
              'interrupted',
              null,
            ),
          })
          await cleanupRunScratch(join(resolve(path, '..'), 'scratch')).catch(() => undefined)
          count += 1
        }
        if (count > 0) {
          index.generation += 1
        }
        return count
      })
    },
  }
}

const RUN_MANIFEST_READ_CONCURRENCY = 32
const ATTEMPT_MANIFEST_PATTERN = '*/attempt.json'

async function readAllAttemptSummaries(attemptsRoot: string) {
  const manifestPaths = await scanAttemptPaths(attemptsRoot, ATTEMPT_MANIFEST_PATTERN)
  const parsedManifests = await mapWithConcurrency(
    manifestPaths,
    RUN_MANIFEST_READ_CONCURRENCY,
    (path) => readStoredManifest(path),
  )
  return parsedManifests.filter((attempt): attempt is RunAttemptSummary => attempt !== null)
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
  const queued = sortAttempts(
    [...sorted.values()].flatMap((byWork) =>
      [...byWork.values()].flatMap((workAttempts) =>
        workAttempts.filter((attempt) => attempt.status === 'queued'),
      ),
    ),
  )
  return {
    running() {
      return running
    },
    queued() {
      return queued
    },
    list(projectId, goalId, workId) {
      return sorted.get(`${projectId}\u0000${goalId}`)?.get(workId) ?? []
    },
    listGoal(projectId, goalId) {
      return new Map(sorted.get(`${projectId}\u0000${goalId}`) ?? [])
    },
  }
}

async function scanAttemptPaths(root: string, pattern: string) {
  const paths = new Set<string>()
  try {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
      paths.add(join(root, path))
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

async function readSummary(
  root: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  const manifest = await readStoredManifest(join(root, 'attempt.json'))
  return manifest?.projectId === projectId &&
    manifest.goalId === goalId &&
    manifest.workId === workId &&
    manifest.runId === runId
    ? manifest
    : null
}

async function readStoredManifest(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    return attemptManifestSchema.parse(await file.json())
  } catch (error) {
    reportInvalidRuntimeRecord(path, error)
    return null
  }
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
  await writeJsonAtomically(path, validated)
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
  const root = runStoragePath(homeRoot, runId)
  return (await readSummary(root, projectId, goalId, workId, runId)) ? root : null
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
      right.requestedAt.localeCompare(left.requestedAt) || right.runId.localeCompare(left.runId),
  )
}

async function interruptQueuedManifest(
  homeRoot: string,
  attempt: RunAttemptSummary,
  summary: string,
  endedAt: Date,
) {
  const root = runStoragePath(homeRoot, attempt.runId)
  const eventsPath = join(root, 'events.jsonl')
  await repairDurableJsonLineTail(eventsPath)
  await appendFile(
    eventsPath,
    `${JSON.stringify(
      storeEvent(
        {
          kind: 'message',
          level: 'error',
          role: 'coordinator',
          content: summary,
        },
        endedAt,
      ),
    )}\n`,
  )
  await writeManifest(join(root, 'attempt.json'), {
    ...attempt,
    endedAt: endedAt.toISOString(),
    status: 'interrupted',
    termination: 'cancelled',
    summary,
    reportMarkdown: normalizeReport(null, summary),
  })
}

function defaultTermination(application: string): RunTermination {
  return application === 'operational_failure' ? 'crashed' : 'normal'
}

function sameRunDirective(attempt: RunAttemptSummary, directive: RunDirective) {
  return (
    attempt.protocol === directive.protocol &&
    attempt.profile === directive.profile &&
    attempt.workspaceMode === directive.workspaceMode &&
    attempt.instructionMarkdown === directive.instructionMarkdown &&
    JSON.stringify(attempt.inputRefs) === JSON.stringify(directive.refs) &&
    attempt.baseChangeSetId === directive.baseChangeSetId
  )
}

function normalizeReport(report: string | null | undefined, summary: string) {
  const source = report?.trim()
  return source ? `${source}\n` : `# Run Report\n\n${summary.trim()}\n`
}

function closeOpenSessionEpoch(
  epochs: RunAttemptSummary['sessionEpochs'],
  endedAt: string,
  closeReason: string,
  handoffMarkdown: string | null,
) {
  const last = epochs.at(-1)
  if (!last || last.endedAt !== null) return epochs
  return [
    ...epochs.slice(0, -1),
    {
      ...last,
      endedAt,
      closeReason,
      handoffMarkdown,
    },
  ]
}

function normalizeEpochHandoff(value: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error('Session Epoch handoff cannot be empty')
  return normalized.length <= 16_000
    ? normalized
    : `${normalized.slice(0, 16_000)}\n\n[handoff truncated]`
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
