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
import { hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { PlanningReference } from '../storage/goalPackageStore'

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

export interface WorkRetrySettlement {
  resolution: string
  acceptedInput?: PlanningInputAdmission
}

export interface AssistantEngineeringAdmission {
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  repos: readonly string[]
  dependsOn: readonly string[]
  assistantDispatch: InboxEventReference
  acceptedInput: PlanningInputAdmission
  context?: PlanningContext
}

export interface GoalControllerOptions {
  now?: () => Date
  verifyCompletion(goalId: string, packageState: GoalPackage): Promise<boolean> | boolean
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
      content: string
      acceptedInput?: PlanningInputAdmission
      planningContext?: PlanningContext
      planningSettlement?: PlanningAttentionSettlement
    },
  ): Promise<GoalDocument>
  ensureAttemptsAttention(goalId: string, workId: string): Promise<AttentionDocument>
  ensureResponsibilityFailureAttention(
    goalId: string,
    workId: string,
    responsibility: 'planner' | 'generator' | 'reviewer',
    latestFailure: string,
  ): Promise<AttentionDocument>
  ensureOperationalFailureAttention(
    goalId: string,
    workId: string,
    failures: number,
    latestFailure: string,
  ): Promise<AttentionDocument>
  ensureSynchronizationAttention(
    goalId: string,
    workId: string,
    diagnostic: string,
  ): Promise<AttentionDocument>
  completeGoal(goalId: string, attentionId: string): Promise<GoalDocument>
  pauseGoal(goalId: string): Promise<GoalDocument>
  resumeGoal(goalId: string): Promise<GoalDocument>
  setPriority(goalId: string, priority: number): Promise<GoalDocument>
  returnEngineeringWorkToGenerate(goalId: string, workId: string): Promise<WorkDocument>
  setWorkNotBefore(goalId: string, workId: string, notBefore: string | null): Promise<WorkDocument>
  retryWork(
    goalId: string,
    workId: string,
    notBefore: string | null,
    settlement?: WorkRetrySettlement,
  ): Promise<WorkDocument>
  cancelWork(goalId: string, workId: string): Promise<readonly WorkDocument[]>
  cancelGoal(goalId: string): Promise<GoalDocument>
  reopenGoal(goalId: string, input: { eventId: string; content: string }): Promise<GoalDocument>
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
        repos: input.repos,
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
          JSON.stringify(existing.attributes.repos) === JSON.stringify(work.attributes.repos) &&
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
      if (
        [...goalPackage.works.values()].some(
          (candidate) =>
            isPlanningWork(candidate.attributes) && candidate.attributes.stage === 'plan',
        )
      ) {
        throw new GoalControllerError('Direct Engineering Work cannot bypass current Planning Work')
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

      const completionWrites = await supersededCompletionWrites(store, goalId, goalPackage, now())
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(input.context?.supportingWrites ?? []),
          ...(input.acceptedInput.write ? [input.acceptedInput.write] : []),
          ...completionWrites,
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

      const planning: WorkDocument = {
        attributes: {
          id: nextPlanningWorkId(goalPackage),
          title: 'Reassess and plan the Goal',
          kind: 'planning',
          stage: 'plan',
          notBefore: null,
          dependsOn: [],
          contractRevision: goalPackage.goal.attributes.contractRevision,
          evidenceRefs: [],
          attempts: 0,
        },
        body: [
          '## Objective',
          '',
          reason.trim(),
          '',
          '## Acceptance Criteria',
          '',
          '- Current Goal criteria and proof are assessed semantically.',
          '- Additional Work, targeted Attention, or one completion proposal is published.',
          '',
          ...(acceptedInput ? ['## Accepted Inputs', '', `- ${acceptedInput.path}`, ''] : []),
          ...(context.references?.length
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
      let goalPackage = await store.readPackage(goalId)
      if (
        goalPackage.goal.attributes.lifecycle === 'done' ||
        goalPackage.goal.attributes.lifecycle === 'cancelled'
      ) {
        throw new GoalControllerError('Terminal Goal must be explicitly reopened')
      }
      const marker = instructionHeading(input.eventId)
      if (goalPackage.goal.body.includes(marker)) {
        await this.ensurePlanning(
          goalId,
          `Reassess accepted Inbox event ${input.eventId}.`,
          input.acceptedInput,
          input.planningContext,
          input.planningSettlement,
        )
        return (await store.readPackage(goalId)).goal
      }

      await this.ensurePlanning(
        goalId,
        `Interpret accepted Inbox event ${input.eventId} and update the contract, design, and Work plan.`,
        input.acceptedInput,
        input.planningContext,
        input.planningSettlement,
      )
      goalPackage = await store.readPackage(goalId)
      for (const attention of goalPackage.attentions.values()) {
        if (attention.attributes.target === null && attention.attributes.resolvedAt === null) {
          await resolveAsSuperseded(store, goalId, attention, now())
        }
      }
      goalPackage = await store.readPackage(goalId)
      const revision = goalPackage.goal.attributes.contractRevision + 1
      const supportingWrites: Parameters<GoalPackageStore['publishGoal']>[1]['supportingWrites'] =
        []
      for (const work of goalPackage.works.values()) {
        if (isWorkTerminal(work.attributes)) continue
        const path = store.paths.workDocument(goalId, work.attributes.id)
        const source = await Bun.file(store.paths.absolute(path)).text()
        const next: WorkDocument = isPlanningWork(work.attributes)
          ? {
              ...work,
              attributes: {
                ...work.attributes,
                stage: 'plan',
                contractRevision: revision,
                attempts: 0,
              },
            }
          : {
              ...work,
              attributes: {
                ...work.attributes,
                stage: 'generate',
                contractRevision: revision,
                attempts: 0,
              },
            }
        supportingWrites.push({
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        })
      }
      const goalPath = store.paths.goalDocument(goalId)
      const goalSource = await Bun.file(store.paths.absolute(goalPath)).text()
      const nextGoal: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          contractRevision: revision,
        },
        body: appendInstruction(goalPackage.goal.body, input),
      }
      await store.publishGoal(goalId, {
        supportingWrites,
        gateWrite: {
          path: goalPath,
          expectedHash: await hashBytes(new TextEncoder().encode(goalSource)),
          content: renderGoalDocument(nextGoal),
        },
      })
      return nextGoal
    },
    async ensureAttemptsAttention(goalId, workId) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot create retry Attention for missing or terminal Work: ${workId}`,
        )
      }
      const target = workAttentionTarget(store.paths.projectId, goalId, workId)
      const existing = [...goalPackage.attentions.values()].find(
        (attention) =>
          attention.attributes.target === target && attention.attributes.resolvedAt === null,
      )
      if (existing) return existing

      const attention: AttentionDocument = {
        attributes: {
          id: `attempts-${workId}-${work.attributes.attempts}-${crypto.randomUUID()}`,
          target,
          createdAt: now().toISOString(),
          resolvedAt: null,
          notifiedAt: null,
          operatorRequest: null,
        },
        body: [
          '## Reviewed recovery decision',
          '',
          `Work ${workId} exhausted its ${work.attributes.attempts} reviewed repair attempts.`,
          '',
          'Inspect the linked Evidence and decide whether to retry, revise the Goal, or cancel Work.',
          '',
        ].join('\n'),
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path: store.paths.attentionDocument(goalId, attention.attributes.id),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      })
      return attention
    },
    async ensureResponsibilityFailureAttention(goalId, workId, responsibility, latestFailure) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot create responsibility failure Attention for missing or terminal Work: ${workId}`,
        )
      }
      const target = workAttentionTarget(store.paths.projectId, goalId, workId)
      const existing = [...goalPackage.attentions.values()].find(
        (attention) =>
          attention.attributes.target === target && attention.attributes.resolvedAt === null,
      )
      if (existing) return existing

      const attention: AttentionDocument = {
        attributes: {
          id: `failure-${workId}-${crypto.randomUUID()}`,
          target,
          createdAt: now().toISOString(),
          resolvedAt: null,
          notifiedAt: null,
          operatorRequest: null,
        },
        body: [
          '## Assistant recovery needed',
          '',
          `${responsibility} could not complete Work ${workId} under its current contract.`,
          '',
          '## Latest result',
          '',
          latestFailure.trim() || 'No failure summary was recorded.',
          '',
          'Inspect the linked Evidence and current documents. Retry only if the blocker changed; otherwise revise or cancel the Work. Notify the operator only when an exact decision or external action remains.',
          '',
        ].join('\n'),
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path: store.paths.attentionDocument(goalId, attention.attributes.id),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      })
      return attention
    },
    async ensureOperationalFailureAttention(goalId, workId, failures, latestFailure) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot create operational Attention for missing or terminal Work: ${workId}`,
        )
      }
      const target = workAttentionTarget(store.paths.projectId, goalId, workId)
      const existing = [...goalPackage.attentions.values()].find(
        (attention) =>
          attention.attributes.target === target && attention.attributes.resolvedAt === null,
      )
      if (existing) return existing

      const attention: AttentionDocument = {
        attributes: {
          id: `A-${crypto.randomUUID()}`,
          target,
          createdAt: now().toISOString(),
          resolvedAt: null,
          notifiedAt: null,
          operatorRequest: null,
        },
        body: [
          '## Needs attention',
          '',
          `Work ${workId} could not run successfully after ${failures} consecutive operational failures.`,
          'No published Work recovery attempt was consumed.',
          '',
          '## Latest failure',
          '',
          boundedAttentionText(latestFailure),
          '',
          'Inspect the latest Attempt logs and decide the concrete repair or operator action.',
          'Resolve this exact Attention only after that intervention so a fresh run may start.',
          '',
        ].join('\n'),
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path: store.paths.attentionDocument(goalId, attention.attributes.id),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      })
      return attention
    },
    async ensureSynchronizationAttention(goalId, workId, diagnostic) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot create synchronization Attention for missing or terminal Work: ${workId}`,
        )
      }
      const target = workAttentionTarget(store.paths.projectId, goalId, workId)
      const existing = [...goalPackage.attentions.values()].find(
        (attention) =>
          attention.attributes.target === target && attention.attributes.resolvedAt === null,
      )
      if (existing) return existing

      const attention: AttentionDocument = {
        attributes: {
          id: `sync-${workId}-${crypto.randomUUID()}`,
          target,
          createdAt: now().toISOString(),
          resolvedAt: null,
          notifiedAt: null,
          operatorRequest: null,
        },
        body: [
          '## Work synchronization needs recovery',
          '',
          `Coordinator preserved Work ${workId} but could not safely prepare its task lineage against the current release.`,
          '',
          '## Current diagnostic',
          '',
          boundedAttentionText(diagnostic),
          '',
          'Inspect this exact Work lineage. Retry only after the condition changed; request Planning only if the represented Goal contract or DAG must change, and create a distinct Work identity only when its preserved delta must be abandoned.',
          '',
        ].join('\n'),
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path: store.paths.attentionDocument(goalId, attention.attributes.id),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      })
      return attention
    },
    async completeGoal(goalId, attentionId) {
      const goalPackage = await store.readPackage(goalId)
      const goal = goalPackage.goal
      if (goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Only an active Goal can complete')
      }
      const completion = goalPackage.attentions.get(attentionId)
      if (
        !completion ||
        completion.attributes.target !== null ||
        completion.attributes.resolvedAt !== null
      ) {
        throw new GoalControllerError(
          'Goal completion requires one open targetless Planner proposal',
        )
      }
      if ([...goalPackage.works.values()].some((work) => !isWorkTerminal(work.attributes))) {
        throw new GoalControllerError('Goal completion requires every Work to be terminal')
      }
      if (
        [...goalPackage.attentions.values()].some(
          (attention) =>
            attention.attributes.target !== null && attention.attributes.resolvedAt === null,
        )
      ) {
        throw new GoalControllerError('Goal completion is blocked by targeted Attention')
      }
      if (!(await options.verifyCompletion(goalId, goalPackage))) {
        throw new GoalControllerError('Goal completion structure is not valid')
      }

      const next: GoalDocument = {
        ...goal,
        attributes: {
          ...goal.attributes,
          lifecycle: 'done',
          completionAttentionId: attentionId,
        },
      }
      await replaceGoal(store, goalId, next)
      return next
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

      for (const attention of goalPackage.attentions.values()) {
        if (
          attention.attributes.target === null &&
          attention.attributes.resolvedAt === null &&
          attention.attributes.id !== goalPackage.goal.attributes.completionAttentionId
        ) {
          await resolveAsSuperseded(store, goalId, attention, now())
        }
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
    async retryWork(goalId, workId, notBefore, settlement) {
      if (notBefore !== null && Number.isNaN(Date.parse(notBefore))) {
        throw new GoalControllerError('Work notBefore must be an ISO timestamp or null')
      }
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(`Cannot retry missing or terminal Work: ${workId}`)
      }
      const next: WorkDocument = {
        ...work,
        attributes: { ...work.attributes, attempts: 0, notBefore },
      }
      const writes: PublicationWrite[] = []
      if (settlement?.acceptedInput?.write) writes.push(settlement.acceptedInput.write)
      if (work.attributes.attempts !== 0 || work.attributes.notBefore !== notBefore) {
        const path = store.paths.workDocument(goalId, workId)
        const source = await Bun.file(store.paths.absolute(path)).text()
        writes.push({
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderWorkDocument(next),
        })
      }

      if (settlement) {
        const target = workAttentionTarget(store.paths.projectId, goalId, workId)
        for (const attention of goalPackage.attentions.values()) {
          if (attention.attributes.target !== target || attention.attributes.resolvedAt !== null) {
            continue
          }
          const path = store.paths.attentionDocument(goalId, attention.attributes.id)
          const source = await Bun.file(store.paths.absolute(path)).text()
          const resolved: AttentionDocument = {
            ...attention,
            attributes: {
              ...attention.attributes,
              operatorRequest: null,
              resolvedAt: now().toISOString(),
              resolutionInput: settlement.acceptedInput?.path ?? null,
            },
            body: [
              attention.body.trimEnd(),
              '',
              '## Resolution',
              '',
              ...(settlement.acceptedInput
                ? [`Answer Input: \`${settlement.acceptedInput.path}\``, '']
                : []),
              settlement.resolution.trim(),
              '',
            ].join('\n'),
          }
          writes.push({
            path,
            expectedHash: await hashBytes(new TextEncoder().encode(source)),
            content: renderAttentionDocument(resolved),
          })
        }
      }

      if (writes.length === 0) return work
      const attentionPrefix = `${store.paths.attentionRoot(goalId)}/`
      const attentionGateIndex = writes.findLastIndex((write) =>
        write.path.startsWith(attentionPrefix),
      )
      const gateIndex = attentionGateIndex >= 0 ? attentionGateIndex : writes.length - 1
      const [gateWrite] = writes.splice(gateIndex, 1)
      if (!gateWrite) return next
      await store.publishGoal(goalId, { supportingWrites: writes, gateWrite })
      return next
    },
    async cancelWork(goalId, workId) {
      let goalPackage = await store.readPackage(goalId)
      const target = goalPackage.works.get(workId)
      if (!target || target.attributes.kind !== 'engineering') {
        throw new GoalControllerError(`Cannot cancel missing or non-Engineering Work: ${workId}`)
      }
      if (target.attributes.stage === 'done') {
        throw new GoalControllerError(`Cannot cancel completed Work: ${workId}`)
      }
      if (target.attributes.stage === 'cancelled') {
        await this.ensurePlanning(goalId, `Reassess the plan after Work ${workId} was cancelled.`)
        return []
      }
      const cancellationSet = dependentClosure(goalPackage, workId)
      const cancelled: WorkDocument[] = []
      while (cancellationSet.size > 0) {
        goalPackage = await store.readPackage(goalId)
        const candidateId = [...cancellationSet].find(
          (id) =>
            ![...cancellationSet].some((dependentId) =>
              goalPackage.works.get(dependentId)?.attributes.dependsOn.includes(id),
            ),
        )
        if (!candidateId) throw new GoalControllerError('Cannot cancel a cyclic Work graph')
        const candidate = goalPackage.works.get(candidateId)
        if (candidate && !isWorkTerminal(candidate.attributes)) {
          await publishWorkCancellation(store, goalId, candidate)
          cancelled.push({
            ...candidate,
            attributes: { ...candidate.attributes, stage: 'cancelled' },
          } as WorkDocument)
        }
        cancellationSet.delete(candidateId)
      }
      await this.ensurePlanning(goalId, `Reassess the plan after Work ${workId} was cancelled.`)
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
      const marker = instructionHeading(input.eventId)
      if (
        goalPackage.goal.attributes.lifecycle === 'active' &&
        goalPackage.goal.body.includes(marker)
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

      const completion = goalPackage.goal.attributes.completionAttentionId
        ? goalPackage.attentions.get(goalPackage.goal.attributes.completionAttentionId)
        : null
      const supportingWrites: Parameters<GoalPackageStore['publishGoal']>[1]['supportingWrites'] =
        []
      if (completion?.attributes.resolvedAt === null) {
        const path = store.paths.attentionDocument(goalId, completion.attributes.id)
        const source = await Bun.file(store.paths.absolute(path)).text()
        const resolved: AttentionDocument = {
          attributes: {
            ...completion.attributes,
            operatorRequest: null,
            resolvedAt: now().toISOString(),
          },
          body: `${completion.body}\n## Resolution\n\nSuperseded by explicit Goal reopen.\n`,
        }
        supportingWrites.push({
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderAttentionDocument(resolved),
        })
      }
      const path = store.paths.goalDocument(goalId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      const reopened: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          lifecycle: 'active',
          contractRevision: goalPackage.goal.attributes.contractRevision + 1,
          completionAttentionId: null,
        },
        body: appendInstruction(goalPackage.goal.body, input),
      }
      await store.publishGoal(goalId, {
        supportingWrites,
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderGoalDocument(reopened),
        },
      })
      await this.ensurePlanning(
        goalId,
        `Reassess reopened Goal after Inbox event ${input.eventId}.`,
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
    resolved.attributes.operatorRequest = null
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

async function supersededCompletionWrites(
  store: GoalPackageStore,
  goalId: string,
  goalPackage: GoalPackage,
  resolvedAt: Date,
) {
  const writes: PublicationWrite[] = []
  for (const attention of goalPackage.attentions.values()) {
    if (attention.attributes.target !== null || attention.attributes.resolvedAt !== null) continue
    const path = store.paths.attentionDocument(goalId, attention.attributes.id)
    const source = await Bun.file(store.paths.absolute(path)).text()
    const resolved = parseAttentionDocument(source)
    resolved.attributes.operatorRequest = null
    resolved.attributes.resolvedAt = resolvedAt.toISOString()
    resolved.body = [
      resolved.body.trimEnd(),
      '',
      '## Resolution',
      '',
      'Superseded by a newly admitted Engineering Work.',
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

async function resolveAsSuperseded(
  store: GoalPackageStore,
  goalId: string,
  attention: AttentionDocument,
  resolvedAt: Date,
) {
  return resolveAttention(
    store,
    goalId,
    attention,
    resolvedAt,
    'Superseded by an instruction requiring fresh Planning.',
  )
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
  next.attributes.operatorRequest = null
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

function dependentClosure(goalPackage: GoalPackage, workId: string) {
  const closure = new Set([workId])
  let changed = true
  while (changed) {
    changed = false
    for (const work of goalPackage.works.values()) {
      if (
        !isWorkTerminal(work.attributes) &&
        work.attributes.dependsOn.some((dependencyId) => closure.has(dependencyId)) &&
        !closure.has(work.attributes.id)
      ) {
        closure.add(work.attributes.id)
        changed = true
      }
    }
  }
  return closure
}

function appendInstruction(body: string, input: { eventId: string; content: string }) {
  return `${body.trimEnd()}\n\n${instructionHeading(input.eventId)}\n\n${input.content.trim()}\n`
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

function instructionHeading(eventId: string) {
  return `## Accepted Inbox Instruction ${eventId}`
}

function boundedAttentionText(value: string) {
  const normalized = value.trim() || 'No failure summary was recorded.'
  return normalized.length <= 4_000 ? normalized : `${normalized.slice(0, 4_000)}\n[truncated]`
}

function nextPlanningWorkId(goalPackage: GoalPackage) {
  const count = [...goalPackage.works.values()].filter((work) =>
    isPlanningWork(work.attributes),
  ).length
  return `plan-${String(count + 1).padStart(4, '0')}`
}
