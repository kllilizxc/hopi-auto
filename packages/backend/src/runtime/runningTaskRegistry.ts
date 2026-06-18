import type { AgentRole } from '../agent/AgentRunner'
import type { ExecutionLane } from './laneParallelism'

export interface RunningTask {
  goalKey: string
  taskRef: string
  role: AgentRole
  lane: ExecutionLane
  startedAt: string
}

export interface RunningTaskLease extends RunningTask {
  release(): void
}

export interface RunningTaskRegistryEvent {
  rootDir: string
  goalKey: string
  task?: RunningTask
}

export class RunningTaskRegistry {
  private readonly tasks = new Map<string, RunningTask>()

  constructor(
    private readonly onChange?: (event: RunningTaskRegistryEvent) => void,
  ) {}

  acquire(input: {
    rootDir: string
    goalKey: string
    taskRef: string
    role: AgentRole
    lane: ExecutionLane
    laneLimit?: number
    roleLimit?: number
  }): RunningTaskLease | null {
    const taskKey = registryTaskKey(input.rootDir, input.goalKey, input.taskRef)
    const laneLimit = input.laneLimit ?? 1
    const roleLimit = input.roleLimit
    if (
      this.tasks.has(taskKey) ||
      this.countLane(input.rootDir, input.goalKey, input.lane) >= laneLimit ||
      (roleLimit !== undefined && this.countRole(input.rootDir, input.goalKey, input.role) >= roleLimit)
    ) {
      return null
    }

    const task: RunningTask = {
      goalKey: input.goalKey,
      taskRef: input.taskRef,
      role: input.role,
      lane: input.lane,
      startedAt: new Date().toISOString(),
    }
    this.tasks.set(taskKey, task)
    this.onChange?.({
      rootDir: input.rootDir,
      goalKey: input.goalKey,
      task,
    })

    let released = false
    return {
      ...task,
      release: () => {
        if (released) {
          return
        }
        released = true
        if (this.tasks.get(taskKey) === task) {
          this.tasks.delete(taskKey)
          this.onChange?.({
            rootDir: input.rootDir,
            goalKey: input.goalKey,
          })
        }
      },
    }
  }

  get(rootDir: string, goalKey: string): RunningTask | undefined {
    return this.list(rootDir, goalKey)[0]
  }

  list(rootDir: string, goalKey: string): RunningTask[] {
    const prefix = `${registryGoalKey(rootDir, goalKey)}:`
    return [...this.tasks.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, task]) => task)
  }

  count(rootDir: string, goalKey: string): number {
    return this.list(rootDir, goalKey).length
  }

  countLane(rootDir: string, goalKey: string, lane: ExecutionLane): number {
    return this.list(rootDir, goalKey).filter((task) => task.lane === lane).length
  }

  countRole(rootDir: string, goalKey: string, role: AgentRole): number {
    return this.list(rootDir, goalKey).filter((task) => task.role === role).length
  }

  isRunning(rootDir: string, goalKey: string, taskRef: string): boolean {
    return this.tasks.has(registryTaskKey(rootDir, goalKey, taskRef))
  }
}

function registryGoalKey(rootDir: string, goalKey: string) {
  return `${rootDir}:${goalKey}`
}

function registryTaskKey(rootDir: string, goalKey: string, taskRef: string) {
  return `${registryGoalKey(rootDir, goalKey)}:${taskRef}`
}
