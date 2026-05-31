import type { TaskKind } from '../domain/board'

export type AgentRole = 'planner' | 'generator' | 'reviewer' | 'merger'

export type AgentOutcome =
  | { kind: 'success'; artifactRef?: string }
  | { kind: 'reject'; artifactRef?: string; reason: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'timeout'; reason: string }
  | { kind: 'merge_conflict'; artifactRef: string }

export interface AgentStepInput {
  goalKey: string
  taskRef: string
  taskKind: TaskKind
  role: AgentRole
}

export interface AgentRunner {
  run(input: AgentStepInput): Promise<AgentOutcome>
}

export class MockAgentRunner implements AgentRunner {
  private readonly plan: Record<string, AgentOutcome[]>

  constructor(plan: Record<string, AgentOutcome[]> = {}) {
    this.plan = Object.fromEntries(
      Object.entries(plan).map(([key, outcomes]) => [key, [...outcomes]]),
    )
  }

  async run(input: AgentStepInput): Promise<AgentOutcome> {
    const key = outcomeKey(input.taskRef, input.role)
    return this.plan[key]?.shift() ?? { kind: 'success' }
  }
}

function outcomeKey(taskRef: string, role: AgentRole) {
  return `${taskRef}:${role}`
}
