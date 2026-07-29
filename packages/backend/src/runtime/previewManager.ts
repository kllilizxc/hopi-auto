import { appendFile, chmod, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { projectReleaseRef } from '../domain/project'
import { BoundedLineTail } from './boundedLineTail'
import { createProcessGroupTerminator } from './processGroup'
import {
  type ProjectPreparationRepoRoot,
  type ProjectPreparationResult,
  type ProjectPreparer,
  createProjectPreparer,
} from './projectPreparation'
import { runtimeCacheRoot } from './runPaths'

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'failed'
export type PreviewStoppedReason = 'release_updated' | 'runtime_restarted'
export type PreviewStartRequester = 'operator' | 'assistant'
export type PreviewFailureReason =
  | 'missing'
  | 'not_executable'
  | 'preparation_failed'
  | 'startup_failed'

export interface PreviewFailure {
  kind: 'failed'
  reason: PreviewFailureReason
  logs: string
  session: PreviewSession
}

export interface PreviewSurface {
  id: string
  label: string
  url: string
}

/**
 * File references admitted for one managed Preview startup.  They are never
 * part of PreviewSession and are discarded after the adapter process is
 * spawned.  The adapter remains responsible for validating the referenced
 * material before it starts any child service.
 */
export interface PreviewSessionCredentialReferences {
  rfidCertificate: string
  rfidPrivateKey: string
}

export interface PreviewSession {
  sessionId: string
  projectId: string
  releaseHeads: Readonly<Record<string, string>>
  status: PreviewStatus
  surfaces: PreviewSurface[]
  logPath: string
  manifestPath: string
  startedAt: string
  endedAt: string | null
  processId: number | null
  preparation: Pick<
    ProjectPreparationResult,
    'kind' | 'adapterPath' | 'exitCode' | 'logPath' | 'reposFile'
  > | null
  error: string | null
  stoppedReason: PreviewStoppedReason | null
  failureReason: PreviewFailureReason | null
}

export type PreviewStartResult = { kind: 'started'; session: PreviewSession } | PreviewFailure

interface PreviewProjectEventBase {
  projectId: string
  sessionId: string
  status: 'failed' | 'stopped'
  message: string
  manifestPath: string
  logPath: string
  reason: PreviewFailureReason | PreviewStoppedReason
}

export type PreviewProjectEvent =
  | (PreviewProjectEventBase & {
      kind: 'start_failed'
      requesters: readonly PreviewStartRequester[]
    })
  | (PreviewProjectEventBase & {
      kind: 'lifecycle'
    })

export interface PreviewManager {
  recover(): Promise<void>
  start(input: {
    projectId: string
    projectRoot: string
    releaseHeads: Readonly<Record<string, string>>
    requestedBy: PreviewStartRequester
    primaryRepoId?: string
    repoRoots?: readonly ProjectPreparationRepoRoot[]
    sessionCredentialReferences?: PreviewSessionCredentialReferences
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
  requesters: Set<PreviewStartRequester>
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
  onEvent?(event: PreviewProjectEvent): Promise<void> | void
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
  const latestSessions = new Map<string, PreviewSession>()

  async function persistSession(session: PreviewSession) {
    await mkdir(dirname(session.manifestPath), { recursive: true })
    await Bun.write(session.manifestPath, `${JSON.stringify(session, null, 2)}\n`)
    latestSessions.set(session.projectId, session)
  }

  async function emitEvent(
    session: PreviewSession,
    reason: PreviewFailureReason | PreviewStoppedReason,
    message: string,
    source:
      | { kind: 'start_failed'; requesters: readonly PreviewStartRequester[] }
      | { kind: 'lifecycle' },
  ) {
    try {
      await options.onEvent?.({
        ...source,
        projectId: session.projectId,
        sessionId: session.sessionId,
        status: session.status === 'failed' ? 'failed' : 'stopped',
        message,
        manifestPath: session.manifestPath,
        logPath: session.logPath,
        reason,
      })
    } catch {
      // Preview lifecycle is durable even when the Assistant wake cannot be published immediately.
    }
  }

  async function failPreview(
    operation: PreviewOperation,
    reason: PreviewFailureReason,
    error: string,
    logs: string,
  ): Promise<PreviewFailure> {
    operation.session.status = 'failed'
    operation.session.surfaces = []
    operation.session.endedAt ??= now().toISOString()
    operation.session.processId = null
    operation.session.error = error
    operation.session.failureReason = reason
    await persistSession(operation.session)
    await emitEvent(operation.session, reason, error, {
      kind: 'start_failed',
      requesters: [...operation.requesters],
    })
    return { kind: 'failed', reason, logs, session: operation.session }
  }

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
    sessionCredentialReferences: PreviewSessionCredentialReferences | undefined,
  ): Promise<PreviewStartResult> {
    const adapterFile = Bun.file(paths.adapter)
    if (!(await adapterFile.exists())) {
      if (isStopped(operation)) return stoppedResult(operation.session, now)
      return failPreview(operation, 'missing', `Preview adapter is missing: ${paths.adapter}`, '')
    }
    if (!(await isExecutable(paths.adapter))) {
      if (isStopped(operation)) return stoppedResult(operation.session, now)
      return failPreview(
        operation,
        'not_executable',
        `Preview adapter is not executable: ${paths.adapter}`,
        '',
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
      releaseHeads: input.releaseHeads,
      projection: 'release',
    })
    if (isStopped(operation)) return stoppedResult(operation.session, now)
    operation.session.preparation = {
      kind: preparation.kind,
      adapterPath: preparation.adapterPath,
      exitCode: preparation.exitCode,
      logPath: preparation.logPath,
      reposFile: preparation.reposFile,
    }
    await persistSession(operation.session)
    if (preparation.kind !== 'ready' && preparation.kind !== 'absent') {
      return failPreview(
        operation,
        'preparation_failed',
        `Preview preparation failed through ${preparation.adapterPath}`,
        preparation.logs,
      )
    }

    operation.phase = 'startup'
    await Bun.write(paths.logPath, '')
    if (isStopped(operation)) return stoppedResult(operation.session, now)
    const childEnvironment = previewAdapterEnvironment({
      projectRoot: paths.projectRoot,
      reposFile: paths.reposFile,
      runtimeDir: paths.sessionRoot,
      cacheDir: runtimeCacheRoot(homeRoot),
      sessionCredentialReferences,
    })
    const child = (() => {
      try {
        return Bun.spawn([paths.adapter], {
          cwd: paths.projectRoot,
          stdout: 'pipe',
          stderr: 'pipe',
          env: childEnvironment,
          detached: true,
        })
      } finally {
        // The child receives a private environment snapshot.  Do not retain the
        // path references in this manager's environment object after that handoff.
        childEnvironment.HOPI_RFID_CERT_SOURCE = undefined
        childEnvironment.HOPI_RFID_KEY_SOURCE = undefined
      }
    })()
    operation.process = child
    operation.session.processId = child.pid
    await persistSession(operation.session)
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
      return failPreview(
        operation,
        'startup_failed',
        operation.session.error,
        operation.logs.text(),
      )
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
      return failPreview(operation, 'startup_failed', message, operation.logs.text())
    }
    if (isStopped(operation)) {
      return stoppedResult(operation.session, now)
    }
    operation.session.surfaces = startup.surfaces
    operation.session.status = 'running'
    operation.session.failureReason = null
    await persistSession(operation.session)
    void child.exited
      .then(async (exitCode) => {
        if (operation.session.status === 'stopped') return
        operation.session.status = 'failed'
        operation.session.surfaces = []
        operation.session.processId = null
        operation.session.error = `Preview adapter exited unexpectedly with code ${exitCode}`
        operation.session.endedAt = now().toISOString()
        await settlePreviewLogs(operation)
        operation.session.failureReason = 'startup_failed'
        await persistSession(operation.session)
        await emitEvent(operation.session, 'startup_failed', operation.session.error, {
          kind: 'lifecycle',
        })
      })
      .catch((error) => console.error('[preview lifecycle error]', error))
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
    operation.session.processId = null
    if (operation.process) {
      await terminatePreview(operation.process, stopGraceMs)
      await settlePreviewLogs(operation)
    }
    operation.session.endedAt ??= now().toISOString()
    await persistSession(operation.session)
    if (reason) {
      await emitEvent(
        operation.session,
        reason,
        'Preview stopped because the managed Project release changed.',
        { kind: 'lifecycle' },
      )
    }
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
    operation.session.processId = null
    operation.session.error = message
    return failPreview(
      operation,
      operation.phase === 'preparation' ? 'preparation_failed' : 'startup_failed',
      message,
      operation.logs.text(),
    )
  }

  const manager: PreviewManager = {
    inspect(projectId) {
      return operations.get(projectId)?.session ?? latestSessions.get(projectId) ?? null
    },
    async recover() {
      const sessions = await readLatestPreviewSessions(runtimeRoot)
      for (const session of sessions) {
        latestSessions.set(session.projectId, session)
        if (session.status !== 'starting' && session.status !== 'running') continue
        if (session.processId !== null) {
          await createProcessGroupTerminator(session.processId)().catch(() => undefined)
        }
        session.status = 'stopped'
        session.surfaces = []
        session.processId = null
        session.endedAt ??= now().toISOString()
        session.stoppedReason = 'runtime_restarted'
        await persistSession(session)
        await emitEvent(
          session,
          'runtime_restarted',
          'Preview stopped because the HOPI runtime restarted.',
          { kind: 'lifecycle' },
        )
      }
    },
    start(input) {
      const releaseHeads = Object.freeze({ ...input.releaseHeads })
      if (
        Object.keys(releaseHeads).length === 0 ||
        Object.values(releaseHeads).some((commit) => !commit)
      ) {
        throw new Error('Preview requires the exact release head of every Project Repo')
      }
      const current = operations.get(input.projectId)
      if (current?.session.status === 'running' || current?.session.status === 'starting') {
        if (input.sessionCredentialReferences) {
          throw new Error(
            'Preview credential references can be supplied only while admitting a new Preview session',
          )
        }
        if (sameReleaseHeads(current.session.releaseHeads, releaseHeads)) {
          current.requesters.add(input.requestedBy)
          return current.startPromise
        }
        return stopOperation(current, 'release_updated')
          .then(() => current.startPromise)
          .then(() => manager.start(input))
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
      const manifestPath = join(sessionRoot, 'session.json')
      const session: PreviewSession = {
        sessionId,
        projectId: input.projectId,
        releaseHeads,
        status: 'starting',
        surfaces: [],
        logPath,
        manifestPath,
        startedAt: now().toISOString(),
        endedAt: null,
        processId: null,
        preparation: null,
        error: null,
        stoppedReason: null,
        failureReason: null,
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
        requesters: new Set([input.requestedBy]),
      }
      operations.set(input.projectId, operation)
      let sessionCredentialReferences = input.sessionCredentialReferences
        ? { ...input.sessionCredentialReferences }
        : undefined
      const startInput = { ...input, sessionCredentialReferences: undefined }
      const paths = {
        projectRoot,
        adapter,
        sessionRoot,
        logPath,
        preparationRoot,
        reposFile,
      }
      operation.startPromise = persistSession(session)
        .then(() => runStart(operation, startInput, paths, sessionCredentialReferences))
        .catch((error) => failUnexpectedStart(operation, paths, error))
        .finally(() => {
          sessionCredentialReferences = undefined
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

export async function readProjectReleaseHeads(
  projectId: string,
  repos: readonly ProjectPreparationRepoRoot[],
) {
  const releaseRef = projectReleaseRef(projectId)
  return Object.fromEntries(
    await Promise.all(
      repos.map(async (repo) => [
        repo.repoId,
        await gitOutput(repo.path, ['rev-parse', releaseRef]),
      ]),
    ),
  )
}

function sameReleaseHeads(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([repoId, commit]) => right[repoId] === commit)
  )
}

function previewAdapterEnvironment(input: {
  projectRoot: string
  reposFile: string
  runtimeDir: string
  cacheDir: string
  sessionCredentialReferences: PreviewSessionCredentialReferences | undefined
}) {
  const {
    HOPI_RFID_CERT_SOURCE: _inheritedCertificateReference,
    HOPI_RFID_KEY_SOURCE: _inheritedKeyReference,
    ...environment
  } = process.env
  const references = input.sessionCredentialReferences
  if (references && (!references.rfidCertificate.trim() || !references.rfidPrivateKey.trim())) {
    throw new Error('Preview credentials must contain both session file references')
  }
  return {
    ...environment,
    HOPI_PROJECT_ROOT: input.projectRoot,
    HOPI_REPOS_FILE: input.reposFile,
    HOPI_PREVIEW_RUNTIME_DIR: input.runtimeDir,
    HOPI_CACHE_DIR: input.cacheDir,
    ...(references
      ? {
          HOPI_RFID_CERT_SOURCE: references.rfidCertificate,
          HOPI_RFID_KEY_SOURCE: references.rfidPrivateKey,
        }
      : {}),
  }
}

const previewSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    releaseHeads: z.record(z.string()),
    status: z.enum(['starting', 'running', 'stopped', 'failed']),
    surfaces: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          url: z.string(),
        })
        .strict(),
    ),
    logPath: z.string(),
    manifestPath: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    processId: z.number().int().positive().nullable(),
    preparation: z
      .object({
        kind: z.enum([
          'ready',
          'absent',
          'not_executable',
          'failed',
          'source_changed',
          'skipped_dirty',
        ]),
        adapterPath: z.string(),
        exitCode: z.number().int().nullable(),
        logPath: z.string(),
        reposFile: z.string(),
      })
      .strict()
      .nullable(),
    error: z.string().nullable(),
    stoppedReason: z.enum(['release_updated', 'runtime_restarted']).nullable(),
    failureReason: z
      .enum(['missing', 'not_executable', 'preparation_failed', 'startup_failed'])
      .nullable(),
  })
  .strict()

async function readLatestPreviewSessions(runtimeRoot: string) {
  const sessions: PreviewSession[] = []
  const projectEntries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => [])
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue
    const projectRoot = join(runtimeRoot, projectEntry.name)
    const sessionEntries = await readdir(projectRoot, { withFileTypes: true }).catch(() => [])
    let latest: PreviewSession | null = null
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue
      const manifestPath = join(projectRoot, sessionEntry.name, 'session.json')
      try {
        const parsed = previewSessionSchema.parse(await Bun.file(manifestPath).json())
        const session: PreviewSession = { ...parsed, manifestPath }
        if (!latest || session.startedAt > latest.startedAt) latest = session
      } catch {
        // A malformed historical manifest is not process authority.
      }
    }
    if (latest) sessions.push(latest)
  }
  return sessions
}

async function gitOutput(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim())
  return stdout.trim()
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
  const readiness = surfaces === undefined ? null : parsePreviewSurfaces(surfaces)
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
  void stopGraceMs
  await createProcessGroupTerminator(process.pid)()
}

function stoppedResult(session: PreviewSession, now: () => Date): PreviewStartResult {
  session.surfaces = []
  session.endedAt ??= now().toISOString()
  return { kind: 'started', session }
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function makePreviewAdapterExecutable(path: string) {
  await chmod(path, 0o755)
}
