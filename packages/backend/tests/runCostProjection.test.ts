import { expect, test } from 'bun:test'
import { type RunCostEntry, summarizeRunCosts } from '../src/runtime/runCostProjection'

test('aggregates only vendor-reported usage while preserving extra-run outcomes', () => {
  const entries = [
    entry('R-1', 'planner', {
      tokenUsage: {
        inputTokens: 100,
        cachedInputTokens: 60,
        cacheCreationInputTokens: null,
        outputTokens: 20,
        reasoningOutputTokens: 5,
      },
      vendorReportedCostUsd: null,
    }),
    entry('R-2', 'reviewer', {
      tokenUsage: null,
      vendorReportedCostUsd: 0.2,
      result: 'reject',
    }),
  ]

  expect(summarizeRunCosts(entries)).toMatchObject({
    runs: 2,
    elapsedMs: 2_000,
    toolCalls: 4,
    runsWithTurnCount: 2,
    reportedTurns: 2,
    runsWithTokenUsage: 1,
    inputTokens: 100,
    cachedInputTokens: 60,
    outputTokens: 20,
    runsWithVendorReportedCost: 1,
    vendorReportedCostUsd: 0.2,
    outcomes: {
      success: 1,
      rejected: 1,
      preparationFailed: 0,
      failed: 0,
      interrupted: 0,
      stale: 0,
    },
  })
})

function entry(
  runId: string,
  responsibility: RunCostEntry['responsibility'],
  overrides: Partial<RunCostEntry['diagnostics']> & { result?: string },
): RunCostEntry {
  const { result = 'success', ...diagnosticOverrides } = overrides
  return {
    workId: 'W-1',
    runId,
    responsibility,
    status: 'finished',
    result,
    application: 'published',
    diagnostics: {
      elapsedMs: 1_000,
      modelMessages: 1,
      toolCalls: 2,
      commandCalls: 1,
      observedToolWallTimeMs: 300,
      observedCommandWallTimeMs: 200,
      modelAndOverheadWallTimeMs: 700,
      turns: 1,
      tokenUsage: null,
      vendorReportedCostUsd: null,
      ...diagnosticOverrides,
    },
  }
}
