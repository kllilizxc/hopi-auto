import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { ProjectCodingReasoningEffort } from '../domain/projectCodingDefaults'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { createProcessGroupTerminator } from '../runtime/processGroup'
import type { Responsibility, RoleContextBundle } from '../runtime/roleContextStager'
import {
  type PersistentProcessTranscriptNormalizer,
  createPersistentProcessTranscriptNormalizer,
} from './persistentTranscriptNormalizer'
import type { AgentRuntimeEvent, AgentTranscriptTransport } from './runtimeEvents'
import {
  type AssistantTransport,
  type VendorSession,
  isExplicitSessionFailure,
  parseVendorAssistantOutput,
} from './vendorAssistantOutput'
import { type ProcessTranscriptFormat, isNonFatalProcessDiagnostic } from './vendorTranscript'
import {
  type RoleTransportConfig,
  resolveConfiguredTransportCommand,
  withNativeCompactionEnabled,
} from './vendorTransport'

export const PASS_RESULTS = ['success', 'reject', 'attention', 'fail'] as const
export const STORED_PASS_RESULTS = [...PASS_RESULTS, 'replan'] as const
export type PassResultKind = (typeof PASS_RESULTS)[number]
export type StoredPassResultKind = (typeof STORED_PASS_RESULTS)[number]

const roleResultSchema = z
  .object({
    result: z.enum(PASS_RESULTS),
    summary: z.string().trim().min(1),
    artifacts: z.array(z.string().min(1)).default([]),
  })
  .strict()

export interface RoleRunInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  cwd: string
  sourceRoots?: readonly string[]
  context: RoleContextBundle
  session?: VendorSession | null
  refreshAssignment?: boolean
  signal?: AbortSignal
}

export interface RoleRunResult {
  result: PassResultKind
  summary: string
  artifacts: readonly string[]
  exitCode: number | null
  failureKind?: 'operational'
}

export interface RoleExecutionIdentity {
  transport: AgentTranscriptTransport
  model: string | null
  reasoningEffort: ProjectCodingReasoningEffort | null
}

export interface RoleRunObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onExecution?(execution: RoleExecutionIdentity): Promise<void> | void
  onHeartbeat?(): Promise<void> | void
  onSession?(session: VendorSession): Promise<void> | void
  onSessionInvalid?(): Promise<void> | void
}

export interface RoleRunner {
  run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult>
}

export interface ConfiguredRoleRunnerOptions {
  resolveConfig(input: RoleRunInput): RoleTransportConfig | Promise<RoleTransportConfig>
  fullAccess?(input: RoleRunInput): boolean | Promise<boolean>
  heartbeatMs?: number
}

export class ConfiguredRoleRunner implements RoleRunner {
  private readonly resolveConfig: ConfiguredRoleRunnerOptions['resolveConfig']
  private readonly fullAccess: NonNullable<ConfiguredRoleRunnerOptions['fullAccess']>
  private readonly heartbeatMs: number

  constructor(options: ConfiguredRoleRunnerOptions) {
    this.resolveConfig = options.resolveConfig
    this.fullAccess = options.fullAccess ?? (() => false)
    this.heartbeatMs = options.heartbeatMs ?? 10_000
  }

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    const config = await this.resolveConfig(input)
    const fullAccess = await this.fullAccess(input)
    await observer?.onExecution?.(roleExecutionIdentity(config))
    const transport = resumableTransport(config)
    const compatibilityKey = roleSessionCompatibilityKey(config, fullAccess, input.cwd)
    let session =
      transport &&
      input.session?.transport === transport &&
      input.session.compatibilityKey === compatibilityKey
        ? input.session
        : null
    if (input.session && !session) {
      await observer?.onEvent?.({
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content:
          'Configured responsibility execution boundary changed; starting a new Session while retaining its workspace.',
      })
      await observer?.onSessionInvalid?.()
    }

    const workflowBefore = await workflowDocumentStatus(input)
    const sourceRoots = input.sourceRoots?.length ? input.sourceRoots : [input.cwd]
    const reviewerBefore =
      input.responsibility === 'reviewer' ? await sourceRootsFingerprint(sourceRoots) : null
    await Bun.write(input.context.resultFile, '')
    const transcriptFile = join(input.context.runRoot, 'transcript.log')
    await Bun.write(transcriptFile, '')

    const execute = async (continuationPrompt?: string) => {
      await Bun.write(input.context.resultFile, '')
      const command = await resolveConfiguredTransportCommand({
        config,
        bundle: input.context,
        input: {
          projectId: input.projectId,
          goalKey: input.goalId,
          taskRef: input.workId,
          runId: input.runId,
          stepId: input.responsibility,
          role: input.responsibility,
        },
        session,
        fullAccess,
        runtimeWorkspace: input.cwd,
        continuationPrompt,
        refreshAssignment: input.refreshAssignment,
      })
      return executeProcess(
        command,
        input,
        observer,
        this.heartbeatMs,
        transcriptFile,
        session,
        compatibilityKey,
      )
    }

    if (session) {
      await observer?.onEvent?.({
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content: `Resuming the existing ${input.responsibility} Session for this Work.`,
      })
    }

    let execution: Awaited<ReturnType<typeof execute>>
    try {
      execution = await execute()
      if (session && execution.sessionInvalid && !input.signal?.aborted) {
        await observer?.onEvent?.({
          kind: 'message',
          level: 'info',
          role: 'coordinator',
          content:
            'The saved responsibility Session could not continue; rebuilding it once from the current assignment.',
        })
        await observer?.onSessionInvalid?.()
        session = null
        execution = await execute()
      }
    } catch (error) {
      return failedResult(`Unable to run ${input.responsibility}: ${errorMessage(error)}`)
    }
    let processFailure = executionFailure(input, execution)
    if (processFailure) return processFailure

    let parsed = await readResult(input.context.resultFile, execution)
    if (
      !parsed.success &&
      transport !== null &&
      execution.session !== null &&
      !input.signal?.aborted
    ) {
      const recoveryCause = outcomeRecoveryCause(parsed.error, execution.interactiveTool)
      await observer?.onEvent?.({
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content: `${recoveryCause} Continuing the same Session once inside this Run to complete the responsibility outcome.`,
      })
      session = execution.session
      let recovery: ProcessExecution
      try {
        recovery = await execute(outcomeRecoveryPrompt(input.responsibility))
      } catch (error) {
        return failedResult(
          `${recoveryCause} Same-Run outcome recovery could not start: ${errorMessage(error)}`,
          execution.exitCode,
        )
      }
      if (recovery.sessionInvalid) await observer?.onSessionInvalid?.()
      execution = combineExecutions(execution, recovery)
      processFailure = executionFailure(input, execution)
      if (processFailure) return processFailure
      parsed = await readResult(input.context.resultFile, execution)
      if (!parsed.success) {
        await observer?.onSessionInvalid?.()
        return failedResult(
          `${recoveryCause} Same-Run outcome recovery also failed: ${parsed.error}`,
          execution.exitCode,
        )
      }
    }

    const workflowAfter = await workflowDocumentStatus(input)
    if (workflowBefore !== workflowAfter || workflowAfter !== '') {
      return failedResult(
        `${input.responsibility} modified canonical .hopi content in its task worktree`,
        execution.exitCode,
      )
    }
    if (reviewerBefore !== null && reviewerBefore !== (await sourceRootsFingerprint(sourceRoots))) {
      return failedResult('reviewer modified a task worktree', execution.exitCode)
    }

    if (!parsed.success) {
      return failedResult(parsed.error, execution.exitCode)
    }
    if (!resultAllowed(input.responsibility, parsed.value.result)) {
      return failedResult(
        `${input.responsibility} cannot return ${parsed.value.result}`,
        execution.exitCode,
      )
    }
    if (parsed.value.result === 'success' && execution.infrastructureFailure) {
      await observer?.onSessionInvalid?.()
      return failedResult(
        `${input.responsibility} reported success while a required execution capability remained unavailable: ${execution.infrastructureFailure}`,
        execution.exitCode,
      )
    }
    if (
      parsed.value.result === 'success' &&
      input.responsibility === 'generator' &&
      transport !== null &&
      !execution.completedExecution
    ) {
      await observer?.onSessionInvalid?.()
      return failedResult(
        'generator reported success without completing an execution verification in this Run',
        execution.exitCode,
      )
    }
    return { ...parsed.value, exitCode: execution.exitCode }
  }
}

function roleExecutionIdentity(config: RoleTransportConfig): RoleExecutionIdentity {
  if ('cmd' in config) return { transport: 'process', model: null, reasoningEffort: null }
  return {
    transport: config.transport,
    model: config.model ?? null,
    reasoningEffort: config.transport === 'codex' ? (config.reasoningEffort ?? null) : null,
  }
}

function resumableTransport(config: RoleTransportConfig): AssistantTransport | null {
  if ('cmd' in config) return null
  return config.transport
}

export function roleSessionCompatibilityKey(
  config: RoleTransportConfig,
  fullAccess = false,
  sessionCwd?: string,
): string | null {
  if ('cmd' in config) return null
  const executionBoundary = fullAccess ? 'unrestricted' : 'bounded'
  const sessionNamespace = sessionCwd ? resolve(sessionCwd) : null
  if (config.transport === 'codex') {
    const sandbox = fullAccess
      ? 'danger-full-access'
      : config.sandbox === 'danger-full-access'
        ? 'workspace-write'
        : config.sandbox
    return JSON.stringify({
      version: 4,
      transport: config.transport,
      binary: config.binary ?? 'codex',
      cwdMode: config.cwdMode,
      baseRef: config.baseRef ?? null,
      model: config.model ?? null,
      profile: config.profile ?? null,
      reasoningEffort: config.reasoningEffort ?? null,
      executionBoundary,
      sessionNamespace,
      sandbox,
    })
  }
  if (config.transport === 'claude') {
    return JSON.stringify({
      version: 3,
      transport: config.transport,
      binary: config.binary ?? 'claude',
      cwdMode: config.cwdMode,
      baseRef: config.baseRef ?? null,
      model: config.model ?? null,
      executionBoundary,
      sessionNamespace,
    })
  }
  return JSON.stringify({
    version: 3,
    transport: config.transport,
    binary: config.binary ?? 'opencode',
    cwdMode: config.cwdMode,
    baseRef: config.baseRef ?? null,
    model: config.model ?? null,
    agent: config.agent ?? null,
    variant: config.variant ?? null,
    executionBoundary,
    sessionNamespace,
  })
}

export class MockRoleRunner implements RoleRunner {
  private readonly results: RoleRunResult[]

  constructor(results: RoleRunResult[] = []) {
    this.results = [...results]
  }

  async run(): Promise<RoleRunResult> {
    return (
      this.results.shift() ?? {
        result: 'success',
        summary: 'Mock responsibility completed.',
        artifacts: [],
        exitCode: 0,
      }
    )
  }
}

function resultAllowed(responsibility: Responsibility, result: PassResultKind) {
  if (responsibility === 'planner') {
    return result === 'success' || result === 'attention' || result === 'fail'
  }
  if (responsibility === 'generator') return result !== 'reject'
  return true
}

type ProcessExecution = Awaited<ReturnType<typeof executeProcess>>

function executionFailure(input: RoleRunInput, execution: ProcessExecution): RoleRunResult | null {
  if (input.signal?.aborted) {
    return failedResult(`${input.responsibility} Run was interrupted`, execution.exitCode)
  }
  if (execution.terminalError) {
    return failedResult(execution.terminalError, execution.exitCode)
  }
  if (execution.exitCode !== 0) {
    return failedResult(
      execution.stderr.at(-1)
        ? `process exited with code ${execution.exitCode}: ${execution.stderr.at(-1)}`
        : `process exited with code ${execution.exitCode}`,
      execution.exitCode,
    )
  }
  return null
}

function combineExecutions(first: ProcessExecution, second: ProcessExecution): ProcessExecution {
  return {
    ...second,
    session: second.session ?? first.session,
    sessionInvalid: first.sessionInvalid || second.sessionInvalid,
    completedExecution: first.completedExecution || second.completedExecution,
    infrastructureFailure: second.completedExecution
      ? second.infrastructureFailure
      : (second.infrastructureFailure ?? first.infrastructureFailure),
    interactiveTool: second.interactiveTool ?? first.interactiveTool,
  }
}

function outcomeRecoveryCause(error: string, interactiveTool: string | null) {
  if (interactiveTool === 'EnterPlanMode' || interactiveTool === 'ExitPlanMode') {
    return 'The non-interactive responsibility entered vendor Plan Mode and could not obtain operator approval.'
  }
  if (interactiveTool === 'AskUserQuestion') {
    return 'The non-interactive responsibility requested a direct user answer on a channel without an operator.'
  }
  return `The vendor exited without a valid responsibility outcome: ${error}.`
}

function outcomeRecoveryPrompt(responsibility: Responsibility) {
  return [
    '# Complete Current Responsibility',
    '',
    `The previous non-interactive ${responsibility} invocation ended without a valid terminal outcome.`,
    'Continue from the current Session and workspace. Retain completed discovery and edits; do not repeat Repo preparation or already-completed work.',
    "If the assignment is incomplete, continue it now through proportionate verification. Do not stop for vendor plan approval or a direct user question; use the assignment's Attention path only for authority that cannot be resolved here.",
    'During any remaining execution, progress messages use ordinary prose and never use the result schema.',
    'After execution settles, make the final assistant message exactly one responsibility outcome JSON object with no explanatory prose before or after it.',
  ].join('\n')
}

async function readResult(path: string, execution: ProcessExecution) {
  const candidateFailures: string[] = []
  if (execution.structuredOutcome !== undefined) {
    const parsed = parseResultCandidate(execution.structuredOutcome, 'structured vendor outcome')
    if (parsed.success) {
      await persistResult(path, parsed.value)
      return parsed
    }
    candidateFailures.push(parsed.error)
  }

  const file = Bun.file(path)
  if (await file.exists()) {
    const source = await file.text()
    if (source.trim()) {
      const parsed = parseResultCandidate(source, 'result.json')
      if (parsed.success) return parsed
      candidateFailures.push(parsed.error)
    }
  }

  if (execution.finalText?.trim()) {
    const parsed = parseResultCandidate(execution.finalText, 'vendor final response')
    if (parsed.success) {
      await persistResult(path, parsed.value)
      return parsed
    }
    candidateFailures.push(parsed.error)
  }

  return {
    success: false as const,
    error:
      candidateFailures[0] ??
      ((await file.exists())
        ? 'responsibility produced no terminal outcome'
        : 'responsibility result storage is missing'),
  }
}

function parseResultCandidate(candidate: unknown, source: string) {
  try {
    const value = typeof candidate === 'string' ? JSON.parse(candidate) : candidate
    const parsed = roleResultSchema.safeParse(value)
    if (!parsed.success) {
      return {
        success: false as const,
        error: `invalid ${source}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`,
      }
    }
    return { success: true as const, value: parsed.data }
  } catch (error) {
    return { success: false as const, error: `invalid ${source}: ${errorMessage(error)}` }
  }
}

async function persistResult(path: string, result: z.infer<typeof roleResultSchema>) {
  await Bun.write(path, `${JSON.stringify(result, null, 2)}\n`)
}

async function workflowDocumentStatus(input: RoleRunInput) {
  if (input.responsibility === 'planner') return ''
  const roots = input.sourceRoots?.length ? input.sourceRoots : [input.cwd]
  const statuses = await Promise.all(
    roots.map(async (root) => {
      const status = await gitOutput(root, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--',
        '.hopi',
      ])
      return status ? `${root}\n${status}` : ''
    }),
  )
  return statuses.filter(Boolean).join('\n')
}

async function sourceRootsFingerprint(roots: readonly string[]) {
  const chunks: Uint8Array[] = []
  for (const root of [...roots].sort()) {
    chunks.push(new TextEncoder().encode(root))
    chunks.push(new TextEncoder().encode(await sourceFingerprint(root)))
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  const digest = await crypto.subtle.digest('SHA-256', combined)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function sourceFingerprint(cwd: string) {
  const [diff, untracked] = await Promise.all([
    gitBytes(cwd, ['diff', '--binary', 'HEAD', '--', '.', ':(exclude).hopi/**']),
    gitOutput(cwd, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      '.',
      ':(exclude).hopi/**',
    ]),
  ])
  const chunks = [diff]
  for (const path of untracked.split('\0').filter(Boolean).sort()) {
    chunks.push(new TextEncoder().encode(path))
    chunks.push(new Uint8Array(await Bun.file(`${cwd}/${path}`).arrayBuffer()))
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  const digest = await crypto.subtle.digest('SHA-256', combined)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

async function gitOutput(cwd: string, args: string[]) {
  return new TextDecoder().decode(await gitBytes(cwd, args)).trimEnd()
}

async function gitBytes(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`)
  }
  return new Uint8Array(stdout)
}

async function consumeLines(
  stream: ReadableStream<Uint8Array>,
  consume: (line: string) => Promise<void>,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) await consume(line)
  }
  buffered += decoder.decode()
  if (buffered) await consume(buffered)
}

async function executeProcess(
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  input: RoleRunInput,
  observer: RoleRunObserver | undefined,
  heartbeatMs: number,
  transcriptFile: string,
  session: VendorSession | null,
  compatibilityKey: string | null,
) {
  const tempDir = await mkdtemp('/tmp/hopi-role-')
  try {
    return await executeProcessWithTempDir(
      command,
      input,
      observer,
      heartbeatMs,
      transcriptFile,
      session,
      compatibilityKey,
      tempDir,
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function executeProcessWithTempDir(
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  input: RoleRunInput,
  observer: RoleRunObserver | undefined,
  heartbeatMs: number,
  transcriptFile: string,
  session: VendorSession | null,
  compatibilityKey: string | null,
  tempDir: string,
) {
  const cacheDir = input.context.runtimeCacheDir
  await mkdir(cacheDir, { recursive: true })
  const normalizerStateFile = join(input.context.runtimeScratchDir, 'transcript-normalizer.json')
  const resumeNormalizerState =
    command.sessionTransport === 'claude' && session?.transport === 'claude'
  const transcriptNormalizer = await createPersistentProcessTranscriptNormalizer({
    stateFile: normalizerStateFile,
    resumeState: resumeNormalizerState,
  })
  const child = Bun.spawn(command.cmd, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: command.stdin === undefined ? 'ignore' : 'pipe',
    env: withNativeCompactionEnabled(command.sessionTransport, {
      ...process.env,
      TMPDIR: tempDir,
      TMP: tempDir,
      TEMP: tempDir,
      BUN_TMPDIR: tempDir,
      XDG_CACHE_HOME: cacheDir,
      npm_config_cache: join(cacheDir, 'npm'),
      PIP_CACHE_DIR: join(cacheDir, 'pip'),
      ...command.env,
    }),
    detached: true,
  })
  const terminate = createProcessGroupTerminator(child.pid)
  const abort = () => void terminate()
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()
  if (command.stdin !== undefined && typeof child.stdin !== 'number' && child.stdin) {
    child.stdin.write(command.stdin)
    child.stdin.end()
  }
  await observer?.onHeartbeat?.()
  const heartbeat = setInterval(() => void observer?.onHeartbeat?.(), heartbeatMs)
  const stderr = new BoundedLineTail()
  let observedSessionId = session?.sessionId ?? null
  let sessionInvalid = false
  let terminalError: string | null = null
  let structuredOutcome: unknown
  let finalText: string | null = null
  let interactiveTool: string | null = null
  let transcriptTail: Promise<void> = Promise.resolve()
  const recordLine = (stream: 'stdout' | 'stderr', line: string) => {
    transcriptTail = transcriptTail.then(() => appendFile(transcriptFile, `${stream}: ${line}\n`))
    return transcriptTail
  }

  try {
    const format = command.transcriptFormat ?? 'plain'
    const [exitCode] = await Promise.all([
      child.exited.then(async (exitCode) => {
        try {
          await terminate()
        } catch (error) {
          const line = `Process-group cleanup failed: ${errorMessage(error)}`
          stderr.push(line)
          await recordLine('stderr', line)
          await emitLine(observer, transcriptNormalizer, format, 'stderr', input, line)
          throw error
        }
        return exitCode
      }),
      consumeLines(child.stdout as ReadableStream<Uint8Array>, async (line) => {
        await recordLine('stdout', line)
        if (command.sessionTransport) {
          const output = parseVendorAssistantOutput(command.sessionTransport, line)
          if (output.sessionId && output.sessionId !== observedSessionId) {
            observedSessionId = output.sessionId
            await observer?.onSession?.({
              transport: command.sessionTransport,
              sessionId: output.sessionId,
              ...(compatibilityKey ? { compatibilityKey } : {}),
            })
          }
          if (output.terminalError) {
            terminalError = output.terminalError.message
            sessionInvalid ||= output.terminalError.sessionInvalid
          }
          if (output.structuredOutput !== undefined) {
            structuredOutcome = output.structuredOutput
          }
          if (output.finalText) finalText = output.finalText
          if (output.assistantText) finalText = output.assistantText
          if (output.interactiveTool) interactiveTool = output.interactiveTool
        }
        await emitLine(observer, transcriptNormalizer, format, 'stdout', input, line)
      }),
      consumeLines(child.stderr as ReadableStream<Uint8Array>, async (line) => {
        await recordLine('stderr', line)
        if (!isNonFatalProcessDiagnostic({ format, stream: 'stderr', line })) stderr.push(line)
        if (session && isExplicitSessionFailure(line)) sessionInvalid = true
        await emitLine(observer, transcriptNormalizer, format, 'stderr', input, line)
      }),
    ])
    await transcriptTail
    if (structuredOutcome === undefined && command.structuredOutcomeFile) {
      const candidate = await Bun.file(command.structuredOutcomeFile).text()
      if (candidate.trim()) {
        try {
          structuredOutcome = JSON.parse(candidate)
        } catch {
          finalText = candidate
        }
      }
    }
    if (
      exitCode === 0 &&
      !sessionInvalid &&
      command.sessionTransport &&
      command.assignmentSnapshotFile &&
      command.assignmentSnapshot !== undefined
    ) {
      await Bun.write(command.assignmentSnapshotFile, command.assignmentSnapshot).catch(
        () => undefined,
      )
    }
    return {
      exitCode,
      stderr: stderr.values(),
      terminalError,
      sessionInvalid,
      session:
        command.sessionTransport && observedSessionId
          ? {
              transport: command.sessionTransport,
              sessionId: observedSessionId,
              ...(compatibilityKey ? { compatibilityKey } : {}),
            }
          : null,
      structuredOutcome,
      finalText,
      interactiveTool,
      infrastructureFailure: transcriptNormalizer.unresolvedInfrastructureFailure(),
      completedExecution: transcriptNormalizer.completedExecution(),
    }
  } finally {
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function emitLine(
  observer: RoleRunObserver | undefined,
  transcriptNormalizer: PersistentProcessTranscriptNormalizer,
  format: ProcessTranscriptFormat,
  stream: 'stdout' | 'stderr',
  input: RoleRunInput,
  line: string,
) {
  const events = await transcriptNormalizer.normalize({
    format,
    stream,
    role: input.responsibility,
    line,
  })
  for (const event of events) {
    await observer?.onEvent?.(event)
  }
}

function failedResult(summary: string, exitCode: number | null = null): RoleRunResult {
  return { result: 'fail', summary, artifacts: [], exitCode, failureKind: 'operational' }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
