import type { InboxContext } from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from '../domain/attentionReference'
import {
  parseProjectAttentionTarget,
  parseWorkAttentionTarget,
  workAttentionTarget,
} from '../domain/attentionTarget'
import {
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseInputDocument,
  renderAttentionDocument,
  renderInputDocument,
} from '../domain/canonicalDocuments'
import { findNonPortableGoalImageReference } from '../domain/goalImageReference'
import { inboxEventReference, parseInboxEventReference } from '../domain/inboxEventReference'
import type { LinkedProject, LinkedProjectRepo } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import { deriveReadableId } from '../domain/stableId'
import { workCancellationClosure } from '../domain/workCancellation'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import {
  acknowledgeGoalAttention,
  clearGoalAttentionOperatorRequest,
} from '../runtime/attentionDelivery'
import type {
  GoalController,
  PlanningContext,
  PlanningInputAdmission,
} from '../runtime/goalController'
import type { PreviewManager } from '../runtime/previewManager'
import { withPreparedProjectRepositories } from '../runtime/projectDirectory'
import { readSoftwareDeliveryProfile } from '../runtime/softwareDeliveryProfile'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { AssistantStateReader, AssistantStateSnapshot } from './assistantState'
import { AssistantToolRequestError } from './assistantToolRequestError'
import {
  type AssistantToolName,
  type MainAssistantToolName,
  internalAssistantToolNames,
  mainAssistantToolNames,
  parseAssistantToolArguments,
  publicAssistantToolNames,
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
  finalizeInternalResponse(
    token: string,
    eventId: string,
    message: string,
  ): Promise<'silent' | 'inform' | 'request'>
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
  onProjectTopologyChanged?: (eventId: string, project: LinkedProject) => void | Promise<void>
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
        requestedAttentionRefs: readonly string[] | null
      }
    | {
        mode: 'reflection'
        reflectionId: string
        expiresAt: number
        handedOff: boolean
        onHandoff?: (handoff: { brief: string; context?: InboxContext }) => void
      }
  const capabilities = new Map<string, Capability>()
  const assistantDispatchQueues = new Map<string, Promise<void>>()
  const now = options.now ?? (() => new Date())

  async function serializeAssistantDispatch<T>(
    dispatchReference: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = assistantDispatchQueues.get(dispatchReference) ?? Promise.resolve()
    let release: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    assistantDispatchQueues.set(dispatchReference, queued)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (assistantDispatchQueues.get(dispatchReference) === queued) {
        assistantDispatchQueues.delete(dispatchReference)
      }
    }
  }

  async function findAssistantDispatch(dispatchReference: string) {
    for (const project of options.projects.values()) {
      for (const goalId of await project.store.listGoalIds()) {
        const goalPackage = await project.store.readPackage(goalId)
        for (const work of goalPackage.works.values()) {
          if (
            isEngineeringWork(work.attributes) &&
            work.attributes.assistantDispatch === dispatchReference
          ) {
            return { project, goalId, work }
          }
        }
      }
    }
    return null
  }

  async function cancelWorkAndSettle(
    project: AssistantToolProject,
    goalId: string,
    workId: string,
    event: NonNullable<Awaited<ReturnType<AssistantWorkspaceStore['readEvent']>>>,
  ) {
    const before = await project.store.readPackage(goalId)
    const work = before.works.get(workId)
    if (!work) throw new AssistantToolRequestError(`Work not found: ${workId}`)
    const admission = await goalInputAdmission(options.workspace, project.store, goalId, event)
    const affectedWorkIds = dependentWorkIds(before, workId)
    if (work.attributes.stage !== 'cancelled') {
      await project.controller.cancelWork(goalId, workId)
    }
    const cancelledPackage = await project.store.readPackage(goalId)
    const settledRefs: string[] = []
    let inputWrite = admission.write
    for (const attention of cancelledPackage.attentions.values()) {
      if (attention.attributes.resolvedAt !== null) continue
      const target = attention.attributes.target
        ? parseWorkAttentionTarget(attention.attributes.target)
        : null
      if (
        !target ||
        target.projectId !== project.projectId ||
        target.goalId !== goalId ||
        !affectedWorkIds.has(target.workId) ||
        !isTerminalWork(cancelledPackage.works.get(target.workId))
      ) {
        continue
      }
      if (
        await resolveGoalAttention(
          project.store,
          goalId,
          attention.attributes.id,
          `Work ${target.workId} was cancelled and will no longer run.`,
          { ...admission, write: inputWrite },
          now(),
        )
      ) {
        settledRefs.push(goalAttentionReference(project.projectId, goalId, attention.attributes.id))
      }
      inputWrite = null
    }
    if (settledRefs.length === 0 && inputWrite) {
      await project.store.publishGoal(goalId, { supportingWrites: [], gateWrite: inputWrite })
    }
    return {
      affectedWorkIds: [...affectedWorkIds].toSorted(),
      settledRefs: settledRefs.toSorted(),
    }
  }

  async function currentWorkResult(input: {
    project: AssistantToolProject
    goalId: string
    workId: string
    kind: 'work_retried' | 'work_cancelled' | 'work_deferred'
    affectedWorkIds?: readonly string[]
    settledRefs?: readonly string[]
  }): Promise<AssistantToolResult> {
    const currentPackage = await input.project.store.readPackage(input.goalId)
    const currentWork = currentPackage.works.get(input.workId)
    if (!currentWork) throw new Error(`Work not found after control: ${input.workId}`)
    return {
      summary: `${input.kind} applied to Work ${input.workId}.`,
      changed: true,
      value: {
        effect: {
          kind: input.kind,
          projectId: input.project.projectId,
          goalId: input.goalId,
          workId: input.workId,
          affectedWorkIds: input.affectedWorkIds ?? [input.workId],
          stage: currentWork.attributes.stage,
          notBefore: currentWork.attributes.notBefore,
        },
        settledAttentionRefs: input.settledRefs ?? [],
      },
    }
  }

  return {
    issue(eventId) {
      const token = crypto.randomUUID()
      capabilities.set(token, {
        mode: 'main',
        eventId,
        expiresAt: Date.now() + 60 * 60 * 1_000,
        requestedAttentionRefs: null,
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

    async finalizeInternalResponse(token, eventId, message) {
      const capability = capabilities.get(token)
      if (capability?.mode !== 'main' || capability.eventId !== eventId) {
        throw new AssistantToolRequestError('Assistant tool capability does not own this turn')
      }
      const event = await options.workspace.readEvent(eventId)
      if (
        !event ||
        event.attributes.status !== 'pending' ||
        event.attributes.source !== 'reflection' ||
        event.attributes.visibility !== 'internal'
      ) {
        throw new AssistantToolRequestError('Internal response no longer owns a pending turn')
      }
      const reply = message.trim()
      const references = capability.requestedAttentionRefs
      if (references) {
        if (!reply) {
          throw new AssistantToolRequestError(
            'request_user requires a non-empty final response containing the operator question',
          )
        }
        const expected = event.attributes.context
          ? normalizeInboxAttentionReferences(event.attributes.context)
          : []
        if (!sameReferences(references, expected)) {
          throw new AssistantToolRequestError(
            'request_user must name exactly the Attention references selected for this internal turn',
          )
        }
        await assertAssistantOwnedAttentionRefs(references, event.attributes.context)
        return 'request'
      }
      if (!reply) return 'silent'
      await assertCompletionArtifactsLinked({
        context: event.attributes.context,
        message: reply,
        projects: options.projects,
        state: options.state,
      })
      return 'inform'
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
            throw new AssistantToolRequestError(
              `Workspace Attention reference belongs to another Home: ${reference}`,
            )
          }
          const attention = workspace.attentions.get(parsed.attentionId)
          if (!attention)
            throw new AssistantToolRequestError(`Workspace Attention not found: ${reference}`)
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
        if (!project)
          throw new AssistantToolRequestError(
            `Attention Project is unavailable: ${parsed.projectId}`,
          )
        const goalPackage = await project.store.readPackage(parsed.goalId)
        const attention = goalPackage.attentions.get(parsed.attentionId)
        if (!attention)
          throw new AssistantToolRequestError(`Goal Attention not found: ${reference}`)
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
          throw new AssistantToolRequestError(
            `Goal Attention could not be acknowledged: ${reference}`,
          )
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
      const parsedRequest = parseInboxEventReference(expectedRequest)
      if (!parsedRequest || parsedRequest.homeId !== workspace.homeId) {
        throw new AssistantToolRequestError(
          `Inbox replyTo belongs to another Home: ${expectedRequest}`,
        )
      }
      const requestEvent = workspace.events.get(parsedRequest.eventId)
      if (
        !requestEvent ||
        requestEvent.attributes.visibility !== 'public' ||
        requestEvent.attributes.status !== 'handled' ||
        requestEvent.attributes.disposition !== 'operator-requested'
      ) {
        throw new AssistantToolRequestError(
          `Inbox replyTo is not an active operator request: ${expectedRequest}`,
        )
      }
      const references = normalizeInboxAttentionReferences(event.attributes.context)
      if (
        references.length === 0 ||
        references.some((reference) => !parseAttentionReference(reference))
      ) {
        throw new AssistantToolRequestError(
          'Explicit Attention reply requires complete canonical Attention references',
        )
      }
      const requestReferences = new Set(
        requestEvent.attributes.context
          ? normalizeInboxAttentionReferences(requestEvent.attributes.context)
          : [],
      )
      const accepted: string[] = []
      for (const reference of references) {
        if (!requestReferences.has(reference)) {
          throw new AssistantToolRequestError(
            `Attention was not requested by replyTo: ${reference}`,
          )
        }
        const parsed = parseAttentionReference(reference)
        if (!parsed)
          throw new AssistantToolRequestError(`Invalid Attention reference: ${reference}`)
        if (parsed.scope === 'workspace') {
          if (parsed.homeId !== workspace.homeId) {
            throw new AssistantToolRequestError(
              `Workspace Attention reference belongs to another Home: ${reference}`,
            )
          }
          const current = workspace.attentions.get(parsed.attentionId)
          if (!current)
            throw new AssistantToolRequestError(`Workspace Attention not found: ${reference}`)
          if (current.attributes.resolvedAt !== null) continue
          const operatorRequest = current.attributes.operatorRequest ?? null
          if (operatorRequest === null) {
            accepted.push(reference)
            continue
          }
          await options.workspace.clearAttentionOperatorRequest(parsed.attentionId, operatorRequest)
          accepted.push(reference)
          continue
        }
        const project = options.projects.get(parsed.projectId)
        if (!project)
          throw new AssistantToolRequestError(
            `Attention Project is unavailable: ${parsed.projectId}`,
          )
        const attention = (await project.store.readPackage(parsed.goalId)).attentions.get(
          parsed.attentionId,
        )
        if (!attention)
          throw new AssistantToolRequestError(`Goal Attention not found: ${reference}`)
        if (attention.attributes.resolvedAt !== null) continue
        const operatorRequest = attention.attributes.operatorRequest ?? null
        if (operatorRequest === null) {
          accepted.push(reference)
          continue
        }
        await clearGoalAttentionOperatorRequest(
          project.store,
          parsed.goalId,
          parsed.attentionId,
          operatorRequest,
        )
        accepted.push(reference)
      }
      return accepted
    },

    async execute(token, name, input) {
      const capability = capabilities.get(token)
      if (!capability || capability.expiresAt < Date.now()) {
        capabilities.delete(token)
        throw new AssistantToolRequestError('Assistant tool capability is invalid or expired')
      }
      if (capability.mode === 'reflection') {
        if (!reflectionAssistantToolNames.includes(name as never)) {
          throw new AssistantToolRequestError(`Reflection cannot call ${name}`)
        }
        if (name === 'hopi_read_state') {
          const args = parseAssistantToolArguments(name, input)
          const state = await options.state.read({ ...args, includeEvidence: false })
          return {
            summary: 'Read current HOPI state.',
            changed: false,
            value: assistantToolStateProjection(state, args),
          }
        }
        if (name !== 'hopi_handoff_to_main')
          throw new AssistantToolRequestError(`Unsupported Reflection tool: ${name}`)
        if (capability.handedOff)
          throw new AssistantToolRequestError('Reflection already handed off one brief')
        const args = parseAssistantToolArguments(name, input)
        if (args.context) {
          if (args.context.projectId && args.context.goalId) {
            const project = requireProject(options.projects, args.context.projectId)
            await project.store.readPackage(args.context.goalId)
          }
          if (args.context.attentionRefs) {
            await assertAssistantOwnedAttentionRefs(args.context.attentionRefs, args.context, true)
          }
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
        throw new AssistantToolRequestError(`Speaking thread cannot call ${name}`)
      }
      const result = await this.executeForEvent(
        capability.eventId,
        name as MainAssistantToolName,
        input,
      )
      if (name === 'hopi_request_user') {
        capability.requestedAttentionRefs = parseAssistantToolArguments(name, input).attentionRefs
      }
      return result
    },

    async executeForEvent(eventId, name, input) {
      const event = await options.workspace.readEvent(eventId)
      if (!event) throw new AssistantToolRequestError(`Inbox turn not found: ${eventId}`)
      if (event.attributes.status !== 'pending') {
        throw new AssistantToolRequestError(`Inbox turn is already handled: ${eventId}`)
      }
      const allowedTools =
        event.attributes.source === 'reflection'
          ? internalAssistantToolNames
          : publicAssistantToolNames
      if (!allowedTools.includes(name as never)) {
        throw new AssistantToolRequestError(
          `${name} is not available for this ${event.attributes.source} turn`,
        )
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
            state = assistantToolStateProjection(state, { projectId, goalId })
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            const pageContext = context?.projectId
              ? ` Current page context is ${context.projectId}${context.goalId ? ` / ${context.goalId}` : ''}; omit projectId and goalId to use it exactly.`
              : ''
            const message = `${detail}.${pageContext}`
            if (error instanceof AssistantToolRequestError) {
              throw new AssistantToolRequestError(message)
            }
            throw new Error(message)
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
          const change = args.change
          const before = await options.home.listProjects()
          let project: LinkedProject
          switch (change.kind) {
            case 'create':
              project = await withPreparedProjectRepositories(change.repos, (repos) =>
                options.home.linkProject({
                  ...(change.projectId ? { projectId: change.projectId } : {}),
                  primaryRepoId: change.primaryRepoId,
                  repos,
                }),
              )
              break
            case 'add_repo':
              project = await withPreparedProjectRepositories([change.repo], ([repo]) => {
                if (!repo) throw new Error('Prepared Repo is missing')
                return options.home.linkRepo({ projectId: change.projectId, ...repo })
              })
              break
            case 'rebind_repos': {
              const current = await options.home.readProject(change.projectId)
              const replacements = new Map(change.repos.map((repo) => [repo.repoId, repo]))
              if (replacements.size !== change.repos.length) {
                throw new AssistantToolRequestError('Rebound Repo IDs must be unique')
              }
              for (const repoId of replacements.keys()) {
                if (!current.repos.some((repo) => repo.repoId === repoId)) {
                  throw new AssistantToolRequestError(
                    `Project ${change.projectId} has no Repo ${repoId}`,
                  )
                }
              }
              project = await options.home.rebindRepos({
                projectId: change.projectId,
                repos: current.repos.map((repo) => {
                  const replacement = replacements.get(repo.repoId)
                  return replacement
                    ? replacement
                    : {
                        repoId: repo.repoId,
                        repoPath: repo.repoPath,
                        projectPath: repo.projectPath,
                      }
                }),
              })
              break
            }
          }
          const previous = before.find((candidate) => candidate.projectId === project.projectId)
          const changed = !sameProjectTopology(previous, project)
          if (changed) await options.onProjectTopologyChanged?.(eventId, project)
          return {
            summary: changed
              ? `Updated Project ${project.projectId} topology.`
              : `Project ${project.projectId} topology was already current.`,
            changed,
            value: {
              effect: { kind: change.kind, projectId: project.projectId },
              project: presentProjectTopology(project),
              runtimeRefresh: changed ? 'after_current_turn' : 'not_needed',
            },
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
          const firstWork = args.firstWork
          if (firstWork.kind === 'engineering') {
            assertPortableGoalText('Engineering Work title', firstWork.title)
            assertPortableGoalText('Engineering Work objective', firstWork.objective)
            for (const criterion of firstWork.acceptanceCriteria) {
              assertPortableGoalText('Engineering Work acceptance criterion', criterion)
            }
            const initialWork = {
              title: firstWork.title,
              objective: firstWork.objective,
              acceptanceCriteria: firstWork.acceptanceCriteria,
              repos: firstWork.repos,
            }
            assertLinkedRepos(project, initialWork.repos)
            const workspace = await options.workspace.readWorkspace()
            const dispatchReference = inboxEventReference(workspace.homeId, eventId)
            return serializeAssistantDispatch(dispatchReference, async () => {
              const dispatched = await findAssistantDispatch(dispatchReference)
              const targetGoalId = args.goalId ?? dispatched?.goalId ?? goalId
              options.onGoalEffect?.(eventId, project.projectId, targetGoalId)
              if (
                dispatched &&
                (dispatched.project.projectId !== project.projectId ||
                  dispatched.goalId !== targetGoalId)
              ) {
                throw new AssistantToolRequestError(
                  `Inbox Input already directly admitted Engineering Work ${dispatched.work.attributes.id} in ${dispatched.project.projectId}/${dispatched.goalId}; request Planning for additional Work`,
                )
              }
              const existing = await project.store.readGoal(targetGoalId)
              if (
                existing &&
                (existing.attributes.title !== args.title ||
                  !existing.body.includes(args.objective))
              ) {
                throw new AssistantToolRequestError(
                  `Goal ${targetGoalId} already exists with different content`,
                )
              }
              const admission = await goalInputAdmission(
                options.workspace,
                project.store,
                targetGoalId,
                event,
                false,
              )
              const references = await prepareGoalReferences(
                options.workspace,
                project.store,
                targetGoalId,
                args.references,
              )
              let work: WorkDocument
              if (existing) {
                if (!dispatched) {
                  throw new AssistantToolRequestError(
                    `Goal ${targetGoalId} already exists; use hopi_create_work for a new instruction`,
                  )
                }
                work = await project.controller.admitAssistantEngineeringWork(targetGoalId, {
                  ...initialWork,
                  dependsOn: [],
                  assistantDispatch: dispatchReference,
                  acceptedInput: admission,
                  context: {
                    supportingWrites: references.writes,
                    references: references.planning,
                  },
                })
              } else {
                await project.store.createGoal({
                  goalId: targetGoalId,
                  title: args.title,
                  objective: args.objective,
                  priority: args.priority,
                  acceptedInput: admission.document,
                  supportingWrites: references.writes,
                  planningReferences: references.planning,
                  initialEngineeringWork: {
                    id: deriveReadableId('W', initialWork.title, []),
                    ...initialWork,
                    assistantDispatch: dispatchReference,
                  },
                })
                const created = [
                  ...(await project.store.readPackage(targetGoalId)).works.values(),
                ].find(
                  (candidate) =>
                    isEngineeringWork(candidate.attributes) &&
                    candidate.attributes.assistantDispatch === dispatchReference,
                )
                if (!created) throw new Error('Direct initial Engineering Work was not published')
                work = created
              }
              return {
                summary: `Created Goal ${targetGoalId} with direct Engineering Work ${work.attributes.id}; initial Planning was explicitly skipped.`,
                changed: !dispatched,
                value: {
                  effect: {
                    kind: 'goal_created',
                    projectId: project.projectId,
                    goalId: targetGoalId,
                    workId: work.attributes.id,
                    workKind: 'engineering',
                  },
                  references: references.planning,
                },
              }
            })
          }
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
            throw new AssistantToolRequestError(
              `Goal ${goalId} already exists with different content`,
            )
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
                standardPlanningObjective(eventId),
                admission,
                {
                  supportingWrites: references.writes,
                  references: references.planning,
                },
              )
            } else if (admission.write) {
              throw new AssistantToolRequestError(
                `Goal ${goalId} already exists; use hopi_create_work or reopen it for a new instruction`,
              )
            }
          }
          const planningWork = [...(await project.store.readPackage(goalId)).works.values()].find(
            (work) => work.attributes.kind === 'planning',
          )
          if (!planningWork) throw new Error('Initial Planning Work was not published')
          return {
            summary: `Created Goal ${goalId} with Planning Work ${planningWork.attributes.id}.`,
            changed:
              !existing ||
              Boolean(admission.write) ||
              planningChanged ||
              references.writes.length > 0,
            value: {
              effect: {
                kind: 'goal_created',
                projectId: project.projectId,
                goalId,
                workId: planningWork.attributes.id,
                workKind: 'planning',
              },
              references: references.planning,
            },
          }
        }
        case 'hopi_create_work': {
          const args = parseAssistantToolArguments(name, input)
          const requestedWork = args.work
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
          if (requestedWork.kind === 'planning') {
            let planning: WorkDocument
            if (requestedWork.mode === 'new_contract_revision') {
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
              const current = await project.store.readPackage(args.goalId)
              const activePlanning = [...current.works.values()].find(
                (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
              )
              if (!activePlanning) {
                throw new Error(`Planning Work was not created for ${args.goalId}`)
              }
              planning = activePlanning
            } else {
              planning = await ensurePlanningWithRunInvalidation(
                project,
                args.goalId,
                standardPlanningObjective(eventId),
                admission,
                { supportingWrites: references.writes, references: references.planning },
              )
            }
            return {
              summary: `Created Planning Work ${planning.attributes.id} for ${args.goalId}.`,
              changed: true,
              value: {
                effect: {
                  kind: 'planning_created',
                  projectId: project.projectId,
                  goalId: args.goalId,
                  workId: planning.attributes.id,
                  mode: requestedWork.mode,
                },
                references: references.planning,
              },
            }
          }
          assertPortableGoalText('Engineering Work title', requestedWork.title)
          assertPortableGoalText('Engineering Work objective', requestedWork.objective)
          for (const criterion of requestedWork.acceptanceCriteria) {
            assertPortableGoalText('Engineering Work acceptance criterion', criterion)
          }
          assertLinkedRepos(project, requestedWork.repos)
          const workspace = await options.workspace.readWorkspace()
          const dispatchReference = inboxEventReference(workspace.homeId, eventId)
          return serializeAssistantDispatch(dispatchReference, async () => {
            const dispatched = await findAssistantDispatch(dispatchReference)
            if (
              dispatched &&
              (dispatched.project.projectId !== project.projectId ||
                dispatched.goalId !== args.goalId)
            ) {
              throw new AssistantToolRequestError(
                `Inbox Input already directly admitted Engineering Work ${dispatched.work.attributes.id} in ${dispatched.project.projectId}/${dispatched.goalId}; request Planning for additional Work`,
              )
            }
            const work = await project.controller.admitAssistantEngineeringWork(args.goalId, {
              title: requestedWork.title,
              objective: requestedWork.objective,
              acceptanceCriteria: requestedWork.acceptanceCriteria,
              repos: requestedWork.repos,
              dependsOn: requestedWork.dependsOn,
              assistantDispatch: dispatchReference,
              acceptedInput: admission,
              context: {
                supportingWrites: references.writes,
                references: references.planning,
              },
            })
            return {
              summary: `Created Engineering Work ${work.attributes.id} for ${args.goalId}.`,
              changed: !dispatched,
              value: {
                effect: {
                  kind: 'engineering_created',
                  projectId: project.projectId,
                  goalId: args.goalId,
                  workId: work.attributes.id,
                },
                references: references.planning,
              },
            }
          })
        }
        case 'hopi_write_design': {
          const args = parseAssistantToolArguments(name, input)
          const documentChanges = args.changes.filter(
            (change): change is Extract<(typeof args.changes)[number], { kind: 'document' }> =>
              change.kind === 'document',
          )
          const attachmentChanges = args.changes.filter(
            (change): change is Extract<(typeof args.changes)[number], { kind: 'attachment' }> =>
              change.kind === 'attachment',
          )
          for (const write of documentChanges)
            assertPortableGoalText(`Design ${write.path}`, write.content)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          await requireGoal(project.store, args.goalId)
          const references = await prepareGoalReferences(
            options.workspace,
            project.store,
            args.goalId,
            attachmentChanges,
          )
          const supportingWrites: PublicationWrite[] = [...references.writes]
          const normalizedWrites = new Map(
            documentChanges.map((write) => [designPath(write.path, args.goalId), write.content]),
          )
          for (const [relative, source] of normalizedWrites) {
            const path = `${project.store.paths.designRoot(args.goalId)}/${relative}`
            const current = await currentBytes(project.store, path)
            const content = new TextEncoder().encode(normalizeMarkdown(source))
            if (current && equalBytes(current, content)) continue
            if (supportingWrites.some((write) => write.path === path)) {
              throw new AssistantToolRequestError(
                `Design write conflicts with adopted reference document: ${path}`,
              )
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
              effect: { kind: 'design_changed', projectId: project.projectId, goalId: args.goalId },
              documents: [...normalizedWrites.keys()],
              references: references.planning,
            },
          }
        }
        case 'hopi_control_work': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          const goalPackage = await project.store.readPackage(args.goalId)
          const work = goalPackage.works.get(args.workId)
          if (!work) throw new AssistantToolRequestError(`Work not found: ${args.workId}`)
          if (args.action.kind === 'cancel' && !isEngineeringWork(work.attributes)) {
            throw new AssistantToolRequestError(
              `Only Engineering Work can be cancelled: ${args.workId}`,
            )
          }
          if (args.action.kind === 'retry') {
            const settledRefs = openWorkAttentionRefs(
              goalPackage,
              project.projectId,
              args.goalId,
              args.workId,
            )
            await project.controller.retryWork(
              args.goalId,
              args.workId,
              args.action.notBefore === undefined
                ? work.attributes.notBefore
                : args.action.notBefore,
              { resolution: 'Assistant requested another run in the existing Work lineage.' },
            )
            return currentWorkResult({
              project,
              goalId: args.goalId,
              workId: args.workId,
              kind: 'work_retried',
              settledRefs,
            })
          }
          if (args.action.kind === 'defer') {
            await project.controller.setWorkNotBefore(
              args.goalId,
              args.workId,
              args.action.notBefore,
            )
            return currentWorkResult({
              project,
              goalId: args.goalId,
              workId: args.workId,
              kind: 'work_deferred',
            })
          }
          const effect = await cancelWorkAndSettle(project, args.goalId, args.workId, event)
          return currentWorkResult({
            project,
            goalId: args.goalId,
            workId: args.workId,
            kind: 'work_cancelled',
            ...effect,
          })
        }
        case 'hopi_control_goal': {
          const args = parseAssistantToolArguments(name, input)
          const project = requireProject(options.projects, args.projectId)
          options.onGoalEffect?.(eventId, project.projectId, args.goalId)
          let goal = await requireGoal(project.store, args.goalId)
          let changed = false
          switch (args.action.kind) {
            case 'pause':
              if (goal.attributes.lifecycle === 'active') {
                await project.controller.pauseGoal(args.goalId)
                changed = true
              } else if (goal.attributes.lifecycle !== 'paused') {
                throw new AssistantToolRequestError(
                  `Goal ${args.goalId} cannot be paused from ${goal.attributes.lifecycle}`,
                )
              }
              break
            case 'resume':
              if (goal.attributes.lifecycle === 'paused') {
                await project.controller.resumeGoal(args.goalId)
                changed = true
              } else if (goal.attributes.lifecycle !== 'active') {
                throw new AssistantToolRequestError(
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
              if (goal.attributes.priority !== args.action.priority) {
                goal = await project.controller.setPriority(args.goalId, args.action.priority)
                changed = true
              }
              break
          }
          if (changed && args.action.kind !== 'set_priority') {
            goal = await requireGoal(project.store, args.goalId)
          }
          const inputChanged = await publishInput(
            options.workspace,
            project.store,
            args.goalId,
            event,
          )
          return {
            summary: `${args.action.kind} applied to Goal ${args.goalId}.`,
            changed: changed || inputChanged,
            value: {
              effect: {
                kind: `goal_${args.action.kind}`,
                projectId: project.projectId,
                goalId: args.goalId,
              },
              lifecycle: goal.attributes.lifecycle,
              priority: goal.attributes.priority,
            },
          }
        }
        case 'hopi_resolve_attention': {
          const args = parseAssistantToolArguments(name, input)
          const resolved = parseAttentionReference(args.attentionRef)
          if (!resolved)
            throw new AssistantToolRequestError(`Invalid Attention reference: ${args.attentionRef}`)
          if (resolved.scope === 'workspace') {
            const state = await options.workspace.readWorkspace()
            if (resolved.homeId !== state.homeId) {
              throw new AssistantToolRequestError(
                `Workspace Attention belongs to another Home: ${args.attentionRef}`,
              )
            }
            const attention = state.attentions.get(resolved.attentionId)
            if (!attention)
              throw new AssistantToolRequestError(
                `Workspace Attention not found: ${args.attentionRef}`,
              )
            const projectTarget = parseProjectAttentionTarget(attention.attributes.target)
            if (projectTarget) requireProject(options.projects, projectTarget.projectId)
            if (attention.attributes.resolvedAt === null) {
              if (projectTarget) {
                options.onProjectDispatchEffect?.(eventId, projectTarget.projectId)
              }
              await options.workspace.resolveAttention(resolved.attentionId, args.resolution, now())
              if (projectTarget) {
                await options.onProjectAttentionResolved?.(projectTarget.projectId)
              }
            }
            return {
              summary: `Resolved Workspace Attention ${resolved.attentionId}.`,
              changed: attention.attributes.resolvedAt === null,
              value: { attentionRef: args.attentionRef },
            }
          }
          const resolutionProject = requireProject(options.projects, resolved.projectId)
          options.onGoalEffect?.(eventId, resolutionProject.projectId, resolved.goalId)
          await requireGoal(resolutionProject.store, resolved.goalId)
          const admission = await goalInputAdmission(
            options.workspace,
            resolutionProject.store,
            resolved.goalId,
            event,
          )
          const changed = await resolveGoalAttention(
            resolutionProject.store,
            resolved.goalId,
            resolved.attentionId,
            args.resolution,
            admission,
            now(),
          )
          return {
            summary: `Resolved Attention ${args.attentionRef}.`,
            changed,
            value: { attentionRef: args.attentionRef },
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
          throw new AssistantToolRequestError(
            `Unsupported Preview operation: ${args.operation satisfies never}`,
          )
        }
        case 'hopi_request_user': {
          const args = parseAssistantToolArguments(name, input)
          if (
            event.attributes.source !== 'reflection' ||
            event.attributes.visibility !== 'internal'
          ) {
            throw new AssistantToolRequestError(
              'hopi_request_user is available only for an internal Reflection turn',
            )
          }
          const expected = event.attributes.context
            ? normalizeInboxAttentionReferences(event.attributes.context)
            : []
          if (!sameReferences(args.attentionRefs, expected)) {
            throw new AssistantToolRequestError(
              'request_user must name exactly the Attention references selected for this internal turn',
            )
          }
          await assertAssistantOwnedAttentionRefs(args.attentionRefs, event.attributes.context)
          return {
            summary:
              'Staged operator ownership. Return the complete question as the final response for this turn.',
            changed: false,
            value: {
              eventId,
              staged: true,
              attentionRefs: args.attentionRefs,
            },
          }
        }
      }
    },
  }

  async function assertAssistantOwnedAttentionRefs(
    references: readonly string[],
    context?: { projectId?: string; goalId?: string } | null,
    allowCompletion = false,
  ) {
    const workspace = await options.workspace.readWorkspace()
    for (const reference of references) {
      const parsed = parseAttentionReference(reference)
      if (!parsed) throw new AssistantToolRequestError(`Invalid Attention reference: ${reference}`)
      if (parsed.scope === 'workspace') {
        if (context?.projectId || parsed.homeId !== workspace.homeId) {
          throw new AssistantToolRequestError(
            `Attention is outside the selected context: ${reference}`,
          )
        }
        const attention = workspace.attentions.get(parsed.attentionId)
        if (!attention)
          throw new AssistantToolRequestError(`Workspace Attention not found: ${reference}`)
        if (attention.attributes.resolvedAt !== null)
          throw new AssistantToolRequestError(`Attention is already resolved: ${reference}`)
        if ((attention.attributes.operatorRequest ?? null) !== null)
          throw new AssistantToolRequestError(
            `Attention is already owned by the operator: ${reference}`,
          )
        continue
      }
      if (
        (context?.projectId && context.projectId !== parsed.projectId) ||
        (context?.goalId && context.goalId !== parsed.goalId)
      ) {
        throw new AssistantToolRequestError(
          `Attention is outside the selected context: ${reference}`,
        )
      }
      const project = requireProject(options.projects, parsed.projectId)
      const attention = (await project.store.readPackage(parsed.goalId)).attentions.get(
        parsed.attentionId,
      )
      if (!attention) throw new AssistantToolRequestError(`Goal Attention not found: ${reference}`)
      if (attention.attributes.target === null && !allowCompletion)
        throw new AssistantToolRequestError(
          `Completion Attention cannot request operator input: ${reference}`,
        )
      if (attention.attributes.resolvedAt !== null)
        throw new AssistantToolRequestError(`Attention is already resolved: ${reference}`)
      if ((attention.attributes.operatorRequest ?? null) !== null)
        throw new AssistantToolRequestError(
          `Attention is already owned by the operator: ${reference}`,
        )
    }
  }
}

function sameReferences(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function assistantToolStateProjection(
  snapshot: AssistantStateSnapshot,
  scope: { projectId?: string; goalId?: string },
): AssistantStateSnapshot {
  return {
    ...snapshot,
    workspaceAttentions: scope.projectId
      ? snapshot.workspaceAttentions.filter(
          (attention) => isRecord(attention) && attention.target === `project:${scope.projectId}`,
        )
      : snapshot.workspaceAttentions.map(compactWorkspaceAttentionIndex),
    projects: scope.goalId ? snapshot.projects : snapshot.projects.map(compactProjectStateIndex),
  }
}

function compactWorkspaceAttentionIndex(value: unknown) {
  if (!isRecord(value) || typeof value.body !== 'string') return value
  return { ...value, body: boundedStateText(value.body, 320) }
}

function compactProjectStateIndex(value: unknown) {
  if (!isRecord(value)) return value
  return {
    projectId: value.projectId,
    ...(typeof value.primaryRepoId === 'string' ? { primaryRepoId: value.primaryRepoId } : {}),
    available: value.available,
    releaseHead: value.releaseHead,
    ...(Array.isArray(value.repos) ? { repos: value.repos.map(compactRepoStateIndex) } : {}),
    goals: Array.isArray(value.goals) ? value.goals.map(compactGoalStateIndex) : [],
  }
}

function compactRepoStateIndex(value: unknown) {
  if (!isRecord(value)) return value
  return {
    ...(typeof value.repoId === 'string' ? { repoId: value.repoId } : {}),
    ...(typeof value.projectPath === 'string' ? { projectPath: value.projectPath } : {}),
    ...(typeof value.primary === 'boolean' ? { primary: value.primary } : {}),
  }
}

function compactGoalStateIndex(value: unknown) {
  if (!isRecord(value)) return value
  return {
    goal: compactDocumentStateIndex(value.goal),
    latestPlanningOutcome:
      value.latestPlanningOutcome === null
        ? null
        : compactWorkStateIndex(value.latestPlanningOutcome, false),
    works: Array.isArray(value.works)
      ? value.works.map((work) => compactWorkStateIndex(work, true))
      : [],
    attentions: Array.isArray(value.attentions)
      ? value.attentions.map(compactGoalAttentionStateIndex)
      : [],
  }
}

function compactDocumentStateIndex(value: unknown) {
  if (!isRecord(value)) return value
  return {
    attributes: value.attributes,
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
  }
}

function compactGoalAttentionStateIndex(value: unknown) {
  if (!isRecord(value)) return value
  return {
    ...(typeof value.reference === 'string' ? { reference: value.reference } : {}),
    attributes: value.attributes,
    ...(typeof value.body === 'string' ? { body: boundedStateText(value.body, 600) } : {}),
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
  }
}

function compactWorkStateIndex(value: unknown, includeSummary: boolean) {
  if (!isRecord(value)) return value
  return {
    attributes: value.attributes,
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(isRecord(value.projection) ? { projection: value.projection } : {}),
    ...(Array.isArray(value.candidateIntegration)
      ? { candidateIntegration: value.candidateIntegration }
      : {}),
    ...(isRecord(value.runtime)
      ? { runtime: compactRuntimeStateIndex(value.runtime, includeSummary) }
      : {}),
  }
}

function compactRuntimeStateIndex(value: Record<string, unknown>, includeSummary: boolean) {
  const latestAttempt = isRecord(value.latestAttempt)
    ? {
        runId: value.latestAttempt.runId,
        responsibility: value.latestAttempt.responsibility,
        status: value.latestAttempt.status,
        result: value.latestAttempt.result,
        ...(includeSummary && typeof value.latestAttempt.summary === 'string'
          ? { summary: boundedStateText(value.latestAttempt.summary, 500) }
          : {}),
      }
    : null
  return {
    activeResponsibility: value.activeResponsibility,
    latestAttempt,
    lastActivityAt: value.lastActivityAt,
    stale: value.stale,
  }
}

function boundedStateText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
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
    throw new AssistantToolRequestError(
      `Completed Goal ${parsed.goalId} has available Evidence artifacts. Include at least one relevant operatorUrl in the final response after reading the exact Goal with includeEvidence: true. Available operatorUrl values: ${operatorUrls.slice(0, 8).join(', ')}`,
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
    throw new AssistantToolRequestError(`${subject} can be changed only from a public user turn`)
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

function openWorkAttentionRefs(
  goalPackage: Awaited<ReturnType<GoalPackageStore['readPackage']>>,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const target = workAttentionTarget(projectId, goalId, workId)
  return [...goalPackage.attentions.values()]
    .filter(
      (attention) =>
        attention.attributes.target === target && attention.attributes.resolvedAt === null,
    )
    .map((attention) => goalAttentionReference(projectId, goalId, attention.attributes.id))
    .toSorted()
}

function standardPlanningObjective(eventId: string) {
  return `Interpret accepted Inbox turn ${eventId} against the current Goal and design.`
}

async function ensurePlanningWithRunInvalidation(
  project: AssistantToolProject,
  goalId: string,
  reason: string,
  acceptedInput?: PlanningInputAdmission,
  context: PlanningContext = {},
) {
  const before = await project.store.readPackage(goalId)
  const existing = [...before.works.values()].find(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  const planning = await project.controller.ensurePlanning(goalId, reason, acceptedInput, context)
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
      throw new AssistantToolRequestError(
        `Attachment is not owned by a public Inbox turn: ${reference.attachmentRef}`,
      )
    }
    const attachment = await workspace.resolveAttachment(reference.attachmentRef)
    if (!attachment) {
      throw new AssistantToolRequestError(
        `Attachment is not a supported durable image: ${reference.attachmentRef}`,
      )
    }
    const assetPath = store.paths.asset(goalId, attachment.contentHash, attachment.fileName)
    const currentAsset = await currentBytes(store, assetPath)
    if (currentAsset) {
      if ((await hashBytes(currentAsset)) !== attachment.contentHash) {
        throw new AssistantToolRequestError(`Immutable Goal image content mismatch: ${assetPath}`)
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
      throw new AssistantToolRequestError(
        `Goal Input conflicts with Inbox turn ${event.attributes.id}`,
      )
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
  if (!(await file.exists()))
    throw new AssistantToolRequestError(`Goal Attention not found: ${attentionId}`)
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
    throw new AssistantToolRequestError(`Goal Attention has an invalid Work target: ${target}`)
  }
  const work = (await store.readPackage(goalId)).works.get(match.workId)
  if (!work || isWorkTerminal(work.attributes)) return
  const profile = await readSoftwareDeliveryProfile()
  if (work.attributes.attempts >= profile.retry.maxAttempts) {
    throw new AssistantToolRequestError(
      `Work ${match.workId} is still exhausted; retry, cancel, or revise it before resolving Attention`,
    )
  }
}

function requireProject(projects: ReadonlyMap<string, AssistantToolProject>, projectId: string) {
  const project = projects.get(projectId)
  if (!project) throw new AssistantToolRequestError(`Project not found: ${projectId}`)
  return project
}

function assertLinkedRepos(project: AssistantToolProject, repoIds: readonly string[]) {
  const linked = new Set(
    project.repos?.map((repo) => repo.repoId) ?? [project.primaryRepoId ?? 'primary'],
  )
  for (const repoId of repoIds) {
    if (!linked.has(repoId)) {
      throw new AssistantToolRequestError(`Engineering Work references unlinked Repo ${repoId}`)
    }
  }
}

function dependentWorkIds(
  goalPackage: Awaited<ReturnType<GoalPackageStore['readPackage']>>,
  rootId: string,
) {
  return workCancellationClosure(goalPackage, [rootId])
}

function isTerminalWork(work: WorkDocument | undefined) {
  return Boolean(work && isWorkTerminal(work.attributes))
}

async function requireGoal(store: GoalPackageStore, goalId: string) {
  const goal = await store.readGoal(goalId)
  if (!goal) throw new AssistantToolRequestError(`Goal not found: ${goalId}`)
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
    throw new AssistantToolRequestError(`Invalid Goal design path: ${path}`)
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
    throw new AssistantToolRequestError(
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
