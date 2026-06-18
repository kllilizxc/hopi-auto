import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import {
  legacyGoalWriteTracePath,
  migrateLegacyRuntimeOwnedGoalFileIfNeeded,
} from '../storage/runtimeOwnedGoalFiles'
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
      const runtimePath = paths.writeTracePath(goalKey)
      const legacyPath = legacyGoalWriteTracePath(paths, goalKey)
      await migrateLegacyRuntimeOwnedGoalFileIfNeeded(runtimePath, legacyPath)
      const entries = await readEntries([legacyPath, runtimePath])

      return {
        goalKey,
        entries,
      }
    },
    async listEntries(goalKey, filters = {}) {
      const runtimePath = paths.writeTracePath(goalKey)
      const legacyPath = legacyGoalWriteTracePath(paths, goalKey)
      await migrateLegacyRuntimeOwnedGoalFileIfNeeded(runtimePath, legacyPath)
      let entries = (await readEntries([legacyPath, runtimePath])).toReversed()

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
      const legacyPath = legacyGoalWriteTracePath(paths, goalKey)
      const lockPath = `${tracePath}.lock`

      return withFileLock(lockPath, async () => {
        await migrateLegacyRuntimeOwnedGoalFileIfNeeded(tracePath, legacyPath)
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

async function readEntries(tracePaths: string[]) {
  const entries: GoalWriteTraceEntry[] = []
  for (const tracePath of tracePaths) {
    const file = Bun.file(tracePath)
    if (!(await file.exists())) {
      continue
    }

    const raw = await file.text()
    if (raw.trim() === '') {
      continue
    }

    entries.push(
      ...raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseWriteTraceEntry),
    )
  }

  return entries
}
