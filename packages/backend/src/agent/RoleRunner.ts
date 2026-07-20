import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ProjectCodingReasoningEffort } from '../domain/projectCodingDefaults'
import { BoundedLineTail } from '../runtime/boundedLineTail'
import { createProcessGroupTerminator } from '../runtime/processGroup'
import type { Responsibility, RoleContextBundle } from '../runtime/roleContextStager'
import type { AgentRuntimeEvent, AgentTranscriptTransport } from './runtimeEvents'
import {
  type AssistantTransport,
  type VendorSession,
  isExplicitSessionFailure,
  parseVendorAssistantOutput,
} from './vendorAssistantOutput'
import {
  type ProcessTranscriptFormat,
  isNonFatalProcessDiagnostic,
  normalizeProcessOutputLine,
} from './vendorTranscript'
import { type RoleTransportConfig, resolveConfiguredTransportCommand } from './vendorTransport'

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
  fullAccess?(input: RoleRunInput): boolean
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
    await observer?.onExecution?.(roleExecutionIdentity(config))
    const transport = resumableTransport(config)
    let session = transport && input.session?.transport === transport ? input.session : null
    if (input.session && !session) {
      await observer?.onEvent?.({
        kind: 'message',
        level: 'info',
        role: 'coordinator',
        content: 'Configured responsibility transport changed; starting a new Session.',
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

    const execute = async () => {
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
        fullAccess: this.fullAccess(input),
      })
      return executeProcess(command, input, observer, this.heartbeatMs, transcriptFile, session)
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
    const { exitCode, stderr, terminalError } = execution

    if (input.signal?.aborted) {
      return failedResult(`${input.responsibility} Run was interrupted`, exitCode)
    }

    const workflowAfter = await workflowDocumentStatus(input)
    if (workflowBefore !== workflowAfter || workflowAfter !== '') {
      return failedResult(
        `${input.responsibility} modified canonical .hopi content in its task worktree`,
        exitCode,
      )
    }
    if (reviewerBefore !== null && reviewerBefore !== (await sourceRootsFingerprint(sourceRoots))) {
      return failedResult('reviewer modified a task worktree', exitCode)
    }
    if (terminalError) {
      return failedResult(terminalError, exitCode)
    }
    if (exitCode !== 0) {
      return failedResult(
        stderr.at(-1)
          ? `process exited with code ${exitCode}: ${stderr.at(-1)}`
          : `process exited with code ${exitCode}`,
        exitCode,
      )
    }

    const parsed = await readResult(input.context.resultFile)
    if (!parsed.success) {
      return failedResult(parsed.error, exitCode)
    }
    if (!resultAllowed(input.responsibility, parsed.value.result)) {
      return failedResult(`${input.responsibility} cannot return ${parsed.value.result}`, exitCode)
    }
    return { ...parsed.value, exitCode }
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

async function readResult(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return { success: false as const, error: 'responsibility did not write result.json' }
  }
  const source = await file.text()
  if (!source.trim()) {
    return { success: false as const, error: 'responsibility wrote an empty result.json' }
  }
  try {
    const parsed = roleResultSchema.safeParse(JSON.parse(source))
    if (!parsed.success) {
      return {
        success: false as const,
        error: `invalid result.json: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`,
      }
    }
    return { success: true as const, value: parsed.data }
  } catch (error) {
    return { success: false as const, error: `invalid result.json: ${errorMessage(error)}` }
  }
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
) {
  const tempDir = join(input.context.runtimeScratchDir, 'tmp')
  const cacheDir = input.context.runtimeCacheDir
  await Promise.all([mkdir(tempDir, { recursive: true }), mkdir(cacheDir, { recursive: true })])
  const child = Bun.spawn(command.cmd, {
    cwd: input.cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: command.stdin === undefined ? 'ignore' : 'pipe',
    env: {
      ...process.env,
      TMPDIR: tempDir,
      TMP: tempDir,
      TEMP: tempDir,
      BUN_TMPDIR: tempDir,
      XDG_CACHE_HOME: cacheDir,
      npm_config_cache: join(cacheDir, 'npm'),
      PIP_CACHE_DIR: join(cacheDir, 'pip'),
      ...command.env,
    },
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
          await emitLine(observer, format, 'stderr', input, line)
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
            })
          }
          if (output.terminalError) {
            terminalError = output.terminalError.message
            sessionInvalid ||= output.terminalError.sessionInvalid
          }
        }
        await emitLine(observer, format, 'stdout', input, line)
      }),
      consumeLines(child.stderr as ReadableStream<Uint8Array>, async (line) => {
        await recordLine('stderr', line)
        if (!isNonFatalProcessDiagnostic({ format, stream: 'stderr', line })) stderr.push(line)
        if (session && isExplicitSessionFailure(line)) sessionInvalid = true
        await emitLine(observer, format, 'stderr', input, line)
      }),
    ])
    await transcriptTail
    return { exitCode, stderr: stderr.values(), terminalError, sessionInvalid }
  } finally {
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function emitLine(
  observer: RoleRunObserver | undefined,
  format: ProcessTranscriptFormat,
  stream: 'stdout' | 'stderr',
  input: RoleRunInput,
  line: string,
) {
  for (const event of normalizeProcessOutputLine({
    format,
    stream,
    role: input.responsibility,
    line,
  })) {
    await observer?.onEvent?.(event)
  }
}

function failedResult(summary: string, exitCode: number | null = null): RoleRunResult {
  return { result: 'fail', summary, artifacts: [], exitCode, failureKind: 'operational' }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
