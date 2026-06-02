import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { withFileLock } from './lock'
import { createProjectPaths } from './paths'

const DECISION_STATUSES = ['open', 'resolved'] as const

export type GoalDecisionStatus = (typeof DECISION_STATUSES)[number]

export interface GoalDecision {
  decisionKey: string
  summary: string
  prompt?: string
  status: GoalDecisionStatus
  taskRef?: string
  answer?: string
  createdAt: string
  resolvedAt?: string
}

export interface GoalDecisionSet {
  version: 1
  goalKey: string
  decisions: GoalDecision[]
}

export interface DecisionStore {
  readGoalDecisions(goalKey: string): Promise<GoalDecisionSet>
  ensureGoalDecisions(goalKey: string): Promise<GoalDecisionSet>
  createDecision(
    goalKey: string,
    input: { decisionKey?: string; summary: string; prompt?: string; taskRef?: string },
  ): Promise<GoalDecision>
  enrichDecision(
    goalKey: string,
    decisionKey: string,
    input: { prompt?: string },
  ): Promise<GoalDecision>
  resolveDecision(
    goalKey: string,
    decisionKey: string,
    input: { answer: string; prompt?: string },
  ): Promise<GoalDecision>
}

const GoalDecisionSchema = z.object({
  decisionKey: z.string().min(1),
  summary: z.string().min(1),
  prompt: z.string().min(1).optional(),
  status: z.enum(DECISION_STATUSES),
  taskRef: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
})

const GoalDecisionSetSchema = z.object({
  version: z.literal(1).default(1),
  goalKey: z.string().min(1),
  decisions: z.array(GoalDecisionSchema).default([]),
})

export function createDecisionStore(rootDir = process.cwd()): DecisionStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readGoalDecisions(goalKey) {
      return readDecisionSet(paths.decisionsPath(goalKey), goalKey)
    },
    async ensureGoalDecisions(goalKey) {
      const decisionPath = paths.decisionsPath(goalKey)
      const current = await readDecisionSet(decisionPath, goalKey)
      const file = Bun.file(decisionPath)
      if (!(await file.exists())) {
        await writeDecisionSet(decisionPath, current)
      }
      return current
    },
    async createDecision(goalKey, input) {
      const decisionPath = paths.decisionsPath(goalKey)
      const lockPath = `${decisionPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readDecisionSet(decisionPath, goalKey)
        const decisionKey = input.decisionKey ?? nextDecisionKey(current.decisions)
        if (current.decisions.some((item) => item.decisionKey === decisionKey)) {
          throw new Error(`Decision already exists: ${decisionKey}`)
        }
        const createdAt = new Date().toISOString()
        const decision: GoalDecision = {
          decisionKey,
          summary: input.summary,
          prompt: input.prompt,
          status: 'open',
          taskRef: input.taskRef,
          createdAt,
        }
        current.decisions.push(decision)
        await writeDecisionSet(decisionPath, current)
        return decision
      })
    },
    async enrichDecision(goalKey, decisionKey, input) {
      const decisionPath = paths.decisionsPath(goalKey)
      const lockPath = `${decisionPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readDecisionSet(decisionPath, goalKey)
        const decision = current.decisions.find((item) => item.decisionKey === decisionKey)
        if (!decision) {
          throw new Error(`Decision not found: ${decisionKey}`)
        }
        const changed = backfillDecisionPrompt(decision, input.prompt)
        if (changed) {
          await writeDecisionSet(decisionPath, current)
        }
        return decision
      })
    },
    async resolveDecision(goalKey, decisionKey, input) {
      const decisionPath = paths.decisionsPath(goalKey)
      const lockPath = `${decisionPath}.lock`
      return withFileLock(lockPath, async () => {
        const current = await readDecisionSet(decisionPath, goalKey)
        const decision = current.decisions.find((item) => item.decisionKey === decisionKey)
        if (!decision) {
          throw new Error(`Decision not found: ${decisionKey}`)
        }
        backfillDecisionPrompt(decision, input.prompt)
        decision.status = 'resolved'
        decision.answer = input.answer
        decision.resolvedAt = new Date().toISOString()
        await writeDecisionSet(decisionPath, current)
        return decision
      })
    },
  }
}

async function readDecisionSet(decisionPath: string, goalKey: string): Promise<GoalDecisionSet> {
  const file = Bun.file(decisionPath)
  if (!(await file.exists())) {
    return emptyDecisionSet(goalKey)
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return emptyDecisionSet(goalKey)
  }

  const parsed = GoalDecisionSetSchema.safeParse(parse(raw))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid decisions.yml format: ${issues}`)
  }

  return parsed.data
}

function emptyDecisionSet(goalKey: string): GoalDecisionSet {
  return {
    version: 1,
    goalKey,
    decisions: [],
  }
}

async function writeDecisionSet(decisionPath: string, set: GoalDecisionSet) {
  await mkdir(dirname(decisionPath), { recursive: true })
  const tmpPath = `${decisionPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, stringify(set, { indent: 2 }))
  await rename(tmpPath, decisionPath)
}

function nextDecisionKey(decisions: GoalDecision[]) {
  const nextNumber =
    decisions.reduce((max, decision) => {
      const match = /^D-(\d+)$/.exec(decision.decisionKey)
      if (!match) {
        return max
      }
      return Math.max(max, Number.parseInt(match[1] ?? '0', 10))
    }, 0) + 1

  return `D-${nextNumber}`
}

function backfillDecisionPrompt(decision: GoalDecision, prompt: string | undefined) {
  if (decision.prompt || !prompt) {
    return false
  }
  decision.prompt = prompt
  return true
}
