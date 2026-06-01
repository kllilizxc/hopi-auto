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
}

export function createRunHistoryStore(rootDir = process.cwd()): RunHistoryStore {
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
        )
        const stepId = crypto.randomUUID()
        run.steps.push({
          stepId,
          role: options.role,
          statusBefore: options.statusBefore,
          startedAt: now,
          outcome: 'running',
          transcript: [],
          messages: options.message ? [createStoredMessage(options.message, now)] : [],
        })
        await writeRunHistory(historyPath, history)
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
        applyStepEvent(step, options.event, now)
        await writeRunHistory(historyPath, history)
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
        if (options.message) {
          step.messages.push(createStoredMessage(options.message, now))
        }

        if (options.runStatus) {
          run.status = options.runStatus
          run.endedAt = now
          run.finalTaskStatus = options.statusAfter
          run.terminalOutcome = options.outcome === 'running' ? undefined : options.outcome
        }

        await writeRunHistory(historyPath, history)
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
) {
  if (statusBefore === 'planned') {
    return createRun(history, taskRef, taskKind, startedAt)
  }

  const existing = history.runs.findLast(
    (run) => run.taskRef === taskRef && run.status === 'active',
  )
  return existing ?? createRun(history, taskRef, taskKind, startedAt)
}

function createRun(
  history: GoalRunHistory,
  taskRef: string,
  taskKind: TaskKind,
  startedAt: string,
) {
  const run: GoalRun = {
    runId: crypto.randomUUID(),
    taskRef,
    taskKind,
    startedAt,
    status: 'active',
    steps: [],
  }
  history.runs.push(run)
  return run
}

function applyStepEvent(
  step: GoalRun['steps'][number],
  event: RunStepEventInput,
  createdAt: string,
) {
  if (event.kind === 'transcript') {
    step.transcript.push(
      createStoredTranscript(
        {
          transport: event.transport,
          kind: event.entryKind,
          summary: event.summary,
          toolName: event.toolName,
          toolInvocationKey: event.toolInvocationKey,
          vendorEventType: event.vendorEventType,
        },
        createdAt,
      ),
    )
    return
  }

  if (event.kind === 'message') {
    step.messages.push(
      createStoredMessage(
        {
          kind: event.level,
          role: event.role,
          content: event.content,
        },
        createdAt,
      ),
    )
    return
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
    return
  }

  step.execution.artifacts.push({
    ref: event.ref,
    label: event.label,
  })
}
