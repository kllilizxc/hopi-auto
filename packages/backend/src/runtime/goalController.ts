import { createAssistantEngineeringWork } from '../domain/assistantEngineeringWork'
import { workAttentionTarget } from '../domain/attentionTarget'
import {
  type AttentionDocument,
  type GoalDocument,
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

export interface PlanningAttentionSettlement {
  attentionIds: readonly string[]
  resolution: string
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
    settlement?: PlanningAttentionSettlement,
  ): Promise<WorkDocument>
  applyMaterialInstruction(
    goalId: string,
    input: {
      eventId: string
      contractChange: string
      acceptedInput?: PlanningInputAdmission
      planningContext?: PlanningContext
      planningSettlement?: PlanningAttentionSettlement
    },
  ): Promise<GoalDocument>
  pauseGoal(goalId: string): Promise<GoalDocument>
  resumeGoal(goalId: string): Promise<GoalDocument>
  setPriority(goalId: string, priority: number): Promise<GoalDocument>
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
    async ensurePlanning(goalId, reason, acceptedInput, context = {}, settlement = undefined) {
      const goalPackage = await store.readPackage(goalId)
      const existing = [...goalPackage.works.values()].find(
        (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
      )
      if (existing) {
        const acceptedBody = acceptedInput
          ? appendAcceptedInput(existing.body, acceptedInput.path)
          : existing.body
        const currentBody = replacePlanningObjective(acceptedBody, reason)
        const next = {
          ...existing,
          body: appendPlanningReferences(currentBody, context.references ?? []),
        }
        const changed = next.body !== existing.body
        const supportingWrites = [
          ...(context.supportingWrites ?? []),
          ...(acceptedInput?.write ? [acceptedInput.write] : []),
        ]
        const attentionWrites = await planningAttentionResolutionWrites(
          store,
          goalId,
          goalPackage,
          existing.attributes.id,
          acceptedInput,
          settlement,
          now(),
        )
        if (!changed && supportingWrites.length === 0 && attentionWrites.length === 0) {
          return existing
        }

        let planningWrite: PublicationWrite | null = null
        if (changed) {
          const path = store.paths.workDocument(goalId, existing.attributes.id)
          const source = await Bun.file(store.paths.absolute(path)).text()
          planningWrite = {
            path,
            expectedHash: await hashBytes(new TextEncoder().encode(source)),
            content: renderWorkDocument(next),
          }
        }

        if (attentionWrites.length > 0) {
          const gateWrite = attentionWrites.at(-1)
          if (!gateWrite) return next
          await store.publishGoal(goalId, {
            supportingWrites: [
              ...supportingWrites,
              ...(planningWrite ? [planningWrite] : []),
              ...attentionWrites.slice(0, -1),
            ],
            gateWrite,
          })
          return next
        }

        if (!changed) {
          const [gateWrite, ...supporting] = acceptedInput?.write
            ? [acceptedInput.write, ...(context.supportingWrites ?? [])]
            : [undefined, ...supportingWrites]
          await store.publishGoal(goalId, {
            supportingWrites: supporting.filter((write): write is PublicationWrite =>
              Boolean(write),
            ),
            ...(gateWrite ? { gateWrite } : {}),
          })
          return existing
        }

        if (!planningWrite) return next
        await store.publishGoal(goalId, {
          supportingWrites,
          gateWrite: planningWrite,
        })
        return next
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
      const attentionWrites = await planningAttentionResolutionWrites(
        store,
        goalId,
        goalPackage,
        planning.attributes.id,
        acceptedInput,
        settlement,
        now(),
      )
      const attentionGate = attentionWrites.at(-1)
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(context.supportingWrites ?? []),
          ...(acceptedInput?.write ? [acceptedInput.write] : []),
          ...(attentionGate ? [planningWrite, ...attentionWrites.slice(0, -1)] : []),
        ],
        gateWrite: attentionGate ?? planningWrite,
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
          replacePlanningObjective(work.body, input.contractChange) === work.body,
      )
      if (representedPlanning) {
        await this.ensurePlanning(
          goalId,
          input.contractChange,
          input.acceptedInput,
          input.planningContext,
          input.planningSettlement,
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
      const attentionWrites = await planningAttentionResolutionWrites(
        store,
        goalId,
        goalPackage,
        planning.attributes.id,
        input.acceptedInput,
        input.planningSettlement,
        now(),
      )
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
          ...attentionWrites,
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
      const next: WorkDocument = {
        ...work,
        body: appendProjectOwnerMessage(work.body, {
          recordedAt: now().toISOString(),
          sourceEventId: input.sourceEventId,
          content,
        }),
      }
      if (next.body === work.body) return work
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

async function planningAttentionResolutionWrites(
  store: GoalPackageStore,
  goalId: string,
  goalPackage: GoalPackage,
  planningWorkId: string,
  acceptedInput: PlanningInputAdmission | undefined,
  settlement: PlanningAttentionSettlement | undefined,
  resolvedAt: Date,
) {
  if (!settlement || settlement.attentionIds.length === 0) return []
  const attentionIds = [...new Set(settlement.attentionIds)]
  if (!acceptedInput) {
    throw new GoalControllerError('Planning Attention settlement requires one accepted Goal Input')
  }

  const exactTarget = workAttentionTarget(store.paths.projectId, goalId, planningWorkId)
  const writes: PublicationWrite[] = []
  for (const attentionId of attentionIds) {
    const current = goalPackage.attentions.get(attentionId)
    if (!current) throw new GoalControllerError(`Goal Attention not found: ${attentionId}`)
    if (current.attributes.target !== exactTarget || current.attributes.resolvedAt !== null)
      continue

    const path = store.paths.attentionDocument(goalId, attentionId)
    const source = await Bun.file(store.paths.absolute(path)).text()
    const resolved = parseAttentionDocument(source)
    resolved.attributes.resolvedAt = resolvedAt.toISOString()
    resolved.attributes.resolutionInput = acceptedInput.path
    resolved.body = [
      resolved.body.trimEnd(),
      '',
      '## Resolution',
      '',
      `Answer Input: \`${acceptedInput.path}\``,
      '',
      settlement.resolution.trim(),
      '',
    ].join('\n')
    writes.push({
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderAttentionDocument(resolved),
    })
  }
  return writes
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

function replacePlanningObjective(body: string, objective: string) {
  const normalized = body.trimEnd()
  const heading = '## Objective'
  const headingIndex = normalized.indexOf(heading)
  if (headingIndex === -1) return `${heading}\n\n${objective.trim()}\n\n${normalized}\n`
  const nextHeading = normalized.indexOf('\n## ', headingIndex + heading.length)
  const prefix = normalized.slice(0, headingIndex)
  const suffix = nextHeading === -1 ? '' : normalized.slice(nextHeading).trimStart()
  return `${prefix}${heading}\n\n${objective.trim()}\n${suffix ? `\n${suffix}\n` : ''}`
}

function appendAcceptedInput(body: string, path: string) {
  const entry = `- ${path}`
  if (body.split(/\r?\n/).some((line) => line.trim() === entry)) return body
  const normalized = body.trimEnd()
  const heading = '## Accepted Inputs'
  const headingIndex = normalized.indexOf(heading)
  if (headingIndex === -1) return `${normalized}\n\n${heading}\n\n${entry}\n`

  const nextHeading = normalized.indexOf('\n## ', headingIndex + heading.length)
  const insertAt = nextHeading === -1 ? normalized.length : nextHeading
  return `${normalized.slice(0, insertAt).trimEnd()}\n${entry}\n${normalized
    .slice(insertAt)
    .trimStart()}`
}

function appendPlanningReferences(body: string, references: readonly PlanningReference[]) {
  let next = body
  for (const reference of references) {
    const purpose = reference.purpose.trim().replace(/\s+/g, ' ')
    const entry = `- \`${reference.path}\` - ${purpose}`
    if (next.split(/\r?\n/).some((line) => line.trim() === entry)) continue
    next = appendListEntry(next, '## Reference Images', entry)
  }
  return next
}

function appendListEntry(body: string, heading: string, entry: string) {
  const normalized = body.trimEnd()
  const headingIndex = normalized.indexOf(heading)
  if (headingIndex === -1) return `${normalized}\n\n${heading}\n\n${entry}\n`
  const nextHeading = normalized.indexOf('\n## ', headingIndex + heading.length)
  const insertAt = nextHeading === -1 ? normalized.length : nextHeading
  return `${normalized.slice(0, insertAt).trimEnd()}\n${entry}\n${normalized
    .slice(insertAt)
    .trimStart()}`
}

function materialRevisionPlanning(
  goalPackage: GoalPackage,
  revision: number,
  contractChange: string,
  acceptedInput: PlanningInputAdmission | undefined,
  context: PlanningContext | undefined,
): WorkDocument {
  const existing = [...goalPackage.works.values()].find(
    (work) => isPlanningWork(work.attributes) && work.attributes.stage === 'plan',
  )
  if (existing) {
    if (!isPlanningWork(existing.attributes)) {
      throw new GoalControllerError('Open Planning lookup returned Engineering Work')
    }
    const attributes = existing.attributes
    const acceptedBody = acceptedInput
      ? appendAcceptedInput(existing.body, acceptedInput.path)
      : existing.body
    return {
      ...existing,
      attributes: {
        ...attributes,
        stage: 'plan',
        contractRevision: revision,
      },
      body: appendPlanningReferences(
        replacePlanningObjective(acceptedBody, contractChange),
        context?.references ?? [],
      ),
    }
  }

  return createPlanningWork(goalPackage, revision, contractChange, acceptedInput, context)
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
      title: 'Reassess and plan the Goal',
      kind: 'planning',
      stage: 'plan',
      notBefore: null,
      dependsOn: [],
      contractRevision: revision,
      evidenceRefs: [],
    },
    body: [
      '## Objective',
      '',
      objective.trim(),
      '',
      '## Acceptance Criteria',
      '',
      '- Current Goal criteria and proof are assessed semantically.',
      '- Additional Work or targeted Attention is published, or final success completes the Goal.',
      '',
      ...(acceptedInput ? ['## Accepted Inputs', '', `- ${acceptedInput.path}`, ''] : []),
      ...(context?.references?.length
        ? [
            '## Reference Images',
            '',
            ...context.references.map(
              (reference) => `- \`${reference.path}\` - ${reference.purpose.trim()}`,
            ),
            '',
          ]
        : []),
    ].join('\n'),
  }
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
