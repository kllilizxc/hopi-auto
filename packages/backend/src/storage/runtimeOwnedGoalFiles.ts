import { mkdir, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectPaths } from './paths'

export const LEGACY_GOAL_EVENTS_FILE = 'events.jsonl'
export const LEGACY_GOAL_WRITE_TRACE_FILE = 'write-trace.jsonl'

export function legacyGoalEventsPath(paths: ProjectPaths, goalKey: string) {
  return join(paths.goalDir(goalKey), LEGACY_GOAL_EVENTS_FILE)
}

export function legacyGoalWriteTracePath(paths: ProjectPaths, goalKey: string) {
  return join(paths.goalDir(goalKey), LEGACY_GOAL_WRITE_TRACE_FILE)
}

export async function migrateLegacyRuntimeOwnedGoalFileIfNeeded(
  runtimePath: string,
  legacyPath: string,
) {
  const runtimeFile = Bun.file(runtimePath)
  if (await runtimeFile.exists()) {
    return
  }

  const legacyFile = Bun.file(legacyPath)
  if (!(await legacyFile.exists())) {
    return
  }

  await mkdir(dirname(runtimePath), { recursive: true })
  try {
    await rename(legacyPath, runtimePath)
  } catch (error) {
    if (!(await runtimeFile.exists())) {
      throw error
    }
  }
}
