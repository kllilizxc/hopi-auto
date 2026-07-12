import { agentAdapterConfigPath } from '../storage/assistantRuntimePaths'
import {
  type AgentAdapterConfig,
  readAndMigrateAgentAdapterConfig,
  writeAgentAdapterConfig,
} from './adapterConfig'
import {
  DEFAULT_PROJECT_CODING_DEFAULTS,
  type ProjectCodingDefaultsInput,
  normalizeProjectCodingDefaults,
} from './projectCodingDefaults'

export const DEFAULT_AGENT_ADAPTER_CONFIG: AgentAdapterConfig = createDefaultAgentAdapterConfig()

export function createDefaultAgentAdapterConfig(
  codingDefaults: ProjectCodingDefaultsInput = DEFAULT_PROJECT_CODING_DEFAULTS,
): AgentAdapterConfig {
  return {
    version: 3,
    defaults: normalizeProjectCodingDefaults(codingDefaults),
    roles: {},
  }
}

export async function ensureDefaultAgentAdapterConfig(
  rootDir: string,
  codingDefaults?: ProjectCodingDefaultsInput,
) {
  const path = agentAdapterConfigPath(rootDir)
  const normalizedDefaults = codingDefaults
    ? normalizeProjectCodingDefaults(codingDefaults)
    : undefined

  if (await Bun.file(path).exists()) {
    const before = await Bun.file(path).text()
    const current = await readAndMigrateAgentAdapterConfig(path)
    if (normalizedDefaults) {
      await writeAgentAdapterConfig(path, {
        ...current,
        defaults: normalizedDefaults,
      })
    }
    const after = await Bun.file(path).text()
    return before !== after
  }

  await writeAgentAdapterConfig(
    path,
    createDefaultAgentAdapterConfig(normalizedDefaults ?? DEFAULT_PROJECT_CODING_DEFAULTS),
  )
  return true
}
