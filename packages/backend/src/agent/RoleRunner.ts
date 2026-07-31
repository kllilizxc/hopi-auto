import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import type { ProjectCodingReasoningEffort } from '../domain/projectCodingDefaults'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { ensureManagedBrowser } from '../runtime/browserEnvironment'
import { createProcessGroupTerminator } from '../runtime/processGroup'
import type { Responsibility, RoleContextBundle } from '../runtime/roleContextStager'
import { createEnvironmentSecretRedactor } from './environmentSecretRedactor'
import {
  type PersistentProcessTranscriptNormalizer,
  createPersistentProcessTranscriptNormalizer,
} from './persistentTranscriptNormalizer'
import type { AgentRuntimeEvent, AgentTranscriptTransport } from './runtimeEvents'
import {
  type AssistantTransport,
  type VendorSession,
  parseVendorAssistantOutput,
} from './vendorAssistantOutput'
import { type ProcessTranscriptFormat, isNonFatalProcessDiagnostic } from './vendorTranscript'
import {
  type RoleTransportConfig,
  resolveConfiguredTransportCommand,
  withNativeCompactionEnabled,
} from './vendorTransport'

export const PASS_RESULTS = ['success', 'reject', 'fail'] as const
export type PassResultKind = (typeof PASS_RESULTS)[number]

export interface ResponsibilitySession extends VendorSession {
  executionKey: string
}

const roleResultSchema = z
  .object({
    result: z.enum(PASS_RESULTS),
    summary: z.string().trim().min(1),
    artifacts: z.array(z.string().min(1)).default([]),
  })
  .strict()

const plannerResultSchema = roleResultSchema.extend({
  summary: z.string().trim().min(1).max(600),
})

export interface RoleRunInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  responsibility: Responsibility
  cwd: string
  sourceRoots?: readonly string[]
  context: RoleContextBundle
  session?: ResponsibilitySession | null
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
  onSession?(session: ResponsibilitySession): Promise<void> | void
  onSessionInvalid?(): Promise<void> | void
}

export interface RoleRunner {
  run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult>
}

export interface ConfiguredRoleRunnerOptions {
  resolveConfig(input: RoleRunInput): RoleTransportConfig | Promise<RoleTransportConfig>
  fullAccess?(input: RoleRunInput): boolean | Promise<boolean>
  prepareManagedBrowser?(homeRoot: string): Promise<unknown>
  heartbeatMs?: number
}

export class ConfiguredRoleRunner implements RoleRunner {
  private readonly resolveConfig: ConfiguredRoleRunnerOptions['resolveConfig']
  private readonly fullAccess: NonNullable<ConfiguredRoleRunnerOptions['fullAccess']>
  private readonly prepareManagedBrowser: NonNullable<
    ConfiguredRoleRunnerOptions['prepareManagedBrowser']
  >
  private readonly heartbeatMs: number

  constructor(options: ConfiguredRoleRunnerOptions) {
    this.resolveConfig = options.resolveConfig
    this.fullAccess = options.fullAccess ?? (() => false)
    this.prepareManagedBrowser = options.prepareManagedBrowser ?? ensureManagedBrowser
    this.heartbeatMs = options.heartbeatMs ?? 10_000
  }

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    const config = await this.resolveConfig(input)
    const fullAccess = await this.fullAccess(input)
    await observer?.onExecution?.(roleExecutionIdentity(config))
    if (input.context.browserHarnessCommand && input.context.browserHome) {
      try {
        await this.prepareManagedBrowser(input.context.browserHome)
      } catch (error) {
        return failedResult(`Managed browser preflight failed: ${errorMessage(error)}`)
      }
    }
    const transport = resumableTransport(config)
    const executionKey = roleSessionExecutionKey(config, fullAccess, input.cwd)
    const session =
      transport &&
      input.session?.transport === transport &&
      input.session.executionKey === executionKey
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
        executionKey,
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
      if (execution.sessionInvalid) {
        await observer?.onSessionInvalid?.()
      }
    } catch (error) {
      return failedResult(`Unable to run ${input.responsibility}: ${errorMessage(error)}`)
    }
    const processFailure = executionFailure(input, execution)
    if (processFailure) return processFailure

    const parsed = await readResult(input.context.resultFile, execution, input.responsibility)

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

export function roleSessionExecutionKey(
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

function resultAllowed(responsibility: Responsibility, result: PassResultKind) {
  if (responsibility === 'planner') return result === 'success' || result === 'fail'
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

async function readResult(
  path: string,
  execution: ProcessExecution,
  responsibility: Responsibility,
) {
  const candidateFailures: string[] = []
  if (execution.structuredOutcome !== undefined) {
    const parsed = parseResultCandidate(
      execution.structuredOutcome,
      'structured vendor outcome',
      responsibility,
    )
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
      const parsed = parseResultCandidate(source, 'result.json', responsibility)
      if (parsed.success) return parsed
      candidateFailures.push(parsed.error)
    }
  }

  if (execution.finalText?.trim()) {
    const parsed = parseResultCandidate(
      execution.finalText,
      'vendor final response',
      responsibility,
    )
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

function parseResultCandidate(candidate: unknown, source: string, responsibility: Responsibility) {
  try {
    const value = typeof candidate === 'string' ? JSON.parse(candidate) : candidate
    const parsed = (
      responsibility === 'planner' ? plannerResultSchema : roleResultSchema
    ).safeParse(value)
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

function requireExecutionKey(executionKey: string | null) {
  if (!executionKey) {
    throw new Error('A resumable responsibility transport requires an execution key')
  }
  return executionKey
}

async function executeProcess(
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  input: RoleRunInput,
  observer: RoleRunObserver | undefined,
  heartbeatMs: number,
  transcriptFile: string,
  session: ResponsibilitySession | null,
  executionKey: string | null,
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
      executionKey,
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
  session: ResponsibilitySession | null,
  executionKey: string | null,
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
  const processEnvironment = withNativeCompactionEnabled(command.sessionTransport, {
    ...process.env,
    TMPDIR: tempDir,
    TMP: tempDir,
    TEMP: tempDir,
    BUN_TMPDIR: tempDir,
    XDG_CACHE_HOME: cacheDir,
    npm_config_cache: join(cacheDir, 'npm'),
    PIP_CACHE_DIR: join(cacheDir, 'pip'),
    ...command.env,
  })
  const redact = createEnvironmentSecretRedactor(processEnvironment)
  const child = Bun.spawn(command.cmd, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: command.stdin === undefined ? 'ignore' : 'pipe',
    env: processEnvironment,
    detached: true,
  })
  const terminate = createProcessGroupTerminator(child.pid, { trackDescendants: true })
  const abort = () => void terminate()
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()
  if (command.stdin !== undefined && typeof child.stdin !== 'number' && child.stdin) {
    child.stdin.write(command.stdin)
    child.stdin.end()
  }
  await observer?.onHeartbeat?.()
  const heartbeat = setInterval(() => {
    void Promise.resolve(observer?.onHeartbeat?.()).catch((error) =>
      console.error('[role heartbeat error]', error),
    )
  }, heartbeatMs)
  const stderr = new BoundedLineTail()
  let observedSessionId = session?.sessionId ?? null
  let sessionInvalid = false
  let terminalError: string | null = null
  let structuredOutcome: unknown
  let finalText: string | null = null
  let transcriptTail: Promise<void> = Promise.resolve()
  const recordLine = (stream: 'stdout' | 'stderr', line: string) => {
    transcriptTail = transcriptTail.then(() =>
      appendFile(transcriptFile, `${stream}: ${redact(line)}\n`),
    )
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
          stderr.push(redact(line))
          await recordLine('stderr', line)
          await emitLine(observer, transcriptNormalizer, format, 'stderr', input, redact(line))
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
              executionKey: requireExecutionKey(executionKey),
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
        }
        await emitLine(observer, transcriptNormalizer, format, 'stdout', input, redact(line))
      }),
      consumeLines(child.stderr as ReadableStream<Uint8Array>, async (line) => {
        await recordLine('stderr', line)
        if (!isNonFatalProcessDiagnostic({ format, stream: 'stderr', line })) {
          stderr.push(redact(line))
        }
        await emitLine(observer, transcriptNormalizer, format, 'stderr', input, redact(line))
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
              executionKey: requireExecutionKey(executionKey),
            }
          : null,
      structuredOutcome,
      finalText,
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
