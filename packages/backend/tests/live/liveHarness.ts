import { appendFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ensureDefaultAgentAdapterConfig } from '../../src/agent/defaultAdapterConfig'
import { parseInboxEventDocument } from '../../src/domain/assistantWorkspaceDocuments'
import {
  type ProjectCodingDefaults,
  type ProjectCodingDefaultsInput,
  normalizeProjectCodingDefaults,
} from '../../src/domain/projectCodingDefaults'
import { type MvpServer, createServer } from '../../src/mvpServer'

export interface LiveState {
  home: { homeId: string; assistantCodingDefaults: ProjectCodingDefaults }
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
    projectId?: string
    goalId?: string
  }>
  activeRuns: Array<{ key: string; responsibility: string }>
}

export interface LiveGoalDetail {
  goal: { id: string; title: string; lifecycle: string }
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
  }>
}

export interface LiveHarness {
  scenario: string
  artifactRoot: string
  homeRoot: string
  repoRoot: string
  baseUrl: string
  codingDefaults: ProjectCodingDefaults
  code: CodeProvenance
  currentPhase: string
  lastCheckpoint: string | null
  startedAt: string
  server: MvpServer
}

export interface CodeProvenance {
  head: string
  branch: string
  dirty: boolean
  status: string[]
  worktreeDigest: string
}

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

export async function startLiveHarness(scenario: string): Promise<LiveHarness> {
  const startedAt = new Date().toISOString()
  const artifactRoot = await createHarnessArtifactRoot(scenario, startedAt)
  const homeRoot = join(artifactRoot, 'home')
  const repoRoot = join(artifactRoot, 'repo')
  const codingDefaults = liveCodingDefaults()
  const code = await readCodeProvenance(resolve(import.meta.dir, '..', '..', '..', '..'))
  await ensureDefaultAgentAdapterConfig(homeRoot, codingDefaults)
  const server = createServer({ rootDir: homeRoot, port: 0 })
  const harness: LiveHarness = {
    scenario,
    artifactRoot,
    homeRoot,
    repoRoot,
    baseUrl: `http://127.0.0.1:${server.port}`,
    codingDefaults,
    code,
    currentPhase: 'startup',
    lastCheckpoint: null,
    startedAt,
    server,
  }
  await writeRunReport(harness, 'running')
  await recordAction(harness, 'server_started', {
    baseUrl: harness.baseUrl,
    codingDefaults,
  })
  return harness
}

export async function enterHarnessPhase(harness: LiveHarness, phase: string) {
  harness.currentPhase = phase
  await recordAction(harness, 'phase_started', { phase })
}

export async function markHarnessCheckpoint(harness: LiveHarness, checkpoint: string) {
  harness.lastCheckpoint = checkpoint
  await recordAction(harness, 'checkpoint_reached', { checkpoint })
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

export async function finishLiveHarness(
  harness: LiveHarness,
  status: 'passed' | 'failed',
  details: Record<string, unknown> = {},
) {
  const usage = await readModelUsage(harness.homeRoot)
  await writeRunReport(harness, status, {
    ...details,
    usage,
    lastCheckpoint: harness.lastCheckpoint,
    failedAt: status === 'failed' ? harness.currentPhase : null,
  })
  return usage
}

export async function shutdownLiveHarness(harness: LiveHarness) {
  await harness.server.shutdown()
  await recordAction(harness, 'server_stopped')
}

export async function recordAction(
  harness: BrowserHarnessContext,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await appendFile(
    join(harness.artifactRoot, 'actions.jsonl'),
    `${JSON.stringify({ occurredAt: new Date().toISOString(), action, ...detail })}\n`,
  )
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
    lastValue = await read()
    if (accepts(lastValue)) return lastValue
    await Bun.sleep(options.intervalMs ?? 500)
  }
  throw new Error(
    `Timed out waiting for ${options.description}. Last value: ${safeJson(lastValue)}`,
  )
}

export async function startStateRecorder(harness: LiveHarness): Promise<StateRecorder> {
  let stopping = false
  let observations = 0
  let previous = ''
  const violations = new Set<string>()
  const statesPath = join(harness.artifactRoot, 'states.jsonl')
  const invariantsPath = join(harness.artifactRoot, 'invariants.jsonl')

  const capture = async () => {
    const observation = await readObservation(harness.baseUrl)
    const serializedState = JSON.stringify({ state: observation.state, goals: observation.goals })
    if (serializedState !== previous) {
      previous = serializedState
      observations += 1
      await appendFile(statesPath, `${JSON.stringify(observation)}\n`)
    }
    for (const violation of stateInvariantViolations(observation)) {
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

  return {
    get violations() {
      return [...violations]
    },
    get observations() {
      return observations
    },
    async stop() {
      stopping = true
      await loop
      try {
        await capture()
      } catch {
        // The retained runtime already contains the server-side failure evidence.
      }
    },
  }
}

export async function sendAssistantMessage(
  harness: BrowserHarnessContext,
  content: string,
  options: { evidencePrefix?: string; pagePath?: string } = {},
) {
  const url = `${harness.baseUrl}${options.pagePath ?? '/projects'}`
  const contentExpression = browserUtf8Expression(content)
  const prefix = options.evidencePrefix ? `${safeSegment(options.evidencePrefix)}-` : ''
  const screenshots = {
    pageLoaded: await screenshotTarget(harness, `${prefix}01-projects-loaded.png`),
    assistantOpen: await screenshotTarget(harness, `${prefix}02-assistant-open.png`),
    composerFilled: await screenshotTarget(harness, `${prefix}03-composer-filled.png`),
    messageSubmitted: await screenshotTarget(harness, `${prefix}04-message-submitted.png`),
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
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${JSON.stringify(url)})`,
    'wait_for_load()',
    captureScreenshotLine(screenshots.pageLoaded),
    `opened = js(${JSON.stringify(openExpression)})`,
    'time.sleep(0.25)',
    captureScreenshotLine(screenshots.assistantOpen),
    `filled = js(${JSON.stringify(fillExpression)})`,
    'time.sleep(0.25)',
    captureScreenshotLine(screenshots.composerFilled),
    `hopi_audit_note("about to submit HOPI live E2E Assistant message", scenario=${JSON.stringify(harness.scenario)})`,
    `sent = js(${JSON.stringify(sendExpression)})`,
    'visible = False',
    'for _ in range(80):',
    `    visible = bool(js(${JSON.stringify(visibleExpression)}))`,
    '    if visible: break',
    '    time.sleep(0.25)',
    captureScreenshotLine(screenshots.messageSubmitted),
    'print("HOPI_E2E_SEND=" + json.dumps({"opened": opened, "filled": filled, "sent": sent, "visible": visible, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `${prefix}browser-send.log`,
    'HOPI_E2E_SEND=',
    script,
  )) as {
    opened?: { opened?: boolean; reason?: string }
    filled?: { filled?: boolean; reason?: string }
    sent?: { sent?: boolean; reason?: string }
    visible?: boolean
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.opened?.opened || !evidence.filled?.filled || !evidence.sent?.sent) {
    throw new Error(`Assistant composer submission failed: ${safeJson(evidence)}`)
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
    auditHeadHash: evidence.audit?.head_hash,
    browserAuditMode: auditMode,
  })
  return { ...evidence, auditMode, screenshots: retainedScreenshots }
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
    `new_tab(${JSON.stringify(url)})`,
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
    `new_tab(${JSON.stringify(url)})`,
    'wait_for_load()',
    'view = None',
    'for _ in range(80):',
    "    view = js(\"\"\"(() => ({path: location.pathname, kanban: Boolean(document.querySelector('.kanban-board')), cancelledArchive: Boolean(document.querySelector('.cancelled-archive')), title: document.querySelector('.goal-title-block h1')?.textContent?.trim() || null, progress: document.querySelector('.goal-focus-strip > div:nth-child(3) strong')?.textContent?.trim() || null}))()\"\"\")",
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
  const script = [
    'import base64, json, time',
    ...browserAuditPrelude(),
    `new_tab(${JSON.stringify(url)})`,
    'wait_for_load()',
    'clicked = None',
    'for _ in range(80):',
    `    clicked = js(${JSON.stringify(`(() => { const button = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === ${controlExpression}); if (!button) return { found: false }; if (button.disabled) return { found: true, disabled: true }; button.click(); return { found: true, disabled: false }; })()`)})`,
    '    if clicked and clicked.get("found") and not clicked.get("disabled"): break',
    '    time.sleep(0.25)',
    'time.sleep(0.5)',
    captureScreenshotLine(screenshot),
    `hopi_audit_note(${JSON.stringify(`HOPI ${control} Goal control clicked`)}, scenario=${JSON.stringify(harness.scenario)}, project_id=${JSON.stringify(projectId)}, goal_id=${JSON.stringify(goalId)})`,
    'print("HOPI_E2E_GOAL_CONTROL=" + json.dumps({"clicked": clicked, "audit": hopi_audit_status(), "verify": hopi_audit_verify()}, sort_keys=True))',
  ].join('\n')
  const evidence = (await runBrowserHarness(
    harness,
    `goal-${control.toLowerCase()}-control.log`,
    'HOPI_E2E_GOAL_CONTROL=',
    script,
  )) as {
    clicked?: { found?: boolean; disabled?: boolean }
    audit?: { head_hash?: string }
    verify?: BrowserAuditVerification
  }
  if (!evidence.clicked?.found || evidence.clicked.disabled) {
    throw new Error(`${control} control could not be clicked: ${safeJson(evidence.clicked)}`)
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

function captureScreenshotLine(target: ScreenshotTarget) {
  return `capture_screenshot(${pythonUtf8Expression(target.browserPath)}, max_dim=1800)`
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
  const command = resolveBrowserHarnessCommand()
  const child = Bun.spawn([command], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (typeof child.stdin !== 'number') {
    child.stdin.write(`${script}\n`)
    child.stdin.end()
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  await Bun.write(join(harness.artifactRoot, logName), `${stdout}${stderr}`)
  if (exitCode !== 0) {
    throw new Error(`Browser Harness exited with code ${exitCode}: ${stderr.trim()}`)
  }
  const marker = stdout.split(/\r?\n/).find((line) => line.startsWith(markerPrefix))
  if (!marker) throw new Error(`Browser Harness did not return ${markerPrefix} evidence`)
  return JSON.parse(marker.slice(markerPrefix.length)) as unknown
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

function liveCodingDefaults() {
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
    const manifest = (await Bun.file(join(homeRoot, path)).json()) as { attempt?: number }
    logicalRuns.assistant +=
      typeof manifest.attempt === 'number' && manifest.attempt > 0 ? manifest.attempt : 1
  }
  for await (const path of new Bun.Glob(
    '.hopi/runtime/assistant/reflections/*/reflection.json',
  ).scan({ cwd: homeRoot, onlyFiles: true, dot: true })) {
    if (await Bun.file(join(homeRoot, path)).exists()) logicalRuns.reflection += 1
  }
  for await (const path of new Bun.Glob('.hopi/runtime/runs/*/*/*/*/attempt.json').scan({
    cwd: homeRoot,
    onlyFiles: true,
    dot: true,
  })) {
    const manifest = (await Bun.file(join(homeRoot, path)).json()) as { responsibility?: string }
    if (
      manifest.responsibility === 'planner' ||
      manifest.responsibility === 'generator' ||
      manifest.responsibility === 'reviewer'
    ) {
      logicalRuns[manifest.responsibility] += 1
    }
  }

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
  await Bun.write(
    join(harness.artifactRoot, 'run.json'),
    `${JSON.stringify(
      {
        version: 1,
        scenario: harness.scenario,
        status,
        startedAt: harness.startedAt,
        endedAt: status === 'running' ? null : new Date().toISOString(),
        codingDefaults: harness.codingDefaults,
        browserAuditPolicy:
          process.env.HOPI_E2E_ALLOW_UNAUDITED_BROWSER === '1' ? 'optional' : 'required',
        code: harness.code,
        lastCheckpoint: harness.lastCheckpoint,
        failedAt: status === 'failed' ? harness.currentPhase : null,
        paths: { home: harness.homeRoot, repo: harness.repoRoot },
        ...details,
      },
      null,
      2,
    )}\n`,
  )
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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
