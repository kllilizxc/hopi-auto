import { join } from 'node:path'
import type { RunAttemptSummary, StoredRunAttemptEvent } from './runAttemptStore'

export interface RunTokenUsage {
  inputTokens: number | null
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  outputTokens: number | null
  reasoningOutputTokens: number | null
}

export interface RunAttemptDiagnostics {
  elapsedMs: number
  modelMessages: number
  toolCalls: number
  commandCalls: number
  observedToolWallTimeMs: number
  observedCommandWallTimeMs: number
  modelAndOverheadWallTimeMs: number
  turns: number | null
  vendorReportedCostUsd: number | null
  tokenUsage: RunTokenUsage | null
}

export async function readRunAttemptDiagnostics(
  root: string,
  attempt: Pick<RunAttemptSummary, 'startedAt' | 'endedAt'>,
  events: readonly StoredRunAttemptEvent[],
  now: Date = new Date(),
): Promise<RunAttemptDiagnostics> {
  const elapsedMs = Math.max(
    0,
    Date.parse(attempt.endedAt ?? now.toISOString()) - Date.parse(attempt.startedAt),
  )
  const toolIntervals = pairedToolIntervals(events)
  const observedToolWallTimeMs = unionDuration(toolIntervals)
  const observedCommandWallTimeMs = unionDuration(
    toolIntervals.filter((interval) => interval.toolName === 'command'),
  )
  const usage = await readTerminalUsage(join(root, 'transcript.log'))

  return {
    elapsedMs,
    modelMessages: events.filter(
      (event) => event.kind === 'transcript' && event.entryKind === 'assistant',
    ).length,
    toolCalls: countToolCalls(events),
    commandCalls: countToolCalls(events, 'command'),
    observedToolWallTimeMs,
    observedCommandWallTimeMs,
    modelAndOverheadWallTimeMs: Math.max(0, elapsedMs - observedToolWallTimeMs),
    turns: usage?.turns ?? null,
    vendorReportedCostUsd: usage?.vendorReportedCostUsd ?? null,
    tokenUsage: usage?.tokenUsage ?? null,
  }
}

interface ToolInterval {
  start: number
  end: number
  toolName: string | null
}

function pairedToolIntervals(events: readonly StoredRunAttemptEvent[]): ToolInterval[] {
  const starts = new Map<string, { at: number; toolName: string | null }>()
  const intervals: ToolInterval[] = []
  for (const event of events) {
    if (event.kind !== 'transcript' || !event.toolInvocationKey) continue
    if (event.entryKind === 'tool_call') {
      if (!starts.has(event.toolInvocationKey)) {
        starts.set(event.toolInvocationKey, {
          at: Date.parse(event.createdAt),
          toolName: event.toolName ?? null,
        })
      }
      continue
    }
    if (event.entryKind !== 'tool_result' && event.entryKind !== 'error') continue
    const start = starts.get(event.toolInvocationKey)
    if (!start) continue
    starts.delete(event.toolInvocationKey)
    const end = Date.parse(event.createdAt)
    if (Number.isFinite(start.at) && Number.isFinite(end) && end >= start.at) {
      intervals.push({ start: start.at, end, toolName: start.toolName })
    }
  }
  return intervals
}

function unionDuration(intervals: readonly ToolInterval[]) {
  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
  let total = 0
  let start: number | null = null
  let end: number | null = null
  for (const interval of sorted) {
    if (start === null || end === null) {
      start = interval.start
      end = interval.end
      continue
    }
    if (interval.start <= end) {
      end = Math.max(end, interval.end)
      continue
    }
    total += end - start
    start = interval.start
    end = interval.end
  }
  return total + (start === null || end === null ? 0 : end - start)
}

function countToolCalls(events: readonly StoredRunAttemptEvent[], toolName?: string) {
  const keys = new Set<string>()
  let anonymous = 0
  for (const event of events) {
    if (
      event.kind !== 'transcript' ||
      event.entryKind !== 'tool_call' ||
      (toolName && event.toolName !== toolName)
    ) {
      continue
    }
    if (event.toolInvocationKey) keys.add(event.toolInvocationKey)
    else anonymous += 1
  }
  return keys.size + anonymous
}

interface TerminalUsage {
  turns: number | null
  vendorReportedCostUsd: number | null
  tokenUsage: RunTokenUsage | null
}

async function readTerminalUsage(path: string): Promise<TerminalUsage | null> {
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  let terminal: TerminalUsage | null = null
  for (const line of (await file.text()).split('\n')) {
    const parsed = parseTranscriptJson(line)
    if (!parsed) continue
    const type = stringValue(parsed.type)
    if (type !== 'turn.completed' && type !== 'result') continue
    const usage = objectValue(parsed.usage)
    terminal = {
      turns: integerValue(parsed.num_turns),
      vendorReportedCostUsd: numberValue(parsed.total_cost_usd),
      tokenUsage: usage
        ? {
            inputTokens: integerValue(usage.input_tokens),
            cachedInputTokens:
              integerValue(usage.cached_input_tokens) ??
              integerValue(usage.cache_read_input_tokens),
            cacheCreationInputTokens: integerValue(usage.cache_creation_input_tokens),
            outputTokens: integerValue(usage.output_tokens),
            reasoningOutputTokens: integerValue(usage.reasoning_output_tokens),
          }
        : null,
    }
  }
  return terminal
}

function parseTranscriptJson(line: string): Record<string, unknown> | null {
  const separator = line.indexOf(': ')
  const source = separator === -1 ? line.trim() : line.slice(separator + 2).trim()
  if (!source.startsWith('{')) return null
  try {
    return objectValue(JSON.parse(source))
  } catch {
    return null
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function integerValue(value: unknown) {
  const number = numberValue(value)
  return number !== null && Number.isInteger(number) ? number : null
}
