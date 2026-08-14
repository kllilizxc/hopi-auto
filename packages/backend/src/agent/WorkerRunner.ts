import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ProjectCodingReasoningEffort } from '../domain/projectCodingDefaults'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { ensureManagedBrowser } from '../runtime/browserEnvironment'
import { createProcessGroupTerminator } from '../runtime/processGroup'
import type { RunTermination, RunWorkspaceMode } from '../runtime/runRequest'
import type { WorkerContextBundle } from '../runtime/workerContextStager'
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
  type AgentTransportConfig,
  resolveConfiguredTransportCommand,
  withNativeCompactionEnabled,
} from './vendorTransport'

export interface WorkerSession extends VendorSession {
  executionKey: string
}

export interface WorkerRunInput {
  projectId: string
  goalId: string
  workId: string
  runId: string
  workspaceMode: RunWorkspaceMode
  cwd: string
  sourceRoots?: readonly string[]
  context: WorkerContextBundle
  session?: WorkerSession | null
  refreshAssignment?: boolean
  signal?: AbortSignal
}

export interface WorkerRunResult {
  reportMarkdown: string
  artifacts: readonly string[]
  exitCode: number | null
  termination: RunTermination
}

export interface WorkerExecutionIdentity {
  transport: AgentTranscriptTransport
  model: string | null
  reasoningEffort: ProjectCodingReasoningEffort | null
}

export interface WorkerRunObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onExecution?(execution: WorkerExecutionIdentity): Promise<void> | void
  onHeartbeat?(): Promise<void> | void
  onSession?(session: WorkerSession): Promise<void> | void
  onSessionInvalid?(): Promise<void> | void
}

export interface WorkerRunner {
  run(input: WorkerRunInput, observer?: WorkerRunObserver): Promise<WorkerRunResult>
}

export interface ConfiguredWorkerRunnerOptions {
  resolveConfig(input: WorkerRunInput): AgentTransportConfig | Promise<AgentTransportConfig>
  fullAccess?(input: WorkerRunInput): boolean | Promise<boolean>
  prepareManagedBrowser?(homeRoot: string): Promise<unknown>
  heartbeatMs?: number
}

export class ConfiguredWorkerRunner implements WorkerRunner {
  private readonly resolveConfig: ConfiguredWorkerRunnerOptions['resolveConfig']
  private readonly fullAccess: NonNullable<ConfiguredWorkerRunnerOptions['fullAccess']>
  private readonly prepareManagedBrowser: NonNullable<
    ConfiguredWorkerRunnerOptions['prepareManagedBrowser']
  >
  private readonly heartbeatMs: number

  constructor(options: ConfiguredWorkerRunnerOptions) {
    this.resolveConfig = options.resolveConfig
    this.fullAccess = options.fullAccess ?? (() => false)
    this.prepareManagedBrowser = options.prepareManagedBrowser ?? ensureManagedBrowser
    this.heartbeatMs = options.heartbeatMs ?? 10_000
  }

  async run(input: WorkerRunInput, observer?: WorkerRunObserver): Promise<WorkerRunResult> {
    const config = await this.resolveConfig(input)
    const fullAccess = input.workspaceMode === 'isolated_write' && (await this.fullAccess(input))
    await observer?.onExecution?.(workerExecutionIdentity(config))
    if (input.context.browserHarnessCommand && input.context.browserHome) {
      try {
        await this.prepareManagedBrowser(input.context.browserHome)
      } catch (error) {
        return factualResult('crashed', `Managed browser preflight failed: ${errorMessage(error)}`)
      }
    }
    const transport = resumableTransport(config)
    const executionKey = workerSessionExecutionKey(config, fullAccess, input.cwd)
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
          'Configured Worker execution boundary changed; starting a new Session while retaining its workspace.',
      })
      await observer?.onSessionInvalid?.()
    }

    const workflowBefore = await workflowDocumentStatus(input)
    const sourceRoots = input.sourceRoots?.length ? input.sourceRoots : [input.cwd]
    const readOnlyBefore =
      input.workspaceMode === 'read_only' ? await sourceRootsFingerprint(sourceRoots) : null
    await Bun.write(input.context.reportFile, '')
    const transcriptFile = join(input.context.runRoot, 'transcript.log')
    await Bun.write(transcriptFile, '')

    const execute = async (continuationPrompt?: string) => {
      await Bun.write(input.context.reportFile, '')
      const command = await resolveConfiguredTransportCommand({
        config,
        bundle: input.context,
        input: {
          projectId: input.projectId,
          goalKey: input.goalId,
          taskRef: input.workId,
          runId: input.runId,
          stepId: input.workId,
          agent: 'worker',
        },
        session,
        fullAccess,
        runtimeWorkspace: input.cwd,
        continuationPrompt,
        refreshAssignment: input.refreshAssignment,
        workspaceMode: input.workspaceMode,
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
        content: 'Resuming the existing Worker Session for this Run.',
      })
    }

    let execution: Awaited<ReturnType<typeof execute>>
    try {
      execution = await execute()
      if (execution.sessionInvalid) {
        await observer?.onSessionInvalid?.()
      }
    } catch (error) {
      return factualResult('crashed', `Unable to run Worker: ${errorMessage(error)}`)
    }
    const processFailure = executionFailure(input, execution)
    if (processFailure) return processFailure

    const workflowAfter = await workflowDocumentStatus(input)
    if (workflowBefore !== workflowAfter || workflowAfter !== '') {
      return factualResult(
        'crashed',
        'Worker modified canonical .hopi content in its task worktree',
        execution.exitCode,
      )
    }
    if (readOnlyBefore !== null && readOnlyBefore !== (await sourceRootsFingerprint(sourceRoots))) {
      return factualResult('crashed', 'read-only Run modified a task worktree', execution.exitCode)
    }
    const reportFile = Bun.file(input.context.reportFile)
    const reportFromFile = (await reportFile.exists()) ? (await reportFile.text()).trim() : ''
    const reportMarkdown =
      execution.finalText?.trim() ||
      reportFromFile ||
      factualReport(
        'normal',
        'Worker exited normally without a final natural-language response.',
        execution.exitCode,
      )
    await Bun.write(input.context.reportFile, `${reportMarkdown.trim()}\n`)
    return {
      reportMarkdown,
      artifacts: [],
      exitCode: execution.exitCode,
      termination: 'normal',
    }
  }
}

function workerExecutionIdentity(config: AgentTransportConfig): WorkerExecutionIdentity {
  if ('cmd' in config) return { transport: 'process', model: null, reasoningEffort: null }
  return {
    transport: config.transport,
    model: config.model ?? null,
    reasoningEffort: config.transport === 'codex' ? (config.reasoningEffort ?? null) : null,
  }
}

function resumableTransport(config: AgentTransportConfig): AssistantTransport | null {
  if ('cmd' in config) return null
  return config.transport
}

export function workerSessionExecutionKey(
  config: AgentTransportConfig,
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

type ProcessExecution = Awaited<ReturnType<typeof executeProcess>>

function executionFailure(
  input: WorkerRunInput,
  execution: ProcessExecution,
): WorkerRunResult | null {
  if (input.signal?.aborted) {
    const termination = abortedTermination(input.signal)
    return factualResult(termination, `Worker Run was ${termination}.`, execution.exitCode)
  }
  if (execution.terminalError) {
    return factualResult(
      timeoutTermination(execution.terminalError),
      execution.terminalError,
      execution.exitCode,
    )
  }
  if (execution.exitCode !== 0) {
    const detail = execution.stderr.at(-1)
      ? `process exited with code ${execution.exitCode}: ${execution.stderr.at(-1)}`
      : `process exited with code ${execution.exitCode}`
    return factualResult(timeoutTermination(detail), detail, execution.exitCode)
  }
  return null
}

async function workflowDocumentStatus(input: WorkerRunInput) {
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
    throw new Error('A resumable Worker transport requires an execution key')
  }
  return executionKey
}

async function executeProcess(
  command: Awaited<ReturnType<typeof resolveConfiguredTransportCommand>>,
  input: WorkerRunInput,
  observer: WorkerRunObserver | undefined,
  heartbeatMs: number,
  transcriptFile: string,
  session: WorkerSession | null,
  executionKey: string | null,
) {
  const tempDir = await mkdtemp('/tmp/hopi-worker-')
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
  input: WorkerRunInput,
  observer: WorkerRunObserver | undefined,
  heartbeatMs: number,
  transcriptFile: string,
  session: WorkerSession | null,
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
      console.error('[worker heartbeat error]', error),
    )
  }, heartbeatMs)
  const stderr = new BoundedLineTail()
  let observedSessionId = session?.sessionId ?? null
  let sessionInvalid = false
  let terminalError: string | null = null
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
    if (!finalText && command.finalOutputFile) {
      const candidate = await Bun.file(command.finalOutputFile).text()
      if (candidate.trim()) finalText = candidate
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
      finalText,
    }
  } finally {
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function emitLine(
  observer: WorkerRunObserver | undefined,
  transcriptNormalizer: PersistentProcessTranscriptNormalizer,
  format: ProcessTranscriptFormat,
  stream: 'stdout' | 'stderr',
  _input: WorkerRunInput,
  line: string,
) {
  const events = await transcriptNormalizer.normalize({
    format,
    stream,
    role: 'worker',
    line,
  })
  for (const event of events) {
    await observer?.onEvent?.(event)
  }
}

function factualResult(
  termination: RunTermination,
  detail: string,
  exitCode: number | null = null,
): WorkerRunResult {
  return {
    reportMarkdown: factualReport(termination, detail, exitCode),
    artifacts: [],
    exitCode,
    termination,
  }
}

function factualReport(termination: RunTermination, detail: string, exitCode: number | null) {
  return [
    '# Run report',
    '',
    `- Termination: ${termination}`,
    `- Exit code: ${exitCode ?? 'unavailable'}`,
    '',
    detail.trim() || 'The Run ended without an additional diagnostic.',
  ].join('\n')
}

function abortedTermination(signal: AbortSignal): RunTermination {
  const reason = signal.reason
  if (
    typeof reason === 'object' &&
    reason !== null &&
    'termination' in reason &&
    ['cancelled', 'interrupted', 'timed_out'].includes(String(reason.termination))
  ) {
    return reason.termination as RunTermination
  }
  return 'interrupted'
}

function timeoutTermination(detail: string): RunTermination {
  return /tim(?:e|ed)[ -]?out|timeout/i.test(detail) ? 'timed_out' : 'crashed'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
