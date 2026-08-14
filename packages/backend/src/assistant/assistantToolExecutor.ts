import { type CommandRunner, createCommandRunner } from '../commands/commandRunner'
import {
  type InboxEventDocument,
  type WorkspaceAttentionDocument,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  parseAttentionReference,
  workspaceAttentionReference,
} from '../domain/attentionReference'
import { parseWorkAttentionTarget } from '../domain/attentionTarget'
import { isDecisionWork } from '../domain/canonicalDocuments'
import type { LinkedProject } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import { deriveReadableId } from '../domain/stableId'
import { assertWayfinderMap } from '../domain/wayfinderMap'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import { type PreviewManager, readProjectReleaseHeads } from '../runtime/previewManager'
import { withPreparedProjectRepositories } from '../runtime/projectDirectory'
import type { WorkRunRequest } from '../scheduler/projectReconciler'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import {
  type AssistantConversationScope,
  assistantConversationScopeForEvent,
} from './assistantConversationScope'
import {
  assertPortableGoalText,
  currentBytes,
  dependentWorkIds,
  designPath,
  equalBytes,
  goalInputAdmission,
  isTerminalWork,
  newInputWrite,
  normalizeMarkdown,
  prepareGoalReferences,
  publishInput,
  requireGoal,
  requireProject,
  resolveGoalAttention,
} from './assistantGoalToolSupport'
import type { AssistantStateReader } from './assistantState'
import {
  assistantStateProjection,
  presentProjectTopology,
  readPublicConversationPage,
  sameProjectTopology,
} from './assistantToolPresentation'
import { AssistantToolRequestError } from './assistantToolRequestError'
import { type AssistantToolName, parseAssistantToolArguments } from './assistantToolSchemas'
import type { AssistantToolProject, AssistantToolResult } from './assistantToolTypes'

export interface AssistantToolExecutionOptions {
  home: AssistantHomeStore
  commands?: CommandRunner
  workspace: AssistantWorkspaceStore
  projects: ReadonlyMap<string, AssistantToolProject>
  publisher: PublicationCoordinator
  preview: PreviewManager
  state: AssistantStateReader
  onProjectTopologyChanged(eventId: string, project: LinkedProject): void | Promise<void>
  onProjectRecoveryRequested(projectId: string): Promise<{ eligible: boolean; error?: string }>
  onGoalEffect(eventId: string, projectId: string, goalId: string): void
  onProjectDispatchEffect(eventId: string, projectId: string): void
  onToolEffect(
    eventId: string,
    name: AssistantToolName,
    result: AssistantToolResult,
  ): void | Promise<void>
  now?: () => Date
}

export function createAssistantToolExecutor(options: AssistantToolExecutionOptions) {
  const commands = options.commands ?? createCommandRunner(options.home)
  const now = options.now ?? (() => new Date())

  async function assertPresentableAttentionReferences(
    event: InboxEventDocument,
    projectId: string,
    references: readonly string[],
  ) {
    const scope = assistantConversationScopeForEvent(event)
    if (scope.kind !== 'project' || scope.projectId !== projectId) {
      throw new AssistantToolRequestError(
        'Attention can be presented only from its Project conversation',
      )
    }
    const workspace = await options.workspace.readWorkspace()
    for (const reference of references) {
      const parsed = parseAttentionReference(reference)
      if (!parsed) throw new AssistantToolRequestError(`Invalid Attention reference: ${reference}`)
      if (parsed.scope === 'workspace') {
        const attention = workspace.attentions.get(parsed.attentionId)
        if (
          parsed.homeId !== workspace.homeId ||
          !attention ||
          workspaceAttentionProjectId(attention) !== projectId ||
          attention.attributes.resolvedAt !== null
        ) {
          throw new AssistantToolRequestError(`Attention is not open in this Project: ${reference}`)
        }
        continue
      }
      if (parsed.projectId !== projectId) {
        throw new AssistantToolRequestError(`Attention is outside this Project: ${reference}`)
      }
      const project = requireProject(options.projects, parsed.projectId)
      const attention = (await project.store.readPackage(parsed.goalId)).attentions.get(
        parsed.attentionId,
      )
      if (!attention || attention.attributes.resolvedAt !== null) {
        throw new AssistantToolRequestError(`Attention is not open in this Project: ${reference}`)
      }
    }
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
    if (work.attributes.status !== 'cancelled') await project.controller.cancelWork(goalId, workId)
    for (const affectedWorkId of affectedWorkIds) {
      project.reconciler.interruptRuns(goalId, affectedWorkId)
      await project.reconciler.interruptQueuedRuns(goalId, affectedWorkId)
    }
    const cancelledPackage = await project.store.readPackage(goalId)
    const settledRefs: string[] = []
    let inputWrite = admission.write
    for (const attention of cancelledPackage.attentions.values()) {
      if (attention.attributes.resolvedAt !== null) continue
      const target = parseWorkAttentionTarget(attention.attributes.target)
      if (
        !target ||
        target.projectId !== project.projectId ||
        target.goalId !== goalId ||
        !affectedWorkIds.has(target.workId) ||
        !isTerminalWork(cancelledPackage.works.get(target.workId))
      ) {
        continue
      }
      const changed = await resolveGoalAttention(
        project.store,
        goalId,
        attention.attributes.id,
        `Work ${target.workId} was cancelled.`,
        { ...admission, write: inputWrite },
        now(),
      )
      if (changed) {
        settledRefs.push(goalAttentionReference(project.projectId, goalId, attention.attributes.id))
        inputWrite = null
      }
    }
    if (inputWrite) {
      await project.store.publishGoal(goalId, { supportingWrites: [], gateWrite: inputWrite })
    }
    return { affectedWorkIds: [...affectedWorkIds].toSorted(), settledRefs: settledRefs.toSorted() }
  }

  async function currentWorkResult(input: {
    project: AssistantToolProject
    goalId: string
    workId: string
    kind: 'work_run_requested' | 'work_cancelled'
    runRequest?: WorkRunRequest
    affectedWorkIds?: readonly string[]
    settledRefs?: readonly string[]
  }): Promise<AssistantToolResult> {
    const current = (await input.project.store.readPackage(input.goalId)).works.get(input.workId)
    if (!current) throw new Error(`Work not found after mutation: ${input.workId}`)
    const changed = input.runRequest ? input.runRequest.disposition === 'scheduled' : true
    return {
      summary: input.runRequest
        ? `${input.runRequest.disposition === 'scheduled' ? 'Scheduled' : 'Found'} Run ${input.runRequest.runId} for ${input.workId}.`
        : `Cancelled Work ${input.workId}.`,
      changed,
      value: {
        effect: {
          kind: input.kind,
          projectId: input.project.projectId,
          goalId: input.goalId,
          workId: input.workId,
          status: current.attributes.status,
          affectedWorkIds: input.affectedWorkIds ?? [input.workId],
          ...(input.runRequest
            ? { runId: input.runRequest.runId, runDisposition: input.runRequest.disposition }
            : {}),
        },
        settledAttentionRefs: input.settledRefs ?? [],
      },
    }
  }

  return async function executeForEvent(
    eventId: string,
    name: AssistantToolName,
    input: unknown,
  ): Promise<AssistantToolResult> {
    const event = await options.workspace.readEvent(eventId)
    if (!event) throw new AssistantToolRequestError(`Inbox turn not found: ${eventId}`)
    if (event.attributes.status !== 'pending') {
      throw new AssistantToolRequestError(`Inbox turn is already handled: ${eventId}`)
    }

    switch (name) {
      case 'hopi_read_state': {
        const args = parseAssistantToolArguments(name, input)
        const projectId = args.projectId ?? event.attributes.context?.projectId
        const goalId =
          args.goalId ??
          (projectId === event.attributes.context?.projectId
            ? event.attributes.context?.goalId
            : undefined)
        const snapshot = await options.state.read({
          ...(projectId ? { projectId } : {}),
          ...(goalId ? { goalId } : {}),
          ...(args.includeEvidence ? { includeEvidence: true } : {}),
        })
        return {
          summary: 'Read current HOPI state.',
          changed: false,
          value: {
            ...assistantStateProjection(snapshot, { projectId, goalId }),
            currentTurn: {
              eventId,
              source: event.attributes.source,
              context: event.attributes.context ?? null,
              attachments: [...event.attributes.attachments],
              body: event.body,
            },
          },
        }
      }
      case 'hopi_read_conversation': {
        const args = parseAssistantToolArguments(name, input)
        const scope: AssistantConversationScope = args.projectId
          ? { kind: 'project', projectId: args.projectId }
          : { kind: 'home' }
        if (scope.kind === 'project') requireProject(options.projects, scope.projectId)
        const workspace = await options.workspace.readWorkspace()
        const page = readPublicConversationPage([...workspace.events.values()], scope, args)
        return {
          summary: `Read ${page.exchanges.length} public exchanges.`,
          changed: false,
          value: { scope, ...page },
        }
      }
      case 'hopi_manage_project': {
        const args = parseAssistantToolArguments(name, input)
        const change = args.change
        if (change.kind === 'recover') {
          requireProject(options.projects, change.projectId)
          const result = await options.onProjectRecoveryRequested(change.projectId)
          return {
            summary: result.eligible
              ? `Project ${change.projectId} is eligible.`
              : `Project ${change.projectId} remains ineligible.`,
            changed: result.eligible,
            value: {
              effect: { kind: 'recover', projectId: change.projectId, eligible: result.eligible },
              ...(result.error ? { error: result.error } : {}),
            },
          }
        }
        const before = await options.home.listProjects()
        let project: LinkedProject
        let operation: Awaited<ReturnType<CommandRunner['executeProjectRebind']>> | undefined
        if (change.kind === 'create') {
          project = await withPreparedProjectRepositories(change.repos, (repos) =>
            options.home.linkProject({
              ...(change.projectId ? { projectId: change.projectId } : {}),
              ...(change.label ? { label: change.label } : {}),
              primaryRepoId: change.primaryRepoId,
              repos,
            }),
          )
        } else if (change.kind === 'add_repo') {
          project = await withPreparedProjectRepositories([change.repo], ([repo]) => {
            if (!repo) throw new Error('Prepared Repo is missing')
            return options.home.linkRepo({ projectId: change.projectId, ...repo })
          })
        } else {
          operation = await commands.executeProjectRebind({
            projectId: change.projectId,
            repos: change.repos,
          })
          project = operation.result.project
        }
        const changed = !sameProjectTopology(
          before.find((candidate) => candidate.projectId === project.projectId),
          project,
        )
        if (changed) await options.onProjectTopologyChanged(eventId, project)
        return {
          summary: changed
            ? `Updated Project ${project.projectId}.`
            : `Project ${project.projectId} was already current.`,
          changed,
          value: {
            effect: { kind: change.kind, projectId: project.projectId },
            project: presentProjectTopology(project),
            ...(operation ? { operation: operation.result } : {}),
            runtimeRefresh: changed ? 'after_current_turn' : 'not_needed',
          },
        }
      }
      case 'hopi_write_preferences': {
        const args = parseAssistantToolArguments(name, input)
        const result = await options.workspace.writePreference(args.content, args.expectedDigest)
        return {
          summary: result.changed
            ? 'Updated durable preferences.'
            : 'Preferences were already current.',
          changed: result.changed,
          value: { path: options.workspace.paths.preference, digest: result.preference.digest },
        }
      }
      case 'hopi_create_goal': {
        const args = parseAssistantToolArguments(name, input)
        assertPortableGoalText('Goal title', args.title)
        assertPortableGoalText('Goal objective', args.objective)
        if (args.mapMarkdown !== undefined) validateWayfinderMapRequest(args.mapMarkdown)
        const project = requireProject(options.projects, args.projectId)
        const goalId =
          args.goalId ?? deriveReadableId('G', args.title, await project.store.listGoalIds())
        options.onGoalEffect(eventId, project.projectId, goalId)
        if (await project.store.readGoal(goalId)) {
          throw new AssistantToolRequestError(`Goal already exists: ${goalId}`)
        }
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
        const firstWorkId = deriveReadableId('W', args.firstWork.title, [])
        await project.store.createGoal({
          goalId,
          title: args.title,
          objective: args.objective,
          constraints: args.constraints,
          nonGoals: args.nonGoals,
          successCriteria: args.successCriteria,
          priority: args.priority,
          acceptedInput: admission.document,
          supportingWrites: references.writes,
          references: references.references,
          mapMarkdown: args.mapMarkdown,
          firstWork:
            args.firstWork.kind === 'decision'
              ? { id: firstWorkId, ...args.firstWork }
              : { id: firstWorkId, ...args.firstWork },
        })
        return {
          summary: `Created Goal ${goalId} with ${args.firstWork.kind} Work ${firstWorkId}.`,
          changed: true,
          value: {
            effect: {
              kind: 'goal_created',
              projectId: project.projectId,
              goalId,
              workId: firstWorkId,
              workKind: args.firstWork.kind,
            },
            references: references.references,
          },
        }
      }
      case 'hopi_create_work': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onGoalEffect(eventId, project.projectId, args.goalId)
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
        const work = await project.controller.createWork(args.goalId, {
          ...args.work,
          acceptedInput: admission,
          context: { supportingWrites: references.writes, references: references.references },
        })
        return {
          summary: `Created ${work.attributes.kind} Work ${work.attributes.id}.`,
          changed: true,
          value: {
            effect: {
              kind: 'work_created',
              projectId: project.projectId,
              goalId: args.goalId,
              workId: work.attributes.id,
              workKind: work.attributes.kind,
            },
            references: references.references,
          },
        }
      }
      case 'hopi_write_design': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        await requireGoal(project.store, args.goalId)
        const documents = args.changes.filter((change) => change.kind === 'document')
        const attachments = args.changes.filter((change) => change.kind === 'attachment')
        const references = await prepareGoalReferences(
          options.workspace,
          project.store,
          args.goalId,
          attachments,
        )
        const supportingWrites: PublicationWrite[] = [...references.writes]
        const paths: string[] = []
        for (const document of documents) {
          assertPortableGoalText(`Design ${document.path}`, document.content)
          const relative = designPath(document.path, args.goalId)
          if (relative === 'index.md') validateWayfinderMapRequest(document.content)
          const path = `${project.store.paths.designRoot(args.goalId)}/${relative}`
          const current = await currentBytes(project.store, path)
          const content = new TextEncoder().encode(normalizeMarkdown(document.content))
          paths.push(relative)
          if (current && equalBytes(current, content)) continue
          supportingWrites.push({
            path,
            expectedHash: current ? await hashBytes(current) : null,
            content,
          })
        }
        const inputWrite = await newInputWrite(options.workspace, project.store, args.goalId, event)
        if (supportingWrites.length > 0 || inputWrite) {
          await project.store.publishGoal(args.goalId, {
            supportingWrites,
            ...(inputWrite ? { gateWrite: inputWrite } : {}),
          })
        }
        return {
          summary: `Updated ${paths.length} design document(s).`,
          changed: supportingWrites.length > 0 || Boolean(inputWrite),
          value: {
            effect: { kind: 'design_changed', projectId: project.projectId, goalId: args.goalId },
            documents: paths,
            references: references.references,
          },
        }
      }
      case 'hopi_control_work': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        const goalPackage = await project.store.readPackage(args.goalId)
        const work = goalPackage.works.get(args.workId)
        if (!work) throw new AssistantToolRequestError(`Work not found: ${args.workId}`)
        if (args.action.kind === 'run') {
          const request = {
            workspaceMode: args.action.workspaceMode,
            instructionMarkdown: args.action.instructionMarkdown,
            refs: args.action.refs,
          }
          const runRequest = await project.reconciler.requestWorkRun(
            args.goalId,
            args.workId,
            request,
          )
          return currentWorkResult({
            project,
            goalId: args.goalId,
            workId: args.workId,
            kind: 'work_run_requested',
            runRequest,
          })
        }
        if (args.action.kind === 'complete') {
          if (args.action.mapMarkdown !== undefined) {
            if (!isDecisionWork(work.attributes))
              throw new AssistantToolRequestError('Only Decision completion may update the Map')
            validateWayfinderMapRequest(args.action.mapMarkdown)
          }
          if (isDecisionWork(work.attributes)) {
            const mapFile = Bun.file(
              project.store.paths.absolute(project.store.paths.designIndex(args.goalId)),
            )
            if ((await mapFile.exists()) && args.action.mapMarkdown === undefined) {
              throw new AssistantToolRequestError(
                'Decision completion in a mapped Goal must update the Map atomically',
              )
            }
          }
          const completion = await project.reconciler.completeWork(args.goalId, args.workId, {
            sourceEventId: eventId,
            decision: args.action.decision,
            mapMarkdown: args.action.mapMarkdown,
          })
          const current = (await project.store.readPackage(args.goalId)).works.get(args.workId)
          return {
            summary: `Work ${args.workId} completion ${completion.kind}.`,
            changed: completion.kind === 'integrated' || completion.kind === 'completed',
            value: {
              effect: {
                kind: 'work_completion',
                projectId: project.projectId,
                goalId: args.goalId,
                workId: args.workId,
                status: current?.attributes.status ?? work.attributes.status,
                result: completion.kind,
                commit: 'commit' in completion ? completion.commit : null,
              },
            },
          }
        }
        if (args.action.kind === 'set_dependencies') {
          const changed =
            JSON.stringify(work.attributes.dependsOn) !== JSON.stringify(args.action.dependsOn)
          const current = await project.controller.setWorkDependencies(
            args.goalId,
            args.workId,
            args.action.dependsOn,
          )
          if (changed) {
            project.reconciler.interruptRuns(args.goalId, args.workId)
            await project.reconciler.interruptQueuedRuns(args.goalId, args.workId)
          }
          return {
            summary: `Updated dependencies for ${args.workId}.`,
            changed,
            value: {
              effect: {
                kind: 'work_dependencies_changed',
                projectId: project.projectId,
                goalId: args.goalId,
                workId: args.workId,
                dependsOn: current.attributes.dependsOn,
              },
            },
          }
        }
        if (args.action.kind === 'set_not_before') {
          const changed = work.attributes.notBefore !== args.action.notBefore
          const current = await project.controller.setWorkNotBefore(
            args.goalId,
            args.workId,
            args.action.notBefore,
          )
          return {
            summary: `Updated schedule for ${args.workId}.`,
            changed,
            value: {
              effect: {
                kind: 'work_schedule_changed',
                projectId: project.projectId,
                goalId: args.goalId,
                workId: args.workId,
                notBefore: current.attributes.notBefore,
              },
            },
          }
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
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        let goal = await requireGoal(project.store, args.goalId)
        let changed = false
        let inputRecorded = false
        switch (args.action.kind) {
          case 'complete':
            if (goal.attributes.lifecycle !== 'done') {
              goal = await project.reconciler.completeGoal(args.goalId, {
                sourceEventId: eventId,
                decision: args.action.decision,
              })
              changed = true
            }
            break
          case 'revise_contract': {
            assertPortableGoalText('Goal contract', args.action.contractMarkdown)
            const admission = await goalInputAdmission(
              options.workspace,
              project.store,
              args.goalId,
              event,
            )
            goal = await project.controller.reviseContract(args.goalId, {
              contractMarkdown: args.action.contractMarkdown,
              acceptedInput: admission,
            })
            changed = true
            inputRecorded = true
            project.reconciler.interruptRuns(args.goalId)
            await project.reconciler.interruptQueuedRuns(args.goalId)
            break
          }
          case 'pause':
            if (goal.attributes.lifecycle === 'active') {
              goal = await project.controller.pauseGoal(args.goalId)
              changed = true
            }
            break
          case 'resume':
            if (goal.attributes.lifecycle === 'paused') {
              goal = await project.controller.resumeGoal(args.goalId)
              changed = true
            }
            break
          case 'cancel':
            if (goal.attributes.lifecycle !== 'cancelled') {
              goal = await project.controller.cancelGoal(args.goalId)
              changed = true
            }
            break
          case 'reopen':
            if (goal.attributes.lifecycle !== 'active') {
              if (args.action.contractMarkdown)
                assertPortableGoalText('Goal contract', args.action.contractMarkdown)
              goal = await project.controller.reopenGoal(args.goalId, {
                eventId,
                contractMarkdown: args.action.contractMarkdown,
              })
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
        if (!inputRecorded)
          inputRecorded = await publishInput(options.workspace, project.store, args.goalId, event)
        return {
          summary: `${args.action.kind} applied to Goal ${args.goalId}.`,
          changed: changed || inputRecorded,
          value: {
            effect: {
              kind: `goal_${args.action.kind}`,
              projectId: project.projectId,
              goalId: args.goalId,
            },
            lifecycle: goal.attributes.lifecycle,
            priority: goal.attributes.priority,
            contractRevision: goal.attributes.contractRevision,
          },
        }
      }
      case 'hopi_manage_attention': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onProjectDispatchEffect(eventId, project.projectId)
        const change = args.change
        const state = await options.workspace.readWorkspace()
        if (change.kind === 'present_attention_to_user') {
          const references = [...new Set(change.attentionRefs)]
          await assertPresentableAttentionReferences(event, project.projectId, references)
          const staged = await options.workspace.stageAttentionRequest(eventId, {
            attentionRefs: references,
          })
          return {
            summary: `Presented ${references.length} Attention(s).`,
            changed: true,
            value: {
              effect: {
                kind: 'attention_presentation_staged',
                attentionRefs: staged.attributes.attentionRequest?.attentionRefs ?? [],
              },
            },
          }
        }
        if (change.kind === 'create' && change.goalId && change.workId) {
          options.onGoalEffect(eventId, project.projectId, change.goalId)
          const attention = await project.controller.createAttention(
            project.projectId,
            change.goalId,
            change.workId,
            {
              attentionId: change.attentionId,
              summary: change.summary,
              decisionPrompt: change.decisionPrompt,
              body: withReferences(change.body, change.refs),
            },
          )
          return {
            summary: `Created Work Attention ${attention.attributes.id}.`,
            changed: true,
            value: {
              attentionId: attention.attributes.id,
              resolved: false,
              attentionRef: goalAttentionReference(
                project.projectId,
                change.goalId,
                attention.attributes.id,
              ),
            },
          }
        }
        const target = `project:${project.projectId}`
        if (change.kind === 'create') {
          const attentionId = change.attentionId ?? `A-${crypto.randomUUID()}`
          if (state.attentions.has(attentionId))
            throw new AssistantToolRequestError(`Attention already exists: ${attentionId}`)
          const timestamp = now().toISOString()
          const attention: WorkspaceAttentionDocument = {
            attributes: {
              id: attentionId,
              createdAt: timestamp,
              updatedAt: timestamp,
              resolvedAt: null,
              refs: [...new Set([target, ...change.refs])],
              summary: change.summary,
              decisionPrompt: change.decisionPrompt ?? null,
            },
            body: `${change.body.trim()}\n`,
          }
          await options.workspace.createAttention(attention)
          return {
            summary: `Created Project Attention ${attentionId}.`,
            changed: true,
            value: {
              attentionId,
              resolved: false,
              attentionRef: workspaceAttentionReference(state.homeId, attentionId),
            },
          }
        }
        if (change.kind === 'update') {
          const attention = state.attentions.get(change.attentionId)
          if (!attention || workspaceAttentionProjectId(attention) !== project.projectId)
            throw new AssistantToolRequestError(
              `Project Attention not found: ${change.attentionId}`,
            )
          const updated = await options.workspace.updateAttention(change.attentionId, {
            ...(change.body !== undefined ? { body: change.body } : {}),
            ...(change.refs !== undefined ? { refs: [...new Set([target, ...change.refs])] } : {}),
            ...(change.summary !== undefined ? { summary: change.summary } : {}),
            ...(change.decisionPrompt !== undefined
              ? { decisionPrompt: change.decisionPrompt }
              : {}),
            updatedAt: now(),
          })
          return {
            summary: `Updated Project Attention ${change.attentionId}.`,
            changed: true,
            value: {
              attentionId: change.attentionId,
              resolved: updated.attributes.resolvedAt !== null,
              attentionRef: workspaceAttentionReference(state.homeId, change.attentionId),
            },
          }
        }
        const parsed = parseAttentionReference(change.attentionRef)
        if (!parsed)
          throw new AssistantToolRequestError(`Invalid Attention reference: ${change.attentionRef}`)
        if (parsed.scope === 'goal') {
          if (parsed.projectId !== project.projectId)
            throw new AssistantToolRequestError('Attention is outside this Project')
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            parsed.goalId,
            event,
          )
          const changed = await resolveGoalAttention(
            project.store,
            parsed.goalId,
            parsed.attentionId,
            change.resolution,
            admission,
            now(),
          )
          return {
            summary: `Resolved Goal Attention ${parsed.attentionId}.`,
            changed,
            value: {
              attentionId: parsed.attentionId,
              resolved: true,
              attentionRef: change.attentionRef,
              resolutionInput: admission.path,
            },
          }
        }
        if (parsed.homeId !== state.homeId)
          throw new AssistantToolRequestError('Attention is outside this Home')
        const attention = state.attentions.get(parsed.attentionId)
        if (!attention || workspaceAttentionProjectId(attention) !== project.projectId)
          throw new AssistantToolRequestError(`Project Attention not found: ${parsed.attentionId}`)
        const changed = attention.attributes.resolvedAt === null
        if (changed)
          await options.workspace.resolveAttention(parsed.attentionId, change.resolution, now())
        return {
          summary: `Resolved Project Attention ${parsed.attentionId}.`,
          changed,
          value: {
            attentionId: parsed.attentionId,
            resolved: true,
            attentionRef: change.attentionRef,
          },
        }
      }
      case 'hopi_control_preview': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        if (args.operation === 'stop') {
          const result = await options.preview.stop(project.projectId)
          return {
            summary: `Preview stopped for ${project.projectId}.`,
            changed: Boolean(result),
            value: result,
          }
        }
        const result = await options.preview.start({
          projectId: project.projectId,
          projectRoot: project.sourceRoot,
          requestedBy: 'assistant',
          releaseHeads: await readProjectReleaseHeads(
            project.projectId,
            project.repos.map((repo) => ({ repoId: repo.repoId, path: repo.integrationRoot })),
          ),
          primaryRepoId: project.primaryRepoId,
          repoRoots: project.repos.map((repo) => ({
            repoId: repo.repoId,
            path: resolveProjectPath(repo.integrationRoot, repo.projectPath),
          })),
          runtimeInputs: args.runtimeInputs,
        })
        return {
          summary: `Preview start requested for ${project.projectId}.`,
          changed: true,
          value: result,
        }
      }
    }
  }
}

function validateWayfinderMapRequest(markdown: string) {
  try {
    assertWayfinderMap(markdown)
  } catch (error) {
    throw new AssistantToolRequestError(error instanceof Error ? error.message : String(error))
  }
}

function withReferences(body: string, references: readonly string[]) {
  if (references.length === 0) return body
  return `${body.trim()}\n\n## References\n\n${references.map((reference) => `- ${reference}`).join('\n')}`
}
