import type { AgentRoleCodingSettings, ConfigurableAgentRole } from '../agent/adapterConfig'
import type { InboxContext } from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from '../domain/attentionReference'
import {
  parseProjectAttentionTarget,
  parseWorkAttentionTarget,
  projectAttentionTarget,
} from '../domain/attentionTarget'
import {
  type WorkDocument,
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseInputDocument,
  renderAttentionDocument,
  renderInputDocument,
} from '../domain/canonicalDocuments'
import { findNonPortableGoalImageReference } from '../domain/goalImageReference'
import { inboxEventReference } from '../domain/inboxEventReference'
import type { LinkedProject, LinkedProjectRepo } from '../domain/project'
import type { ProjectCodingDefaultsInput } from '../domain/projectCodingDefaults'
import { resolveProjectPath } from '../domain/projectPath'
import { deriveReadableId } from '../domain/stableId'
import { deriveWorkProjection } from '../domain/workProjection'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import {
  acknowledgeGoalAttention,
  clearGoalAttentionOperatorRequest,
} from '../runtime/attentionDelivery'
import type {
  GoalController,
  PlanningAttentionSettlement,
  PlanningContext,
  PlanningInputAdmission,
} from '../runtime/goalController'
import type { PreviewManager } from '../runtime/previewManager'
import { classifyProjectDirectory, initializeEmptyGitRepository } from '../runtime/projectDirectory'
import { readSoftwareDeliveryProfile } from '../runtime/softwareDeliveryProfile'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'
import {
  type AssistantToolName,
  type MainAssistantToolName,
  mainAssistantToolNames,
  parseAssistantToolArguments,
  reflectionAssistantToolNames,
} from './assistantToolSchemas'

export interface AssistantToolProject {
  projectId: string
  projectRoot: string
  sourceRoot?: string
  primaryRepoId?: string
  repos?: readonly LinkedProjectRepo[]
  store: GoalPackageStore
  controller: GoalController
  reconciler?: {
    interruptRuns(goalId?: string, workId?: string): void
  }
}

export interface AssistantToolResult {
  summary: string
  changed: boolean
  value: unknown
}

export interface AssistantTools {
  issue(eventId: string): string
  issueReflection(
    reflectionId: string,
    onHandoff?: (handoff: { brief: string; context?: InboxContext }) => void,
  ): string
  revoke(token: string): void
  notificationMessage(token: string): string | null
  notificationIntent(token: string): 'inform' | 'request' | null
  hasDurableEffect(token: string): boolean
  assistantOwnedAttentionRefs(eventId: string): Promise<string[]>
  acknowledgeEventAttentions(eventId: string, acknowledgedAt?: Date): Promise<string[]>
  acceptUserAttentionReply(eventId: string): Promise<string[]>
  execute(token: string, name: AssistantToolName, input: unknown): Promise<AssistantToolResult>
  executeForEvent(
    eventId: string,
    name: MainAssistantToolName,
    input: unknown,
  ): Promise<AssistantToolResult>
}

export function createAssistantTools(options: {
  home: AssistantHomeStore
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantToolProject>
  publisher: PublicationCoordinator
  preview: PreviewManager
  state: AssistantStateReader
  readAgentRoleCodingDefaults(role: ConfigurableAgentRole): Promise<AgentRoleCodingSettings>
  updateAgentRoleCodingDefaultsForTurn(
    eventId: string,
    role: ConfigurableAgentRole,
    input: ProjectCodingDefaultsInput | null,
  ): Promise<void>
  onProjectTopologyChanged?: (eventId: string) => void
  onProjectAttentionResolved?: (projectId: string) => void | Promise<void>
  onGoalEffect?: (eventId: string, projectId: string, goalId: string) => void
  onProjectDispatchEffect?: (eventId: string, projectId: string) => void
  now?: () => Date
}): AssistantTools {
  type Capability =
    | {
        mode: 'main'
        eventId: string
        expiresAt: number
        notificationMessage: string | null
        notificationIntent: 'inform' | 'request' | null
        durableEffect: boolean
      }
    | {
        mode: 'reflection'
        reflectionId: string
        expiresAt: number
        handedOff: boolean
        onHandoff?: (handoff: { brief: string; context?: InboxContext }) => void
      }
  const capabilities = new Map<string, Capability>()
  const now = options.now ?? (() => new Date())

  return {
    issue(eventId) {
      const token = crypto.randomUUID()
      capabilities.set(token, {
        mode: 'main',
        eventId,
        expiresAt: Date.now() + 60 * 60 * 1_000,
        notificationMessage: null,
        notificationIntent: null,
        durableEffect: false,
      })
      return token
    },

    issueReflection(reflectionId, onHandoff) {
      const token = crypto.randomUUID()
      capabilities.set(token, {
        mode: 'reflection',
        reflectionId,
        expiresAt: Date.now() + 60 * 60 * 1_000,
        handedOff: false,
        onHandoff,
      })
      return token
    },

    revoke(token) {
      capabilities.delete(token)
    },

    notificationMessage(token) {
      const capability = capabilities.get(token)
      return capability?.mode === 'main' ? capability.notificationMessage : null
    },

    notificationIntent(token) {
      const capability = capabilities.get(token)
      return capability?.mode === 'main' ? capability.notificationIntent : null
    },

    hasDurableEffect(token) {
      const capability = capabilities.get(token)
      return capability?.mode === 'main' && capability.durableEffect
    },

    async assistantOwnedAttentionRefs(eventId) {
      const event = await options.workspace.readEvent(eventId)
      if (!event?.attributes.context) return []
      const workspace = await options.workspace.readWorkspace()
      const undelivered: string[] = []
      for (const reference of normalizeInboxAttentionReferences(event.attributes.context)) {
        const parsed = parseAttentionReference(reference)
        if (!parsed) continue
        if (parsed.scope === 'workspace') {
          if (parsed.homeId !== workspace.homeId) {
            throw new Error(`Workspace Attention reference belongs to another Home: ${reference}`)
          }
          const attention = workspace.attentions.get(parsed.attentionId)
          if (!attention) throw new Error(`Workspace Attention not found: ${reference}`)
          if (
            attention.attributes.resolvedAt === null &&
            (attention.attributes.operatorRequest ?? null) === null
          ) {
            undelivered.push(reference)
          }
          continue
        }
        const project = options.projects.get(parsed.projectId)
        if (!project) throw new Error(`Attention Project is unavailable: ${parsed.projectId}`)
        const attention = (await project.store.readPackage(parsed.goalId)).attentions.get(
          parsed.attentionId,
        )
        if (!attention) throw new Error(`Goal Attention not found: ${reference}`)
        if (
          attention.attributes.target !== null &&
          attention.attributes.resolvedAt === null &&
          (attention.attributes.operatorRequest ?? null) === null
        ) {
          undelivered.push(reference)
        }
      }
      return undelivered
    },

    async acknowledgeEventAttentions(eventId, acknowledgedAt = now()) {
      const event = await options.workspace.readEvent(eventId)
      if (
        !event ||
        event.attributes.source !== 'reflection' ||
        event.attributes.visibility !== 'public' ||
        event.attributes.status !== 'handled'
      ) {
        return []
      }
      const context = event.attributes.context
      if (!context) return []
      const workspace = await options.workspace.readWorkspace()
      const requestReference =
        event.attributes.disposition === 'operator-requested'
          ? inboxEventReference(workspace.homeId, eventId)
          : undefined
      const acknowledged: string[] = []
      for (const reference of normalizeInboxAttentionReferences(context)) {
        const parsed = parseAttentionReference(reference)
        if (!parsed) continue
        if (parsed.scope === 'workspace') {
          if (parsed.homeId !== workspace.homeId) {
            throw new Error(`Workspace Attention reference belongs to another Home: ${reference}`)
          }
          const attention = workspace.attentions.get(parsed.attentionId)
          if (!attention) throw new Error(`Workspace Attention not found: ${reference}`)
          if (attention.attributes.resolvedAt !== null) continue
          const changed =
            attention.attributes.notifiedAt === null ||
            (requestReference !== undefined &&
              (attention.attributes.operatorRequest ?? null) !== requestReference)
          if (!changed) continue
          await options.workspace.markAttentionNotified(
            parsed.attentionId,
            acknowledgedAt,
            requestReference,
          )
          acknowledged.push(reference)
          continue
        }
        const project = options.projects.get(parsed.projectId)
        if (!project) throw new Error(`Attention Project is unavailable: ${parsed.projectId}`)
        const goalPackage = await project.store.readPackage(parsed.goalId)
        const attention = goalPackage.attentions.get(parsed.attentionId)
        if (!attention) throw new Error(`Goal Attention not found: ${reference}`)
        if (
          await acknowledgeGoalAttention(
            project.store,
            parsed.goalId,
            parsed.attentionId,
            acknowledgedAt,
            attention.attributes.target === null ? undefined : requestReference,
          )
        ) {
          acknowledged.push(reference)
          continue
        }
        const current = (await project.store.readPackage(parsed.goalId)).attentions.get(
          parsed.attentionId,
        )
        if (
          current?.attributes.resolvedAt === null &&
          (current.attributes.notifiedAt === null ||
            (requestReference !== undefined &&
              (current.attributes.operatorRequest ?? null) !== requestReference))
        ) {
          throw new Error(`Goal Attention could not be acknowledged: ${reference}`)
        }
      }
      return acknowledged
    },

    async acceptUserAttentionReply(eventId) {
      const event = await options.workspace.readEvent(eventId)
      if (!event || event.attributes.source !== 'user' || !event.attributes.context?.replyTo) {
        return []
      }
      const workspace = await options.workspace.readWorkspace()
      const expectedRequest = event.attributes.context.replyTo
      const accepted: string[] = []
      for (const reference of normalizeInboxAttentionReferences(event.attributes.context)) {
        const parsed = parseAttentionReference(reference)
        if (!parsed) continue
        if (parsed.scope === 'workspace') {
          if (parsed.homeId !== workspace.homeId) {
            throw new Error(`Workspace Attention reference belongs to another Home: ${reference}`)
          }
          const current = workspace.attentions.get(parsed.attentionId)
          if (!current || current.attributes.resolvedAt !== null) continue
          if ((current.attributes.operatorRequest ?? null) === null) continue
          await options.workspace.clearAttentionOperatorRequest(parsed.attentionId, expectedRequest)
          accepted.push(reference)
          continue
        }
        const project = options.projects.get(parsed.projectId)
        if (!project) throw new Error(`Attention Project is unavailable: ${parsed.projectId}`)
        if (
          await clearGoalAttentionOperatorRequest(
            project.store,
            parsed.goalId,
            parsed.attentionId,
            expectedRequest,
          )
        ) {
          accepted.push(reference)
        }
      }
      return accepted
    },

    async execute(token, name, input) {
      const capability = capabilities.get(token)
      if (!capability || capability.expiresAt < Date.now()) {
        capabilities.delete(token)
        throw new Error('Assistant tool capability is invalid or expired')
      }
      if (capability.mode === 'reflection') {
        if (!reflectionAssistantToolNames.includes(name as never)) {
          throw new Error(`Reflection cannot call ${name}`)
        }
        if (name === 'hopi_read_state') {
          const args = parseAssistantToolArguments(name, input)
          return {
            summary: 'Read current HOPI state.',
            changed: false,
            value: await options.state.read({ ...args, includeEvidence: false }),
          }
        }
        if (name !== 'hopi_handoff_to_main') throw new Error(`Unsupported Reflection tool: ${name}`)
        if (capability.handedOff) throw new Error('Reflection already handed off one brief')
        const args = parseAssistantToolArguments(name, input)
        if (args.context) {
          const project = requireProject(options.projects, args.context.projectId)
          await project.store.readPackage(args.context.goalId)
        }
        capability.handedOff = true
        capability.onHandoff?.({ brief: args.brief, context: args.context })
        return {
          summary: `Prepared Reflection ${capability.reflectionId} brief for the speaking Assistant.`,
          changed: false,
          value: { prepared: true },
        }
      }
      if (!mainAssistantToolNames.includes(name as never)) {
        throw new Error(`Speaking thread cannot call ${name}`)
      }
      const result = await this.executeForEvent(
        capability.eventId,
        name as MainAssistantToolName,
        input,
      )
      if (result.changed) capability.durableEffect = true
      if (name === 'hopi_notify_user' || name === 'hopi_request_user') {
        capability.notificationMessage = parseAssistantToolArguments(name, input).message
        capability.notificationIntent = name === 'hopi_request_user' ? 'request' : 'inform'
      }
      return result
    },

    async executeForEvent(eventId, name, input) {
      const event = await options.workspace.readEvent(eventId)
      if (!event) throw new Error(`Inbox turn not found: ${eventId}`)
      if (event.attributes.status !== 'pending') {
        throw new Error(`Inbox turn is already handled: ${eventId}`)
      }

      switch (name) {
        case 'hopi_read_state': {
          const args = parseAssistantToolArguments(name, input)
          const context = event.attributes.context
          const projectId = args.projectId ?? context?.projectId
          const goalId =
            args.goalId ??
            (projectId && projectId === context?.projectId ? context.goalId : undefined)
          let state: Awaited<ReturnType<typeof options.state.read>>
          try {
            state = await options.state.read({
              ...(projectId ? { projectId } : {}),
              ...(goalId ? { goalId } : {}),
              ...(args.includeEvidence ? { includeEvidence: true } : {}),
            })
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            const pageContext = context?.projectId
              ? ` Current page context is ${context.projectId}${context.goalId ? ` / ${context.goalId}` : ''}; omit projectId and goalId to use it exactly.`
              : ''
            throw new Error(`${detail}.${pageContext}`)
          }
          return {
            summary: 'Read current HOPI state.',
            changed: false,
            value: {
              ...state,
              currentTurn: {
                eventId: event.attributes.id,
                source: event.attributes.source,
                context: event.attributes.context ?? null,
                attachments: [...event.attributes.attachments],
                body: event.body,
              },
            },
          }
        }
        case 'hopi_manage_project': {
          assertPublicUserTurn(event, 'Project management')
          const args = parseAssistantToolArguments(name, input)
          if (args.operation === 'initialize_repository') {
            const current = await classifyProjectDirectory(args.path)
            const alreadyInitialized =
              current.kind === 'git_repository' &&
              current.path === current.repoPath &&
              current.projectPath === '.'
            const selection = alreadyInitialized
              ? current
              : await initializeEmptyGitRepository(args.path)
            return {
              summary: alreadyInitialized
                ? `Git repository at ${selection.repoPath} was already initialized.`
                : `Initialized Git repository at ${selection.repoPath}.`,
              changed: !alreadyInitialized,
              value: { operation: args.operation, selection },
            }
          }

          const before = await options.home.listProjects()
          let project: LinkedProject
          switch (args.operation) {
            case 'link_project':
              project = await options.home.linkProject({
                ...(args.projectId ? { projectId: args.projectId } : {}),
                primaryRepoId: args.primaryRepoId,
                repos: args.repos,
              })
              break
            case 'link_repo':
              project = await options.home.linkRepo({
                projectId: args.projectId,
                repoId: args.repoId,
                repoPath: args.repoPath,
                ...(args.projectPath ? { projectPath: args.projectPath } : {}),
              })
              break
            case 'rebind_project':
              project = await options.home.rebindProject({
                projectId: args.projectId,
                repoPath: args.repoPath,
                ...(args.projectPath ? { projectPath: args.projectPath } : {}),
              })
              break
            case 'rebind_repo':
              project = await options.home.rebindRepo({
                projectId: args.projectId,
                repoId: args.repoId,
                repoPath: args.repoPath,
                ...(args.projectPath ? { projectPath: args.projectPath } : {}),
              })
              break
            case 'rebind_repos':
              project = await options.home.rebindRepos({
                projectId: args.projectId,
                repos: args.repos,
              })
              break
          }
          const previous = before.find((candidate) => candidate.projectId === project.projectId)
          const changed = !sameProjectTopology(previous, project)
          if (changed) options.onProjectTopologyChanged?.(eventId)
          return {
            summary: changed
              ? `Updated Project ${project.projectId} topology.`
              : `Project ${project.projectId} topology was already current.`,
            changed,
            value: {
              operation: args.operation,
              project: presentProjectTopology(project),
              runtimeRefresh: changed ? 'after_current_turn' : 'not_needed',
            },
          }
        }
        case 'hopi_configure_model': {
          assertPublicUserTurn(event, 'Model configuration')
          const args = parseAssistantToolArguments(name, input)
          const before = await options.readAgentRoleCodingDefaults(args.role)
          await options.updateAgentRoleCodingDefaultsForTurn(
            eventId,
            args.role,
            args.codingDefaults,
          )
          const after = await options.readAgentRoleCodingDefaults(args.role)
          const changed = !sameValue(before, after)
          return {
            summary: changed
              ? `Updated ${agentRoleLabel(args.role)} model configuration.`
              : `${agentRoleLabel(args.role)} model configuration was already current.`,
            changed,
            value: { role: args.role, ...after },
          }
        }
        case 'hopi_write_preferences': {
          assertPublicUserTurn(event, 'Preferences')
          const args = parseAssistantToolArguments(name, input)
          const result = await options.workspace.writePreference(args.content, args.expectedDigest)
          return {
            summary: result.changed
              ? 'Updated durable user preferences.'
              : 'User preferences were already current.',
            changed: result.changed,
            value: {
              path: options.workspace.paths.preference,
              digest: result.preference.digest,
            },
          }
        }
        case 'hopi_create_goal': {
          const args = parseAssistantToolArguments(name, input)
          assertPortableGoalText('Goal title', args.title)
          assertPortableGoalText('Goal objective', args.objective)
          const project = requireProject(options.projects, args.projectId)
          const goalId =
            args.goalId ?? deriveReadableId('G', args.title, await project.store.listGoalIds())
          options.onGoalEffect?.(eventId, project.projectId, goalId)
          const existing = await project.store.readGoal(goalId)
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            goalId,
            event,
            false,
          )
          const references = await prepareGoalReferences(
            options.workspace,
            project.store,
            goalId,
            args.references,
          )
          let planningChanged = false
          if (!existing) {
            await project.store.createGoal({
              goalId,
              title: args.title,
              objective: args.objective,
              priority: args.priority,
              acceptedInput: admission.document,
              supportingWrites: references.writes,
              planningReferences: references.planning,
            })
          } else if (
            existing.attributes.title !== args.title ||
            !existing.body.includes(args.objective)
          ) {
            throw new Error(`Goal ${goalId} already exists with different content`)
          } else {
            const goalPackage = await project.store.readPackage(goalId)
            const openPlanning = [...goalPackage.works.values()].find(
              (work) => work.attributes.kind === 'planning' && work.attributes.stage === 'plan',
            )
            if (openPlanning) {
              planningChanged = !openPlanning.body
                .split(/\r?\n/)
                .some((line) => line.trim() === `- ${admission.path}`)
              await project.controller.ensurePlanning(
                goalId,
                `Clarify and plan accepted Inbox turn ${eventId}.`,
                admission,
                { supportingWrites: references.writes, references: references.planning },
              )
            } else if (admission.write) {
              throw new Error(
                `Goal ${goalId} already exists; use request_planning or reopen it for a new instruction`,
              )
            }
          }
          return {
            summary: `Created Goal ${goalId}.`,
            changed:
              !existing ||
              Boolean(admission.write) ||
              planningChanged ||
              references.writes.length > 0,
            value: {
              projectId: project.projectId,
              goalId,
              references: references.planning,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, goalId),
            },
          }
        }
        case 'hopi_write_design': {
          const args = parseAssistantToolArguments(name, input)
          for (const write of args.writes)
            assertPortableGoalText(`Design ${write.path}`, write.content)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          await requireGoal(project.store, args.goalId)
          const references = await prepareGoalReferences(
            options.workspace,
            project.store,
            args.goalId,
            args.references,
          )
          const supportingWrites: PublicationWrite[] = [...references.writes]
          const normalizedWrites = new Map(
            args.writes.map((write) => [designPath(write.path, args.goalId), write.content]),
          )
          for (const [relative, source] of normalizedWrites) {
            const path = `${project.store.paths.designRoot(args.goalId)}/${relative}`
            const current = await currentBytes(project.store, path)
            const content = new TextEncoder().encode(normalizeMarkdown(source))
            if (current && equalBytes(current, content)) continue
            if (supportingWrites.some((write) => write.path === path)) {
              throw new Error(`Design write conflicts with adopted reference document: ${path}`)
            }
            supportingWrites.push({
              path,
              expectedHash: current ? await hashBytes(current) : null,
              content,
            })
          }
          const inputWrite = await newInputWrite(
            options.workspace,
            project.store,
            args.goalId,
            event,
          )
          if (supportingWrites.length > 0 || inputWrite) {
            await project.store.publishGoal(args.goalId, {
              supportingWrites,
              ...(inputWrite ? { gateWrite: inputWrite } : {}),
            })
          }
          return {
            summary: `Updated ${normalizedWrites.size} design document(s) for ${args.goalId}.`,
            changed: supportingWrites.length > 0 || Boolean(inputWrite),
            value: {
              projectId: project.projectId,
              goalId: args.goalId,
              writes: [...normalizedWrites.keys()],
              references: references.planning,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, args.goalId),
            },
          }
        }
        case 'hopi_request_planning': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          await requireGoal(project.store, args.goalId)
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            args.goalId,
            event,
          )
          const references = await prepareGoalReferences(
            options.workspace,
            project.store,
            args.goalId,
            args.references,
          )
          if (args.materialContractChange) {
            await project.controller.applyMaterialInstruction(args.goalId, {
              eventId,
              content: event.body,
              acceptedInput: admission,
              planningContext: {
                supportingWrites: references.writes,
                references: references.planning,
              },
            })
            project.reconciler?.interruptRuns(args.goalId)
          } else {
            await ensurePlanningWithRunInvalidation(
              project,
              args.goalId,
              `Interpret accepted Inbox turn ${eventId} against the current Goal and design.`,
              admission,
              { supportingWrites: references.writes, references: references.planning },
              referencedPlanningAttentionSettlement(event, project.projectId, args.goalId),
            )
          }
          return {
            summary: `Planning requested for ${args.goalId}.`,
            changed: true,
            value: {
              projectId: project.projectId,
              goalId: args.goalId,
              inputChanged: Boolean(admission.write),
              references: references.planning,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, args.goalId),
            },
          }
        }
        case 'hopi_control_goal': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          let goal = await requireGoal(project.store, args.goalId)
          let changed = false
          switch (args.operation) {
            case 'pause':
              if (goal.attributes.lifecycle === 'active') {
                await project.controller.pauseGoal(args.goalId)
                changed = true
              } else if (goal.attributes.lifecycle !== 'paused') {
                throw new Error(
                  `Goal ${args.goalId} cannot be paused from ${goal.attributes.lifecycle}`,
                )
              }
              break
            case 'resume':
              if (goal.attributes.lifecycle === 'paused') {
                await project.controller.resumeGoal(args.goalId)
                changed = true
              } else if (goal.attributes.lifecycle !== 'active') {
                throw new Error(
                  `Goal ${args.goalId} cannot be resumed from ${goal.attributes.lifecycle}`,
                )
              }
              break
            case 'cancel':
              if (goal.attributes.lifecycle !== 'cancelled') {
                await project.controller.cancelGoal(args.goalId)
                changed = true
              }
              break
            case 'reopen':
              if (goal.attributes.lifecycle !== 'active') {
                await project.controller.reopenGoal(args.goalId, { eventId, content: event.body })
                changed = true
              }
              break
            case 'set_priority':
              if (args.priority === undefined) throw new Error('set_priority requires priority')
              if (goal.attributes.priority !== args.priority) {
                goal = await project.controller.setPriority(args.goalId, args.priority)
                changed = true
              }
              break
          }
          if (changed && args.operation !== 'set_priority') {
            goal = await requireGoal(project.store, args.goalId)
          }
          const inputChanged = await publishInput(
            options.workspace,
            project.store,
            args.goalId,
            event,
          )
          return {
            summary: `${args.operation} applied to Goal ${args.goalId}.`,
            changed: changed || inputChanged,
            value: {
              projectId: project.projectId,
              goalId: args.goalId,
              lifecycle: goal.attributes.lifecycle,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, args.goalId),
            },
          }
        }
        case 'hopi_control_work': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          const goalPackage = await project.store.readPackage(args.goalId)
          const work = goalPackage.works.get(args.workId)
          if (!work) throw new Error(`Work not found: ${args.workId}`)
          let inputChanged = false
          if (args.operation === 'cancel') {
            const admission = await goalInputAdmission(
              options.workspace,
              project.store,
              args.goalId,
              event,
            )
            const affectedWorkIds = dependentWorkIds(goalPackage, args.workId)
            if (work.attributes.stage !== 'cancelled') {
              await project.controller.cancelWork(args.goalId, args.workId)
            }
            const cancelledPackage = await project.store.readPackage(args.goalId)
            let settledAttention = false
            for (const attention of cancelledPackage.attentions.values()) {
              if (attention.attributes.resolvedAt !== null) continue
              const target = attention.attributes.target
                ? parseWorkAttentionTarget(attention.attributes.target)
                : null
              if (
                !target ||
                target.projectId !== args.projectId ||
                target.goalId !== args.goalId ||
                !affectedWorkIds.has(target.workId) ||
                !isTerminalWork(cancelledPackage.works.get(target.workId))
              ) {
                continue
              }
              await resolveGoalAttention(
                project.store,
                args.goalId,
                attention.attributes.id,
                `Work ${target.workId} was cancelled and will no longer run.`,
                admission,
                now(),
              )
              settledAttention = true
            }
            if (!settledAttention && admission.write) {
              await project.store.publishGoal(args.goalId, {
                supportingWrites: [],
                gateWrite: admission.write,
              })
            }
            inputChanged = Boolean(admission.write)
          } else if (args.operation === 'retry') {
            await project.controller.retryWork(
              args.goalId,
              args.workId,
              args.notBefore === undefined ? work.attributes.notBefore : args.notBefore,
              {
                resolution: 'Assistant requested another run in the existing Work lineage.',
              },
            )
          } else {
            await project.controller.setWorkNotBefore(
              args.goalId,
              args.workId,
              args.notBefore ?? null,
            )
          }
          const [currentPackage, workspace, profile] = await Promise.all([
            project.store.readPackage(args.goalId),
            options.workspace.readWorkspace(),
            readSoftwareDeliveryProfile(),
          ])
          const currentWork = currentPackage.works.get(args.workId)
          if (!currentWork) throw new Error(`Work not found after control: ${args.workId}`)
          const projectEligible = ![...workspace.attentions.values()].some(
            (attention) =>
              attention.attributes.target === projectAttentionTarget(project.projectId) &&
              attention.attributes.resolvedAt === null,
          )
          const projection = deriveWorkProjection(
            project.projectId,
            args.goalId,
            currentWork.attributes,
            currentPackage,
            {
              projectEligible,
              liveRunWorkIds: new Set(),
              passCapacity: { planner: true, generator: true, reviewer: true },
              now: now(),
              maxAttempts: profile.retry.maxAttempts,
            },
          )
          return {
            summary: `${args.operation} applied to Work ${args.workId}.`,
            changed: true,
            value: {
              projectId: project.projectId,
              goalId: args.goalId,
              workId: args.workId,
              inputChanged,
              stage: currentWork.attributes.stage,
              notBefore: currentWork.attributes.notBefore,
              terminal: isWorkTerminal(currentWork.attributes),
              failedPredicates: projection.failedPredicates,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, args.goalId),
            },
          }
        }
        case 'hopi_resolve_attention': {
          const args = parseAssistantToolArguments(name, input)
          if (args.scope === 'workspace') {
            const state = await options.workspace.readWorkspace()
            const attention = state.attentions.get(args.attentionId)
            if (!attention) throw new Error(`Workspace Attention not found: ${args.attentionId}`)
            const projectTarget = parseProjectAttentionTarget(attention.attributes.target)
            if (projectTarget) requireProject(options.projects, projectTarget.projectId)
            const changed = attention.attributes.resolvedAt === null
            if (changed) {
              if (projectTarget) {
                options.onProjectDispatchEffect?.(eventId, projectTarget.projectId)
              }
              await options.workspace.resolveAttention(args.attentionId, args.resolution, now())
              if (projectTarget) {
                await options.onProjectAttentionResolved?.(projectTarget.projectId)
              }
            }
            return {
              summary: projectTarget
                ? changed
                  ? `Resolved Project Attention ${args.attentionId}; requested fresh reconciliation for Project ${projectTarget.projectId}.`
                  : `Project Attention ${args.attentionId} was already resolved.`
                : `Resolved Workspace Attention ${args.attentionId}.`,
              changed,
              value: {
                attentionId: args.attentionId,
                ...(projectTarget ? { projectId: projectTarget.projectId } : {}),
              },
            }
          }
          const project = requireProject(options.projects, args.projectId ?? '')
          const goalId = args.goalId ?? ''
          options.onGoalEffect?.(eventId, project.projectId, goalId)
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            goalId,
            event,
          )
          const changed = await resolveGoalAttention(
            project.store,
            goalId,
            args.attentionId,
            args.resolution,
            admission,
            now(),
          )
          return {
            summary: `Resolved Goal Attention ${args.attentionId}.`,
            changed,
            value: {
              projectId: project.projectId,
              goalId,
              attentionId: args.attentionId,
              remainingAttentionRefs: await remainingGoalAttentionRefs(project.store, goalId),
            },
          }
        }
        case 'hopi_control_preview': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          if (args.operation === 'start') {
            const result = await options.preview.start({
              projectId: project.projectId,
              projectRoot: project.sourceRoot ?? project.projectRoot,
              primaryRepoId: project.primaryRepoId,
              repoRoots: project.repos?.map((repo) => ({
                repoId: repo.repoId,
                path: resolveProjectPath(repo.integrationRoot, repo.projectPath),
              })),
            })
            return {
              summary: `Preview start requested for ${project.projectId}.`,
              changed: true,
              value: result,
            }
          }
          if (args.operation === 'stop') {
            const result = await options.preview.stop(project.projectId)
            return {
              summary: `Preview stopped for ${project.projectId}.`,
              changed: Boolean(result),
              value: result,
            }
          }
          throw new Error(`Unsupported Preview operation: ${args.operation satisfies never}`)
        }
        case 'hopi_notify_user':
        case 'hopi_request_user': {
          const args = parseAssistantToolArguments(name, input)
          if (
            event.attributes.source !== 'reflection' ||
            event.attributes.visibility !== 'internal'
          ) {
            throw new Error(`${name} is available only for an internal Reflection turn`)
          }
          if (name === 'hopi_notify_user') {
            await assertCompletionArtifactsLinked({
              context: event.attributes.context,
              message: args.message,
              projects: options.projects,
              state: options.state,
            })
          }
          return {
            summary:
              name === 'hopi_request_user'
                ? 'The supplied request will be shown to the operator and await their reply after this turn finishes.'
                : 'The supplied informational update will be shown to the operator after this turn finishes.',
            changed: false,
            value: {
              eventId,
              requested: true,
              intent: name === 'hopi_request_user' ? 'request' : 'inform',
              message: args.message,
              attentionRefs: event.attributes.context
                ? normalizeInboxAttentionReferences(event.attributes.context)
                : [],
            },
          }
        }
      }
    },
  }
}

async function assertCompletionArtifactsLinked(input: {
  context?: InboxContext | null
  message: string
  projects: ReadonlyMap<string, AssistantToolProject>
  state: AssistantStateReader
}) {
  if (!input.context) return
  const assessed = new Set<string>()
  for (const reference of normalizeInboxAttentionReferences(input.context)) {
    const parsed = parseAttentionReference(reference)
    if (!parsed || parsed.scope !== 'goal') continue
    const scope = `${parsed.projectId}/${parsed.goalId}`
    if (assessed.has(scope)) continue
    const project = input.projects.get(parsed.projectId)
    if (!project) continue
    const goalPackage = await project.store.readPackage(parsed.goalId)
    const attention = goalPackage.attentions.get(parsed.attentionId)
    if (
      !attention ||
      attention.attributes.target !== null ||
      attention.attributes.resolvedAt !== null ||
      goalPackage.goal.attributes.lifecycle !== 'done' ||
      goalPackage.goal.attributes.completionAttentionId !== parsed.attentionId
    ) {
      continue
    }
    assessed.add(scope)
    const state = await input.state.read({
      projectId: parsed.projectId,
      goalId: parsed.goalId,
      includeEvidence: true,
    })
    const operatorUrls = availableArtifactUrls(state)
    if (operatorUrls.length === 0 || operatorUrls.some((url) => input.message.includes(url))) {
      continue
    }
    throw new Error(
      `Completed Goal ${parsed.goalId} has available Evidence artifacts. Include at least one relevant operatorUrl in hopi_notify_user after reading the exact Goal with includeEvidence: true. Available operatorUrl values: ${operatorUrls.slice(0, 8).join(', ')}`,
    )
  }
}

function availableArtifactUrls(snapshot: AssistantStateSnapshot) {
  const urls = new Set<string>()
  for (const project of snapshot.projects) {
    if (!isRecord(project) || !Array.isArray(project.goals)) continue
    for (const goal of project.goals) {
      if (!isRecord(goal) || !Array.isArray(goal.works)) continue
      for (const work of goal.works) {
        if (!isRecord(work) || !Array.isArray(work.evidence)) continue
        for (const evidence of work.evidence) {
          if (!isRecord(evidence) || !Array.isArray(evidence.artifacts)) continue
          for (const artifact of evidence.artifacts) {
            if (
              isRecord(artifact) &&
              artifact.available === true &&
              typeof artifact.operatorUrl === 'string'
            ) {
              urls.add(artifact.operatorUrl)
            }
          }
        }
      }
    }
  }
  return [...urls].toSorted()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertPublicUserTurn(
  event: { attributes: { source: string; visibility: string } },
  subject: string,
) {
  if (event.attributes.source !== 'user' || event.attributes.visibility !== 'public') {
    throw new Error(`${subject} can be changed only from a public user turn`)
  }
}

function presentProjectTopology(project: LinkedProject) {
  return {
    projectId: project.projectId,
    primaryRepoId: project.primaryRepoId,
    repos: project.repos
      .map((repo) => ({
        repoId: repo.repoId,
        repoPath: repo.repoPath,
        projectPath: repo.projectPath,
        deliveryBranch: repo.deliveryBranch,
        primary: repo.primary,
      }))
      .toSorted((left, right) => left.repoId.localeCompare(right.repoId)),
  }
}

function sameProjectTopology(left: LinkedProject | undefined, right: LinkedProject) {
  return Boolean(left && sameValue(presentProjectTopology(left), presentProjectTopology(right)))
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function agentRoleLabel(role: ConfigurableAgentRole) {
  return role.charAt(0).toUpperCase() + role.slice(1)
}

async function remainingGoalAttentionRefs(store: GoalPackageStore, goalId: string) {
  const goalPackage = await store.readPackage(goalId)
  return [...goalPackage.attentions.values()]
    .filter(
      (attention) =>
        attention.attributes.target !== null && attention.attributes.resolvedAt === null,
    )
    .map((attention) =>
      goalAttentionReference(store.paths.projectId, goalId, attention.attributes.id),
    )
    .toSorted()
}

async function ensurePlanningWithRunInvalidation(
  project: AssistantToolProject,
  goalId: string,
  reason: string,
  acceptedInput?: PlanningInputAdmission,
  context: PlanningContext = {},
  settlement?: PlanningAttentionSettlement,
) {
  const before = await project.store.readPackage(goalId)
  const existing = [...before.works.values()].find(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  const planning = await project.controller.ensurePlanning(
    goalId,
    reason,
    acceptedInput,
    context,
    settlement,
  )
  const selectedAuthorityChanged =
    Boolean(acceptedInput?.write) || Boolean(context.supportingWrites?.length)

  if (
    existing?.attributes.id === planning.attributes.id &&
    (existing.body !== planning.body || selectedAuthorityChanged)
  ) {
    project.reconciler?.interruptRuns(goalId, planning.attributes.id)
  }
  return planning
}

function referencedPlanningAttentionSettlement(
  event: NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>,
  projectId: string,
  goalId: string,
): PlanningAttentionSettlement | undefined {
  const attentionIds = event.attributes.context
    ? normalizeInboxAttentionReferences(event.attributes.context).flatMap((reference) => {
        const parsed = parseAttentionReference(reference)
        return parsed?.scope === 'goal' &&
          parsed.projectId === projectId &&
          parsed.goalId === goalId
          ? [parsed.attentionId]
          : []
      })
    : []
  if (attentionIds.length === 0) return undefined
  return {
    attentionIds,
    resolution: 'Planning accepted this Inbox turn and now owns the represented continuation.',
  }
}

async function prepareGoalReferences(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  requested: readonly { attachmentRef: string; purpose: string }[],
) {
  const writes: PublicationWrite[] = []
  const planning: Array<{ path: string; purpose: string }> = []
  const seen = new Set<string>()
  const workspaceState = requested.length > 0 ? await workspace.readWorkspace() : null
  const referenceDocumentPath = `${store.paths.designRoot(goalId)}/references.md`
  const currentReferenceBytes = await currentBytes(store, referenceDocumentPath)
  let referenceDocument = currentReferenceBytes
    ? new TextDecoder().decode(currentReferenceBytes)
    : '# Goal References\n'

  for (const reference of requested) {
    if (seen.has(reference.attachmentRef)) continue
    seen.add(reference.attachmentRef)
    const sourceEvent = workspaceState
      ? [...workspaceState.events.values()]
          .filter(
            (candidate) =>
              candidate.attributes.source === 'user' &&
              candidate.attributes.visibility === 'public' &&
              candidate.attributes.attachments.includes(reference.attachmentRef),
          )
          .toSorted((left, right) =>
            left.attributes.receivedAt.localeCompare(right.attributes.receivedAt),
          )[0]
      : null
    if (!sourceEvent) {
      throw new Error(`Attachment is not owned by a public Inbox turn: ${reference.attachmentRef}`)
    }
    const attachment = await workspace.resolveAttachment(reference.attachmentRef)
    if (!attachment) {
      throw new Error(`Attachment is not a supported durable image: ${reference.attachmentRef}`)
    }
    const assetPath = store.paths.asset(goalId, attachment.contentHash, attachment.fileName)
    const currentAsset = await currentBytes(store, assetPath)
    if (currentAsset) {
      if ((await hashBytes(currentAsset)) !== attachment.contentHash) {
        throw new Error(`Immutable Goal image content mismatch: ${assetPath}`)
      }
    } else {
      writes.push({
        path: assetPath,
        expectedHash: null,
        content: new Uint8Array(await Bun.file(attachment.absolutePath).arrayBuffer()),
      })
    }
    const purpose = reference.purpose.trim().replace(/\s+/g, ' ')
    assertPortableGoalText('Goal reference purpose', purpose)
    planning.push({ path: assetPath, purpose })
    referenceDocument = appendGoalReference(
      referenceDocument,
      assetPath,
      attachment.fileName,
      sourceEvent.attributes.id,
      purpose,
    )
  }

  const normalizedReferenceDocument = normalizeMarkdown(referenceDocument)
  if (
    requested.length > 0 &&
    (!currentReferenceBytes ||
      !equalBytes(currentReferenceBytes, new TextEncoder().encode(normalizedReferenceDocument)))
  ) {
    writes.push({
      path: referenceDocumentPath,
      expectedHash: currentReferenceBytes ? await hashBytes(currentReferenceBytes) : null,
      content: normalizedReferenceDocument,
    })
  }
  return { writes, planning }
}

function appendGoalReference(
  source: string,
  assetPath: string,
  fileName: string,
  eventId: string,
  purpose: string,
) {
  const assetEntry = `- Asset: \`${assetPath}\``
  if (source.split(/\r?\n/).some((line) => line.trim() === assetEntry)) return source
  return [
    source.trimEnd(),
    '',
    `## ${fileName}`,
    '',
    assetEntry,
    `- Source: Inbox \`${eventId}\``,
    `- Purpose: ${purpose}`,
    '',
  ].join('\n')
}

async function publishInput(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>,
) {
  const write = await newInputWrite(workspace, store, goalId, event)
  if (!write) return false
  await store.publishGoal(goalId, { supportingWrites: [], gateWrite: write })
  return true
}

async function newInputWrite(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>,
) {
  return (await goalInputAdmission(workspace, store, goalId, event)).write
}

async function goalInputAdmission(
  workspace: AssistantWorkspaceStore,
  store: GoalPackageStore,
  goalId: string,
  event: NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>,
  requireExistingGoal = true,
) {
  if (requireExistingGoal) await requireGoal(store, goalId)
  const state = await workspace.readWorkspace()
  const path = store.paths.inputDocument(goalId, state.homeId, event.attributes.id)
  const document = {
    attributes: {
      sourceHomeId: state.homeId,
      sourceEventId: event.attributes.id,
      sourceDigest: event.attributes.sourceDigest,
      attachments: [...event.attributes.attachments],
    },
    body: event.body,
  }
  const expected = renderInputDocument(document)
  const file = Bun.file(store.paths.absolute(path))
  if (await file.exists()) {
    const current = parseInputDocument(await file.text())
    const rendered = renderInputDocument(current)
    if (rendered !== expected)
      throw new Error(`Goal Input conflicts with Inbox turn ${event.attributes.id}`)
    return { path, document, write: null }
  }
  return {
    path,
    document,
    write: { path, expectedHash: null, content: expected } satisfies PublicationWrite,
  }
}

async function resolveGoalAttention(
  store: GoalPackageStore,
  goalId: string,
  attentionId: string,
  resolution: string,
  admission: Awaited<ReturnType<typeof goalInputAdmission>>,
  resolvedAt: Date,
) {
  const path = store.paths.attentionDocument(goalId, attentionId)
  const absolutePath = store.paths.absolute(path)
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) throw new Error(`Goal Attention not found: ${attentionId}`)
  const source = await file.text()
  const attention = parseAttentionDocument(source)
  if (attention.attributes.resolvedAt !== null) return false
  await assertAttentionBlockerChanged(store, goalId, attention.attributes.target)
  attention.attributes.operatorRequest = null
  attention.attributes.resolvedAt = resolvedAt.toISOString()
  attention.attributes.resolutionInput = admission.path
  attention.body = [
    attention.body.trimEnd(),
    '',
    '## Resolution',
    '',
    `Answer Input: \`${admission.path}\``,
    '',
    resolution.trim(),
    '',
  ].join('\n')
  await store.publishGoal(goalId, {
    supportingWrites: admission.write ? [admission.write] : [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(attention),
    },
  })
  return true
}

async function assertAttentionBlockerChanged(
  store: GoalPackageStore,
  goalId: string,
  target: string | null,
) {
  const match = target ? parseWorkAttentionTarget(target) : null
  if (!match) return
  if (match.projectId !== store.paths.projectId || match.goalId !== goalId) {
    throw new Error(`Goal Attention has an invalid Work target: ${target}`)
  }
  const work = (await store.readPackage(goalId)).works.get(match.workId)
  if (!work || isWorkTerminal(work.attributes)) return
  const profile = await readSoftwareDeliveryProfile()
  if (work.attributes.attempts >= profile.retry.maxAttempts) {
    throw new Error(
      `Work ${match.workId} is still exhausted; retry, cancel, or revise it before resolving Attention`,
    )
  }
}

function requireProject(projects: ReadonlyMap<string, AssistantToolProject>, projectId: string) {
  const project = projects.get(projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)
  return project
}

function dependentWorkIds(
  goalPackage: Awaited<ReturnType<GoalPackageStore['readPackage']>>,
  rootId: string,
) {
  const closure = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const work of goalPackage.works.values()) {
      if (
        !closure.has(work.attributes.id) &&
        work.attributes.dependsOn.some((dependencyId) => closure.has(dependencyId))
      ) {
        closure.add(work.attributes.id)
        changed = true
      }
    }
  }
  return closure
}

function isTerminalWork(work: WorkDocument | undefined) {
  return Boolean(work && isWorkTerminal(work.attributes))
}

async function requireGoal(store: GoalPackageStore, goalId: string) {
  const goal = await store.readGoal(goalId)
  if (!goal) throw new Error(`Goal not found: ${goalId}`)
  return goal
}

function designPath(path: string, goalId: string) {
  const canonicalPrefix = `.hopi/docs/goals/${goalId}/design/`
  const portable = path.replaceAll('\\', '/')
  const normalized = portable.startsWith(canonicalPrefix)
    ? portable.slice(canonicalPrefix.length)
    : portable.replace(/^design\//, '')
  if (
    !normalized.endsWith('.md') ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('.hopi') ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid Goal design path: ${path}`)
  }
  return normalized
}

function normalizeMarkdown(content: string) {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function assertPortableGoalText(label: string, content: string) {
  const reference = findNonPortableGoalImageReference(content)
  if (reference) {
    throw new Error(
      `${label} cannot cite non-portable image path ${reference}; adopt the image through references and let Planning cite the returned Goal-local asset path`,
    )
  }
}

async function currentBytes(store: GoalPackageStore, path: string) {
  const file = Bun.file(store.paths.absolute(path))
  return (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
