import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import { type GoalWriteTrace, type GoalWriteTraceEntry, parseWriteTraceEntry } from './writeTrace'

export interface AppendWriteTraceEntryInput {
  runId: string
  stepId: string
  taskRef: string
  role: GoalWriteTraceEntry['role']
  agent: string
  cwd: string
  toolName: string
  callId: string
  targetPaths: string[]
  changes: GoalWriteTraceEntry['changes']
  argumentSummary: string
  resultSummary: string
}

export interface WriteTraceStore {
  readGoalTrace(goalKey: string): Promise<GoalWriteTrace>
  listEntries(
    goalKey: string,
    filters?: {
      taskRef?: string
      runId?: string
      stepId?: string
      role?: GoalWriteTraceEntry['role']
      limit?: number
    },
  ): Promise<GoalWriteTraceEntry[]>
  appendEntry(goalKey: string, entry: AppendWriteTraceEntryInput): Promise<GoalWriteTraceEntry>
}

export function createWriteTraceStore(rootDir = process.cwd()): WriteTraceStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readGoalTrace(goalKey) {
      const entries = await readEntries(paths.writeTracePath(goalKey))

      return {
        goalKey,
        entries,
      }
    },
    async listEntries(goalKey, filters = {}) {
      let entries = (await readEntries(paths.writeTracePath(goalKey))).toReversed()

      if (filters.taskRef) {
        entries = entries.filter((entry) => entry.taskRef === filters.taskRef)
      }
      if (filters.runId) {
        entries = entries.filter((entry) => entry.runId === filters.runId)
      }
      if (filters.stepId) {
        entries = entries.filter((entry) => entry.stepId === filters.stepId)
      }
      if (filters.role) {
        entries = entries.filter((entry) => entry.role === filters.role)
      }
      if (filters.limit && filters.limit > 0) {
        entries = entries.slice(0, filters.limit)
      }

      return entries
    },
    async appendEntry(goalKey, entry) {
      const tracePath = paths.writeTracePath(goalKey)
      const lockPath = `${tracePath}.lock`

      return withFileLock(lockPath, async () => {
        await mkdir(dirname(tracePath), { recursive: true })
        const fullEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          goalKey,
          ...entry,
        } satisfies GoalWriteTraceEntry
        await appendFile(tracePath, `${JSON.stringify(fullEntry)}\n`, 'utf8')
        return fullEntry
      })
    },
  }
}

async function readEntries(tracePath: string) {
  const file = Bun.file(tracePath)
  if (!(await file.exists())) {
    return []
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return []
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseWriteTraceEntry)
}
