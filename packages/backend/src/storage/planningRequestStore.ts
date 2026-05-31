import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { withFileLock } from './lock'
import { createProjectPaths } from './paths'

const PLANNING_REQUEST_STATUSES = ['open', 'resolved'] as const
export const PLANNING_REQUEST_UPDATE_TARGETS = ['goal.md', 'design.md', 'todo.yml'] as const

export type GoalPlanningRequestStatus = (typeof PLANNING_REQUEST_STATUSES)[number]
export type GoalPlanningRequestUpdateTarget = (typeof PLANNING_REQUEST_UPDATE_TARGETS)[number]

export interface GoalPlanningRequest {
  requestKey: string
  groupKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  taskRef: string
  decisionRefs: string[]
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
      groupKey?: string
      title: string
      description: string
      acceptanceCriteria: string[]
      taskRef: string
      decisionRefs?: string[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  mergeRequestMetadata(
    goalKey: string,
    requestKey: string,
    input: {
      groupKey?: string
      decisionRefs?: string[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  updateRequest(
    goalKey: string,
    requestKey: string,
    input: {
      groupKey?: string
      title: string
      description: string
      acceptanceCriteria: string[]
      decisionRefs?: string[]
      requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    },
  ): Promise<GoalPlanningRequest>
  resolveRequest(
    goalKey: string,
    requestKey: string,
    input: { resolution: string },
  ): Promise<GoalPlanningRequest>
}

const GoalPlanningRequestSchema = z.object({
  requestKey: z.string().min(1),
  groupKey: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  taskRef: z.string().min(1),
  decisionRefs: z.array(z.string().min(1)).default([]),
  requestedUpdates: z.array(z.enum(PLANNING_REQUEST_UPDATE_TARGETS)).default([]),
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

        const request: GoalPlanningRequest = {
          requestKey,
          groupKey: input.groupKey,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          taskRef: input.taskRef,
          decisionRefs: mergeUniqueValues([], input.decisionRefs ?? []),
          requestedUpdates: mergeUniqueValues([], input.requestedUpdates ?? []),
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
        const nextRequestedUpdates = mergeUniqueValues(
          request.requestedUpdates,
          input.requestedUpdates ?? [],
        )
        const nextGroupKey = resolveGroupKey(request.groupKey, input.groupKey)
        const changed =
          nextGroupKey !== request.groupKey ||
          nextDecisionRefs.length !== request.decisionRefs.length ||
          nextRequestedUpdates.length !== request.requestedUpdates.length
        if (changed) {
          request.groupKey = nextGroupKey
          request.decisionRefs = nextDecisionRefs
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
        const nextRequestedUpdates = mergeUniqueValues(
          request.requestedUpdates,
          input.requestedUpdates ?? [],
        )
        const nextGroupKey = resolveGroupKey(request.groupKey, input.groupKey)
        const changed =
          nextGroupKey !== request.groupKey ||
          request.title !== input.title ||
          request.description !== input.description ||
          !sameStringArray(request.acceptanceCriteria, input.acceptanceCriteria) ||
          nextDecisionRefs.length !== request.decisionRefs.length ||
          nextRequestedUpdates.length !== request.requestedUpdates.length
        if (changed) {
          request.groupKey = nextGroupKey
          request.title = input.title
          request.description = input.description
          request.acceptanceCriteria = [...input.acceptanceCriteria]
          request.decisionRefs = nextDecisionRefs
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

function sameStringArray(left: string[], right: string[]) {
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
