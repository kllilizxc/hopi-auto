import { appendFile, mkdir, readdir, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import {
  type InboxEventDocument,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import { workspaceAttentionReference } from '../domain/attentionReference'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import {
  assistantConversationScopeForEvent,
  assistantConversationScopeKey,
} from './assistantConversationScope'
import { needsYouAttentionIds } from './assistantNeedsYou'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'

export type ReflectionObserveResult = 'baseline' | 'deferred' | 'unchanged' | 'running' | 'started'

export interface ReflectionObservation {
  settled: boolean
}

const wakeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) }).strict(),
])

type WakeScope = z.infer<typeof wakeScopeSchema>

const wakeCursorSchema = z
  .object({
    version: z.literal(1),
    scope: wakeScopeSchema,
    stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    eventId: z.string().min(1).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

const reflectionManifestSchema = z
  .object({
    version: z.literal(1),
    reflectionId: z.string().min(1),
    stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    scope: wakeScopeSchema.optional(),
    status: z.enum(['running', 'completed', 'interrupted', 'failed']),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    error: z.string().nullable(),
    handoffEventId: z.string().min(1).nullable(),
  })
  .strict()

export type ReflectionManifest = z.infer<typeof reflectionManifestSchema>
export type ReflectionRuntimeEvent = AgentRuntimeEvent & { eventId: string; createdAt: string }

export interface ReflectionRunSummary {
  manifest: ReflectionManifest
  paths: { prompt: string; transcript: string; events: string }
}

export interface ReflectionRunDetail extends ReflectionRunSummary {
  events: ReflectionRuntimeEvent[]
}

/**
 * Compatibility name for the old debug API. This is a deterministic wake recorder; it never runs
 * another model or owns a second Assistant context.
 */
export interface AssistantReflection {
  observe(input: ReflectionObservation): Promise<ReflectionObserveResult>
  acknowledgeProjects(projectIds: readonly string[]): Promise<void>
  isActive(): boolean
  listRuns(limit?: number): Promise<ReflectionRunDetail[]>
  listRunSummaries(): Promise<ReflectionRunSummary[]>
  readRunEvents(reflectionId: string): Promise<ReflectionRuntimeEvent[] | null>
  waitForIdle(): Promise<void>
  stop(): Promise<void>
}

export function createAssistantWake(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  state: AssistantStateReader
  now?: () => Date
  onWake?(): void
}): AssistantReflection {
  const now = options.now ?? (() => new Date())
  const root = join(resolve(options.homeRoot), '.hopi', 'runtime', 'assistant', 'wakes')
  const cursorsRoot = join(root, 'cursors')
  const runsRoot = join(root, 'runs')
  let active: Promise<void> | null = null
  let stopped = false
  let lastScopeKey: string | null = null

  return {
    async observe(input) {
      if (stopped) return 'unchanged'
      if (active) return 'running'

      const snapshot = await (options.state.readForReflection?.() ?? options.state.read())
      const scopes = wakeScopeSnapshots(snapshot)
      const workspace = await options.workspace.readWorkspaceForControl()
      const allPendingScopeKeys = new Set(
        [...workspace.events.values()]
          .filter((event) => event.attributes.status === 'pending')
          .map((event) => assistantConversationScopeKey(assistantConversationScopeForEvent(event))),
      )
      const pendingScopeKeys = new Set(
        [...workspace.events.values()]
          .filter(
            (event) =>
              event.attributes.status === 'pending' &&
              (event.attributes.source === 'system' || event.attributes.source === 'reflection'),
          )
          .map((event) =>
            event.attributes.context?.projectId
              ? `project:${event.attributes.context.projectId}`
              : 'home',
          ),
      )
      const continuations = attentionContinuationCandidates(workspace, scopes).filter(
        (candidate) =>
          input.settled &&
          !allPendingScopeKeys.has(candidate.scopeKey) &&
          candidate.snapshot.activeRuns.length === 0,
      )
      if (continuations.length > 0) {
        const selected = selectWakeScope(continuations, lastScopeKey)
        lastScopeKey = selected.scopeKey
        const operation = publishWake(selected.scope, selected.scopeKey, selected.snapshot, {
          sourceEventId: selected.sourceEventId,
          attentionIds: selected.attentionIds,
          attentionRefs: selected.attentionRefs,
        }).finally(() => {
          active = null
          options.onWake?.()
        })
        active = operation
        void operation
        return 'started'
      }
      const eligible: Array<{
        scope: WakeScope
        scopeKey: string
        snapshot: AssistantStateSnapshot
      }> = []
      let establishedBaseline = false
      let deferred = false

      for (const candidate of scopes) {
        const cursor = await readCursor(cursorPath(cursorsRoot, candidate.scopeKey))
        const immediate = hasImmediateWakeSignal(candidate.snapshot)
        if (!cursor) {
          if (!immediate) {
            await writeCursor(cursorPath(cursorsRoot, candidate.scopeKey), {
              version: 1,
              scope: candidate.scope,
              stateDigest: candidate.snapshot.stateDigest,
              eventId: null,
              updatedAt: now().toISOString(),
            })
            establishedBaseline = true
            continue
          }
        } else if (cursor.stateDigest === candidate.snapshot.stateDigest) {
          continue
        }
        if (pendingScopeKeys.has(candidate.scopeKey)) {
          deferred = true
          continue
        }
        if (!input.settled && !immediate) {
          deferred = true
          continue
        }
        eligible.push(candidate)
      }

      if (eligible.length === 0) {
        if (deferred) return 'deferred'
        return establishedBaseline ? 'baseline' : 'unchanged'
      }

      const selected = selectWakeScope(eligible, lastScopeKey)
      lastScopeKey = selected.scopeKey
      const operation = publishWake(selected.scope, selected.scopeKey, selected.snapshot).finally(
        () => {
          active = null
          options.onWake?.()
        },
      )
      active = operation
      void operation
      return 'started'
    },

    async acknowledgeProjects(projectIds) {
      if (stopped || projectIds.length === 0) return
      await active
      const snapshot = await (options.state.readForReflection?.() ?? options.state.read())
      const scopes = new Map(
        wakeScopeSnapshots(snapshot).map((candidate) => [candidate.scopeKey, candidate]),
      )
      for (const projectId of [...new Set(projectIds)].toSorted()) {
        const scopeKey = `project:${projectId}`
        const candidate = scopes.get(scopeKey)
        if (!candidate) continue
        const path = cursorPath(cursorsRoot, scopeKey)
        const cursor = await readCursor(path)
        await writeCursor(path, {
          version: 1,
          scope: candidate.scope,
          stateDigest: candidate.snapshot.stateDigest,
          eventId: cursor?.eventId ?? null,
          updatedAt: now().toISOString(),
        })
      }
    },

    isActive() {
      return active !== null
    },

    async listRuns(limit = 20) {
      const summaries = (await readWakeRunSummaries(runsRoot)).slice(
        0,
        Math.max(1, Math.min(limit, 100)),
      )
      return Promise.all(
        summaries.map(async (summary) => ({
          ...summary,
          events: await readWakeEvents(summary.paths.events),
        })),
      )
    },

    listRunSummaries() {
      return readWakeRunSummaries(runsRoot)
    },

    readRunEvents(reflectionId) {
      return readWakeRunEvents(runsRoot, reflectionId)
    },

    async waitForIdle() {
      await active
    },

    async stop() {
      stopped = true
      await active
    },
  }

  async function publishWake(
    scope: WakeScope,
    scopeKey: string,
    snapshot: AssistantStateSnapshot,
    continuation?: {
      sourceEventId: string
      attentionIds: string[]
      attentionRefs: string[]
    },
  ) {
    const digestKey = await sha256(
      continuation
        ? `${scopeKey}\u0000${continuation.sourceEventId}\u0000${continuation.attentionIds.join('\u0000')}`
        : `${scopeKey}\u0000${snapshot.stateDigest}`,
    )
    const eventId = `${continuation ? 'EV-attention' : 'EV-wake'}-${digestKey.slice(0, 24)}`
    const wakeId = `WK-${crypto.randomUUID()}`
    const runRoot = join(runsRoot, wakeId)
    const manifestPath = join(runRoot, 'reflection.json')
    const promptPath = join(runRoot, 'prompt.md')
    const transcriptPath = join(runRoot, 'transcript.log')
    const eventsPath = join(runRoot, 'events.jsonl')
    const startedAt = now()
    const baseManifest: ReflectionManifest = {
      version: 1,
      reflectionId: wakeId,
      stateDigest: snapshot.stateDigest,
      scope,
      status: 'running',
      startedAt: startedAt.toISOString(),
      endedAt: null,
      error: null,
      handoffEventId: null,
    }
    await mkdir(runRoot, { recursive: true })
    await writeJson(manifestPath, baseManifest)

    const body = continuation
      ? renderAttentionContinuation(scope, continuation.attentionRefs)
      : renderWakeEvent(scope, snapshot)
    await Bun.write(promptPath, body)
    await Bun.write(
      transcriptPath,
      continuation
        ? 'Unresolved Attention continued in the same Assistant conversation.\n'
        : 'Deterministic state change routed to the Project Assistant.\n',
    )
    await appendWakeEvent(eventsPath, {
      kind: 'message',
      level: 'info',
      role: 'coordinator',
      content: `Queued ${eventId} for ${scopeKey}.`,
    })

    try {
      const existing = await options.workspace.readEvent(eventId)
      if (!existing) {
        await options.workspace.receiveSystemEvent({
          eventId,
          content: body,
          ...(scope.kind === 'project' || continuation?.attentionRefs.length
            ? {
                context: {
                  ...(scope.kind === 'project' ? { projectId: scope.projectId } : {}),
                  ...(continuation?.attentionRefs.length
                    ? { attentionRefs: continuation.attentionRefs }
                    : {}),
                },
              }
            : {}),
          receivedAt: startedAt,
        })
      }
      await writeCursor(cursorPath(cursorsRoot, scopeKey), {
        version: 1,
        scope,
        stateDigest: snapshot.stateDigest,
        eventId,
        updatedAt: now().toISOString(),
      })
      await writeJson(manifestPath, {
        ...baseManifest,
        status: 'completed',
        endedAt: now().toISOString(),
        handoffEventId: eventId,
      })
    } catch (error) {
      const message = errorMessage(error)
      await appendWakeEvent(eventsPath, {
        kind: 'message',
        level: 'error',
        role: 'coordinator',
        content: message,
      })
      await writeJson(manifestPath, {
        ...baseManifest,
        status: 'failed',
        endedAt: now().toISOString(),
        error: message,
      })
      throw error
    }
  }
}

// Keep the old factory import working while runtime and debug clients migrate terminology.
export const createAssistantReflection = createAssistantWake

function wakeScopeSnapshots(snapshot: AssistantStateSnapshot) {
  const projects = new Map<string, unknown>()
  const homeProjects: unknown[] = []
  for (const project of snapshot.projects) {
    const projectId =
      isRecord(project) && typeof project.projectId === 'string' ? project.projectId : null
    if (projectId) projects.set(projectId, project)
    else homeProjects.push(project)
  }
  const projectIds = new Set(projects.keys())
  const attentionProjectId = (attention: unknown) => {
    if (!isRecord(attention)) return null
    const projectId = typeof attention.projectId === 'string' ? attention.projectId : null
    return projectId && projectIds.has(projectId) ? projectId : null
  }
  const delegatedRuns = (projectId: string | null) =>
    snapshot.delegations
      .filter((delegation) => delegation.sourceProjectId === projectId)
      .flatMap((delegation) => (delegation.activeRun ? [delegation.activeRun] : []))
  const scopedRuns = (projectId: string | null) => {
    const owned = snapshot.activeRuns.filter((run) =>
      projectId ? run.projectId === projectId : !projectIds.has(run.projectId),
    )
    return [
      ...new Map([...owned, ...delegatedRuns(projectId)].map((run) => [run.runId, run])).values(),
    ]
  }

  return [
    {
      scopeKey: 'home',
      scope: { kind: 'home' } as const,
      snapshot: {
        ...snapshot,
        stateDigest: snapshot.conversationDigests.home,
        activeRuns: scopedRuns(null),
        delegations: [],
        workspaceAttentions: snapshot.workspaceAttentions.filter(
          (attention) => attentionProjectId(attention) === null,
        ),
        projects: homeProjects,
      },
    },
    ...[...projects.entries()].map(([projectId, project]) => ({
      scopeKey: `project:${projectId}`,
      scope: { kind: 'project', projectId } as const,
      snapshot: {
        ...snapshot,
        stateDigest: requiredProjectDigest(snapshot, projectId),
        activeRuns: scopedRuns(projectId),
        delegations: snapshot.delegations.filter(
          (delegation) => delegation.sourceProjectId === projectId,
        ),
        workspaceAttentions: snapshot.workspaceAttentions.filter(
          (attention) => attentionProjectId(attention) === projectId,
        ),
        projects: [project],
      },
    })),
  ]
}

function attentionContinuationCandidates(
  workspace: AssistantWorkspace,
  scopes: ReturnType<typeof wakeScopeSnapshots>,
) {
  const scopeSnapshots = new Map(scopes.map((candidate) => [candidate.scopeKey, candidate]))
  const openByScope = new Map<string, Array<{ id: string; updatedAt: string; reference: string }>>()
  for (const attention of workspace.attentions.values()) {
    if (attention.attributes.resolvedAt !== null) continue
    const projectId = workspaceAttentionProjectId(attention)
    const scopeKey = projectId ? `project:${projectId}` : 'home'
    const current = openByScope.get(scopeKey) ?? []
    current.push({
      id: attention.attributes.id,
      updatedAt: attention.attributes.updatedAt,
      reference: workspaceAttentionReference(workspace.homeId, attention.attributes.id),
    })
    openByScope.set(scopeKey, current)
  }

  const latestHandledByScope = new Map<string, InboxEventDocument>()
  for (const event of workspace.events.values()) {
    if (event.attributes.status !== 'handled') continue
    const scopeKey = assistantConversationScopeKey(assistantConversationScopeForEvent(event))
    const current = latestHandledByScope.get(scopeKey)
    if (
      !current ||
      (event.attributes.handledAt ?? event.attributes.receivedAt).localeCompare(
        current.attributes.handledAt ?? current.attributes.receivedAt,
      ) > 0 ||
      ((event.attributes.handledAt ?? event.attributes.receivedAt) ===
        (current.attributes.handledAt ?? current.attributes.receivedAt) &&
        event.attributes.id.localeCompare(current.attributes.id) > 0)
    ) {
      latestHandledByScope.set(scopeKey, event)
    }
  }

  return [...openByScope.entries()].flatMap(([scopeKey, attentions]) => {
    const scoped = scopeSnapshots.get(scopeKey)
    const source = latestHandledByScope.get(scopeKey)
    if (!scoped || !source || source.attributes.disposition === 'operational-failed') return []
    const handedToOperator = new Set(needsYouAttentionIds(source.attributes.reply ?? ''))
    const remaining = attentions
      .filter((attention) => !handedToOperator.has(attention.id))
      .toSorted(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
      )
    if (remaining.length === 0) return []
    return [
      {
        ...scoped,
        sourceEventId: source.attributes.id,
        attentionIds: remaining.map((attention) => attention.id),
        attentionRefs: remaining.map((attention) => attention.reference),
      },
    ]
  })
}

function renderWakeEvent(scope: WakeScope, snapshot: AssistantStateSnapshot) {
  return [
    '# Project state event',
    '',
    `Scope: ${scope.kind === 'project' ? `Project ${scope.projectId}` : 'Home'}`,
    `Observed digest: ${snapshot.stateDigest}`,
    `Observed at: ${snapshot.observedAt}`,
    '',
    'This is a durable internal event for the same Assistant session. It is not operator input.',
    'A non-empty final response is persisted as a public Assistant message; an empty response remains internal.',
    'Current Project state and every unresolved Attention are supplied separately with this turn.',
    '',
  ].join('\n')
}

function renderAttentionContinuation(scope: WakeScope, attentionRefs: readonly string[]) {
  return [
    '# Unresolved Attention continuation',
    '',
    `Scope: ${scope.kind === 'project' ? `Project ${scope.projectId}` : 'Home'}`,
    '',
    'The preceding Assistant turn settled while these Attention items remained unresolved and were not presented through NeedsYou:',
    ...attentionRefs.map((reference) => `- ${reference}`),
    '',
    'This is a durable internal event for the same Assistant session. It is not operator input.',
    'Current state and every unresolved Attention are supplied separately with this turn.',
    '',
  ].join('\n')
}

function hasImmediateWakeSignal(snapshot: AssistantStateSnapshot) {
  if (snapshot.projects.some(projectHasPublishedReviewerReject)) return true
  if (snapshot.projects.some(projectHasStaleRun)) return true
  if (snapshot.activeRuns.length > 0) return false
  if (snapshot.workspaceAttentions.some(isOpenAttention)) return true
  return snapshot.projects.some((project) => {
    if (!isRecord(project)) return false
    if (project.available === false) return true
    if (!Array.isArray(project.goals)) return false
    return project.goals.some((goal) => {
      if (!isRecord(goal)) return false
      if (Array.isArray(goal.attentions) && goal.attentions.some(isOpenAttention)) return true
      if (!Array.isArray(goal.works)) return false
      return goal.works.some(
        (work) =>
          isRecord(work) &&
          isRecord(work.projection) &&
          Array.isArray(work.projection.failedPredicates) &&
          work.projection.failedPredicates.includes('failed_attempt'),
      )
    })
  })
}

function projectHasPublishedReviewerReject(project: unknown) {
  if (!isRecord(project) || !Array.isArray(project.goals)) return false
  return project.goals.some(
    (goal) =>
      isRecord(goal) &&
      Array.isArray(goal.works) &&
      goal.works.some((work) => {
        if (!isRecord(work) || !isRecord(work.runtime)) return false
        const latestPublished = Array.isArray(work.runtime.recentAttempts)
          ? work.runtime.recentAttempts.find(
              (attempt) =>
                isRecord(attempt) &&
                attempt.status === 'finished' &&
                attempt.application === 'published',
            )
          : undefined
        return (
          isRecord(latestPublished) &&
          latestPublished.responsibility === 'reviewer' &&
          latestPublished.result === 'reject'
        )
      }),
  )
}

function projectHasStaleRun(project: unknown) {
  if (!isRecord(project) || !Array.isArray(project.goals)) return false
  return project.goals.some(
    (goal) =>
      isRecord(goal) &&
      Array.isArray(goal.works) &&
      goal.works.some(
        (work) => isRecord(work) && isRecord(work.runtime) && work.runtime.stale === true,
      ),
  )
}

function isOpenAttention(value: unknown) {
  if (!isRecord(value)) return false
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return attributes.resolvedAt === null
}

function selectWakeScope<T extends { scopeKey: string }>(
  eligible: readonly T[],
  previousScopeKey: string | null,
) {
  if (!previousScopeKey) return eligible[0] as T
  const previousIndex = eligible.findIndex((candidate) => candidate.scopeKey === previousScopeKey)
  return (previousIndex >= 0 ? eligible[previousIndex + 1] : eligible[0]) ?? (eligible[0] as T)
}

function requiredProjectDigest(snapshot: AssistantStateSnapshot, projectId: string) {
  const digest = snapshot.conversationDigests.projects[projectId]
  if (!digest)
    throw new Error(`Assistant state is missing the conversation digest for ${projectId}`)
  return digest
}

function cursorPath(root: string, scopeKey: string) {
  return join(root, `${scopeKey.replaceAll(':', '-')}.json`)
}

async function readCursor(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  return wakeCursorSchema.parse(await file.json())
}

async function writeCursor(path: string, cursor: z.infer<typeof wakeCursorSchema>) {
  await writeJson(path, wakeCursorSchema.parse(cursor))
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

async function appendWakeEvent(path: string, event: AgentRuntimeEvent) {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(
    path,
    `${JSON.stringify({
      ...event,
      eventId: `WE-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    })}\n`,
  )
}

async function readWakeRunSummaries(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<ReflectionRunSummary | null> => {
        const runRoot = join(root, entry.name)
        const manifest = reflectionManifestSchema.safeParse(
          await Bun.file(join(runRoot, 'reflection.json'))
            .json()
            .catch(() => null),
        )
        if (!manifest.success || manifest.data.reflectionId !== entry.name) return null
        return {
          manifest: manifest.data,
          paths: {
            prompt: join(runRoot, 'prompt.md'),
            transcript: join(runRoot, 'transcript.log'),
            events: join(runRoot, 'events.jsonl'),
          },
        }
      }),
  )
  return runs
    .filter((run): run is ReflectionRunSummary => run !== null)
    .sort(
      (left, right) =>
        right.manifest.startedAt.localeCompare(left.manifest.startedAt) ||
        right.manifest.reflectionId.localeCompare(left.manifest.reflectionId),
    )
}

async function readWakeRunEvents(root: string, wakeId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(wakeId)) return null
  const runRoot = join(root, wakeId)
  const manifest = reflectionManifestSchema.safeParse(
    await Bun.file(join(runRoot, 'reflection.json'))
      .json()
      .catch(() => null),
  )
  if (!manifest.success || manifest.data.reflectionId !== wakeId) return null
  return readWakeEvents(join(runRoot, 'events.jsonl'))
}

async function readWakeEvents(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const events: ReflectionRuntimeEvent[] = []
  for (const line of (await file.text()).split('\n')) {
    if (!line.trim()) continue
    const value = JSON.parse(line) as unknown
    if (
      !isRecord(value) ||
      typeof value.eventId !== 'string' ||
      typeof value.createdAt !== 'string'
    ) {
      continue
    }
    events.push(value as ReflectionRuntimeEvent)
  }
  return events
}

async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
