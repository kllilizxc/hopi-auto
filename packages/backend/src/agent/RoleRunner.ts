import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { Responsibility, RoleContextBundle } from '../runtime/roleContextStager'
import type { AgentRuntimeEvent } from './runtimeEvents'
import { type ProcessTranscriptFormat, normalizeProcessOutputLine } from './vendorTranscript'
import { type RoleTransportConfig, resolveConfiguredTransportCommand } from './vendorTransport'

export const PASS_RESULTS = ['success', 'reject', 'replan', 'fail'] as const
export type PassResultKind = (typeof PASS_RESULTS)[number]

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
  context: RoleContextBundle
  signal?: AbortSignal
}

export interface RoleRunResult {
  result: PassResultKind
  summary: string
  artifacts: readonly string[]
  exitCode: number | null
  failureKind?: 'operational'
}

export interface RoleRunObserver {
  onEvent?(event: AgentRuntimeEvent): Promise<void> | void
  onHeartbeat?(): Promise<void> | void
}

export interface RoleRunner {
  run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult>
}

export interface ConfiguredRoleRunnerOptions {
  resolveConfig(input: RoleRunInput): RoleTransportConfig | Promise<RoleTransportConfig>
  heartbeatMs?: number
}

export class ConfiguredRoleRunner implements RoleRunner {
  private readonly resolveConfig: ConfiguredRoleRunnerOptions['resolveConfig']
  private readonly heartbeatMs: number

  constructor(options: ConfiguredRoleRunnerOptions) {
    this.resolveConfig = options.resolveConfig
    this.heartbeatMs = options.heartbeatMs ?? 10_000
  }

  async run(input: RoleRunInput, observer?: RoleRunObserver): Promise<RoleRunResult> {
    const config = await this.resolveConfig(input)
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
    })

    const workflowBefore = await workflowDocumentStatus(input)
    const reviewerBefore =
      input.responsibility === 'reviewer' ? await sourceFingerprint(input.cwd) : null
    await Bun.write(input.context.resultFile, '')
    const transcriptFile = join(input.context.runRoot, 'transcript.log')
    await Bun.write(transcriptFile, '')

    let execution: { exitCode: number; stderr: string[] }
    try {
      execution = await executeProcess(command, input, observer, this.heartbeatMs, transcriptFile)
    } catch (error) {
      return failedResult(`Unable to run ${input.responsibility}: ${errorMessage(error)}`)
    }
    const { exitCode, stderr } = execution

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
    if (reviewerBefore !== null && reviewerBefore !== (await sourceFingerprint(input.cwd))) {
      return failedResult('reviewer modified the task worktree', exitCode)
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
  if (responsibility === 'planner') return result === 'success' || result === 'fail'
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
  return gitOutput(input.cwd, ['status', '--porcelain=v1', '--untracked-files=all', '--', '.hopi'])
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
) {
  const tempDir = join(input.context.runtimeScratchDir, 'tmp')
  const cacheDir = join(input.context.runtimeScratchDir, 'cache')
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
  const abort = () => void terminateProcessGroup(child.pid)
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) abort()
  if (command.stdin !== undefined && typeof child.stdin !== 'number' && child.stdin) {
    child.stdin.write(command.stdin)
    child.stdin.end()
  }
  await observer?.onHeartbeat?.()
  const heartbeat = setInterval(() => void observer?.onHeartbeat?.(), heartbeatMs)
  const stderr: string[] = []
  let transcriptTail: Promise<void> = Promise.resolve()
  const recordLine = (stream: 'stdout' | 'stderr', line: string) => {
    transcriptTail = transcriptTail.then(() => appendFile(transcriptFile, `${stream}: ${line}\n`))
    return transcriptTail
  }

  try {
    const format = command.transcriptFormat ?? 'plain'
    const [exitCode] = await Promise.all([
      child.exited.then(async (exitCode) => {
        await terminateProcessGroup(child.pid)
        return exitCode
      }),
      consumeLines(child.stdout as ReadableStream<Uint8Array>, async (line) => {
        await recordLine('stdout', line)
        await emitLine(observer, format, 'stdout', input, line)
      }),
      consumeLines(child.stderr as ReadableStream<Uint8Array>, async (line) => {
        stderr.push(line)
        await recordLine('stderr', line)
        await emitLine(observer, format, 'stderr', input, line)
      }),
    ])
    await transcriptTail
    return { exitCode, stderr }
  } finally {
    clearInterval(heartbeat)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function terminateProcessGroup(pid: number) {
  if (!signalProcessGroup(pid, 0)) return
  signalProcessGroup(pid, 'SIGTERM')
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Bun.sleep(50)
    if (!signalProcessGroup(pid, 0)) return
  }
  signalProcessGroup(pid, 'SIGKILL')
}

function signalProcessGroup(pid: number, signal: 0 | NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

function isMissingProcess(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ESRCH'
  )
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
