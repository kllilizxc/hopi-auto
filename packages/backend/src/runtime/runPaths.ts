import { join, resolve } from 'node:path'

export function runStorageRoot(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'runtime', 'runs')
}

export function runStoragePath(homeRoot: string, runId: string) {
  return join(runStorageRoot(homeRoot), runId)
}

export function legacyRunStoragePath(
  homeRoot: string,
  projectId: string,
  goalId: string,
  workId: string,
  runId: string,
) {
  return join(runStorageRoot(homeRoot), projectId, goalId, workId, runId)
}

export function runtimeCacheRoot(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'cache')
}
