import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { finishTestRun, startTestRun } from '../live/liveHarness'
import {
  type TestRunClaim,
  type TestRunContext,
  type TestRunReport,
  readTestRun,
  recordTestRunAction,
  writeEvidenceGallery,
  writeTestRunReport,
} from '../testRunArtifact'

interface RegressionStep {
  id: string
  claim: TestRunClaim
  command: string[]
  retainsArtifact: boolean
}

interface RegressionChild {
  id: string
  claim: TestRunClaim
  command: string[]
  status: 'passed' | 'failed'
  exitCode: number
  startedAt: string
  endedAt: string
  durationMs: number
  artifactRoot: string
  run: string | null
  error?: string
}

const REPOSITORY_ROOT = resolve(import.meta.dir, '..', '..', '..', '..')

export const PREFLIGHT_STEPS: RegressionStep[] = [
  step('check', 'contract', 'check'),
  step('contract-suite', 'contract', 'e2e:contract'),
  artifactStep('HOPI-E2E-011', 'contract', 'e2e:instructions:011'),
  artifactStep('HOPI-E2E-012', 'contract', 'e2e:revision:012'),
  artifactStep('HOPI-E2E-016', 'contract', 'e2e:restart:016'),
  artifactStep('HOPI-E2E-020', 'browser', 'e2e:config:020'),
  artifactStep('HOPI-E2E-030', 'contract', 'e2e:migration:030'),
  artifactStep('HOPI-E2E-021', 'browser', 'e2e:browser:021'),
  artifactStep('HOPI-E2E-025', 'contract', 'e2e:webhook:025'),
  artifactStep('HOPI-E2E-001', 'browser', 'test:browser'),
  artifactStep('HOPI-E2E-014', 'browser', 'e2e:browser:014'),
  artifactStep('HOPI-E2E-015', 'browser', 'e2e:browser:015'),
  artifactStep('HOPI-E2E-023', 'browser', 'e2e:browser:023'),
  artifactStep('HOPI-E2E-028', 'browser', 'e2e:browser:028'),
  artifactStep('HOPI-E2E-029', 'browser', 'e2e:browser:029'),
]

export const LIVE_STEPS: RegressionStep[] = [
  artifactStep('HOPI-E2E-002', 'live', 'e2e:live'),
  artifactStep('HOPI-E2E-010', 'live', 'e2e:live:010'),
  artifactStep('HOPI-E2E-011', 'live', 'e2e:live:011'),
  artifactStep('HOPI-E2E-013', 'live', 'e2e:live:013'),
  artifactStep('HOPI-E2E-016', 'live', 'e2e:live:016'),
  artifactStep('HOPI-E2E-017', 'live', 'e2e:live:017'),
  artifactStep('HOPI-E2E-019', 'live', 'e2e:live:019'),
  artifactStep('HOPI-E2E-022', 'live', 'e2e:live:022'),
  artifactStep('HOPI-E2E-026', 'live', 'e2e:live:026'),
  artifactStep('HOPI-E2E-028', 'live', 'e2e:live:028'),
]

if (import.meta.main) await runRegression(process.argv.includes('--live') ? 'live' : 'preflight')

export async function runRegression(profile: 'preflight' | 'live') {
  const parent = await startTestRun(`regression-${profile}`, 'regression')
  const children: RegressionChild[] = []
  let failure: string | null = null
  const steps = profile === 'live' ? LIVE_STEPS : PREFLIGHT_STEPS

  console.log(`HOPI E2E ${profile} Regression: ${parent.artifactRoot}`)
  for (const current of steps) {
    const child = await runStep(parent, current)
    children.push(child)
    if (child.status === 'failed') {
      failure = child.error ?? `${current.id} failed with exit ${child.exitCode}`
      break
    }
    if (profile === 'live' && current.id === 'HOPI-E2E-002') {
      const inspection = artifactStep('HOPI-E2E-003', 'inspection', 'artifact:inspect')
      inspection.command.push('--', child.artifactRoot)
      const inspectionChild = await runStep(parent, inspection)
      children.push(inspectionChild)
      if (inspectionChild.status === 'failed') {
        failure =
          inspectionChild.error ?? `HOPI-E2E-003 failed with exit ${inspectionChild.exitCode}`
        break
      }
    }
  }

  const childRoots = children.map((child) => child.artifactRoot)
  await writeEvidenceGallery(parent.artifactRoot, childRoots)
  const reports = await Promise.all(childRoots.map((root) => readTestRun(root).catch(() => null)))
  const status = failure ? 'failed' : 'passed'
  await finishTestRun(parent, status, {
    profile,
    children,
    usage: aggregateUsage(reports),
    mixedCodeProvenance: reports.some(
      (report) =>
        report !== null &&
        (report.code.head !== parent.code.head ||
          report.code.worktreeDigest !== parent.code.worktreeDigest),
    ),
    error: failure,
  })
  console.log(`HOPI E2E ${profile} Regression ${status}: ${parent.artifactRoot}`)
  if (failure) {
    console.error(failure)
    process.exitCode = 1
  }
  return { parent, children, status }
}

async function runStep(parent: TestRunContext, current: RegressionStep): Promise<RegressionChild> {
  const startedAt = new Date().toISOString()
  const started = Date.now()
  const stepRoot = join(parent.artifactRoot, 'children', safeSegment(current.id))
  const logsRoot = join(parent.artifactRoot, 'logs')
  await Promise.all([mkdir(stepRoot, { recursive: true }), mkdir(logsRoot, { recursive: true })])
  const wrapper: TestRunContext | null = current.retainsArtifact
    ? null
    : {
        artifactRoot: stepRoot,
        scenario: current.id,
        claim: current.claim,
        startedAt,
        code: parent.code,
      }
  if (wrapper) await writeTestRunReport(wrapper, 'running', { command: current.command })

  await recordTestRunAction(
    parent,
    'regression_step_started',
    { id: current.id, command: current.command },
    true,
  )
  const execution = await runCommandWithDeadline({
    command: current.command,
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, HOPI_E2E_ARTIFACT_ROOT: stepRoot },
    timeoutMs: regressionStepTimeoutMs(current.claim),
    forwardOutput: true,
  })
  const { stdout, stderr, exitCode } = execution
  const log = `$ ${current.command.join(' ')}\n\n[stdout]\n${stdout}\n[stderr]\n${stderr}`
  await Bun.write(join(logsRoot, `${safeSegment(current.id)}.log`), log)

  let artifactRoot = stepRoot
  let report: TestRunReport | null = null
  let error: string | undefined
  if (current.retainsArtifact) {
    const retained = await retainedRunRoots(stepRoot)
    const retainedRoot = retained[0]
    if (retained.length !== 1 || !retainedRoot) {
      error = `${current.id} retained ${retained.length} Test Runs; expected exactly one`
    } else {
      artifactRoot = retainedRoot
      report = await readTestRun(artifactRoot).catch((cause) => {
        error = cause instanceof Error ? cause.message : String(cause)
        return null
      })
    }
  } else if (wrapper) {
    await Bun.write(join(stepRoot, 'command.log'), log)
    report = await writeTestRunReport(
      wrapper,
      !execution.timedOut && exitCode === 0 ? 'passed' : 'failed',
      {
        command: current.command,
        exitCode,
        timedOut: execution.timedOut,
        timeoutMs: execution.timeoutMs,
        providerUsage: { runs: 0, inputTokens: 0, outputTokens: 0 },
      },
    )
  }

  if (execution.timedOut) {
    error ??= `${current.id} exceeded ${execution.timeoutMs}ms and was terminated`
  } else if (exitCode !== 0) {
    error ??= `${current.id} exited with ${exitCode}`
  }
  if (exitCode === 0 && report?.status !== 'passed') {
    error ??= `${current.id} exited successfully without a passed terminal Test Run`
  }
  const status = error ? 'failed' : 'passed'
  const result: RegressionChild = {
    id: current.id,
    claim: current.claim,
    command: current.command,
    status,
    exitCode,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    artifactRoot,
    run: report ? join(artifactRoot, 'run.json') : null,
    ...(error ? { error } : {}),
  }
  await recordTestRunAction(
    parent,
    'regression_step_completed',
    { id: current.id, status, exitCode, durationMs: result.durationMs },
    true,
  )
  return result
}

export async function runCommandWithDeadline(options: {
  command: string[]
  cwd: string
  env?: Record<string, string | undefined>
  timeoutMs: number
  forwardOutput?: boolean
}) {
  const timeoutMs = positiveTimeout(options.timeoutMs)
  const child = Bun.spawn(options.command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = readAndForward(child.stdout, options.forwardOutput ? process.stdout : null)
  const stderr = readAndForward(child.stderr, options.forwardOutput ? process.stderr : null)
  let timeout: ReturnType<typeof setTimeout> | undefined
  const exit = await Promise.race([
    child.exited.then((exitCode) => ({ timedOut: false as const, exitCode })),
    new Promise<{ timedOut: true; exitCode: null }>((resolveTimeout) => {
      timeout = setTimeout(() => resolveTimeout({ timedOut: true, exitCode: null }), timeoutMs)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  if (exit.timedOut) {
    child.kill('SIGTERM')
    const stopped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ])
    if (!stopped) child.kill('SIGKILL')
  }
  const [stdoutText, stderrText, exitCode] = await Promise.all([stdout, stderr, child.exited])
  return {
    stdout: stdoutText,
    stderr: stderrText,
    exitCode,
    timedOut: exit.timedOut,
    timeoutMs,
  }
}

async function retainedRunRoots(root: string) {
  const roots: string[] = []
  for await (const path of new Bun.Glob('*/run.json').scan({ cwd: root, onlyFiles: true })) {
    roots.push(resolve(root, path, '..'))
  }
  return roots.toSorted()
}

function step(id: string, claim: TestRunClaim, script: string): RegressionStep {
  return { id, claim, command: ['bun', 'run', script], retainsArtifact: false }
}

function artifactStep(id: string, claim: TestRunClaim, script: string): RegressionStep {
  return { id, claim, command: ['bun', 'run', script], retainsArtifact: true }
}

function safeSegment(value: string) {
  return value.replaceAll(/[^A-Za-z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '') || 'step'
}

function regressionStepTimeoutMs(claim: TestRunClaim) {
  const configured = Number(process.env.HOPI_E2E_STEP_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured > 0) return configured
  return claim === 'live' ? 45 * 60_000 : 15 * 60_000
}

async function readAndForward(
  stream: ReadableStream<Uint8Array>,
  target: { write(chunk: string): unknown } | null,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let content = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    content += text
    target?.write(text)
  }
  const tail = decoder.decode()
  content += tail
  target?.write(tail)
  return content
}

function positiveTimeout(value: number) {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Command timeout must be positive')
  return value
}

export function aggregateUsage(reports: Array<TestRunReport | null>) {
  const total = {
    logicalRunTotal: 0,
    providerUsageEvents: 0,
    tokens: { input: 0, cachedInput: 0, uncachedInput: 0, output: 0 },
  }
  for (const report of reports) {
    const usage = recordValue(report?.usage)
    if (Object.keys(usage).length > 0) {
      total.logicalRunTotal += numberValue(usage.logicalRunTotal)
      total.providerUsageEvents += numberValue(usage.providerUsageEvents)
      const tokens = recordValue(usage.tokens)
      total.tokens.input += numberValue(tokens.input)
      total.tokens.cachedInput += numberValue(tokens.cachedInput)
      total.tokens.uncachedInput += numberValue(tokens.uncachedInput)
      total.tokens.output += numberValue(tokens.output)
      continue
    }

    const compact = recordValue(report?.providerUsage)
    const runs = numberValue(compact.runs)
    const input = numberValue(compact.inputTokens)
    const cachedInput = numberValue(compact.cachedInputTokens)
    total.logicalRunTotal += runs
    total.providerUsageEvents += runs
    total.tokens.input += input
    total.tokens.cachedInput += cachedInput
    total.tokens.uncachedInput += Math.max(0, input - cachedInput)
    total.tokens.output += numberValue(compact.outputTokens)
  }
  return total
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
