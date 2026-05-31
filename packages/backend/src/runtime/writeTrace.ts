import { z } from 'zod'
import type { AgentRole } from '../agent/AgentRunner'

export const WRITE_TRACE_CHANGE_KINDS = ['added', 'modified', 'deleted'] as const

export type WriteTraceChangeKind = (typeof WRITE_TRACE_CHANGE_KINDS)[number]

export interface WriteTraceChange {
  path: string
  kind: WriteTraceChangeKind
}

export interface GoalWriteTraceEntry {
  id: string
  timestamp: string
  goalKey: string
  runId: string
  stepId: string
  taskRef: string
  role: AgentRole
  agent: string
  cwd: string
  toolName: string
  callId: string
  targetPaths: string[]
  changes: WriteTraceChange[]
  argumentSummary: string
  resultSummary: string
}

export interface GoalWriteTrace {
  goalKey: string
  entries: GoalWriteTraceEntry[]
}

const WriteTraceChangeSchema = z.object({
  path: z.string().min(1),
  kind: z.enum(WRITE_TRACE_CHANGE_KINDS),
})

const GoalWriteTraceEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  goalKey: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  taskRef: z.string().min(1),
  role: z.enum(['planner', 'generator', 'reviewer', 'merger']),
  agent: z.string().min(1),
  cwd: z.string().min(1),
  toolName: z.string().min(1),
  callId: z.string().min(1),
  targetPaths: z.array(z.string().min(1)),
  changes: z.array(WriteTraceChangeSchema),
  argumentSummary: z.string(),
  resultSummary: z.string(),
})

export function emptyGoalWriteTrace(goalKey: string): GoalWriteTrace {
  return {
    goalKey,
    entries: [],
  }
}

export function parseWriteTraceEntry(source: string): GoalWriteTraceEntry {
  const raw = JSON.parse(source)
  return validateWriteTraceEntry(raw)
}

export function validateWriteTraceEntry(input: unknown): GoalWriteTraceEntry {
  const parsed = GoalWriteTraceEntrySchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Invalid write trace entry: ${issues}`)
  }

  return parsed.data
}
