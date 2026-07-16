import { appendFile, mkdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

export type TestRunClaim = 'contract' | 'browser' | 'live' | 'inspection' | 'regression'
export type TestRunStatus = 'running' | 'passed' | 'failed' | 'blocked'

export interface TestRunCodeProvenance {
  head: string
  branch: string
  dirty: boolean
  status: string[]
  worktreeDigest: string
}

export interface TestRunContext {
  artifactRoot: string
  scenario: string
  claim: TestRunClaim
  startedAt: string
  code: TestRunCodeProvenance
}

export interface TestRunEvidence {
  kind: 'file' | 'gallery' | 'log' | 'screenshot'
  path: string
  bytes: number
  sha256: string
}

export interface ScreenshotEvidence extends TestRunEvidence {
  kind: 'screenshot'
  artifactRoot: string
  scenario: string
  capturedAt: string
}

export interface TestRunReport extends TestRunContext {
  version: 1
  kind: 'test-run'
  status: TestRunStatus
  endedAt: string | null
  evidence: TestRunEvidence[]
  [key: string]: unknown
}

export interface TestRunCleanupResult {
  name: string
  status: 'completed' | 'failed' | 'timed_out'
  startedAt: string
  endedAt: string
  durationMs: number
  error?: string
  forced?: boolean
  forceError?: string
}

export interface TestRunCleanupRegistration {
  readonly name: string
  run(): Promise<TestRunCleanupResult>
}

export type TestRunDetails =
  | Record<string, unknown>
  | (() => Record<string, unknown> | Promise<Record<string, unknown>>)

interface RegisteredCleanup {
  name: string
  timeoutMs: number
  cleanup: () => void | Promise<void>
  force?: () => void | Promise<void>
  result?: Promise<TestRunCleanupResult>
}

interface TestRunLifecycle {
  cleanups: RegisteredCleanup[]
  finalizing: boolean
  sealed: boolean
}

const testRunLifecycles = new WeakMap<TestRunContext, TestRunLifecycle>()
const DEFAULT_CLEANUP_TIMEOUT_MS = 10_000

export function registerTestRunCleanup(
  context: TestRunContext,
  options: {
    name: string
    cleanup: () => void | Promise<void>
    force?: () => void | Promise<void>
    timeoutMs?: number
  },
): TestRunCleanupRegistration {
  const lifecycle = lifecycleFor(context)
  if (lifecycle.finalizing || lifecycle.sealed) {
    throw new Error(`Cannot register cleanup after Test Run finalization: ${context.scenario}`)
  }
  if (!options.name.trim()) throw new Error('Test Run cleanup name is required')
  const cleanup: RegisteredCleanup = {
    name: options.name,
    cleanup: options.cleanup,
    force: options.force,
    timeoutMs: positiveTimeout(options.timeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS),
  }
  lifecycle.cleanups.push(cleanup)
  return {
    name: cleanup.name,
    run: async () => {
      if (!cleanup.result) {
        await recordTestRunAction(context, 'cleanup_started', { resources: [cleanup.name] }, true)
      }
      return runCleanup(context, cleanup)
    },
  }
}

export async function cleanupTestRun(context: TestRunContext) {
  const lifecycle = lifecycleFor(context)
  const pending = lifecycle.cleanups.filter((cleanup) => !cleanup.result).reverse()
  if (pending.length === 0) {
    return Promise.all(lifecycle.cleanups.map((cleanup) => cleanup.result).filter(isDefined))
  }
  await recordTestRunAction(
    context,
    'cleanup_started',
    { resources: pending.map(({ name }) => name) },
    true,
  )
  for (const cleanup of pending) await runCleanup(context, cleanup)
  return Promise.all(lifecycle.cleanups.map((cleanup) => cleanup.result).filter(isDefined))
}

export async function finishTestRun(
  context: TestRunContext,
  intendedStatus: Exclude<TestRunStatus, 'running'>,
  details: TestRunDetails = {},
) {
  const lifecycle = lifecycleFor(context)
  if (lifecycle.finalizing || lifecycle.sealed) {
    throw new Error(`Terminal Test Run is immutable: ${context.artifactRoot}`)
  }
  lifecycle.finalizing = true
  try {
    const cleanupResults = await cleanupTestRun(context)
    const detailValues = typeof details === 'function' ? await details() : details
    const cleanupFailed = cleanupResults.some((result) => result.status !== 'completed')
    const status = cleanupFailed ? 'failed' : intendedStatus
    const report = await writeTestRunReport(context, status, {
      ...detailValues,
      ...(cleanupFailed && intendedStatus !== 'failed'
        ? { intendedStatus, failedAt: 'cleanup' }
        : {}),
      cleanup: {
        status: cleanupFailed ? 'failed' : 'passed',
        resources: cleanupResults,
      },
    })
    lifecycle.sealed = true
    return report
  } finally {
    lifecycle.finalizing = false
  }
}

export async function enterTestRunPhase(context: TestRunContext, phase: string) {
  await recordTestRunAction(context, 'phase_started', { phase }, true)
}

export async function markTestRunCheckpoint(context: TestRunContext, checkpoint: string) {
  await recordTestRunAction(context, 'checkpoint_reached', { checkpoint }, true)
}

export async function recordTestRunAction(
  context: Pick<TestRunContext, 'artifactRoot' | 'scenario'>,
  action: string,
  detail: Record<string, unknown> = {},
  announce = false,
) {
  const event = { occurredAt: new Date().toISOString(), action, ...detail }
  await appendFile(join(context.artifactRoot, 'actions.jsonl'), `${JSON.stringify(event)}\n`)
  if (announce) console.log(`[HOPI E2E][${context.scenario}] ${progressMessage(action, detail)}`)
  return event
}

export async function writeTestRunReport(
  context: TestRunContext,
  status: TestRunStatus,
  details: Record<string, unknown> = {},
) {
  const reportPath = join(context.artifactRoot, 'run.json')
  const existing = Bun.file(reportPath)
  if (await existing.exists()) {
    const current = (await existing.json()) as { status?: unknown }
    if (current.status !== 'running') {
      throw new Error(`Terminal Test Run is immutable: ${context.artifactRoot}`)
    }
  }
  if (
    status !== 'running' &&
    !(await Bun.file(join(context.artifactRoot, 'evidence.html')).exists())
  ) {
    await writeEvidenceGallery(context.artifactRoot, [context.artifactRoot])
  }
  const evidence = await collectLocalEvidence(context.artifactRoot)
  const report: TestRunReport = {
    ...details,
    version: 1,
    kind: 'test-run',
    artifactRoot: context.artifactRoot,
    scenario: context.scenario,
    claim: context.claim,
    status,
    startedAt: context.startedAt,
    endedAt: status === 'running' ? null : new Date().toISOString(),
    code: context.code,
    evidence,
  }
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}

export async function readTestRun(root: string): Promise<TestRunReport> {
  const path = join(resolve(root), 'run.json')
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Missing Test Run report: ${path}`)
  const report = (await file.json()) as TestRunReport
  if (report.version !== 1 || report.kind !== 'test-run') {
    throw new Error(`Unsupported Test Run report: ${path}`)
  }
  return report
}

export async function writeEvidenceGallery(targetRoot: string, sourceRoots: string[]) {
  const screenshots = await collectScreenshotEvidence(sourceRoots)
  if (screenshots.length === 0) return null
  await mkdir(targetRoot, { recursive: true })
  const cards = screenshots
    .map((screenshot) => {
      const source = encodeURI(
        relative(targetRoot, join(screenshot.artifactRoot, screenshot.path)).replaceAll('\\', '/'),
      )
      return [
        '<figure>',
        `  <a href="${escapeHtml(source)}"><img src="${escapeHtml(source)}" alt="${escapeHtml(`${screenshot.scenario}: ${screenshot.path}`)}"></a>`,
        `  <figcaption><strong>${escapeHtml(screenshot.scenario)}</strong><span>${escapeHtml(screenshot.path)}</span><code>${screenshot.sha256.slice(0, 12)}</code></figcaption>`,
        '</figure>',
      ].join('\n')
    })
    .join('\n')
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HOPI E2E Evidence</title>
  <style>
    :root { color: #25221d; background: #eee9df; font-family: Georgia, serif; }
    body { margin: 0; padding: 32px; }
    header { max-width: 860px; margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: clamp(2rem, 5vw, 4.5rem); line-height: .95; }
    p { margin: 0; color: #625b50; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
    figure { margin: 0; padding: 12px; background: #fffdf8; border: 1px solid #c9c0b2; box-shadow: 0 8px 24px #44372718; }
    img { display: block; width: 100%; height: auto; background: #d8d1c6; }
    figcaption { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; padding: 12px 4px 2px; }
    figcaption strong { font-family: ui-monospace, monospace; }
    figcaption span { grid-column: 1 / -1; overflow-wrap: anywhere; color: #625b50; }
    code { color: #8b3c24; }
  </style>
</head>
<body>
  <header>
    <h1>Retained evidence</h1>
    <p>Derived gallery only. Inspect canonical documents, APIs, logs, and Git state for workflow truth.</p>
  </header>
  <main>${cards}</main>
</body>
</html>
`
  const path = join(targetRoot, 'evidence.html')
  await Bun.write(path, html)
  return path
}

export async function collectScreenshotEvidence(sourceRoots: string[]) {
  const screenshots: ScreenshotEvidence[] = []
  for (const sourceRoot of sourceRoots.map((root) => resolve(root))) {
    const scenario = await readScenario(sourceRoot)
    const paths = await scanFiles(sourceRoot, ['screenshots/**/*.png'])
    const retained: ScreenshotEvidence[] = []
    for (const path of paths) {
      const evidence = await fileEvidence(sourceRoot, path)
      const metadata = await stat(join(sourceRoot, path))
      retained.push({
        ...evidence,
        kind: 'screenshot',
        artifactRoot: sourceRoot,
        scenario,
        capturedAt: metadata.mtime.toISOString(),
      })
    }
    screenshots.push(
      ...retained.toSorted((left, right) =>
        `${left.capturedAt}/${left.path}`.localeCompare(`${right.capturedAt}/${right.path}`),
      ),
    )
  }
  return screenshots
}

async function collectLocalEvidence(root: string) {
  const paths = await scanFiles(root, ['*', 'logs/**/*', 'screenshots/**/*'])
  const evidence = await Promise.all(
    paths.filter((path) => path !== 'run.json').map((path) => fileEvidence(root, path)),
  )
  return evidence.toSorted((left, right) => left.path.localeCompare(right.path))
}

async function scanFiles(root: string, patterns: string[]) {
  const paths = new Set<string>()
  for (const pattern of patterns) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: root,
      dot: true,
      onlyFiles: true,
    })) {
      paths.add(path.replaceAll('\\', '/'))
    }
  }
  return [...paths]
}

async function fileEvidence(root: string, path: string): Promise<TestRunEvidence> {
  const file = Bun.file(join(root, path))
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(await file.arrayBuffer())
  return {
    kind: evidenceKind(path),
    path,
    bytes: file.size,
    sha256: hasher.digest('hex'),
  }
}

function evidenceKind(path: string): TestRunEvidence['kind'] {
  if (path === 'evidence.html') return 'gallery'
  if (extname(path).toLowerCase() === '.png') return 'screenshot'
  if (extname(path).toLowerCase() === '.log') return 'log'
  return 'file'
}

async function readScenario(root: string) {
  try {
    const report = (await Bun.file(join(root, 'run.json')).json()) as { scenario?: unknown }
    return typeof report.scenario === 'string'
      ? report.scenario
      : (root.split(/[\\/]/).at(-1) ?? root)
  } catch {
    return root.split(/[\\/]/).at(-1) ?? root
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function lifecycleFor(context: TestRunContext) {
  let lifecycle = testRunLifecycles.get(context)
  if (!lifecycle) {
    lifecycle = { cleanups: [], finalizing: false, sealed: false }
    testRunLifecycles.set(context, lifecycle)
  }
  return lifecycle
}

async function runCleanup(context: TestRunContext, cleanup: RegisteredCleanup) {
  cleanup.result ??= (async (): Promise<TestRunCleanupResult> => {
    const startedAt = new Date().toISOString()
    const started = Date.now()
    const outcome = await within(cleanup.cleanup, cleanup.timeoutMs)
    let forceError: string | undefined
    if (outcome.status === 'timed_out' && cleanup.force) {
      const forced = await within(cleanup.force, Math.min(cleanup.timeoutMs, 1_000))
      if (forced.status !== 'completed') forceError = forced.error
    }
    const result: TestRunCleanupResult = {
      name: cleanup.name,
      status: outcome.status,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      ...(outcome.error ? { error: outcome.error } : {}),
      ...(outcome.status === 'timed_out' && cleanup.force ? { forced: true } : {}),
      ...(forceError ? { forceError } : {}),
    }
    await recordTestRunAction(
      context,
      result.status === 'completed' ? 'cleanup_completed' : 'cleanup_failed',
      { ...result },
      true,
    )
    return result
  })()
  return cleanup.result
}

async function within(
  operation: () => void | Promise<void>,
  timeoutMs: number,
): Promise<{ status: 'completed' | 'failed' | 'timed_out'; error?: string }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(
        () => ({ status: 'completed' as const }),
        (error) => ({ status: 'failed' as const, error: errorMessage(error) }),
      ),
    new Promise<{ status: 'timed_out'; error: string }>((resolveTimeout) => {
      timeout = setTimeout(
        () =>
          resolveTimeout({
            status: 'timed_out',
            error: `Cleanup exceeded ${timeoutMs}ms`,
          }),
        timeoutMs,
      )
    }),
  ])
  if (timeout) clearTimeout(timeout)
  return result
}

function positiveTimeout(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Cleanup timeout must be positive')
  return value
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}

function progressMessage(action: string, detail: Record<string, unknown>) {
  if (action === 'phase_started') return `phase: ${String(detail.phase)}`
  if (action === 'checkpoint_reached') return `checkpoint: ${String(detail.checkpoint)}`
  if (action === 'cleanup_started') {
    const resources = Array.isArray(detail.resources) ? detail.resources.join(', ') : ''
    return `cleanup: ${resources || 'none'}`
  }
  if (action === 'cleanup_completed') return `cleanup complete: ${String(detail.name)}`
  if (action === 'cleanup_failed') return `cleanup failed: ${String(detail.name)}`
  if (action === 'regression_step_started') return `step started: ${String(detail.id)}`
  if (action === 'regression_step_completed') {
    return `step ${String(detail.status)}: ${String(detail.id)}`
  }
  if (action === 'logical_run_limit_exceeded') {
    return `logical Run safety limit exceeded: ${String(detail.observed)}/${String(detail.limit)}`
  }
  return action
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
