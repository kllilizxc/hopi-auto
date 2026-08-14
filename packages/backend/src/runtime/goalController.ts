import { workAttentionTarget } from '../domain/attentionTarget'
import {
  type AttentionDocument,
  type DecisionWorkAttributes,
  type GoalDocument,
  type WorkContextRef,
  type WorkDocument,
  isWorkTerminal,
  parseAttentionDocument,
  renderAttentionDocument,
  renderGoalDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { deriveReadableId } from '../domain/stableId'
import { WorkCancellationError, workCancellationOrder } from '../domain/workCancellation'
import { hashBytes } from '../publication/publisher'
import type { PublicationWrite } from '../publication/types'
import type { CanonicalReference, GoalPackageStore } from '../storage/goalPackageStore'
import { appendProjectOwnerMessage } from './workAssignment'

export interface InputAdmission {
  path: string
  write: PublicationWrite | null
}

export interface CanonicalContext {
  supportingWrites?: PublicationWrite[]
  references?: readonly CanonicalReference[]
}

export type CreateWorkInput =
  | {
      kind: 'decision'
      title: string
      decisionType: DecisionWorkAttributes['decisionType']
      taskMode?: DecisionWorkAttributes['taskMode']
      question: string
      dependsOn: readonly string[]
      acceptedInput?: InputAdmission
      context?: CanonicalContext
    }
  | {
      kind: 'engineering'
      title: string
      objective: string
      acceptanceCriteria: readonly string[]
      dependsOn: readonly string[]
      acceptedInput?: InputAdmission
      context?: CanonicalContext
    }

export interface GoalControllerOptions {
  now?: () => Date
}

export interface GoalController {
  createWork(goalId: string, input: CreateWorkInput): Promise<WorkDocument>
  reviseContract(
    goalId: string,
    input: {
      contractMarkdown: string
      acceptedInput: InputAdmission
      context?: CanonicalContext
    },
  ): Promise<GoalDocument>
  pauseGoal(goalId: string): Promise<GoalDocument>
  resumeGoal(goalId: string): Promise<GoalDocument>
  setPriority(goalId: string, priority: number): Promise<GoalDocument>
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
  createAttention(
    projectId: string,
    goalId: string,
    workId: string,
    input: {
      attentionId?: string
      summary: string
      decisionPrompt?: import('../domain/assistantDecisionPrompt').AssistantDecisionPrompt | null
      body: string
    },
  ): Promise<AttentionDocument>
  cancelWork(goalId: string, workId: string): Promise<readonly WorkDocument[]>
  cancelGoal(goalId: string): Promise<GoalDocument>
  reopenGoal(
    goalId: string,
    input: { eventId: string; contractMarkdown?: string },
  ): Promise<GoalDocument>
}

export class GoalControllerError extends Error {}

export function createGoalController(
  store: GoalPackageStore,
  options: GoalControllerOptions,
): GoalController {
  const now = options.now ?? (() => new Date())

  return {
    async createWork(goalId, input) {
      const goalPackage = await store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Work creation requires an active Goal')
      }
      validateDependencies(goalPackage, '', input.dependsOn)
      const workId = deriveReadableId('W', input.title, [...goalPackage.works.keys()])
      const contextRefs = mergeWorkContextRefs(
        [],
        [
          ...(input.acceptedInput
            ? [{ path: input.acceptedInput.path, purpose: 'Accepted Inbox input' }]
            : []),
          ...(input.context?.references ?? []),
        ],
      )
      const common = {
        id: workId,
        title: input.title.trim(),
        status: 'open' as const,
        createdAt: now().toISOString(),
        notBefore: null,
        dependsOn: [...new Set(input.dependsOn)],
        contractRevision: goalPackage.goal.attributes.contractRevision,
        evidenceRefs: [],
        contextRefs,
        ownerMessages: [],
      }
      const work: WorkDocument =
        input.kind === 'decision'
          ? {
              attributes: {
                ...common,
                kind: 'decision',
                decisionType: input.decisionType,
                ...(input.taskMode ? { taskMode: input.taskMode } : {}),
              },
              body: `## Question\n\n${input.question.trim()}\n`,
            }
          : {
              attributes: {
                ...common,
                kind: 'engineering',
              },
              body: [
                '## Objective',
                '',
                input.objective.trim(),
                '',
                '## Acceptance Criteria',
                '',
                ...input.acceptanceCriteria.map((criterion) => `- ${criterion.trim()}`),
                '',
              ].join('\n'),
            }
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(input.context?.supportingWrites ?? []),
          ...(input.acceptedInput?.write ? [input.acceptedInput.write] : []),
        ],
        gateWrite: {
          path: store.paths.workDocument(goalId, workId),
          expectedHash: null,
          content: renderWorkDocument(work),
        },
      })
      return work
    },
    async reviseContract(goalId, input) {
      const goalPackage = await store.readPackage(goalId)
      if (isTerminalGoal(goalPackage.goal)) {
        throw new GoalControllerError('Terminal Goal must be explicitly reopened')
      }
      const contractMarkdown = normalizeMarkdown(input.contractMarkdown)
      if (goalPackage.goal.body === contractMarkdown && !input.acceptedInput.write) {
        return goalPackage.goal
      }
      const next: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          contractRevision: goalPackage.goal.attributes.contractRevision + 1,
        },
        body: contractMarkdown,
      }
      const path = store.paths.goalDocument(goalId)
      const source = await Bun.file(store.paths.absolute(path)).text()
      await store.publishGoal(goalId, {
        supportingWrites: [
          ...(input.context?.supportingWrites ?? []),
          ...(input.acceptedInput.write ? [input.acceptedInput.write] : []),
        ],
        gateWrite: {
          path,
          expectedHash: await hashBytes(new TextEncoder().encode(source)),
          content: renderGoalDocument(next),
        },
      })
      return next
    },
    async pauseGoal(goalId) {
      const goal = await requireGoal(store, goalId)
      if (goal.attributes.lifecycle === 'paused') return goal
      if (goal.attributes.lifecycle !== 'active') {
        throw new GoalControllerError('Only an active Goal can pause')
      }
      return replaceGoal(store, goalId, {
        ...goal,
        attributes: { ...goal.attributes, lifecycle: 'paused' },
      })
    },
    async resumeGoal(goalId) {
      const goal = await requireGoal(store, goalId)
      if (goal.attributes.lifecycle === 'active') return goal
      if (goal.attributes.lifecycle !== 'paused') {
        throw new GoalControllerError('Only a paused Goal can resume')
      }
      return replaceGoal(store, goalId, {
        ...goal,
        attributes: { ...goal.attributes, lifecycle: 'active' },
      })
    },
    async setPriority(goalId, priority) {
      if (!Number.isInteger(priority))
        throw new GoalControllerError('Goal priority must be an integer')
      const goal = await requireGoal(store, goalId)
      if (goal.attributes.priority === priority) return goal
      return replaceGoal(store, goalId, {
        ...goal,
        attributes: { ...goal.attributes, priority },
      })
    },
    async setWorkNotBefore(goalId, workId, notBefore) {
      if (notBefore !== null && Number.isNaN(Date.parse(notBefore))) {
        throw new GoalControllerError('Work notBefore must be an ISO timestamp or null')
      }
      return updateOpenWork(store, goalId, workId, (work) => ({
        ...work,
        attributes: { ...work.attributes, notBefore },
      }))
    },
    async setWorkDependencies(goalId, workId, dependsOn) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(
          `Cannot change dependencies for missing or terminal Work: ${workId}`,
        )
      }
      const nextDependencies = [...new Set(dependsOn)]
      validateDependencies(goalPackage, workId, nextDependencies)
      if (JSON.stringify(nextDependencies) === JSON.stringify(work.attributes.dependsOn))
        return work
      return publishWork(store, goalId, {
        ...work,
        attributes: { ...work.attributes, dependsOn: nextDependencies },
      })
    },
    async appendWorkMessage(goalId, workId, input) {
      const content = input.content.trim()
      if (!content) throw new GoalControllerError('Work message cannot be empty')
      return updateOpenWork(store, goalId, workId, (work) => ({
        ...work,
        attributes: {
          ...work.attributes,
          ownerMessages: [
            ...appendProjectOwnerMessage(work.attributes.ownerMessages, {
              recordedAt: now().toISOString(),
              sourceEventId: input.sourceEventId,
              content,
            }),
          ],
        },
      }))
    },
    async createAttention(projectId, goalId, workId, input) {
      const goalPackage = await store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new GoalControllerError(`Attention requires open Work: ${workId}`)
      }
      const attentionId = input.attentionId ?? `A-${crypto.randomUUID()}`
      const existing = goalPackage.attentions.get(attentionId)
      if (existing) return existing
      const attention: AttentionDocument = {
        attributes: {
          id: attentionId,
          target: workAttentionTarget(projectId, goalId, workId),
          createdAt: now().toISOString(),
          resolvedAt: null,
          resolutionInput: null,
          summary: input.summary.trim(),
          decisionPrompt: input.decisionPrompt ?? null,
        },
        body: `${input.body.trim()}\n`,
      }
      await store.publishGoal(goalId, {
        supportingWrites: [],
        gateWrite: {
          path: store.paths.attentionDocument(goalId, attentionId),
          expectedHash: null,
          content: renderAttentionDocument(attention),
        },
      })
      return attention
    },
    async cancelWork(goalId, workId) {
      let goalPackage = await store.readPackage(goalId)
      const target = goalPackage.works.get(workId)
      if (!target) throw new GoalControllerError(`Cannot cancel missing Work: ${workId}`)
      if (target.attributes.status === 'done') {
        throw new GoalControllerError(`Cannot cancel completed Work: ${workId}`)
      }
      if (target.attributes.status === 'cancelled') return []
      let order: string[]
      try {
        order = workCancellationOrder(goalPackage, [workId])
      } catch (error) {
        if (error instanceof WorkCancellationError) throw new GoalControllerError(error.message)
        throw error
      }
      const cancelled: WorkDocument[] = []
      for (const candidateId of order) {
        goalPackage = await store.readPackage(goalId)
        const candidate = goalPackage.works.get(candidateId)
        if (!candidate || isWorkTerminal(candidate.attributes)) continue
        const next = await publishWorkCancellation(store, goalId, candidate)
        cancelled.push(next)
      }
      return cancelled
    },
    async cancelGoal(goalId) {
      let goalPackage = await store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle === 'done') {
        throw new GoalControllerError('A completed Goal must be reopened before cancellation')
      }
      if (goalPackage.goal.attributes.lifecycle !== 'cancelled') {
        await replaceGoal(store, goalId, {
          ...goalPackage.goal,
          attributes: { ...goalPackage.goal.attributes, lifecycle: 'cancelled' },
        })
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
      const goalPackage = await store.readPackage(goalId)
      if (!isTerminalGoal(goalPackage.goal)) {
        throw new GoalControllerError('Only a terminal Goal can reopen')
      }
      const next: GoalDocument = {
        ...goalPackage.goal,
        attributes: {
          ...goalPackage.goal.attributes,
          lifecycle: 'active',
          contractRevision: goalPackage.goal.attributes.contractRevision + 1,
        },
        body: input.contractMarkdown
          ? normalizeMarkdown(input.contractMarkdown)
          : goalPackage.goal.body,
      }
      return replaceGoal(store, goalId, next)
    },
  }
}

function validateDependencies(
  goalPackage: GoalPackage,
  workId: string,
  dependsOn: readonly string[],
) {
  for (const dependencyId of dependsOn) {
    if (dependencyId === workId)
      throw new GoalControllerError(`Work cannot depend on itself: ${workId}`)
    const dependency = goalPackage.works.get(dependencyId)
    if (!dependency) throw new GoalControllerError(`Work dependency is missing: ${dependencyId}`)
    if (dependency.attributes.status === 'cancelled') {
      throw new GoalControllerError(`Work cannot depend on cancelled Work: ${dependencyId}`)
    }
  }
}

async function updateOpenWork(
  store: GoalPackageStore,
  goalId: string,
  workId: string,
  update: (work: WorkDocument) => WorkDocument,
) {
  const goalPackage = await store.readPackage(goalId)
  const work = goalPackage.works.get(workId)
  if (!work || isWorkTerminal(work.attributes)) {
    throw new GoalControllerError(`Cannot update missing or terminal Work: ${workId}`)
  }
  return publishWork(store, goalId, update(work))
}

async function publishWork(store: GoalPackageStore, goalId: string, work: WorkDocument) {
  const path = store.paths.workDocument(goalId, work.attributes.id)
  const source = await Bun.file(store.paths.absolute(path)).text()
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderWorkDocument(work),
    },
  })
  return work
}

async function publishWorkCancellation(
  store: GoalPackageStore,
  goalId: string,
  work: WorkDocument,
) {
  const next: WorkDocument = {
    ...work,
    attributes: { ...work.attributes, status: 'cancelled' },
  }
  return publishWork(store, goalId, next)
}

async function requireGoal(store: GoalPackageStore, goalId: string) {
  const goal = await store.readGoal(goalId)
  if (!goal) throw new GoalControllerError(`Goal not found: ${goalId}`)
  return goal
}

async function replaceGoal(store: GoalPackageStore, goalId: string, next: GoalDocument) {
  const path = store.paths.goalDocument(goalId)
  const source = await Bun.file(store.paths.absolute(path)).text()
  await store.publishGoal(goalId, {
    supportingWrites: [],
    gateWrite: {
      path,
      expectedHash: await hashBytes(new TextEncoder().encode(source)),
      content: renderGoalDocument(next),
    },
  })
  return next
}

async function resolveAttention(
  store: GoalPackageStore,
  goalId: string,
  attention: AttentionDocument,
  resolvedAt: Date,
  reason: string,
) {
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

function mergeWorkContextRefs(
  current: readonly WorkContextRef[],
  additions: readonly WorkContextRef[],
) {
  const references = new Map(current.map((reference) => [reference.path, reference]))
  for (const reference of additions) references.set(reference.path, reference)
  return [...references.values()]
}

function isTerminalGoal(goal: GoalDocument) {
  return goal.attributes.lifecycle === 'done' || goal.attributes.lifecycle === 'cancelled'
}

function normalizeMarkdown(value: string) {
  return `${value.trimEnd()}\n`
}
