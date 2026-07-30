import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import {
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  isInternalInboxSource,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import { workspaceAttentionReference } from '../domain/attentionReference'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { writeJsonAtomically } from '../storage/atomicFile'
import { readDirectoryEntriesIfExists } from '../storage/filesystem'
import { readDurableJsonLines, reportInvalidRuntimeRecord } from '../storage/jsonLines'
import {
  assistantConversationScopeForEvent,
  assistantConversationScopeKey,
} from './assistantConversationScope'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'
import { assistantMaterialWakeKeys } from './assistantSupervisionContext'

export type WakeObserveResult = 'baseline' | 'deferred' | 'unchanged' | 'running' | 'started'

export interface WakeObservation {
  settled: boolean
  busyScopeKeys?: readonly string[]
}

const wakeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('home') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1) }).strict(),
])

type WakeScope = z.infer<typeof wakeScopeSchema>

const wakeCursorSchema = z
  .object({
    scope: wakeScopeSchema,
    stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    eventId: z.string().min(1).nullable(),
    attentionRevisionDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()

const wakeManifestSchema = z
  .object({
    wakeId: z.string().min(1),
    stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
    scope: wakeScopeSchema,
    status: z.enum(['running', 'completed', 'interrupted', 'failed']),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }).nullable(),
    error: z.string().nullable(),
    handoffEventId: z.string().min(1).nullable(),
  })
  .strict()

export type WakeManifest = z.infer<typeof wakeManifestSchema>
export type WakeRuntimeEvent = AgentRuntimeEvent & { eventId: string; createdAt: string }

export interface WakeRunSummary {
  manifest: WakeManifest
  paths: { prompt: string; transcript: string; events: string }
}

export interface WakeRunDetail extends WakeRunSummary {
  events: WakeRuntimeEvent[]
}

export interface AssistantWake {
  observe(input: WakeObservation): Promise<WakeObserveResult>
  acknowledgeProjects(projectIds: readonly string[]): Promise<void>
  isActive(): boolean
  listRuns(limit?: number): Promise<WakeRunDetail[]>
  listRunSummaries(): Promise<WakeRunSummary[]>
  readRunEvents(wakeId: string): Promise<WakeRuntimeEvent[] | null>
  waitForIdle(): Promise<void>
  stop(): Promise<void>
}

export function createAssistantWake(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  state: AssistantStateReader
  now?: () => Date
  onWake(): void
}): AssistantWake {
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

      const snapshot = await options.state.readForWake()
      const busyScopeKeys = new Set(input.busyScopeKeys ?? [])
      const scopes = wakeScopeSnapshots(snapshot).filter(
        (candidate) => !busyScopeKeys.has(candidate.scopeKey),
      )
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
              isInternalInboxSource(event.attributes.source),
          )
          .map((event) =>
            event.attributes.context?.projectId
              ? `project:${event.attributes.context.projectId}`
              : 'home',
          ),
      )
      const continuations = []
      for (const candidate of attentionContinuationCandidates(workspace, scopes)) {
        const attentionRevisionDigest = await attentionContinuationDigest(
          candidate.scopeKey,
          candidate.attentionRevisions,
        )
        const cursor = await readCursor(cursorPath(cursorsRoot, candidate.scopeKey))
        if (
          input.settled &&
          !allPendingScopeKeys.has(candidate.scopeKey) &&
          cursor?.attentionRevisionDigest !== attentionRevisionDigest &&
          candidate.snapshot.activeRuns.length === 0
        ) {
          continuations.push({
            ...candidate,
            eventId: `EV-attention-${attentionRevisionDigest.slice(0, 24)}`,
            attentionRevisionDigest,
          })
        }
      }
      if (continuations.length > 0) {
        const selected = selectWakeScope(continuations, lastScopeKey)
        lastScopeKey = selected.scopeKey
        const operation = publishWake(selected.scope, selected.scopeKey, selected.snapshot, {
          eventId: selected.eventId,
          attentionRevisionDigest: selected.attentionRevisionDigest,
          attentionIds: selected.attentionIds,
          attentionRefs: selected.attentionRefs,
        }).finally(() => {
          active = null
          options.onWake()
        })
        active = operation
        await operation
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
              scope: candidate.scope,
              stateDigest: candidate.snapshot.stateDigest,
              eventId: null,
              attentionRevisionDigest: null,
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
          options.onWake()
        },
      )
      active = operation
      await operation
      return 'started'
    },

    async acknowledgeProjects(projectIds) {
      if (stopped || projectIds.length === 0) return
      await active
      const [snapshot, workspace] = await Promise.all([
        options.state.readForWake(),
        options.workspace.readWorkspaceForControl(),
      ])
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
          scope: candidate.scope,
          stateDigest: candidate.snapshot.stateDigest,
          eventId: cursor?.eventId ?? null,
          attentionRevisionDigest: await workspaceAttentionRevisionDigest(workspace, scopeKey),
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

    readRunEvents(wakeId) {
      return readWakeRunEvents(runsRoot, wakeId)
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
      eventId: string
      attentionRevisionDigest: string
      attentionIds: string[]
      attentionRefs: string[]
    },
  ) {
    const eventId =
      continuation?.eventId ??
      `EV-wake-${(
        await sha256(`${scopeKey}\u0000${JSON.stringify(assistantMaterialWakeKeys(snapshot))}`)
      ).slice(0, 24)}`
    const previousCursor = await readCursor(cursorPath(cursorsRoot, scopeKey))
    const attentionRevisionDigest =
      continuation?.attentionRevisionDigest ?? previousCursor?.attentionRevisionDigest ?? null
    const existing = await options.workspace.readEvent(eventId)
    if (existing) {
      await writeCursor(cursorPath(cursorsRoot, scopeKey), {
        scope,
        stateDigest: snapshot.stateDigest,
        eventId,
        attentionRevisionDigest,
        updatedAt: now().toISOString(),
      })
      return
    }
    const wakeId = `WK-${crypto.randomUUID()}`
    const runRoot = join(runsRoot, wakeId)
    const manifestPath = join(runRoot, 'wake.json')
    const promptPath = join(runRoot, 'prompt.md')
    const transcriptPath = join(runRoot, 'transcript.log')
    const eventsPath = join(runRoot, 'events.jsonl')
    const startedAt = now()
    const baseManifest: WakeManifest = {
      wakeId,
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
                observedDigest: snapshot.stateDigest,
              },
            }
          : {}),
        receivedAt: startedAt,
      })
      await writeCursor(cursorPath(cursorsRoot, scopeKey), {
        scope,
        stateDigest: snapshot.stateDigest,
        eventId,
        attentionRevisionDigest,
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

function wakeScopeSnapshots(snapshot: AssistantStateSnapshot) {
  const projects = new Map(snapshot.projects.map((project) => [project.projectId, project]))
  const projectIds = new Set(projects.keys())
  const attentionProjectId = (projectId: string | null) =>
    projectId && projectIds.has(projectId) ? projectId : null
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
          (attention) => attentionProjectId(attention.projectId) === null,
        ),
        projects: [],
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
          (attention) => attentionProjectId(attention.projectId) === projectId,
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
  const openByScope = new Map<
    string,
    Array<{ id: string; updatedAt: string; reference: string; revision: string }>
  >()
  for (const attention of workspace.attentions.values()) {
    if (attention.attributes.resolvedAt !== null) continue
    const projectId = workspaceAttentionProjectId(attention)
    const scopeKey = projectId ? `project:${projectId}` : 'home'
    const current = openByScope.get(scopeKey) ?? []
    current.push({
      id: attention.attributes.id,
      updatedAt: attention.attributes.updatedAt,
      reference: workspaceAttentionReference(workspace.homeId, attention.attributes.id),
      revision: workspaceAttentionRevisionKey(attention),
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
    const remaining = attentions.toSorted(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
    )
    if (remaining.length === 0) return []
    return [
      {
        ...scoped,
        attentionIds: remaining.map((attention) => attention.id),
        attentionRevisions: remaining.map((attention) => attention.revision),
        attentionRefs: remaining.map((attention) => attention.reference),
      },
    ]
  })
}

function renderWakeEvent(scope: WakeScope, snapshot: AssistantStateSnapshot) {
  const facts = JSON.stringify(assistantMaterialWakeKeys(snapshot), null, 2)
  return [
    '# Project supervision wake',
    '',
    `Scope: ${scope.kind === 'project' ? `Project ${scope.projectId}` : 'Home'}`,
    `Observed digest: ${snapshot.stateDigest}`,
    `Observed at: ${snapshot.observedAt}`,
    '',
    'This is a durable internal event for a native fork of the Project speaking Session. It is not operator input.',
    'It reports observed facts and does not prescribe cancellation, continuation, or Goal lifecycle changes.',
    'A non-empty final response is persisted as a public Assistant message; an empty response remains internal.',
    'The material fact identities below identify this wake. Current Project facts are supplied when the fork starts.',
    '',
    '```json',
    facts,
    '```',
    '',
  ].join('\n')
}

function renderAttentionContinuation(scope: WakeScope, attentionRefs: readonly string[]) {
  return [
    '# Unresolved Attention continuation',
    '',
    `Scope: ${scope.kind === 'project' ? `Project ${scope.projectId}` : 'Home'}`,
    '',
    'The preceding Assistant turn settled while these Attention items remained unresolved:',
    ...attentionRefs.map((reference) => `- ${reference}`),
    '',
    'This is a durable internal event for a native fork of the Project speaking Session. It is not operator input.',
    'It reports an unresolved fact and does not prescribe cancellation, continuation, or Goal lifecycle changes.',
    'Current state and every unresolved Attention are supplied separately with this turn.',
    '',
  ].join('\n')
}

async function attentionContinuationDigest(
  scopeKey: string,
  attentionRevisions: readonly string[],
) {
  return sha256(`${scopeKey}\u0000${attentionRevisions.join('\u0000')}`)
}

async function workspaceAttentionRevisionDigest(workspace: AssistantWorkspace, scopeKey: string) {
  const revisions = [...workspace.attentions.values()]
    .filter((attention) => {
      if (attention.attributes.resolvedAt !== null) return false
      const projectId = workspaceAttentionProjectId(attention)
      return (projectId ? `project:${projectId}` : 'home') === scopeKey
    })
    .map(workspaceAttentionRevisionKey)
    .toSorted()
  return revisions.length > 0 ? attentionContinuationDigest(scopeKey, revisions) : null
}

function workspaceAttentionRevisionKey(attention: WorkspaceAttentionDocument) {
  return [
    attention.attributes.id,
    attention.attributes.updatedAt,
    JSON.stringify(attention.attributes.refs),
    attention.body,
  ].join('\u0000')
}

function hasImmediateWakeSignal(snapshot: AssistantStateSnapshot) {
  if (snapshot.projects.some(projectHasPublishedReviewerReject)) return true
  if (snapshot.projects.some(projectHasStaleRun)) return true
  if (snapshot.projects.some(projectHasSettledFailure)) return true
  if (snapshot.activeRuns.length > 0) return false
  if (snapshot.workspaceAttentions.some((attention) => attention.resolvedAt === null)) return true
  return snapshot.projects.some((project) => {
    if (project.available === false) return true
    return project.goals.some((goal) =>
      goal.attentions.some((attention) => attention.attributes.resolvedAt === null),
    )
  })
}

function projectHasSettledFailure(project: AssistantStateSnapshot['projects'][number]) {
  return project.goals.some((goal) =>
    goal.works.some((work) => work.projection?.failedPredicates.includes('failed_attempt')),
  )
}

function projectHasPublishedReviewerReject(project: AssistantStateSnapshot['projects'][number]) {
  return project.goals.some((goal) =>
    goal.works.some((work) => {
      const latestPublished = work.runtime.recentAttempts.find(
        (attempt) => attempt.status === 'finished' && attempt.application === 'published',
      )
      return (
        latestPublished !== undefined &&
        latestPublished.responsibility === 'reviewer' &&
        latestPublished.result === 'reject'
      )
    }),
  )
}

function projectHasStaleRun(project: AssistantStateSnapshot['projects'][number]) {
  return project.goals.some((goal) => goal.works.some((work) => work.runtime.stale))
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
  try {
    return wakeCursorSchema.parse(await file.json())
  } catch (error) {
    reportInvalidRuntimeRecord(path, error)
    return null
  }
}

async function writeCursor(path: string, cursor: z.infer<typeof wakeCursorSchema>) {
  await writeJson(path, wakeCursorSchema.parse(cursor))
}

async function writeJson(path: string, value: unknown) {
  await writeJsonAtomically(path, value)
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
  const entries = await readDirectoryEntriesIfExists(root)
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<WakeRunSummary | null> => {
        const runRoot = join(root, entry.name)
        const path = join(runRoot, 'wake.json')
        try {
          const manifest = wakeManifestSchema.parse(await Bun.file(path).json())
          if (manifest.wakeId !== entry.name) {
            throw new Error(`Wake identity mismatch: ${entry.name}`)
          }
          return {
            manifest,
            paths: {
              prompt: join(runRoot, 'prompt.md'),
              transcript: join(runRoot, 'transcript.log'),
              events: join(runRoot, 'events.jsonl'),
            },
          }
        } catch (error) {
          reportInvalidRuntimeRecord(path, error)
          return null
        }
      }),
  )
  return runs
    .filter((run): run is WakeRunSummary => run !== null)
    .sort(
      (left, right) =>
        right.manifest.startedAt.localeCompare(left.manifest.startedAt) ||
        right.manifest.wakeId.localeCompare(left.manifest.wakeId),
    )
}

async function readWakeRunEvents(root: string, wakeId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(wakeId)) return null
  const runRoot = join(root, wakeId)
  const manifestPath = join(runRoot, 'wake.json')
  const file = Bun.file(manifestPath)
  if (!(await file.exists())) return null
  try {
    const manifest = wakeManifestSchema.parse(await file.json())
    if (manifest.wakeId !== wakeId) {
      throw new Error(`Wake identity mismatch: ${wakeId}`)
    }
  } catch (error) {
    reportInvalidRuntimeRecord(manifestPath, error)
    return null
  }
  return readWakeEvents(join(runRoot, 'events.jsonl'))
}

async function readWakeEvents(path: string) {
  return readDurableJsonLines(path, (value) => {
    if (
      !isRecord(value) ||
      typeof value.eventId !== 'string' ||
      typeof value.createdAt !== 'string'
    ) {
      throw new Error('eventId and createdAt are required')
    }
    return value as WakeRuntimeEvent
  })
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
