import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_PROJECT_CODING_DEFAULTS,
  type ProjectCodingDefaults,
  type ProjectCodingDefaultsInput,
  normalizeProjectCodingDefaults,
} from './projectCodingDefaults'
import type { RoleTransportConfig } from './vendorTransport'
import { roleTransportConfigSchema } from './vendorTransport'

export const WORKFLOW_ROLE_KEYS = ['planner', 'generator', 'reviewer'] as const

export type WorkflowRoleKey = (typeof WORKFLOW_ROLE_KEYS)[number]
export type ConfigurableAgentRole = 'assistant' | WorkflowRoleKey
export interface AgentRoleCodingSettings {
  codingDefaults: ProjectCodingDefaults
  inherited: boolean
  configurable: boolean
}
type ProjectCodingDefaultSource = Extract<
  RoleTransportConfig,
  { transport: 'codex' | 'claude' | 'opencode' }
>

const assistantTransportConfigSchema = roleTransportConfigSchema.refine(
  (config) =>
    config.cwdMode === 'root' &&
    !('cmd' in config) &&
    (config.transport === 'codex' ||
      config.transport === 'claude' ||
      config.transport === 'opencode'),
  'assistant must use a built-in vendor transport with cwdMode root',
)

const workflowRoleTransportConfigSchema = roleTransportConfigSchema.refine(
  (config) => config.cwdMode === 'worktree',
  'workflow role cwdMode must be worktree',
)

const workflowRoleConfigMapSchema = z
  .object({
    planner: workflowRoleTransportConfigSchema.optional(),
    generator: workflowRoleTransportConfigSchema.optional(),
    reviewer: workflowRoleTransportConfigSchema.optional(),
  })
  .strict()
  .default({})

const legacyRoleConfigMapSchema = z
  .object({
    planner: roleTransportConfigSchema.optional(),
    generator: roleTransportConfigSchema.optional(),
    reviewer: roleTransportConfigSchema.optional(),
    merger: roleTransportConfigSchema.optional(),
  })
  .default({})

const agentAdapterConfigV1Schema = z.object({
  version: z.literal(1),
  assistant: roleTransportConfigSchema.optional(),
  roles: legacyRoleConfigMapSchema,
})

const agentAdapterConfigV2Schema = z.object({
  version: z.literal(2),
  assistant: assistantTransportConfigSchema.optional(),
  roles: legacyRoleConfigMapSchema,
})

export const agentAdapterConfigSchema = z.object({
  version: z.literal(3),
  defaults: z
    .custom<ProjectCodingDefaults>((input) => {
      try {
        normalizeProjectCodingDefaults(input as ProjectCodingDefaults | undefined)
        return true
      } catch {
        return false
      }
    })
    .default(DEFAULT_PROJECT_CODING_DEFAULTS),
  assistant: assistantTransportConfigSchema.optional(),
  roles: workflowRoleConfigMapSchema,
})

export type AgentAdapterConfig = z.infer<typeof agentAdapterConfigSchema>

type LegacyAgentAdapterConfig =
  | z.infer<typeof agentAdapterConfigV1Schema>
  | z.infer<typeof agentAdapterConfigV2Schema>

export function normalizeAgentAdapterConfig(input: unknown): AgentAdapterConfig {
  const parsedCurrent = agentAdapterConfigSchema.safeParse(input)
  if (parsedCurrent.success) {
    return {
      ...parsedCurrent.data,
      defaults: normalizeProjectCodingDefaults(parsedCurrent.data.defaults),
    }
  }

  const parsedV2 = agentAdapterConfigV2Schema.safeParse(input)
  if (parsedV2.success) {
    return migrateAgentAdapterConfig(parsedV2.data)
  }

  const parsedV1 = agentAdapterConfigV1Schema.safeParse(input)
  if (parsedV1.success) {
    return migrateAgentAdapterConfig(parsedV1.data)
  }

  const issues = parsedCurrent.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join(', ')
  throw new Error(`Invalid adapter config: ${issues}`)
}

export async function writeAgentAdapterConfig(path: string, config: AgentAdapterConfig) {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`)
}

export async function readAndMigrateAgentAdapterConfig(path: string) {
  const raw = await Bun.file(path).text()
  const source = JSON.parse(raw) as unknown
  const normalized = normalizeAgentAdapterConfig(source)
  const normalizedText = `${JSON.stringify(normalized, null, 2)}\n`
  if (normalizedText !== raw) {
    await writeAgentAdapterConfig(path, normalized)
  }
  return normalized
}

export function resolveAssistantTransportConfig(config: AgentAdapterConfig): RoleTransportConfig {
  if (config.assistant) {
    return resolveExplicitTransportConfig(config.defaults, config.assistant)
  }

  return buildDefaultTransportConfig(config.defaults, 'root')
}

export function readAssistantCodingDefaults(config: AgentAdapterConfig): {
  codingDefaults: ProjectCodingDefaults
  inherited: boolean
} {
  return {
    codingDefaults: codingDefaultsFromTransport(resolveAssistantTransportConfig(config)),
    inherited: config.assistant === undefined,
  }
}

export function readAgentRoleCodingDefaults(
  config: AgentAdapterConfig,
  role: ConfigurableAgentRole,
): AgentRoleCodingSettings {
  if (role === 'assistant') {
    return { ...readAssistantCodingDefaults(config), configurable: true }
  }

  const override = config.roles[role]
  if (!override) {
    return {
      codingDefaults: config.defaults,
      inherited: true,
      configurable: true,
    }
  }
  if (!isBuiltInCodingTransport(override)) {
    return {
      codingDefaults: config.defaults,
      inherited: false,
      configurable: false,
    }
  }
  return {
    codingDefaults: codingDefaultsFromTransport(
      resolveExplicitTransportConfig(config.defaults, override),
    ),
    inherited: false,
    configurable: true,
  }
}

export function updateAssistantCodingDefaults(
  config: AgentAdapterConfig,
  input: ProjectCodingDefaultsInput | null,
): AgentAdapterConfig {
  if (input === null) {
    const { assistant: _assistant, ...withoutAssistant } = config
    return withoutAssistant
  }

  const defaults = normalizeProjectCodingDefaults(input)
  const current = config.assistant
  const assistant =
    current && !('cmd' in current) && current.transport === defaults.transport
      ? mergeAssistantDefaults(current, defaults)
      : buildDefaultTransportConfig(defaults, 'root')
  return { ...config, assistant }
}

export function updateAgentRoleCodingDefaults(
  config: AgentAdapterConfig,
  role: ConfigurableAgentRole,
  input: ProjectCodingDefaultsInput | null,
): AgentAdapterConfig {
  if (role === 'assistant') return updateAssistantCodingDefaults(config, input)
  if (input === null) {
    const { [role]: _removed, ...roles } = config.roles
    return { ...config, roles }
  }

  const defaults = normalizeProjectCodingDefaults(input)
  const current = config.roles[role]
  const next =
    current && isBuiltInCodingTransport(current) && current.transport === defaults.transport
      ? mergeBuiltInDefaults(current, defaults, 'worktree')
      : buildDefaultTransportConfig(defaults, 'worktree')
  return { ...config, roles: { ...config.roles, [role]: next } }
}

export function resolveRoleTransportConfig(
  config: AgentAdapterConfig,
  role: WorkflowRoleKey,
  projectDefaults?: ProjectCodingDefaults,
): RoleTransportConfig {
  const defaults = projectDefaults
    ? normalizeProjectCodingDefaults(projectDefaults)
    : config.defaults
  const override = config.roles[role]
  if (override) {
    return resolveExplicitTransportConfig(defaults, override)
  }

  return buildDefaultTransportConfig(defaults, 'worktree')
}

function migrateAgentAdapterConfig(input: LegacyAgentAdapterConfig): AgentAdapterConfig {
  const defaults = deriveProjectCodingDefaultsFromLegacyConfig(input)
  const assistant = migrateLegacyTransportConfig(input.assistant, 'root')

  return {
    version: 3,
    defaults,
    ...(assistant &&
    !('cmd' in assistant) &&
    (assistant.transport === 'codex' ||
      assistant.transport === 'claude' ||
      assistant.transport === 'opencode')
      ? { assistant }
      : {}),
    roles: Object.fromEntries(
      WORKFLOW_ROLE_KEYS.flatMap((role) => {
        const migrated = migrateLegacyTransportConfig(input.roles[role], 'worktree')
        return migrated ? [[role, migrated]] : []
      }),
    ) as AgentAdapterConfig['roles'],
  }
}

function migrateLegacyTransportConfig(
  config: RoleTransportConfig | undefined,
  cwdMode: 'root' | 'worktree',
) {
  if (!config) {
    return undefined
  }

  const migrated = {
    ...config,
    cwdMode,
  } satisfies RoleTransportConfig

  if (isLegacyGeneratedCodexConfig(migrated, cwdMode)) {
    return undefined
  }

  return migrated
}

function deriveProjectCodingDefaultsFromLegacyConfig(
  config: LegacyAgentAdapterConfig,
): ProjectCodingDefaults {
  let preferred = selectPreferredCodingDefaultSource(config.assistant)
  if (!preferred) {
    for (const role of WORKFLOW_ROLE_KEYS) {
      preferred = selectPreferredCodingDefaultSource(config.roles[role])
      if (preferred) {
        break
      }
    }
  }

  if (!preferred) {
    return DEFAULT_PROJECT_CODING_DEFAULTS
  }

  if (preferred.transport === 'codex') {
    return normalizeProjectCodingDefaults({
      transport: 'codex',
      model: preferred.model,
    })
  }

  return normalizeProjectCodingDefaults({
    transport: preferred.transport,
    model: preferred.model,
  })
}

function selectPreferredCodingDefaultSource(
  config: RoleTransportConfig | undefined,
): ProjectCodingDefaultSource | undefined {
  if (!config) {
    return undefined
  }

  if (
    config.transport === 'codex' ||
    config.transport === 'claude' ||
    config.transport === 'opencode'
  ) {
    return config
  }

  return undefined
}

function isLegacyGeneratedCodexConfig(config: RoleTransportConfig, cwdMode: 'root' | 'worktree') {
  return (
    config.transport === 'codex' &&
    config.cwdMode === cwdMode &&
    config.sandbox === 'workspace-write' &&
    config.approvalPolicy === 'never' &&
    !config.model &&
    !config.profile &&
    !config.binary &&
    !config.baseRef &&
    !config.reasoningEffort
  )
}

function resolveExplicitTransportConfig(
  defaults: ProjectCodingDefaults,
  config: RoleTransportConfig,
): RoleTransportConfig {
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
): RoleTransportConfig {
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

function mergeAssistantDefaults(
  current: Exclude<RoleTransportConfig, { cmd: string[] }>,
  defaults: ProjectCodingDefaults,
): RoleTransportConfig {
  return mergeBuiltInDefaults(current, defaults, 'root')
}

function mergeBuiltInDefaults(
  current: Exclude<RoleTransportConfig, { cmd: string[] }>,
  defaults: ProjectCodingDefaults,
  cwdMode: 'root' | 'worktree',
): RoleTransportConfig {
  if (current.transport === 'codex' && defaults.transport === 'codex') {
    return {
      ...current,
      cwdMode,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
    }
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
  config: RoleTransportConfig,
): config is Exclude<RoleTransportConfig, { cmd: string[] }> {
  return (
    config.transport === 'codex' || config.transport === 'claude' || config.transport === 'opencode'
  )
}

function codingDefaultsFromTransport(config: RoleTransportConfig): ProjectCodingDefaults {
  if (config.transport === 'codex') {
    return normalizeProjectCodingDefaults({
      transport: 'codex',
      model: config.model,
      reasoningEffort: config.reasoningEffort,
    })
  }
  if (config.transport === 'claude' || config.transport === 'opencode') {
    return normalizeProjectCodingDefaults({
      transport: config.transport,
      model: config.model,
    })
  }
  throw new Error('Assistant requires a built-in vendor transport')
}
