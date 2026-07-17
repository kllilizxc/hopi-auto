import type { InboxContext } from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  normalizeInboxAttentionReferences,
  parseAttentionReference,
} from '../domain/attentionReference'
import { parseProjectAttentionTarget, parseWorkAttentionTarget } from '../domain/attentionTarget'
import {
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  parseInputDocument,
  renderAttentionDocument,
  renderInputDocument,
} from '../domain/canonicalDocuments'
import { findNonPortableGoalImageReference } from '../domain/goalImageReference'
import type { LinkedProjectRepo } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import { deriveReadableId } from '../domain/stableId'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import { acknowledgeGoalAttention } from '../runtime/attentionDelivery'
import type {
  GoalController,
  PlanningContext,
  PlanningInputAdmission,
} from '../runtime/goalController'
import type { PreviewManager } from '../runtime/previewManager'
import { readSoftwareDeliveryProfile } from '../runtime/softwareDeliveryProfile'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { AssistantStateReader } from './assistantState'
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
  acknowledgeEventAttentions(eventId: string, acknowledgedAt?: Date): Promise<string[]>
  execute(token: string, name: AssistantToolName, input: unknown): Promise<AssistantToolResult>
  executeForEvent(
    eventId: string,
    name: MainAssistantToolName,
    input: unknown,
  ): Promise<AssistantToolResult>
}

export function createAssistantTools(options: {
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantToolProject>
  publisher: PublicationCoordinator
  preview: PreviewManager
  state: AssistantStateReader
  onProjectAttentionResolved?: (projectId: string) => void
  now?: () => Date
}): AssistantTools {
  type Capability =
    | { mode: 'main'; eventId: string; expiresAt: number; notificationMessage: string | null }
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
          if (
            attention.attributes.resolvedAt !== null ||
            attention.attributes.notifiedAt !== null
          ) {
            continue
          }
          await options.workspace.markAttentionNotified(parsed.attentionId, acknowledgedAt)
          acknowledged.push(reference)
          continue
        }
        const project = options.projects.get(parsed.projectId)
        if (!project) throw new Error(`Attention Project is unavailable: ${parsed.projectId}`)
        const goalPackage = await project.store.readPackage(parsed.goalId)
        const attention = goalPackage.attentions.get(parsed.attentionId)
        if (!attention) throw new Error(`Goal Attention not found: ${reference}`)
        if (attention.attributes.resolvedAt !== null || attention.attributes.notifiedAt !== null) {
          continue
        }
        if (
          await acknowledgeGoalAttention(
            project.store,
            parsed.goalId,
            parsed.attentionId,
            acknowledgedAt,
          )
        ) {
          acknowledged.push(reference)
          continue
        }
        const current = (await project.store.readPackage(parsed.goalId)).attentions.get(
          parsed.attentionId,
        )
        if (current?.attributes.resolvedAt === null && current.attributes.notifiedAt === null) {
          throw new Error(`Goal Attention could not be acknowledged: ${reference}`)
        }
      }
      return acknowledged
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
            value: await options.state.read(args),
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
      if (name === 'hopi_notify_user') {
        capability.notificationMessage = parseAssistantToolArguments(
          'hopi_notify_user',
          input,
        ).message
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
        case 'hopi_write_preferences': {
          if (event.attributes.source !== 'user' || event.attributes.visibility !== 'public') {
            throw new Error('Preferences can be changed only from a public user turn')
          }
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
          const goalPackage = await project.store.readPackage(args.goalId)
          const work = goalPackage.works.get(args.workId)
          if (!work) throw new Error(`Work not found: ${args.workId}`)
          if (args.operation === 'cancel') {
            if (work.attributes.stage !== 'cancelled') {
              await project.controller.cancelWork(args.goalId, args.workId)
            }
          } else if (args.operation === 'retry') {
            await project.controller.retryWork(
              args.goalId,
              args.workId,
              args.notBefore === undefined ? work.attributes.notBefore : args.notBefore,
            )
          } else {
            await project.controller.setWorkNotBefore(
              args.goalId,
              args.workId,
              args.notBefore ?? null,
            )
          }
          const inputChanged = await publishInput(
            options.workspace,
            project.store,
            args.goalId,
            event,
          )
          return {
            summary: `${args.operation} applied to Work ${args.workId}.`,
            changed: true,
            value: {
              projectId: project.projectId,
              goalId: args.goalId,
              workId: args.workId,
              inputChanged,
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
              await options.workspace.resolveAttention(args.attentionId, args.resolution, now())
              if (projectTarget) {
                options.onProjectAttentionResolved?.(projectTarget.projectId)
              }
            }
            return {
              summary: projectTarget
                ? `Resolved Project Attention ${args.attentionId}; Project ${projectTarget.projectId} is eligible again.`
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
          const contextGoalId = event.attributes.context?.goalId
          if (!contextGoalId) throw new Error('Preview repair requires a Goal in turn context')
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            contextGoalId,
            event,
          )
          await ensurePlanningWithRunInvalidation(
            project,
            contextGoalId,
            `Establish or repair Preview from Inbox turn ${eventId}: ${args.failure ?? event.body}`,
            admission,
          )
          return {
            summary: `Preview repair planning requested in ${contextGoalId}.`,
            changed: true,
            value: {
              projectId: project.projectId,
              goalId: contextGoalId,
              remainingAttentionRefs: await remainingGoalAttentionRefs(
                project.store,
                contextGoalId,
              ),
            },
          }
        }
        case 'hopi_notify_user': {
          const args = parseAssistantToolArguments(name, input)
          if (
            event.attributes.source !== 'reflection' ||
            event.attributes.visibility !== 'internal'
          ) {
            throw new Error('hopi_notify_user is available only for an internal Reflection turn')
          }
          return {
            summary: 'The supplied message will be shown to the operator after this turn finishes.',
            changed: false,
            value: {
              eventId,
              requested: true,
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
  if (attention.attributes.resolvedAt !== null) {
    if (admission.write) {
      await store.publishGoal(goalId, { supportingWrites: [], gateWrite: admission.write })
    }
    return Boolean(admission.write)
  }
  await assertAttentionBlockerChanged(store, goalId, attention.attributes.target)
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
