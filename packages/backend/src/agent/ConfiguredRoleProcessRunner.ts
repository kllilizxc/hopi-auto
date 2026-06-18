import {
  type RoleProcessContextBuilder,
  createRoleProcessContextBuilder,
} from '../runtime/roleProcessContext'
import { type WorktreeManager, createWorktreeManager } from '../runtime/worktreeManager'
import { type BoardStore, createBoardStore } from '../storage/boardStore'
import { createProjectPaths } from '../storage/paths'
import type { AgentRunObserver, AgentRunner, AgentStepInput } from './AgentRunner'
import { type ProcessAgentCommand, ProcessAgentRunner } from './ProcessAgentRunner'
import { readAndMigrateAgentAdapterConfig, resolveRoleTransportConfig } from './adapterConfig'
import { resolveConfiguredTransportCommand } from './vendorTransport'

export interface ConfiguredRoleProcessRunnerOptions {
  rootDir?: string
  store?: BoardStore
  worktrees?: WorktreeManager
  contextBuilder?: RoleProcessContextBuilder
}

export class ConfiguredRoleProcessRunner implements AgentRunner {
  private readonly rootDir: string
  private readonly store: BoardStore
  private readonly paths: ReturnType<typeof createProjectPaths>
  private readonly contextBuilder: RoleProcessContextBuilder
  private readonly processRunner: ProcessAgentRunner

  constructor(options: ConfiguredRoleProcessRunnerOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd()
    this.store = options.store ?? createBoardStore(this.rootDir)
    this.paths = createProjectPaths(this.rootDir)
    this.contextBuilder = options.contextBuilder ?? createRoleProcessContextBuilder(this.rootDir)
    this.processRunner = new ProcessAgentRunner({
      rootDir: this.rootDir,
      worktrees: options.worktrees ?? createWorktreeManager(this.rootDir),
      resolveCommand: async (input) => this.resolveCommand(input),
    })
  }

  async run(input: AgentStepInput, observer?: AgentRunObserver) {
    return this.processRunner.run(input, observer)
  }

  async isConfigured() {
    return Bun.file(this.paths.adapterConfigPath()).exists()
  }

  private async resolveCommand(input: AgentStepInput): Promise<ProcessAgentCommand> {
    const config = await this.readConfig()
    const roleConfig = resolveRoleTransportConfig(config, input.role)

    const board = await this.store.readBoard(input.goalKey)
    const task = board.items.find((item) => item.ref === input.taskRef)
    if (!task) {
      throw new Error(`Task not found for configured runner: ${input.taskRef}`)
    }

    const bundle = await this.contextBuilder.prepareBundle({
      goalKey: input.goalKey,
      goalTitle: board.goal.title,
      runId: input.runId,
      stepId: input.stepId,
      role: input.role,
      task,
    })

    return resolveConfiguredTransportCommand({
      config: roleConfig,
      bundle,
      input,
    })
  }

  private async readConfig() {
    return readAndMigrateAgentAdapterConfig(this.paths.adapterConfigPath())
  }
}
