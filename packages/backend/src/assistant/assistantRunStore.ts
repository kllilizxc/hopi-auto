import { readdir } from 'node:fs/promises'
import { createProjectPaths } from '../storage/paths'
import {
  type GoalAssistantRunBundle,
  type GoalAssistantRunRecord,
  type GoalAssistantRunSummary,
  parseGoalAssistantRunRecord,
  toAssistantRunSummary,
} from './assistantRun'

export interface AssistantRunStore {
  readRun(goalKey: string, assistantRunId: string): Promise<GoalAssistantRunRecord | null>
  readBundle(goalKey: string, assistantRunId: string): Promise<GoalAssistantRunBundle | null>
  listRuns(goalKey: string): Promise<GoalAssistantRunSummary[]>
}

export function createAssistantRunStore(rootDir = process.cwd()): AssistantRunStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readRun(goalKey, assistantRunId) {
      const path = paths.assistantResultPath(goalKey, assistantRunId)
      const file = Bun.file(path)
      if (!(await file.exists())) {
        return null
      }

      const raw = await file.text()
      if (raw.trim() === '') {
        return null
      }

      return parseGoalAssistantRunRecord(raw)
    },
    async readBundle(goalKey, assistantRunId) {
      const resultPath = paths.assistantResultPath(goalKey, assistantRunId)
      const resultFile = Bun.file(resultPath)
      if (!(await resultFile.exists())) {
        return null
      }

      return {
        goalKey,
        assistantRunId,
        context: await readBundleFile(paths.assistantContextPath(goalKey, assistantRunId)),
        prompt: await readBundleFile(paths.assistantPromptPath(goalKey, assistantRunId)),
        outcome: await readBundleFile(paths.assistantOutcomePath(goalKey, assistantRunId)),
        result: await readBundleFile(resultPath),
      }
    },
    async listRuns(goalKey) {
      const runsDir = paths.assistantRunsDir(goalKey)
      try {
        const entries = await readdir(runsDir, { withFileTypes: true })
        const runs = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => this.readRun(goalKey, entry.name)),
        )

        return runs
          .filter((run): run is GoalAssistantRunRecord => run !== null)
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
          .map(toAssistantRunSummary)
      } catch {
        return []
      }
    },
  }
}

async function readBundleFile(path: string) {
  const file = Bun.file(path)
  return {
    path,
    content: (await file.exists()) ? await file.text() : null,
  }
}
