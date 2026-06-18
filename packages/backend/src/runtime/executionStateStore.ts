import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AgentRole } from '../agent/AgentRunner'
import type { TaskKind, TaskStatus } from '../domain/board'
import { withFileLock } from '../storage/lock'
import { createProjectPaths } from '../storage/paths'
import {
  DEFAULT_LANE_PARALLELISM,
  type ExecutionLane,
  type LaneParallelism,
  type LaneParallelismInput,
  normalizeLaneParallelism,
  totalLaneParallelism,
} from './laneParallelism'

export type ExecutionAutomationState = 'idle' | 'running' | 'blocked' | 'failed'
export type ExecutionStepState =
  | 'claimed'
  | 'running'
  | 'interrupted'
  | 'succeeded'
  | 'rejected'
  | 'merge_conflict'
  | 'failed'
  | 'timed_out'
  | 'system_error'

export type StoredReconcileResult =
  | { kind: 'idle' }
  | { kind: 'advanced'; taskRef: string; from: TaskStatus; to: TaskStatus }
  | { kind: 'blocked'; taskRef: string; blocker: { kind: string; ref: string } }

export interface ExecutionStepRecord {
  executionId: string
  taskRef: string
  taskKind: TaskKind
  role: AgentRole
  lane: ExecutionLane
  statusBefore: TaskStatus
  state: ExecutionStepState
  workerId: string
  startedAt: string
  heartbeatAt: string
  runId?: string
  stepId?: string
}

export interface ExecutionAutomationRecord {
  state: ExecutionAutomationState
  startedAt?: string
  endedAt?: string
  stepCount: number
  startedStepCount: number
  maxSteps: number
  maxParallel: number
  laneParallelism: LaneParallelism
  lastResult?: StoredReconcileResult
  error?: string
  reconcileEnabled: boolean
  updatedAt: string
}

interface GoalExecutionState {
  version: 1
  goalKey: string
  automation: ExecutionAutomationRecord
  activeSteps: ExecutionStepRecord[]
}

export interface GoalExecutionOverlayTask {
  taskRef: string
  role: AgentRole
  lane: ExecutionLane
  startedAt: string
  runId?: string
  stepId?: string
}

export interface DurableAutomationStatus {
  projectKey: string
  goalKey: string
  state: ExecutionAutomationState
  startedAt?: string
  endedAt?: string
  stepCount: number
  maxSteps: number
  maxParallel: number
  laneParallelism: LaneParallelism
  lastResult?: StoredReconcileResult
  error?: string
  reconcileEnabled: boolean
  activeSessionCount: number
  staleSessionCount: number
  updatedAt: string
}

export interface ActiveExecutionLease {
  executionId: string
  taskRef: string
  role: AgentRole
  lane: ExecutionLane
  startedAt: string
}

export interface RecoveredExecutionStep {
  executionId: string
  taskRef: string
  role: AgentRole
  lane: ExecutionLane
  statusBefore: TaskStatus
  runId?: string
  stepId?: string
}

export interface ExecutionStateStoreObserver {
  onGoalExecutionChanged?(goalKey: string): Promise<void> | void
  onAutomationChanged?(goalKey: string, status: DurableAutomationStatus): Promise<void> | void
}

export interface ExecutionStateStore {
  readAutomationStatus(projectKey: string, goalKey: string): Promise<DurableAutomationStatus>
  startAutomation(
    projectKey: string,
    goalKey: string,
    options?: { maxSteps?: number; maxParallel?: number; laneParallelism?: LaneParallelismInput },
  ): Promise<{ status: DurableAutomationStatus; alreadyRunning: boolean }>
  resumeAutomation(
    projectKey: string,
    goalKey: string,
  ): Promise<DurableAutomationStatus | null>
  stopAutomation(projectKey: string, goalKey: string): Promise<DurableAutomationStatus>
  completeAutomation(
    projectKey: string,
    goalKey: string,
    options: { state: ExecutionAutomationState; error?: string; endedAt?: string },
  ): Promise<DurableAutomationStatus>
  recordAutomationWorkerClaim(
    projectKey: string,
    goalKey: string,
  ): Promise<DurableAutomationStatus | null>
  recordAutomationResult(
    projectKey: string,
    goalKey: string,
    result: StoredReconcileResult,
  ): Promise<DurableAutomationStatus>
  listActiveTaskExecutions(goalKey: string): Promise<GoalExecutionOverlayTask[]>
  acquireTaskExecution(options: {
    goalKey: string
    taskRef: string
    taskKind: TaskKind
    role: AgentRole
    lane: ExecutionLane
    statusBefore: TaskStatus
    workerId: string
    laneLimit?: number
    roleLimit?: number
  }): Promise<ActiveExecutionLease | null>
  bindRunStepRefs(
    goalKey: string,
    executionId: string,
    refs: { runId: string; stepId: string },
  ): Promise<void>
  heartbeatTaskExecution(goalKey: string, executionId: string): Promise<void>
  finishTaskExecution(options: {
    goalKey: string
    executionId: string
    outcome: ExecutionStepState
  }): Promise<void>
  recoverStaleTaskExecutions(options: {
    goalKey: string
    activeWorkerIds: Set<string>
    stepStaleMs: number
  }): Promise<RecoveredExecutionStep[]>
}

const DEFAULT_MAX_STEPS = 20

const reconcileResultSchema: z.ZodType<StoredReconcileResult> = z.union([
  z.object({ kind: z.literal('idle') }),
  z.object({
    kind: z.literal('advanced'),
    taskRef: z.string().min(1),
    from: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
    to: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
  }),
  z.object({
    kind: z.literal('blocked'),
    taskRef: z.string().min(1),
    blocker: z.object({
      kind: z.string().min(1),
      ref: z.string().min(1),
    }),
  }),
])

const executionStepSchema: z.ZodType<ExecutionStepRecord> = z.object({
  executionId: z.string().min(1),
  taskRef: z.string().min(1),
  taskKind: z.enum(['planning', 'engineering']),
  role: z.enum(['planner', 'generator', 'reviewer', 'merger']),
  lane: z.enum(['in_progress', 'in_review', 'merging']),
  statusBefore: z.enum(['planned', 'in_progress', 'in_review', 'merging', 'done']),
  state: z.enum([
    'claimed',
    'running',
    'interrupted',
    'succeeded',
    'rejected',
    'merge_conflict',
    'failed',
    'timed_out',
    'system_error',
  ]),
  workerId: z.string().min(1),
  startedAt: z.string().datetime(),
  heartbeatAt: z.string().datetime(),
  runId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
})

const goalExecutionStateSchema = z.object({
  version: z.literal(1),
  goalKey: z.string().min(1),
  automation: z.object({
    state: z.enum(['idle', 'running', 'blocked', 'failed']),
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().optional(),
    stepCount: z.number().int().min(0),
    startedStepCount: z.number().int().min(0),
    maxSteps: z.number().int().min(1),
    maxParallel: z.number().int().min(1),
    laneParallelism: z.object({
      in_progress: z.number().int().min(1),
      in_review: z.number().int().min(1),
      merging: z.number().int().min(1),
    }),
    lastResult: reconcileResultSchema.optional(),
    error: z.string().min(1).optional(),
    reconcileEnabled: z.boolean(),
    updatedAt: z.string().datetime(),
  }),
  activeSteps: z.array(executionStepSchema),
})

function emptyGoalExecutionState(goalKey: string): GoalExecutionState {
  const now = new Date().toISOString()
  return {
    version: 1,
    goalKey,
    automation: {
      state: 'idle',
      stepCount: 0,
      startedStepCount: 0,
      maxSteps: DEFAULT_MAX_STEPS,
      maxParallel: totalLaneParallelism(DEFAULT_LANE_PARALLELISM),
      laneParallelism: { ...DEFAULT_LANE_PARALLELISM },
      reconcileEnabled: false,
      updatedAt: now,
    },
    activeSteps: [],
  }
}

export function createExecutionStateStore(
  rootDir = process.cwd(),
  observer?: ExecutionStateStoreObserver,
): ExecutionStateStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readAutomationStatus(projectKey, goalKey) {
      const state = await readGoalExecutionState(paths.executionStatePath(goalKey), goalKey)
      return toAutomationStatus(projectKey, goalKey, state)
    },
    async startAutomation(projectKey, goalKey, options) {
      const state = await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        const now = new Date().toISOString()
        const laneParallelism = normalizeLaneParallelism(
          options?.laneParallelism,
          options?.maxParallel,
        )
        const maxParallel = totalLaneParallelism(laneParallelism)
        const alreadyRunning = current.automation.state === 'running'
        const isFreshStart = !alreadyRunning
        current.automation = {
          ...current.automation,
          state: 'running',
          startedAt: alreadyRunning ? current.automation.startedAt ?? now : now,
          endedAt: undefined,
          stepCount: isFreshStart ? 0 : current.automation.stepCount,
          startedStepCount: isFreshStart ? 0 : current.automation.startedStepCount,
          lastResult: isFreshStart ? undefined : current.automation.lastResult,
          error: undefined,
          maxSteps: options?.maxSteps ?? current.automation.maxSteps ?? DEFAULT_MAX_STEPS,
          laneParallelism,
          maxParallel,
          reconcileEnabled: true,
          updatedAt: now,
        }
        return { alreadyRunning }
      })
      const status = await this.readAutomationStatus(projectKey, goalKey)
      await observer?.onAutomationChanged?.(goalKey, status)
      return { status, alreadyRunning: state.alreadyRunning }
    },
    async resumeAutomation(projectKey, goalKey) {
      const outcome = await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        if (
          current.automation.state !== 'running' &&
          !(current.automation.reconcileEnabled && current.automation.state === 'idle')
        ) {
          return { resumed: false }
        }
        if (!current.automation.reconcileEnabled) {
          return { resumed: false }
        }
        if (current.automation.state === 'running') {
          return { resumed: true, changed: false }
        }
        current.automation = {
          ...current.automation,
          state: 'running',
          endedAt: undefined,
          error: undefined,
          updatedAt: new Date().toISOString(),
        }
        return { resumed: true, changed: true }
      })
      if (!outcome.resumed) {
        return null
      }
      const status = await this.readAutomationStatus(projectKey, goalKey)
      if (outcome.changed) {
        await observer?.onAutomationChanged?.(goalKey, status)
      }
      return status
    },
    async stopAutomation(projectKey, goalKey) {
      await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        current.automation = {
          ...current.automation,
          reconcileEnabled: false,
          updatedAt: new Date().toISOString(),
        }
        return null
      })
      const status = await this.readAutomationStatus(projectKey, goalKey)
      await observer?.onAutomationChanged?.(goalKey, status)
      return status
    },
    async completeAutomation(projectKey, goalKey, options) {
      await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        current.automation = {
          ...current.automation,
          state: options.state,
          error: options.error,
          endedAt: options.endedAt ?? new Date().toISOString(),
          reconcileEnabled: false,
          updatedAt: new Date().toISOString(),
        }
        return null
      })
      const status = await this.readAutomationStatus(projectKey, goalKey)
      await observer?.onAutomationChanged?.(goalKey, status)
      return status
    },
    async recordAutomationWorkerClaim(projectKey, goalKey) {
      const outcome = await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        if (
          current.automation.state !== 'running' ||
          !current.automation.reconcileEnabled ||
          current.automation.startedStepCount >= current.automation.maxSteps
        ) {
          return { claimed: false }
        }
        current.automation = {
          ...current.automation,
          startedStepCount: current.automation.startedStepCount + 1,
          updatedAt: new Date().toISOString(),
        }
        return { claimed: true }
      })
      if (!outcome.claimed) {
        return null
      }
      const status = await this.readAutomationStatus(projectKey, goalKey)
      await observer?.onAutomationChanged?.(goalKey, status)
      return status
    },
    async recordAutomationResult(projectKey, goalKey, result) {
      await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        current.automation = {
          ...current.automation,
          stepCount: current.automation.stepCount + 1,
          lastResult: result,
          updatedAt: new Date().toISOString(),
        }
        return null
      })
      const status = await this.readAutomationStatus(projectKey, goalKey)
      await observer?.onAutomationChanged?.(goalKey, status)
      return status
    },
    async listActiveTaskExecutions(goalKey) {
      const state = await readGoalExecutionState(paths.executionStatePath(goalKey), goalKey)
      return state.activeSteps
        .filter((step) => step.state === 'claimed' || step.state === 'running')
        .map((step) => ({
          taskRef: step.taskRef,
          role: step.role,
          lane: step.lane,
          startedAt: step.startedAt,
          runId: step.runId,
          stepId: step.stepId,
        }))
    },
    async acquireTaskExecution(options) {
      const outcome = await mutateGoalExecutionState(paths.executionStatePath(options.goalKey), options.goalKey, (current) => {
        const activeSteps = current.activeSteps.filter((step) =>
          step.state === 'claimed' || step.state === 'running',
        )
        if (activeSteps.some((step) => step.taskRef === options.taskRef)) {
          return { claimed: null }
        }
        if (activeSteps.filter((step) => step.lane === options.lane).length >= (options.laneLimit ?? 1)) {
          return { claimed: null }
        }
        if (
          options.roleLimit !== undefined &&
          activeSteps.filter((step) => step.role === options.role).length >= options.roleLimit
        ) {
          return { claimed: null }
        }
        const now = new Date().toISOString()
        const execution: ExecutionStepRecord = {
          executionId: crypto.randomUUID(),
          taskRef: options.taskRef,
          taskKind: options.taskKind,
          role: options.role,
          lane: options.lane,
          statusBefore: options.statusBefore,
          state: 'claimed',
          workerId: options.workerId,
          startedAt: now,
          heartbeatAt: now,
        }
        current.activeSteps.push(execution)
        current.automation.updatedAt = now
        return { claimed: execution }
      })
      if (!outcome.claimed) {
        return null
      }
      await observer?.onGoalExecutionChanged?.(options.goalKey)
      return {
        executionId: outcome.claimed.executionId,
        taskRef: outcome.claimed.taskRef,
        role: outcome.claimed.role,
        lane: outcome.claimed.lane,
        startedAt: outcome.claimed.startedAt,
      }
    },
    async bindRunStepRefs(goalKey, executionId, refs) {
      await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        const step = current.activeSteps.find((entry) => entry.executionId === executionId)
        if (!step) {
          return null
        }
        step.runId = refs.runId
        step.stepId = refs.stepId
        step.state = 'running'
        step.heartbeatAt = new Date().toISOString()
        current.automation.updatedAt = step.heartbeatAt
        return null
      })
      await observer?.onGoalExecutionChanged?.(goalKey)
    },
    async heartbeatTaskExecution(goalKey, executionId) {
      await mutateGoalExecutionState(paths.executionStatePath(goalKey), goalKey, (current) => {
        const step = current.activeSteps.find((entry) => entry.executionId === executionId)
        if (!step) {
          return null
        }
        step.heartbeatAt = new Date().toISOString()
        if (step.state === 'claimed') {
          step.state = 'running'
        }
        current.automation.updatedAt = step.heartbeatAt
        return null
      })
    },
    async finishTaskExecution(options) {
      await mutateGoalExecutionState(paths.executionStatePath(options.goalKey), options.goalKey, (current) => {
        const index = current.activeSteps.findIndex((entry) => entry.executionId === options.executionId)
        if (index === -1) {
          return null
        }
        current.activeSteps.splice(index, 1)
        current.automation.updatedAt = new Date().toISOString()
        return null
      })
      await observer?.onGoalExecutionChanged?.(options.goalKey)
    },
    async recoverStaleTaskExecutions(options) {
      const staleBefore = Date.now() - options.stepStaleMs
      const recovered = await mutateGoalExecutionState(paths.executionStatePath(options.goalKey), options.goalKey, (current) => {
        const stale: RecoveredExecutionStep[] = []
        current.activeSteps = current.activeSteps.filter((step) => {
          const heartbeatAt = new Date(step.heartbeatAt).getTime()
          const workerActive = options.activeWorkerIds.has(step.workerId)
          const isStale = !workerActive || !Number.isFinite(heartbeatAt) || heartbeatAt < staleBefore
          if (!isStale) {
            return true
          }
          stale.push({
            executionId: step.executionId,
            taskRef: step.taskRef,
            role: step.role,
            lane: step.lane,
            statusBefore: step.statusBefore,
            runId: step.runId,
            stepId: step.stepId,
          })
          return false
        })
        if (stale.length > 0) {
          current.automation.updatedAt = new Date().toISOString()
        }
        return stale
      })
      if (recovered.length > 0) {
        await observer?.onGoalExecutionChanged?.(options.goalKey)
      }
      return recovered
    },
  }
}

export type WorkerLeaseRecord = {
  workerId: string
  pid: number
  heartbeatAt: string
  startedAt: string
}

interface WorkerLeaseFile {
  version: 1
  workers: WorkerLeaseRecord[]
}

const workerLeaseFileSchema: z.ZodType<WorkerLeaseFile> = z.object({
  version: z.literal(1),
  workers: z.array(
    z.object({
      workerId: z.string().min(1),
      pid: z.number().int().min(0),
      heartbeatAt: z.string().datetime(),
      startedAt: z.string().datetime(),
    }),
  ),
})

export interface WorkerLeaseStore {
  heartbeat(workerId: string): Promise<void>
  activeWorkerIds(staleMs: number): Promise<Set<string>>
}

export function createWorkerLeaseStore(rootDir = process.cwd()): WorkerLeaseStore {
  const paths = createProjectPaths(rootDir)

  return {
    async heartbeat(workerId) {
      await mutateWorkerLeaseFile(paths.workerLeasesPath(), (current) => {
        const now = new Date().toISOString()
        const existing = current.workers.find((worker) => worker.workerId === workerId)
        if (existing) {
          existing.heartbeatAt = now
          return null
        }
        current.workers.push({
          workerId,
          pid: process.pid,
          heartbeatAt: now,
          startedAt: now,
        })
        return null
      })
    },
    async activeWorkerIds(staleMs) {
      const now = Date.now()
      const file = await mutateWorkerLeaseFile(paths.workerLeasesPath(), (current) => {
        current.workers = current.workers.filter(
          (worker) => now - new Date(worker.heartbeatAt).getTime() <= staleMs,
        )
        return current
      })
      return new Set(file.workers.map((worker) => worker.workerId))
    },
  }
}

async function readGoalExecutionState(path: string, goalKey: string): Promise<GoalExecutionState> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return emptyGoalExecutionState(goalKey)
  }
  const raw = await file.text()
  if (raw.trim() === '') {
    return emptyGoalExecutionState(goalKey)
  }
  return goalExecutionStateSchema.parse(JSON.parse(raw))
}

async function mutateGoalExecutionState<T>(
  path: string,
  goalKey: string,
  mutate: (state: GoalExecutionState) => T,
) {
  const lockPath = `${path}.lock`
  return withFileLock(lockPath, async () => {
    const current = await readGoalExecutionState(path, goalKey)
    const result = mutate(current)
    await writeJsonFile(path, current)
    return result
  })
}

async function readWorkerLeaseFile(path: string): Promise<WorkerLeaseFile> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return {
      version: 1,
      workers: [],
    }
  }
  const raw = await file.text()
  if (raw.trim() === '') {
    return {
      version: 1,
      workers: [],
    }
  }
  return workerLeaseFileSchema.parse(JSON.parse(raw))
}

async function mutateWorkerLeaseFile<T>(
  path: string,
  mutate: (file: WorkerLeaseFile) => T,
) {
  const lockPath = `${path}.lock`
  return withFileLock(lockPath, async () => {
    const current = await readWorkerLeaseFile(path)
    const result = mutate(current)
    await writeJsonFile(path, current)
    return result
  })
}

async function writeJsonFile(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp.${crypto.randomUUID()}`
  await Bun.write(tmpPath, `${JSON.stringify(value, null, 2)}\n`)
  await rename(tmpPath, path)
}

function toAutomationStatus(
  projectKey: string,
  goalKey: string,
  state: GoalExecutionState,
): DurableAutomationStatus {
  const staleCutoff = Date.now() - 45_000
  const staleSessionCount = state.activeSteps.filter(
    (step) => new Date(step.heartbeatAt).getTime() < staleCutoff,
  ).length
  return {
    projectKey,
    goalKey,
    state: state.automation.state,
    startedAt: state.automation.startedAt,
    endedAt: state.automation.endedAt,
    stepCount: state.automation.stepCount,
    maxSteps: state.automation.maxSteps,
    maxParallel: state.automation.maxParallel,
    laneParallelism: { ...state.automation.laneParallelism },
    lastResult: state.automation.lastResult,
    error: state.automation.error,
    reconcileEnabled: state.automation.reconcileEnabled,
    activeSessionCount: state.activeSteps.length,
    staleSessionCount,
    updatedAt: state.automation.updatedAt,
  }
}
