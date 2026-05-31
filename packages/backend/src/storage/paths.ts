import { join } from 'node:path'

export interface ProjectPaths {
  rootDir: string
  goalDir(goalKey: string): string
  todoPath(goalKey: string): string
  eventsPath(goalKey: string): string
  lockPath(goalKey: string): string
  runtimeDir(): string
  attemptsPath(): string
}

export function createProjectPaths(rootDir = process.cwd()): ProjectPaths {
  return {
    rootDir,
    goalDir(goalKey: string) {
      return join(rootDir, '.hopi', 'docs', 'goals', goalKey)
    },
    todoPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'todo.yml')
    },
    eventsPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'events.jsonl')
    },
    lockPath(goalKey: string) {
      return join(this.goalDir(goalKey), 'todo.yml.lock')
    },
    runtimeDir() {
      return join(rootDir, '.hopi', 'runtime')
    },
    attemptsPath() {
      return join(this.runtimeDir(), 'attempts.json')
    },
  }
}
