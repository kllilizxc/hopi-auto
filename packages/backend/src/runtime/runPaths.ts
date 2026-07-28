import { join, resolve } from 'node:path'

export function runStorageRoot(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'runtime', 'runs')
}

export function runStoragePath(homeRoot: string, runId: string) {
  return join(runStorageRoot(homeRoot), runId)
}

export function runtimeCacheRoot(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'cache')
}
