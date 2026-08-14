import { expect, test } from 'bun:test'
import { type RunCostEntry, summarizeRunCosts } from '../src/runtime/runCostProjection'

test('aggregates generic Run usage and outcomes', () => {
  const entries: RunCostEntry[] = [entry('R-1', 'normal'), entry('R-2', 'crashed')]
  const normal = entries[0]
  const crashed = entries[1]
  if (!normal || !crashed) throw new Error('Expected two cost entries')
  normal.diagnostics.tokenUsage = {
    inputTokens: 100,
    cachedInputTokens: 60,
    cacheCreationInputTokens: null,
    outputTokens: 20,
    reasoningOutputTokens: 5,
  }
  crashed.diagnostics.vendorReportedCostUsd = 0.2
  expect(summarizeRunCosts(entries)).toMatchObject({
    runs: 2,
    elapsedMs: 2_000,
    toolCalls: 4,
    inputTokens: 100,
    vendorReportedCostUsd: 0.2,
    outcomes: { normal: 1, crashed: 1 },
  })
})

function entry(runId: string, termination: RunCostEntry['termination']): RunCostEntry {
  return {
    workId: 'W-1',
    runId,
    status: 'settled',
    termination,
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
    },
  }
}
