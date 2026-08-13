import { type CommandRunner, createCommandRunner } from '../commands/commandRunner'
import {
  type WorkspaceAttentionDocument,
  workspaceAttentionProjectId,
} from '../domain/assistantWorkspaceDocuments'
import {
  goalAttentionReference,
  parseAttentionReference,
  workspaceAttentionReference,
} from '../domain/attentionReference'
import { parseWorkAttentionTarget } from '../domain/attentionTarget'
import {
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
} from '../domain/canonicalDocuments'
import { inboxEventReference } from '../domain/inboxEventReference'
import type { LinkedProject } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import { deriveReadableId } from '../domain/stableId'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import { type PreviewManager, readProjectReleaseHeads } from '../runtime/previewManager'
import { withPreparedProjectRepositories } from '../runtime/projectDirectory'
import type { WorkRunRequest } from '../scheduler/projectReconciler'
import type { AssistantHomeStore } from '../storage/assistantHomeStore'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { AssistantConversationScope } from './assistantConversationScope'
import {
  assertPortableGoalText,
  currentBytes,
  dependentWorkIds,
  designPath,
  ensurePlanningWithRunInvalidation,
  equalBytes,
  goalInputAdmission,
  initialGoalBody,
  isTerminalWork,
  newInputWrite,
  normalizeMarkdown,
  prepareGoalReferences,
  publishInput,
  requireGoal,
  requireProject,
  resolveGoalAttention,
  standardPlanningObjective,
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
  const assistantDispatchQueues = new Map<string, Promise<void>>()
  const now = options.now ?? (() => new Date())

  async function assertPresentableAttentionReferences(
    projectId: string,
    references: readonly string[],
  ) {
    const workspace = await options.workspace.readWorkspace()
    for (const reference of references) {
      const parsed = parseAttentionReference(reference)
      if (!parsed) {
        throw new AssistantToolRequestError(`Invalid canonical Attention reference: ${reference}`)
      }
      if (parsed.scope === 'workspace') {
        if (parsed.homeId !== workspace.homeId) {
          throw new AssistantToolRequestError(
            `Attention belongs to another Assistant Home: ${reference}`,
          )
        }
        const attention = workspace.attentions.get(parsed.attentionId)
        if (
          !attention ||
          workspaceAttentionProjectId(attention) !== projectId ||
          attention.attributes.resolvedAt !== null
        ) {
          throw new AssistantToolRequestError(
            `Attention is not open in the current Project: ${reference}`,
          )
        }
        continue
      }
      if (parsed.projectId !== projectId) {
        throw new AssistantToolRequestError(
          `Attention is outside the current Project: ${reference}`,
        )
      }
      const project = requireProject(options.projects, parsed.projectId)
      const goalPackage = await project.store.readPackage(parsed.goalId)
      const attention = goalPackage.attentions.get(parsed.attentionId)
      if (!attention || attention.attributes.resolvedAt !== null) {
        throw new AssistantToolRequestError(
          `Attention is not open in the current Project: ${reference}`,
        )
      }
    }
  }

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
    for (const affectedWorkId of affectedWorkIds) {
      project.reconciler.interruptRuns(goalId, affectedWorkId)
      await project.reconciler.interruptQueuedRuns(goalId, affectedWorkId)
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

  async function postWorkActionState(
    project: AssistantToolProject,
    goalId: string,
    includeCoordinatorDecision: boolean,
  ) {
    const goalPackage = await project.store.readPackage(goalId)
    const remainingNonterminalWorkIds = [...goalPackage.works.values()]
      .filter((work) => !isWorkTerminal(work.attributes))
      .map((work) => work.attributes.id)
      .toSorted()
    const state = {
      goalLifecycle: goalPackage.goal.attributes.lifecycle,
      remainingNonterminalWorkIds,
    }
    if (!includeCoordinatorDecision) return state

    const coordinatorDecisionWhenEligible = await project.reconciler.decisionWhenEligible(
      goalId,
      goalPackage,
    )
    return {
      ...state,
      coordinatorDecisionWhenEligible,
    }
  }

  async function currentWorkResult(input: {
    project: AssistantToolProject
    goalId: string
    workId: string
    kind: 'work_run_requested' | 'work_continue_requested' | 'work_completed' | 'work_cancelled'
    affectedWorkIds?: readonly string[]
    settledRefs?: readonly string[]
    pendingRefs?: readonly string[]
    runRequest?: WorkRunRequest
  }): Promise<AssistantToolResult> {
    const currentPackage = await input.project.store.readPackage(input.goalId)
    const currentWork = currentPackage.works.get(input.workId)
    if (!currentWork) throw new Error(`Work not found after control: ${input.workId}`)
    const runRequest =
      input.kind === 'work_run_requested' || input.kind === 'work_continue_requested'
        ? input.runRequest
        : undefined
    const changed = runRequest ? runRequest.disposition === 'scheduled' : true
    const postActionState = await postWorkActionState(
      input.project,
      input.goalId,
      input.kind === 'work_cancelled' || input.kind === 'work_completed',
    )
    const cancellationConsequence =
      input.kind === 'work_cancelled' && 'coordinatorDecisionWhenEligible' in postActionState
        ? ` Goal ${input.goalId} is ${postActionState.goalLifecycle} with ${postActionState.remainingNonterminalWorkIds.length} remaining nonterminal Work; its eligible Coordinator decision is ${postActionState.coordinatorDecisionWhenEligible.kind}.`
        : ''
    return {
      summary: runRequest
        ? runRequest.disposition === 'already_active'
          ? `Work ${input.workId} is already running as ${runRequest.runId}.`
          : runRequest.disposition === 'already_scheduled'
            ? `Work ${input.workId} is already scheduled as ${runRequest.runId}.`
            : `Scheduled Work ${input.workId} as ${runRequest.runId}.`
        : `${input.kind} applied to Work ${input.workId}.${cancellationConsequence}`,
      changed,
      value: {
        effect: {
          kind: input.kind,
          projectId: input.project.projectId,
          goalId: input.goalId,
          workId: input.workId,
          affectedWorkIds: input.affectedWorkIds ?? [input.workId],
          stage: currentWork.attributes.stage,
          notBefore: currentWork.attributes.notBefore,
          ...(runRequest
            ? { runId: runRequest.runId, runDisposition: runRequest.disposition }
            : {}),
        },
        postActionState,
        settledAttentionRefs: input.settledRefs ?? [],
        pendingAttentionRefs: input.pendingRefs ?? [],
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
        const context = event.attributes.context
        const projectId = args.projectId ?? context?.projectId
        const goalId =
          args.goalId ??
          (projectId && projectId === context?.projectId ? context.goalId : undefined)
        let state: ReturnType<typeof assistantStateProjection>
        try {
          const snapshot = await options.state.read({
            ...(projectId ? { projectId } : {}),
            ...(goalId ? { goalId } : {}),
            ...(args.includeEvidence ? { includeEvidence: true } : {}),
          })
          state = assistantStateProjection(snapshot, { projectId, goalId })
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
      case 'hopi_read_conversation': {
        const args = parseAssistantToolArguments(name, input)
        const scope: AssistantConversationScope = args.projectId
          ? { kind: 'project', projectId: args.projectId }
          : { kind: 'home' }
        if (scope.kind === 'project') requireProject(options.projects, scope.projectId)
        const workspace = await options.workspace.readWorkspace()
        const page = readPublicConversationPage([...workspace.events.values()], scope, args)
        return {
          summary: `Read ${page.exchanges.length} durable public Assistant exchange${page.exchanges.length === 1 ? '' : 's'}.`,
          changed: false,
          value: {
            scope:
              scope.kind === 'home'
                ? { kind: 'home' }
                : { kind: 'project', projectId: scope.projectId },
            ...page,
          },
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
              ? `Project ${change.projectId} passed recovery validation and is eligible for execution.`
              : `Project ${change.projectId} remains ineligible after recovery validation.`,
            changed: result.eligible,
            value: {
              effect: {
                kind: 'recover',
                projectId: change.projectId,
                eligible: result.eligible,
              },
              ...(result.error ? { error: result.error } : {}),
            },
          }
        }
        const before = await options.home.listProjects()
        let project: LinkedProject
        let operation: Awaited<ReturnType<CommandRunner['executeProjectRebind']>> | undefined
        switch (change.kind) {
          case 'create':
            project = await withPreparedProjectRepositories(change.repos, (repos) =>
              options.home.linkProject({
                ...(change.projectId ? { projectId: change.projectId } : {}),
                ...(change.label ? { label: change.label } : {}),
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
            operation = await commands.executeProjectRebind({
              projectId: change.projectId,
              repos: change.repos,
            })
            project = operation.result.project
            break
          }
        }
        const previous = before.find((candidate) => candidate.projectId === project.projectId)
        const changed = !sameProjectTopology(previous, project)
        if (changed) await options.onProjectTopologyChanged(eventId, project)
        return {
          summary: changed
            ? `Updated Project ${project.projectId} topology.`
            : `Project ${project.projectId} topology was already current.`,
          changed,
          value: {
            effect: { kind: change.kind, projectId: project.projectId },
            project: presentProjectTopology(project),
            ...(operation
              ? {
                  operation: {
                    operationId: operation.result.operationId,
                    command: operation.result.command,
                    status: operation.result.status,
                    plan: {
                      summary: operation.plan.summary,
                      effects: operation.plan.effects,
                      warnings: operation.plan.warnings,
                    },
                    recoveryPaths: operation.result.recoveryPaths,
                    followUpWarnings: operation.result.followUpWarnings,
                  },
                }
              : {}),
            runtimeRefresh: changed ? 'after_current_turn' : 'not_needed',
          },
        }
      }
      case 'hopi_write_preferences': {
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
          }
          const workspace = await options.workspace.readWorkspace()
          const dispatchReference = inboxEventReference(workspace.homeId, eventId)
          return serializeAssistantDispatch(dispatchReference, async () => {
            const dispatched = await findAssistantDispatch(dispatchReference)
            const targetGoalId = args.goalId ?? dispatched?.goalId ?? goalId
            options.onGoalEffect(eventId, project.projectId, targetGoalId)
            if (
              dispatched &&
              (dispatched.project.projectId !== project.projectId ||
                dispatched.goalId !== targetGoalId)
            ) {
              throw new AssistantToolRequestError(
                `Inbox Input already directly admitted Engineering Work ${dispatched.work.attributes.id} in ${dispatched.project.projectId}/${dispatched.goalId}`,
              )
            }
            const existing = await project.store.readGoal(targetGoalId)
            if (
              existing &&
              (existing.attributes.title !== args.title ||
                existing.body !== initialGoalBody(args.objective))
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
        options.onGoalEffect(eventId, project.projectId, goalId)
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
          existing.body !== initialGoalBody(args.objective)
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
            planningChanged = !openPlanning.attributes.contextRefs.some(
              (reference) => reference.path === admission.path,
            )
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
        if (requestedWork.kind === 'planning') {
          let planning: WorkDocument
          if (requestedWork.mode === 'new_contract_revision') {
            assertPortableGoalText('Goal contract change', requestedWork.contractChange)
            await project.controller.applyMaterialInstruction(args.goalId, {
              contractChange: requestedWork.contractChange,
              acceptedInput: admission,
              planningContext: {
                supportingWrites: references.writes,
                references: references.planning,
              },
            })
            project.reconciler.interruptRuns(args.goalId)
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
              `Inbox Input already directly admitted Engineering Work ${dispatched.work.attributes.id} in ${dispatched.project.projectId}/${dispatched.goalId}`,
            )
          }
          const work = await project.controller.admitAssistantEngineeringWork(args.goalId, {
            title: requestedWork.title,
            objective: requestedWork.objective,
            acceptanceCriteria: requestedWork.acceptanceCriteria,
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
        options.onGoalEffect(eventId, project.projectId, args.goalId)
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
        const inputWrite = await newInputWrite(options.workspace, project.store, args.goalId, event)
        if (supportingWrites.length > 0 || inputWrite) {
          await project.store.publishGoal(args.goalId, {
            supportingWrites,
            ...(inputWrite ? { gateWrite: inputWrite } : {}),
          })
          project.reconciler.interruptRuns(args.goalId)
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
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        const goalPackage = await project.store.readPackage(args.goalId)
        const work = goalPackage.works.get(args.workId)
        if (!work) throw new AssistantToolRequestError(`Work not found: ${args.workId}`)
        if (args.action.kind === 'complete') {
          await project.reconciler.completeWork(args.goalId, args.workId, {
            sourceEventId: eventId,
            decision: args.action.decision,
          })
          return currentWorkResult({
            project,
            goalId: args.goalId,
            workId: args.workId,
            kind: 'work_completed',
          })
        }
        if (args.action.kind === 'run') {
          const runRequest = await project.reconciler.requestWorkRun(args.goalId, args.workId, {
            allowSuccessor: true,
            directive: {
              protocol: 'report',
              profile: args.action.profile,
              workspaceMode: args.action.workspaceMode,
              instructionMarkdown: args.action.instructionMarkdown,
              refs: args.action.refs,
              baseChangeSetId: args.action.baseChangeSetId,
            },
          })
          return currentWorkResult({
            project,
            goalId: args.goalId,
            workId: args.workId,
            kind: 'work_run_requested',
            runRequest,
          })
        }
        if (args.action.kind === 'continue') {
          let workChanged = false
          if (args.action.message) {
            const current = await project.controller.appendWorkMessage(args.goalId, args.workId, {
              sourceEventId: eventId,
              content: args.action.message,
            })
            workChanged =
              current.attributes.ownerMessages.length !== work.attributes.ownerMessages.length
          }
          const currentPackage = await project.store.readPackage(args.goalId)
          const currentWork = currentPackage.works.get(args.workId)
          if (!currentWork) {
            throw new AssistantToolRequestError(`Work not found: ${args.workId}`)
          }
          const notBefore = args.action.at ?? null
          if (currentWork.attributes.notBefore !== notBefore) {
            await project.controller.setWorkNotBefore(args.goalId, args.workId, notBefore)
            workChanged = true
          }
          if (workChanged) {
            project.reconciler.interruptRuns(args.goalId, args.workId)
            await project.reconciler.interruptQueuedRuns(args.goalId, args.workId)
          }
          const runRequest = await project.reconciler.requestWorkRun(args.goalId, args.workId, {
            allowSuccessor: workChanged,
          })
          return currentWorkResult({
            project,
            goalId: args.goalId,
            workId: args.workId,
            kind: 'work_continue_requested',
            runRequest,
          })
        }
        if (args.action.kind === 'set_dependencies') {
          if (!isEngineeringWork(work.attributes)) {
            throw new AssistantToolRequestError(
              `Only Engineering Work can have dependencies: ${args.workId}`,
            )
          }
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
            summary: `Dependencies updated for Work ${args.workId}.`,
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
        const effect = await cancelWorkAndSettle(project, args.goalId, args.workId, event)
        return currentWorkResult({
          project,
          goalId: args.goalId,
          workId: args.workId,
          kind: 'work_cancelled',
          ...effect,
        })
      }
      case 'hopi_control_operation': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        const before = await project.reconciler.listGoalOperations(args.goalId)
        if (args.action.kind === 'propose') {
          const operationId =
            args.action.operationId ??
            derivedOperationId(project.projectId, args.goalId, eventId, args.action.idempotencyKey)
          const operation = await project.reconciler.proposeOperation(args.goalId, {
            id: operationId,
            workId: args.action.workId,
            idempotencyKey: args.action.idempotencyKey,
            requiredForGoal: args.action.requiredForGoal,
            intent: args.action.intent,
            proposedByEventId: eventId,
          })
          return {
            summary: `Proposed ${operation.intent.kind} Operation ${operation.id}.`,
            changed: !before.some((candidate) => candidate.id === operation.id),
            value: {
              effect: {
                kind: 'operation_proposed',
                projectId: project.projectId,
                goalId: args.goalId,
                operationId: operation.id,
              },
              operation,
            },
          }
        }
        const previous = before.find((operation) => operation.id === args.action.operationId)
        const operation =
          args.action.kind === 'execute'
            ? await project.reconciler.executeOperation(
                args.goalId,
                args.action.operationId,
                eventId,
              )
            : await project.reconciler.cancelOperation(
                args.goalId,
                args.action.operationId,
                eventId,
              )
        return {
          summary: `${operation.intent.kind} Operation ${operation.id} is ${operation.status}.`,
          changed: JSON.stringify(previous) !== JSON.stringify(operation),
          value: {
            effect: {
              kind: `operation_${args.action.kind}`,
              projectId: project.projectId,
              goalId: args.goalId,
              operationId: operation.id,
            },
            operation,
          },
        }
      }
      case 'hopi_control_goal': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onGoalEffect(eventId, project.projectId, args.goalId)
        let goal = await requireGoal(project.store, args.goalId)
        let changed = false
        switch (args.action.kind) {
          case 'complete':
            goal = await project.reconciler.completeGoal(args.goalId, {
              decision: args.action.decision,
            })
            changed = true
            break
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
              if (args.action.contractChange) {
                assertPortableGoalText('Goal contract change', args.action.contractChange)
              }
              await project.controller.reopenGoal(args.goalId, {
                eventId,
                ...(args.action.contractChange
                  ? { contractChange: args.action.contractChange }
                  : {}),
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
      case 'hopi_manage_attention': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        options.onProjectDispatchEffect(eventId, project.projectId)
        const change = args.change
        const state = await options.workspace.readWorkspace()
        const target = `project:${project.projectId}`
        if (change.kind === 'present_attention_to_user') {
          const requestedReferences = [...new Set(change.attentionRefs)]
          await assertPresentableAttentionReferences(project.projectId, requestedReferences)
          const previousReferences = new Set(event.attributes.attentionRequest?.attentionRefs ?? [])
          const staged = await options.workspace.stageAttentionRequest(eventId, {
            attentionRefs: requestedReferences,
          })
          const attentionRefs = staged.attributes.attentionRequest?.attentionRefs ?? []
          return {
            summary: `Presented ${attentionRefs.length} Attention${attentionRefs.length === 1 ? '' : 's'} to the user through this turn.`,
            changed: requestedReferences.some((reference) => !previousReferences.has(reference)),
            value: {
              effect: {
                kind: 'attention_presentation_staged',
                attentionRefs,
              },
            },
          }
        }
        if (change.kind === 'create') {
          const attentionId = change.attentionId ?? `A-${crypto.randomUUID()}`
          const existing = state.attentions.get(attentionId)
          if (existing) {
            if (
              workspaceAttentionProjectId(existing) === project.projectId &&
              existing.attributes.resolvedAt === null &&
              existing.attributes.summary === change.summary &&
              JSON.stringify(existing.attributes.decisionPrompt ?? null) ===
                JSON.stringify(change.decisionPrompt ?? null) &&
              existing.body.trim() === change.body.trim()
            ) {
              return {
                summary: `Project Attention ${attentionId} was already current.`,
                changed: false,
                value: {
                  attentionId,
                  resolved: false,
                  attentionRef: workspaceAttentionReference(state.homeId, attentionId),
                },
              }
            }
            throw new AssistantToolRequestError(`Attention already exists: ${attentionId}`)
          }
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
          if (!attention || workspaceAttentionProjectId(attention) !== project.projectId) {
            throw new AssistantToolRequestError(
              `Project Attention not found: ${change.attentionId}`,
            )
          }
          if (
            change.body === undefined &&
            change.refs === undefined &&
            change.summary === undefined &&
            change.decisionPrompt === undefined
          ) {
            throw new AssistantToolRequestError(
              'Attention update requires summary, decisionPrompt, body, or refs',
            )
          }
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
              updatedAt: updated.attributes.updatedAt,
            },
          }
        }

        const parsedReference = parseAttentionReference(change.attentionRef)
        if (!parsedReference) {
          throw new AssistantToolRequestError(`Invalid Attention reference: ${change.attentionRef}`)
        }
        if (parsedReference.scope === 'goal') {
          if (parsedReference.projectId !== project.projectId) {
            throw new AssistantToolRequestError(
              `Attention is outside Project ${project.projectId}: ${change.attentionRef}`,
            )
          }
          const admission = await goalInputAdmission(
            options.workspace,
            project.store,
            parsedReference.goalId,
            event,
          )
          const changed = await resolveGoalAttention(
            project.store,
            parsedReference.goalId,
            parsedReference.attentionId,
            change.resolution,
            admission,
            now(),
          )
          return {
            summary: `Resolved Goal Attention ${parsedReference.attentionId}.`,
            changed,
            value: {
              attentionId: parsedReference.attentionId,
              resolved: true,
              attentionRef: change.attentionRef,
              resolutionInput: admission.path,
            },
          }
        }

        if (parsedReference.homeId !== state.homeId) {
          throw new AssistantToolRequestError(
            `Attention is outside the current Home: ${change.attentionRef}`,
          )
        }
        const attention = state.attentions.get(parsedReference.attentionId)
        if (!attention || workspaceAttentionProjectId(attention) !== project.projectId) {
          throw new AssistantToolRequestError(
            `Project Attention not found: ${parsedReference.attentionId}`,
          )
        }
        const changed = attention.attributes.resolvedAt === null
        if (changed) {
          await options.workspace.resolveAttention(
            parsedReference.attentionId,
            change.resolution,
            now(),
          )
        }
        return {
          summary: `Resolved Project Attention ${parsedReference.attentionId}.`,
          changed,
          value: {
            attentionId: parsedReference.attentionId,
            resolved: true,
            attentionRef: change.attentionRef,
          },
        }
      }
      case 'hopi_control_preview': {
        const args = parseAssistantToolArguments(name, input)
        const project = requireProject(options.projects, args.projectId)
        if (args.operation === 'start') {
          const repoRoots = project.repos.map((repo) => ({
            repoId: repo.repoId,
            path: resolveProjectPath(repo.integrationRoot, repo.projectPath),
          }))
          const result = await options.preview.start({
            projectId: project.projectId,
            projectRoot: project.sourceRoot,
            requestedBy: 'assistant',
            releaseHeads: await readProjectReleaseHeads(
              project.projectId,
              project.repos.map((repo) => ({
                repoId: repo.repoId,
                path: repo.integrationRoot,
              })),
            ),
            primaryRepoId: project.primaryRepoId,
            repoRoots,
            runtimeInputs: args.runtimeInputs,
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
    }
  }
}

function derivedOperationId(
  projectId: string,
  goalId: string,
  eventId: string,
  idempotencyKey: string,
) {
  const digest = new Bun.CryptoHasher('sha256')
    .update(`${projectId}\u0000${goalId}\u0000${eventId}\u0000${idempotencyKey}`)
    .digest('hex')
  return `OP-${digest.slice(0, 24)}`
}
