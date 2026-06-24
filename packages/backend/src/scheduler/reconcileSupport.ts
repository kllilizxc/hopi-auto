import type { AgentOutcome, AgentRuntimeEvent } from '../agent/AgentRunner'
import type { BlockerRef, TaskStatus } from '../domain/board'
import type { GitMergeExecutor } from '../runtime/gitMergeExecutor'
import type { RunStatus, StepOutcome } from '../runtime/runHistory'
import type { RunHistoryStore } from '../runtime/runHistoryStore'

export function runStatusForResolution(resolution: {
  blocker?: BlockerRef
  to: TaskStatus
}): RunStatus | undefined {
  if (resolution.blocker) {
    return 'blocked'
  }

  if (resolution.to === 'done') {
    return 'completed'
  }

  if (resolution.to === 'planned') {
    return 'retryable'
  }

  return undefined
}

export function stepOutcomeForAgentOutcome(outcome: AgentOutcome): StepOutcome {
  switch (outcome.kind) {
    case 'success':
      return 'success'
    case 'reject':
      return 'reject'
    case 'merge_conflict':
      return 'merge_conflict'
    case 'timeout':
      return 'timeout'
    case 'fail':
      return 'fail'
  }
}

export function executionOutcomeForAgentOutcome(outcome: AgentOutcome) {
  if (outcome.kind === 'success') {
    return 'succeeded' as const
  }
  if (outcome.kind === 'reject') {
    return 'rejected' as const
  }
  if (outcome.kind === 'timeout') {
    return 'timed_out' as const
  }
  if (outcome.kind === 'merge_conflict') {
    return 'merge_conflict' as const
  }
  if (outcome.kind === 'fail') {
    return 'failed' as const
  }
  return 'system_error' as const
}

export function messageForOutcome(taskRef: string, outcome: AgentOutcome, statusAfter: TaskStatus) {
  switch (outcome.kind) {
    case 'success':
      return `${taskRef} advanced to ${statusAfter}`
    case 'reject':
      return outcome.reason
    case 'merge_conflict':
      return `merge conflict: ${outcome.artifactRef}`
    case 'timeout':
      return outcome.reason
    case 'fail':
      return outcome.reason
  }
}

export function statusMessage(content: string) {
  return {
    kind: 'system' as const,
    role: 'system' as const,
    content,
  }
}

export function historyEventForRuntimeEvent(event: AgentRuntimeEvent) {
  if (event.kind === 'transcript') {
    return {
      kind: 'transcript' as const,
      transport: event.transport,
      entryKind: event.entryKind,
      summary: event.summary,
      toolName: event.toolName,
      toolInvocationKey: event.toolInvocationKey,
      vendorEventType: event.vendorEventType,
    }
  }

  if (event.kind === 'message') {
    return {
      kind: 'message' as const,
      level: event.level,
      role: event.role,
      content: event.content,
    }
  }

  if (event.kind === 'worktree_prepared') {
    return {
      kind: 'worktree_prepared' as const,
      path: event.path,
      branch: event.branch,
      baseBranch: event.baseBranch,
    }
  }

  return {
    kind: 'artifact' as const,
    ref: event.ref,
    label: event.label,
  }
}

export async function recordMergeScriptAttempt(
  history: RunHistoryStore | undefined,
  options: {
    goalKey: string
    runId: string
    stepId: string
    attempt: Awaited<ReturnType<NonNullable<GitMergeExecutor['runMergeScript']>>>
    phase: 'initial' | 'verification'
  },
) {
  if (!history) {
    return
  }

  const toolInvocationKey = `merge-script:${options.phase}:${options.runId}:${options.stepId}`
  const commandSummary = `command (${options.attempt.command.join(' ')})`
  const resultSummary = summarizeMergeScriptAttempt(options.attempt, options.phase)
  await history.recordStepEvent({
    goalKey: options.goalKey,
    runId: options.runId,
    stepId: options.stepId,
    event: {
      kind: 'transcript',
      transport: 'process',
      entryKind: 'tool_call',
      summary: commandSummary,
      toolName: 'command',
      toolInvocationKey,
      vendorEventType: 'merge_script',
    },
  })
  await history.recordStepEvent({
    goalKey: options.goalKey,
    runId: options.runId,
    stepId: options.stepId,
    event: {
      kind: 'transcript',
      transport: 'process',
      entryKind: 'tool_result',
      summary: resultSummary,
      toolName: 'command',
      toolInvocationKey,
      vendorEventType: 'merge_script',
    },
  })
}

export function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }

  return ''
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function summarizeMergeScriptAttempt(
  attempt: Awaited<ReturnType<NonNullable<GitMergeExecutor['runMergeScript']>>>,
  phase: 'initial' | 'verification',
) {
  const parts = [`${phase} merge script`]
  if (attempt.result) {
    parts.push(`${attempt.result.kind}: ${attempt.result.reason}`)
  } else if (attempt.parseError) {
    parts.push(`invalid output: ${attempt.parseError}`)
  } else {
    parts.push(`exit ${attempt.exitCode}`)
  }

  const stdout = attempt.stdout.trim()
  if (stdout) {
    parts.push(`stdout=${truncateHistorySummary(stdout)}`)
  }
  const stderr = attempt.stderr.trim()
  if (stderr) {
    parts.push(`stderr=${truncateHistorySummary(stderr)}`)
  }

  return parts.join(' | ')
}

function truncateHistorySummary(content: string, maxLength = 240) {
  if (content.length <= maxLength) {
    return content
  }
  return `${content.slice(0, maxLength)}...[truncated]`
}
