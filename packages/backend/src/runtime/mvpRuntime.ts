import { ConfiguredRoleRunner, type RoleRunner } from '../agent/RoleRunner'
import {
  type AgentRoleCodingSettings,
  type ConfigurableAgentRole,
  readAgentAdapterConfig,
  readAgentRoleCodingDefaults,
  resolveAssistantTransportConfig,
  resolveRoleTransportConfig,
  updateAgentRoleCodingDefaults,
  updateAssistantCodingDefaults,
  writeAgentAdapterConfig,
} from '../agent/adapterConfig'
import { ensureDefaultAgentAdapterConfig } from '../agent/defaultAdapterConfig'
import { assistantConversationScopeForEvent } from '../assistant/assistantConversationScope'
import { createAssistantConversationStore } from '../assistant/assistantConversationStore'
import { createAssistantWake } from '../assistant/assistantReflection'
import { createAssistantStateReader } from '../assistant/assistantState'
import { createAssistantTools } from '../assistant/assistantTools'
import {
  type AssistantModelRunner,
  createConfiguredAssistantModelRunner,
  createWorkspaceAssistant,
} from '../assistant/workspaceAssistant'
import { createProjectCommandRunner } from '../commands/projectCommandRunner'
import { isInternalInboxSource } from '../domain/assistantWorkspaceDocuments'
import type { LinkedProject, LinkedProjectRepo } from '../domain/project'
import type { ProjectCodingDefaultsInput } from '../domain/projectCodingDefaults'
import { resolveProjectPath } from '../domain/projectPath'
import { PublicationCoordinator } from '../publication/publisher'
import { createCoordinatorReconciler } from '../scheduler/coordinatorReconciler'
import { createProjectReconciler } from '../scheduler/projectReconciler'
import { createAssistantHomeStore } from '../storage/assistantHomeStore'
import { agentAdapterConfigPath } from '../storage/assistantRuntimePaths'
import { createAssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import { createGoalPackageStore } from '../storage/goalPackageStore'
import { type AttentionTransport, createAssistantReplyDeliveryWorker } from './attentionDelivery'
import { bootstrapCoordinator, recoverCoordinatorProject } from './coordinatorBootstrap'
import { createGoalController } from './goalController'
import { createPreviewManager } from './previewManager'
import { recordProjectSystemEvent } from './projectSystemEvent'
import { createResponsibilitySessionStore } from './responsibilitySessionStore'
import { type RunAttemptStore, createRunAttemptStore } from './runAttemptStore'
import { readSoftwareDeliveryProfile } from './softwareDeliveryProfile'
import { createWorkspaceAttentionController } from './workspaceAttentionController'

export interface MvpProjectRuntime {
  projectId: string
  label?: string
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
  concurrency: Readonly<Record<'planner' | 'generator' | 'reviewer', number>>
  publisher: PublicationCoordinator
  home: ReturnType<typeof createAssistantHomeStore>
  workspace: ReturnType<typeof createAssistantWorkspaceStore>
  projects: ReadonlyMap<string, MvpProjectRuntime>
  assistant: ReturnType<typeof createWorkspaceAssistant>
  assistantConversation: ReturnType<typeof createAssistantConversationStore>
  assistantTools: ReturnType<typeof createAssistantTools>
  assistantState: ReturnType<typeof createAssistantStateReader>
  reflection: ReturnType<typeof createAssistantWake>
  attentions: ReturnType<typeof createWorkspaceAttentionController>
  coordinator: ReturnType<typeof createCoordinatorReconciler>
  preview: ReturnType<typeof createPreviewManager>
  attempts: ReturnType<typeof createRunAttemptStore>
  commands: ReturnType<typeof createProjectCommandRunner>
  rebindProject(projectId: string, repoPath: string, projectPath?: string): Promise<void>
  rebindRepo(
    projectId: string,
    repoId: string,
    repoPath: string,
    projectPath?: string,
  ): Promise<void>
  readAgentRoleCodingDefaults(role: ConfigurableAgentRole): Promise<AgentRoleCodingSettings>
  updateAgentRoleCodingDefaults(
    role: ConfigurableAgentRole,
    input: ProjectCodingDefaultsInput | null,
  ): Promise<void>
}

export interface CreateMvpRuntimeOptions {
  homeRoot: string
  publisher?: PublicationCoordinator
  attempts?: RunAttemptStore
  roleRunner?: RoleRunner
  assistantRunner?: AssistantModelRunner
  assistantToolUrl?: () => string
  attentionTransport?: AttentionTransport
  onProjectTopologyChanged?: () => void
  projectFullAccess?: (projectId: string) => boolean | Promise<boolean>
  start?: boolean
}

export async function createMvpRuntime(options: CreateMvpRuntimeOptions): Promise<MvpRuntime> {
  const profile = await readSoftwareDeliveryProfile()
  const publisher = options.publisher ?? new PublicationCoordinator()
  const home = createAssistantHomeStore(options.homeRoot, publisher)
  await home.initialize()
  await ensureDefaultAgentAdapterConfig(options.homeRoot)
  const workspace = createAssistantWorkspaceStore(options.homeRoot, publisher)
  const attempts = options.attempts ?? createRunAttemptStore(options.homeRoot)
  await attempts.interruptRunningAttempts()
  const responsibilitySessions = createResponsibilitySessionStore(options.homeRoot)
  const assistantConversation = createAssistantConversationStore(options.homeRoot)
  await assistantConversation.interruptRunning()
  const topologyChangedEvents = new Set<string>()
  const attentions = createWorkspaceAttentionController(workspace)
  let runProjectMutation: <T>(projectId: string, operation: () => Promise<T>) => Promise<T> = (
    _projectId,
    operation,
  ) => operation()
  const commands = createProjectCommandRunner({
    home,
    publisher,
    workspace,
    runProjectMutation: (projectId, operation) => runProjectMutation(projectId, operation),
  })
  const adapterPath = agentAdapterConfigPath(options.homeRoot)
  const readAdapterConfig = () => readAgentAdapterConfig(adapterPath)
  const roleRunner =
    options.roleRunner ??
    new ConfiguredRoleRunner({
      resolveConfig: async (input) => {
        return resolveRoleTransportConfig(await readAdapterConfig(), input.responsibility)
      },
      fullAccess: (input) => options.projectFullAccess?.(input.projectId) ?? false,
    })
  const linkedProjects = await home.listProjects()
  const projects = new Map<string, MvpProjectRuntime>()
  let wakeCoordinator: () => void = () => undefined
  const preview = createPreviewManager(options.homeRoot, {
    onEvent: async (event) => {
      if (event.kind === 'start_failed') {
        await recordProjectSystemEvent(workspace, {
          projectId: event.projectId,
          summary: 'Project Preview start failed.',
          details: [
            `Reason: ${event.reason}.`,
            `Detail: ${event.message}`,
            `Session manifest: ${event.manifestPath}`,
            `Log: ${event.logPath}`,
          ],
        })
        wakeCoordinator()
        return
      }
      await recordProjectSystemEvent(workspace, {
        projectId: event.projectId,
        summary: `Project Preview ${event.status}.`,
        details: [
          `Reason: ${event.reason}.`,
          `Detail: ${event.message}`,
          `Session manifest: ${event.manifestPath}`,
          `Log: ${event.logPath}`,
        ],
      })
      wakeCoordinator()
    },
  })
  await preview.recover()
  const assistantToolUrl = options.assistantToolUrl

  const createProjectRuntime = (linked: LinkedProject): MvpProjectRuntime => {
    const sourceRoot = resolveProjectPath(linked.integrationRoot, linked.projectPath)
    const store = createGoalPackageStore(
      linked.integrationRoot,
      linked.projectId,
      publisher,
      linked.projectPath,
    )
    const controller = createGoalController(store, {})
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
      onReleaseUpdated: async ({ projectId }) => {
        await preview.stop(projectId, 'release_updated')
      },
    })
    return {
      projectId: linked.projectId,
      ...(linked.label ? { label: linked.label } : {}),
      primaryRepoId: linked.primaryRepoId,
      repos: [...linked.repos],
      repoPath: linked.repoPath,
      projectPath: linked.projectPath,
      projectRoot: linked.integrationRoot,
      sourceRoot,
      store,
      controller,
      reconciler,
    }
  }

  for (const linked of linkedProjects) {
    projects.set(linked.projectId, createProjectRuntime(linked))
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
  })
  const assistantRunner =
    options.assistantRunner ??
    createConfiguredAssistantModelRunner({
      resolveConfig: async () => resolveAssistantTransportConfig(await readAdapterConfig()),
      fullAccess: (projectId) => options.projectFullAccess?.(projectId) ?? false,
      homeRoot: options.homeRoot,
      resolveToolUrl:
        options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
    })
  const assistantState = createAssistantStateReader({
    homeRoot: options.homeRoot,
    workspace,
    projects,
    publisher,
    attempts,
    concurrency: profile.concurrency,
  })
  let restoreProjectEligibility: (
    projectId: string,
  ) => Promise<{ eligible: boolean; error?: string }> = async () => ({
    eligible: false,
    error: 'Project recovery is not initialized',
  })
  let protectAssistantGoal: (eventId: string, projectId: string, goalId: string) => void = () =>
    undefined
  let protectAssistantProject: (eventId: string, projectId: string) => void = () => undefined
  const assistantTools = createAssistantTools({
    home,
    commands,
    workspace,
    projects,
    publisher,
    preview,
    state: assistantState,
    onProjectTopologyChanged: (eventId, linkedProject) => {
      projects.set(linkedProject.projectId, createProjectRuntime(linkedProject))
      topologyChangedEvents.add(eventId)
    },
    onProjectRecoveryRequested: (projectId) => restoreProjectEligibility(projectId),
    onGoalEffect: (eventId, projectId, goalId) => protectAssistantGoal(eventId, projectId, goalId),
    onProjectDispatchEffect: (eventId, projectId) => protectAssistantProject(eventId, projectId),
    onToolEffect: async (eventId, name, result) => {
      const event = await workspace.readEvent(eventId)
      if (!event || !isInternalInboxSource(event.attributes.source)) return
      const detail = boundedReceiptDetail(result.value)
      await assistantConversation.recordActionReceipt(assistantConversationScopeForEvent(event), {
        receiptId: await actionReceiptId(
          eventId,
          'tool',
          `${name}\u0000${result.summary}\u0000${detail}`,
        ),
        eventId,
        kind: 'tool',
        summary: `${name}: ${result.summary}`,
        detail,
      })
    },
  })
  const assistant = createWorkspaceAssistant({
    homeRoot: options.homeRoot,
    workspace,
    conversation: assistantConversation,
    tools: assistantTools,
    state: assistantState,
    runner: assistantRunner,
    resolveToolUrl:
      options.assistantToolUrl ?? (() => 'http://127.0.0.1:3000/api/internal/assistant-tool'),
    onTurnSettled: async (eventId) => {
      if (topologyChangedEvents.delete(eventId)) options.onProjectTopologyChanged?.()
    },
  })
  const reflection = createAssistantWake({
    homeRoot: options.homeRoot,
    workspace,
    state: assistantState,
    onWake: () => wakeCoordinator(),
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
  protectAssistantGoal = (eventId, projectId, goalId) =>
    coordinator.protectAssistantGoal(eventId, projectId, goalId)
  protectAssistantProject = (eventId, projectId) =>
    coordinator.protectAssistantProject(eventId, projectId)
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
          projectPath: repo.projectPath,
          primary: repo.primary,
        })),
        store: project.store,
      })
      coordinator.setProjectEligible(projectId, true)
      return { eligible: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      coordinator.setProjectEligible(projectId, false)
      await recordProjectSystemEvent(workspace, {
        projectId,
        summary: 'Project recovery validation failed.',
        details: [message],
      })
      return { eligible: false, error: message }
    }
  }
  runProjectMutation = async (projectId, operation) => {
    await coordinator.quiesceProject(projectId)
    try {
      return await operation()
    } catch (error) {
      await restoreProjectEligibility(projectId)
      throw error
    }
  }
  for (const projectId of boot.blockedProjectIds) coordinator.setProjectEligible(projectId, false)
  if (options.start !== false) coordinator.start()

  async function rebindProject(projectId: string, repoPath: string, projectPath?: string) {
    const current = await home.readProject(projectId)
    await commands.executeProjectRebind({
      projectId,
      repos: [{ repoId: current.primaryRepoId, repoPath, projectPath }],
    })
  }

  async function rebindRepo(
    projectId: string,
    repoId: string,
    repoPath: string,
    projectPath?: string,
  ) {
    await commands.executeProjectRebind({
      projectId,
      repos: [{ repoId, repoPath, projectPath }],
    })
  }

  async function readAgentRoleModelSettings(role: ConfigurableAgentRole) {
    return readAgentRoleCodingDefaults(await readAdapterConfig(), role)
  }

  async function updateAssistantModelSettings(input: ProjectCodingDefaultsInput | null) {
    if (await writeAssistantModelSettings(input)) await assistantConversation.clearSessions()
  }

  async function updateAgentRoleModelSettings(
    role: ConfigurableAgentRole,
    input: ProjectCodingDefaultsInput | null,
  ) {
    if (role === 'assistant') {
      await updateAssistantModelSettings(input)
      return
    }
    const current = await readAdapterConfig()
    await writeAgentAdapterConfig(adapterPath, updateAgentRoleCodingDefaults(current, role, input))
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
    concurrency: profile.concurrency,
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
    commands,
    rebindProject,
    rebindRepo,
    readAgentRoleCodingDefaults: readAgentRoleModelSettings,
    updateAgentRoleCodingDefaults: updateAgentRoleModelSettings,
  }
}

async function actionReceiptId(eventId: string, kind: string, value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${eventId}\u0000${kind}\u0000${value}`),
    ),
  )
  const digest = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `AR-${digest.slice(0, 32)}`
}

function boundedReceiptDetail(value: unknown) {
  const encoded = JSON.stringify(value)
  if (!encoded) return null
  return encoded.length > 4_000 ? `${encoded.slice(0, 4_000)}...` : encoded
}

export function requireProject(
  projects: ReadonlyMap<string, MvpProjectRuntime>,
  projectId: string,
) {
  const project = projects.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project
}
