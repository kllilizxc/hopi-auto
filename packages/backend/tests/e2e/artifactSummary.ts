import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseInboxEventDocument } from '../../src/domain/assistantWorkspaceDocuments'
import { type TestRunReport, readTestRun } from '../testRunArtifact'

interface UsageSummary {
  logicalRuns: number
  input: number
  cachedInput: number
  uncachedInput: number
  output: number
  roles: Array<{
    role: string
    logicalRuns: number
    input: number
    cachedInput: number
    output: number
  }>
}

interface HopiStateSummary {
  activeRuns: number
  unresolvedAttentions: number
  pendingInbox: number
  goalLifecycles: Record<string, number>
}

export interface TestRunSummary {
  artifactRoot: string
  scenario: string
  claim: string
  status: string
  durationMs: number | null
  failedAt: string | null
  lastCheckpoint: string | null
  currentPhase: string | null
  lastAction: string | null
  error: string | null
  cleanup: {
    status: string
    completed: number
    total: number
    failures: string[]
  } | null
  invariants: string[]
  usage: UsageSummary | null
  state: HopiStateSummary | null
  evidence: Record<string, number>
  warnings: string[]
}

export async function readTestRunSummary(root: string): Promise<TestRunSummary> {
  const artifactRoot = resolve(root)
  const report = await readTestRun(artifactRoot)
  const [actions, invariants, states] = await Promise.all([
    readJsonLines(join(artifactRoot, 'actions.jsonl')),
    readJsonLines(join(artifactRoot, 'invariants.jsonl')),
    readJsonLines(join(artifactRoot, 'states.jsonl')),
  ])
  const phaseAction = actions.records.findLast(
    (record) => record.action === 'phase_started' && typeof record.phase === 'string',
  )
  const checkpointAction = actions.records.findLast(
    (record) => record.action === 'checkpoint_reached' && typeof record.checkpoint === 'string',
  )
  const lastSemanticAction = actions.records.findLast(
    (record) =>
      typeof record.action === 'string' &&
      ![
        'phase_started',
        'checkpoint_reached',
        'cleanup_started',
        'cleanup_completed',
        'cleanup_failed',
        'server_stopped',
      ].includes(record.action),
  )
  const latestState = states.records.findLast((record) => isRecord(record.state))
  const warnings = [...actions.errors, ...invariants.errors, ...states.errors]
  const state = await hopiStateSummary(artifactRoot, report, latestState?.state, warnings)
  const endedAt = typeof report.endedAt === 'string' ? Date.parse(report.endedAt) : Number.NaN
  const startedAt = Date.parse(report.startedAt)

  return {
    artifactRoot,
    scenario: report.scenario,
    claim: report.claim,
    status: report.status,
    durationMs: Number.isFinite(startedAt) && Number.isFinite(endedAt) ? endedAt - startedAt : null,
    failedAt: stringValue(report.failedAt),
    lastCheckpoint: stringValue(report.lastCheckpoint) ?? stringValue(checkpointAction?.checkpoint),
    currentPhase: stringValue(phaseAction?.phase),
    lastAction: stringValue(lastSemanticAction?.action),
    error: conciseError(stringValue(report.error)),
    cleanup: cleanupSummary(report.cleanup),
    invariants: invariants.records.flatMap((record) =>
      typeof record.violation === 'string' ? [record.violation] : [],
    ),
    usage: usageSummary(report),
    state,
    evidence: Object.fromEntries(
      [...new Set(report.evidence.map((entry) => entry.kind))].map((kind) => [
        kind,
        report.evidence.filter((entry) => entry.kind === kind).length,
      ]),
    ),
    warnings,
  }
}

export function formatTestRunSummary(summary: TestRunSummary) {
  const lines = [
    `${summary.scenario} [${summary.claim}] ${summary.status}`,
    `Artifact: ${summary.artifactRoot}`,
    `Duration: ${formatDuration(summary.durationMs)}`,
    `Execution: phase=${summary.failedAt ?? summary.currentPhase ?? 'n/a'} checkpoint=${summary.lastCheckpoint ?? 'none'} last=${summary.lastAction ?? 'none'}`,
  ]
  if (summary.error) lines.push(`Failure: ${summary.error}`)
  if (summary.cleanup) {
    lines.push(
      `Cleanup: ${summary.cleanup.status} (${summary.cleanup.completed}/${summary.cleanup.total} completed)`,
    )
    for (const failure of summary.cleanup.failures) lines.push(`  ${failure}`)
  }
  lines.push(
    summary.invariants.length === 0
      ? 'Invariants: none recorded'
      : `Invariants: ${summary.invariants.length} violation(s)`,
  )
  for (const violation of summary.invariants.slice(0, 3)) lines.push(`  ${violation}`)
  if (summary.state) {
    const lifecycles = Object.entries(summary.state.goalLifecycles)
      .map(([lifecycle, count]) => `${lifecycle}=${count}`)
      .join(' ')
    lines.push(
      `State: activeRuns=${summary.state.activeRuns} unresolvedAttentions=${summary.state.unresolvedAttentions} pendingInbox=${summary.state.pendingInbox} goals=${lifecycles || 'none'}`,
    )
  }
  if (summary.usage) {
    lines.push(
      `Models: logicalRuns=${formatInteger(summary.usage.logicalRuns)} input=${formatInteger(summary.usage.input)} cached=${formatInteger(summary.usage.cachedInput)} uncached=${formatInteger(summary.usage.uncachedInput)} output=${formatInteger(summary.usage.output)}`,
    )
    for (const role of summary.usage.roles) {
      lines.push(
        `  ${role.role}: runs=${formatInteger(role.logicalRuns)} input=${formatInteger(role.input)} cached=${formatInteger(role.cachedInput)} output=${formatInteger(role.output)}`,
      )
    }
  } else {
    lines.push('Models: no usage recorded')
  }
  lines.push(
    `Evidence: ${
      Object.entries(summary.evidence)
        .map(([kind, count]) => `${kind}=${count}`)
        .join(' ') || 'none'
    }`,
  )
  for (const warning of summary.warnings) lines.push(`Warning: ${warning}`)
  return lines.join('\n')
}

async function hopiStateSummary(
  artifactRoot: string,
  report: TestRunReport,
  rawState: unknown,
  warnings: string[],
): Promise<HopiStateSummary | null> {
  const state = recordValue(rawState)
  const paths = recordValue(report.paths)
  const configuredHome = stringValue(paths?.home)
  const homeRoot = configuredHome ?? join(artifactRoot, 'home')
  const pendingInbox = await countPendingInbox(homeRoot, warnings)
  if (!state && pendingInbox === null) return null

  const activeRuns = arrayValue(state?.activeRuns).length
  const unresolvedAttentions = arrayValue(state?.attentions).filter(
    (attention) => recordValue(attention)?.resolvedAt === null,
  ).length
  const goalLifecycles: Record<string, number> = {}
  for (const project of arrayValue(state?.projects)) {
    for (const goal of arrayValue(recordValue(project)?.goals)) {
      const lifecycle = stringValue(recordValue(goal)?.lifecycle)
      if (lifecycle) goalLifecycles[lifecycle] = (goalLifecycles[lifecycle] ?? 0) + 1
    }
  }
  return {
    activeRuns,
    unresolvedAttentions,
    pendingInbox: pendingInbox ?? 0,
    goalLifecycles,
  }
}

async function countPendingInbox(homeRoot: string, warnings: string[]) {
  try {
    if (!(await stat(homeRoot)).isDirectory()) return null
  } catch {
    return null
  }
  let pending = 0
  for await (const path of new Bun.Glob('.hopi/docs/assistant/inbox/*.md').scan({
    cwd: homeRoot,
    dot: true,
    onlyFiles: true,
  })) {
    try {
      const event = parseInboxEventDocument(await Bun.file(join(homeRoot, path)).text())
      if (event.attributes.status === 'pending') pending += 1
    } catch (error) {
      warnings.push(`${path}: ${errorMessage(error)}`)
    }
  }
  return pending
}

function cleanupSummary(value: unknown): TestRunSummary['cleanup'] {
  const cleanup = recordValue(value)
  if (!cleanup) return null
  const resources = arrayValue(cleanup.resources).map(recordValue).filter(isDefined)
  const failures = resources.flatMap((resource) => {
    if (resource.status === 'completed') return []
    return [
      `${stringValue(resource.name) ?? 'resource'}: ${stringValue(resource.status) ?? 'unknown'}${resource.error ? ` (${String(resource.error)})` : ''}`,
    ]
  })
  return {
    status: stringValue(cleanup.status) ?? (failures.length === 0 ? 'passed' : 'failed'),
    completed: resources.filter((resource) => resource.status === 'completed').length,
    total: resources.length,
    failures,
  }
}

function usageSummary(report: TestRunReport): UsageSummary | null {
  const usage = recordValue(report.usage)
  if (usage) {
    const tokens = recordValue(usage.tokens)
    const logicalRuns = recordValue(usage.logicalRuns)
    const byScope = recordValue(usage.byScope)
    const roles = [
      'assistant',
      'reflection',
      'planner',
      'generator',
      'reviewer',
      'unknown',
    ].flatMap((role) => {
      const scope = recordValue(byScope?.[role])
      const logical = numberValue(logicalRuns?.[role])
      const input = numberValue(scope?.input)
      const cachedInput = numberValue(scope?.cachedInput)
      const output = numberValue(scope?.output)
      if (logical + input + cachedInput + output === 0) return []
      return [{ role, logicalRuns: logical, input, cachedInput, output }]
    })
    return {
      logicalRuns: numberValue(usage.logicalRunTotal),
      input: numberValue(tokens?.input),
      cachedInput: numberValue(tokens?.cachedInput),
      uncachedInput: numberValue(tokens?.uncachedInput),
      output: numberValue(tokens?.output),
      roles,
    }
  }
  const provider = recordValue(report.providerUsage)
  if (!provider) return null
  const input = numberValue(provider.inputTokens)
  const cachedInput = numberValue(provider.cachedInputTokens)
  return {
    logicalRuns: numberValue(provider.runs),
    input,
    cachedInput,
    uncachedInput: input - cachedInput,
    output: numberValue(provider.outputTokens),
    roles: [],
  }
}

async function readJsonLines(path: string) {
  const file = Bun.file(path)
  if (!(await file.exists())) return { records: [] as Record<string, unknown>[], errors: [] }
  const source = await file.text()
  const lines = source.split(/\r?\n/)
  if (!source.endsWith('\n')) lines.pop()
  const records: Record<string, unknown>[] = []
  const errors: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (isRecord(value)) records.push(value)
      else errors.push(`${path}:${index + 1}: JSONL record is not an object`)
    } catch (error) {
      errors.push(`${path}:${index + 1}: ${errorMessage(error)}`)
    }
  }
  return { records, errors }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDefined<T>(value: T | null): value is T {
  return value !== null
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return 'running or unavailable'
  const seconds = Math.max(0, Math.round(durationMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString('en-US')
}

function conciseError(value: string | null) {
  if (!value) return null
  const embeddedState = value.indexOf('. Last value:')
  if (embeddedState >= 0)
    return `${value.slice(0, embeddedState)}. Last value retained in run.json.`
  return value.length > 500 ? `${value.slice(0, 497)}...` : value
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((argument) => argument !== '--')
  const root = args[0]
  if (!root || args.length !== 1) {
    console.error('Usage: bun run artifact:summary -- <test-run-root>')
    process.exitCode = 1
  } else {
    console.log(formatTestRunSummary(await readTestRunSummary(root)))
  }
}
