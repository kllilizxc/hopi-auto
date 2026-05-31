import { join } from 'node:path'

export interface ProjectPaths {
  rootDir: string
  goalDir(goalKey: string): string
  goalMarkdownPath(goalKey: string): string
  designMarkdownPath(goalKey: string): string
  todoPath(goalKey: string): string
  decisionsPath(goalKey: string): string
  eventsPath(goalKey: string): string
  writeTracePath(goalKey: string): string
  preferencePath(): string
  lockPath(goalKey: string): string
  runtimeDir(): string
  adapterConfigPath(): string
  runtimeGoalDir(goalKey: string): string
  assistantThreadPath(goalKey: string): string
  assistantRunsDir(goalKey: string): string
  assistantRunDir(goalKey: string, assistantRunId: string): string
  assistantContextPath(goalKey: string, assistantRunId: string): string
  assistantPromptPath(goalKey: string, assistantRunId: string): string
  assistantOutcomePath(goalKey: string, assistantRunId: string): string
  assistantResultPath(goalKey: string, assistantRunId: string): string
  runtimeRunDir(goalKey: string, runId: string): string
  runtimeStepDir(goalKey: string, runId: string, stepId: string): string
  runtimeContextPath(goalKey: string, runId: string, stepId: string): string
  runtimePromptPath(goalKey: string, runId: string, stepId: string): string
  runtimeOutcomePath(goalKey: string, runId: string, stepId: string): string
  attemptsPath(): string
  runHistoryPath(goalKey: string): string
  worktreesDir(): string
  worktreePath(goalKey: string, taskRef: string, runId: string): string
}

export function createProjectPaths(rootDir = process.cwd()): ProjectPaths {
  return {
    rootDir,
    goalDir(goalKey: string) {
      return join(rootDir, '.hopi', 'docs', 'goals', goalKey)
    },
    goalMarkdownPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'goal.md')
    },
    designMarkdownPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'design.md')
    },
    todoPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'todo.yml')
    },
    decisionsPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'decisions.yml')
    },
    eventsPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'events.jsonl')
    },
    writeTracePath(goalKey: string) {
      return join(this.goalDir(goalKey), 'write-trace.jsonl')
    },
    preferencePath() {
      return join(rootDir, '.hopi', 'preference.md')
    },
    lockPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'todo.yml.lock')
    },
    runtimeDir() {
      return join(rootDir, '.hopi', 'runtime')
    },
    adapterConfigPath() {
      return join(this.runtimeDir(), 'agent-adapters.json')
    },
    runtimeGoalDir(goalKey: string) {
      return join(this.runtimeDir(), 'goals', goalKey)
    },
    assistantThreadPath(goalKey: string) {
      return join(this.runtimeGoalDir(goalKey), 'assistant-thread.json')
    },
    assistantRunsDir(goalKey: string) {
      return join(this.runtimeGoalDir(goalKey), 'assistant', 'runs')
    },
    assistantRunDir(goalKey: string, assistantRunId: string) {
      return join(this.assistantRunsDir(goalKey), assistantRunId)
    },
    assistantContextPath(goalKey: string, assistantRunId: string) {
      return join(this.assistantRunDir(goalKey, assistantRunId), 'context.md')
    },
    assistantPromptPath(goalKey: string, assistantRunId: string) {
      return join(this.assistantRunDir(goalKey, assistantRunId), 'prompt.md')
    },
    assistantOutcomePath(goalKey: string, assistantRunId: string) {
      return join(this.assistantRunDir(goalKey, assistantRunId), 'outcome.json')
    },
    assistantResultPath(goalKey: string, assistantRunId: string) {
      return join(this.assistantRunDir(goalKey, assistantRunId), 'result.json')
    },
    runtimeRunDir(goalKey: string, runId: string) {
      return join(this.runtimeGoalDir(goalKey), 'runs', runId)
    },
    runtimeStepDir(goalKey: string, runId: string, stepId: string) {
      return join(this.runtimeRunDir(goalKey, runId), stepId)
    },
    runtimeContextPath(goalKey: string, runId: string, stepId: string) {
      return join(this.runtimeStepDir(goalKey, runId, stepId), 'context.md')
    },
    runtimePromptPath(goalKey: string, runId: string, stepId: string) {
      return join(this.runtimeStepDir(goalKey, runId, stepId), 'prompt.md')
    },
    runtimeOutcomePath(goalKey: string, runId: string, stepId: string) {
      return join(this.runtimeStepDir(goalKey, runId, stepId), 'outcome.json')
    },
    attemptsPath() {
      return join(this.runtimeDir(), 'attempts.json')
    },
    runHistoryPath(goalKey: string) {
      return join(this.runtimeGoalDir(goalKey), 'run-history.json')
    },
    worktreesDir() {
      return join(rootDir, '.hopi', 'worktrees')
    },
    worktreePath(goalKey: string, taskRef: string, runId: string) {
      return join(this.worktreesDir(), goalKey, taskRef, runId)
    },
  }
}
