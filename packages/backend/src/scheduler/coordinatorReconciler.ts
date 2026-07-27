import type { AssistantReflection } from '../assistant/assistantReflection'
import type { WorkspaceAssistant } from '../assistant/workspaceAssistant'
import type { AssistantWorkspace } from '../domain/assistantWorkspace'
import type { InboxEventAttributes } from '../domain/assistantWorkspaceDocuments'
import type { WorkRuntimeFacts } from '../domain/workProjection'
import type { AttentionDeliveryWorker } from '../runtime/attentionDelivery'
import { recordProjectSystemEvent } from '../runtime/projectSystemEvent'
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
}

export interface CoordinatorReconcileTick {
  kind: 'assistant_started' | 'deterministic_action' | 'passes_started' | 'delivery' | 'idle'
  count?: number
  nextWakeAt?: number | null
}

export interface CoordinatorReconciler {
  reconcileOnce(): Promise<CoordinatorReconcileTick>
  start(): void
  stop(): Promise<void>
  wake(): void
  waitForIdle(): Promise<void>
  runDirectAssistantCommand<T>(operation: () => Promise<T>): Promise<T>
  quiesceProject(projectId: string): Promise<void>
  protectAssistantGoal(eventId: string, projectId: string, goalId: string): void
  protectAssistantProject(eventId: string, projectId: string): void
  settleAssistantTurn(eventId: string): Promise<void>
  setProjectEligible(projectId: string, eligible: boolean): void
  interruptInternalAssistant(): void
}

interface ActiveAssistantTurn {
  source: InboxEventAttributes['source']
  controller: AbortController
  promise: Promise<void>
}

interface AssistantTurnBarrier {
  projects: Set<string>
  goals: Set<string>
  activityVersions: Map<string, number>
}

interface GoalCandidate {
  project: CoordinatorProjectRuntime
  goalId: string
  priority: number
  decision: ReturnType<typeof decideGoalReconciliation>
}

interface AssistantRetry {
  failures: number
  retryAt: number
}

const INTERNAL_ASSISTANT_RETRY_BASE_MS = 30_000
const INTERNAL_ASSISTANT_RETRY_MAX_MS = 15 * 60_000

export function createCoordinatorReconciler(
  options: CoordinatorReconcilerOptions,
): CoordinatorReconciler {
  const now = options.now ?? (() => new Date())
  const eligibleProjects = new Set(options.projects.map((project) => project.projectId))
  const reservations = new Map<string, { responsibility: Responsibility; promise: Promise<void> }>()
  const assistantActive = new Map<string, ActiveAssistantTurn>()
  const assistantRetries = new Map<string, AssistantRetry>()
  const assistantTurnBarriers = new Map<string, AssistantTurnBarrier>()
  const projectActivityVersions = new Map<string, number>()
  let wakeTimer: ReturnType<typeof setTimeout> | null = null
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  let deadlineAt: number | null = null
  let wakePending = false
  let stopped = true
  let reconcileEpoch = 0
  let reconciling: Promise<CoordinatorReconcileTick> | null = null
  let directAssistantCommands = 0

  const coordinator: CoordinatorReconciler = {
    setProjectEligible(projectId, eligible) {
      if (eligible) eligibleProjects.add(projectId)
      else eligibleProjects.delete(projectId)
      this.wake()
    },
    interruptInternalAssistant() {
      for (const entry of assistantActive.values()) {
        if (entry.source !== 'user') entry.controller.abort()
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
      wakePending = false
      if (wakeTimer) clearTimeout(wakeTimer)
      if (deadlineTimer) clearTimeout(deadlineTimer)
      wakeTimer = null
      deadlineTimer = null
      deadlineAt = null
      for (const project of options.projects) project.reconciler.interruptRuns()
      for (const entry of assistantActive.values()) entry.controller.abort()
      await options.reflection?.stop()
      await this.waitForIdle()
    },
    wake() {
      if (stopped) return
      wakePending = true
      scheduleWake()
    },
    async waitForIdle() {
      while (true) {
        while (
          reconciling ||
          reservations.size > 0 ||
          assistantActive.size > 0 ||
          wakePending ||
          wakeTimer
        ) {
          const work = [
            ...(reconciling ? [reconciling] : []),
            ...[...reservations.values()].map((entry) => entry.promise),
            ...[...assistantActive.values()].map((entry) => entry.promise),
          ]
          if (work.length > 0) await Promise.allSettled(work)
          else await Bun.sleep(0)
        }
        await options.reflection?.waitForIdle()
        if (
          !reconciling &&
          reservations.size === 0 &&
          assistantActive.size === 0 &&
          !wakePending &&
          !wakeTimer &&
          !options.reflection?.isActive()
        ) {
          return
        }
      }
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
    async quiesceProject(projectId) {
      const project = options.projects.find((candidate) => candidate.projectId === projectId)
      if (!project) throw new Error(`Unknown Project ${projectId}`)
      eligibleProjects.delete(projectId)
      this.wake()
      while (true) {
        project.reconciler.interruptRuns()
        const activeReconciliation = reconciling
        const activeProjectRuns = [...reservations]
          .filter(([key]) => key.startsWith(`${projectId}/`))
          .map(([, entry]) => entry.promise)
        if (!activeReconciliation && activeProjectRuns.length === 0) return
        await Promise.allSettled([
          ...(activeReconciliation ? [activeReconciliation] : []),
          ...activeProjectRuns,
        ])
      }
    },
    protectAssistantGoal(eventId, projectId, goalId) {
      const barrier = assistantTurnBarrier(eventId)
      protectBarrierProject(barrier, projectId)
      barrier.goals.add(goalBarrierKey(projectId, goalId))
    },
    protectAssistantProject(eventId, projectId) {
      const barrier = assistantTurnBarrier(eventId)
      protectBarrierProject(barrier, projectId)
      barrier.projects.add(projectId)
    },
    async settleAssistantTurn(eventId) {
      const barrier = assistantTurnBarriers.get(eventId)
      if (!barrier) return
      const projectIds = new Set([
        ...barrier.projects,
        ...[...barrier.goals].map((key) => key.slice(0, key.indexOf('\u0000'))),
      ])
      // Hold each touched Project only while its post-turn cursor is captured.
      for (const projectId of projectIds) barrier.projects.add(projectId)
      const acknowledgeable = [...projectIds].filter(
        (projectId) =>
          barrier.activityVersions.get(projectId) === projectActivityVersion(projectId) &&
          !projectHasLiveActivity(projectId),
      )
      try {
        await options.reflection?.acknowledgeProjects(acknowledgeable)
      } catch {
        // A missed acknowledgement can only cause a redundant wake; it must not fail the turn.
      } finally {
        assistantTurnBarriers.delete(eventId)
      }
    },
    async reconcileOnce() {
      if (reconciling) return reconciling
      const epoch = reconcileEpoch
      const startedWithReservation = reservations.size > 0
      const run = reconcileTick(epoch)
        .then(async (result) => {
          if (result.kind !== 'assistant_started') armDeadline(result.nextWakeAt ?? null)
          if (epoch === reconcileEpoch && options.reflection && assistantActive.size === 0) {
            const workspace = await options.workspace.readWorkspaceForControl()
            if (
              eligiblePendingEvents(workspace, assistantActive, assistantRetries, now().getTime())
                .length === 0
            ) {
              await options.reflection.observe({
                settled:
                  result.kind === 'idle' && !startedWithReservation && reservations.size === 0,
              })
            }
          }
          if (
            !stopped &&
            epoch === reconcileEpoch &&
            (result.kind === 'assistant_started' ||
              result.kind === 'deterministic_action' ||
              result.kind === 'passes_started' ||
              result.kind === 'delivery')
          ) {
            wakePending = true
          }
          return result
        })
        .finally(() => {
          reconciling = null
          scheduleWake()
        })
      reconciling = run
      return run
    },
  }

  function scheduleWake() {
    if (stopped || !wakePending || wakeTimer || reconciling) return
    wakeTimer = setTimeout(() => {
      wakeTimer = null
      wakePending = false
      void coordinator.reconcileOnce()
    }, 0)
  }

  function armDeadline(nextAt: number | null) {
    if (deadlineAt === nextAt && (nextAt === null || deadlineTimer)) return
    if (deadlineTimer) clearTimeout(deadlineTimer)
    deadlineTimer = null
    deadlineAt = nextAt
    if (stopped || nextAt === null) return
    const delay = Math.max(0, Math.min(nextAt - now().getTime(), 2_147_483_647))
    deadlineTimer = setTimeout(() => {
      deadlineTimer = null
      deadlineAt = null
      coordinator.wake()
    }, delay)
  }

  async function reconcileTick(epoch: number): Promise<CoordinatorReconcileTick> {
    const workspace = await options.workspace.readWorkspaceForControl()
    if (epoch !== reconcileEpoch) return { kind: 'idle' }
    const observedAt = now().getTime()
    const event =
      directAssistantCommands === 0 && assistantActive.size === 0
        ? eligiblePendingEvent(workspace, assistantActive, assistantRetries, observedAt)
        : undefined
    if (event) {
      const controller = new AbortController()
      const context = event.attributes.context
      if (context?.projectId && context.goalId) {
        coordinator.protectAssistantGoal(event.attributes.id, context.projectId, context.goalId)
      }
      const promise = options.assistant
        .process(event.attributes.id, controller.signal)
        .then(() => {
          assistantRetries.delete(event.attributes.id)
        })
        .catch(async (error) => {
          if (controller.signal.aborted) return
          if (event.attributes.source !== 'user') {
            const previous = assistantRetries.get(event.attributes.id)
            const failures = (previous?.failures ?? 0) + 1
            assistantRetries.set(event.attributes.id, {
              failures,
              retryAt:
                now().getTime() +
                Math.min(
                  INTERNAL_ASSISTANT_RETRY_BASE_MS * 2 ** Math.min(failures - 1, 20),
                  INTERNAL_ASSISTANT_RETRY_MAX_MS,
                ),
            })
            return
          }
          await options.workspace.handleEvent(event.attributes.id, {
            reply: `Assistant unavailable: ${errorMessage(error)}`,
            disposition: 'operational-failed',
            handledAt: now(),
            expose: event.attributes.source !== 'user',
          })
        })
        .finally(() => {
          assistantActive.delete(event.attributes.id)
          return coordinator.settleAssistantTurn(event.attributes.id).finally(() => {
            coordinator.wake()
          })
        })
      assistantActive.set(event.attributes.id, {
        source: event.attributes.source,
        controller,
        promise,
      })
      return { kind: 'assistant_started', count: 1 }
    }

    if (epoch !== reconcileEpoch) return { kind: 'idle' }
    const passCounts = reservationPassCounts(reservations)
    const candidates: GoalCandidate[] = []
    let nextWakeAt = nextAssistantRetryAt(workspace, assistantActive, assistantRetries, observedAt)
    for (const project of options.projects) {
      if (!eligibleProjects.has(project.projectId)) continue
      try {
        const reconciliationPackages = project.store.readReconciliationSnapshot
          ? await project.store.readReconciliationSnapshot()
          : await readReconciliationPackages(project.store)
        for (const [goalId, goalPackage] of reconciliationPackages) {
          if (goalPackage.goal.attributes.lifecycle === 'active') {
            for (const work of goalPackage.works.values()) {
              const notBefore = work.attributes.notBefore
              if (!notBefore) continue
              const timestamp = Date.parse(notBefore)
              if (timestamp <= now().getTime()) continue
              nextWakeAt = nextWakeAt === null ? timestamp : Math.min(nextWakeAt, timestamp)
            }
          }
          if (goalDispatchBlocked(project.projectId, goalId)) continue
          const liveWorkIds = new Set(
            [...reservations.keys()]
              .filter((key) => key.startsWith(`${project.projectId}/${goalId}/`))
              .map((key) => key.slice(`${project.projectId}/${goalId}/`.length)),
          )
          if (goalPackage.goal.attributes.lifecycle !== 'active' && liveWorkIds.size > 0) {
            project.reconciler.interruptRuns(goalId)
          }
          const runtime: WorkRuntimeFacts = {
            projectEligible: true,
            liveRunWorkIds: liveWorkIds,
            settledFailureWorkIds:
              (await project.reconciler.settledFailureWorkIds?.(goalId, goalPackage)) ?? new Set(),
            passCapacity: {
              planner: passCounts.planner < options.concurrency.planner,
              generator: passCounts.generator < options.concurrency.generator,
              reviewer: passCounts.reviewer < options.concurrency.reviewer,
            },
            now: now(),
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
        await reportProjectFailure(
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

    const deterministic = candidates.find(
      (candidate) =>
        eligibleProjects.has(candidate.project.projectId) &&
        !goalDispatchBlocked(candidate.project.projectId, candidate.goalId) &&
        ['ensure_planning', 'complete_goal', 'finish_cancellation'].includes(
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
          await reportProjectFailure(deterministic.project.projectId, result.reason)
        }
      } catch (error) {
        eligibleProjects.delete(deterministic.project.projectId)
        await reportProjectFailure(
          deterministic.project.projectId,
          `Coordinator action failed closed: ${errorMessage(error)}`,
        )
      }
      markProjectActivity(deterministic.project.projectId)
      return {
        kind: 'deterministic_action',
        count: 1,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
      }
    }

    let started = 0
    const reserved = { ...passCounts }
    for (const candidate of candidates) {
      if (candidate.decision.kind !== 'dispatch') continue
      if (!eligibleProjects.has(candidate.project.projectId)) continue
      if (goalDispatchBlocked(candidate.project.projectId, candidate.goalId)) continue
      const responsibility = candidate.decision.responsibility
      const limit = options.concurrency[responsibility]
      if (reserved[responsibility] >= limit) continue
      const key = `${candidate.project.projectId}/${candidate.goalId}/${candidate.decision.workId}`
      if (reservations.has(key)) continue
      reserved[responsibility] += 1
      markProjectActivity(candidate.project.projectId)
      const promise = candidate.project.reconciler
        .reconcileGoal(candidate.goalId, {
          projectEligible: true,
          passCapacity: { [responsibility]: true },
        })
        .then(async (result) => {
          if (result.kind === 'project_blocked') {
            eligibleProjects.delete(candidate.project.projectId)
            await reportProjectFailure(candidate.project.projectId, result.reason)
          }
        })
        .catch(async (error) => {
          eligibleProjects.delete(candidate.project.projectId)
          await reportProjectFailure(
            candidate.project.projectId,
            `Coordinator pass failed closed: ${errorMessage(error)}`,
          )
        })
        .finally(() => {
          reservations.delete(key)
          markProjectActivity(candidate.project.projectId)
          coordinator.wake()
        })
      reservations.set(key, { responsibility, promise })
      started += 1
    }
    if (started > 0) {
      return {
        kind: 'passes_started',
        count: started,
        ...(nextWakeAt === null ? {} : { nextWakeAt }),
      }
    }

    if (options.delivery) {
      const delivered = await options.delivery.deliverOnce()
      const deliveryDeadline = options.delivery.nextAttemptAt()
      if (deliveryDeadline !== null) {
        nextWakeAt = nextWakeAt === null ? deliveryDeadline : Math.min(nextWakeAt, deliveryDeadline)
      }
      if (delivered > 0) {
        return {
          kind: 'delivery',
          count: delivered,
          ...(nextWakeAt === null ? {} : { nextWakeAt }),
        }
      }
    }
    return { kind: 'idle', ...(nextWakeAt === null ? {} : { nextWakeAt }) }
  }

  function assistantTurnBarrier(eventId: string) {
    let barrier = assistantTurnBarriers.get(eventId)
    if (!barrier) {
      barrier = { projects: new Set(), goals: new Set(), activityVersions: new Map() }
      assistantTurnBarriers.set(eventId, barrier)
    }
    return barrier
  }

  function protectBarrierProject(barrier: AssistantTurnBarrier, projectId: string) {
    if (!barrier.activityVersions.has(projectId)) {
      barrier.activityVersions.set(projectId, projectActivityVersion(projectId))
    }
  }

  function projectActivityVersion(projectId: string) {
    return projectActivityVersions.get(projectId) ?? 0
  }

  function markProjectActivity(projectId: string) {
    projectActivityVersions.set(projectId, projectActivityVersion(projectId) + 1)
  }

  function projectHasLiveActivity(projectId: string) {
    if ([...reservations.keys()].some((key) => key.startsWith(`${projectId}/`))) return true
    const project = options.projects.find((candidate) => candidate.projectId === projectId)
    return (project?.reconciler.liveWorkIds().size ?? 0) > 0
  }

  async function reportProjectFailure(projectId: string, message: string) {
    await recordProjectSystemEvent(options.workspace, {
      projectId,
      summary: 'Project execution stopped at a deterministic integrity boundary.',
      details: [message],
      receivedAt: now(),
    })
  }

  function goalDispatchBlocked(projectId: string, goalId: string) {
    const key = goalBarrierKey(projectId, goalId)
    for (const barrier of assistantTurnBarriers.values()) {
      if (barrier.projects.has(projectId) || barrier.goals.has(key)) return true
    }
    return false
  }

  return coordinator
}

function goalBarrierKey(projectId: string, goalId: string) {
  return `${projectId}\u0000${goalId}`
}

async function readReconciliationPackages(store: GoalPackageStore) {
  const goalPackages = new Map<string, Awaited<ReturnType<GoalPackageStore['readPackage']>>>()
  for (const goalId of await store.listGoalIds()) {
    goalPackages.set(goalId, await store.readPackage(goalId))
  }
  return goalPackages
}

function eligiblePendingEvent<T>(
  workspace: AssistantWorkspace,
  active: ReadonlyMap<string, T>,
  retries: ReadonlyMap<string, AssistantRetry>,
  observedAt: number,
) {
  return eligiblePendingEvents(workspace, active, retries, observedAt)[0]
}

function eligiblePendingEvents<T>(
  workspace: AssistantWorkspace,
  active: ReadonlyMap<string, T>,
  retries: ReadonlyMap<string, AssistantRetry>,
  observedAt: number,
) {
  return [...workspace.events.values()]
    .filter(
      (event) =>
        event.attributes.status === 'pending' &&
        !active.has(event.attributes.id) &&
        (retries.get(event.attributes.id)?.retryAt ?? Number.NEGATIVE_INFINITY) <= observedAt,
    )
    .sort(
      (left, right) =>
        inboxSourceRank(left.attributes.source) - inboxSourceRank(right.attributes.source) ||
        left.attributes.receivedAt.localeCompare(right.attributes.receivedAt) ||
        left.attributes.id.localeCompare(right.attributes.id),
    )
}

function nextAssistantRetryAt<T>(
  workspace: AssistantWorkspace,
  active: ReadonlyMap<string, T>,
  retries: ReadonlyMap<string, AssistantRetry>,
  observedAt: number,
) {
  let next: number | null = null
  for (const event of workspace.events.values()) {
    if (event.attributes.status !== 'pending' || active.has(event.attributes.id)) continue
    const retryAt = retries.get(event.attributes.id)?.retryAt
    if (retryAt === undefined || retryAt <= observedAt) continue
    next = next === null ? retryAt : Math.min(next, retryAt)
  }
  return next
}

function inboxSourceRank(source: InboxEventAttributes['source']) {
  return source === 'user' ? 0 : 1
}

function reservationPassCounts(
  reservations: ReadonlyMap<string, { responsibility: Responsibility }>,
) {
  const counts: Record<Responsibility, number> = { planner: 0, generator: 0, reviewer: 0 }
  for (const entry of reservations.values()) counts[entry.responsibility] += 1
  return counts
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
