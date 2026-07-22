import { appendFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { type ExecutionEnvelope, unreportedExecutionEnvelope } from '../agent/executionEnvelope'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { InboxContext } from '../domain/assistantWorkspaceDocuments'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { readDurableJsonLines } from '../storage/jsonLines'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'
import type { AssistantTools } from './assistantTools'
import type { AssistantModelRunner } from './workspaceAssistant'

export type ReflectionObserveResult = 'baseline' | 'deferred' | 'unchanged' | 'running' | 'started'

export interface ReflectionObservation {
  settled: boolean
}

const reflectionManifestSchema = z
  .object({
    version: z.literal(1),
    reflectionId: z.string().min(1),
    stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
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

export interface AssistantReflection {
  observe(input: ReflectionObservation): Promise<ReflectionObserveResult>
  isActive(): boolean
  listRuns(limit?: number): Promise<ReflectionRunDetail[]>
  listRunSummaries(): Promise<ReflectionRunSummary[]>
  readRunEvents(reflectionId: string): Promise<ReflectionRuntimeEvent[] | null>
  waitForIdle(): Promise<void>
  stop(): Promise<void>
}

export function createAssistantReflection(options: {
  homeRoot: string
  workspace: AssistantWorkspaceStore
  state: AssistantStateReader
  tools: AssistantTools
  runner: AssistantModelRunner
  resolveToolUrl(): string
  now?: () => Date
  maxConsecutiveHandoffs?: number
  minObserveIntervalMs?: number
  failureRetryBaseMs?: number
  failureRetryMaxMs?: number
  failuresBeforeMaxBackoff?: number
  onWake?(): void
  onLoopExhausted?(eventId: string, message: string): Promise<void> | void
}): AssistantReflection {
  const now = options.now ?? (() => new Date())
  const maxConsecutiveHandoffs = options.maxConsecutiveHandoffs ?? 3
  const minObserveIntervalMs = options.minObserveIntervalMs ?? 5_000
  const failureRetryBaseMs = options.failureRetryBaseMs ?? 5_000
  const failureRetryMaxMs = options.failureRetryMaxMs ?? 5 * 60_000
  const failuresBeforeMaxBackoff = options.failuresBeforeMaxBackoff ?? 3
  const reflectionsRoot = join(
    resolve(options.homeRoot),
    '.hopi',
    'runtime',
    'assistant',
    'reflections',
  )
  let lastAssessedDigest: string | null = null
  let lastAssessedSnapshot: AssistantStateSnapshot | null = null
  let active:
    | {
        digest: string
        controller: AbortController
        promise: Promise<void>
      }
    | undefined
  let failureState: { failures: number; retryNotBefore: number } | undefined
  let consecutiveHandoffs = 0
  let previousHandoffEventId: string | null = null
  let nextObserveAt = 0

  const reflection: AssistantReflection = {
    async observe(input) {
      if (active) return 'running'
      const currentTime = now().getTime()
      if (currentTime < nextObserveAt) return 'unchanged'
      nextObserveAt = currentTime + minObserveIntervalMs
      const snapshot = await options.state.read()
      if (failureState && currentTime < failureState.retryNotBefore) return 'unchanged'
      const immediate = hasImmediateReflectionSignal(snapshot)
      if (lastAssessedDigest === null && !immediate) {
        lastAssessedDigest = snapshot.stateDigest
        lastAssessedSnapshot = snapshot
        return 'baseline'
      }
      if (snapshot.stateDigest === lastAssessedDigest) return 'unchanged'
      if (!input.settled && !immediate) return 'deferred'
      const controller = new AbortController()
      const entry = {
        digest: snapshot.stateDigest,
        controller,
        promise: Promise.resolve(),
      }
      const previousSnapshot = lastAssessedSnapshot
      const assessment = reflectionAssessment(snapshot, input.settled)
      entry.promise = runReflection(snapshot, previousSnapshot, assessment, controller.signal)
        .then(async ({ handoffEventId }) => {
          if (controller.signal.aborted) return
          failureState = undefined
          lastAssessedDigest = entry.digest
          lastAssessedSnapshot = snapshot
          if (!handoffEventId) {
            consecutiveHandoffs = 0
            previousHandoffEventId = null
            return
          }
          if (previousHandoffEventId) {
            const previous = await options.workspace.readEvent(previousHandoffEventId)
            if (previous?.attributes.status === 'handled') consecutiveHandoffs = 0
          }
          consecutiveHandoffs += 1
          previousHandoffEventId = handoffEventId
          if (consecutiveHandoffs >= maxConsecutiveHandoffs) {
            await options.onLoopExhausted?.(
              handoffEventId,
              `Background Reflection handed off ${consecutiveHandoffs} consecutive state changes without converging.`,
            )
            consecutiveHandoffs = 0
          }
        })
        .catch(() => {
          const failures = (failureState?.failures ?? 0) + 1
          const delay =
            failures >= failuresBeforeMaxBackoff
              ? failureRetryMaxMs
              : Math.min(failureRetryBaseMs * 2 ** Math.min(failures - 1, 20), failureRetryMaxMs)
          failureState = {
            failures,
            retryNotBefore: now().getTime() + delay,
          }
        })
        .finally(() => {
          if (active === entry) active = undefined
          options.onWake?.()
        })
      active = entry
      return 'started'
    },

    isActive() {
      return Boolean(active)
    },

    listRuns(limit = 20) {
      return readReflectionRuns(reflectionsRoot, Math.max(1, Math.min(limit, 100)))
    },

    listRunSummaries() {
      return readReflectionRunSummaries(reflectionsRoot)
    },

    readRunEvents(reflectionId) {
      return readReflectionRunEvents(reflectionsRoot, reflectionId)
    },

    async waitForIdle() {
      await active?.promise
    },

    async stop() {
      active?.controller.abort()
      await active?.promise
    },
  }

  async function runReflection(
    snapshot: AssistantStateSnapshot,
    previousSnapshot: AssistantStateSnapshot | null,
    assessment: ReflectionAssessment,
    signal: AbortSignal,
  ) {
    const reflectionId = `RF-${crypto.randomUUID()}`
    const root = join(reflectionsRoot, reflectionId)
    const manifestPath = join(root, 'reflection.json')
    const eventsPath = join(root, 'events.jsonl')
    const transcriptPath = join(root, 'transcript.log')
    const promptPath = join(root, 'prompt.md')
    const lastMessagePath = join(root, 'last-message.txt')
    const startedAt = now().toISOString()
    let handoffEventId: string | null = null
    const preparedHandoff: {
      current: { brief: string; context?: InboxContext } | null
    } = { current: null }
    const manifest: ReflectionManifest = {
      version: 1,
      reflectionId,
      stateDigest: snapshot.stateDigest,
      status: 'running',
      startedAt,
      endedAt: null,
      error: null,
      handoffEventId: null,
    }
    await mkdir(root, { recursive: true })
    await Bun.write(eventsPath, '')
    await Bun.write(transcriptPath, '')
    await writeManifest(manifestPath, manifest)
    const token = options.tools.issueReflection(
      reflectionId,
      (handoff) => {
        preparedHandoff.current = handoff
      },
      assessment.context,
    )
    const observer = {
      onEvent: (event: AgentRuntimeEvent) => appendReflectionEvent(eventsPath, event, now()),
    }

    try {
      const preparation = {
        cwd: root,
        toolMode: 'reflection' as const,
        readableRoots: [resolve(options.homeRoot)],
      }
      const executionPlan = options.runner.prepare
        ? await options.runner.prepare(preparation)
        : {
            environment: unreportedExecutionEnvelope({
              runtimeWorkspace: root,
              runtimeWorkspaceRole: 'provider scratch space',
              canonicalMutation: 'hopi-tools-only',
              toolMode: 'reflection',
            }),
          }
      const prompt = reflectionPrompt(
        snapshot,
        previousSnapshot,
        assessment.reasons,
        executionPlan.environment,
      )
      await Bun.write(promptPath, prompt)
      await options.runner.run(
        {
          eventId: reflectionId,
          prompt,
          session: null,
          cwd: root,
          lastMessageFile: lastMessagePath,
          transcriptFile: transcriptPath,
          toolUrl: options.resolveToolUrl(),
          toolToken: token,
          toolMode: 'reflection',
          readableRoots: [resolve(options.homeRoot)],
          executionPlan,
          signal,
        },
        observer,
      )
      const endedAt = now().toISOString()
      if (signal.aborted) {
        await writeManifest(manifestPath, {
          ...manifest,
          status: 'interrupted',
          endedAt,
          error: 'Interrupted by Coordinator shutdown.',
          handoffEventId,
        })
        return { handoffEventId: null }
      }
      const latest = await options.state.read()
      const handoff = preparedHandoff.current
      if (latest.stateDigest === snapshot.stateDigest && handoff) {
        const event = await options.workspace.receiveReflectionEvent({
          content: handoff.brief,
          context: handoff.context
            ? {
                ...handoff.context,
                observedDigest: snapshot.stateDigest,
              }
            : undefined,
        })
        handoffEventId = event.attributes.id
      }
      await writeManifest(manifestPath, {
        ...manifest,
        status: 'completed',
        endedAt,
        handoffEventId,
      })
      return { handoffEventId }
    } catch (error) {
      const interrupted = signal.aborted
      await writeManifest(manifestPath, {
        ...manifest,
        status: interrupted ? 'interrupted' : 'failed',
        endedAt: now().toISOString(),
        error: interrupted ? 'Interrupted by Coordinator shutdown.' : errorMessage(error),
        handoffEventId,
      })
      if (interrupted) return { handoffEventId: null }
      throw error
    } finally {
      options.tools.revoke(token)
      await rm(lastMessagePath, { force: true })
    }
  }

  return reflection
}

function reflectionPrompt(
  snapshot: AssistantStateSnapshot,
  previousSnapshot: AssistantStateSnapshot | null,
  trigger: readonly string[],
  environment: ExecutionEnvelope,
) {
  const delta = reflectionDelta(previousSnapshot, snapshot)
  return [
    '# HOPI Background Reflection',
    '',
    '## Current execution environment',
    '',
    JSON.stringify(environment, null, 2),
    '',
    'Objective: decide whether this state change warrants a speaking Assistant turn, and hand off the material facts and consequence when it does.',
    'This is a disposable read-only run. Canonical state and source are immutable here; the available HOPI tools are hopi_read_state and hopi_handoff_to_main.',
    'The supplied snapshot is an observation and may become stale. A handoff creates an internal Inbox event; it does not itself notify the operator or mutate Goal state.',
    'Current diagnostics are observations at observedAt. currentCandidateIntegration is the live C1 source preflight; ready means the current task and release inputs need no Generator source repair to cross that merge. creationRationale and latestAttempt are historical records; an open Attention is unresolved, but its original diagnosis may already be obsolete.',
    'HOPI has no separate candidate reprojection state or Coordinator repair action outside currentCandidateIntegration. Resolving an Attention removes its scheduling gate; reconciliation then chooses the next responsibility.',
    'Use the trigger to choose the narrowest useful read: Home and Project reads are compact indexes, while a Goal read provides current diagnostic detail.',
    'Attention ownership is exact: copy each selected reference verbatim from hopi_read_state; never construct it from id or target. One handoff may select workspace Attention or Attention from exactly one Goal, never mixed scopes.',
    'Operator action means a human decision, credential, permission, or external act that Assistant authority cannot provide. Assistant-owned technical work remains Assistant action.',
    'At most one handoff is accepted. No handoff produces no speaking turn.',
    '',
    `State digest: ${snapshot.stateDigest}`,
    '',
    '## Trigger',
    '',
    ...trigger.map((reason) => `- ${reason}`),
    '',
    '## Changed Facts Since Last Assessment',
    '',
    ...delta.lines.map((line) => `- ${line}`),
    '',
  ].join('\n')
}

async function appendReflectionEvent(path: string, event: AgentRuntimeEvent, createdAt: Date) {
  await appendFile(
    path,
    `${JSON.stringify({ ...event, eventId: `RE-${crypto.randomUUID()}`, createdAt: createdAt.toISOString() })}\n`,
  )
}

async function readReflectionRuns(root: string, limit: number) {
  const summaries = (await readReflectionRunSummaries(root)).slice(0, limit)
  return Promise.all(
    summaries.map(
      async (summary): Promise<ReflectionRunDetail> => ({
        ...summary,
        events: await readReflectionEvents(summary.paths.events),
      }),
    ),
  )
}

async function readReflectionRunSummaries(root: string) {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const runs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<ReflectionRunSummary | null> => {
        const runRoot = join(root, entry.name)
        const manifestFile = Bun.file(join(runRoot, 'reflection.json'))
        if (!(await manifestFile.exists())) return null
        const manifest = reflectionManifestSchema.safeParse(
          await manifestFile.json().catch(() => null),
        )
        if (!manifest.success || manifest.data.reflectionId !== entry.name) return null
        const eventsPath = join(runRoot, 'events.jsonl')
        return {
          manifest: manifest.data,
          paths: {
            prompt: join(runRoot, 'prompt.md'),
            transcript: join(runRoot, 'transcript.log'),
            events: eventsPath,
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

async function readReflectionRunEvents(root: string, reflectionId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reflectionId)) return null
  const runRoot = join(root, reflectionId)
  const manifestFile = Bun.file(join(runRoot, 'reflection.json'))
  if (!(await manifestFile.exists())) return null
  const manifest = reflectionManifestSchema.safeParse(await manifestFile.json().catch(() => null))
  if (!manifest.success || manifest.data.reflectionId !== reflectionId) return null
  return readReflectionEvents(join(runRoot, 'events.jsonl'))
}

async function readReflectionEvents(path: string) {
  return readDurableJsonLines(path, (value) => {
    if (
      !isRecord(value) ||
      typeof value.eventId !== 'string' ||
      typeof value.createdAt !== 'string'
    ) {
      throw new Error('Reflection event is missing its durable identity')
    }
    return value as ReflectionRuntimeEvent
  })
}

async function writeManifest(path: string, manifest: ReflectionManifest) {
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

interface ReflectionAssessment {
  reasons: string[]
  context?: InboxContext
}

function reflectionAssessment(
  snapshot: AssistantStateSnapshot,
  settled: boolean,
): ReflectionAssessment {
  const reasons: string[] = []
  const contexts: InboxContext[] = []
  let hasWorkspaceSignal = false
  for (const attention of snapshot.workspaceAttentions) {
    if (!isAssistantOwnedAttention(attention)) continue
    hasWorkspaceSignal = true
    const target = recordTarget(attention)
    reasons.push(
      `Assistant-owned workspace Attention ${recordId(attention)}${target ? ` targeting ${target}` : ''} is open.`,
    )
  }
  for (const project of snapshot.projects) {
    if (!isRecord(project)) continue
    const projectId = stringValue(project.projectId, 'unknown-project')
    if (project.available === false) {
      reasons.push(`Project ${projectId} is unavailable.`)
      contexts.push({ projectId })
    }
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalId = nestedId(goal.goal, 'unknown-goal')
      if (Array.isArray(goal.attentions)) {
        for (const attention of goal.attentions) {
          if (!isAssistantOwnedAttention(attention)) continue
          reasons.push(
            `Goal ${goalId} has Assistant-owned Attention ${recordId(attention)} in Project ${projectId}.`,
          )
          contexts.push({ projectId, goalId })
        }
      }
      if (!Array.isArray(goal.works)) continue
      for (const work of goal.works) {
        if (!isRecord(work) || !isRecord(work.runtime) || work.runtime.stale !== true) continue
        reasons.push(
          `Work ${nestedId(work.attributes, 'unknown-work')} in ${projectId}/${goalId} has a stale running Attempt.`,
        )
        contexts.push({ projectId, goalId })
      }
    }
  }
  if (reasons.length === 0) {
    reasons.push(
      settled
        ? 'Coordinator reached a settled boundary after a semantic state change.'
        : 'An immediate control signal requires assessment while automatic work is still active.',
    )
  }
  const projectIds = new Set(contexts.map((context) => context.projectId).filter(Boolean))
  const projectId = projectIds.size === 1 ? [...projectIds][0] : undefined
  const firstGoalId = contexts[0]?.goalId
  const goalId =
    projectId && firstGoalId && contexts.every((context) => context.goalId === firstGoalId)
      ? firstGoalId
      : undefined
  return {
    reasons,
    ...(!hasWorkspaceSignal && projectId
      ? { context: { projectId, ...(goalId ? { goalId } : {}) } }
      : {}),
  }
}

function reflectionDelta(previous: AssistantStateSnapshot | null, current: AssistantStateSnapshot) {
  const currentFacts = reflectionFacts(current)
  if (!previous) {
    return {
      lines: [
        'No previous assessed snapshot is available; use the trigger to inspect its exact candidate.',
      ],
    }
  }

  const previousFacts = reflectionFacts(previous)
  const lines: string[] = []
  for (const key of new Set([...previousFacts.keys(), ...currentFacts.keys()])) {
    const before = previousFacts.get(key)
    const after = currentFacts.get(key)
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    const change = before === undefined ? 'Added' : after === undefined ? 'Removed' : 'Changed'
    const value = after !== undefined ? after : before
    lines.push(`${change} ${key}: ${bounded(JSON.stringify(value) ?? 'undefined', 800)}`)
  }
  const visible: string[] = []
  let characters = 0
  for (const line of lines) {
    if (visible.length >= 48 || characters + line.length > 12_000) break
    visible.push(line)
    characters += line.length
  }
  if (lines.length > visible.length) {
    visible.push(`${lines.length - visible.length} additional changed facts omitted.`)
  }
  if (visible.length === 0) {
    visible.push('The semantic digest changed without a difference in the compact fact projection.')
  }
  return { lines: visible }
}

function reflectionFacts(snapshot: AssistantStateSnapshot) {
  const facts = new Map<string, unknown>()
  for (const run of snapshot.activeRuns) {
    facts.set(`Active Run ${run.projectId}/${run.goalId}/${run.workId}`, {
      responsibility: run.responsibility,
      runId: run.runId,
    })
  }
  for (const attention of snapshot.workspaceAttentions) {
    const id = recordId(attention)
    facts.set(`Workspace Attention ${id}`, compactAttention(attention))
  }
  for (const project of snapshot.projects) {
    if (!isRecord(project)) continue
    const projectId = stringValue(project.projectId, 'unknown-project')
    facts.set(`Project ${projectId}`, {
      available: project.available,
      releaseHead: project.releaseHead,
    })
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalId = nestedId(goal.goal, 'unknown-goal')
      facts.set(`Goal ${projectId}/${goalId}`, compactGoal(goal.goal))
      if (isRecord(goal.latestPlanningOutcome)) {
        facts.set(`Latest Planning ${projectId}/${goalId}`, compactWork(goal.latestPlanningOutcome))
      }
      if (Array.isArray(goal.works)) {
        for (const work of goal.works) {
          if (!isRecord(work)) continue
          const workId = nestedId(work.attributes, 'unknown-work')
          facts.set(`Work ${projectId}/${goalId}/${workId}`, compactWork(work))
        }
      }
      if (Array.isArray(goal.attentions)) {
        for (const attention of goal.attentions) {
          facts.set(
            `Goal Attention ${projectId}/${goalId}/${recordId(attention)}`,
            compactAttention(attention),
          )
        }
      }
    }
  }
  return facts
}

function compactGoal(value: unknown) {
  if (!isRecord(value)) return value
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return {
    id: attributes.id,
    title: attributes.title,
    lifecycle: attributes.lifecycle,
    priority: attributes.priority,
    contractRevision: attributes.contractRevision,
    completionAttentionId: attributes.completionAttentionId,
  }
}

function compactWork(value: Record<string, unknown>) {
  const attributes = isRecord(value.attributes) ? value.attributes : {}
  const evidenceRefs = Array.isArray(attributes.evidenceRefs) ? attributes.evidenceRefs : []
  return {
    attributes: {
      id: attributes.id,
      title:
        typeof attributes.title === 'string' ? bounded(attributes.title, 120) : attributes.title,
      kind: attributes.kind,
      stage: attributes.stage,
      notBefore: attributes.notBefore,
      contractRevision: attributes.contractRevision,
      attempts: attributes.attempts,
    },
    evidenceCount: evidenceRefs.length,
    latestEvidenceRef: evidenceRefs.at(-1) ?? null,
    runtime: compactRuntime(value.runtime),
    projection: compactProjection(value.projection),
    currentCandidateIntegration: value.candidateIntegration,
    dependsOn: Array.isArray(attributes.dependsOn) ? attributes.dependsOn.slice(0, 8) : [],
    dependencyCount: Array.isArray(attributes.dependsOn) ? attributes.dependsOn.length : 0,
  }
}

function compactProjection(value: unknown) {
  if (!isRecord(value)) return value
  return {
    column: value.column,
    ready: value.ready,
    responsibility: value.responsibility,
    failedPredicates: value.failedPredicates,
  }
}

function compactRuntime(value: unknown) {
  if (!isRecord(value)) return value
  return {
    activeResponsibility: value.activeResponsibility,
    latestAttempt: compactAttempt(value.latestAttempt),
    lastActivityAt: value.lastActivityAt,
    stale: value.stale,
    ...(isRecord(value.paths) ? { paths: value.paths } : {}),
  }
}

function compactAttempt(value: unknown) {
  if (!isRecord(value)) return value
  return {
    runId: value.runId,
    responsibility: value.responsibility,
    status: value.status,
    result: value.result,
    application: value.application,
    endedAt: value.endedAt,
    exitCode: value.exitCode,
    summary: typeof value.summary === 'string' ? bounded(value.summary, 240) : value.summary,
  }
}

function compactAttention(value: unknown) {
  if (!isRecord(value)) return value
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return {
    attributes: {
      id: attributes.id,
      target: attributes.target,
      createdAt: attributes.createdAt,
      resolvedAt: attributes.resolvedAt,
      notifiedAt: attributes.notifiedAt,
      operatorRequest: attributes.operatorRequest ?? null,
      resolutionInput: attributes.resolutionInput,
      retryRunId: attributes.retryRunId ?? null,
    },
    ...(typeof value.body === 'string' ? { body: bounded(value.body, 800) } : {}),
    ...(typeof value.inspectionPath === 'string'
      ? { inspectionPath: value.inspectionPath }
      : typeof value.path === 'string'
        ? { inspectionPath: value.path }
        : {}),
  }
}

function recordId(value: unknown) {
  if (!isRecord(value)) return 'unknown-attention'
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return stringValue(attributes.id, 'unknown-attention')
}

function recordTarget(value: unknown) {
  if (!isRecord(value)) return null
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return typeof attributes.target === 'string' ? attributes.target : null
}

function nestedId(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return stringValue(attributes.id, fallback)
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function bounded(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasImmediateReflectionSignal(snapshot: AssistantStateSnapshot) {
  if (snapshot.workspaceAttentions.some(isAssistantOwnedAttention)) return true
  return snapshot.projects.some((project) => {
    if (!isRecord(project)) return false
    if (project.available === false) return true
    if (!Array.isArray(project.goals)) return false
    return project.goals.some((goal) => {
      if (!isRecord(goal)) return false
      if (Array.isArray(goal.attentions) && goal.attentions.some(isAssistantOwnedAttention))
        return true
      if (!Array.isArray(goal.works)) return false
      return goal.works.some(
        (work) => isRecord(work) && isRecord(work.runtime) && work.runtime.stale === true,
      )
    })
  })
}

function isAssistantOwnedAttention(value: unknown) {
  if (!isRecord(value)) return false
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return (
    attributes.resolvedAt === null &&
    (attributes.operatorRequest ?? null) === null &&
    (attributes.retryRunId ?? null) === null
  )
}
