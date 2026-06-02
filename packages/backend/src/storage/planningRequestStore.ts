import { mkdir, rename } from 'node:fs/promises'
import { dirname, posix as pathPosix } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { withFileLock } from './lock'
import { createProjectPaths } from './paths'

const PLANNING_REQUEST_STATUSES = ['open', 'resolved'] as const
export const PLANNING_REQUEST_UPDATE_TARGETS = ['goal.md', 'design.md', 'todo.yml'] as const
const RESERVED_GOAL_UPDATE_TARGETS = new Set([
  'decisions.yml',
  'planning-requests.yml',
  'events.jsonl',
  'write-trace.jsonl',
])

export type GoalPlanningRequestStatus = (typeof PLANNING_REQUEST_STATUSES)[number]
export type GoalPlanningRequestUpdateTarget = string

export interface GoalPlanningRequestAnswer {
  summary: string
  prompt?: string
  matchHints?: string[]
  answer: string
}

export interface GoalPlanningRequest {
  requestKey: string
  workflowKey?: string
  workflowTaskKey?: string
  workflowSharedDecisionRefs: string[]
  workflowSharedAnswers: GoalPlanningRequestAnswer[]
  blockedByWorkflowKeys: string[]
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  taskRef: string
  decisionRefs: string[]
  answers: GoalPlanningRequestAnswer[]
  requestedUpdates: GoalPlanningRequestUpdateTarget[]
  status: GoalPlanningRequestStatus
  createdAt: string
  resolvedAt?: string
  resolution?: string
}

export interface GoalPlanningRequestSet {
  version: 1
  goalKey: string
  requests: GoalPlanningRequest[]
}

export interface PlanningRequestStore {
  readGoalPlanningRequests(goalKey: string): Promise<GoalPlanningRequestSet>
  ensureGoalPlanningRequests(goalKey: string): Promise<GoalPlanningRequestSet>
  createRequest(
    goalKey: string,
    input: {
      requestKey?: string
      workflowKey?: string
      workflowTaskKey?: string
      workflowSharedDecisionRefs?: string[]
      workflowSharedAnswers?: GoalPlanningRequestAnswer[]
      blockedByWorkflowKeys?: string[]
      groupKey?: string
      groupTaskKey?: string
      title: string
      description: string
      acceptanceCriteria: string[]
      taskRef: string
      decisionRefs?: string[]
      answers?: GoalPlanningRequestAnswer[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  mergeRequestMetadata(
    goalKey: string,
    requestKey: string,
    input: {
      workflowKey?: string
      workflowTaskKey?: string
      workflowSharedDecisionRefs?: string[]
      workflowSharedAnswers?: GoalPlanningRequestAnswer[]
      blockedByWorkflowKeys?: string[]
      groupKey?: string
      groupTaskKey?: string
      decisionRefs?: string[]
      answers?: GoalPlanningRequestAnswer[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  updateRequest(
    goalKey: string,
    requestKey: string,
    input: {
      workflowKey?: string
      workflowTaskKey?: string
      workflowSharedDecisionRefs?: string[]
      workflowSharedAnswers?: GoalPlanningRequestAnswer[]
      blockedByWorkflowKeys?: string[]
      groupKey?: string
      groupTaskKey?: string
      title: string
      description: string
      acceptanceCriteria: string[]
      decisionRefs?: string[]
      answers?: GoalPlanningRequestAnswer[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  resolveRequest(
    goalKey: string,
    requestKey: string,
    input: { resolution: string },
  ): Promise<GoalPlanningRequest>
  syncWorkflowSharedContext(
    goalKey: string,
    workflowKey: string,
    input: {
      workflowSharedDecisionRefs?: string[]
      workflowSharedAnswers?: GoalPlanningRequestAnswer[]
    },
  ): Promise<GoalPlanningRequest[]>
}

export function normalizeGoalPlanningRequestUpdateTarget(
  value: string,
): GoalPlanningRequestUpdateTarget {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Invalid requested update target: path is required')
  }

  const slashNormalized = trimmed.replaceAll('\\', '/')
  if (slashNormalized.startsWith('/')) {
    throw new Error('Invalid requested update target: absolute paths are not allowed')
  }

  if (slashNormalized.split('/').some((segment) => segment === '..')) {
    throw new Error('Invalid requested update target: parent traversal is not allowed')
  }

  const normalized = pathPosix.normalize(slashNormalized)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Invalid requested update target: path must stay within Goal docs')
  }

  if (RESERVED_GOAL_UPDATE_TARGETS.has(normalized)) {
    throw new Error(`Invalid requested update target: ${normalized} is a reserved Goal state file`)
  }

  return normalized
}

export const goalPlanningRequestUpdateTargetSchema = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    try {
      return normalizeGoalPlanningRequestUpdateTarget(value)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : 'Invalid requested update target',
      })
      return z.NEVER
    }
  })

export const goalPlanningRequestUpdateTargetArraySchema = z
  .array(goalPlanningRequestUpdateTargetSchema)
  .default([])
  .transform((values) => mergeUniqueValues([], values))

export const goalPlanningRequestAnswerSchema = z.object({
  summary: z.string().min(1),
  prompt: z.string().min(1).optional(),
  matchHints: z
    .array(z.string().min(1))
    .optional()
    .transform((values) => normalizeGoalPlanningRequestMatchHints(values)),
  answer: z.string().min(1),
})

export const goalPlanningRequestAnswerArraySchema = z
  .array(goalPlanningRequestAnswerSchema)
  .default([])
  .transform((values) => mergePlanningRequestAnswers([], values))

export const goalPlanningRequestBlockedByWorkflowKeysSchema = z
  .array(z.string().min(1))
  .default([])
  .transform((values) => mergeUniqueValues([], values))

const GoalPlanningRequestSchema = z.object({
  requestKey: z.string().min(1),
  workflowKey: z.string().min(1).optional(),
  workflowTaskKey: z.string().min(1).optional(),
  workflowSharedDecisionRefs: z.array(z.string().min(1)).default([]),
  workflowSharedAnswers: goalPlanningRequestAnswerArraySchema,
  blockedByWorkflowKeys: goalPlanningRequestBlockedByWorkflowKeysSchema,
  groupKey: z.string().min(1).optional(),
  groupTaskKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  taskRef: z.string().min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  answers: goalPlanningRequestAnswerArraySchema,
  requestedUpdates: goalPlanningRequestUpdateTargetArraySchema,
  status: z.enum(PLANNING_REQUEST_STATUSES),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
  resolution: z.string().min(1).optional(),
})

const GoalPlanningRequestSetSchema = z.object({
  version: z.literal(1).default(1),
  goalKey: z.string().min(1),
  requests: z.array(GoalPlanningRequestSchema).default([]),
})

export function createPlanningRequestStore(rootDir = process.cwd()): PlanningRequestStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readGoalPlanningRequests(goalKey) {
      return readPlanningRequestSet(paths.planningRequestsPath(goalKey), goalKey)
    },
    async ensureGoalPlanningRequests(goalKey) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
      const file = Bun.file(planningRequestsPath)
      if (!(await file.exists())) {
        await writePlanningRequestSet(planningRequestsPath, current)
      }
      return current
    },
    async createRequest(goalKey, input) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const lockPath = `${planningRequestsPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
        const requestKey = input.requestKey ?? nextPlanningRequestKey(current.requests)
        if (current.requests.some((request) => request.requestKey === requestKey)) {
          throw new Error(`Planning request already exists: ${requestKey}`)
        }
        ensureGroupTaskKeyCoherence(input.groupKey, input.groupTaskKey)
        ensureWorkflowTaskKeyCoherence(input.workflowKey, input.workflowTaskKey)
        ensureWorkflowSharedContextCoherence(
          input.workflowKey,
          input.workflowSharedDecisionRefs,
          input.workflowSharedAnswers,
        )
        ensureBlockedByWorkflowKeysCoherence(input.workflowKey, input.blockedByWorkflowKeys)
        ensureUniqueOpenGroupTaskKey(
          current.requests,
          requestKey,
          input.groupKey,
          input.groupTaskKey,
        )
        ensureUniqueOpenWorkflowTaskKey(
          current.requests,
          requestKey,
          input.workflowKey,
          input.workflowTaskKey,
        )
        const requestedUpdates = normalizeGoalPlanningRequestUpdateTargets(input.requestedUpdates)
        const answers = normalizeGoalPlanningRequestAnswers(input.answers)
        const workflowSharedDecisionRefs = normalizeWorkflowSharedDecisionRefs(
          input.workflowSharedDecisionRefs,
        )
        const workflowSharedAnswers = normalizeGoalPlanningRequestAnswers(
          input.workflowSharedAnswers,
        )
        const blockedByWorkflowKeys = normalizeBlockedByWorkflowKeys(input.blockedByWorkflowKeys)

        const request: GoalPlanningRequest = {
          requestKey,
          workflowKey: input.workflowKey,
          workflowTaskKey: input.workflowTaskKey,
          workflowSharedDecisionRefs,
          workflowSharedAnswers,
          blockedByWorkflowKeys,
          groupKey: input.groupKey,
          groupTaskKey: input.groupTaskKey,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          taskRef: input.taskRef,
          decisionRefs: mergeUniqueValues([], input.decisionRefs ?? []),
          answers,
          requestedUpdates,
          status: 'open',
          createdAt: new Date().toISOString(),
        }
        current.requests.push(request)
        await writePlanningRequestSet(planningRequestsPath, current)
        return request
      })
    },
    async mergeRequestMetadata(goalKey, requestKey, input) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const lockPath = `${planningRequestsPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
        const request = current.requests.find((item) => item.requestKey === requestKey)
        if (!request) {
          throw new Error(`Planning request not found: ${requestKey}`)
        }

        const nextDecisionRefs = mergeUniqueValues(request.decisionRefs, input.decisionRefs ?? [])
        const nextAnswers = mergePlanningRequestAnswers(request.answers, input.answers ?? [])
        const nextRequestedUpdates = mergeUniqueValues(
          request.requestedUpdates,
          normalizeGoalPlanningRequestUpdateTargets(input.requestedUpdates),
        )
        const nextBlockedByWorkflowKeys = resolveBlockedByWorkflowKeys(
          request.blockedByWorkflowKeys,
          input.blockedByWorkflowKeys,
        )
        const nextWorkflowSharedDecisionRefs = resolveWorkflowSharedDecisionRefs(
          request.workflowSharedDecisionRefs,
          input.workflowSharedDecisionRefs,
        )
        const nextWorkflowSharedAnswers = resolveWorkflowSharedAnswers(
          request.workflowSharedAnswers,
          input.workflowSharedAnswers,
        )
        const nextWorkflowKey = resolveWorkflowKey(request.workflowKey, input.workflowKey)
        const nextWorkflowTaskKey = resolveWorkflowTaskKey(
          request.workflowTaskKey,
          input.workflowTaskKey,
        )
        const nextGroupKey = resolveGroupKey(request.groupKey, input.groupKey)
        const nextGroupTaskKey = resolveGroupTaskKey(request.groupTaskKey, input.groupTaskKey)
        ensureWorkflowSharedContextCoherence(
          nextWorkflowKey,
          nextWorkflowSharedDecisionRefs,
          nextWorkflowSharedAnswers,
        )
        ensureBlockedByWorkflowKeysCoherence(nextWorkflowKey, nextBlockedByWorkflowKeys)
        ensureWorkflowTaskKeyCoherence(nextWorkflowKey, nextWorkflowTaskKey)
        ensureGroupTaskKeyCoherence(nextGroupKey, nextGroupTaskKey)
        ensureUniqueOpenWorkflowTaskKey(
          current.requests,
          request.requestKey,
          nextWorkflowKey,
          nextWorkflowTaskKey,
        )
        ensureUniqueOpenGroupTaskKey(
          current.requests,
          request.requestKey,
          nextGroupKey,
          nextGroupTaskKey,
        )
        const changed =
          nextWorkflowKey !== request.workflowKey ||
          nextWorkflowTaskKey !== request.workflowTaskKey ||
          !sameStringArray(request.workflowSharedDecisionRefs, nextWorkflowSharedDecisionRefs) ||
          !samePlanningRequestAnswerArray(
            request.workflowSharedAnswers,
            nextWorkflowSharedAnswers,
          ) ||
          !sameStringArray(request.blockedByWorkflowKeys, nextBlockedByWorkflowKeys) ||
          nextGroupKey !== request.groupKey ||
          nextGroupTaskKey !== request.groupTaskKey ||
          nextDecisionRefs.length !== request.decisionRefs.length ||
          !samePlanningRequestAnswerArray(request.answers, nextAnswers) ||
          nextRequestedUpdates.length !== request.requestedUpdates.length
        if (changed) {
          request.workflowKey = nextWorkflowKey
          request.workflowTaskKey = nextWorkflowTaskKey
          request.workflowSharedDecisionRefs = nextWorkflowSharedDecisionRefs
          request.workflowSharedAnswers = nextWorkflowSharedAnswers
          request.blockedByWorkflowKeys = nextBlockedByWorkflowKeys
          request.groupKey = nextGroupKey
          request.groupTaskKey = nextGroupTaskKey
          request.decisionRefs = nextDecisionRefs
          request.answers = nextAnswers
          request.requestedUpdates = nextRequestedUpdates
          await writePlanningRequestSet(planningRequestsPath, current)
        }
        return request
      })
    },
    async updateRequest(goalKey, requestKey, input) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const lockPath = `${planningRequestsPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
        const request = current.requests.find((item) => item.requestKey === requestKey)
        if (!request) {
          throw new Error(`Planning request not found: ${requestKey}`)
        }

        const nextDecisionRefs = mergeUniqueValues(request.decisionRefs, input.decisionRefs ?? [])
        const nextAnswers = mergePlanningRequestAnswers(request.answers, input.answers ?? [])
        const nextRequestedUpdates = mergeUniqueValues(
          request.requestedUpdates,
          normalizeGoalPlanningRequestUpdateTargets(input.requestedUpdates),
        )
        const nextBlockedByWorkflowKeys = resolveBlockedByWorkflowKeys(
          request.blockedByWorkflowKeys,
          input.blockedByWorkflowKeys,
        )
        const nextWorkflowSharedDecisionRefs = resolveWorkflowSharedDecisionRefs(
          request.workflowSharedDecisionRefs,
          input.workflowSharedDecisionRefs,
        )
        const nextWorkflowSharedAnswers = resolveWorkflowSharedAnswers(
          request.workflowSharedAnswers,
          input.workflowSharedAnswers,
        )
        const nextWorkflowKey = resolveWorkflowKey(request.workflowKey, input.workflowKey)
        const nextWorkflowTaskKey = resolveWorkflowTaskKey(
          request.workflowTaskKey,
          input.workflowTaskKey,
        )
        const nextGroupKey = resolveGroupKey(request.groupKey, input.groupKey)
        const nextGroupTaskKey = resolveGroupTaskKey(request.groupTaskKey, input.groupTaskKey)
        ensureWorkflowSharedContextCoherence(
          nextWorkflowKey,
          nextWorkflowSharedDecisionRefs,
          nextWorkflowSharedAnswers,
        )
        ensureBlockedByWorkflowKeysCoherence(nextWorkflowKey, nextBlockedByWorkflowKeys)
        ensureWorkflowTaskKeyCoherence(nextWorkflowKey, nextWorkflowTaskKey)
        ensureGroupTaskKeyCoherence(nextGroupKey, nextGroupTaskKey)
        ensureUniqueOpenWorkflowTaskKey(
          current.requests,
          request.requestKey,
          nextWorkflowKey,
          nextWorkflowTaskKey,
        )
        ensureUniqueOpenGroupTaskKey(
          current.requests,
          request.requestKey,
          nextGroupKey,
          nextGroupTaskKey,
        )
        const changed =
          nextWorkflowKey !== request.workflowKey ||
          nextWorkflowTaskKey !== request.workflowTaskKey ||
          !sameStringArray(request.workflowSharedDecisionRefs, nextWorkflowSharedDecisionRefs) ||
          !samePlanningRequestAnswerArray(
            request.workflowSharedAnswers,
            nextWorkflowSharedAnswers,
          ) ||
          !sameStringArray(request.blockedByWorkflowKeys, nextBlockedByWorkflowKeys) ||
          nextGroupKey !== request.groupKey ||
          nextGroupTaskKey !== request.groupTaskKey ||
          request.title !== input.title ||
          request.description !== input.description ||
          !sameStringArray(request.acceptanceCriteria, input.acceptanceCriteria) ||
          nextDecisionRefs.length !== request.decisionRefs.length ||
          !samePlanningRequestAnswerArray(request.answers, nextAnswers) ||
          nextRequestedUpdates.length !== request.requestedUpdates.length
        if (changed) {
          request.workflowKey = nextWorkflowKey
          request.workflowTaskKey = nextWorkflowTaskKey
          request.workflowSharedDecisionRefs = nextWorkflowSharedDecisionRefs
          request.workflowSharedAnswers = nextWorkflowSharedAnswers
          request.blockedByWorkflowKeys = nextBlockedByWorkflowKeys
          request.groupKey = nextGroupKey
          request.groupTaskKey = nextGroupTaskKey
          request.title = input.title
          request.description = input.description
          request.acceptanceCriteria = [...input.acceptanceCriteria]
          request.decisionRefs = nextDecisionRefs
          request.answers = nextAnswers
          request.requestedUpdates = nextRequestedUpdates
          await writePlanningRequestSet(planningRequestsPath, current)
        }
        return request
      })
    },
    async resolveRequest(goalKey, requestKey, input) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const lockPath = `${planningRequestsPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
        const request = current.requests.find((item) => item.requestKey === requestKey)
        if (!request) {
          throw new Error(`Planning request not found: ${requestKey}`)
        }

        request.status = 'resolved'
        request.resolution = input.resolution
        request.resolvedAt = new Date().toISOString()
        await writePlanningRequestSet(planningRequestsPath, current)
        return request
      })
    },
    async syncWorkflowSharedContext(goalKey, workflowKey, input) {
      const planningRequestsPath = paths.planningRequestsPath(goalKey)
      const lockPath = `${planningRequestsPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readPlanningRequestSet(planningRequestsPath, goalKey)
        const nextWorkflowSharedDecisionRefs = normalizeWorkflowSharedDecisionRefs(
          input.workflowSharedDecisionRefs,
        )
        const nextWorkflowSharedAnswers = normalizeGoalPlanningRequestAnswers(
          input.workflowSharedAnswers,
        )
        let changed = false
        const syncedRequests: GoalPlanningRequest[] = []

        for (const request of current.requests) {
          if (request.status !== 'open' || request.workflowKey !== workflowKey) {
            continue
          }

          const localDecisionRefs = request.decisionRefs.filter(
            (decisionRef) => !request.workflowSharedDecisionRefs.includes(decisionRef),
          )
          const localAnswers = removePlanningRequestAnswers(
            request.answers,
            request.workflowSharedAnswers,
          )
          const nextDecisionRefs = mergeUniqueValues(
            nextWorkflowSharedDecisionRefs,
            localDecisionRefs,
          )
          const nextAnswers = mergePlanningRequestAnswers(nextWorkflowSharedAnswers, localAnswers)

          if (
            !sameStringArray(request.workflowSharedDecisionRefs, nextWorkflowSharedDecisionRefs) ||
            !samePlanningRequestAnswerArray(
              request.workflowSharedAnswers,
              nextWorkflowSharedAnswers,
            ) ||
            !sameStringArray(request.decisionRefs, nextDecisionRefs) ||
            !samePlanningRequestAnswerArray(request.answers, nextAnswers)
          ) {
            request.workflowSharedDecisionRefs = nextWorkflowSharedDecisionRefs
            request.workflowSharedAnswers = nextWorkflowSharedAnswers
            request.decisionRefs = nextDecisionRefs
            request.answers = nextAnswers
            changed = true
          }

          syncedRequests.push(request)
        }

        if (changed) {
          await writePlanningRequestSet(planningRequestsPath, current)
        }

        return syncedRequests
      })
    },
  }
}

async function readPlanningRequestSet(
  planningRequestsPath: string,
  goalKey: string,
): Promise<GoalPlanningRequestSet> {
  const file = Bun.file(planningRequestsPath)
  if (!(await file.exists())) {
    return emptyPlanningRequestSet(goalKey)
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return emptyPlanningRequestSet(goalKey)
  }

  const parsed = GoalPlanningRequestSetSchema.safeParse(parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid planning-requests.yml format: ${issues}`)
  }

  return parsed.data
}

function emptyPlanningRequestSet(goalKey: string): GoalPlanningRequestSet {
  return {
    version: 1,
    goalKey,
    requests: [],
  }
}

async function writePlanningRequestSet(planningRequestsPath: string, set: GoalPlanningRequestSet) {
  await mkdir(dirname(planningRequestsPath), { recursive: true })
  const tmpPath = `${planningRequestsPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, stringify(set, { indent: 2 }))
  await rename(tmpPath, planningRequestsPath)
}

function nextPlanningRequestKey(requests: GoalPlanningRequest[]) {
  const nextNumber =
    requests.reduce((max, request) => {
      const match = /^PR-(\d+)$/.exec(request.requestKey)
      if (!match) {
        return max
      }
      return Math.max(max, Number.parseInt(match[1] ?? '0', 10))
    }, 0) + 1

  return `PR-${nextNumber}`
}

function mergeUniqueValues<T extends string>(existing: T[], incoming: T[]) {
  const merged = [...existing]
  for (const value of incoming) {
    if (!merged.includes(value)) {
      merged.push(value)
    }
  }
  return merged
}

function normalizeGoalPlanningRequestUpdateTargets(
  values: GoalPlanningRequestUpdateTarget[] | undefined,
) {
  return mergeUniqueValues([], (values ?? []).map(normalizeGoalPlanningRequestUpdateTarget))
}

function normalizeGoalPlanningRequestAnswers(values: GoalPlanningRequestAnswer[] | undefined) {
  return mergePlanningRequestAnswers([], values ?? [])
}

function normalizeGoalPlanningRequestMatchHints(values: string[] | undefined) {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized.length > 0 ? normalized : undefined
}

function normalizeWorkflowSharedDecisionRefs(values: string[] | undefined) {
  return mergeUniqueValues([], values ?? [])
}

function normalizeBlockedByWorkflowKeys(values: string[] | undefined) {
  return mergeUniqueValues([], values ?? [])
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => right[index] === value)
}

function mergePlanningRequestAnswers(
  existing: GoalPlanningRequestAnswer[],
  incoming: GoalPlanningRequestAnswer[],
) {
  const merged = [...existing]
  const seen = new Map<string, number>(
    existing.map((value, index) => [`${value.summary}\u0000${value.answer}`, index]),
  )
  for (const value of incoming) {
    const key = `${value.summary}\u0000${value.answer}`
    const existingIndex = seen.get(key)
    if (existingIndex === undefined) {
      const nextPrompt = value.prompt?.trim() || undefined
      const nextMatchHints = normalizeGoalPlanningRequestMatchHints(value.matchHints)
      merged.push({
        ...value,
        ...(nextPrompt ? { prompt: nextPrompt } : {}),
        ...(nextMatchHints ? { matchHints: nextMatchHints } : {}),
      })
      seen.set(key, merged.length - 1)
      continue
    }

    const current = merged[existingIndex]
    if (!current) {
      continue
    }
    const nextPrompt = current.prompt?.trim() || value.prompt?.trim() || undefined
    const nextMatchHints = mergePlanningRequestAnswerMatchHints(
      current.matchHints,
      value.matchHints,
    )
    if (
      nextPrompt !== current.prompt ||
      !sameOptionalStringArray(current.matchHints, nextMatchHints)
    ) {
      merged[existingIndex] = {
        ...current,
        ...(nextPrompt ? { prompt: nextPrompt } : {}),
        ...(nextMatchHints ? { matchHints: nextMatchHints } : {}),
      }
    }
  }
  return merged
}

function samePlanningRequestAnswerArray(
  left: GoalPlanningRequestAnswer[],
  right: GoalPlanningRequestAnswer[],
) {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        right[index]?.summary === value.summary &&
        right[index]?.prompt === value.prompt &&
        sameOptionalStringArray(right[index]?.matchHints, value.matchHints) &&
        right[index]?.answer === value.answer,
    )
  )
}

function mergePlanningRequestAnswerMatchHints(
  existing: string[] | undefined,
  incoming: string[] | undefined,
) {
  if (!incoming || incoming.length === 0) {
    return existing
  }

  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map((value) => value.trim().toLowerCase().replace(/\s+/g, ' ')))
  for (const value of incoming) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(trimmed)
  }

  return normalizeGoalPlanningRequestMatchHints(merged)
}

function sameOptionalStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.length === right.length && left.every((value, index) => right[index] === value)
}

function resolveGroupKey(existing: string | undefined, incoming: string | undefined) {
  if (!existing) {
    return incoming
  }
  if (!incoming || incoming === existing) {
    return existing
  }
  throw new Error(`Planning request group mismatch: ${existing} != ${incoming}`)
}

function resolveWorkflowKey(existing: string | undefined, incoming: string | undefined) {
  if (!existing) {
    return incoming
  }
  if (!incoming || incoming === existing) {
    return existing
  }
  throw new Error(`Planning request workflow mismatch: ${existing} != ${incoming}`)
}

function resolveWorkflowTaskKey(existing: string | undefined, incoming: string | undefined) {
  if (!existing) {
    return incoming
  }
  if (!incoming || incoming === existing) {
    return existing
  }
  throw new Error(`Planning request workflow task mismatch: ${existing} != ${incoming}`)
}

function resolveWorkflowSharedDecisionRefs(existing: string[], incoming: string[] | undefined) {
  if (incoming === undefined) {
    return existing
  }
  return normalizeWorkflowSharedDecisionRefs(incoming)
}

function resolveWorkflowSharedAnswers(
  existing: GoalPlanningRequestAnswer[],
  incoming: GoalPlanningRequestAnswer[] | undefined,
) {
  if (incoming === undefined) {
    return existing
  }
  return normalizeGoalPlanningRequestAnswers(incoming)
}

function resolveBlockedByWorkflowKeys(existing: string[], incoming: string[] | undefined) {
  if (incoming === undefined) {
    return existing
  }
  return normalizeBlockedByWorkflowKeys(incoming)
}

function resolveGroupTaskKey(existing: string | undefined, incoming: string | undefined) {
  if (!existing) {
    return incoming
  }
  if (!incoming || incoming === existing) {
    return existing
  }
  throw new Error(`Grouped planning request key conflict: ${existing} != ${incoming}`)
}

function ensureGroupTaskKeyCoherence(
  groupKey: string | undefined,
  groupTaskKey: string | undefined,
) {
  if (groupTaskKey && !groupKey) {
    throw new Error('Grouped planning request key requires a planning group key')
  }
}

function ensureWorkflowTaskKeyCoherence(
  workflowKey: string | undefined,
  workflowTaskKey: string | undefined,
) {
  if (workflowTaskKey && !workflowKey) {
    throw new Error('Planning request workflow task key requires a workflow key')
  }
}

function ensureWorkflowSharedContextCoherence(
  workflowKey: string | undefined,
  workflowSharedDecisionRefs: string[] | undefined,
  workflowSharedAnswers: GoalPlanningRequestAnswer[] | undefined,
) {
  if (
    ((workflowSharedDecisionRefs?.length ?? 0) > 0 || (workflowSharedAnswers?.length ?? 0) > 0) &&
    !workflowKey
  ) {
    throw new Error('Planning request workflow shared context requires a workflow key')
  }
}

function ensureBlockedByWorkflowKeysCoherence(
  workflowKey: string | undefined,
  blockedByWorkflowKeys: string[] | undefined,
) {
  if ((blockedByWorkflowKeys?.length ?? 0) > 0 && !workflowKey) {
    throw new Error('Planning request workflow dependency keys require a workflow key')
  }
}

function ensureUniqueOpenWorkflowTaskKey(
  requests: GoalPlanningRequest[],
  currentRequestKey: string,
  workflowKey: string | undefined,
  workflowTaskKey: string | undefined,
) {
  if (!workflowKey || !workflowTaskKey) {
    return
  }

  const conflict = requests.find(
    (request) =>
      request.requestKey !== currentRequestKey &&
      request.status === 'open' &&
      request.workflowKey === workflowKey &&
      request.workflowTaskKey === workflowTaskKey,
  )
  if (conflict) {
    throw new Error(
      `Planning workflow task key conflict: ${workflowKey}/${workflowTaskKey} is already owned by ${conflict.requestKey}`,
    )
  }
}

function ensureUniqueOpenGroupTaskKey(
  requests: GoalPlanningRequest[],
  currentRequestKey: string,
  groupKey: string | undefined,
  groupTaskKey: string | undefined,
) {
  if (!groupKey || !groupTaskKey) {
    return
  }

  const conflict = requests.find(
    (request) =>
      request.requestKey !== currentRequestKey &&
      request.status === 'open' &&
      request.groupKey === groupKey &&
      request.groupTaskKey === groupTaskKey,
  )
  if (conflict) {
    throw new Error(
      `Grouped planning request key conflict: ${groupKey}/${groupTaskKey} is already owned by ${conflict.requestKey}`,
    )
  }
}

function removePlanningRequestAnswers(
  values: GoalPlanningRequestAnswer[],
  removals: GoalPlanningRequestAnswer[],
) {
  const removalKeys = new Set(removals.map((value) => `${value.summary}\u0000${value.answer}`))
  return values.filter((value) => !removalKeys.has(`${value.summary}\u0000${value.answer}`))
}
