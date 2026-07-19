import type { AssistantReflection } from '../assistant/assistantReflection'
import type { WorkspaceAssistant } from '../assistant/workspaceAssistant'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import type { WorkRuntimeFacts } from '../domain/workProjection'
import type { AttentionDeliveryWorker } from '../runtime/attentionDelivery'
import type { Responsibility } from '../runtime/roleContextStager'
import type { WorkspaceAttentionController } from '../runtime/workspaceAttentionController'
import type { AssistantWorkspaceStore } from '../storage/assistantWorkspaceStore'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { ProjectReconciler } from './projectReconciler'
import { decideGoalReconciliation } from './reconcileDecision'

export interface CoordinatorProjectRuntime {
  projectId: string
  store: GoalPackageStore
  reconciler: ProjectReconciler
}

export interface CoordinatorReconcilerOptions {
  workspace: AssistantWorkspaceStore
  assistant: WorkspaceAssistant
  reflection?: AssistantReflection
  attentions: WorkspaceAttentionController
  projects: readonly CoordinatorProjectRuntime[]
  concurrency: Readonly<Record<Responsibility, number>>
  delivery?: AttentionDeliveryWorker
  now?: () => Date
  intervalMs?: number
}

export interface CoordinatorReconcileTick {
  kind: 'assistant_started' | 'deterministic_action' | 'passes_started' | 'delivery' | 'idle'
  count?: number
}

export interface CoordinatorReconciler {
  reconcileOnce(): Promise<CoordinatorReconcileTick>
  start(): void
  stop(): Promise<void>
  wake(): void
  waitForIdle(): Promise<void>
  runDirectAssistantCommand<T>(operation: () => Promise<T>): Promise<T>
  setProjectEligible(projectId: string, eligible: boolean): void
  interruptInternalAssistant(): void
  activeRuns(): ReadonlyMap<string, Responsibility>
}

interface ActiveAssistantTurn {
  source: 'user' | 'reflection'
  controller: AbortController
  promise: Promise<void>
}

interface GoalCandidate {
  project: CoordinatorProjectRuntime
  goalId: string
  priority: number
  decision: ReturnType<typeof decideGoalReconciliation>
}

export function createCoordinatorReconciler(
  options: CoordinatorReconcilerOptions,
): CoordinatorReconciler {
  const now = options.now ?? (() => new Date())
  const intervalMs = options.intervalMs ?? 1_000
  const eligibleProjects = new Set(options.projects.map((project) => project.projectId))
  const active = new Map<string, { responsibility: Responsibility; promise: Promise<void> }>()
  const assistantActive = new Map<string, ActiveAssistantTurn>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true
  let reconcileEpoch = 0
  let reconciling: Promise<CoordinatorReconcileTick> | null = null
  let directAssistantCommands = 0

  const coordinator: CoordinatorReconciler = {
    activeRuns() {
      return new Map(
        [...active.entries()].map(([key, value]) => [key, value.responsibility] as const),
      )
    },
    setProjectEligible(projectId, eligible) {
      if (eligible) eligibleProjects.add(projectId)
      else eligibleProjects.delete(projectId)
      this.wake()
    },
    interruptInternalAssistant() {
      for (const entry of assistantActive.values()) {
        if (entry.source === 'reflection') entry.controller.abort()
      }
      this.wake()
    },
    start() {
      if (!stopped) return
      stopped = false
      this.wake()
    },
    async stop() {
      stopped = true
      reconcileEpoch += 1
      if (timer) clearTimeout(timer)
      timer = null
      for (const project of options.projects) project.reconciler.interruptRuns()
      for (const entry of assistantActive.values()) entry.controller.abort()
      await options.reflection?.stop()
      await this.waitForIdle()
    },
    wake() {
      if (stopped || timer) return
      timer = setTimeout(() => {
        timer = null
        void this.reconcileOnce().finally(() => scheduleNext())
      }, 0)
    },
    async waitForIdle() {
      while (reconciling || active.size > 0 || assistantActive.size > 0) {
        await Promise.allSettled([
          ...(reconciling ? [reconciling] : []),
          ...[...active.values()].map((entry) => entry.promise),
          ...[...assistantActive.values()].map((entry) => entry.promise),
        ])
      }
      await options.reflection?.waitForIdle()
    },
    async runDirectAssistantCommand(operation) {
      directAssistantCommands += 1
      try {
        return await operation()
      } finally {
        directAssistantCommands -= 1
        this.wake()
      }
    },
    async reconcileOnce() {
      if (reconciling) return reconciling
      const epoch = reconcileEpoch
      const startedWithActiveResponsibility = active.size > 0
      const run = reconcileTick(epoch)
        .then(async (result) => {
          if (epoch === reconcileEpoch && options.reflection && assistantActive.size === 0) {
            const workspace = await options.workspace.readWorkspace()
            const pendingEvents = eligiblePendingEvents(workspace, assistantActive)
            const publicPending = pendingEvents.some((event) => event.attributes.source === 'user')
            const internalHandoffPending = pendingEvents.some(
              (event) => event.attributes.source === 'reflection',
            )
            if (!publicPending && !internalHandoffPending) {
              await options.reflection.observe({
                settled:
                  result.kind === 'idle' && !startedWithActiveResponsibility && active.size === 0,
              })
            }
          }
          return result
        })
        .finally(() => {
          reconciling = null
        })
      reconciling = run
      return run
    },
  }

  function scheduleNext() {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      void coordinator.reconcileOnce().finally(() => scheduleNext())
    }, intervalMs)
  }

  async function reconcileTick(epoch: number): Promise<CoordinatorReconcileTick> {
    const finalizedNotifications = (await options.assistant.finalizeNotifications?.()) ?? 0
    if (finalizedNotifications > 0) {
      return { kind: 'deterministic_action', count: finalizedNotifications }
    }
    const workspace = await options.workspace.readWorkspace()
    if (epoch !== reconcileEpoch) return { kind: 'idle' }
    const event =
      directAssistantCommands === 0 && assistantActive.size === 0
        ? eligiblePendingEvent(workspace, assistantActive)
        : undefined
    if (event) {
      const controller = new AbortController()
      const promise = options.assistant
        .process(event.attributes.id, controller.signal)
        .then(() => undefined)
        .catch(async (error) => {
          if (controller.signal.aborted) return
          await options.attentions.ensureEventAttention(
            event.attributes.id,
            `Assistant could not safely process this message: ${errorMessage(error)}`,
          )
        })
        .finally(() => {
          assistantActive.delete(event.attributes.id)
          coordinator.wake()
        })
      assistantActive.set(event.attributes.id, {
        source: event.attributes.source,
        controller,
        promise,
      })
      return { kind: 'assistant_started', count: 1 }
    }

    const refreshedWorkspace = await options.workspace.readWorkspace()
    if (epoch !== reconcileEpoch) return { kind: 'idle' }
    const projectBlocks = blockedProjects(refreshedWorkspace)
    const passCounts = activePassCounts(active)
    const candidates: GoalCandidate[] = []
    for (const project of options.projects) {
      if (!eligibleProjects.has(project.projectId) || projectBlocks.has(project.projectId)) continue
      try {
        for (const goalId of await project.store.listGoalIds()) {
          const goalPackage = await project.store.readPackage(goalId)
          const liveWorkIds = new Set(
            [...active.keys()]
              .filter((key) => key.startsWith(`${project.projectId}/${goalId}/`))
              .map((key) => key.slice(`${project.projectId}/${goalId}/`.length)),
          )
          if (goalPackage.goal.attributes.lifecycle !== 'active' && liveWorkIds.size > 0) {
            project.reconciler.interruptRuns(goalId)
          }
          const runtime: WorkRuntimeFacts = {
            projectEligible: true,
            liveRunWorkIds: liveWorkIds,
            operationallyDeferredWorkIds:
              project.reconciler.operationallyDeferredWorkIds?.(goalId, now()) ?? new Set(),
            passCapacity: {
              planner: passCounts.planner < options.concurrency.planner,
              generator: passCounts.generator < options.concurrency.generator,
              reviewer: passCounts.reviewer < options.concurrency.reviewer,
            },
            now: now(),
            maxAttempts: 3,
          }
          candidates.push({
            project,
            goalId,
            priority: goalPackage.goal.attributes.priority,
            decision: decideGoalReconciliation({
              projectId: project.projectId,
              goalId,
              goalPackage,
              runtime,
            }),
          })
        }
      } catch (error) {
        eligibleProjects.delete(project.projectId)
        await options.attentions.ensureProjectAttention(
          project.projectId,
          `Project reconciliation validation failed: ${errorMessage(error)}`,
        )
      }
    }
    candidates.sort(
      (left, right) =>
        right.priority - left.priority ||
        left.project.projectId.localeCompare(right.project.projectId) ||
        left.goalId.localeCompare(right.goalId),
    )

    // stop() may run while the asynchronous candidate scan is in progress.
    if (epoch !== reconcileEpoch) return { kind: 'idle' }

    const deterministic = candidates.find((candidate) =>
      ['ensure_planning', 'ensure_attention', 'complete_goal', 'finish_cancellation'].includes(
        candidate.decision.kind,
      ),
    )
    if (deterministic) {
      try {
        const result = await deterministic.project.reconciler.reconcileGoal(deterministic.goalId, {
          projectEligible: true,
        })
        if (result.kind === 'project_blocked') {
          eligibleProjects.delete(deterministic.project.projectId)
          await options.attentions.ensureProjectAttention(
            deterministic.project.projectId,
            result.reason,
          )
        }
      } catch (error) {
        eligibleProjects.delete(deterministic.project.projectId)
        await options.attentions.ensureProjectAttention(
          deterministic.project.projectId,
          `Coordinator action failed closed: ${errorMessage(error)}`,
        )
      }
      return { kind: 'deterministic_action', count: 1 }
    }

    let started = 0
    const reserved = { ...passCounts }
    for (const candidate of candidates) {
      if (candidate.decision.kind !== 'dispatch') continue
      const responsibility = candidate.decision.responsibility
      const limit = options.concurrency[responsibility]
      if (reserved[responsibility] >= limit) continue
      const key = `${candidate.project.projectId}/${candidate.goalId}/${candidate.decision.workId}`
      if (active.has(key)) continue
      reserved[responsibility] += 1
      const promise = candidate.project.reconciler
        .reconcileGoal(candidate.goalId, {
          projectEligible: true,
          passCapacity: { [responsibility]: true },
        })
        .then(async (result) => {
          if (result.kind === 'project_blocked') {
            eligibleProjects.delete(candidate.project.projectId)
            await options.attentions.ensureProjectAttention(
              candidate.project.projectId,
              result.reason,
            )
          }
        })
        .catch(async (error) => {
          eligibleProjects.delete(candidate.project.projectId)
          await options.attentions.ensureProjectAttention(
            candidate.project.projectId,
            `Coordinator pass failed closed: ${errorMessage(error)}`,
          )
        })
        .finally(() => {
          active.delete(key)
          coordinator.wake()
        })
      active.set(key, { responsibility, promise })
      started += 1
    }
    if (started > 0) return { kind: 'passes_started', count: started }

    if (options.delivery) {
      const delivered = await options.delivery.deliverOnce()
      if (delivered > 0) return { kind: 'delivery', count: delivered }
    }
    return { kind: 'idle' }
  }

  return coordinator
}

function eligiblePendingEvent<T>(workspace: AssistantWorkspace, active: ReadonlyMap<string, T>) {
  return eligiblePendingEvents(workspace, active)[0]
}

function eligiblePendingEvents<T>(workspace: AssistantWorkspace, active: ReadonlyMap<string, T>) {
  const blockedTargets = new Set(
    [...workspace.attentions.values()]
      .filter((attention) => attention.attributes.resolvedAt === null)
      .map((attention) => attention.attributes.target),
  )
  return [...workspace.events.values()]
    .filter((event) => event.attributes.status === 'pending' && !active.has(event.attributes.id))
    .filter((event) => !blockedTargets.has(`home:${workspace.homeId}/event:${event.attributes.id}`))
    .sort(
      (left, right) =>
        inboxSourceRank(left.attributes.source) - inboxSourceRank(right.attributes.source) ||
        left.attributes.receivedAt.localeCompare(right.attributes.receivedAt) ||
        left.attributes.id.localeCompare(right.attributes.id),
    )
}

function inboxSourceRank(source: 'user' | 'reflection') {
  return source === 'user' ? 0 : 1
}

function blockedProjects(workspace: AssistantWorkspace) {
  const blocked = new Set<string>()
  for (const attention of workspace.attentions.values()) {
    if (
      attention.attributes.resolvedAt === null &&
      attention.attributes.target.startsWith('project:')
    ) {
      blocked.add(attention.attributes.target.slice('project:'.length))
    }
  }
  return blocked
}

function activePassCounts(active: ReadonlyMap<string, { responsibility: Responsibility }>) {
  const counts: Record<Responsibility, number> = { planner: 0, generator: 0, reviewer: 0 }
  for (const entry of active.values()) counts[entry.responsibility] += 1
  return counts
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
