import { appendFile, chmod, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BoundedLineTail } from './boundedLineTail'
import {
  type ProjectPreparationRepoRoot,
  type ProjectPreparer,
  createProjectPreparer,
} from './projectPreparation'
import { runtimeCacheRoot } from './runPaths'

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'failed'
export type PreviewStoppedReason = 'release_updated'
export type PreviewRepairReason =
  | 'missing'
  | 'not_executable'
  | 'preparation_failed'
  | 'startup_failed'

export interface PreviewRepair {
  kind: 'repair_required'
  reason: PreviewRepairReason
  prompt: string
  logs: string
}

export interface PreviewSurface {
  id: string
  label: string
  url: string
}

export interface PreviewSession {
  sessionId: string
  projectId: string
  status: PreviewStatus
  surfaces: PreviewSurface[]
  logPath: string
  startedAt: string
  endedAt: string | null
  error: string | null
  stoppedReason: PreviewStoppedReason | null
  repair: PreviewRepair | null
}

export type PreviewStartResult = { kind: 'started'; session: PreviewSession } | PreviewRepair

export interface PreviewManager {
  start(input: {
    projectId: string
    projectRoot: string
    primaryRepoId?: string
    repoRoots?: readonly ProjectPreparationRepoRoot[]
  }): Promise<PreviewStartResult>
  stop(projectId: string, reason?: PreviewStoppedReason): Promise<PreviewSession | null>
  stopAll(): Promise<void>
  inspect(projectId: string): PreviewSession | null
}

interface PreviewOperation {
  session: PreviewSession
  process: ReturnType<typeof Bun.spawn> | null
  logs: BoundedLineTail
  ready: Promise<PreviewReadiness>
  signalReady(readiness: PreviewReadiness): void
  reportedReadiness: PreviewReadiness | null
  streams: Promise<void>[]
  logWriteTail: Promise<void>
  startPromise: Promise<PreviewStartResult>
  phase: 'preparation' | 'startup'
  settled: boolean
}

type PreviewReadiness =
  | { kind: 'ready'; surfaces: PreviewSurface[] }
  | { kind: 'invalid'; error: string }

export interface PreviewManagerOptions {
  startupTimeoutMs?: number
  stopGraceMs?: number
  now?: () => Date
  preparer?: ProjectPreparer
  preparationTimeoutMs?: number
  surfaceProbe?: (url: string) => Promise<void>
}

export function createPreviewManager(
  homeRoot: string,
  options: PreviewManagerOptions = {},
): PreviewManager {
  const runtimeRoot = join(resolve(homeRoot), '.hopi', 'runtime', 'preview')
  const startupTimeoutMs = options.startupTimeoutMs ?? 300_000
  const stopGraceMs = options.stopGraceMs ?? 5_000
  const now = options.now ?? (() => new Date())
  const preparer = options.preparer ?? createProjectPreparer()
  const surfaceProbe =
    options.surfaceProbe ??
    ((url: string) => probePreviewSurface(url, Math.min(startupTimeoutMs, 10_000)))
  const operations = new Map<string, PreviewOperation>()

  async function runStart(
    operation: PreviewOperation,
    input: Parameters<PreviewManager['start']>[0],
    paths: {
      projectRoot: string
      adapter: string
      sessionRoot: string
      logPath: string
      preparationRoot: string
      reposFile: string
    },
  ): Promise<PreviewStartResult> {
    const adapterFile = Bun.file(paths.adapter)
    if (!(await adapterFile.exists())) {
      if (isStopped(operation)) return stoppedResult(operation.session, now)
      return failWithRepair(
        operation,
        repairRequired('missing', paths.adapter, ''),
        `Preview adapter is missing: ${paths.adapter}`,
        now,
      )
    }
    if (!(await isExecutable(paths.adapter))) {
      if (isStopped(operation)) return stoppedResult(operation.session, now)
      return failWithRepair(
        operation,
        repairRequired('not_executable', paths.adapter, ''),
        `Preview adapter is not executable: ${paths.adapter}`,
        now,
      )
    }

    await mkdir(paths.sessionRoot, { recursive: true })
    if (isStopped(operation)) return stoppedResult(operation.session, now)
    const preparation = await preparer.prepare({
      projectRoot: paths.projectRoot,
      runtimeDir: paths.preparationRoot,
      cacheDir: runtimeCacheRoot(homeRoot),
      timeoutMs: options.preparationTimeoutMs,
      primaryRepoId: input.primaryRepoId,
      repoRoots: input.repoRoots,
    })
    if (isStopped(operation)) return stoppedResult(operation.session, now)
    if (preparation.kind !== 'ready') {
      return failWithRepair(
        operation,
        repairRequired('preparation_failed', preparation.adapterPath, preparation.logs),
        `Preview preparation failed through ${preparation.adapterPath}`,
        now,
      )
    }

    operation.phase = 'startup'
    await Bun.write(paths.logPath, '')
    if (isStopped(operation)) return stoppedResult(operation.session, now)
    const child = Bun.spawn([paths.adapter], {
      cwd: paths.projectRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        HOPI_PROJECT_ROOT: paths.projectRoot,
        HOPI_REPOS_FILE: paths.reposFile,
        HOPI_PREVIEW_RUNTIME_DIR: paths.sessionRoot,
      },
    })
    operation.process = child
    operation.streams = [
      consumePreviewStream(child.stdout, operation, paths.logPath),
      consumePreviewStream(child.stderr, operation, paths.logPath),
    ]

    const startup = await Promise.race([
      child.exited.then((exitCode) => ({ kind: 'exit' as const, exitCode })),
      operation.ready,
      Bun.sleep(startupTimeoutMs).then(() => ({ kind: 'timeout' as const })),
    ])
    if (startup.kind !== 'ready') {
      if (startup.kind === 'timeout' || startup.kind === 'invalid') {
        await terminatePreview(child, stopGraceMs)
      }
      await settlePreviewLogs(operation)
      if (isStopped(operation)) {
        return stoppedResult(operation.session, now)
      }
      operation.session.status = 'failed'
      operation.session.surfaces = []
      operation.session.endedAt = now().toISOString()
      operation.session.error =
        startup.kind === 'timeout'
          ? `Preview adapter did not become ready within ${startupTimeoutMs}ms`
          : startup.kind === 'invalid'
            ? `Preview surface declaration is invalid: ${startup.error}`
            : `Preview adapter exited with code ${startup.exitCode}`
      const repair = repairRequired('startup_failed', paths.adapter, operation.logs.text())
      operation.session.repair = repair
      return repair
    }
    if (isStopped(operation)) {
      return stoppedResult(operation.session, now)
    }
    try {
      await Promise.all(
        startup.surfaces.map(async (surface) => {
          try {
            await surfaceProbe(surface.url)
          } catch (error) {
            throw new Error(
              `surface ${surface.id} (${surface.label}) at ${surface.url}: ${errorMessage(error)}`,
            )
          }
        }),
      )
    } catch (error) {
      const message = `Preview surface probe failed: ${errorMessage(error)}`
      operation.logs.push(message)
      operation.logWriteTail = operation.logWriteTail.then(() =>
        appendFile(paths.logPath, `${message}\n`),
      )
      await terminatePreview(child, stopGraceMs)
      await settlePreviewLogs(operation)
      if (isStopped(operation)) {
        return stoppedResult(operation.session, now)
      }
      return failWithRepair(
        operation,
        repairRequired('startup_failed', paths.adapter, operation.logs.text()),
        message,
        now,
      )
    }
    if (isStopped(operation)) {
      return stoppedResult(operation.session, now)
    }
    operation.session.surfaces = startup.surfaces
    operation.session.status = 'running'
    void child.exited.then(async (exitCode) => {
      if (operation.session.status === 'stopped') return
      operation.session.status = exitCode === 0 ? 'stopped' : 'failed'
      operation.session.surfaces = []
      operation.session.error =
        exitCode === 0 ? null : `Preview adapter exited with code ${exitCode}`
      operation.session.endedAt = now().toISOString()
      await settlePreviewLogs(operation)
      operation.session.repair =
        exitCode === 0
          ? null
          : repairRequired('startup_failed', paths.adapter, operation.logs.text())
    })
    return { kind: 'started', session: operation.session }
  }

  async function stopOperation(
    operation: PreviewOperation,
    reason?: PreviewStoppedReason,
  ): Promise<PreviewSession> {
    if (operation.session.status === 'stopped' || operation.session.status === 'failed') {
      return operation.session
    }
    operation.session.status = 'stopped'
    operation.session.stoppedReason = reason ?? null
    operation.session.surfaces = []
    if (operation.process) {
      await terminatePreview(operation.process, stopGraceMs)
      await settlePreviewLogs(operation)
    }
    operation.session.endedAt ??= now().toISOString()
    return operation.session
  }

  async function failUnexpectedStart(
    operation: PreviewOperation,
    paths: { adapter: string; sessionRoot: string; logPath: string },
    error: unknown,
  ): Promise<PreviewStartResult> {
    if (operation.process) {
      await terminatePreview(operation.process, stopGraceMs).catch(() => undefined)
    }
    await settlePreviewLogs(operation).catch(() => undefined)
    if (isStopped(operation)) return stoppedResult(operation.session, now)

    const message = `Unexpected Preview ${operation.phase} failure: ${errorMessage(error)}`
    operation.logs.push(message)
    await mkdir(paths.sessionRoot, { recursive: true }).catch(() => undefined)
    await appendFile(paths.logPath, `${message}\n`).catch(() => undefined)
    operation.session.status = 'failed'
    operation.session.surfaces = []
    operation.session.endedAt = now().toISOString()
    operation.session.error = message
    return failWithRepair(
      operation,
      repairRequired(
        operation.phase === 'preparation' ? 'preparation_failed' : 'startup_failed',
        paths.adapter,
        operation.logs.text(),
      ),
      message,
      now,
    )
  }

  const manager: PreviewManager = {
    inspect(projectId) {
      return operations.get(projectId)?.session ?? null
    },
    start(input) {
      const current = operations.get(input.projectId)
      if (current?.session.status === 'running' || current?.session.status === 'starting') {
        return current.startPromise
      }
      if (current && !current.settled) {
        return current.startPromise.then(() => manager.start(input))
      }
      const projectRoot = resolve(input.projectRoot)
      const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
      const sessionId = `preview-${crypto.randomUUID()}`
      const sessionRoot = join(runtimeRoot, input.projectId, sessionId)
      const logPath = join(sessionRoot, 'preview.log')
      const preparationRoot = join(sessionRoot, 'project-prepare')
      const reposFile = join(preparationRoot, 'repos.json')
      const session: PreviewSession = {
        sessionId,
        projectId: input.projectId,
        status: 'starting',
        surfaces: [],
        logPath,
        startedAt: now().toISOString(),
        endedAt: null,
        error: null,
        stoppedReason: null,
        repair: null,
      }
      let signalReady: (readiness: PreviewReadiness) => void = () => undefined
      const ready = new Promise<PreviewReadiness>((resolveReady) => {
        signalReady = resolveReady
      })
      const operation: PreviewOperation = {
        session,
        process: null,
        logs: new BoundedLineTail(),
        ready,
        signalReady,
        reportedReadiness: null,
        streams: [],
        logWriteTail: Promise.resolve(),
        startPromise: Promise.resolve({ kind: 'started', session }),
        phase: 'preparation',
        settled: false,
      }
      operations.set(input.projectId, operation)
      const paths = {
        projectRoot,
        adapter,
        sessionRoot,
        logPath,
        preparationRoot,
        reposFile,
      }
      operation.startPromise = runStart(operation, input, paths)
        .catch((error) => failUnexpectedStart(operation, paths, error))
        .finally(() => {
          operation.settled = true
        })
      return operation.startPromise
    },
    async stop(projectId, reason) {
      const operation = operations.get(projectId)
      return operation ? stopOperation(operation, reason) : null
    },
    async stopAll() {
      const active = [...operations.values()]
      await Promise.all(active.map((operation) => stopOperation(operation)))
      await Promise.allSettled(active.map((operation) => operation.startPromise))
    },
  }
  return manager
}

async function consumePreviewStream(
  stream: ReadableStream<Uint8Array>,
  operation: PreviewOperation,
  logPath: string,
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
    for (const line of lines) recordLine(operation, line, logPath)
  }
  buffered += decoder.decode()
  if (buffered) recordLine(operation, buffered, logPath)
}

function recordLine(operation: PreviewOperation, line: string, logPath: string) {
  operation.logs.push(line)
  operation.logWriteTail = operation.logWriteTail.then(() => appendFile(logPath, `${line}\n`))
  if (operation.reportedReadiness !== null) return
  const surfaces = /^HOPI_PREVIEW_SURFACES=(.*)$/.exec(line)?.[1]
  const legacyUrl = /^HOPI_PREVIEW_URL=(\S+)$/.exec(line)?.[1]
  const readiness =
    surfaces !== undefined
      ? parsePreviewSurfaces(surfaces)
      : legacyUrl
        ? parsePreviewSurfaces(
            JSON.stringify([{ id: 'default', label: 'Preview', url: legacyUrl }]),
          )
        : null
  if (!readiness) return
  operation.reportedReadiness = readiness
  operation.signalReady(readiness)
}

function parsePreviewSurfaces(source: string): PreviewReadiness {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return { kind: 'invalid', error: `invalid JSON: ${errorMessage(error)}` }
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { kind: 'invalid', error: 'surfaces must be a non-empty JSON array' }
  }
  const surfaces: PreviewSurface[] = []
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return { kind: 'invalid', error: `surface ${index} must be an object` }
    }
    const { id, label, url } = entry
    if (typeof id !== 'string' || id.trim().length === 0) {
      return { kind: 'invalid', error: `surface ${index} has an invalid id` }
    }
    if (typeof label !== 'string' || label.trim().length === 0) {
      return { kind: 'invalid', error: `surface ${id} has an invalid label` }
    }
    if (typeof url !== 'string') {
      return { kind: 'invalid', error: `surface ${id} has an invalid url` }
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { kind: 'invalid', error: `surface ${id} has an invalid url` }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        kind: 'invalid',
        error: `surface ${id} uses unsupported protocol ${parsed.protocol}`,
      }
    }
    surfaces.push({ id: id.trim(), label: label.trim(), url })
  }
  if (new Set(surfaces.map((surface) => surface.id)).size !== surfaces.length) {
    return { kind: 'invalid', error: 'surface ids must be unique' }
  }
  return { kind: 'ready', surfaces }
}

async function probePreviewSurface(urlValue: string, timeoutMs: number) {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    throw new Error('ready URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ready URL uses unsupported protocol ${url.protocol}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`GET returned HTTP ${response.status}`)
    }
    await response.body?.cancel()
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`GET did not complete within ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function settlePreviewLogs(operation: PreviewOperation) {
  await Promise.allSettled(operation.streams)
  await operation.logWriteTail
}

async function terminatePreview(process: ReturnType<typeof Bun.spawn>, stopGraceMs: number) {
  process.kill('SIGTERM')
  const stopped = await Promise.race([
    process.exited.then(() => true),
    Bun.sleep(stopGraceMs).then(() => false),
  ])
  if (!stopped) {
    process.kill('SIGKILL')
    await process.exited
  }
}

function stoppedResult(session: PreviewSession, now: () => Date): PreviewStartResult {
  session.surfaces = []
  session.endedAt ??= now().toISOString()
  return { kind: 'started', session }
}

function failWithRepair(
  operation: PreviewOperation,
  repair: PreviewRepair,
  error: string,
  now: () => Date,
): PreviewRepair {
  operation.session.status = 'failed'
  operation.session.surfaces = []
  operation.session.endedAt ??= now().toISOString()
  operation.session.error = error
  operation.session.repair = repair
  return repair
}

function isStopped(operation: PreviewOperation) {
  return operation.session.status === 'stopped'
}

async function isExecutable(path: string) {
  try {
    const file = Bun.file(path)
    const stats = await file.stat()
    return stats.isFile() && (stats.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function repairRequired(reason: PreviewRepairReason, adapter: string, logs: string): PreviewRepair {
  const details = logs.trim() ? `\n\nStartup logs:\n\n\`\`\`\n${logs.trim()}\n\`\`\`` : ''
  return {
    kind: 'repair_required',
    reason,
    logs,
    prompt: [
      `Preview could not start through ${adapter}.`,
      `Failure class: ${reason}.`,
      'Desired outcome: the current managed Project release starts through its reviewed Preview capability and exposes operator-usable surfaces.',
      "The reviewed contract is every Project Repo's scripts/hopi/prepare from its clean managed integration worktree, in manifest order, followed by the primary Repo's scripts/hopi/preview. Prepare owns runtime prerequisites; Preview owns service startup and its operator-usable surfaces.",
      'A captured preparation or startup error is diagnosis rather than successful Preview behavior.',
      'For a browser-facing Preview, running state or an HTTP application shell is transport evidence only; accepted user-visible behavior requires independent candidate browser evidence.',
      details,
    ].join(' '),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function makePreviewAdapterExecutable(path: string) {
  await chmod(path, 0o755)
}
