import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  type ProjectCodingDefaults,
  type ProjectCodingDefaultsInput,
  normalizeProjectCodingDefaults,
  projectCodingDefaultsSchema,
} from './projectCodingDefaults'
import type { AgentTransportConfig } from './vendorTransport'
import { agentTransportConfigSchema } from './vendorTransport'

export const AGENT_KEYS = ['assistant', 'worker'] as const
export type ConfigurableAgent = (typeof AGENT_KEYS)[number]

export interface AgentCodingSettings {
  codingDefaults: ProjectCodingDefaults
  inherited: boolean
  configurable: boolean
}

const assistantTransportConfigSchema = agentTransportConfigSchema.refine(
  (config) =>
    config.cwdMode === 'root' &&
    !('cmd' in config) &&
    (config.transport === 'codex' ||
      config.transport === 'claude' ||
      config.transport === 'opencode'),
  'assistant must use a built-in vendor transport with cwdMode root',
)

const workerTransportConfigSchema = agentTransportConfigSchema.refine(
  (config) => config.cwdMode === 'worktree',
  'worker cwdMode must be worktree',
)

export const agentAdapterConfigSchema = z
  .object({
    defaults: projectCodingDefaultsSchema,
    assistant: assistantTransportConfigSchema.optional(),
    worker: workerTransportConfigSchema.optional(),
  })
  .strict()

export type AgentAdapterConfig = z.infer<typeof agentAdapterConfigSchema>

export function normalizeAgentAdapterConfig(input: unknown): AgentAdapterConfig {
  const parsed = agentAdapterConfigSchema.safeParse(input)
  if (parsed.success) {
    return { ...parsed.data, defaults: normalizeProjectCodingDefaults(parsed.data.defaults) }
  }
  throw new Error(
    `Invalid adapter config: ${parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')}`,
  )
}

export async function writeAgentAdapterConfig(path: string, config: AgentAdapterConfig) {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`)
}

export async function readAgentAdapterConfig(path: string) {
  return normalizeAgentAdapterConfig(JSON.parse(await Bun.file(path).text()) as unknown)
}

export function resolveAssistantTransportConfig(config: AgentAdapterConfig): AgentTransportConfig {
  return config.assistant
    ? resolveExplicitTransportConfig(config.defaults, config.assistant)
    : buildDefaultTransportConfig(config.defaults, 'root')
}

export function resolveWorkerTransportConfig(config: AgentAdapterConfig): AgentTransportConfig {
  return config.worker
    ? resolveExplicitTransportConfig(config.defaults, config.worker)
    : buildDefaultTransportConfig(config.defaults, 'worktree')
}

export function readAgentCodingSettings(
  config: AgentAdapterConfig,
  agent: ConfigurableAgent,
): AgentCodingSettings {
  const override = config[agent]
  if (!override) {
    return { codingDefaults: config.defaults, inherited: true, configurable: true }
  }
  if (!isBuiltInCodingTransport(override)) {
    return { codingDefaults: config.defaults, inherited: false, configurable: false }
  }
  return {
    codingDefaults: codingDefaultsFromTransport(
      resolveExplicitTransportConfig(config.defaults, override),
    ),
    inherited: false,
    configurable: true,
  }
}

export function updateAgentCodingSettings(
  config: AgentAdapterConfig,
  agent: ConfigurableAgent,
  input: ProjectCodingDefaultsInput | null,
): AgentAdapterConfig {
  if (input === null) {
    const { [agent]: _removed, ...rest } = config
    return rest
  }
  const defaults = normalizeProjectCodingDefaults(input)
  const current = config[agent]
  const cwdMode = agent === 'assistant' ? 'root' : 'worktree'
  const next =
    current && isBuiltInCodingTransport(current) && current.transport === defaults.transport
      ? mergeBuiltInDefaults(current, defaults, cwdMode)
      : buildDefaultTransportConfig(defaults, cwdMode)
  return { ...config, [agent]: next }
}

function resolveExplicitTransportConfig(
  defaults: ProjectCodingDefaults,
  config: AgentTransportConfig,
): AgentTransportConfig {
  if (config.transport === 'codex' && !config.profile && defaults.transport === 'codex') {
    return {
      ...config,
      model: config.model ?? defaults.model,
      reasoningEffort: config.reasoningEffort ?? defaults.reasoningEffort,
    }
  }
  return config
}

function buildDefaultTransportConfig(
  defaults: ProjectCodingDefaults,
  cwdMode: 'root' | 'worktree',
): AgentTransportConfig {
  if (defaults.transport === 'codex') {
    return {
      transport: 'codex',
      cwdMode,
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
    }
  }
  if (defaults.transport === 'claude') {
    return {
      transport: 'claude',
      cwdMode,
      permissionMode: cwdMode === 'root' ? 'dontAsk' : 'acceptEdits',
      ...(defaults.model ? { model: defaults.model } : {}),
    }
  }
  return {
    transport: 'opencode',
    cwdMode,
    ...(defaults.model ? { model: defaults.model } : {}),
  }
}

function mergeBuiltInDefaults(
  current: Exclude<AgentTransportConfig, { cmd: string[] }>,
  defaults: ProjectCodingDefaults,
  cwdMode: 'root' | 'worktree',
): AgentTransportConfig {
  if (current.transport === 'codex' && defaults.transport === 'codex') {
    return { ...current, cwdMode, model: defaults.model, reasoningEffort: defaults.reasoningEffort }
  }
  if (current.transport === 'claude' && defaults.transport === 'claude') {
    return { ...current, cwdMode, model: defaults.model }
  }
  if (current.transport === 'opencode' && defaults.transport === 'opencode') {
    return { ...current, cwdMode, model: defaults.model }
  }
  return buildDefaultTransportConfig(defaults, cwdMode)
}

function isBuiltInCodingTransport(
  config: AgentTransportConfig,
): config is Exclude<AgentTransportConfig, { cmd: string[] }> {
  return (
    config.transport === 'codex' || config.transport === 'claude' || config.transport === 'opencode'
  )
}

function codingDefaultsFromTransport(config: AgentTransportConfig): ProjectCodingDefaults {
  if ('cmd' in config) throw new Error('Process transport has no coding defaults')
  return normalizeProjectCodingDefaults({
    transport: config.transport,
    ...(config.model ? { model: config.model } : {}),
    ...(config.transport === 'codex' && config.reasoningEffort
      ? { reasoningEffort: config.reasoningEffort }
      : {}),
  })
}
