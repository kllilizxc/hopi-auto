import { appendFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentRuntimeEvent } from '../agent/runtimeEvents'
import type { InboxContext } from '../domain/assistantWorkspaceDocuments'
import { goalAttentionReference, workspaceAttentionReference } from '../domain/attentionReference'
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
  maxFailuresPerDigest?: number
  onWake?(): void
  onLoopExhausted?(eventId: string, message: string): Promise<void> | void
}): AssistantReflection {
  const now = options.now ?? (() => new Date())
  const maxConsecutiveHandoffs = options.maxConsecutiveHandoffs ?? 3
  const minObserveIntervalMs = options.minObserveIntervalMs ?? 5_000
  const failureRetryBaseMs = options.failureRetryBaseMs ?? 5_000
  const failureRetryMaxMs = options.failureRetryMaxMs ?? 5 * 60_000
  const maxFailuresPerDigest = options.maxFailuresPerDigest ?? 3
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
  let failureState:
    | { digest: string; failures: number; retryNotBefore: number; exhausted: boolean }
    | undefined
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
      if (failureState && failureState.digest !== snapshot.stateDigest) failureState = undefined
      if (failureState?.exhausted) return 'unchanged'
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
      const trigger = reflectionTrigger(snapshot, input.settled)
      entry.promise = runReflection(snapshot, previousSnapshot, trigger, controller.signal)
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
          const failures = failureState?.digest === entry.digest ? failureState.failures + 1 : 1
          const exhausted = failures >= maxFailuresPerDigest
          const delay = exhausted
            ? 0
            : Math.min(failureRetryBaseMs * 2 ** Math.min(failures - 1, 20), failureRetryMaxMs)
          failureState = {
            digest: entry.digest,
            failures,
            retryNotBefore: now().getTime() + delay,
            exhausted,
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
    trigger: readonly string[],
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
    const token = options.tools.issueReflection(reflectionId, (handoff) => {
      preparedHandoff.current = handoff
    })
    const observer = {
      onEvent: (event: AgentRuntimeEvent) => appendReflectionEvent(eventsPath, event, now()),
    }

    try {
      const prompt = await reflectionPrompt(options.workspace, snapshot, previousSnapshot, trigger)
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
      const workspace = await options.workspace.readWorkspace()
      const handoff = prepareReflectionHandoff(snapshot, workspace.homeId, preparedHandoff.current)
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

interface PreparedReflectionHandoff {
  brief: string
  context?: InboxContext
}

function prepareReflectionHandoff(
  snapshot: AssistantStateSnapshot,
  homeId: string,
  prepared: PreparedReflectionHandoff | null,
): PreparedReflectionHandoff | null {
  const scopes = unnotifiedGoalAttentionScopes(snapshot)
  const preferred = prepared?.context
    ? scopes.find(
        (scope) =>
          scope.projectId === prepared.context?.projectId &&
          scope.goalId === prepared.context?.goalId,
      )
    : undefined
  const scope = preferred ?? scopes[0]
  if (scope) {
    const fallbackBrief = [
      `Unnotified Attention remains open for ${scope.projectId}/${scope.goalId}.`,
      'Re-read current state, resolve it with ordinary HOPI tools when safe, and notify the operator only when a decision or concise result is required.',
      `Canonical Attention references: ${scope.attentionRefs.join(', ')}.`,
    ].join(' ')
    return {
      brief: preferred ? (prepared?.brief ?? fallbackBrief) : fallbackBrief,
      context: {
        projectId: scope.projectId,
        goalId: scope.goalId,
        attentionRefs: scope.attentionRefs,
      },
    }
  }

  const workspaceAttentionRefs = snapshot.workspaceAttentions
    .filter(isUnnotifiedAttention)
    .map(recordId)
    .filter((id) => id !== 'unknown-attention')
    .map((attentionId) => workspaceAttentionReference(homeId, attentionId))
  if (workspaceAttentionRefs.length === 0) return prepared
  return {
    brief:
      prepared?.brief ??
      [
        'Unnotified Workspace Attention remains open.',
        'Re-read current state, diagnose the exact blocker, and tell the operator only the outcome or decision needed.',
        `Canonical Attention references: ${workspaceAttentionRefs.join(', ')}.`,
      ].join(' '),
    context: {
      attentionRefs: workspaceAttentionRefs,
    },
  }
}

function unnotifiedGoalAttentionScopes(snapshot: AssistantStateSnapshot) {
  const scopes: Array<{ projectId: string; goalId: string; attentionRefs: string[] }> = []
  for (const project of snapshot.projects) {
    if (!isRecord(project) || typeof project.projectId !== 'string') continue
    const projectId = project.projectId
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalId = nestedId(goal.goal, '')
      if (!goalId || !Array.isArray(goal.attentions)) continue
      const attentionRefs = goal.attentions
        .filter(isUnnotifiedAttention)
        .map(recordId)
        .filter((id) => id !== 'unknown-attention')
        .map((attentionId) => goalAttentionReference(projectId, goalId, attentionId))
      if (attentionRefs.length === 0) continue
      scopes.push({ projectId, goalId, attentionRefs })
    }
  }
  return scopes
}

async function reflectionPrompt(
  workspaceStore: AssistantWorkspaceStore,
  snapshot: AssistantStateSnapshot,
  previousSnapshot: AssistantStateSnapshot | null,
  trigger: readonly string[],
) {
  const workspace = await workspaceStore.readWorkspace()
  const history = [...workspace.events.values()]
    .filter(
      (event) =>
        event.attributes.status === 'handled' &&
        event.attributes.source === 'user' &&
        event.attributes.visibility === 'public',
    )
    .sort((left, right) => left.attributes.receivedAt.localeCompare(right.attributes.receivedAt))
    .slice(-8)
    .flatMap((event) => {
      return [
        `User: ${bounded(event.body, 1_000)}`,
        `Assistant: ${bounded(event.attributes.reply ?? '', 1_500)}`,
      ]
    })
  const delta = reflectionDelta(previousSnapshot, snapshot)
  const current = compactReflectionState(snapshot, delta.scopes)
  return [
    '# HOPI Background Reflection',
    '',
    'You are a disposable read-only thinking run for the workspace Assistant.',
    'Assess this semantic state change, not the whole workspace history.',
    'Decide from the trigger, changed facts, and relevant current state first.',
    'Do not mutate canonical files or source. You only have hopi_read_state and hopi_handoff_to_main.',
    'Use hopi_read_state only to revalidate a concrete candidate, scoped to the exact Project or Goal when known.',
    'Use local read-only shell access only for an exact diagnostic path already present in state. Never scan .hopi or search historical Runs speculatively.',
    'Call hopi_handoff_to_main at most once to prepare a concise internal brief only when the speaking Assistant should revalidate a useful action or user decision. The Coordinator publishes it only if this snapshot remains current. Otherwise finish silently.',
    'A useful internal brief states the changed fact, consequence, whether operator action is required, the recommended next action, and exact IDs. It remains free-form and must not contain an actions array.',
    'Do not draft polished operator-facing prose or narrate the whole workflow. The speaking Assistant will revalidate the brief and translate only the useful outcome and required action for the operator.',
    'When one Goal has unresolved Attention that speaking should manage, select its exact projectId and goalId. Do not copy Attention IDs: Coordinator owns the final canonical attentionRefs and augments them from this current snapshot. Keep one handoff Goal-scoped; the next Reflection can handle another Goal. Never rely on brief text for identity.',
    'Do not assume this snapshot is still current; the speaking Assistant will revalidate before acting.',
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
    ...(history.length ? ['## Recent Public Conversation', '', ...history, ''] : []),
    '## Relevant Current State',
    '',
    '```json',
    bounded(JSON.stringify(current, null, 2), 24_000),
    '```',
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

function reflectionTrigger(snapshot: AssistantStateSnapshot, settled: boolean) {
  const reasons: string[] = []
  for (const attention of snapshot.workspaceAttentions) {
    if (!isUnnotifiedAttention(attention)) continue
    reasons.push(`Unnotified workspace Attention ${recordId(attention)} is open.`)
  }
  for (const project of snapshot.projects) {
    if (!isRecord(project)) continue
    const projectId = stringValue(project.projectId, 'unknown-project')
    if (project.available === false) reasons.push(`Project ${projectId} is unavailable.`)
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalId = nestedId(goal.goal, 'unknown-goal')
      if (Array.isArray(goal.attentions)) {
        for (const attention of goal.attentions) {
          if (!isUnnotifiedAttention(attention)) continue
          reasons.push(
            `Goal ${goalId} has unnotified Attention ${recordId(attention)} in Project ${projectId}.`,
          )
        }
      }
      if (!Array.isArray(goal.works)) continue
      for (const work of goal.works) {
        if (!isRecord(work) || !isRecord(work.runtime) || work.runtime.stale !== true) continue
        reasons.push(
          `Work ${nestedId(work.attributes, 'unknown-work')} in ${projectId}/${goalId} has a stale running Attempt.`,
        )
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
  return reasons
}

interface ReflectionScope {
  projects: Set<string>
  goals: Map<string, Set<string>>
}

interface ReflectionFact {
  value: unknown
  projectId?: string
  goalId?: string
}

function reflectionDelta(previous: AssistantStateSnapshot | null, current: AssistantStateSnapshot) {
  const currentFacts = reflectionFacts(current)
  const scopes: ReflectionScope = { projects: new Set(), goals: new Map() }
  if (!previous) {
    for (const fact of currentFacts.values()) addFactScope(scopes, fact)
    return {
      lines: ['No previous assessed snapshot is available; assess the current immediate facts.'],
      scopes,
    }
  }

  const previousFacts = reflectionFacts(previous)
  const lines: string[] = []
  for (const key of new Set([...previousFacts.keys(), ...currentFacts.keys()])) {
    const before = previousFacts.get(key)
    const after = currentFacts.get(key)
    if (JSON.stringify(before?.value) === JSON.stringify(after?.value)) continue
    const fact = after ?? before
    if (fact) addFactScope(scopes, fact)
    const change = before === undefined ? 'Added' : after === undefined ? 'Removed' : 'Changed'
    const value = after !== undefined ? after.value : before?.value
    lines.push(`${change} ${key}: ${bounded(JSON.stringify(value) ?? 'undefined', 1_200)}`)
  }
  const visible = lines.slice(0, 60)
  if (lines.length > visible.length) {
    visible.push(`${lines.length - visible.length} additional changed facts omitted.`)
  }
  if (visible.length === 0) {
    visible.push('The semantic digest changed without a difference in the compact fact projection.')
  }
  return { lines: visible, scopes }
}

function reflectionFacts(snapshot: AssistantStateSnapshot) {
  const facts = new Map<string, ReflectionFact>()
  for (const attention of snapshot.workspaceAttentions) {
    const id = recordId(attention)
    facts.set(`workspace Attention ${id}`, {
      value: compactAttention(attention),
      ...scopeFromTarget(recordTarget(attention)),
    })
  }
  for (const project of snapshot.projects) {
    if (!isRecord(project)) continue
    const projectId = stringValue(project.projectId, 'unknown-project')
    facts.set(`Project ${projectId}`, {
      projectId,
      value: { available: project.available, releaseHead: project.releaseHead },
    })
    if (!Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal)) continue
      const goalId = nestedId(goal.goal, 'unknown-goal')
      const scope = { projectId, goalId }
      facts.set(`Goal ${projectId}/${goalId}`, {
        ...scope,
        value: isRecord(goal.goal)
          ? { attributes: goal.goal.attributes, path: goal.goal.path }
          : null,
      })
      if (Array.isArray(goal.works)) {
        for (const work of goal.works) {
          if (!isRecord(work)) continue
          const workId = nestedId(work.attributes, 'unknown-work')
          facts.set(`Work ${projectId}/${goalId}/${workId}`, {
            ...scope,
            value: {
              attributes: work.attributes,
              path: work.path,
              projection: compactProjection(work.projection),
              runtime: compactRuntime(work.runtime),
            },
          })
        }
      }
      if (Array.isArray(goal.attentions)) {
        for (const attention of goal.attentions) {
          facts.set(`Goal Attention ${projectId}/${goalId}/${recordId(attention)}`, {
            ...scope,
            value: compactAttention(attention),
          })
        }
      }
    }
  }
  return facts
}

function compactReflectionState(snapshot: AssistantStateSnapshot, scopes: ReflectionScope) {
  const allProjects = scopes.projects.size === 0
  const projects = snapshot.projects.flatMap((project) => {
    if (!isRecord(project)) return []
    const projectId = stringValue(project.projectId, 'unknown-project')
    if (!allProjects && !scopes.projects.has(projectId)) return []
    const selectedGoals = scopes.goals.get(projectId)
    const goals = Array.isArray(project.goals)
      ? project.goals.flatMap((goal) => {
          if (!isRecord(goal)) return []
          const goalId = nestedId(goal.goal, 'unknown-goal')
          if (selectedGoals?.size && !selectedGoals.has(goalId)) return []
          return [
            {
              goal: isRecord(goal.goal)
                ? { attributes: goal.goal.attributes, path: goal.goal.path }
                : goal.goal,
              works: Array.isArray(goal.works)
                ? goal.works.flatMap((work) =>
                    isRecord(work)
                      ? [
                          {
                            attributes: work.attributes,
                            path: work.path,
                            projection: compactProjection(work.projection),
                            runtime: compactRuntime(work.runtime),
                          },
                        ]
                      : [],
                  )
                : [],
              attentions: Array.isArray(goal.attentions)
                ? goal.attentions.map(compactAttention)
                : [],
            },
          ]
        })
      : []
    return [
      {
        projectId,
        available: project.available,
        releaseHead: project.releaseHead,
        goals,
      },
    ]
  })
  return {
    observedAt: snapshot.observedAt,
    stateDigest: snapshot.stateDigest,
    activeRuns: snapshot.activeRuns.filter(
      (run) => allProjects || scopes.projects.has(run.projectId),
    ),
    workspaceAttentions: snapshot.workspaceAttentions.map(compactAttention),
    unresolvedAttentions: collectUnresolvedAttentions(snapshot),
    projects,
  }
}

function collectUnresolvedAttentions(snapshot: AssistantStateSnapshot) {
  const unresolved: unknown[] = snapshot.workspaceAttentions
    .filter(isUnresolvedAttention)
    .map((attention) => ({ scope: 'workspace', attention: compactAttention(attention) }))
  for (const project of snapshot.projects) {
    if (!isRecord(project) || !Array.isArray(project.goals)) continue
    const projectId = stringValue(project.projectId, 'unknown-project')
    for (const goal of project.goals) {
      if (!isRecord(goal) || !Array.isArray(goal.attentions)) continue
      const goalId = nestedId(goal.goal, 'unknown-goal')
      for (const attention of goal.attentions) {
        if (!isUnresolvedAttention(attention)) continue
        unresolved.push({
          scope: 'goal',
          projectId,
          goalId,
          attention: compactAttention(attention),
        })
      }
    }
  }
  return unresolved
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
    latestAttempt: value.latestAttempt,
    lastActivityAt: value.lastActivityAt,
    stale: value.stale,
    paths: value.paths,
  }
}

function compactAttention(value: unknown) {
  if (!isRecord(value)) return value
  const attributes = isRecord(value.attributes)
    ? value.attributes
    : Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'body' && key !== 'path'))
  return {
    attributes,
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(typeof value.body === 'string' ? { body: bounded(value.body, 2_000) } : {}),
  }
}

function addFactScope(scopes: ReflectionScope, fact: ReflectionFact) {
  if (!fact.projectId) return
  scopes.projects.add(fact.projectId)
  if (!fact.goalId) return
  const goals = scopes.goals.get(fact.projectId) ?? new Set<string>()
  goals.add(fact.goalId)
  scopes.goals.set(fact.projectId, goals)
}

function scopeFromTarget(target: unknown) {
  if (typeof target !== 'string') return {}
  const match = target.match(/^project:([^/]+)(?:\/goal:([^/]+))?/)
  return match ? { projectId: match[1], ...(match[2] ? { goalId: match[2] } : {}) } : {}
}

function recordId(value: unknown) {
  if (!isRecord(value)) return 'unknown-attention'
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return stringValue(attributes.id, 'unknown-attention')
}

function recordTarget(value: unknown) {
  if (!isRecord(value)) return null
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return attributes.target
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
  if (snapshot.workspaceAttentions.some(isUnnotifiedAttention)) return true
  return snapshot.projects.some((project) => {
    if (!isRecord(project)) return false
    if (project.available === false) return true
    if (!Array.isArray(project.goals)) return false
    return project.goals.some((goal) => {
      if (!isRecord(goal)) return false
      if (Array.isArray(goal.attentions) && goal.attentions.some(isUnnotifiedAttention)) return true
      if (!Array.isArray(goal.works)) return false
      return goal.works.some(
        (work) => isRecord(work) && isRecord(work.runtime) && work.runtime.stale === true,
      )
    })
  })
}

function isUnnotifiedAttention(value: unknown) {
  if (!isRecord(value)) return false
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return attributes.resolvedAt === null && attributes.notifiedAt === null
}

function isUnresolvedAttention(value: unknown) {
  if (!isRecord(value)) return false
  const attributes = isRecord(value.attributes) ? value.attributes : value
  return attributes.resolvedAt === null
}
