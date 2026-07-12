import { join, resolve } from 'node:path'

export function agentAdapterConfigPath(homeRoot: string) {
  return join(resolve(homeRoot), '.hopi', 'runtime', 'agent-adapters.json')
}
