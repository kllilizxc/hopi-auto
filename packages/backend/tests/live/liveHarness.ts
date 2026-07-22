import { appendFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ensureDefaultAgentAdapterConfig } from '../../src/agent/defaultAdapterConfig'
import type { AssistantModelRunner } from '../../src/assistant/workspaceAssistant'
import { parseInboxEventDocument } from '../../src/domain/assistantWorkspaceDocuments'
import { projectReleaseRef } from '../../src/domain/project'
import {
  type ProjectCodingDefaults,
  type ProjectCodingDefaultsInput,
  normalizeProjectCodingDefaults,
} from '../../src/domain/projectCodingDefaults'
import { type MvpServer, createServer } from '../../src/mvpServer'
import { managedRepoWorktreePaths } from '../../src/runtime/managedWorktreePaths'
import {
  type TestRunClaim,
  type TestRunCodeProvenance,
  type TestRunContext,
  type TestRunDetails,
  cleanupTestRun,
  enterTestRunPhase,
  markTestRunCheckpoint,
  recordTestRunAction,
  registerTestRunCleanup,
  finishTestRun as sealTestRun,
  writeTestRunReport,
} from '../testRunArtifact'

export interface LiveState {
  home: {
    homeId: string
    agentRoleCodingDefaults: { assistant: { codingDefaults: ProjectCodingDefaults } }
  }
  projects: Array<{
    projectId: string
    repos: Array<{ repoId: string; integrationRoot: string; primary: boolean }>
    goals: Array<{ id: string; title: string; lifecycle: string }>
  }>
  attentions: Array<{
    id: string
    target: string | null
    body: string
    resolvedAt: string | null
    notifiedAt: string | null
    operatorRequest: string | null
    projectId?: string
    goalId?: string
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
}

export interface LiveGoalDetail {
  goal: { id: string; title: string; lifecycle: string }
  projectAttention: {
    id: string
    target: string
    resolvedAt: string | null
  } | null
  works: Array<{
    id: string
    kind: 'planning' | 'engineering'
    stage: 'plan' | 'generate' | 'review' | 'done' | 'cancelled'
    dependsOn: string[]
  }>
  attentions: Array<{
    id: string
    target: string | null
    resolvedAt: string | null
    notifiedAt: string | null
    operatorRequest: string | null
  }>
}

export interface LiveHarness {
  scenario: string
  claim: 'live'
  artifactRoot: string
  homeRoot: string
  repoRoot: string
  baseUrl: string
  codingDefaults: ProjectCodingDefaults
  modelBoundaries: { reflection: 'real' | 'deterministic' }
  code: CodeProvenance
  currentPhase: string
  lastCheckpoint: string | null
  logicalRunLimit: number
  startedAt: string
  server: MvpServer
  stopped: boolean
}

export type CodeProvenance = TestRunCodeProvenance

export interface GitSemanticState {
  head: string
  branch: string
  status: string
  refs: string[]
}

export interface BrowserHarnessContext {
  scenario: string
  artifactRoot: string
  baseUrl: string
}

interface StateObservation {
  observedAt: string
  state: LiveState
  goals: Record<string, LiveGoalDetail>
}

interface ScreenshotTarget {
  browserPath: string
  localPath: string
  relativePath: string
}

const initializedBrowserRuns = new WeakSet<BrowserHarnessContext>()
const activeLogicalRunGuards = new Set<LogicalRunGuard>()
const ownedTestRunServers = new WeakMap<
  TestRunContext,
  Map<MvpServer, ReturnType<typeof registerTestRunCleanup>>
>()

export interface BrowserAuditVerification {
  available?: boolean
  valid?: boolean
  reason?: string
}

export type BrowserAuditMode = 'verified' | 'unavailable-allowed'

export interface StateRecorder {
  readonly violations: readonly string[]
  readonly observations: number
  stop(): Promise<void>
}

export async function startLiveHarness(
  scenario: string,
  options: { deterministicReflection?: boolean } = {},
): Promise<LiveHarness> {
  const logicalRunLimit = resolveLogicalRunLimit()
  const run = await startTestRun(scenario, 'live')
  const { artifactRoot, startedAt } = run
  const homeRoot = join(artifactRoot, 'home')
  const repoRoot = join(artifactRoot, 'repo')
  const codingDefaults = liveCodingDefaults()
  const modelBoundaries = {
    reflection: options.deterministicReflection ? 'deterministic' : 'real',
  } as const
  const code = run.code
  await ensureDefaultAgentAdapterConfig(homeRoot, codingDefaults)
  const server = createServer({
    rootDir: homeRoot,
    port: 0,
    ...(options.deterministicReflection
      ? { reflectionRunner: createDeterministicReflectionRunner(codingDefaults.transport) }
      : {}),
  })
  const harness: LiveHarness = {
    scenario,
    claim: 'live',
    artifactRoot,
    homeRoot,
    repoRoot,
    baseUrl: `http://127.0.0.1:${server.port}`,
    codingDefaults,
    modelBoundaries,
    code,
    currentPhase: 'startup',
    lastCheckpoint: null,
    logicalRunLimit,
    startedAt,
    server,
    stopped: false,
  }
  ownTestRunServer(harness, server)
  registerLogicalRunSafety(harness, homeRoot, { limit: logicalRunLimit })
  await writeRunReport(harness, 'running')
  await recordAction(harness, 'server_started', {
    baseUrl: harness.baseUrl,
    codingDefaults,
    modelBoundaries,
    logicalRunLimit,
  })
  return harness
}

export async function enterHarnessPhase(harness: LiveHarness, phase: string) {
  harness.currentPhase = phase
  await enterTestRunPhase(harness, phase)
}

export async function markHarnessCheckpoint(harness: LiveHarness, checkpoint: string) {
  harness.lastCheckpoint = checkpoint
  await markTestRunCheckpoint(harness, checkpoint)
}

export async function createHarnessArtifactRoot(scenario: string, startedAt: string) {
  const artifactBase = process.env.HOPI_E2E_ARTIFACT_ROOT
    ? resolve(process.env.HOPI_E2E_ARTIFACT_ROOT)
    : resolve(import.meta.dir, '..', '..', '..', '..', 'test-artifacts')
  const runId = `${safeSegment(scenario)}-${startedAt.replaceAll(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`
  const artifactRoot = join(artifactBase, runId)
  await mkdir(artifactRoot, { recursive: true })
  return artifactRoot
}

export async function startTestRun(scenario: string, claim: TestRunClaim): Promise<TestRunContext> {
  const startedAt = new Date().toISOString()
  const artifactRoot = await createHarnessArtifactRoot(scenario, startedAt)
  const context: TestRunContext = {
    scenario,
    claim,
    artifactRoot,
    startedAt,
    code: await readCodeProvenance(resolve(import.meta.dir, '..', '..', '..', '..')),
  }
  await writeTestRunReport(context, 'running')
  return context
}

export async function finishTestRun(
  context: TestRunContext,
  status: 'passed' | 'failed' | 'blocked',
  details: TestRunDetails = {},
) {
  const report = await sealTestRun(context, status, details)
  signalUnexpectedFinalStatus(context, status, report.status)
  return report
}

export async function finishLiveHarness(
  harness: LiveHarness,
  status: 'passed' | 'failed',
  details: Record<string, unknown> = {},
) {
  ensureLiveServerOwned(harness)
  let usage: Awaited<ReturnType<typeof readModelUsage>> | null = null
  const report = await sealTestRun(harness, status, async () => {
    usage = await readModelUsage(harness.homeRoot)
    return {
      codingDefaults: harness.codingDefaults,
      modelBoundaries: harness.modelBoundaries,
      browserAuditPolicy:
        process.env.HOPI_E2E_ALLOW_UNAUDITED_BROWSER === '1' ? 'optional' : 'required',
      logicalRunSafety: { limit: harness.logicalRunLimit },
      paths: { home: harness.homeRoot, repo: harness.repoRoot },
      ...details,
      usage,
      lastCheckpoint: harness.lastCheckpoint,
      failedAt: status === 'failed' ? harness.currentPhase : null,
    }
  })
  signalUnexpectedFinalStatus(harness, status, report.status)
  if (!usage) throw new Error('Live Test Run usage was not collected')
  return usage
}

export async function shutdownLiveHarness(harness: LiveHarness) {
  ensureLiveServerOwned(harness)
  await stopLiveServer(harness)
}

export function ownTestRunServer(context: TestRunContext, server: MvpServer, name?: string) {
  let servers = ownedTestRunServers.get(context)
  if (!servers) {
    servers = new Map()
    ownedTestRunServers.set(context, servers)
  }
  const existing = servers.get(server)
  if (existing) return existing
  const resourceName = name ?? (servers.size === 0 ? 'server' : `server-${servers.size + 1}`)
  let stopped = false
  const registration = registerTestRunCleanup(context, {
    name: resourceName,
    timeoutMs: cleanupTimeoutMs(),
    cleanup: async () => {
      if (stopped) return
      await server.shutdown()
      stopped = true
      await recordAction(context, 'server_stopped', { resource: resourceName })
    },
    force: () => server.stop(true),
  })
  servers.set(server, registration)
  return registration
}

function ensureLiveServerOwned(harness: LiveHarness) {
  return ownTestRunServer(harness, harness.server)
}

async function stopLiveServer(harness: LiveHarness) {
  if (harness.stopped) return
  const results = await cleanupTestRun(harness)
  harness.stopped = true
  const failure = results.find((result) => result.status !== 'completed')
  if (failure) throw new Error(failure.error ?? `Cleanup failed: ${failure.name}`)
}

export async function recordAction(
  harness: Pick<TestRunContext, 'artifactRoot' | 'scenario'>,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await recordTestRunAction(harness, action, detail)
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const source = await response.text()
  let body: unknown
  try {
    body = JSON.parse(source)
  } catch {
    throw new Error(`${response.status} ${path}: ${source || 'empty response'}`)
  }
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`)
  return body as T
}

export async function waitForValue<T>(
  read: () => Promise<T>,
  accepts: (value: T) => boolean,
  options: { timeoutMs: number; intervalMs?: number; description: string },
) {
  const deadline = Date.now() + options.timeoutMs
  let lastValue: T | undefined
  while (Date.now() < deadline) {
    await assertLogicalRunSafety()
    lastValue = await read()
    await assertLogicalRunSafety()
    if (accepts(lastValue)) return lastValue
    await Bun.sleep(options.intervalMs ?? 500)
  }
  throw new Error(
    `Timed out waiting for ${options.description}. Last value: ${safeJson(lastValue)}`,
  )
}

interface LogicalRunGuard {
  check(): Promise<void>
  close(): void
}

export function registerLogicalRunSafety(
  context: TestRunContext,
  homeRoot: string,
  options: { limit?: number } = {},
) {
  const limit = positiveLogicalRunLimit(options.limit ?? resolveLogicalRunLimit())
  let closed = false
  let exceeded: Error | null = null
  let lastCheckedAt = 0
  let pendingCheck: Promise<void> | null = null
  const guard: LogicalRunGuard = {
    async check() {
      if (closed) return
      if (exceeded) throw exceeded
      if (Date.now() - lastCheckedAt < 100) return
      pendingCheck ??= (async () => {
        const logicalRuns = await countLogicalRuns(homeRoot, { tolerateUnreadable: true })
        const observed = Object.values(logicalRuns).reduce((sum, count) => sum + count, 0)
        lastCheckedAt = Date.now()
        if (observed <= limit) return
        exceeded = new Error(`Logical Run safety limit exceeded: ${observed} > ${limit}`)
        await recordTestRunAction(
          context,
          'logical_run_limit_exceeded',
          { limit, observed, logicalRuns },
          true,
        )
        throw exceeded
      })().finally(() => {
        pendingCheck = null
      })
      await pendingCheck
    },
    close() {
      closed = true
      activeLogicalRunGuards.delete(guard)
    },
  }
  activeLogicalRunGuards.add(guard)
  registerTestRunCleanup(context, {
    name: 'logical-run-safety',
    cleanup: () => guard.close(),
  })
  return { limit, check: () => guard.check() }
}

async function assertLogicalRunSafety() {
  for (const guard of activeLogicalRunGuards) await guard.check()
}

export async function startStateRecorder(harness: LiveHarness): Promise<StateRecorder> {
  let stopping = false
  let observations = 0
  let previous = ''
  const violations = new Set<string>()
  const statesPath = join(harness.artifactRoot, 'states.jsonl')
  const invariantsPath = join(harness.artifactRoot, 'invariants.jsonl')

  const capture = async (settled = false) => {
    const observation = await readObservation(harness.baseUrl)
    const serializedState = JSON.stringify({ state: observation.state, goals: observation.goals })
    if (serializedState !== previous) {
      previous = serializedState
      observations += 1
      await appendFile(statesPath, `${JSON.stringify(observation)}\n`)
    }
    const currentViolations = [
      ...stateInvariantViolations(observation),
      ...(settled ? settledAttentionLivenessViolations(observation.state) : []),
    ]
    for (const violation of currentViolations) {
      if (violations.has(violation)) continue
      violations.add(violation)
      await appendFile(
        invariantsPath,
        `${JSON.stringify({ observedAt: observation.observedAt, violation })}\n`,
      )
    }
  }

  await capture()
  const loop = (async () => {
    while (!stopping) {
      await Bun.sleep(250)
      if (stopping) break
      try {
        await capture()
      } catch (error) {
        await appendFile(
          statesPath,
          `${JSON.stringify({ observedAt: new Date().toISOString(), readError: errorMessage(error) })}\n`,
        )
      }
    }
  })()

  const stopRecorder = async () => {
    stopping = true
    await loop
    try {
      await capture(true)
    } catch {
      // The retained runtime already contains the server-side failure evidence.
    }
  }
  const cleanup = registerTestRunCleanup(harness, {
    name: 'state-recorder',
    timeoutMs: cleanupTimeoutMs(),
    cleanup: stopRecorder,
    force: () => {
      stopping = true
    },
  })

  return {
    get violations() {
      return [...violations]
    },
    get observations() {
      return observations
    },
    async stop() {
      const result = await cleanup.run()
      if (result.status !== 'completed') {
        throw new Error(result.error ?? 'State recorder cleanup failed')
      }
      if (violations.size > 0) {
        throw new Error(`State invariant violations: ${[...violations].join(' | ')}`)
      }
    },
  }
}

export function settledAttentionLivenessViolations(state: Pick<LiveState, 'attentions'>): string[] {
  return state.attentions
    .filter(
      (attention) =>
        attention.target !== null && attention.resolvedAt === null && !attention.operatorRequest,
    )
    .map(
      (attention) =>
        `settled boundary retains Assistant-owned targeted Attention ${attention.id} at ${attention.target}`,
    )
}

export async function waitForGoalQuiescence(
  harness: Pick<LiveHarness, 'baseUrl' | 'homeRoot'>,
  projectId: string,
  goalId: string,
  options: { timeoutMs?: number; stableMs?: number } = {},
) {
  let stableSince = 0
  let previous = ''
  return waitForValue(
    async () => {
      const [state, reflections, pendingInbox] = await Promise.all([
        requestJson<LiveState>(harness.baseUrl, '/api/state'),
        requestJson<{
          items: Array<{ manifest: { reflectionId: string; status: string } }>
        }>(harness.baseUrl, '/api/debug/reflections?limit=100'),
        readPendingInboxEvents(harness.homeRoot),
      ])
      const goal = state.projects
        .find((project) => project.projectId === projectId)
        ?.goals.find((candidate) => candidate.id === goalId)
      const signature = JSON.stringify({ state, reflections: reflections.items, pendingInbox })
      const quiet =
        goal?.lifecycle === 'done' &&
        state.activeRuns.length === 0 &&
        reflections.items.every((item) => item.manifest.status !== 'running') &&
        pendingInbox.length === 0
      if (!quiet || signature !== previous) {
        previous = signature
        stableSince = quiet ? Date.now() : 0
      }
      return { quiet, stableFor: stableSince ? Date.now() - stableSince : 0 }
    },
    (value) => value.quiet && value.stableFor >= (options.stableMs ?? 3_000),
    {
      timeoutMs: options.timeoutMs ?? 5 * 60_000,
      description: `Goal ${projectId}/${goalId} and post-completion Reflection to settle`,
    },
  )
}

export async function sendAssistantMessage(
  harness: BrowserHarnessContext,
  content: string,
  options: { evidencePrefix?: string; pagePath?: string; imagePaths?: string[] } = {},
) {
  const url = `${harness.baseUrl}${options.pagePath ?? '/projects'}`
  const contentExpression = browserUtf8Expression(content)
  const prefix = options.evidencePrefix ? `${safeSegment(options.evidencePrefix)}-` : ''
  const screenshots: {
    pageLoaded: ScreenshotTarget
    assistantOpen: ScreenshotTarget
    composerFilled: ScreenshotTarget
    messageSubmitted: ScreenshotTarget
    imagesAttached?: ScreenshotTarget
  } = {
    pageLoaded: await screenshotTarget(harness, `${prefix}01-projects-loaded.png`),
    assistantOpen: await screenshotTarget(harness, `${prefix}02-assistant-open.png`),
    composerFilled: await screenshotTarget(harness, `${prefix}03-composer-filled.png`),
    messageSubmitted: await screenshotTarget(harness, `${prefix}04-message-submitted.png`),
  }
  const imagePaths = options.imagePaths ?? []
  for (const path of imagePaths) {
    if (!(await Bun.file(path).exists())) throw new Error(`Assistant image does not exist: ${path}`)
  }
  const browserImagePaths = await Promise.all(imagePaths.map(browserWritablePath))
  if (imagePaths.length > 0) {
    screenshots.imagesAttached = await screenshotTarget(harness, `${prefix}03b-images-attached.png`)
  }
  const openExpression = [
    '(() => {',
    '  const button = document.querySelector(\'button[aria-label="Open Assistant"]\')',
    '  if (!button) return { opened: Boolean(document.querySelector(\'textarea[placeholder^="Tell HOPI"]\')), alreadyOpen: true }',
    '  button.click()',
    '  return { opened: true }',
    '})()',
  ].join('\n')
  const fillExpression = [
    '(() => {',
    '  const textarea = document.querySelector(\'textarea[placeholder^="Tell HOPI"]\')',
    "  if (!textarea) return { filled: false, reason: 'missing composer' }",
    "  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set",
    "  if (!setter) return { filled: false, reason: 'missing native value setter' }",
    `  setter.call(textarea, ${contentExpression})`,
    "  textarea.dispatchEvent(new Event('input', { bubbles: true }))",
    '  return { filled: true }',
    '})()',
  ].join('\n')
  const sendExpression = [
    '(() => {',
    '  const button = document.querySelector(\'button[aria-label="Send message"]\')',
    "  if (!button) return { sent: false, reason: 'missing Send button' }",
    "  if (button.disabled) return { sent: false, reason: 'Send button disabled' }",
    '  button.click()',
    '  return { sent: true }',
    '})()',
  ].join('\n')
  const visibleExpression = `document.body.innerText.includes(${contentExpression})`
  const uploadLines =
    browserImagePaths.length > 0
      ? [
          `upload_file('input[type="file"]', [${browserImagePaths.map(pythonUtf8Expression).join(', ')}])`,
          'attached = 0',
          'for _ in range(40):',
          '    attached = int(js("document.querySelectorAll(\'.composer-images img\').length"))',
          `    if attached == ${browserImagePaths.length}: break`,
          '    time.sleep(0.25)',
          captureScreenshotLine(screenshots.imagesAttached as ScreenshotTarget),
        ]
      : ['attached = 0']
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    captureScreenshotLine(screenshots.pageLoaded),
    `opened = js(${JSON.stringify(openExpression)})`,
    'time.sleep(0.25)',
    captureScreenshotLine(screenshots.assistantOpen),
    `filled = js(${JSON.stringify(fillExpression)})`,
    'time.sleep(0.25)',
    captureScreenshotLine(screenshots.composerFilled),
    ...uploadLines,
    `hopi_audit_note("about to submit HOPI live E2E Assistant message", scenario=${JSON.stringify(harness.scenario)})`,
    `sent = js(${JSON.stringify(sendExpression)})`,
    'visible = False',
    'for _ in range(80):',
    `    visible = bool(js(${JSON.stringify(visibleExpression)}))`,
    '    if visible: break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshots.messageSubmitted),
    'print("HOPI_E2E_SEND=" + json.dumps({"opened": opened, "filled": filled, "attached": attached, "sent": sent, "visible": visible, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `${prefix}browser-send.log`,
    'HOPI_E2E_SEND=',
    script,
  )) as {
    opened?: { opened?: boolean; reason?: string }
    filled?: { filled?: boolean; reason?: string }
    attached?: number
    sent?: { sent?: boolean; reason?: string }
    visible?: boolean
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.opened?.opened || !evidence.filled?.filled || !evidence.sent?.sent) {
    throw new Error(`Assistant composer submission failed: ${safeJson(evidence)}`)
  }
  if (evidence.attached !== imagePaths.length) {
    throw new Error(`Assistant image attachment failed: ${safeJson(evidence)}`)
  }
  if (!evidence.visible) throw new Error('Submitted Assistant message did not render in the feed')
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await Bun.write(
    join(harness.artifactRoot, `${prefix}browser-send-evidence.json`),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshots: retainedScreenshots }, null, 2)}\n`,
  )
  await recordAction(harness, 'assistant_message_submitted', {
    images: imagePaths.length,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function captureBrowserPage(
  harness: BrowserHarnessContext,
  url: string,
  options: { evidencePrefix: string; visibleText?: string; auditLabel: string },
) {
  const screenshot = await screenshotTarget(harness, `${safeSegment(options.evidencePrefix)}.png`)
  const visibleExpression = options.visibleText
    ? `document.body.innerText.includes(${browserUtf8Expression(options.visibleText)})`
    : 'true'
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    `visible = bool(js(${JSON.stringify(visibleExpression)}))`,
    captureScreenshotLine(screenshot),
    `hopi_audit_note(${JSON.stringify(options.auditLabel)}, scenario=${JSON.stringify(harness.scenario)})`,
    'print("HOPI_E2E_PAGE=" + json.dumps({"visible": visible, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `${safeSegment(options.evidencePrefix)}-browser-page.log`,
    'HOPI_E2E_PAGE=',
    script,
  )) as {
    visible?: boolean
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.visible) throw new Error(`Expected page content was not visible: ${url}`)
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots([screenshot])
  await recordAction(harness, 'browser_page_captured', {
    url,
    screenshot: screenshot.relativePath,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshot: screenshot.relativePath }
}

export async function captureAssistantReply(
  harness: BrowserHarnessContext,
  visibleReplyText: string,
) {
  return captureAssistantFeedCheckpoint(harness, visibleReplyText, {
    action: 'assistant_reply_captured',
    auditLabel: 'HOPI Assistant reply visible',
    evidenceName: 'browser-reply-evidence.json',
    logName: 'browser-reply.log',
    marker: 'HOPI_E2E_REPLY=',
    screenshotName: '05-assistant-reply.png',
    subject: 'Handled Assistant reply',
  })
}

export async function captureCompletionUpdate(
  harness: BrowserHarnessContext,
  visibleUpdateText: string,
) {
  return captureAssistantFeedCheckpoint(harness, visibleUpdateText, {
    action: 'completion_update_captured',
    auditLabel: 'HOPI Goal completion update visible',
    evidenceName: 'browser-completion-evidence.json',
    logName: 'browser-completion.log',
    marker: 'HOPI_E2E_COMPLETION=',
    rejectVisibleErrorActivity: true,
    screenshotName: '05-completion-update.png',
    subject: 'Goal completion update',
  })
}

async function captureAssistantFeedCheckpoint(
  harness: BrowserHarnessContext,
  visibleText: string,
  options: {
    action: string
    auditLabel: string
    evidenceName: string
    logName: string
    marker: string
    rejectVisibleErrorActivity?: boolean
    screenshotName: string
    subject: string
  },
) {
  const url = `${harness.baseUrl}/projects`
  const screenshot = await screenshotTarget(harness, options.screenshotName)
  const openExpression = [
    '(() => {',
    '  const button = document.querySelector(\'button[aria-label="Open Assistant"]\')',
    "  if (!button) return { opened: false, reason: 'missing Assistant button' }",
    '  button.click()',
    '  return { opened: true }',
    '})()',
  ].join('\n')
  const normalizedText = visibleText.replaceAll(/\s+/g, ' ').trim()
  const textExpression = browserUtf8Expression(normalizedText)
  const visibleExpression = [
    '(() => {',
    "  const text = document.body.innerText.replace(/\\s+/g, ' ').trim()",
    `  return text.includes(${textExpression})`,
    '})()',
  ].join('\n')
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    `opened = js(${JSON.stringify(openExpression)})`,
    'visible = False',
    'for _ in range(120):',
    `    visible = bool(js(${JSON.stringify(visibleExpression)}))`,
    '    if visible: break',
    '    time.sleep(0.25)',
    'visible_error_activity = bool(js("Boolean(document.querySelector(\'.unified-feed-activity.error\'))"))',
    captureScreenshotLine(screenshot),
    `hopi_audit_note(${JSON.stringify(options.auditLabel)}, scenario=${JSON.stringify(harness.scenario)})`,
    `print(${JSON.stringify(options.marker)} + json.dumps({"opened": opened, "visible": visible, "visibleErrorActivity": visible_error_activity, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))`,
  ].join('\n')
  const evidence = (await runBrowserHarness(harness, options.logName, options.marker, script)) as {
    opened?: { opened?: boolean; reason?: string }
    visible?: boolean
    visibleErrorActivity?: boolean
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.opened?.opened) {
    throw new Error(`${options.subject} inspection failed: ${safeJson(evidence.opened)}`)
  }
  if (!evidence.visible) throw new Error(`${options.subject} did not render in the feed`)
  if (options.rejectVisibleErrorActivity && evidence.visibleErrorActivity) {
    throw new Error(`${options.subject} rendered beside a misleading Assistant error activity`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots([screenshot])
  const retainedScreenshot = screenshot.relativePath
  await Bun.write(
    join(harness.artifactRoot, options.evidenceName),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshot: retainedScreenshot }, null, 2)}\n`,
  )
  await recordAction(harness, options.action, {
    screenshot: retainedScreenshot,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshot: retainedScreenshot }
}

export async function inspectKanban(
  harness: BrowserHarnessContext,
  projectId: string,
  goalId: string,
  options: { evidencePrefix?: string } = {},
) {
  const url = `${harness.baseUrl}/projects/${encodeURIComponent(projectId)}/board/${encodeURIComponent(goalId)}`
  const prefix = options.evidencePrefix ? `${safeSegment(options.evidencePrefix)}-` : ''
  const screenshots = {
    start: await screenshotTarget(harness, `${prefix}06-kanban-start.png`),
    end: await screenshotTarget(harness, `${prefix}07-kanban-end.png`),
  }
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'view = None',
    'for _ in range(80):',
    "    view = js(\"\"\"(() => ({path: location.pathname, kanban: Boolean(document.querySelector('.kanban-board')), cancelledArchive: Boolean(document.querySelector('.cancelled-archive')), title: document.querySelector('.goal-title-block h1')?.textContent?.trim() || null, progress: document.querySelector('.goal-focus-strip > div:nth-child(3) strong')?.textContent?.trim() || null, projectBlocked: Boolean(document.querySelector('.project-blocked-banner')), projectAttentionBody: document.querySelector('.project-blocked-banner p')?.textContent?.trim() || null}))()\"\"\")",
    '    if view and view.get("kanban"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshots.start),
    `hopi_audit_note("scroll terminal HOPI Kanban to its real end", scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)}, goal_id=${JSON.stringify(goalId)})`,
    'scroll = js("""(() => { const element = document.querySelector(\'.kanban-scroll\'); if (!element) return {scrolled: false}; element.scrollLeft = element.scrollWidth; return {scrolled: true, left: element.scrollLeft, max: element.scrollWidth - element.clientWidth}; })()""")',
    'time.sleep(0.25)',
    captureScreenshotLine(screenshots.end),
    `hopi_audit_note("HOPI live E2E terminal Kanban captured", scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)}, goal_id=${JSON.stringify(goalId)})`,
    'print("HOPI_E2E_BROWSER=" + json.dumps({"view": view, "scroll": scroll, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `${prefix}browser-kanban.log`,
    'HOPI_E2E_BROWSER=',
    script,
  )) as {
    view?: {
      path?: string
      kanban?: boolean
      cancelledArchive?: boolean
      title?: string
      progress?: string
      projectBlocked?: boolean
      projectAttentionBody?: string | null
    }
    scroll?: { scrolled?: boolean; left?: number; max?: number }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.view?.kanban) throw new Error(`Kanban did not render: ${safeJson(evidence.view)}`)
  if (!evidence.scroll?.scrolled || (evidence.scroll.max ?? 0) > (evidence.scroll.left ?? -1) + 1) {
    throw new Error(`Kanban did not scroll to its terminal edge: ${safeJson(evidence.scroll)}`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await Bun.write(
    join(harness.artifactRoot, `${prefix}browser-evidence.json`),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshots: retainedScreenshots }, null, 2)}\n`,
  )
  await recordAction(harness, 'kanban_inspected', {
    projectId,
    goalId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function clickGoalControl(
  harness: BrowserHarnessContext,
  projectId: string,
  goalId: string,
  control: 'Pause' | 'Resume',
) {
  const url = `${harness.baseUrl}/projects/${encodeURIComponent(projectId)}/board/${encodeURIComponent(goalId)}`
  const screenshot = await screenshotTarget(harness, `goal-${control.toLowerCase()}-clicked.png`)
  const controlExpression = browserUtf8Expression(control)
  const nextControlExpression = browserUtf8Expression(control === 'Pause' ? 'Resume' : 'Pause')
  const settleExpression = [
    '(() => {',
    `  const next = [...document.querySelectorAll('button')].some((candidate) => candidate.textContent?.trim() === ${nextControlExpression})`,
    "  const working = Boolean(document.querySelector('.working-indicator'))",
    "  const terminal = document.querySelector('.goal-focus-strip > div:nth-child(2) strong')?.textContent?.trim() === 'done'",
    `  return { nextControlVisible: next, working, terminal, settled: ${control === 'Pause' ? 'next && !working' : 'next || terminal'} }`,
    '})()',
  ].join('\n')
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'clicked = None',
    'for _ in range(80):',
    `    clicked = js(${JSON.stringify(`(() => { const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${controlExpression}); if (!button) return { found: false }; if (button.disabled) return { found: true, disabled: true }; button.click(); return { found: true, disabled: false }; })()`)})`,
    '    if clicked and clicked.get("found") and not clicked.get("disabled"): break',
    '    time.sleep(0.25)',
    'settled = None',
    'for _ in range(80):',
    `    settled = js(${JSON.stringify(settleExpression)})`,
    '    if settled and settled.get("settled"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshot),
    `hopi_audit_note(${JSON.stringify(`HOPI ${control} Goal control clicked`)}, scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)}, goal_id=${JSON.stringify(goalId)})`,
    'print("HOPI_E2E_GOAL_CONTROL=" + json.dumps({"clicked": clicked, "settled": settled, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `goal-${control.toLowerCase()}-control.log`,
    'HOPI_E2E_GOAL_CONTROL=',
    script,
  )) as {
    clicked?: { found?: boolean; disabled?: boolean }
    settled?: {
      nextControlVisible?: boolean
      working?: boolean
      terminal?: boolean
      settled?: boolean
    }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.clicked?.found || evidence.clicked.disabled) {
    throw new Error(`${control} control could not be clicked: ${safeJson(evidence.clicked)}`)
  }
  if (!evidence.settled?.settled) {
    throw new Error(
      `${control} control did not reach its visible settled projection: ${safeJson(evidence.settled)}`,
    )
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots([screenshot])
  await Bun.write(
    join(harness.artifactRoot, `goal-${control.toLowerCase()}-evidence.json`),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshot: screenshot.relativePath }, null, 2)}\n`,
  )
  await recordAction(harness, `goal_${control.toLowerCase()}_clicked`, {
    projectId,
    goalId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshot: screenshot.relativePath }
}

export async function configureProjectInBrowser(
  harness: BrowserHarnessContext,
  input: {
    projectId: string
    primaryRepoId: string
    primaryRepoPath: string
    duplicateRepoPath: string
    secondaryRepoId: string
    secondaryRepoPath: string
    assistantModel: string
    generatorModel: string
  },
) {
  const url = `${harness.baseUrl}/projects`
  const screenshots = {
    initial: await screenshotTarget(harness, '01-project-link-initial.png'),
    cancelled: await screenshotTarget(harness, '02-project-picker-cancelled.png'),
    duplicateSelected: await screenshotTarget(harness, '03-project-duplicate-selected.png'),
    conflict: await screenshotTarget(harness, '04-project-duplicate-rejected.png'),
    linked: await screenshotTarget(harness, '05-project-multi-repo-linked.png'),
    assistantConfigured: await screenshotTarget(harness, '06-assistant-model-configured.png'),
    generatorConfigured: await screenshotTarget(harness, '07-generator-model-configured.png'),
  }
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, browserUtf8Expression(value)]),
  ) as Record<keyof typeof input, string>
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `target = new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'def page_js(expression):',
    '    return js(expression, target_id=target)',
    'def wait_js(expression, attempts=120):',
    '    value = None',
    '    for _ in range(attempts):',
    '        value = page_js(expression)',
    '        if value: return value',
    '        time.sleep(0.25)',
    '    return value',
    'def require_step(name, value):',
    '    if not value: raise RuntimeError("Project configuration browser step did not settle: " + name)',
    `picker_ready = wait_js(${JSON.stringify("(() => { const button = document.querySelector('.project-directory-picker'); return Boolean(button && !button.disabled) })()")})`,
    'require_step("picker_ready", picker_ready)',
    captureScreenshotLine(screenshots.initial, 'target'),
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    'time.sleep(0.25)',
    `cancelled = wait_js(${JSON.stringify("!document.querySelector('.project-directory-picker')?.disabled && document.querySelectorAll('.project-create-repo').length === 0")})`,
    'require_step("picker_cancelled", cancelled)',
    captureScreenshotLine(screenshots.cancelled, 'target'),
    `hopi_audit_note("cancel system repository selection", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `primary_selected = wait_js(${JSON.stringify("document.querySelectorAll('.project-create-repo').length === 1")})`,
    'require_step("primary_selected", primary_selected)',
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `duplicate_selected = wait_js(${JSON.stringify("document.querySelectorAll('.project-create-repo').length === 2")})`,
    'require_step("duplicate_selected", duplicate_selected)',
    captureScreenshotLine(screenshots.duplicateSelected, 'target'),
    `hopi_audit_note("reject duplicate Git identity before Project link", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify('document.querySelector(\'.link-project-panel button[type="submit"]\')?.click()')})`,
    `conflict_visible = wait_js(${JSON.stringify("document.querySelector('.error-banner')?.textContent?.includes('same Git Repo')")})`,
    'require_step("duplicate_conflict_visible", conflict_visible)',
    `page_js(${JSON.stringify("fetch('/api/state').then((response) => response.json()).then((state) => { window.__hopiConflictAtomic = state.projects.length === 0 })")})`,
    `conflict_atomic = wait_js(${JSON.stringify('window.__hopiConflictAtomic === true')})`,
    'require_step("duplicate_conflict_atomic", conflict_atomic)',
    captureScreenshotLine(screenshots.conflict, 'target'),
    `duplicate_removed = page_js(${JSON.stringify(
      `(() => { const row = [...document.querySelectorAll('.project-create-repo')].find((candidate) => candidate.querySelector('.project-create-repo-copy small')?.title === ${values.duplicateRepoPath}); const button = row?.querySelector('button[aria-label^="Remove"]'); if (!button) return false; button.click(); return true })()`,
    )})`,
    'require_step("duplicate_removed", duplicate_removed)',
    `one_repo_remains = wait_js(${JSON.stringify("document.querySelectorAll('.project-create-repo').length === 1")})`,
    'require_step("one_repo_remains", one_repo_remains)',
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `final_selection = wait_js(${JSON.stringify("document.querySelectorAll('.project-create-repo').length === 2")})`,
    'require_step("secondary_selected", final_selection)',
    `repo_ids_ready = page_js(${JSON.stringify(
      [
        '(() => {',
        `  const values = new Map([[${values.primaryRepoPath}, ${values.primaryRepoId}], [${values.secondaryRepoPath}, ${values.secondaryRepoId}]])`,
        "  const rows = [...document.querySelectorAll('.project-create-repo')]",
        '  if (rows.length !== values.size) return false',
        '  for (const row of rows) {',
        "    const path = row.querySelector('.project-create-repo-copy small')?.title",
        "    const repoId = row.querySelector('.project-create-repo-copy strong')?.textContent?.trim()",
        '    if (!path || values.get(path) !== repoId) return false',
        '  }',
        '  return true',
        '})()',
      ].join('\n'),
    )})`,
    'require_step("derived_repo_ids_ready", repo_ids_ready)',
    `hopi_audit_note("create one multi-repository HOPI Project", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify('document.querySelector(\'.link-project-panel button[type="submit"]\')?.click()')})`,
    `linked = wait_js(${JSON.stringify(`(() => { const card = [...document.querySelectorAll('.project-card')].find((candidate) => candidate.querySelector('h2')?.title === ${values.projectId}); const ids = [...(card?.querySelectorAll('.project-repo-id') ?? [])].map((element) => element.textContent?.trim()); return ids.includes(${values.primaryRepoId}) && ids.includes(${values.secondaryRepoId}) && ids.length === 2 })()`)})`,
    'require_step("project_linked", linked)',
    captureScreenshotLine(screenshots.linked, 'target'),
    `assistant_filled = page_js(${JSON.stringify(
      [
        '(() => {',
        "  const input = document.querySelector('.assistant-settings-form input')",
        "  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set",
        "  if (!input || !setter) return { ok: false, reason: 'missing Assistant model input' }",
        `  setter.call(input, ${values.assistantModel})`,
        "  input.dispatchEvent(new Event('input', { bubbles: true }))",
        '  return { ok: true }',
        '})()',
      ].join('\n'),
    )})`,
    'require_step("assistant_model_filled", assistant_filled.get("ok"))',
    `hopi_audit_note("save Home Assistant model", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("[...document.querySelectorAll('.assistant-settings-form button')].find((candidate) => candidate.textContent?.trim().endsWith('Save'))?.click()")})`,
    `assistant_visible = wait_js(${JSON.stringify(`document.querySelector('.assistant-settings-current strong')?.textContent?.includes(${values.assistantModel})`)})`,
    'require_step("assistant_model_visible", assistant_visible)',
    captureScreenshotLine(screenshots.assistantConfigured, 'target'),
    `configured_open = page_js(${JSON.stringify("(() => { const button = document.querySelectorAll('.assistant-settings-form .app-select__trigger')[0]; if (!button) return false; button.click(); return true })()")})`,
    'require_step("role_configuration_open", configured_open)',
    `role_options_visible = wait_js(${JSON.stringify("[...document.querySelectorAll('[role=option]')].some((option) => option.textContent?.includes('Generator'))")})`,
    'require_step("role_options_visible", role_options_visible)',
    `role_selected = page_js(${JSON.stringify("(() => { const option = [...document.querySelectorAll('[role=option]')].find((candidate) => candidate.textContent?.includes('Generator')); if (!option) return false; option.click(); return true })()")})`,
    'require_step("generator_role_selected", role_selected)',
    `hopi_audit_note("select Claude for Home Generator role", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelectorAll('.assistant-settings-form .app-select__trigger')[1]?.click()")})`,
    `options_visible = wait_js(${JSON.stringify("[...document.querySelectorAll('[role=option]')].some((option) => option.textContent?.includes('Claude'))")})`,
    'require_step("generator_agent_options_visible", options_visible)',
    `agent_selected = page_js(${JSON.stringify("(() => { const option = [...document.querySelectorAll('[role=option]')].find((candidate) => candidate.textContent?.includes('Claude')); if (!option) return false; option.click(); return true })()")})`,
    'require_step("generator_agent_selected", agent_selected)',
    'time.sleep(0.25)',
    `generator_filled = page_js(${JSON.stringify(
      [
        '(() => {',
        "  const input = document.querySelector('.assistant-settings-form input')",
        "  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set",
        "  if (!input || !setter) return { ok: false, reason: 'missing Generator model input' }",
        `  setter.call(input, ${values.generatorModel})`,
        "  input.dispatchEvent(new Event('input', { bubbles: true }))",
        '  return { ok: true }',
        '})()',
      ].join('\n'),
    )})`,
    'require_step("generator_model_filled", generator_filled.get("ok"))',
    `hopi_audit_note("save Home Generator model", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("[...document.querySelectorAll('.assistant-settings-form button')].find((candidate) => candidate.textContent?.trim().endsWith('Save'))?.click()")})`,
    `generator_model_visible = wait_js(${JSON.stringify(`document.querySelector('.assistant-settings-current strong')?.textContent?.includes(${values.generatorModel})`)})`,
    'require_step("generator_model_visible", generator_model_visible)',
    captureScreenshotLine(screenshots.generatorConfigured, 'target'),
    `hopi_audit_note("HOPI Project linking and Home role configuration completed", scenario=${JSON.stringify(harness.scenario)})`,
    'print("HOPI_E2E_CONFIGURATION=" + json.dumps({"cancelled": cancelled, "primarySelected": primary_selected, "duplicateSelected": duplicate_selected, "conflictVisible": conflict_visible, "conflictAtomic": conflict_atomic, "duplicateRemoved": duplicate_removed, "oneRepoRemains": one_repo_remains, "finalSelection": final_selection, "repoIdsReady": repo_ids_ready, "linked": linked, "assistantFilled": assistant_filled, "assistantVisible": assistant_visible, "configuredOpen": configured_open, "roleSelected": role_selected, "agentSelected": agent_selected, "generatorFilled": generator_filled, "generatorModelVisible": generator_model_visible, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    'browser-configuration.log',
    'HOPI_E2E_CONFIGURATION=',
    script,
  )) as Record<string, unknown> & {
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  for (const field of [
    'cancelled',
    'primarySelected',
    'duplicateSelected',
    'conflictVisible',
    'conflictAtomic',
    'duplicateRemoved',
    'oneRepoRemains',
    'finalSelection',
    'repoIdsReady',
    'linked',
    'assistantVisible',
    'configuredOpen',
    'roleSelected',
    'agentSelected',
    'generatorModelVisible',
  ]) {
    if (evidence[field] !== true) {
      throw new Error(
        `Project browser configuration did not complete ${field}: ${safeJson(evidence)}`,
      )
    }
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await Bun.write(
    join(harness.artifactRoot, 'browser-configuration-evidence.json'),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshots: retainedScreenshots }, null, 2)}\n`,
  )
  await recordAction(harness, 'project_configured_in_browser', {
    projectId: input.projectId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function rebindProjectInBrowser(
  harness: BrowserHarnessContext,
  input: {
    projectId: string
    repoId: string
    repoPath: string
    assistantModel: string
    generatorModel: string
  },
) {
  const url = `${harness.baseUrl}/projects`
  const screenshots = {
    rebound: await screenshotTarget(harness, '08-project-repo-rebound.png'),
    reloaded: await screenshotTarget(harness, '09-project-configuration-reloaded.png'),
  }
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, browserUtf8Expression(value)]),
  ) as Record<keyof typeof input, string>
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `target = new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'def page_js(expression):',
    '    return js(expression, target_id=target)',
    'def wait_js(expression, attempts=160):',
    '    value = None',
    '    for _ in range(attempts):',
    '        value = page_js(expression)',
    '        if value: return value',
    '        time.sleep(0.25)',
    '    return value',
    'def require_step(name, value):',
    '    if not value: raise RuntimeError("Project Rebind browser step did not settle: " + name)',
    `project_ready = wait_js(${JSON.stringify(`Boolean([...document.querySelectorAll('.project-card h2')].find((heading) => heading.title === ${values.projectId}))`)})`,
    'require_step("project_ready", project_ready)',
    `manager_open = page_js(${JSON.stringify("(() => { const button = [...document.querySelectorAll('.project-card button')].find((candidate) => candidate.textContent?.includes('Manage')); if (!button) return false; button.click(); return true })()")})`,
    'require_step("repository_manager_open", manager_open)',
    `repo_visible = wait_js(${JSON.stringify(`[...document.querySelectorAll('.project-repo-id')].some((element) => element.textContent?.trim() === ${values.repoId})`)})`,
    'require_step("repository_visible", repo_visible)',
    `rebind_open = page_js(${JSON.stringify(`(() => { const row = [...document.querySelectorAll('.project-repo-entry')].find((candidate) => candidate.querySelector('.project-repo-id')?.textContent?.trim() === ${values.repoId}); const button = row ? [...row.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Rebind')) : null; if (!button) return false; button.click(); return true })()`)})`,
    'require_step("rebind_open", rebind_open)',
    `rebind_input_ready = wait_js(${JSON.stringify(`Boolean(document.querySelector('input[aria-label="New path for ' + ${values.repoId} + '"]'))`)})`,
    'require_step("rebind_input_ready", rebind_input_ready)',
    `rebind_filled = page_js(${JSON.stringify(
      [
        '(() => {',
        `  const input = document.querySelector('input[aria-label="New path for ' + ${values.repoId} + '"]')`,
        "  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set",
        "  if (!input || !setter) return { ok: false, reason: 'missing rebind input' }",
        `  setter.call(input, ${values.repoPath})`,
        "  input.dispatchEvent(new Event('input', { bubbles: true }))",
        '  return { ok: true }',
        '})()',
      ].join('\n'),
    )})`,
    'require_step("rebind_path_filled", rebind_filled.get("ok"))',
    `hopi_audit_note("rebind physically moved secondary HOPI repository", scenario=${JSON.stringify(harness.scenario)})`,
    `rebind_submitted = page_js(${JSON.stringify(`(() => { const input = document.querySelector('input[aria-label="New path for ' + ${values.repoId} + '"]'); const button = input?.closest('form')?.querySelector('button[type="submit"]'); if (!button) return false; button.click(); return true })()`)})`,
    'require_step("rebind_submitted", rebind_submitted)',
    `rebound_visible = wait_js(${JSON.stringify(`[...document.querySelectorAll('.project-repo-path')].some((element) => element.title === ${values.repoPath})`)})`,
    'require_step("rebound_visible", rebound_visible)',
    captureScreenshotLine(screenshots.rebound, 'target'),
    'switch_tab(target)',
    `goto_url(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    `page_js(${JSON.stringify(`fetch('/api/state').then((response) => response.json()).then((state) => { const card = [...document.querySelectorAll('.project-card')].find((candidate) => candidate.querySelector('h2')?.title === ${values.projectId}); const moved = [...(card?.querySelectorAll('.project-repo-path') ?? [])].some((element) => element.title === ${values.repoPath}); const assistant = state.home?.agentRoleCodingDefaults?.assistant?.codingDefaults?.model === ${values.assistantModel}; const generator = state.home?.agentRoleCodingDefaults?.generator?.codingDefaults?.model === ${values.generatorModel}; window.__hopiConfigurationReloaded = Boolean(card && moved && assistant && generator) })`)})`,
    `reloaded = wait_js(${JSON.stringify('window.__hopiConfigurationReloaded === true')})`,
    'require_step("configuration_reloaded", reloaded)',
    captureScreenshotLine(screenshots.reloaded, 'target'),
    `hopi_audit_note("HOPI Project Rebind survived browser reload", scenario=${JSON.stringify(harness.scenario)})`,
    'print("HOPI_E2E_REBIND=" + json.dumps({"projectReady": project_ready, "managerOpen": manager_open, "repoVisible": repo_visible, "rebindOpen": rebind_open, "rebindInputReady": rebind_input_ready, "rebindFilled": rebind_filled, "rebindSubmitted": rebind_submitted, "reboundVisible": rebound_visible, "reloaded": reloaded, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    'browser-rebind.log',
    'HOPI_E2E_REBIND=',
    script,
  )) as Record<string, unknown> & {
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  for (const field of [
    'projectReady',
    'managerOpen',
    'repoVisible',
    'rebindOpen',
    'rebindInputReady',
    'rebindSubmitted',
    'reboundVisible',
    'reloaded',
  ]) {
    if (evidence[field] !== true) {
      throw new Error(`Project browser Rebind did not complete ${field}: ${safeJson(evidence)}`)
    }
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await Bun.write(
    join(harness.artifactRoot, 'browser-rebind-evidence.json'),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshots: retainedScreenshots }, null, 2)}\n`,
  )
  await recordAction(harness, 'project_rebound_in_browser', {
    projectId: input.projectId,
    repoId: input.repoId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function selectScopedProjectSourcesInBrowser(
  harness: BrowserHarnessContext,
  input: {
    nonGitPath: string
    emptyPath: string
    emptyProjectId: string
    scopedPath: string
    scopedProjectId: string
  },
) {
  const url = `${harness.baseUrl}/projects`
  const screenshots = {
    initial: await screenshotTarget(harness, '01-source-selection-initial.png'),
    nonGitRejected: await screenshotTarget(harness, '02-non-git-source-rejected.png'),
    emptyConfirmation: await screenshotTarget(harness, '03-empty-source-confirmation.png'),
    emptyInitialized: await screenshotTarget(harness, '04-empty-source-initialized.png'),
    emptyLinked: await screenshotTarget(harness, '05-empty-source-linked.png'),
    scopedSelected: await screenshotTarget(harness, '06-scoped-source-selected.png'),
    scopedLinked: await screenshotTarget(harness, '07-scoped-source-linked.png'),
  }
  const values = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, browserUtf8Expression(value)]),
  ) as Record<keyof typeof input, string>
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `target = new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'def page_js(expression):',
    '    return js(expression, target_id=target)',
    'def wait_js(expression, attempts=160):',
    '    value = None',
    '    for _ in range(attempts):',
    '        value = page_js(expression)',
    '        if value: return value',
    '        time.sleep(0.25)',
    '    return value',
    'def require_step(name, value):',
    '    if not value: raise RuntimeError("Project source browser step did not settle: " + name)',
    `picker_ready = wait_js(${JSON.stringify("(() => { const button = document.querySelector('.project-directory-picker'); return Boolean(button && !button.disabled) })()")})`,
    'require_step("picker_ready", picker_ready)',
    captureScreenshotLine(screenshots.initial, 'target'),
    'switch_tab(target)',
    `hopi_audit_note("reject a non-Git project source", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `non_git_rejected = wait_js(${JSON.stringify(`(() => { const notice = document.querySelector('.directory-notice')?.textContent ?? ''; return notice.includes('not a Git repository') && notice.includes(${values.nonGitPath}) && document.querySelectorAll('.project-create-repo').length === 0 })()`)})`,
    'require_step("non_git_rejected", non_git_rejected)',
    captureScreenshotLine(screenshots.nonGitRejected, 'target'),
    `picker_ready = wait_js(${JSON.stringify("(() => { const button = document.querySelector('.project-directory-picker'); return Boolean(button && !button.disabled) })()")})`,
    'require_step("picker_ready_after_non_git", picker_ready)',
    'switch_tab(target)',
    `hopi_audit_note("request explicit empty-folder initialization", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `empty_confirmation = wait_js(${JSON.stringify(`(() => { const dialog = document.querySelector('.repo-init-modal'); return Boolean(dialog?.textContent?.includes('Initialize Git here?') && dialog?.textContent?.includes(${values.emptyPath})) })()`)})`,
    'require_step("empty_confirmation", empty_confirmation)',
    captureScreenshotLine(screenshots.emptyConfirmation, 'target'),
    'switch_tab(target)',
    `hopi_audit_note("confirm empty-folder Git initialization", scenario=${JSON.stringify(harness.scenario)})`,
    `empty_confirmed = page_js(${JSON.stringify("(() => { const button = [...document.querySelectorAll('.repo-init-modal button')].find((candidate) => candidate.textContent?.includes('Initialize and use folder')); if (!button) return false; button.click(); return true })()")})`,
    'require_step("empty_confirmed", empty_confirmed)',
    `empty_initialized = wait_js(${JSON.stringify(`(() => !document.querySelector('.repo-init-modal') && [...document.querySelectorAll('.project-create-repo small')].some((element) => element.title === ${values.emptyPath}))()`)})`,
    'require_step("empty_initialized", empty_initialized)',
    captureScreenshotLine(screenshots.emptyInitialized, 'target'),
    'switch_tab(target)',
    `hopi_audit_note("link the explicitly initialized Project", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.link-project-panel button[type=submit]')?.click()")})`,
    `empty_linked = wait_js(${JSON.stringify(`(() => [...document.querySelectorAll('.project-card h2')].some((heading) => heading.title === ${values.emptyProjectId}) && document.querySelectorAll('.project-create-repo').length === 0)()`)})`,
    'require_step("empty_linked", empty_linked)',
    captureScreenshotLine(screenshots.emptyLinked, 'target'),
    `picker_ready = wait_js(${JSON.stringify("(() => { const button = document.querySelector('.project-directory-picker'); return Boolean(button && !button.disabled) })()")})`,
    'require_step("picker_ready_after_empty_link", picker_ready)',
    'switch_tab(target)',
    `hopi_audit_note("select a monorepo subfolder as Project scope", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.project-directory-picker')?.click()")})`,
    `scoped_selected = wait_js(${JSON.stringify(`(() => { const row = [...document.querySelectorAll('.project-create-repo')].find((candidate) => candidate.querySelector('small')?.title === ${values.scopedPath}); return Boolean(row?.querySelector('.project-scope-label')) })()`)})`,
    'require_step("scoped_selected", scoped_selected)',
    captureScreenshotLine(screenshots.scopedSelected, 'target'),
    'switch_tab(target)',
    `hopi_audit_note("link the scoped monorepo Project", scenario=${JSON.stringify(harness.scenario)})`,
    `page_js(${JSON.stringify("document.querySelector('.link-project-panel button[type=submit]')?.click()")})`,
    `scoped_linked = wait_js(${JSON.stringify(`(() => { const cards = [...document.querySelectorAll('.project-card')]; const scoped = cards.find((card) => card.querySelector('h2')?.title === ${values.scopedProjectId}); return cards.length === 2 && Boolean(scoped?.querySelector('.project-scope-label')) && scoped?.textContent?.includes('storefront') })()`)})`,
    'require_step("scoped_linked", scoped_linked)',
    captureScreenshotLine(screenshots.scopedLinked, 'target'),
    'switch_tab(target)',
    `hopi_audit_note("project source selections completed", scenario=${JSON.stringify(harness.scenario)})`,
    'print("HOPI_E2E_PROJECT_SOURCES=" + json.dumps({"non_git_rejected": non_git_rejected, "empty_confirmation": empty_confirmation, "empty_confirmed": empty_confirmed, "empty_initialized": empty_initialized, "empty_linked": empty_linked, "scoped_selected": scoped_selected, "scoped_linked": scoped_linked, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    'project-source-selection.log',
    'HOPI_E2E_PROJECT_SOURCES=',
    script,
  )) as {
    non_git_rejected?: boolean
    empty_confirmation?: boolean
    empty_confirmed?: boolean
    empty_initialized?: boolean
    empty_linked?: boolean
    scoped_selected?: boolean
    scoped_linked?: boolean
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  for (const [name, passed] of Object.entries(evidence).filter(
    ([name]) => name !== 'audit' && name !== 'verify',
  )) {
    if (!passed) throw new Error(`Project source browser step did not settle: ${name}`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await Bun.write(
    join(harness.artifactRoot, 'project-source-browser-evidence.json'),
    `${JSON.stringify({ url, ...evidence, auditMode, screenshots: retainedScreenshots }, null, 2)}\n`,
  )
  await recordAction(harness, 'project_sources_selected_in_browser', {
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function controlPreviewInBrowser(
  harness: BrowserHarnessContext,
  projectId: string,
  goalId: string,
  control: 'start' | 'stop',
  evidencePrefix: string,
) {
  const url = `${harness.baseUrl}/projects/${encodeURIComponent(projectId)}/board/${encodeURIComponent(goalId)}`
  const screenshot = await screenshotTarget(
    harness,
    `${safeSegment(evidencePrefix)}-preview-${control}.png`,
  )
  const selector = control === 'start' ? '.preview-start-button' : '[aria-label="Stop Preview"]'
  const settledExpression =
    control === 'start'
      ? "(() => { const stop = document.querySelector('[aria-label=\"Stop Preview\"]'); const open = document.querySelector('.preview-compact-open'); return { settled: Boolean(stop && open), openVisible: Boolean(open) } })()"
      : "(() => ({ settled: Boolean(document.querySelector('.preview-start-button')) && !document.querySelector('[aria-label=\"Stop Preview\"]') }))()"
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'clicked = None',
    'for _ in range(120):',
    `    clicked = js(${JSON.stringify(`(() => { const button = document.querySelector('${selector}'); if (!button) return { found: false }; if (button.disabled) return { found: true, disabled: true }; button.click(); return { found: true, disabled: false } })()`)})`,
    '    if clicked and clicked.get("found") and not clicked.get("disabled"): break',
    '    time.sleep(0.25)',
    'settled = None',
    'for _ in range(160):',
    `    settled = js(${JSON.stringify(settledExpression)})`,
    '    if settled and settled.get("settled"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshot),
    `hopi_audit_note(${JSON.stringify(`HOPI Preview ${control} completed`)}, scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)})`,
    'print("HOPI_E2E_PREVIEW_CONTROL=" + json.dumps({"clicked": clicked, "settled": settled, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `${safeSegment(evidencePrefix)}-preview-${control}.log`,
    'HOPI_E2E_PREVIEW_CONTROL=',
    script,
  )) as {
    clicked?: { found?: boolean; disabled?: boolean }
    settled?: { settled?: boolean; openVisible?: boolean }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.clicked?.found || evidence.clicked.disabled || !evidence.settled?.settled) {
    throw new Error(`Preview ${control} did not settle in the browser: ${safeJson(evidence)}`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots([screenshot])
  await recordAction(harness, `preview_${control}_in_browser`, {
    projectId,
    goalId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshot: screenshot.relativePath }
}

export async function requestPreviewRepairInBrowser(
  harness: BrowserHarnessContext,
  projectId: string,
  goalId: string,
) {
  const url = `${harness.baseUrl}/projects/${encodeURIComponent(projectId)}/board/${encodeURIComponent(goalId)}`
  const screenshots = {
    repairRequired: await screenshotTarget(harness, 'missing-preview-repair-required.png'),
    repairSent: await screenshotTarget(harness, 'missing-preview-repair-sent.png'),
  }
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'start = None',
    'for _ in range(120):',
    '    start = js("(() => { const button = document.querySelector(\'.preview-start-button\'); if (!button) return { found: false }; if (button.disabled) return { found: true, disabled: true }; button.click(); return { found: true, disabled: false } })()")',
    '    if start and start.get("found") and not start.get("disabled"): break',
    '    time.sleep(0.25)',
    'repair = None',
    'for _ in range(120):',
    '    repair = js("(() => { const banner = document.querySelector(\'.preview-repair-banner\'); return banner ? { visible: true, text: banner.innerText } : { visible: false, text: null } })()")',
    '    if repair and repair.get("visible"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshots.repairRequired),
    `hopi_audit_note("send ordinary Preview repair instruction to Assistant", scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)})`,
    "sent = js(\"(() => { const button = [...document.querySelectorAll('.preview-repair-banner button')].find((candidate) => candidate.textContent?.includes('Ask Assistant to repair')); if (!button) return false; button.click(); return true })()\")",
    'assistant = None',
    'for _ in range(120):',
    '    assistant = js("(() => ({ open: Boolean(document.querySelector(\'textarea[placeholder^=\\"Tell HOPI\\"]\')), repairVisible: document.body.innerText.includes(\'Preview could not start through\') }))()")',
    '    if assistant and assistant.get("open") and assistant.get("repairVisible"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshots.repairSent),
    'print("HOPI_E2E_PREVIEW_REPAIR=" + json.dumps({"start": start, "repair": repair, "sent": sent, "assistant": assistant, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    'missing-preview-repair.log',
    'HOPI_E2E_PREVIEW_REPAIR=',
    script,
  )) as {
    start?: { found?: boolean; disabled?: boolean }
    repair?: { visible?: boolean; text?: string | null }
    sent?: boolean
    assistant?: { open?: boolean; repairVisible?: boolean }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (
    !evidence.start?.found ||
    evidence.start.disabled ||
    !evidence.repair?.visible ||
    !evidence.sent ||
    !evidence.assistant?.open ||
    !evidence.assistant.repairVisible
  ) {
    throw new Error(`Preview repair did not reach Assistant: ${safeJson(evidence)}`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots(Object.values(screenshots))
  const retainedScreenshots = screenshotEvidence(screenshots)
  await recordAction(harness, 'preview_repair_sent_in_browser', {
    projectId,
    goalId,
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
}

export async function inspectProjectPreviewStatus(
  harness: BrowserHarnessContext,
  projectId: string,
  expectedStatus: string,
) {
  const url = `${harness.baseUrl}/projects`
  const screenshot = await screenshotTarget(harness, 'preview-release-updated.png')
  const projectExpression = browserUtf8Expression(projectId)
  const statusExpression = browserUtf8Expression(expectedStatus)
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${pythonUtf8Expression(url)})`,
    'wait_for_load()',
    'projection = None',
    'for _ in range(120):',
    `    projection = js(${JSON.stringify(`(() => { const card = [...document.querySelectorAll('.project-card')].find((candidate) => candidate.querySelector('h2')?.getAttribute('title') === ${projectExpression}); const status = card?.querySelector('.preview-status')?.textContent?.replace(/\\s+/g, ' ').trim() || null; return { found: Boolean(card), status, settled: status === ${statusExpression} } })()`)})`,
    '    if projection and projection.get("settled"): break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshot),
    `hopi_audit_note("HOPI Preview release projection inspected", scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)})`,
    'print("HOPI_E2E_PREVIEW_STATUS=" + json.dumps({"projection": projection, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    'preview-release-updated.log',
    'HOPI_E2E_PREVIEW_STATUS=',
    script,
  )) as {
    projection?: { found?: boolean; status?: string | null; settled?: boolean }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.projection?.settled) {
    throw new Error(`Preview status did not render ${expectedStatus}: ${safeJson(evidence)}`)
  }
  const auditMode = resolveBrowserAuditMode(evidence.verify)
  await assertScreenshots([screenshot])
  return { ...evidence, auditMode, screenshot: screenshot.relativePath }
}

function browserAuditPrelude() {
  return [
    '_hopi_audit_available = all(name in globals() for name in ("audit_note", "audit_status", "audit_verify"))',
    '_hopi_audit_notes = []',
    'def hopi_audit_note(message, **metadata):',
    '    if _hopi_audit_available:',
    '        return audit_note(message, **metadata)',
    '    _hopi_audit_notes.append({"message": message, **metadata})',
    '    return None',
    'def hopi_audit_status():',
    '    if _hopi_audit_available:',
    '        return audit_status()',
    '    return {"available": False, "notes": _hopi_audit_notes}',
    'def hopi_audit_verify():',
    '    if _hopi_audit_available:',
    '        return audit_verify()',
    '    return {"available": False, "reason": "Browser Harness audit API unavailable"}',
  ]
}

export function resolveBrowserAuditMode(
  verification: BrowserAuditVerification | undefined,
  allowUnaudited = process.env.HOPI_E2E_ALLOW_UNAUDITED_BROWSER === '1',
): BrowserAuditMode {
  if (verification?.valid === true) return 'verified'
  if (allowUnaudited && verification?.available === false) return 'unavailable-allowed'
  throw new Error(`Browser Harness audit verification failed: ${safeJson(verification)}`)
}

async function screenshotTarget(
  harness: BrowserHarnessContext,
  fileName: string,
): Promise<ScreenshotTarget> {
  const relativePath = join('screenshots', fileName)
  const localPath = join(harness.artifactRoot, relativePath)
  await mkdir(join(harness.artifactRoot, 'screenshots'), { recursive: true })
  return {
    browserPath: await browserWritablePath(localPath),
    localPath,
    relativePath,
  }
}

async function browserWritablePath(localPath: string) {
  if (process.platform !== 'linux' || !process.env.WSL_DISTRO_NAME) return localPath
  const result = await runCommand(['wslpath', '-w', localPath], process.cwd())
  if (result.exitCode !== 0) {
    throw new Error(`Could not map screenshot path for Windows: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

function captureScreenshotLine(target: ScreenshotTarget, browserTarget?: string) {
  const capture = `capture_screenshot(${pythonUtf8Expression(target.browserPath)}, max_dim=1800)`
  return browserTarget ? `switch_tab(${browserTarget}); ${capture}` : capture
}

function browserUtf8Expression(value: string) {
  const encoded = utf8Base64(value)
  return `new TextDecoder().decode(Uint8Array.from(atob(${JSON.stringify(encoded)}), (character) => character.charCodeAt(0)))`
}

function pythonUtf8Expression(value: string) {
  return `base64.b64decode(${JSON.stringify(utf8Base64(value))}).decode("utf-8")`
}

function utf8Base64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64')
}

async function assertScreenshots(targets: ScreenshotTarget[]) {
  for (const target of targets) {
    const file = Bun.file(target.localPath)
    if (!(await file.exists()) || file.size < 1_000) {
      throw new Error(`Browser screenshot was not retained: ${target.relativePath}`)
    }
  }
}

function screenshotEvidence<T extends Record<string, ScreenshotTarget>>(targets: T) {
  return Object.fromEntries(
    Object.entries(targets).map(([name, target]) => [name, target.relativePath]),
  ) as { [K in keyof T]: string }
}

async function runBrowserHarness(
  harness: BrowserHarnessContext,
  logName: string,
  markerPrefix: string,
  script: string,
) {
  await initializeBrowserHarness(harness, logName)
  const command = resolveBrowserHarnessCommand()
  const auditRoot = join(harness.artifactRoot, 'browser-audit')
  await mkdir(auditRoot, { recursive: true })
  const managedScript = withOwnedBrowserTabs(script)
  const child = Bun.spawn([command], {
    env: { ...process.env, BH_AUDIT_DIR: await browserWritablePath(auditRoot) },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (typeof child.stdin !== 'number') {
    child.stdin.write(`${managedScript}\n`)
    child.stdin.end()
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await Bun.write(join(harness.artifactRoot, logName), `${stdout}${stderr}`)
  const resourceMarker = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('HOPI_BROWSER_RESOURCES='))
  const resources = resourceMarker
    ? (JSON.parse(resourceMarker.slice('HOPI_BROWSER_RESOURCES='.length)) as {
        before: string[]
        created: string[]
        closed: string[]
        leaked: string[]
      })
    : null
  if (resources) {
    await appendFile(
      join(harness.artifactRoot, 'browser-resources.jsonl'),
      `${JSON.stringify({ occurredAt: new Date().toISOString(), logName, ...resources })}\n`,
    )
    await recordAction(harness, 'browser_resources_released', {
      logName,
      created: resources.created,
      closed: resources.closed,
      leaked: resources.leaked,
    })
  }
  if (exitCode !== 0) {
    throw new Error(`Browser Harness exited with code ${exitCode}: ${stderr.trim()}`)
  }
  if (!resources) throw new Error('Browser Harness did not return owned-resource evidence')
  const cleanupFailure = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('HOPI_BROWSER_CLEANUP_FAILED='))
  if (cleanupFailure) {
    throw new Error(`Browser Harness tab cleanup failed: ${cleanupFailure.split('=', 2)[1]}`)
  }
  if (resources.leaked.length > 0) {
    throw new Error(`Browser Harness leaked owned tabs: ${resources.leaked.join(', ')}`)
  }
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith(markerPrefix))
  if (!marker) throw new Error(`Browser Harness did not return ${markerPrefix} evidence`)
  return JSON.parse(marker.slice(markerPrefix.length)) as unknown
}

function withOwnedBrowserTabs(script: string) {
  const body = script
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  return [
    'import json as _hopi_json',
    '_hopi_tabs_before = {tab.get("targetId") or tab.get("target_id") for tab in list_tabs(include_chrome=True)} - {None}',
    '_hopi_cleanup_errors = []',
    '_hopi_owned_target = None',
    '_hopi_original_new_tab = new_tab',
    '_hopi_original_js = js',
    '_hopi_original_wait_for_load = wait_for_load',
    '_hopi_original_capture_screenshot = capture_screenshot',
    'def _hopi_bound_new_tab(url="about:blank"):',
    '    global _hopi_owned_target',
    '    _hopi_owned_target = _hopi_original_new_tab(url)',
    '    return _hopi_owned_target',
    'def _hopi_bound_js(expression, target_id=None):',
    '    return _hopi_original_js(expression, target_id=target_id or _hopi_owned_target)',
    'def _hopi_bound_wait_for_load(timeout=15.0):',
    '    if _hopi_owned_target: switch_tab(_hopi_owned_target)',
    '    return _hopi_original_wait_for_load(timeout)',
    'def _hopi_bound_capture_screenshot(path=None, full=False, max_dim=None):',
    '    if _hopi_owned_target: switch_tab(_hopi_owned_target)',
    '    return _hopi_original_capture_screenshot(path=path, full=full, max_dim=max_dim)',
    'new_tab = _hopi_bound_new_tab',
    'js = _hopi_bound_js',
    'wait_for_load = _hopi_bound_wait_for_load',
    'capture_screenshot = _hopi_bound_capture_screenshot',
    'try:',
    body,
    'finally:',
    '    try:',
    '        _hopi_current = current_tab().get("targetId") or current_tab().get("target_id")',
    '    except Exception:',
    '        _hopi_current = None',
    '    _hopi_created = [tab for tab in list_tabs(include_chrome=True) if (tab.get("targetId") or tab.get("target_id")) not in _hopi_tabs_before]',
    '    _hopi_created_ids = sorted({tab.get("targetId") or tab.get("target_id") for tab in _hopi_created} - {None})',
    '    _hopi_created.sort(key=lambda tab: (tab.get("targetId") or tab.get("target_id")) == _hopi_current)',
    '    for _hopi_tab in _hopi_created:',
    '        try:',
    '            close_tab(_hopi_tab.get("targetId") or _hopi_tab.get("target_id"))',
    '        except Exception as _hopi_cleanup_error:',
    '            _hopi_cleanup_errors.append(type(_hopi_cleanup_error).__name__ + ": " + str(_hopi_cleanup_error))',
    '    _hopi_tabs_after = {tab.get("targetId") or tab.get("target_id") for tab in list_tabs(include_chrome=True)} - {None}',
    '    _hopi_leaked = sorted(set(_hopi_created_ids) & _hopi_tabs_after)',
    '    _hopi_closed = sorted(set(_hopi_created_ids) - _hopi_tabs_after)',
    '    print("HOPI_BROWSER_RESOURCES=" + _hopi_json.dumps({"before": sorted(_hopi_tabs_before), "created": _hopi_created_ids, "closed": _hopi_closed, "leaked": _hopi_leaked}))',
    '    if _hopi_leaked:',
    '        _hopi_cleanup_errors.append("owned targets still open: " + ", ".join(_hopi_leaked))',
    '    if _hopi_cleanup_errors:',
    '        print("HOPI_BROWSER_CLEANUP_FAILED=" + _hopi_json.dumps(_hopi_cleanup_errors))',
  ].join('\n')
}

async function reloadBrowserHarness(context: BrowserHarnessContext, browserLogName: string) {
  const attempts: string[] = []
  const command = resolveBrowserHarnessCommand()
  const auditRoot = join(context.artifactRoot, 'browser-audit')
  await mkdir(auditRoot, { recursive: true })
  const browserAuditRoot = await browserWritablePath(auditRoot)
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const reload = Bun.spawn([command, '--reload'], { stdout: 'pipe', stderr: 'pipe' })
    const [reloadStdout, reloadStderr, reloadExitCode] = await Promise.all([
      new Response(reload.stdout).text(),
      new Response(reload.stderr).text(),
      reload.exited,
    ])

    let probeStdout = ''
    let probeStderr = ''
    let probeExitCode = -1
    if (reloadExitCode === 0) {
      const probe = Bun.spawn([command], {
        env: { ...process.env, BH_AUDIT_DIR: browserAuditRoot },
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (typeof probe.stdin !== 'number') {
        probe.stdin.write(
          'import json\nprint("HOPI_BROWSER_READY=" + json.dumps({"targets": len(list_tabs(include_chrome=True))}))\n',
        )
        probe.stdin.end()
      }
      ;[probeStdout, probeStderr, probeExitCode] = await Promise.all([
        new Response(probe.stdout).text(),
        new Response(probe.stderr).text(),
        probe.exited,
      ])
    }
    attempts.push(
      [
        `attempt ${attempt}: $ ${command} --reload`,
        `exit: ${reloadExitCode}`,
        '',
        '[reload stdout]',
        reloadStdout,
        '[reload stderr]',
        reloadStderr,
        `[readiness probe]\nexit: ${probeExitCode}`,
        '',
        '[probe stdout]',
        probeStdout,
        '[probe stderr]',
        probeStderr,
      ].join('\n'),
    )
    if (
      reloadExitCode === 0 &&
      probeExitCode === 0 &&
      probeStdout.split(/\r?\n/).some((line) => line.startsWith('HOPI_BROWSER_READY='))
    ) {
      await Bun.write(
        join(context.artifactRoot, `${safeSegment(browserLogName)}-daemon-reload.log`),
        attempts.join('\n\n'),
      )
      return
    }
    if (attempt < 2) await Bun.sleep(250)
  }
  await Bun.write(
    join(context.artifactRoot, `${safeSegment(browserLogName)}-daemon-reload.log`),
    attempts.join('\n\n'),
  )
  throw new Error('Browser Harness daemon reload failed; inspect the retained reload log')
}

async function initializeBrowserHarness(context: BrowserHarnessContext, browserLogName: string) {
  if (initializedBrowserRuns.has(context)) return
  await reloadBrowserHarness(context, browserLogName)
  initializedBrowserRuns.add(context)
}

export async function runCommand(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { command, cwd, exitCode, stdout, stderr }
}

export async function gitOutput(cwd: string, args: string[]) {
  const result = await runCommand(['git', ...args], cwd)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

export async function checkoutSnapshot(repoRoot: string) {
  return {
    head: await gitOutput(repoRoot, ['rev-parse', 'HEAD']),
    branch: await gitOutput(repoRoot, ['branch', '--show-current']),
    status: await gitOutputPreservingStart(repoRoot, ['status', '--porcelain']),
  }
}

export async function assertAcceptedRelease(
  repoRoot: string,
  projectId: string,
  before: { head: string; branch: string; status: string },
) {
  const after = await checkoutSnapshot(repoRoot)
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(`Accepted release changed the selected checkout for Project ${projectId}`)
  }
  const integrationRoot = managedRepoWorktreePaths(repoRoot, projectId).integration
  const [integrationHead, release] = await Promise.all([
    gitOutput(integrationRoot, ['rev-parse', 'HEAD']),
    gitOutput(repoRoot, ['rev-parse', projectReleaseRef(projectId)]),
  ])
  if (integrationHead !== release) {
    throw new Error(
      `Managed integration HEAD ${integrationHead} does not equal ${projectReleaseRef(projectId)} ${release}`,
    )
  }
  return after
}

export async function readCodeProvenance(repoRoot: string): Promise<CodeProvenance> {
  const absoluteRoot = resolve(repoRoot)
  const head = await gitOutput(absoluteRoot, ['rev-parse', 'HEAD'])
  const branch = await gitOutput(absoluteRoot, ['branch', '--show-current'])
  const status = await gitOutputPreservingStart(absoluteRoot, ['status', '--porcelain'])
  const diff = await gitOutput(absoluteRoot, ['diff', '--binary', 'HEAD'])
  const untracked = (await gitOutput(absoluteRoot, ['ls-files', '--others', '--exclude-standard']))
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)
    .toSorted()
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(diff)
  for (const path of untracked) {
    hasher.update(`\0${path}\0`)
    hasher.update(await Bun.file(join(absoluteRoot, path)).arrayBuffer())
  }
  return {
    head,
    branch,
    dirty: status.length > 0,
    status: status ? status.split('\n') : [],
    worktreeDigest: hasher.digest('hex'),
  }
}

export async function readGitSemanticState(repoRoot: string): Promise<GitSemanticState> {
  const absoluteRoot = resolve(repoRoot)
  const refs = await gitOutputPreservingStart(absoluteRoot, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)',
  ])
  return {
    head: await gitOutput(absoluteRoot, ['rev-parse', 'HEAD']),
    branch: await gitOutput(absoluteRoot, ['branch', '--show-current']),
    status: await gitOutputPreservingStart(absoluteRoot, ['status', '--porcelain']),
    refs: refs ? refs.split('\n').toSorted() : [],
  }
}

export async function semanticDirectoryDigest(root: string) {
  const absoluteRoot = resolve(root)
  const paths: string[] = []
  for await (const path of new Bun.Glob('**/*').scan({
    cwd: absoluteRoot,
    onlyFiles: true,
    dot: true,
  })) {
    if (path.split(/[\\/]/).includes('.git')) continue
    paths.push(path)
  }
  const hasher = new Bun.CryptoHasher('sha256')
  for (const path of paths.toSorted()) {
    hasher.update(`${path}\0`)
    hasher.update(await Bun.file(join(absoluteRoot, path)).arrayBuffer())
  }
  return hasher.digest('hex')
}

async function gitOutputPreservingStart(cwd: string, args: string[]) {
  const result = await runCommand(['git', ...args], cwd)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trimEnd()
}

export async function readPendingInboxEvents(homeRoot: string) {
  const pending: Array<{ eventId: string; source: string; visibility: string }> = []
  for await (const path of new Bun.Glob('.hopi/docs/assistant/inbox/*.md').scan({
    cwd: homeRoot,
    onlyFiles: true,
    dot: true,
  })) {
    const event = parseInboxEventDocument(await Bun.file(join(homeRoot, path)).text())
    if (event.attributes.status !== 'pending') continue
    pending.push({
      eventId: event.attributes.id,
      source: event.attributes.source,
      visibility: event.attributes.visibility,
    })
  }
  return pending.toSorted((left, right) => left.eventId.localeCompare(right.eventId))
}

async function readObservation(baseUrl: string): Promise<StateObservation> {
  const state = await requestJson<LiveState>(baseUrl, '/api/state')
  const goals: Record<string, LiveGoalDetail> = {}
  for (const project of state.projects) {
    for (const goal of project.goals) {
      const key = `${project.projectId}/${goal.id}`
      goals[key] = await requestJson<LiveGoalDetail>(
        baseUrl,
        `/api/projects/${encodeURIComponent(project.projectId)}/goals/${encodeURIComponent(goal.id)}`,
      )
    }
  }
  return { observedAt: new Date().toISOString(), state, goals }
}

function stateInvariantViolations(observation: StateObservation) {
  const violations: string[] = []
  const activeKeys = new Set<string>()
  for (const run of observation.state.activeRuns) {
    if (activeKeys.has(run.key)) violations.push(`duplicate active Run ${run.key}`)
    activeKeys.add(run.key)
    const [projectId, goalId, workId] = run.key.split('/')
    const goal = observation.goals[`${projectId}/${goalId}`]
    if (!goal) {
      violations.push(`active Run ${run.key} has no canonical Goal`)
      continue
    }
    const work = goal.works.find((candidate) => candidate.id === workId)
    if (!work) {
      violations.push(`active Run ${run.key} has no canonical Work`)
      continue
    }
    for (const dependencyId of work.dependsOn) {
      const dependency = goal.works.find((candidate) => candidate.id === dependencyId)
      if (!dependency) {
        violations.push(
          `Work ${projectId}/${goalId}/${workId} has missing dependency ${dependencyId}`,
        )
      } else if (dependency.stage !== 'done' && dependency.stage !== 'cancelled') {
        violations.push(
          `active Work ${projectId}/${goalId}/${workId} preceded dependency ${dependencyId} at ${dependency.stage}`,
        )
      }
    }
  }
  for (const [key, goal] of Object.entries(observation.goals)) {
    if (goal.goal.lifecycle !== 'done') continue
    const incomplete = goal.works.filter(
      (work) => work.stage !== 'done' && work.stage !== 'cancelled',
    )
    if (incomplete.length > 0) {
      violations.push(
        `done Goal ${key} retains incomplete Work ${incomplete.map((work) => work.id)}`,
      )
    }
    if ([...activeKeys].some((activeKey) => activeKey.startsWith(`${key}/`))) {
      violations.push(`done Goal ${key} retains an active Run`)
    }
  }
  return violations
}

export function liveCodingDefaults() {
  const transport = process.env.HOPI_E2E_TRANSPORT?.trim() || 'codex'
  const model = process.env.HOPI_E2E_MODEL?.trim()
  const reasoningEffort = process.env.HOPI_E2E_REASONING_EFFORT?.trim() || 'low'
  const input: ProjectCodingDefaultsInput = {
    transport: transport as ProjectCodingDefaultsInput['transport'],
    ...(model ? { model } : {}),
    ...(transport === 'codex'
      ? { reasoningEffort: reasoningEffort as ProjectCodingDefaultsInput['reasoningEffort'] }
      : {}),
  }
  return normalizeProjectCodingDefaults(input)
}

function resolveBrowserHarnessCommand() {
  const explicit = process.env.HOPI_BROWSER_HARNESS_COMMAND?.trim()
  if (explicit) return explicit
  const command = Bun.which('codex-browser-harness') ?? Bun.which('browser-harness')
  if (!command) throw new Error('Browser Harness is not installed')
  return command
}

export async function readModelUsage(homeRoot: string) {
  const logicalRuns = await countLogicalRuns(homeRoot)

  const tokens = { input: 0, cachedInput: 0, output: 0 }
  const byScope = {
    assistant: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
    reflection: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
    planner: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
    generator: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
    reviewer: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
    unknown: { input: 0, cachedInput: 0, output: 0, usageEvents: 0 },
  }
  const runs: Array<{
    path: string
    scope: keyof typeof byScope
    input: number
    cachedInput: number
    output: number
  }> = []
  let providerUsageEvents = 0
  let transcriptFiles = 0
  for await (const path of new Bun.Glob('.hopi/runtime/**/transcript.log').scan({
    cwd: homeRoot,
    onlyFiles: true,
    dot: true,
  })) {
    transcriptFiles += 1
    const scope = await transcriptScope(homeRoot, path)
    for (const line of (await Bun.file(join(homeRoot, path)).text()).split(/\r?\n/)) {
      const raw = line.startsWith('stdout: ') ? line.slice('stdout: '.length) : ''
      if (!raw.startsWith('{')) continue
      try {
        const event = JSON.parse(raw) as { usage?: Record<string, unknown> }
        if (!event.usage) continue
        const input = numberValue(event.usage.input_tokens)
        const cachedInput = numberValue(event.usage.cached_input_tokens)
        const output = numberValue(event.usage.output_tokens)
        if (input === null && cachedInput === null && output === null) continue
        providerUsageEvents += 1
        tokens.input += input ?? 0
        tokens.cachedInput += cachedInput ?? 0
        tokens.output += output ?? 0
        byScope[scope].input += input ?? 0
        byScope[scope].cachedInput += cachedInput ?? 0
        byScope[scope].output += output ?? 0
        byScope[scope].usageEvents += 1
        runs.push({
          path,
          scope,
          input: input ?? 0,
          cachedInput: cachedInput ?? 0,
          output: output ?? 0,
        })
      } catch {
        // Raw vendor output remains in the retained transcript for unsupported formats.
      }
    }
  }
  return {
    logicalRuns,
    logicalRunTotal: Object.values(logicalRuns).reduce((sum, count) => sum + count, 0),
    transcriptFiles,
    providerUsageEvents,
    tokens: { ...tokens, uncachedInput: tokens.input - tokens.cachedInput },
    byScope,
    runs,
  }
}

export async function countLogicalRuns(
  homeRoot: string,
  options: { tolerateUnreadable?: boolean } = {},
) {
  const logicalRuns = {
    assistant: 0,
    reflection: 0,
    planner: 0,
    generator: 0,
    reviewer: 0,
  }
  for await (const path of new Bun.Glob('.hopi/runtime/assistant/turns/*/turn.json').scan({
    cwd: homeRoot,
    onlyFiles: true,
    dot: true,
  })) {
    const manifest = await readLogicalRunManifest<{ attempt?: number }>(
      join(homeRoot, path),
      options.tolerateUnreadable,
    )
    if (!manifest) continue
    logicalRuns.assistant +=
      typeof manifest.attempt === 'number' && manifest.attempt > 0 ? manifest.attempt : 1
  }
  for await (const path of new Bun.Glob(
    '.hopi/runtime/assistant/reflections/*/reflection.json',
  ).scan({ cwd: homeRoot, onlyFiles: true, dot: true })) {
    if (await Bun.file(join(homeRoot, path)).exists()) logicalRuns.reflection += 1
  }
  for (const pattern of [
    '.hopi/runtime/runs/*/attempt.json',
    '.hopi/runtime/runs/*/*/*/*/attempt.json',
  ]) {
    for await (const path of new Bun.Glob(pattern).scan({
      cwd: homeRoot,
      onlyFiles: true,
      dot: true,
    })) {
      const manifest = await readLogicalRunManifest<{ responsibility?: string }>(
        join(homeRoot, path),
        options.tolerateUnreadable,
      )
      if (!manifest) continue
      if (
        manifest.responsibility === 'planner' ||
        manifest.responsibility === 'generator' ||
        manifest.responsibility === 'reviewer'
      ) {
        logicalRuns[manifest.responsibility] += 1
      }
    }
  }

  return logicalRuns
}

async function readLogicalRunManifest<T>(path: string, tolerateUnreadable = false) {
  try {
    return (await Bun.file(path).json()) as T
  } catch (error) {
    if (tolerateUnreadable) return null
    throw error
  }
}

async function transcriptScope(homeRoot: string, path: string) {
  if (path.includes('/assistant/turns/')) return 'assistant' as const
  if (path.includes('/assistant/reflections/')) return 'reflection' as const
  if (path.includes('/runs/')) {
    const manifestPath = join(homeRoot, path.slice(0, path.lastIndexOf('/')), 'attempt.json')
    try {
      const manifest = (await Bun.file(manifestPath).json()) as { responsibility?: string }
      if (
        manifest.responsibility === 'planner' ||
        manifest.responsibility === 'generator' ||
        manifest.responsibility === 'reviewer'
      ) {
        return manifest.responsibility
      }
    } catch {
      return 'unknown' as const
    }
  }
  return 'unknown' as const
}

async function writeRunReport(
  harness: LiveHarness,
  status: 'running' | 'passed' | 'failed',
  details: Record<string, unknown> = {},
) {
  await writeTestRunReport(harness, status, {
    codingDefaults: harness.codingDefaults,
    modelBoundaries: harness.modelBoundaries,
    browserAuditPolicy:
      process.env.HOPI_E2E_ALLOW_UNAUDITED_BROWSER === '1' ? 'optional' : 'required',
    logicalRunSafety: { limit: harness.logicalRunLimit },
    lastCheckpoint: harness.lastCheckpoint,
    failedAt: status === 'failed' ? harness.currentPhase : null,
    paths: { home: harness.homeRoot, repo: harness.repoRoot },
    ...details,
  })
}

function resolveLogicalRunLimit() {
  const configured = process.env.HOPI_E2E_MAX_LOGICAL_RUNS?.trim()
  return positiveLogicalRunLimit(configured ? Number(configured) : 50)
}

function positiveLogicalRunLimit(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('HOPI_E2E_MAX_LOGICAL_RUNS must be a positive integer')
  }
  return value
}

function createDeterministicReflectionRunner(
  transport: ProjectCodingDefaults['transport'],
): AssistantModelRunner {
  return {
    async run(input) {
      if (input.toolMode !== 'reflection') {
        throw new Error('Deterministic Reflection runner received a speaking turn')
      }
      return {
        reply: '',
        session: { transport, sessionId: `e2e-no-action-${input.eventId}` },
      }
    },
  }
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cleanupTimeoutMs() {
  const configured = Number(process.env.HOPI_E2E_CLEANUP_TIMEOUT_MS ?? 30_000)
  return Number.isFinite(configured) && configured > 0 ? configured : 30_000
}

function signalUnexpectedFinalStatus(
  context: Pick<TestRunContext, 'scenario' | 'artifactRoot'>,
  intended: 'passed' | 'failed' | 'blocked',
  actual: string,
) {
  if (actual === intended) return
  console.error(
    `[HOPI E2E][${context.scenario}] intended ${intended}, finalized ${actual}; inspect ${context.artifactRoot}/run.json`,
  )
  process.exitCode = 1
}

function safeSegment(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '-').replaceAll(/-+/g, '-')
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
