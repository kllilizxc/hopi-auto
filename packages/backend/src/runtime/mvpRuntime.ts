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
import { resolveProjectPath } from '../domain/projectPath'
import { PublicationCoordinator } from '../publication/publisher'
import { createCoordinatorReconciler } from '../scheduler/coordinatorReconciler'
import { createProjectReconciler } from '../scheduler/projectReconciler'
import { createAssistantHomeStore } from '../storage/assistantHomeStore'
import { agentAdapterConfigPath } from '../storage/assistantRuntimePaths'
import { createAssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../storage/goalPackageStore'
import { type AttentionTransport, createAssistantReplyDeliveryWorker } from './attentionDelivery'
import { migrateLegacyAttentionOwnership } from './attentionOwnershipMigration'
import { createCompletionStructureVerifier } from './completionVerifier'
import { bootstrapCoordinator, recoverCoordinatorProject } from './coordinatorBootstrap'
import { createGoalController } from './goalController'
import { createPreviewManager } from './previewManager'
import { createResponsibilitySessionStore } from './responsibilitySessionStore'
import type { Responsibility } from './roleContextStager'
import { createRunAttemptStore } from './runAttemptStore'
import { readSoftwareDeliveryProfile } from './softwareDeliveryProfile'
import { createWorkspaceAttentionController } from './workspaceAttentionController'

export interface MvpProjectRuntime {
  projectId: string
  primaryRepoId: string
  repos: LinkedProjectRepo[]
  repoPath: string
  projectPath: string
  projectRoot: string
  sourceRoot: string
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
  rebindProject(projectId: string, repoPath: string, projectPath?: string): Promise<void>
  rebindRepo(
    projectId: string,
    repoId: string,
    repoPath: string,
    projectPath?: string,
  ): Promise<void>
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
  reflectionRunner?: AssistantModelRunner
  assistantToolUrl?: () => string
  attentionTransport?: AttentionTransport
  onProjectTopologyChanged?: () => void
  start?: boolean
}

export async function createMvpRuntime(options: CreateMvpRuntimeOptions): Promise<MvpRuntime> {
  const profile = await readSoftwareDeliveryProfile()
  const publisher = new PublicationCoordinator()
  const home = createAssistantHomeStore(options.homeRoot, publisher)
  await home.initialize()
  await ensureDefaultAgentAdapterConfig(options.homeRoot)
  const workspace = createAssistantWorkspaceStore(options.homeRoot, publisher)
  const attempts = createRunAttemptStore(options.homeRoot)
  await attempts.interruptRunningAttempts()
  const responsibilitySessions = createResponsibilitySessionStore(options.homeRoot)
  const assistantConversation = createAssistantConversationStore(options.homeRoot)
  await assistantConversation.interruptRunning()
  const topologyChangedEvents = new Set<string>()
  const assistantSessionResetEvents = new Set<string>()
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
  const assistantToolUrl = options.assistantToolUrl

  for (const linked of linkedProjects) {
    const store = createGoalPackageStore(
      linked.integrationRoot,
      linked.projectId,
      publisher,
      linked.projectPath,
    )
    const layout = {
      primaryRepoId: linked.primaryRepoId,
      repos: linked.repos.map((repo) => ({
        repoId: repo.repoId,
        integrationRoot: repo.integrationRoot,
        checkoutRoot: repo.repoPath,
        deliveryBranch: repo.deliveryBranch,
        projectPath: repo.projectPath,
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
      responsibilitySessions,
      goalController: controller,
      apiOrigin: assistantToolUrl ? () => new URL(assistantToolUrl()).origin : undefined,
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
      projectPath: linked.projectPath,
      projectRoot: linked.integrationRoot,
      sourceRoot: resolveProjectPath(linked.integrationRoot, linked.projectPath),
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
        checkoutRoot: repo.repoPath,
        deliveryBranch: repo.deliveryBranch,
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
    readAssistantCodingDefaults: readAssistantModelSettings,
    readProjectCodingDefaults,
  })
  let restoreProjectEligibility: (projectId: string) => Promise<void> = async () => undefined
  const assistantTools = createAssistantTools({
    home,
    workspace,
    projects,
    publisher,
    preview,
    state: assistantState,
    readAssistantCodingDefaults: readAssistantModelSettings,
    readProjectCodingDefaults,
    updateAssistantCodingDefaultsForTurn: updateAssistantModelSettingsForTurn,
    onProjectTopologyChanged: (eventId) => topologyChangedEvents.add(eventId),
    onProjectAttentionResolved: (projectId) => restoreProjectEligibility(projectId),
  })
  await migrateLegacyAttentionOwnership({ workspace, projects })
  const assistant = createWorkspaceAssistant({
    homeRoot: options.homeRoot,
    workspace,
    conversation: assistantConversation,
    tools: assistantTools,
    runner: assistantRunner,
    resolveToolUrl:
      options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
    onTurnSettled: async (eventId) => {
      if (assistantSessionResetEvents.delete(eventId)) {
        await assistantConversation.clearSession()
      }
      if (topologyChangedEvents.delete(eventId)) options.onProjectTopologyChanged?.()
    },
  })
  let wakeCoordinator: () => void = () => undefined
  const reflection = createAssistantReflection({
    homeRoot: options.homeRoot,
    workspace,
    state: assistantState,
    tools: assistantTools,
    runner: options.reflectionRunner ?? assistantRunner,
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
    concurrency: profile.concurrency,
    delivery,
  })
  readActiveRuns = () => coordinator.activeRuns()
  wakeCoordinator = () => coordinator.wake()
  restoreProjectEligibility = async (projectId) => {
    const project = requireProject(projects, projectId)
    try {
      await recoverCoordinatorProject(home, {
        projectId: project.projectId,
        projectRoot: project.projectRoot,
        primaryRepoId: project.primaryRepoId,
        repos: project.repos.map((repo) => ({
          repoId: repo.repoId,
          integrationRoot: repo.integrationRoot,
          checkoutRoot: repo.repoPath,
          deliveryBranch: repo.deliveryBranch,
          projectPath: repo.projectPath,
          primary: repo.primary,
        })),
        store: project.store,
      })
      coordinator.setProjectEligible(projectId, true)
    } catch (error) {
      coordinator.setProjectEligible(projectId, false)
      await attentions.ensureProjectAttention(
        projectId,
        `Project reconciliation validation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  for (const projectId of boot.blockedProjectIds) coordinator.setProjectEligible(projectId, false)
  if (options.start !== false) coordinator.start()

  async function rebindProject(projectId: string, repoPath: string, projectPath?: string) {
    await home.rebindProject({ projectId, repoPath, ...(projectPath ? { projectPath } : {}) })
  }

  async function rebindRepo(
    projectId: string,
    repoId: string,
    repoPath: string,
    projectPath?: string,
  ) {
    await home.rebindRepo({
      projectId,
      repoId,
      repoPath,
      ...(projectPath ? { projectPath } : {}),
    })
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
    if (await writeAssistantModelSettings(input)) await assistantConversation.clearSession()
  }

  async function updateAssistantModelSettingsForTurn(
    eventId: string,
    input: ProjectCodingDefaultsInput | null,
  ) {
    if (await writeAssistantModelSettings(input)) assistantSessionResetEvents.add(eventId)
  }

  async function writeAssistantModelSettings(input: ProjectCodingDefaultsInput | null) {
    const current = await readAdapterConfig()
    const previousTransport = resolveAssistantTransportConfig(current).transport
    const next = updateAssistantCodingDefaults(current, input)
    await writeAgentAdapterConfig(adapterPath, next)
    return resolveAssistantTransportConfig(next).transport !== previousTransport
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
