import type { ReconcileResult } from '../scheduler/reconcileOnce'
import type {
  DurableAutomationStatus,
  ExecutionStateStore,
} from './executionStateStore'

type WorkerLoopState = {
  active: boolean
}

export type AutomationStatus = DurableAutomationStatus

export interface StartAutomationOptions {
  projectKey: string
  goalKey: string
  maxSteps?: number
  maxParallel?: number
  laneParallelism?: {
    in_progress?: number
    in_review?: number
    merging?: number
  }
  executeStep: () => Promise<ReconcileResult>
}

export class AutomationController {
  private readonly loops = new Map<string, WorkerLoopState>()

  constructor(private readonly execution: ExecutionStateStore) {}

  async getStatus(projectKey: string, goalKey: string): Promise<AutomationStatus> {
    return this.execution.readAutomationStatus(projectKey, goalKey)
  }

  async start(options: StartAutomationOptions): Promise<{
    status: AutomationStatus
    alreadyRunning: boolean
  }> {
    const started = await this.execution.startAutomation(options.projectKey, options.goalKey, {
      maxSteps: options.maxSteps,
      maxParallel: options.maxParallel,
      laneParallelism: options.laneParallelism,
    })
    this.ensureLoop(options)
    return started
  }

  async resumeIfEnabled(options: StartAutomationOptions): Promise<AutomationStatus | null> {
    const resumed = await this.execution.resumeAutomation(options.projectKey, options.goalKey)
    if (!resumed) {
      return null
    }
    this.ensureLoop(options)
    return resumed
  }

  async stop(projectKey: string, goalKey: string): Promise<AutomationStatus> {
    return this.execution.stopAutomation(projectKey, goalKey)
  }

  private ensureLoop(options: StartAutomationOptions) {
    const key = runKey(options.projectKey, options.goalKey)
    const current = this.loops.get(key)
    if (current?.active) {
      return
    }

    const loop: WorkerLoopState = { active: true }
    this.loops.set(key, loop)
    void this.runLoop(key, loop, options)
  }

  private async runLoop(
    key: string,
    loop: WorkerLoopState,
    options: StartAutomationOptions,
  ) {
    try {
      while (true) {
        const status = await this.execution.readAutomationStatus(options.projectKey, options.goalKey)
        if (status.state !== 'running') {
          break
        }
        const roundResults = await Promise.all(
          Array.from({ length: status.maxParallel }, () => this.runWorker(options)),
        )

        const current = await this.execution.readAutomationStatus(options.projectKey, options.goalKey)
        if (current.state !== 'running') {
          break
        }

        if (!current.reconcileEnabled) {
          await this.execution.completeAutomation(options.projectKey, options.goalKey, {
            state: 'idle',
          })
          break
        }

        if (current.activeSessionCount > 0) {
          break
        }

        if (current.stepCount >= current.maxSteps && current.lastResult?.kind !== 'idle') {
          await this.execution.completeAutomation(options.projectKey, options.goalKey, {
            state: 'failed',
            error: `Automation reached the safety limit of ${current.maxSteps} steps.`,
          })
          break
        }

        if (!roundResults.some((result) => result === 'advanced')) {
          await this.execution.completeAutomation(options.projectKey, options.goalKey, {
            state: 'idle',
          })
          break
        }
      }
    } catch (error) {
      await this.execution.completeAutomation(options.projectKey, options.goalKey, {
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      loop.active = false
      if (this.loops.get(key) === loop) {
        this.loops.delete(key)
      }
    }
  }

  private async runWorker(options: StartAutomationOptions) {
    let advanced = false
    while (await this.execution.recordAutomationWorkerClaim(options.projectKey, options.goalKey)) {
      const result = await options.executeStep()
      await this.execution.recordAutomationResult(options.projectKey, options.goalKey, result)

      if (result.kind === 'idle') {
        return advanced ? 'advanced' : 'idle'
      }

      if (result.kind === 'blocked') {
        await this.execution.completeAutomation(options.projectKey, options.goalKey, {
          state: 'blocked',
        })
        return 'blocked'
      }

      advanced = true
    }

    return advanced ? 'advanced' : 'idle'
  }
}

function runKey(projectKey: string, goalKey: string) {
  return `${projectKey}:${goalKey}`
}
