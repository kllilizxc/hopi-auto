import { createAssistantEngineeringWork } from '../domain/assistantEngineeringWork'
import {
  type AttentionDocument,
  type GoalDocument,
  type WorkContextRef,
  type WorkDocument,
  isEngineeringWork,
  isPlanningWork,
  isWorkTerminal,
  parseAttentionDocument,
  renderAttentionDocument,
  renderGoalDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { InboxEventReference } from '../domain/inboxEventReference'
import { deriveReadableId } from '../domain/stableId'
import { WorkCancellationError, workCancellationOrder } from '../domain/workCancellation'
import { hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { PlanningReference } from '../storage/goalPackageStore'
import { appendProjectOwnerMessage } from './workAssignment'

export interface PlanningInputAdmission {
  path: string
  write: PublicationWrite | null
}

export interface PlanningContext {
  supportingWrites?: PublicationWrite[]
  references?: readonly PlanningReference[]
}

export interface AssistantEngineeringAdmission {
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  dependsOn: readonly string[]
  assistantDispatch: InboxEventReference
  acceptedInput: PlanningInputAdmission
  context?: PlanningContext
}

export interface GoalControllerOptions {
  now?: () => Date
}

export interface GoalController {
  admitAssistantEngineeringWork(
    goalId: string,
    input: AssistantEngineeringAdmission,
  ): Promise<WorkDocument>
  ensurePlanning(
    goalId: string,
    reason: string,
    acceptedInput?: PlanningInputAdmission,
    context?: PlanningContext,
  ): Promise<WorkDocument>
  applyMaterialInstruction(
    goalId: string,
    input: {
      contractChange: string
      acceptedInput: PlanningInputAdmission
      planningContext?: PlanningContext
    },
  ): Promise<GoalDocument>
  pauseGoal(goalId: string): Promise<GoalDocument>
  resumeGoal(goalId: string): Promise<GoalDocument>
  setPriority(goalId: string, priority: number): Promise<GoalDocument>
  setEngineeringWorkFocus(
    goalId: string,
    workId: string,
    stage: 'generate' | 'review',
  ): Promise<WorkDocument>
  returnEngineeringWorkToGenerate(goalId: string, workId: string): Promise<WorkDocument>
  setWorkNotBefore(goalId: string, workId: string, notBefore: string | null): Promise<WorkDocument>
  setWorkDependencies(
    goalId: string,
    workId: string,
    dependsOn: readonly string[],
  ): Promise<WorkDocument>
  appendWorkMessage(
    goalId: string,
    workId: string,
    input: { sourceEventId: string; content: string },
  ): Promise<WorkDocument>
  cancelWork(goalId: string, workId: string): Promise<readonly WorkDocument[]>
  cancelGoal(goalId: string): Promise<GoalDocument>
  reopenGoal(
    goalId: string,
    input: { eventId: string; contractChange?: string },
  ): Promise<GoalDocument>
}

export class GoalControllerError extends Error {}

export function createGoalController(
  store: GoalPackageStore,
  options: GoalControllerOptions,
): GoalController {
  const now = options.now ?? (() => new Date())

  return {
    async admitAssistantEngineeringWork(goalId, input) {
      const goalPackage = await store.readPackage(goalId)
      const existing = [...goalPackage.works.values()].find(
        (work) =>
          isEngineeringWork(work.attributes) &&
          work.attributes.assistantDispatch === input.assistantDispatch,
      )
      const workId =
        existing?.attributes.id ?? deriveReadableId('W', input.title, [...goalPackage.works.keys()])
      const work = createAssistantEngineeringWork({
        id: workId,
        title: input.title,
        objective: input.objective,
        acceptanceCriteria: input.acceptanceCriteria,
        dependsOn: input.dependsOn,
        contractRevision: goalPackage.goal.attributes.contractRevision,
        assistantDispatch: input.assistantDispatch,
        acceptedInputPath: input.acceptedInput.path,
        references: input.context?.references,
      })
      if (!isEngineeringWork(work.attributes)) {
        throw new GoalControllerError('Assistant Engineering Work builder returned Planning Work')
      }
      if (existing) {
        if (!isEngineeringWork(existing.attributes)) {
          throw new GoalControllerError(
            'Assistant dispatch provenance belongs to non-Engineering Work',
          )
        }
        if (
          existing.attributes.title === work.attributes.title &&
          JSON.stringify(existing.attributes.dependsOn) ===
            JSON.stringify(work.attributes.dependsOn) &&
          existing.attributes.contractRevision === work.attributes.contractRevision &&
          JSON.stringify(existing.attributes.contextRefs) ===
            JSON.stringify(work.attributes.contextRefs) &&
          existing.body === work.body
        ) {
          return existing
        }
        throw new GoalControllerError(
          `Inbox Input already directly admitted Engineering Work ${existing.attributes.id}`,
        )
      }
      if (goalPackage.goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Direct Engineering Work requires an active Goal')
      }
      for (const dependencyId of input.dependsOn) {
        const dependency = goalPackage.works.get(dependencyId)
        if (!dependency || !isEngineeringWork(dependency.attributes)) {
          throw new GoalControllerError(
            `Direct Engineering Work dependency is missing or not Engineering Work: ${dependencyId}`,
          )
        }
        if (dependency.attributes.stage === 'cancelled') {
          throw new GoalControllerError(
            `Direct Engineering Work cannot depend on cancelled Work: ${dependencyId}`,
          )
        }
      }

      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(input.context?.supportingWrites ?? []),
          ...(input.acceptedInput.write ? [input.acceptedInput.write] : []),
        ],
        gateWrite: {
          path: store.paths.workDocument(goalId, work.attributes.id),
          expectedHash: null,
          content: renderWorkDocument(work),
        },
      })
      return work
    },
    async ensurePlanning(goalId, reason, acceptedInput, context = {}) {
      const goalPackage = await store.readPackage(goalId)
      const existing = [...goalPackage.works.values()].find(
        (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
      )
      if (existing) {
        const next: WorkDocument = {
          ...existing,
          attributes: {
            ...existing.attributes,
            contextRefs: mergeWorkContextRefs(existing.attributes.contextRefs, [
              ...(acceptedInput
                ? [{ path: acceptedInput.path, purpose: 'Accepted Inbox input' }]
                : []),
              ...(context.references ?? []),
            ]),
          },
        }
        const changed =
          JSON.stringify(next.attributes.contextRefs) !==
          JSON.stringify(existing.attributes.contextRefs)
        const supportingWrites = [
          ...(context.supportingWrites ?? []),
          ...(acceptedInput?.write ? [acceptedInput.write] : []),
        ]
        if (!changed && supportingWrites.length === 0) {
          return existing
        }

        if (changed) {
          const path = store.paths.workDocument(goalId, existing.attributes.id)
          const source = await Bun.file(store.paths.absolute(path)).text()
          await store.publishGoal(goalId, {
            supportingWrites,
            gateWrite: {
              path,
              expectedHash: await hashBytes(new TextEncoder().encode(source)),
              content: renderWorkDocument(next),
            },
          })
          return next
        }

        const gateWrite = supportingWrites.at(-1)
        if (!gateWrite) return existing
        await store.publishGoal(goalId, {
          supportingWrites: supportingWrites.slice(0, -1),
          gateWrite,
        })
        return existing
      }
      if (
        goalPackage.goal.attributes.lifecycle === 'done' ||
        goalPackage.goal.attributes.lifecycle === 'cancelled'
      ) {
        throw new GoalControllerError(
          'Terminal Goal must be reopened before Planning Work is added',
        )
      }

      const planning = createPlanningWork(
        goalPackage,
        goalPackage.goal.attributes.contractRevision,
        reason,
        acceptedInput,
        context,
      )
      const planningWrite: PublicationWrite = {
        path: store.paths.workDocument(goalId, planning.attributes.id),
        expectedHash: null,
        content: renderWorkDocument(planning),
      }
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(context.supportingWrites ?? []),
          ...(acceptedInput?.write ? [acceptedInput.write] : []),
        ],
        gateWrite: planningWrite,
      })
      return planning
    },
    async applyMaterialInstruction(goalId, input) {
      const goalPackage = await store.readPackage(goalId)
      if (
        goalPackage.goal.attributes.lifecycle === 'done' ||
        goalPackage.goal.attributes.lifecycle === 'cancelled'
      ) {
        throw new GoalControllerError('Terminal Goal must be explicitly reopened')
      }
      const representedPlanning = [...goalPackage.works.values()].find(
        (work) =>
          isPlanningWork(work.attributes) &&
          work.attributes.stage === 'plan' &&
          work.attributes.contractRevision === goalPackage.goal.attributes.contractRevision &&
          work.attributes.revisionInput === input.acceptedInput.path,
      )
      if (representedPlanning) {
        await this.ensurePlanning(
          goalId,
          input.contractChange,
          input.acceptedInput,
          input.planningContext,
        )
        return (await store.readPackage(goalId)).goal
      }

      const revision = goalPackage.goal.attributes.contractRevision + 1
      const existingPlanning = [...goalPackage.works.values()].find(
        (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
      )
      const planning = materialRevisionPlanning(
        goalPackage,
        revision,
        input.contractChange,
        input.acceptedInput,
        input.planningContext,
      )
      const planningPath = store.paths.workDocument(goalId, planning.attributes.id)
      const planningSource = existingPlanning
        ? await Bun.file(store.paths.absolute(planningPath)).text()
        : null
      const goalPath = store.paths.goalDocument(goalId)
      const goalSource = await Bun.file(store.paths.absolute(goalPath)).text()
      const nextGoal: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          contractRevision: revision,
        },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(input.planningContext?.supportingWrites ?? []),
          ...(input.acceptedInput?.write ? [input.acceptedInput.write] : []),
          {
            path: planningPath,
            expectedHash: planningSource
              ? await hashBytes(new TextEncoder().encode(planningSource))
              : null,
            content: renderWorkDocument(planning),
          },
        ],
        gateWrite: {
          path: goalPath,
          expectedHash: await hashBytes(new TextEncoder().encode(goalSource)),
          content: renderGoalDocument(nextGoal),
        },
      })
      return nextGoal
    },
    async pauseGoal(goalId) {
      const goal = await requireGoal(store, goalId)
      if (goal.attributes.lifecycle === 'paused') return goal
      if (goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Only an active Goal can pause')
      }
      const next: GoalDocument = {
        ...goal,
        attributes: { ...goal.attributes, lifecycle: 'paused' },
      }
      await replaceGoal(store, goalId, next)
      return next
    },
    async resumeGoal(goalId) {
      let goalPackage = await store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle === 'active') return goalPackage.goal
      if (goalPackage.goal.attributes.lifecycle !== 'paused') {
        throw new GoalControllerError('Only a paused Goal can resume')
      }

      await this.ensurePlanning(goalId, 'Reassess current truth after Goal resume.')
      goalPackage = await store.readPackage(goalId)
      const current = goalPackage.goal
      const next: GoalDocument = {
        ...current,
        attributes: { ...current.attributes, lifecycle: 'active' },
      }
      await replaceGoal(store, goalId, next)
      return next
    },
    async setPriority(goalId, priority) {
      if (!Number.isInteger(priority))
        throw new GoalControllerError('Goal priority must be an integer')
      const goal = await requireGoal(store, goalId)
      if (goal.attributes.priority === priority) return goal
      const next: GoalDocument = {
        ...goal,
        attributes: { ...goal.attributes, priority },
      }
      await replaceGoal(store, goalId, next)
      return next
    },
    async setEngineeringWorkFocus(goalId, workId, stage) {
      const goalPackage = await store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Engineering Work focus requires an active Goal')
      }
      const work = goalPackage.works.get(workId)
      if (!work || !isEngineeringWork(work.attributes)) {
        throw new GoalControllerError(`Engineering Work not found: ${workId}`)
      }
      if (isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(`Cannot change terminal Work focus: ${workId}`)
      }
      if (work.attributes.stage === stage) return work
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, stage },
      }
      const path = store.paths.workDocument(goalId, workId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        },
      })
      return next
    },
    async returnEngineeringWorkToGenerate(goalId, workId) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || !isEngineeringWork(work.attributes) || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot return missing or terminal Engineering Work to Generator: ${workId}`,
        )
      }
      if (work.attributes.stage === 'generate') return work
      if (work.attributes.stage !== 'review') {
        throw new GoalControllerError(
          `Cannot return Engineering Work from ${work.attributes.stage} to Generator: ${workId}`,
        )
      }
      const path = store.paths.workDocument(goalId, workId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, stage: 'generate' },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        },
      })
      return next
    },
    async setWorkNotBefore(goalId, workId, notBefore) {
      if (notBefore !== null && Number.isNaN(Date.parse(notBefore))) {
        throw new GoalControllerError('Work notBefore must be an ISO timestamp or null')
      }
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(`Cannot schedule missing or terminal Work: ${workId}`)
      }
      if (work.attributes.notBefore === notBefore) return work
      const path = store.paths.workDocument(goalId, workId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, notBefore },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        },
      })
      return next
    },
    async setWorkDependencies(goalId, workId, dependsOn) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || !isEngineeringWork(work.attributes) || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot change dependencies for missing, terminal, or non-Engineering Work: ${workId}`,
        )
      }
      const nextDependencies = [...new Set(dependsOn)]
      for (const dependencyId of nextDependencies) {
        if (dependencyId === workId) {
          throw new GoalControllerError(`Work cannot depend on itself: ${workId}`)
        }
        const dependency = goalPackage.works.get(dependencyId)
        if (!dependency || !isEngineeringWork(dependency.attributes)) {
          throw new GoalControllerError(
            `Work dependency is missing or not Engineering Work: ${dependencyId}`,
          )
        }
        if (dependency.attributes.stage === 'cancelled') {
          throw new GoalControllerError(`Work cannot depend on cancelled Work: ${dependencyId}`)
        }
      }
      if (JSON.stringify(nextDependencies) === JSON.stringify(work.attributes.dependsOn)) {
        return work
      }
      const path = store.paths.workDocument(goalId, workId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, dependsOn: nextDependencies },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        },
      })
      return next
    },
    async appendWorkMessage(goalId, workId, input) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(`Cannot message missing or terminal Work: ${workId}`)
      }
      const content = input.content.trim()
      if (!content) throw new GoalControllerError('Work message cannot be empty')
      const path = store.paths.workDocument(goalId, workId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const ownerMessages = appendProjectOwnerMessage(work.attributes.ownerMessages, {
        recordedAt: now().toISOString(),
        sourceEventId: input.sourceEventId,
        content,
      })
      if (ownerMessages === work.attributes.ownerMessages) return work
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, ownerMessages: [...ownerMessages] },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        },
      })
      return next
    },
    async cancelWork(goalId, workId) {
      let goalPackage = await store.readPackage(goalId)
      const target = goalPackage.works.get(workId)
      if (!target) throw new GoalControllerError(`Cannot cancel missing Work: ${workId}`)
      if (target.attributes.stage === 'done') {
        throw new GoalControllerError(`Cannot cancel completed Work: ${workId}`)
      }
      if (target.attributes.stage === 'cancelled') return []
      let cancellationOrder: string[]
      try {
        cancellationOrder = workCancellationOrder(goalPackage, [workId])
      } catch (error) {
        if (error instanceof WorkCancellationError) throw new GoalControllerError(error.message)
        throw error
      }
      const cancelled: WorkDocument[] = []
      for (const candidateId of cancellationOrder) {
        goalPackage = await store.readPackage(goalId)
        const candidate = goalPackage.works.get(candidateId)
        if (candidate && !isWorkTerminal(candidate.attributes)) {
          await publishWorkCancellation(store, goalId, candidate)
          cancelled.push({
            ...candidate,
            attributes: { ...candidate.attributes, stage: 'cancelled' },
          } as WorkDocument)
        }
      }
      return cancelled
    },
    async cancelGoal(goalId) {
      let goalPackage = await store.readPackage(goalId)
      const lifecycle = goalPackage.goal.attributes.lifecycle
      if (lifecycle === 'done') {
        throw new GoalControllerError('A completed Goal must be reopened before cancellation')
      }
      if (lifecycle !== 'cancelled') {
        const cancelled: GoalDocument = {
          ...goalPackage.goal,
          attributes: { ...goalPackage.goal.attributes, lifecycle: 'cancelled' },
        }
        await replaceGoal(store, goalId, cancelled)
      }

      while (true) {
        goalPackage = await store.readPackage(goalId)
        const nonterminal = [...goalPackage.works.values()].filter(
          (work) => !isWorkTerminal(work.attributes),
        )
        if (nonterminal.length === 0) break
        const candidate = nonterminal.find(
          (work) =>
            !nonterminal.some((dependent) =>
              dependent.attributes.dependsOn.includes(work.attributes.id),
            ),
        )
        if (!candidate) throw new GoalControllerError('Cannot cancel a cyclic Work graph')
        await publishWorkCancellation(store, goalId, candidate)
      }

      goalPackage = await store.readPackage(goalId)
      for (const attention of goalPackage.attentions.values()) {
        if (attention.attributes.resolvedAt === null) {
          await resolveAttention(
            store,
            goalId,
            attention,
            now(),
            'Superseded because the Goal was cancelled.',
          )
        }
      }
      return (await store.readPackage(goalId)).goal
    },
    async reopenGoal(goalId, input) {
      let goalPackage = await store.readPackage(goalId)
      if (
        goalPackage.goal.attributes.lifecycle === 'active' &&
        hasAcceptedGoalInput(goalPackage, input.eventId)
      ) {
        await this.ensurePlanning(
          goalId,
          `Reassess reopened Goal after Inbox event ${input.eventId}.`,
        )
        return (await store.readPackage(goalId)).goal
      }
      if (
        goalPackage.goal.attributes.lifecycle !== 'done' &&
        goalPackage.goal.attributes.lifecycle !== 'cancelled'
      ) {
        throw new GoalControllerError('Only a terminal Goal can reopen')
      }
      if (goalPackage.goal.attributes.lifecycle === 'cancelled') {
        await this.cancelGoal(goalId)
        goalPackage = await store.readPackage(goalId)
      }

      const path = store.paths.goalDocument(goalId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const reopened: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          lifecycle: 'active',
          contractRevision: goalPackage.goal.attributes.contractRevision + 1,
        },
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderGoalDocument(reopened),
        },
      })
      await this.ensurePlanning(
        goalId,
        input.contractChange ?? `Reassess reopened Goal after Inbox event ${input.eventId}.`,
      )
      return (await store.readPackage(goalId)).goal
    },
  }
}

async function requireGoal(store: GoalPackageStore, goalId: string) {
  const goal = await store.readGoal(goalId)
  if (!goal) throw new GoalControllerError(`Goal not found: ${goalId}`)
  return goal
}

async function replaceGoal(store: GoalPackageStore, goalId: string, next: GoalDocument) {
  const source = await Bun.file(store.paths.absolute(store.paths.goalDocument(goalId))).text()
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path: store.paths.goalDocument(goalId),
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderGoalDocument(next),
    },
  })
}

async function resolveAttention(
  store: GoalPackageStore,
  goalId: string,
  attention: AttentionDocument,
  resolvedAt: Date,
  reason: string,
) {
  if (attention.attributes.resolvedAt !== null) return
  const path = store.paths.attentionDocument(goalId, attention.attributes.id)
  const source = await Bun.file(store.paths.absolute(path)).text()
  const next = parseAttentionDocument(source)
  next.attributes.resolvedAt = resolvedAt.toISOString()
  next.body += `\n## Resolution\n\n${reason}\n`
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(next),
    },
  })
}

async function publishWorkCancellation(
  store: GoalPackageStore,
  goalId: string,
  work: WorkDocument,
) {
  const path = store.paths.workDocument(goalId, work.attributes.id)
  const source = await Bun.file(store.paths.absolute(path)).text()
  const next: WorkDocument = {
    ...work,
    attributes: { ...work.attributes, stage: 'cancelled' },
  }
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(next),
    },
  })
}

function materialRevisionPlanning(
  goalPackage: GoalPackage,
  revision: number,
  contractChange: string,
  acceptedInput: PlanningInputAdmission,
  context: PlanningContext | undefined,
): WorkDocument {
  const existing = [...goalPackage.works.values()].find(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  if (existing) {
    if (!isPlanningWork(existing.attributes)) {
      throw new GoalControllerError('Open Planning lookup returned Engineering Work')
    }
    return {
      ...existing,
      attributes: {
        ...existing.attributes,
        stage: 'plan',
        contractRevision: revision,
        revisionInput: acceptedInput.path,
        contextRefs: mergeWorkContextRefs(existing.attributes.contextRefs, [
          { path: acceptedInput.path, purpose: 'Accepted Inbox input' },
          ...(context?.references ?? []),
        ]),
      },
      body: contractChange.trim(),
    }
  }

  const planning = createPlanningWork(goalPackage, revision, contractChange, acceptedInput, context)
  if (!isPlanningWork(planning.attributes)) {
    throw new GoalControllerError('Planning builder returned Engineering Work')
  }
  planning.attributes.revisionInput = acceptedInput.path
  return planning
}

function createPlanningWork(
  goalPackage: GoalPackage,
  revision: number,
  objective: string,
  acceptedInput: PlanningInputAdmission | undefined,
  context: PlanningContext | undefined,
): WorkDocument {
  return {
    attributes: {
      id: nextPlanningWorkId(goalPackage),
      title: 'Plan current Goal',
      kind: 'planning',
      stage: 'plan',
      notBefore: null,
      dependsOn: [],
      contractRevision: revision,
      evidenceRefs: [],
      contextRefs: [
        ...(acceptedInput ? [{ path: acceptedInput.path, purpose: 'Accepted Inbox input' }] : []),
        ...(context?.references ?? []),
      ],
      ownerMessages: [],
    },
    body: objective.trim(),
  }
}

function mergeWorkContextRefs(
  current: readonly WorkContextRef[],
  additions: readonly WorkContextRef[],
) {
  const references = new Map(current.map((reference) => [reference.path, reference]))
  for (const reference of additions) references.set(reference.path, reference)
  return [...references.values()]
}

function hasAcceptedGoalInput(goalPackage: GoalPackage, eventId: string) {
  return goalPackage.inputs.some((input) => input.attributes.sourceEventId === eventId)
}

function nextPlanningWorkId(goalPackage: GoalPackage) {
  const count = [...goalPackage.works.values()].filter((work) =>
    isPlanningWork(work.attributes),
  ).length
  return `plan-${String(count + 1).padStart(4, '0')}`
}
