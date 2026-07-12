import { chmod, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type ProjectPreparationRepoRoot,
  type ProjectPreparer,
  createProjectPreparer,
} from './projectPreparation'

export type PreviewStatus = 'starting' | 'running' | 'stopped' | 'failed'
export type PreviewStoppedReason = 'release_updated'

export interface PreviewSession {
  sessionId: string
  projectId: string
  status: PreviewStatus
  endpoint: string | null
  logPath: string
  startedAt: string
  endedAt: string | null
  error: string | null
  stoppedReason: PreviewStoppedReason | null
}

export type PreviewStartResult =
  | { kind: 'started'; session: PreviewSession }
  | {
      kind: 'repair_required'
      reason: 'missing' | 'not_executable' | 'preparation_failed' | 'startup_failed'
      prompt: string
      logs: string
    }

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

interface LivePreview {
  session: PreviewSession
  process: ReturnType<typeof Bun.spawn>
  logs: string[]
  ready: Promise<string>
  signalReady(endpoint: string): void
  streams: Promise<void>[]
}

export interface PreviewManagerOptions {
  startupTimeoutMs?: number
  stopGraceMs?: number
  now?: () => Date
  preparer?: ProjectPreparer
  preparationTimeoutMs?: number
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
  const sessions = new Map<string, LivePreview>()

  return {
    inspect(projectId) {
      return sessions.get(projectId)?.session ?? null
    },
    async start(input) {
      const current = sessions.get(input.projectId)
      if (current?.session.status === 'running' || current?.session.status === 'starting') {
        return { kind: 'started', session: current.session }
      }
      const projectRoot = resolve(input.projectRoot)
      const adapter = join(projectRoot, 'scripts', 'hopi', 'preview')
      const adapterFile = Bun.file(adapter)
      if (!(await adapterFile.exists())) {
        return repairRequired('missing', adapter, '')
      }
      if (!(await isExecutable(adapter))) {
        return repairRequired('not_executable', adapter, '')
      }

      const sessionId = `preview-${crypto.randomUUID()}`
      const sessionRoot = join(runtimeRoot, input.projectId, sessionId)
      const logPath = join(sessionRoot, 'preview.log')
      const preparationRoot = join(sessionRoot, 'project-prepare')
      const reposFile = join(preparationRoot, 'repos.json')
      await mkdir(sessionRoot, { recursive: true })
      const preparation = await preparer.prepare({
        projectRoot,
        runtimeDir: preparationRoot,
        timeoutMs: options.preparationTimeoutMs,
        primaryRepoId: input.primaryRepoId,
        repoRoots: input.repoRoots,
      })
      if (preparation.kind !== 'ready') {
        return repairRequired('preparation_failed', preparation.adapterPath, preparation.logs)
      }
      const session: PreviewSession = {
        sessionId,
        projectId: input.projectId,
        status: 'starting',
        endpoint: null,
        logPath,
        startedAt: now().toISOString(),
        endedAt: null,
        error: null,
        stoppedReason: null,
      }
      const child = Bun.spawn([adapter], {
        cwd: projectRoot,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          HOPI_PROJECT_ROOT: projectRoot,
          HOPI_REPOS_FILE: reposFile,
          HOPI_PREVIEW_RUNTIME_DIR: sessionRoot,
        },
      })
      let signalReady: (endpoint: string) => void = () => undefined
      const ready = new Promise<string>((resolveReady) => {
        signalReady = resolveReady
      })
      const live: LivePreview = {
        session,
        process: child,
        logs: [],
        ready,
        signalReady,
        streams: [],
      }
      sessions.set(input.projectId, live)
      live.streams = [
        consumePreviewStream(child.stdout, live, logPath),
        consumePreviewStream(child.stderr, live, logPath),
      ]

      const startup = await Promise.race([
        child.exited.then((exitCode) => ({ kind: 'exit' as const, exitCode })),
        ready.then((endpoint) => ({ kind: 'ready' as const, endpoint })),
        Bun.sleep(startupTimeoutMs).then(() => ({ kind: 'timeout' as const })),
      ])
      if (startup.kind !== 'ready') {
        if (startup.kind === 'timeout') {
          await terminatePreview(live, stopGraceMs)
        }
        await Promise.allSettled(live.streams)
        if (session.status === 'stopped') {
          session.endpoint = null
          session.endedAt ??= now().toISOString()
          await flushLogs(logPath, live.logs)
          return { kind: 'started', session }
        }
        session.status = 'failed'
        session.endpoint = null
        session.endedAt = now().toISOString()
        session.error =
          startup.kind === 'timeout'
            ? `Preview adapter did not become ready within ${startupTimeoutMs}ms`
            : `Preview adapter exited with code ${startup.exitCode}`
        await flushLogs(logPath, live.logs)
        return repairRequired('startup_failed', adapter, live.logs.join('\n'))
      }
      if (session.status === 'stopped') {
        session.endpoint = null
        session.endedAt ??= now().toISOString()
        return { kind: 'started', session }
      }
      session.status = 'running'
      void child.exited.then(async (exitCode) => {
        if (session.status === 'stopped') return
        session.status = exitCode === 0 ? 'stopped' : 'failed'
        session.endpoint = null
        session.error = exitCode === 0 ? null : `Preview adapter exited with code ${exitCode}`
        session.endedAt = now().toISOString()
        await Promise.allSettled(live.streams)
        await flushLogs(logPath, live.logs)
      })
      return { kind: 'started', session }
    },
    async stop(projectId, reason) {
      const live = sessions.get(projectId)
      if (!live) return null
      if (live.session.status === 'stopped' || live.session.status === 'failed') {
        return live.session
      }
      live.session.status = 'stopped'
      live.session.stoppedReason = reason ?? null
      live.session.endpoint = null
      await terminatePreview(live, stopGraceMs)
      live.session.endedAt = now().toISOString()
      await Promise.allSettled(live.streams)
      await flushLogs(live.session.logPath, live.logs)
      return live.session
    },
    async stopAll() {
      await Promise.all([...sessions.keys()].map((projectId) => this.stop(projectId)))
    },
  }
}

async function consumePreviewStream(
  stream: ReadableStream<Uint8Array>,
  live: LivePreview,
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
    for (const line of lines) recordLine(live, line)
    await flushLogs(logPath, live.logs)
  }
  buffered += decoder.decode()
  if (buffered) recordLine(live, buffered)
  await flushLogs(logPath, live.logs)
}

function recordLine(live: LivePreview, line: string) {
  live.logs.push(line)
  const endpoint = /^HOPI_PREVIEW_URL=(\S+)$/.exec(line)?.[1]
  if (endpoint && live.session.endpoint === null) {
    live.session.endpoint = endpoint
    live.signalReady(endpoint)
  }
}

async function terminatePreview(live: LivePreview, stopGraceMs: number) {
  live.process.kill('SIGTERM')
  const stopped = await Promise.race([
    live.process.exited.then(() => true),
    Bun.sleep(stopGraceMs).then(() => false),
  ])
  if (!stopped) {
    live.process.kill('SIGKILL')
    await live.process.exited
  }
}

async function flushLogs(path: string, logs: readonly string[]) {
  await Bun.write(path, logs.length > 0 ? `${logs.join('\n')}\n` : '')
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

function repairRequired(
  reason: Extract<PreviewStartResult, { kind: 'repair_required' }>['reason'],
  adapter: string,
  logs: string,
): PreviewStartResult {
  const details = logs.trim() ? `\n\nStartup logs:\n\n\`\`\`\n${logs.trim()}\n\`\`\`` : ''
  return {
    kind: 'repair_required',
    reason,
    logs,
    prompt: [
      `Preview could not start through ${adapter}.`,
      'The reviewed Project contract is scripts/hopi/prepare followed by scripts/hopi/preview from the clean managed integration worktree. Prepare owns runtime prerequisites; Preview owns service startup and its ready URL.',
      'A captured preparation or startup error is diagnosis rather than successful Preview behavior.',
      'First check whether an equivalent nonterminal Goal or Work is already creating or repairing either script and reuse it.',
      'A terminal setup Goal whose Project preparation or Preview startup still fails is not an active repair: reopen it or request the smallest Planning repair instead of declaring the failure already accepted.',
      details,
    ].join(' '),
  }
}

export async function makePreviewAdapterExecutable(path: string) {
  await chmod(path, 0o755)
}
