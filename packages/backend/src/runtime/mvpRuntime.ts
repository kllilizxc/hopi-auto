import { ConfiguredRoleRunner, type RoleRunner } from '../agent/RoleRunner'
import {
  readAndMigrateAgentAdapterConfig,
  readAssistantCodingDefaults,
  resolveAssistantTransportConfig,
  resolveRoleTransportConfig,
  updateAssistantCodingDefaults,
  writeAgentAdapterConfig,
} from '../agent/adapterConfig'
import { ensureDefaultAgentAdapterConfig } from '../agent/defaultAdapterConfig'
import { createAssistantConversationStore } from '../assistant/assistantConversationStore'
import { createAssistantReflection } from '../assistant/assistantReflection'
import { createAssistantStateReader } from '../assistant/assistantState'
import { createAssistantTools } from '../assistant/assistantTools'
import {
  type AssistantModelRunner,
  createConfiguredAssistantModelRunner,
  createWorkspaceAssistant,
} from '../assistant/workspaceAssistant'
import type { LinkedProjectRepo } from '../domain/project'
import type {
  ProjectCodingDefaults,
  ProjectCodingDefaultsInput,
} from '../domain/projectCodingDefaults'
import { PublicationCoordinator } from '../publication/publisher'
import { createCoordinatorReconciler } from '../scheduler/coordinatorReconciler'
import { createProjectReconciler } from '../scheduler/projectReconciler'
import { createAssistantHomeStore } from '../storage/assistantHomeStore'
import { agentAdapterConfigPath } from '../storage/assistantRuntimePaths'
import { createAssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../storage/goalPackageStore'
import { type AttentionTransport, createAssistantReplyDeliveryWorker } from './attentionDelivery'
import { createCompletionStructureVerifier } from './completionVerifier'
import { bootstrapCoordinator } from './coordinatorBootstrap'
import { createGoalController } from './goalController'
import { createPreviewManager } from './previewManager'
import type { Responsibility } from './roleContextStager'
import { createRunAttemptStore } from './runAttemptStore'
import { createWorkspaceAttentionController } from './workspaceAttentionController'

export interface MvpProjectRuntime {
  projectId: string
  primaryRepoId: string
  repos: LinkedProjectRepo[]
  repoPath: string
  projectRoot: string
  store: ReturnType<typeof createGoalPackageStore>
  controller: ReturnType<typeof createGoalController>
  reconciler: ReturnType<typeof createProjectReconciler>
}

export interface MvpRuntime {
  homeRoot: string
  publisher: PublicationCoordinator
  home: ReturnType<typeof createAssistantHomeStore>
  workspace: ReturnType<typeof createAssistantWorkspaceStore>
  projects: ReadonlyMap<string, MvpProjectRuntime>
  assistant: ReturnType<typeof createWorkspaceAssistant>
  assistantConversation: ReturnType<typeof createAssistantConversationStore>
  assistantTools: ReturnType<typeof createAssistantTools>
  assistantState: ReturnType<typeof createAssistantStateReader>
  reflection: ReturnType<typeof createAssistantReflection>
  attentions: ReturnType<typeof createWorkspaceAttentionController>
  coordinator: ReturnType<typeof createCoordinatorReconciler>
  preview: ReturnType<typeof createPreviewManager>
  attempts: ReturnType<typeof createRunAttemptStore>
  rebindProject(projectId: string, repoPath: string): Promise<void>
  rebindRepo(projectId: string, repoId: string, repoPath: string): Promise<void>
  readProjectCodingDefaults(projectId: string): Promise<{
    codingDefaults: ProjectCodingDefaults
    inherited: boolean
  }>
  readAssistantCodingDefaults(): Promise<{
    codingDefaults: ProjectCodingDefaults
    inherited: boolean
  }>
  updateAssistantCodingDefaults(input: ProjectCodingDefaultsInput | null): Promise<void>
}

export interface CreateMvpRuntimeOptions {
  homeRoot: string
  roleRunner?: RoleRunner
  assistantRunner?: AssistantModelRunner
  assistantToolUrl?: () => string
  attentionTransport?: AttentionTransport
  start?: boolean
}

export async function createMvpRuntime(options: CreateMvpRuntimeOptions): Promise<MvpRuntime> {
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(options.homeRoot, publisher)
  await home.initialize()
  await ensureDefaultAgentAdapterConfig(options.homeRoot)
  const workspace = createAssistantWorkspaceStore(options.homeRoot, publisher)
  const attempts = createRunAttemptStore(options.homeRoot)
  await attempts.interruptRunningAttempts()
  const assistantConversation = createAssistantConversationStore(options.homeRoot)
  await assistantConversation.interruptRunning()
  const attentions = createWorkspaceAttentionController(workspace)
  const adapterPath = agentAdapterConfigPath(options.homeRoot)
  const readAdapterConfig = () => readAndMigrateAgentAdapterConfig(adapterPath)
  const roleRunner =
    options.roleRunner ??
    new ConfiguredRoleRunner({
      resolveConfig: async (input) => {
        const [adapterConfig, project] = await Promise.all([
          readAdapterConfig(),
          home.readProject(input.projectId),
        ])
        return resolveRoleTransportConfig(
          adapterConfig,
          input.responsibility,
          project.codingDefaults,
        )
      },
    })
  const linkedProjects = await home.listProjects()
  const projects = new Map<string, MvpProjectRuntime>()
  const preview = createPreviewManager(options.homeRoot)

  for (const linked of linkedProjects) {
    const store = createGoalPackageStore(linked.integrationRoot, linked.projectId, publisher)
    const layout = {
      primaryRepoId: linked.primaryRepoId,
      repos: linked.repos.map((repo) => ({
        repoId: repo.repoId,
        integrationRoot: repo.integrationRoot,
        primary: repo.primary,
      })),
    }
    const completion = createCompletionStructureVerifier(store, layout)
    const controller = createGoalController(store, {
      verifyCompletion: (goalId, goalPackage) => completion.verify(goalId, goalPackage),
    })
    const reconciler = createProjectReconciler({
      homeRoot: options.homeRoot,
      projectId: linked.projectId,
      projectRoot: linked.integrationRoot,
      primaryRepoId: linked.primaryRepoId,
      projectRepos: linked.repos,
      store,
      publisher,
      roleRunner,
      attempts,
      goalController: controller,
      onProjectBlocked: async ({ projectId, reason }) => {
        await attentions.ensureProjectAttention(projectId, reason)
      },
      onReleaseUpdated: async ({ projectId }) => {
        await preview.stop(projectId, 'release_updated')
      },
    })
    projects.set(linked.projectId, {
      projectId: linked.projectId,
      primaryRepoId: linked.primaryRepoId,
      repos: [...linked.repos],
      repoPath: linked.repoPath,
      projectRoot: linked.integrationRoot,
      store,
      controller,
      reconciler,
    })
  }

  const boot = await bootstrapCoordinator({
    homeRoot: options.homeRoot,
    home,
    workspace,
    projects: [...projects.values()].map((project) => ({
      projectId: project.projectId,
      projectRoot: project.projectRoot,
      primaryRepoId: project.primaryRepoId,
      repos: project.repos.map((repo) => ({
        repoId: repo.repoId,
        integrationRoot: repo.integrationRoot,
        primary: repo.primary,
      })),
      store: project.store,
    })),
    attentions,
  })
  const assistantRunner =
    options.assistantRunner ??
    createConfiguredAssistantModelRunner({
      resolveConfig: async () => resolveAssistantTransportConfig(await readAdapterConfig()),
      resolveToolUrl:
        options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
    })
  let readActiveRuns: () => ReadonlyMap<string, Responsibility> = () => new Map()
  const assistantState = createAssistantStateReader({
    homeRoot: options.homeRoot,
    workspace,
    projects,
    publisher,
    attempts,
    activeRuns: () => readActiveRuns(),
  })
  const assistantTools = createAssistantTools({
    workspace,
    projects,
    publisher,
    preview,
    state: assistantState,
  })
  const assistant = createWorkspaceAssistant({
    homeRoot: options.homeRoot,
    workspace,
    conversation: assistantConversation,
    tools: assistantTools,
    runner: assistantRunner,
    resolveToolUrl:
      options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
  })
  let wakeCoordinator: () => void = () => undefined
  const reflection = createAssistantReflection({
    homeRoot: options.homeRoot,
    workspace,
    state: assistantState,
    tools: assistantTools,
    runner: assistantRunner,
    resolveToolUrl:
      options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
    onWake: () => wakeCoordinator(),
    onLoopExhausted: async (eventId, message) => {
      await attentions.ensureEventAttention(eventId, message)
    },
  })
  const delivery = options.attentionTransport
    ? createAssistantReplyDeliveryWorker(workspace, options.attentionTransport)
    : undefined
  const coordinator = createCoordinatorReconciler({
    workspace,
    assistant,
    reflection,
    attentions,
    projects: [...projects.values()].map((project) => ({
      projectId: project.projectId,
      store: project.store,
      reconciler: project.reconciler,
    })),
    delivery,
  })
  readActiveRuns = () => coordinator.activeRuns()
  wakeCoordinator = () => coordinator.wake()
  for (const projectId of boot.blockedProjectIds) coordinator.setProjectEligible(projectId, false)
  if (options.start !== false) coordinator.start()

  async function resolveProjectBindingAttentions(projectId: string) {
    const state = await workspace.readWorkspace()
    for (const attention of state.attentions.values()) {
      if (
        attention.attributes.target === `project:${projectId}` &&
        attention.attributes.resolvedAt === null
      ) {
        await workspace.resolveAttention(
          attention.attributes.id,
          'Project binding and managed integration root passed deterministic validation after rebind.',
        )
      }
    }
  }

  async function rebindProject(projectId: string, repoPath: string) {
    await home.rebindProject({ projectId, repoPath })
    await resolveProjectBindingAttentions(projectId)
  }

  async function rebindRepo(projectId: string, repoId: string, repoPath: string) {
    await home.rebindRepo({ projectId, repoId, repoPath })
    await resolveProjectBindingAttentions(projectId)
  }

  async function readProjectCodingDefaults(projectId: string) {
    const [project, adapterConfig] = await Promise.all([
      home.readProject(projectId),
      readAdapterConfig(),
    ])
    return {
      codingDefaults: project.codingDefaults ?? adapterConfig.defaults,
      inherited: project.codingDefaults === undefined,
    }
  }

  async function readAssistantModelSettings() {
    return readAssistantCodingDefaults(await readAdapterConfig())
  }

  async function updateAssistantModelSettings(input: ProjectCodingDefaultsInput | null) {
    const current = await readAdapterConfig()
    await writeAgentAdapterConfig(adapterPath, updateAssistantCodingDefaults(current, input))
  }

  return {
    homeRoot: options.homeRoot,
    publisher,
    home,
    workspace,
    projects,
    assistant,
    assistantConversation,
    assistantTools,
    assistantState,
    reflection,
    attentions,
    coordinator,
    preview,
    attempts,
    rebindProject,
    rebindRepo,
    readProjectCodingDefaults,
    readAssistantCodingDefaults: readAssistantModelSettings,
    updateAssistantCodingDefaults: updateAssistantModelSettings,
  }
}

export function requireProject(
  projects: ReadonlyMap<string, MvpProjectRuntime>,
  projectId: string,
) {
  const project = projects.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project
}
