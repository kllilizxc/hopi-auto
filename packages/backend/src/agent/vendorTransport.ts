import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { readClaudeProviderEnvironment } from './claudeSettingsEnvironment'
import { codingReasoningEffortSchema, providerQualifiedModelSchema } from './projectCodingDefaults'
import type { AssistantTransport, VendorSession } from './vendorAssistantOutput'
import type { ProcessTranscriptFormat } from './vendorTranscript'

export interface TransportCommand {
  cmd: string[]
  cwdMode: 'root' | 'worktree'
  stdin?: string
  transcriptFormat?: ProcessTranscriptFormat
  sessionTransport?: AssistantTransport
  env?: Record<string, string>
  baseRef?: string
  outcomeFile?: string
  canonicalOutcomeFile?: string
  browserHarnessArtifactDir?: string
  canonicalBrowserHarnessArtifactDir?: string
}

export interface TransportContextBundle {
  runtimeScratchDir: string
  runtimeCacheDir: string
  goalFile: string
  designFile: string
  extraReadableRoots?: string[]
  extraWritableRoots?: string[]
  contextFile: string
  artifactManifestFile?: string
  promptFile: string
  outcomeFile: string
  canonicalOutcomeFile: string
  browserHarnessDir: string
  browserHarnessArtifactDir: string
  canonicalBrowserHarnessArtifactDir: string
  imageFiles?: string[]
  reposFile?: string
  apiOrigin?: string
}

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
  reasoningEffort: codingReasoningEffortSchema.optional(),
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
  model: providerQualifiedModelSchema.optional(),
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

const HOPI_CODEX_HTTPS_PROVIDER = 'hopi_chatgpt_https'

export function appendCodexHttpsOnlyConfig(command: string[]) {
  command.push(
    '-c',
    `model_provider=${JSON.stringify(HOPI_CODEX_HTTPS_PROVIDER)}`,
    '-c',
    `model_providers.${HOPI_CODEX_HTTPS_PROVIDER}.name=${JSON.stringify('HOPI ChatGPT HTTPS')}`,
    '-c',
    `model_providers.${HOPI_CODEX_HTTPS_PROVIDER}.base_url=${JSON.stringify('https://chatgpt.com/backend-api/codex')}`,
    '-c',
    `model_providers.${HOPI_CODEX_HTTPS_PROVIDER}.wire_api=${JSON.stringify('responses')}`,
    '-c',
    `model_providers.${HOPI_CODEX_HTTPS_PROVIDER}.requires_openai_auth=true`,
    '-c',
    `model_providers.${HOPI_CODEX_HTTPS_PROVIDER}.supports_websockets=false`,
  )
}

export interface ConfiguredTransportInvocation {
  goalKey: string
  runId: string
  stepId: string
  taskRef?: string
  role?: string
  projectId?: string
}

export async function resolveConfiguredTransportCommand(options: {
  config: RoleTransportConfig
  bundle: TransportContextBundle
  input: ConfiguredTransportInvocation
  session?: VendorSession | null
  fullAccess?: boolean
}): Promise<TransportCommand> {
  if ((options.bundle.imageFiles?.length ?? 0) > 0 && 'cmd' in options.config) {
    throw new Error('process responsibility transport does not support HOPI image inputs')
  }
  const env = {
    ...buildTransportEnv(options.bundle, options.input),
    ...(options.config.transport === 'claude' ? await readClaudeProviderEnvironment() : {}),
  }

  if ('cmd' in options.config) {
    return {
      cmd: options.config.cmd.map((arg) =>
        interpolatePlaceholders(arg, placeholderValues(options)),
      ),
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      canonicalOutcomeFile: options.bundle.canonicalOutcomeFile,
      browserHarnessArtifactDir: options.bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: options.bundle.canonicalBrowserHarnessArtifactDir,
      env,
    }
  }

  const savedSession =
    options.session?.transport === options.config.transport ? options.session : null
  const assignment = await Bun.file(options.bundle.promptFile).text()
  const prompt = savedSession
    ? responsibilityContinuationPrompt(assignment, options.input)
    : assignment

  if (options.config.transport === 'codex') {
    const cmd = [options.config.binary ?? 'codex']
    appendCodexHttpsOnlyConfig(cmd)
    const sandbox = options.fullAccess
      ? 'danger-full-access'
      : options.config.sandbox === 'danger-full-access'
        ? 'workspace-write'
        : options.config.sandbox
    cmd.push('-a', options.fullAccess ? 'never' : options.config.approvalPolicy)
    if (options.config.reasoningEffort) {
      cmd.push('-c', `model_reasoning_effort="${options.config.reasoningEffort}"`)
    }
    if (!options.fullAccess && sandbox === 'workspace-write') {
      cmd.push('-c', 'sandbox_workspace_write.network_access=true')
    }
    if (savedSession) {
      cmd.push('-s', sandbox)
      if (!options.fullAccess) {
        for (const dir of options.bundle.extraWritableRoots ?? []) cmd.push('--add-dir', dir)
      }
      if (options.config.model) cmd.push('-m', options.config.model)
      if (options.config.profile) cmd.push('-p', options.config.profile)
      cmd.push('exec', 'resume', '--ignore-user-config', '--skip-git-repo-check')
      for (const imageFile of options.bundle.imageFiles ?? []) cmd.push('-i', imageFile)
      cmd.push('--json', savedSession.sessionId, '-')
    } else {
      cmd.push('exec', '--ignore-user-config', '--skip-git-repo-check')
      cmd.push('-s', sandbox)
      if (!options.fullAccess) {
        for (const dir of options.bundle.extraWritableRoots ?? []) cmd.push('--add-dir', dir)
      }
      if (options.config.model) cmd.push('-m', options.config.model)
      if (options.config.profile) cmd.push('-p', options.config.profile)
      for (const imageFile of options.bundle.imageFiles ?? []) cmd.push('-i', imageFile)
      cmd.push('--json', '-')
    }
    return {
      cmd,
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      canonicalOutcomeFile: options.bundle.canonicalOutcomeFile,
      browserHarnessArtifactDir: options.bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: options.bundle.canonicalBrowserHarnessArtifactDir,
      env,
      stdin: prompt,
      transcriptFormat: 'codex_jsonl',
      sessionTransport: 'codex',
    }
  }

  if (options.config.transport === 'claude') {
    const settingsPath = join(options.bundle.runtimeScratchDir, 'claude-settings.json')
    await mkdir(dirname(settingsPath), { recursive: true })
    await Bun.write(
      settingsPath,
      `${JSON.stringify(
        {
          sandbox: options.fullAccess
            ? { enabled: false }
            : {
                enabled: true,
                failIfUnavailable: true,
                autoAllowBashIfSandboxed: true,
                allowUnsandboxedCommands: false,
                filesystem: { allowWrite: options.bundle.extraWritableRoots ?? [] },
              },
        },
        null,
        2,
      )}\n`,
    )
    const cmd = [
      options.config.binary ?? 'claude',
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--settings',
      settingsPath,
      '--setting-sources',
      '',
    ]
    if (options.fullAccess) {
      cmd.push('--dangerously-skip-permissions')
    } else {
      cmd.push(
        '--permission-mode',
        options.config.permissionMode === 'bypassPermissions'
          ? options.config.cwdMode === 'root'
            ? 'dontAsk'
            : 'acceptEdits'
          : options.config.permissionMode,
      )
    }
    if (!options.fullAccess) {
      const accessibleDirs = new Set([
        ...(options.bundle.extraReadableRoots ?? []),
        ...(options.bundle.extraWritableRoots ?? []),
      ])
      for (const imageFile of options.bundle.imageFiles ?? [])
        accessibleDirs.add(dirname(imageFile))
      for (const dir of accessibleDirs) cmd.push('--add-dir', dir)
    }
    if (options.config.model) {
      cmd.push('--model', options.config.model)
    }
    if (savedSession) cmd.push('--resume', savedSession.sessionId)
    return {
      cmd,
      cwdMode: options.config.cwdMode,
      baseRef: options.config.baseRef,
      outcomeFile: options.bundle.outcomeFile,
      canonicalOutcomeFile: options.bundle.canonicalOutcomeFile,
      browserHarnessArtifactDir: options.bundle.browserHarnessArtifactDir,
      canonicalBrowserHarnessArtifactDir: options.bundle.canonicalBrowserHarnessArtifactDir,
      env,
      stdin: prompt,
      transcriptFormat: 'claude_stream_json',
      sessionTransport: 'claude',
    }
  }

  const opencodeConfigPath = options.fullAccess
    ? join(options.bundle.runtimeScratchDir, 'opencode.json')
    : null
  if (opencodeConfigPath) {
    await mkdir(dirname(opencodeConfigPath), { recursive: true })
    await Bun.write(
      opencodeConfigPath,
      `${JSON.stringify(
        { $schema: 'https://opencode.ai/config.json', permission: { '*': 'allow' } },
        null,
        2,
      )}\n`,
    )
  }
  const cmd = [
    options.config.binary ?? 'opencode',
    ...(options.fullAccess ? ['--pure'] : []),
    'run',
    '--format',
    'json',
  ]
  if (options.config.model) {
    cmd.push('--model', options.config.model)
  }
  if (options.config.agent) {
    cmd.push('--agent', options.config.agent)
  }
  if (options.config.variant) {
    cmd.push('--variant', options.config.variant)
  }
  if (savedSession) cmd.push('--session', savedSession.sessionId)
  for (const imageFile of options.bundle.imageFiles ?? []) cmd.push('--file', imageFile)
  return {
    cmd,
    cwdMode: options.config.cwdMode,
    baseRef: options.config.baseRef,
    outcomeFile: options.bundle.outcomeFile,
    canonicalOutcomeFile: options.bundle.canonicalOutcomeFile,
    browserHarnessArtifactDir: options.bundle.browserHarnessArtifactDir,
    canonicalBrowserHarnessArtifactDir: options.bundle.canonicalBrowserHarnessArtifactDir,
    env: { ...env, ...(opencodeConfigPath ? { OPENCODE_CONFIG: opencodeConfigPath } : {}) },
    stdin: prompt,
    transcriptFormat: 'opencode_json',
    sessionTransport: 'opencode',
  }
}

function responsibilityContinuationPrompt(
  assignment: string,
  input: ConfiguredTransportInvocation,
) {
  return [
    '# Continue Responsibility Session',
    '',
    `Continue the same ${input.role ?? input.stepId} responsibility for Work ${input.taskRef ?? input.stepId} in a new Attempt.`,
    'The complete current assignment below is authoritative and supersedes remembered paths or facts.',
    'Inspect the current workspace and retain valid prior progress instead of repeating completed work.',
    '',
    assignment,
  ].join('\n')
}

function buildTransportEnv(bundle: TransportContextBundle, input: ConfiguredTransportInvocation) {
  return {
    HOPI_RUN_SCRATCH: bundle.runtimeScratchDir,
    HOPI_CACHE_DIR: bundle.runtimeCacheDir,
    HOPI_CONTEXT_FILE: bundle.contextFile,
    ...(bundle.artifactManifestFile
      ? { HOPI_EVIDENCE_ARTIFACTS_FILE: bundle.artifactManifestFile }
      : {}),
    HOPI_OUTCOME_FILE: bundle.outcomeFile,
    HOPI_GOAL_FILE: bundle.goalFile,
    HOPI_DESIGN_FILE: bundle.designFile,
    HOPI_PROMPT_FILE: bundle.promptFile,
    HOPI_BROWSER_HARNESS_DIR: bundle.browserHarnessDir,
    HOPI_BROWSER_HARNESS_ARTIFACT_DIR: bundle.browserHarnessArtifactDir,
    ...(bundle.reposFile ? { HOPI_REPOS_FILE: bundle.reposFile } : {}),
    ...(bundle.apiOrigin ? { HOPI_API_ORIGIN: bundle.apiOrigin } : {}),
    HOPI_GOAL_KEY: input.goalKey,
    HOPI_GOAL_ID: input.goalKey,
    HOPI_RUN_ID: input.runId,
    HOPI_STEP_ID: input.stepId,
    ...(input.projectId ? { HOPI_PROJECT_ID: input.projectId } : {}),
    ...(input.taskRef ? { HOPI_WORK_ID: input.taskRef } : {}),
    ...(input.taskRef ? { HOPI_TASK_REF: input.taskRef } : {}),
    ...(input.role ? { HOPI_ROLE: input.role } : {}),
  }
}

function placeholderValues(options: {
  bundle: TransportContextBundle
  input: ConfiguredTransportInvocation
}) {
  return {
    CONTEXT_FILE: options.bundle.contextFile,
    EVIDENCE_ARTIFACTS_FILE: options.bundle.artifactManifestFile ?? '',
    OUTCOME_FILE: options.bundle.outcomeFile,
    GOAL_FILE: options.bundle.goalFile,
    DESIGN_FILE: options.bundle.designFile,
    PROMPT_FILE: options.bundle.promptFile,
    BROWSER_HARNESS_DIR: options.bundle.browserHarnessDir,
    BROWSER_HARNESS_ARTIFACT_DIR: options.bundle.browserHarnessArtifactDir,
    API_ORIGIN: options.bundle.apiOrigin ?? '',
    GOAL_KEY: options.input.goalKey,
    GOAL_ID: options.input.goalKey,
    PROJECT_ID: options.input.projectId ?? '',
    WORK_ID: options.input.taskRef ?? '',
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
