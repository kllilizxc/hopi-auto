import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRunAttemptDiagnostics } from '../src/runtime/runAttemptDiagnostics'
import type { StoredRunAttemptEvent } from '../src/runtime/runAttemptStore'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test('derives Codex tokens and non-overlapping observed tool time without inventing price', async () => {
  const root = await temporaryRoot()
  await Bun.write(
    join(root, 'transcript.log'),
    [
      'stdout: {"type":"thread.started","thread_id":"T-1"}',
      'stdout: {"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":900,"output_tokens":80,"reasoning_output_tokens":20}}',
    ].join('\n'),
  )
  const diagnostics = await readRunAttemptDiagnostics(
    root,
    { startedAt: '2026-07-19T00:00:00.000Z', endedAt: '2026-07-19T00:00:10.000Z' },
    [
      event('AE-1', '2026-07-19T00:00:01.000Z', 'tool_call', 'command', 'call-1'),
      event('AE-2', '2026-07-19T00:00:02.000Z', 'tool_call', 'command', 'call-2'),
      event('AE-3', '2026-07-19T00:00:04.000Z', 'tool_result', 'command', 'call-1'),
      event('AE-4', '2026-07-19T00:00:05.000Z', 'tool_result', 'command', 'call-2'),
      event('AE-5', '2026-07-19T00:00:06.000Z', 'assistant'),
    ],
  )

  expect(diagnostics).toEqual({
    elapsedMs: 10_000,
    modelMessages: 1,
    toolCalls: 2,
    commandCalls: 2,
    observedToolWallTimeMs: 4_000,
    observedCommandWallTimeMs: 4_000,
    modelAndOverheadWallTimeMs: 6_000,
    turns: null,
    vendorReportedCostUsd: null,
    tokenUsage: {
      inputTokens: 1200,
      cachedInputTokens: 900,
      cacheCreationInputTokens: null,
      outputTokens: 80,
      reasoningOutputTokens: 20,
    },
  })
})

test('uses the terminal Claude usage record including vendor cost and turns', async () => {
  const root = await temporaryRoot()
  await Bun.write(
    join(root, 'transcript.log'),
    'stdout: {"type":"result","num_turns":3,"total_cost_usd":0.42,"usage":{"input_tokens":200,"cache_creation_input_tokens":30,"cache_read_input_tokens":150,"output_tokens":40}}\n',
  )

  expect(
    await readRunAttemptDiagnostics(
      root,
      { startedAt: '2026-07-19T00:00:00.000Z', endedAt: '2026-07-19T00:00:01.000Z' },
      [],
    ),
  ).toMatchObject({
    turns: 3,
    vendorReportedCostUsd: 0.42,
    tokenUsage: {
      inputTokens: 200,
      cachedInputTokens: 150,
      cacheCreationInputTokens: 30,
      outputTokens: 40,
      reasoningOutputTokens: null,
    },
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'hopi-run-diagnostics-'))
  roots.push(root)
  return root
}

function event(
  eventId: string,
  createdAt: string,
  entryKind: 'assistant' | 'tool_call' | 'tool_result',
  toolName?: string,
  toolInvocationKey?: string,
): StoredRunAttemptEvent {
  return {
    eventId,
    createdAt,
    kind: 'transcript',
    transport: 'codex',
    entryKind,
    summary: entryKind,
    ...(toolName ? { toolName } : {}),
    ...(toolInvocationKey ? { toolInvocationKey } : {}),
  }
}
