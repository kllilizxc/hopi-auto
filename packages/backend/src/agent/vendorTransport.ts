import { z } from 'zod'
import type { RoleProcessContextBundle } from '../runtime/roleProcessContext'
import type { ProcessAgentCommand } from './ProcessAgentRunner'

const cwdModeSchema = z.enum(['root', 'worktree'])
const codexSandboxSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])
const codexApprovalSchema = z.enum(['untrusted', 'on-request', 'never'])
const claudePermissionSchema = z.enum([
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
])

const commonTransportSchema = z.object({
  cwdMode: cwdModeSchema,
  baseRef: z.string().min(1).optional(),
  binary: z.string().min(1).optional(),
})

const processTransportSchema = commonTransportSchema.extend({
  transport: z.literal('process').optional(),
  cmd: z.array(z.string().min(1)).min(1),
})

const codexTransportSchema = commonTransportSchema.extend({
  transport: z.literal('codex'),
  model: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  sandbox: codexSandboxSchema.default('workspace-write'),
  approvalPolicy: codexApprovalSchema.default('never'),
})

const claudeTransportSchema = commonTransportSchema.extend({
  transport: z.literal('claude'),
  model: z.string().min(1).optional(),
  permissionMode: claudePermissionSchema.default('dontAsk'),
})

const opencodeTransportSchema = commonTransportSchema.extend({
  transport: z.literal('opencode'),
  model: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
  variant: z.string().min(1).optional(),
})

export const roleTransportConfigSchema = z.union([
  processTransportSchema,
  codexTransportSchema,
  claudeTransportSchema,
  opencodeTransportSchema,
])

export type RoleTransportConfig = z.infer<typeof roleTransportConfigSchema>

export interface ConfiguredTransportInvocation {
  goalKey: string
  runId: string
  stepId: string
  taskRef?: string
  role?: string
}

export async function resolveConfiguredTransportCommand(options: {
  config: RoleTransportConfig
  bundle: RoleProcessContextBundle
  input: ConfiguredTransportInvocation
}): Promise<ProcessAgentCommand> {
  const env = buildTransportEnv(options.bundle, options.input)

  if ('cmd' in options.config) {
    return {
      cmd: options.config.cmd.map((arg) =>
        interpolatePlaceholders(arg, placeholderValues(options)),
      ),
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      env,
    }
  }

  const prompt = await Bun.file(options.bundle.promptFile).text()

  if (options.config.transport === 'codex') {
    const cmd = [options.config.binary ?? 'codex', 'exec', '--skip-git-repo-check']
    cmd.push('-s', options.config.sandbox)
    cmd.push('-a', options.config.approvalPolicy)
    if (options.config.model) {
      cmd.push('-m', options.config.model)
    }
    if (options.config.profile) {
      cmd.push('-p', options.config.profile)
    }
    cmd.push('--json')
    cmd.push('-')
    return {
      cmd,
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      env,
      stdin: prompt,
      transcriptFormat: 'codex_jsonl',
    }
  }

  if (options.config.transport === 'claude') {
    const cmd = [
      options.config.binary ?? 'claude',
      '--print',
      '--output-format',
      'stream-json',
      '--permission-mode',
      options.config.permissionMode,
    ]
    if (options.config.model) {
      cmd.push('--model', options.config.model)
    }
    return {
      cmd,
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      env,
      stdin: prompt,
      transcriptFormat: 'claude_stream_json',
    }
  }

  const cmd = [options.config.binary ?? 'opencode', 'run', '--format', 'json']
  if (options.config.model) {
    cmd.push('--model', options.config.model)
  }
  if (options.config.agent) {
    cmd.push('--agent', options.config.agent)
  }
  if (options.config.variant) {
    cmd.push('--variant', options.config.variant)
  }
  cmd.push(prompt)
  return {
    cmd,
    cwdMode: options.config.cwdMode,
    baseRef: options.config.baseRef,
    outcomeFile: options.bundle.outcomeFile,
    env,
    transcriptFormat: 'opencode_json',
  }
}

function buildTransportEnv(bundle: RoleProcessContextBundle, input: ConfiguredTransportInvocation) {
  return {
    HOPI_CONTEXT_FILE: bundle.contextFile,
    HOPI_OUTCOME_FILE: bundle.outcomeFile,
    HOPI_GOAL_FILE: bundle.goalFile,
    HOPI_DESIGN_FILE: bundle.designFile,
    HOPI_PROMPT_FILE: bundle.promptFile,
    HOPI_GOAL_KEY: input.goalKey,
    HOPI_RUN_ID: input.runId,
    HOPI_STEP_ID: input.stepId,
    ...(input.taskRef ? { HOPI_TASK_REF: input.taskRef } : {}),
    ...(input.role ? { HOPI_ROLE: input.role } : {}),
  }
}

function placeholderValues(options: {
  bundle: RoleProcessContextBundle
  input: ConfiguredTransportInvocation
}) {
  return {
    CONTEXT_FILE: options.bundle.contextFile,
    OUTCOME_FILE: options.bundle.outcomeFile,
    GOAL_FILE: options.bundle.goalFile,
    DESIGN_FILE: options.bundle.designFile,
    PROMPT_FILE: options.bundle.promptFile,
    GOAL_KEY: options.input.goalKey,
    TASK_REF: options.input.taskRef ?? '',
    ROLE: options.input.role ?? '',
    RUN_ID: options.input.runId,
    STEP_ID: options.input.stepId,
  }
}

function interpolatePlaceholders(template: string, values: Record<string, string>) {
  let next = template
  for (const [key, value] of Object.entries(values)) {
    next = next.replaceAll(`\${${key}}`, value)
  }
  return next
}
