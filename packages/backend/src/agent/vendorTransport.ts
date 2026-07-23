import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { readClaudeProviderEnvironment } from './claudeSettingsEnvironment'
import { type ExecutionEnvelope, injectExecutionEnvelope } from './executionEnvelope'
import { codingReasoningEffortSchema, providerQualifiedModelSchema } from './projectCodingDefaults'
import type { AssistantTransport, VendorSession } from './vendorAssistantOutput'
import type { ProcessTranscriptFormat } from './vendorTranscript'

export interface TransportCommand {
  cmd: string[]
  cwdMode: 'root' | 'worktree'
  stdin?: string
  transcriptFormat?: ProcessTranscriptFormat
  sessionTransport?: AssistantTransport
  structuredOutcomeFile?: string
  env?: Record<string, string>
  baseRef?: string
  outcomeFile?: string
  canonicalOutcomeFile?: string
  browserHarnessArtifactDir?: string
  canonicalBrowserHarnessArtifactDir?: string
  assignmentSnapshotFile?: string
  assignmentSnapshot?: string
}

export interface TransportContextBundle {
  runRoot?: string
  runtimeScratchDir: string
  runtimeCacheDir: string
  authorityRoot?: string
  proposalRoot?: string
  attentionProposalDir?: string
  primaryRepoRoot?: string
  bootstrapSourceRoot?: string
  operatorPreferenceFile?: string
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
  browserHarnessCommand?: string
  browserHarnessArtifactDir: string
  canonicalBrowserHarnessArtifactDir: string
  imageFiles?: string[]
  reposFile?: string
  formalReleasePreviewFile?: string
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
const NON_INTERACTIVE_CLAUDE_TOOLS = ['EnterPlanMode', 'ExitPlanMode', 'AskUserQuestion']
export const NON_INTERACTIVE_CODEX_APPROVAL_POLICY = 'never'

export function withNativeCompactionEnabled(
  transport: AssistantTransport | undefined,
  environment: Record<string, string | undefined>,
) {
  const disabledKeys =
    transport === 'claude'
      ? new Set(['DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT'])
      : transport === 'opencode'
        ? new Set(['OPENCODE_DISABLE_AUTOCOMPACT'])
        : null
  if (!disabledKeys) return { ...environment }
  return Object.fromEntries(Object.entries(environment).filter(([name]) => !disabledKeys.has(name)))
}

export function appendClaudeNonInteractivePermission(command: string[]) {
  command.push('--dangerously-skip-permissions')
}

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
  runtimeWorkspace?: string
  continuationPrompt?: string
  refreshAssignment?: boolean
}): Promise<TransportCommand> {
  if ((options.bundle.imageFiles?.length ?? 0) > 0 && 'cmd' in options.config) {
    throw new Error('process responsibility transport does not support HOPI image inputs')
  }
  const env = {
    ...buildTransportEnv(options.bundle, options.input),
    ...(options.config.transport === 'claude' ? await readClaudeProviderEnvironment() : {}),
  }
  const executionEnvelope = responsibilityExecutionEnvelope(options)
  const assignment = injectExecutionEnvelope(
    await Bun.file(options.bundle.promptFile).text(),
    executionEnvelope,
  )
  await Bun.write(options.bundle.promptFile, assignment)
  const assignmentSnapshotFile = join(options.bundle.runtimeScratchDir, 'assignment.snapshot.md')

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
  const prompt =
    options.continuationPrompt ??
    (savedSession
      ? await responsibilityContinuationPrompt(
          assignment,
          options.input,
          assignmentSnapshotFile,
          options.refreshAssignment ?? false,
        )
      : assignment)

  if (options.config.transport === 'codex') {
    const structuredOutcomeFile = join(options.bundle.runtimeScratchDir, 'vendor-outcome.json')
    await Bun.write(structuredOutcomeFile, '')
    const cmd = [options.config.binary ?? 'codex']
    appendCodexHttpsOnlyConfig(cmd)
    const sandbox = options.fullAccess
      ? 'danger-full-access'
      : options.config.sandbox === 'danger-full-access'
        ? 'workspace-write'
        : options.config.sandbox
    cmd.push('-a', NON_INTERACTIVE_CODEX_APPROVAL_POLICY)
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
      cmd.push(
        '--output-last-message',
        structuredOutcomeFile,
        '--json',
        savedSession.sessionId,
        '-',
      )
    } else {
      cmd.push('exec', '--ignore-user-config', '--skip-git-repo-check')
      cmd.push('-s', sandbox)
      if (!options.fullAccess) {
        for (const dir of options.bundle.extraWritableRoots ?? []) cmd.push('--add-dir', dir)
      }
      if (options.config.model) cmd.push('-m', options.config.model)
      if (options.config.profile) cmd.push('-p', options.config.profile)
      for (const imageFile of options.bundle.imageFiles ?? []) cmd.push('-i', imageFile)
      cmd.push('--output-last-message', structuredOutcomeFile, '--json', '-')
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
      structuredOutcomeFile,
      assignmentSnapshotFile,
      assignmentSnapshot: assignment,
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
      '--disallowed-tools',
      NON_INTERACTIVE_CLAUDE_TOOLS.join(','),
      '--json-schema',
      JSON.stringify(roleOutcomeJsonSchema(options.input.role)),
    ]
    appendClaudeNonInteractivePermission(cmd)
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
      assignmentSnapshotFile,
      assignmentSnapshot: assignment,
    }
  }

  const opencodeConfigPath = join(options.bundle.runtimeScratchDir, 'opencode.json')
  const opencodeRoots = [
    options.runtimeWorkspace,
    ...(options.bundle.extraReadableRoots ?? []),
    ...(options.bundle.extraWritableRoots ?? []),
  ].filter((root): root is string => Boolean(root))
  await mkdir(dirname(opencodeConfigPath), { recursive: true })
  await Bun.write(
    opencodeConfigPath,
    `${JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        compaction: { auto: true },
        permission: options.fullAccess
          ? { '*': 'allow' }
          : {
              '*': 'allow',
              external_directory: externalDirectoryPermissions(opencodeRoots),
            },
      },
      null,
      2,
    )}\n`,
  )
  const cmd = [options.config.binary ?? 'opencode', '--pure', 'run', '--format', 'json']
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
    env: { ...env, OPENCODE_CONFIG: opencodeConfigPath },
    stdin: prompt,
    transcriptFormat: 'opencode_json',
    sessionTransport: 'opencode',
    assignmentSnapshotFile,
    assignmentSnapshot: assignment,
  }
}

function responsibilityExecutionEnvelope(options: {
  config: RoleTransportConfig
  bundle: TransportContextBundle
  input: ConfiguredTransportInvocation
  fullAccess?: boolean
  runtimeWorkspace?: string
}): ExecutionEnvelope {
  const transport = options.config.transport ?? 'process'
  const runtimeWorkspace =
    options.runtimeWorkspace ??
    options.bundle.extraWritableRoots?.[0] ??
    options.bundle.runtimeScratchDir
  if (options.fullAccess) {
    return {
      transport,
      mode: 'unrestricted',
      runtimeWorkspace: displayExecutionPath(runtimeWorkspace, options.bundle),
      runtimeWorkspaceRole: 'responsibility workspace',
      runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable',
      readableRoots: ['*'],
      writableRoots: ['*'],
      networkAccess: true,
      subprocessAccess: true,
      privilegeEscalation: false,
      hostEnvironmentMutation: true,
      linkedSourceAccess: 'read-write',
      canonicalMutation: 'coordinator-publication-only',
      runScratch: '$HOPI_SESSION_WORKSPACE',
      cacheDirectory: '$HOPI_CACHE_DIR',
    }
  }
  if (transport === 'process') {
    return {
      transport,
      mode: 'provider-managed',
      runtimeWorkspace: displayExecutionPath(runtimeWorkspace, options.bundle),
      runtimeWorkspaceRole: 'responsibility workspace',
      runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable',
      readableRoots: null,
      writableRoots: null,
      networkAccess: null,
      subprocessAccess: null,
      privilegeEscalation: false,
      hostEnvironmentMutation: null,
      linkedSourceAccess: 'provider-managed',
      canonicalMutation: 'coordinator-publication-only',
      runScratch: '$HOPI_SESSION_WORKSPACE',
      cacheDirectory: '$HOPI_CACHE_DIR',
    }
  }
  const writableRoots = [runtimeWorkspace, ...(options.bundle.extraWritableRoots ?? [])]
  const readableRoots = [...writableRoots, ...(options.bundle.extraReadableRoots ?? [])]
  const codexReadOnly = 'sandbox' in options.config && options.config.sandbox === 'read-only'
  const linkedSourceWritable = (options.bundle.extraReadableRoots ?? []).some((root) =>
    writableRoots.includes(root),
  )
  return {
    transport,
    mode: codexReadOnly ? 'read-only' : 'bounded',
    runtimeWorkspace: displayExecutionPath(runtimeWorkspace, options.bundle),
    runtimeWorkspaceRole: 'responsibility workspace',
    runtimeWorkspaceProductEffect: 'non-canonical and not operator-addressable',
    readableRoots: [...new Set(readableRoots)].map((path) =>
      displayExecutionPath(path, options.bundle),
    ),
    writableRoots: codexReadOnly
      ? []
      : [...new Set(writableRoots)].map((path) => displayExecutionPath(path, options.bundle)),
    networkAccess: !codexReadOnly,
    subprocessAccess: !codexReadOnly,
    privilegeEscalation: false,
    hostEnvironmentMutation: false,
    linkedSourceAccess: codexReadOnly || !linkedSourceWritable ? 'read-only' : 'read-write',
    canonicalMutation: 'coordinator-publication-only',
    runScratch: '$HOPI_SESSION_WORKSPACE',
    cacheDirectory: '$HOPI_CACHE_DIR',
  }
}

function displayExecutionPath(path: string, bundle: TransportContextBundle) {
  const aliases = [
    [bundle.runRoot, '$HOPI_RUN_DIR'],
    [bundle.runtimeScratchDir, '$HOPI_SESSION_WORKSPACE'],
    [bundle.runtimeCacheDir, '$HOPI_CACHE_DIR'],
    [bundle.primaryRepoRoot, '$HOPI_PRIMARY_REPO_ROOT'],
    [bundle.authorityRoot, '$HOPI_AUTHORITY_ROOT'],
    [bundle.proposalRoot, '$HOPI_PROPOSAL_ROOT'],
  ] as const
  return aliases.find(([candidate]) => candidate === path)?.[1] ?? path
}

function externalDirectoryPermissions(roots: readonly string[]) {
  return {
    '*': 'deny',
    ...Object.fromEntries(
      [...new Set(roots)].map((root) => [`${root.replace(/\/$/, '')}/**`, 'allow']),
    ),
  }
}

async function responsibilityContinuationPrompt(
  assignment: string,
  input: ConfiguredTransportInvocation,
  snapshotFile: string,
  refreshAssignment: boolean,
) {
  if (refreshAssignment) {
    return [
      '# Re-ground Responsibility Session',
      '',
      `Current responsibility: ${input.role ?? input.stepId}. Current Work: ${input.taskRef ?? input.stepId}.`,
      'The complete current assignment below replaces the remembered assignment.',
      '',
      assignment,
    ].join('\n')
  }
  const previous = await Bun.file(snapshotFile)
    .text()
    .catch(() => '')
  const changes = previous ? changedAssignmentSections(previous, assignment) : [assignment]
  return [
    '# Continue Responsibility Session',
    '',
    `Current responsibility: ${input.role ?? input.stepId}. Current Work: ${input.taskRef ?? input.stepId}.`,
    previous
      ? changes.length > 0
        ? 'Each section below replaces the remembered section with the same identifier.'
        : 'No assignment section changed.'
      : 'No previous assignment snapshot was available; the complete assignment follows.',
    '',
    ...changes,
  ].join('\n')
}

function changedAssignmentSections(previous: string, current: string) {
  if (previous === current) return []
  const before = assignmentSections(previous)
  const after = assignmentSections(current)
  if (!before || !after) return [current]
  const beforeByKey = new Map(before.map((section) => [section.key, section.content]))
  const afterKeys = new Set(after.map((section) => section.key))
  const changed = after
    .filter((section) => beforeByKey.get(section.key) !== section.content)
    .map((section) => section.content)
  const removed = before.map((section) => section.key).filter((key) => !afterKeys.has(key))
  if (removed.length > 0) {
    changed.push(
      [
        '## Removed Assignment Sections',
        '',
        'The following remembered section identifiers are no longer part of the current assignment:',
        ...removed.map((id) => `- ${id}`),
      ].join('\n'),
    )
  }
  return changed
}

function assignmentSections(source: string) {
  const pattern =
    /<!-- HOPI_ASSIGNMENT_SECTION_BEGIN:([a-z-]+) -->\n([\s\S]*?)\n<!-- HOPI_ASSIGNMENT_SECTION_END:\1 -->/g
  const matches = [...source.matchAll(pattern)]
  if (matches.length === 0) return null
  const sections: Array<{ key: string; content: string }> = []
  for (const match of matches) {
    sections.push({
      key: match[1] ?? '',
      content: match[0],
    })
  }
  return sections
}

function roleOutcomeJsonSchema(role: string | undefined) {
  const results =
    role === 'planner' || role === 'generator'
      ? ['success', 'attention', 'fail']
      : ['success', 'reject', 'attention', 'fail']
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      result: { type: 'string', enum: results },
      summary: { type: 'string', minLength: 1 },
      artifacts: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['result', 'summary', 'artifacts'],
  }
}

function buildTransportEnv(bundle: TransportContextBundle, input: ConfiguredTransportInvocation) {
  return {
    HOPI_RUN_SCRATCH: bundle.runtimeScratchDir,
    HOPI_SESSION_WORKSPACE: bundle.runtimeScratchDir,
    HOPI_CACHE_DIR: bundle.runtimeCacheDir,
    ...(bundle.runRoot ? { HOPI_RUN_DIR: bundle.runRoot } : {}),
    ...(bundle.authorityRoot ? { HOPI_AUTHORITY_ROOT: bundle.authorityRoot } : {}),
    ...(bundle.proposalRoot ? { HOPI_PROPOSAL_ROOT: bundle.proposalRoot } : {}),
    ...(bundle.attentionProposalDir
      ? { HOPI_ATTENTION_PROPOSAL_DIR: bundle.attentionProposalDir }
      : {}),
    ...(bundle.primaryRepoRoot ? { HOPI_PRIMARY_REPO_ROOT: bundle.primaryRepoRoot } : {}),
    ...(bundle.bootstrapSourceRoot
      ? { HOPI_BOOTSTRAP_SOURCE_ROOT: bundle.bootstrapSourceRoot }
      : {}),
    ...(bundle.operatorPreferenceFile
      ? { HOPI_OPERATOR_PREFERENCE_FILE: bundle.operatorPreferenceFile }
      : {}),
    HOPI_CONTEXT_FILE: bundle.contextFile,
    ...(bundle.artifactManifestFile
      ? { HOPI_EVIDENCE_ARTIFACTS_FILE: bundle.artifactManifestFile }
      : {}),
    HOPI_OUTCOME_FILE: bundle.outcomeFile,
    HOPI_GOAL_FILE: bundle.goalFile,
    HOPI_DESIGN_FILE: bundle.designFile,
    HOPI_PROMPT_FILE: bundle.promptFile,
    HOPI_BROWSER_HARNESS_DIR: bundle.browserHarnessDir,
    ...(bundle.browserHarnessCommand
      ? { HOPI_BROWSER_HARNESS_COMMAND: bundle.browserHarnessCommand }
      : {}),
    HOPI_BROWSER_HARNESS_ARTIFACT_DIR: bundle.browserHarnessArtifactDir,
    ...(bundle.reposFile ? { HOPI_REPOS_FILE: bundle.reposFile } : {}),
    ...(bundle.formalReleasePreviewFile
      ? { HOPI_FORMAL_RELEASE_PREVIEW_FILE: bundle.formalReleasePreviewFile }
      : {}),
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
    BROWSER_HARNESS_COMMAND: options.bundle.browserHarnessCommand ?? '',
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
