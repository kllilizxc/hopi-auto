import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskKind, TaskStatus } from '../domain/board'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import {
  type GoalRun,
  type GoalRunHistory,
  type GoalRunSummary,
  type RunStatus,
  type RunStepMessage,
  type RunTranscriptEntry,
  type RunStepEventInput,
  type RunStepMessageInput,
  type StepOutcome,
  createStoredMessage,
  createStoredTranscript,
  emptyGoalRunHistory,
  parseGoalRunHistory,
  toRunSummary,
} from './runHistory'

export interface StartStepOptions {
  goalKey: string
  taskRef: string
  taskKind: TaskKind
  role: AgentRole
  statusBefore: TaskStatus
  message?: RunStepMessageInput
  refs?: {
    runId?: string
    stepId?: string
  }
}

export interface FinishStepOptions {
  goalKey: string
  runId: string
  stepId: string
  statusAfter: TaskStatus
  outcome: StepOutcome
  message?: RunStepMessageInput
  runStatus?: RunStatus
}

export interface RunHistoryStore {
  readGoalHistory(goalKey: string): Promise<GoalRunHistory>
  readRun(goalKey: string, runId: string): Promise<GoalRun | null>
  listRuns(goalKey: string): Promise<GoalRunSummary[]>
  startStep(options: StartStepOptions): Promise<{ runId: string; stepId: string }>
  recordStepEvent(options: {
    goalKey: string
    runId: string
    stepId: string
    event: RunStepEventInput
  }): Promise<GoalRun>
  finishStep(options: FinishStepOptions): Promise<GoalRun>
  recoverStep(options: {
    goalKey: string
    runId: string
    stepId: string
    statusAfter: TaskStatus
    message?: RunStepMessageInput
  }): Promise<GoalRun | null>
}

export type RunHistoryObservedEntry =
  | {
      kind: 'message'
      goalKey: string
      runId: string
      taskRef: string
      taskKind: TaskKind
      stepId: string
      stepRole: AgentRole
      message: RunStepMessage
    }
  | {
      kind: 'transcript'
      goalKey: string
      runId: string
      taskRef: string
      taskKind: TaskKind
      stepId: string
      stepRole: AgentRole
      entry: RunTranscriptEntry
    }

export interface RunHistoryStoreObserver {
  onEntry(entry: RunHistoryObservedEntry): Promise<void> | void
}

export function createRunHistoryStore(
  rootDir = process.cwd(),
  observer?: RunHistoryStoreObserver,
): RunHistoryStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readGoalHistory(goalKey) {
      return readRunHistory(paths.runHistoryPath(goalKey), goalKey)
    },
    async readRun(goalKey, runId) {
      const history = await readRunHistory(paths.runHistoryPath(goalKey), goalKey)
      return history.runs.find((run) => run.runId === runId) ?? null
    },
    async listRuns(goalKey) {
      const history = await readRunHistory(paths.runHistoryPath(goalKey), goalKey)
      return history.runs.toReversed().map(toRunSummary)
    },
    async startStep(options) {
      const historyPath = paths.runHistoryPath(options.goalKey)
      const lockPath = `${historyPath}.lock`

      return withFileLock(lockPath, async () => {
        const history = await readRunHistory(historyPath, options.goalKey)
        const now = new Date().toISOString()
        const run = selectRunForStep(
          history,
          options.taskRef,
          options.taskKind,
          options.statusBefore,
          now,
          options.refs?.runId,
        )
        const stepId = options.refs?.stepId ?? crypto.randomUUID()
        const storedMessage = options.message ? createStoredMessage(options.message, now) : null
        run.steps.push({
          stepId,
          role: options.role,
          statusBefore: options.statusBefore,
          startedAt: now,
          outcome: 'running',
          transcript: [],
          messages: storedMessage ? [storedMessage] : [],
        })
        await writeRunHistory(historyPath, history)
        if (storedMessage) {
          await observer?.onEntry({
            kind: 'message',
            goalKey: options.goalKey,
            runId: run.runId,
            taskRef: options.taskRef,
            taskKind: options.taskKind,
            stepId,
            stepRole: options.role,
            message: storedMessage,
          })
        }
        return { runId: run.runId, stepId }
      })
    },
    async recordStepEvent(options) {
      const historyPath = paths.runHistoryPath(options.goalKey)
      const lockPath = `${historyPath}.lock`

      return withFileLock(lockPath, async () => {
        const history = await readRunHistory(historyPath, options.goalKey)
        const run = history.runs.find((item) => item.runId === options.runId)
        if (!run) {
          throw new Error(`Run not found: ${options.runId}`)
        }

        const step = run.steps.find((item) => item.stepId === options.stepId)
        if (!step) {
          throw new Error(`Step not found: ${options.stepId}`)
        }

        const now = new Date().toISOString()
        const observed = applyStepEvent(step, options.event, now)
        await writeRunHistory(historyPath, history)
        if (observed) {
          await observer?.onEntry({
            ...observed,
            goalKey: options.goalKey,
            runId: run.runId,
            taskRef: run.taskRef,
            taskKind: run.taskKind,
            stepId: step.stepId,
            stepRole: step.role,
          })
        }
        return run
      })
    },
    async finishStep(options) {
      const historyPath = paths.runHistoryPath(options.goalKey)
      const lockPath = `${historyPath}.lock`

      return withFileLock(lockPath, async () => {
        const history = await readRunHistory(historyPath, options.goalKey)
        const run = history.runs.find((item) => item.runId === options.runId)
        if (!run) {
          throw new Error(`Run not found: ${options.runId}`)
        }

        const step = run.steps.find((item) => item.stepId === options.stepId)
        if (!step) {
          throw new Error(`Step not found: ${options.stepId}`)
        }

        const now = new Date().toISOString()
        step.statusAfter = options.statusAfter
        step.endedAt = now
        step.outcome = options.outcome
        const storedMessage = options.message ? createStoredMessage(options.message, now) : null
        if (options.message) {
          step.messages.push(storedMessage!)
        }

        if (options.runStatus) {
          run.status = options.runStatus
          run.endedAt = now
          run.finalTaskStatus = options.statusAfter
          run.terminalOutcome = options.outcome === 'running' ? undefined : options.outcome
        }

        await writeRunHistory(historyPath, history)
        if (storedMessage) {
          await observer?.onEntry({
            kind: 'message',
            goalKey: options.goalKey,
            runId: run.runId,
            taskRef: run.taskRef,
            taskKind: run.taskKind,
            stepId: step.stepId,
            stepRole: step.role,
            message: storedMessage,
          })
        }
        return run
      })
    },
    async recoverStep(options) {
      const historyPath = paths.runHistoryPath(options.goalKey)
      const lockPath = `${historyPath}.lock`

      return withFileLock(lockPath, async () => {
        const history = await readRunHistory(historyPath, options.goalKey)
        const run = history.runs.find((item) => item.runId === options.runId)
        if (!run) {
          return null
        }

        const step = run.steps.find((item) => item.stepId === options.stepId)
        if (!step || step.outcome !== 'running') {
          return run
        }

        const now = new Date().toISOString()
        step.statusAfter = options.statusAfter
        step.endedAt = now
        step.outcome = 'system_error'
        const storedMessage = options.message ? createStoredMessage(options.message, now) : null
        if (storedMessage) {
          step.messages.push(storedMessage)
        }

        run.status = 'system_error'
        run.endedAt = now
        run.finalTaskStatus = options.statusAfter
        run.terminalOutcome = 'system_error'

        await writeRunHistory(historyPath, history)
        if (storedMessage) {
          await observer?.onEntry({
            kind: 'message',
            goalKey: options.goalKey,
            runId: run.runId,
            taskRef: run.taskRef,
            taskKind: run.taskKind,
            stepId: step.stepId,
            stepRole: step.role,
            message: storedMessage,
          })
        }
        return run
      })
    },
  }
}

async function readRunHistory(historyPath: string, goalKey: string): Promise<GoalRunHistory> {
  const file = Bun.file(historyPath)
  if (!(await file.exists())) {
    return emptyGoalRunHistory(goalKey)
  }

  const raw = await file.text()
  if (raw.trim() === '') {
    return emptyGoalRunHistory(goalKey)
  }

  return parseGoalRunHistory(raw)
}

async function writeRunHistory(historyPath: string, history: GoalRunHistory) {
  await mkdir(dirname(historyPath), { recursive: true })
  const tmpPath = `${historyPath}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(history, null, 2)}\n`)
  await rename(tmpPath, historyPath)
}

function selectRunForStep(
  history: GoalRunHistory,
  taskRef: string,
  taskKind: TaskKind,
  statusBefore: TaskStatus,
  startedAt: string,
  preferredRunId?: string,
) {
  const activeRuns = history.runs.filter((run) => run.taskRef === taskRef && run.status === 'active')

  if (statusBefore === 'planned') {
    orphanActiveRuns(activeRuns, startedAt)
    return createRun(history, taskRef, taskKind, startedAt, preferredRunId)
  }

  const existing = activeRuns.findLast((run) =>
    canContinueRunAtStatus(run, statusBefore),
  )
  if (existing) {
    orphanActiveRuns(
      activeRuns.filter((run) => run.runId !== existing.runId),
      startedAt,
    )
    return existing
  }

  orphanActiveRuns(activeRuns, startedAt)
  return createRun(history, taskRef, taskKind, startedAt, preferredRunId)
}

function createRun(
  history: GoalRunHistory,
  taskRef: string,
  taskKind: TaskKind,
  startedAt: string,
  runId?: string,
) {
  const resolvedRunId = runId ?? crypto.randomUUID()
  const run: GoalRun = {
    runId: resolvedRunId,
    taskRef,
    taskKind,
    startedAt,
    status: 'active',
    steps: [],
  }
  history.runs.push(run)
  return run
}

function canContinueRunAtStatus(run: GoalRun, statusBefore: TaskStatus) {
  return effectiveRunTaskStatus(run) === statusBefore
}

function effectiveRunTaskStatus(run: GoalRun): TaskStatus | null {
  const lastStep = run.steps.at(-1)
  if (!lastStep) {
    return null
  }

  return lastStep.statusAfter ?? lastStep.statusBefore
}

function orphanActiveRuns(runs: GoalRun[], endedAt: string) {
  for (const run of runs) {
    if (run.status !== 'active') {
      continue
    }

    run.status = 'system_error'
    run.endedAt = endedAt
    run.finalTaskStatus = effectiveRunTaskStatus(run) ?? run.finalTaskStatus
    run.terminalOutcome = 'system_error'

    for (const step of run.steps) {
      if (step.outcome !== 'running') {
        continue
      }

      step.outcome = 'system_error'
      step.endedAt = endedAt
      step.statusAfter ??= step.statusBefore
    }
  }
}

function applyStepEvent(
  step: GoalRun['steps'][number],
  event: RunStepEventInput,
  createdAt: string,
):
  | {
      kind: 'message'
      message: RunStepMessage
    }
  | {
      kind: 'transcript'
      entry: RunTranscriptEntry
    }
  | null {
  if (event.kind === 'transcript') {
    const entry = createStoredTranscript(
      {
        transport: event.transport,
        kind: event.entryKind,
        summary: event.summary,
        toolName: event.toolName,
        toolInvocationKey: event.toolInvocationKey,
        vendorEventType: event.vendorEventType,
      },
      createdAt,
    )
    step.transcript.push(entry)
    return {
      kind: 'transcript',
      entry,
    }
  }

  if (event.kind === 'message') {
    const message = createStoredMessage(
      {
        kind: event.level,
        role: event.role,
        content: event.content,
      },
      createdAt,
    )
    step.messages.push(message)
    return {
      kind: 'message',
      message,
    }
  }

  if (!step.execution) {
    step.execution = {
      artifacts: [],
    }
  }

  if (event.kind === 'worktree_prepared') {
    step.execution.worktree = {
      path: event.path,
      branch: event.branch,
      baseBranch: event.baseBranch,
    }
    return null
  }

  step.execution.artifacts.push({
    ref: event.ref,
    label: event.label,
  })
  return null
}
