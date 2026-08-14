import type { RunAttemptDiagnostics } from './runAttemptDiagnostics'
import type { RunTermination } from './runRequest'

export interface RunCostEntry {
  workId: string
  runId: string
  status: 'queued' | 'running' | 'settled'
  termination: RunTermination | null
  diagnostics: RunAttemptDiagnostics
}

export interface RunCostSummary {
  runs: number
  elapsedMs: number
  modelMessages: number
  runsWithTurnCount: number
  reportedTurns: number
  toolCalls: number
  commandCalls: number
  observedToolWallTimeMs: number
  observedCommandWallTimeMs: number
  modelAndOverheadWallTimeMs: number
  runsWithTokenUsage: number
  inputTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  runsWithVendorReportedCost: number
  vendorReportedCostUsd: number
  outcomes: {
    normal: number
    cancelled: number
    interrupted: number
    crashed: number
    timedOut: number
  }
}

export function summarizeRunCosts(entries: readonly RunCostEntry[]): RunCostSummary {
  const summary: RunCostSummary = {
    runs: entries.length,
    elapsedMs: 0,
    modelMessages: 0,
    runsWithTurnCount: 0,
    reportedTurns: 0,
    toolCalls: 0,
    commandCalls: 0,
    observedToolWallTimeMs: 0,
    observedCommandWallTimeMs: 0,
    modelAndOverheadWallTimeMs: 0,
    runsWithTokenUsage: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    runsWithVendorReportedCost: 0,
    vendorReportedCostUsd: 0,
    outcomes: {
      normal: 0,
      cancelled: 0,
      interrupted: 0,
      crashed: 0,
      timedOut: 0,
    },
  }
  for (const entry of entries) {
    const diagnostics = entry.diagnostics
    summary.elapsedMs += diagnostics.elapsedMs
    summary.modelMessages += diagnostics.modelMessages
    if (diagnostics.turns !== null) {
      summary.runsWithTurnCount += 1
      summary.reportedTurns += diagnostics.turns
    }
    summary.toolCalls += diagnostics.toolCalls
    summary.commandCalls += diagnostics.commandCalls
    summary.observedToolWallTimeMs += diagnostics.observedToolWallTimeMs
    summary.observedCommandWallTimeMs += diagnostics.observedCommandWallTimeMs
    summary.modelAndOverheadWallTimeMs += diagnostics.modelAndOverheadWallTimeMs
    if (diagnostics.tokenUsage) {
      summary.runsWithTokenUsage += 1
      summary.inputTokens += diagnostics.tokenUsage.inputTokens ?? 0
      summary.cachedInputTokens += diagnostics.tokenUsage.cachedInputTokens ?? 0
      summary.cacheCreationInputTokens += diagnostics.tokenUsage.cacheCreationInputTokens ?? 0
      summary.outputTokens += diagnostics.tokenUsage.outputTokens ?? 0
      summary.reasoningOutputTokens += diagnostics.tokenUsage.reasoningOutputTokens ?? 0
    }
    if (diagnostics.vendorReportedCostUsd !== null) {
      summary.runsWithVendorReportedCost += 1
      summary.vendorReportedCostUsd += diagnostics.vendorReportedCostUsd
    }
    if (entry.termination === 'normal') summary.outcomes.normal += 1
    else if (entry.termination === 'cancelled') summary.outcomes.cancelled += 1
    else if (entry.termination === 'interrupted') summary.outcomes.interrupted += 1
    else if (entry.termination === 'crashed') summary.outcomes.crashed += 1
    else if (entry.termination === 'timed_out') summary.outcomes.timedOut += 1
  }
  return summary
}
