import { existsSync } from 'node:fs'
import type { AgentRunner } from '../agent/AgentRunner'
import type { AgentRole } from '../agent/AgentRunner'
import { MockAgentRunner } from '../agent/AgentRunner'
import { ConfiguredRoleProcessRunner } from '../agent/ConfiguredRoleProcessRunner'
import { createAssistantRunStore } from '../assistant/assistantRunStore'
import { createGoalAssistantRuntime } from '../assistant/GoalAssistantRuntime'
import type { FailureKind, TaskKind } from '../domain/board'
import {
  type ActionRequiredNotifier,
  createActionRequiredNotifier,
} from './actionRequiredNotifier'
import {
  type AssistantThreadStoreObserver,
  createAssistantThreadStore,
} from './assistantThreadStore'
import { createAttemptStore } from './attemptStore'
import { createGoalDocsStore } from './goalDocsStore'
import {
  type ExecutionStateStoreObserver,
  createExecutionStateStore,
  createWorkerLeaseStore,
} from './executionStateStore'
import { type RunHistoryStoreObserver, createRunHistoryStore } from './runHistoryStore'
import { createWriteTraceStore } from './writeTraceStore'
import { createBoardStore } from '../storage/boardStore'
import { createDecisionStore } from '../storage/decisionStore'
import { createGoalAttachmentStore } from '../storage/goalAttachmentStore'
import { createProjectPaths } from '../storage/paths'
import { createPlanningRequestStore } from '../storage/planningRequestStore'
import { createPreferenceStore } from '../storage/preferenceStore'

export interface GoalApiContext {
  rootDir: string
  store: ReturnType<typeof createBoardStore>
  decisions: ReturnType<typeof createDecisionStore>
  planningRequests: ReturnType<typeof createPlanningRequestStore>
  preferences: ReturnType<typeof createPreferenceStore>
  goalDocs: ReturnType<typeof createGoalDocsStore>
  attachments: ReturnType<typeof createGoalAttachmentStore>
  assistantThread: ReturnType<typeof createAssistantThreadStore>
  assistantRuns: ReturnType<typeof createAssistantRunStore>
  assistantRuntime: ReturnType<typeof createGoalAssistantRuntime>
  attempts: ReturnType<typeof createAttemptStore>
  execution: ReturnType<typeof createExecutionStateStore>
  workers: ReturnType<typeof createWorkerLeaseStore>
  history: ReturnType<typeof createRunHistoryStore>
  writeTraces: ReturnType<typeof createWriteTraceStore>
  actionRequired: ActionRequiredNotifier
  runner: AgentRunner
}

export interface GoalApiContextHooks {
  assistantThreadObserver?: AssistantThreadStoreObserver
  runHistoryObserver?: RunHistoryStoreObserver
  executionObserver?: ExecutionStateStoreObserver
}

export function createGoalApiContext(
  rootDir: string,
  runner?: AgentRunner,
  hooks: GoalApiContextHooks = {},
): GoalApiContext {
  const store = createBoardStore(rootDir)
  const decisions = createDecisionStore(rootDir)
  const assistantThread = createAssistantThreadStore(rootDir, hooks.assistantThreadObserver)
  const actionRequired = createActionRequiredNotifier(rootDir, {
    boardStore: store,
    decisions,
    assistantThread,
  })
  const attempts = createAttemptStore(rootDir)
  const history = createRunHistoryStore(rootDir, hooks.runHistoryObserver)
  const executionObserver = createDurableExecutionObserver({
    actionRequired,
    assistantThread,
    attempts,
    history,
    downstream: hooks.executionObserver,
  })

  return {
    rootDir,
    store,
    decisions,
    planningRequests: createPlanningRequestStore(rootDir),
    preferences: createPreferenceStore(rootDir),
    goalDocs: createGoalDocsStore(rootDir),
    attachments: createGoalAttachmentStore(rootDir),
    assistantThread,
    assistantRuns: createAssistantRunStore(rootDir),
    assistantRuntime: createGoalAssistantRuntime(
      rootDir,
      undefined,
      undefined,
      undefined,
      undefined,
      assistantThread,
    ),
    attempts,
    execution: createExecutionStateStore(rootDir, executionObserver),
    workers: createWorkerLeaseStore(rootDir),
    history,
    writeTraces: createWriteTraceStore(rootDir),
    actionRequired,
    runner: runner ?? createDefaultRunner(rootDir),
  }
}

function createDefaultRunner(rootDir: string): AgentRunner {
  const paths = createProjectPaths(rootDir)
  if (existsSync(paths.adapterConfigPath())) {
    return new ConfiguredRoleProcessRunner({ rootDir })
  }

  return new MockAgentRunner()
}

function createDurableExecutionObserver(options: {
  actionRequired: ActionRequiredNotifier
  assistantThread: ReturnType<typeof createAssistantThreadStore>
  attempts: ReturnType<typeof createAttemptStore>
  history: ReturnType<typeof createRunHistoryStore>
  downstream?: ExecutionStateStoreObserver
}): ExecutionStateStoreObserver {
  return {
    async onGoalExecutionChanged(goalKey) {
      await options.downstream?.onGoalExecutionChanged?.(goalKey)
    },
    async onAutomationChanged(goalKey, status) {
      await options.actionRequired.reconcileGoal(goalKey)
      await notifyRetryableAutomation(status, goalKey, {
        assistantThread: options.assistantThread,
        attempts: options.attempts,
        history: options.history,
      })
      if (status.state === 'failed') {
        await options.actionRequired.notifyAutomationFailed(goalKey, status.error)
      } else {
        await options.actionRequired.clearAutomationFailed(goalKey)
      }
      await options.downstream?.onAutomationChanged?.(goalKey, status)
    },
  }
}

async function notifyRetryableAutomation(
  status: Awaited<ReturnType<ReturnType<typeof createExecutionStateStore>['readAutomationStatus']>>,
  goalKey: string,
  options: {
    assistantThread: ReturnType<typeof createAssistantThreadStore>
    attempts: ReturnType<typeof createAttemptStore>
    history: ReturnType<typeof createRunHistoryStore>
  },
) {
  const lastResult = status.lastResult
  if (
    status.state !== 'running' ||
    !lastResult ||
    lastResult.kind !== 'advanced' ||
    lastResult.from !== lastResult.to
  ) {
    return
  }

  const history = await options.history.readGoalHistory(goalKey)
  const run = [...history.runs]
    .reverse()
    .find((entry) => entry.taskRef === lastResult.taskRef && entry.status === 'retryable')
  const step = run?.steps.at(-1)
  if (!run || !step || !isRetryableStepOutcome(step.outcome)) {
    return
  }

  const reason = step.messages.at(-1)?.content ?? defaultRetryReason(step.role, step.outcome)
  const failureKind = inferRetryFailureKind(run.taskKind, step.role, step.outcome, reason)
  const attemptCount = failureKind ? await options.attempts.get(run.taskRef, failureKind) : 0
  await options.assistantThread.appendSystemMessage(goalKey, {
    label: 'Automation update',
    content: `Automation will retry ${run.taskRef} automatically.`,
    details: [
      `Latest result: ${describeRetryableOutcome(step.role, step.outcome, reason)}`,
      attemptCount > 0
        ? `Attempt ${attemptCount} recorded. Automation will keep retrying until the task succeeds or the attempt budget is exhausted.`
        : 'Automation will keep retrying until the task succeeds or the attempt budget is exhausted.',
    ],
    collapsedByDefault: false,
    dedupeKey: `retryable_run:${run.runId}`,
  })
}

function defaultRetryReason(role: AgentRole, outcome: 'reject' | 'fail' | 'timeout' | 'merge_conflict') {
  if (outcome === 'merge_conflict') {
    return 'merge conflict'
  }

  if (outcome === 'reject') {
    return `${role} rejected the current attempt`
  }

  if (outcome === 'timeout') {
    return `${role} timed out`
  }

  return `${role} failed`
}

function isRetryableStepOutcome(
  outcome: string,
): outcome is 'reject' | 'fail' | 'timeout' | 'merge_conflict' {
  return (
    outcome === 'reject' ||
    outcome === 'fail' ||
    outcome === 'timeout' ||
    outcome === 'merge_conflict'
  )
}

function describeRetryableOutcome(
  role: AgentRole,
  outcome: 'reject' | 'fail' | 'timeout' | 'merge_conflict',
  reason: string,
) {
  if (outcome === 'merge_conflict') {
    return `merge conflict: ${reason}`
  }

  if (outcome === 'reject') {
    return `reviewer rejection: ${reason}`
  }

  if (outcome === 'timeout') {
    return `${role} timeout: ${reason}`
  }

  return `${role} failure: ${reason}`
}

function inferRetryFailureKind(
  taskKind: TaskKind,
  role: AgentRole,
  outcome: 'reject' | 'fail' | 'timeout' | 'merge_conflict',
  reason: string,
): FailureKind | null {
  if (outcome === 'reject') {
    return 'reviewer_rejected'
  }

  if (outcome === 'merge_conflict') {
    return 'merge_conflict'
  }

  if (outcome === 'timeout') {
    return 'timeout'
  }

  if (
    taskKind === 'planning' &&
    role === 'reviewer' &&
    reason.startsWith('Missing requested planning follow-through evidence:')
  ) {
    return 'planning_follow_through_missing'
  }

  if (
    taskKind === 'planning' &&
    role === 'reviewer' &&
    (reason.startsWith('Invalid engineering task decomposition:') ||
      reason.startsWith('Invalid engineering Browser Harness acceptance:'))
  ) {
    return 'planning_task_graph_invalid'
  }

  return 'agent_failed'
}
