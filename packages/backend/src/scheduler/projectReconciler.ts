import { mkdir } from 'node:fs/promises'
import type { RoleRunResult, RoleRunner } from '../agent/RoleRunner'
import { isExecutionToolName } from '../agent/runtimeEvents'
import { workAttentionTarget } from '../domain/attentionTarget'
import {
  engineeringWorkRepoIds,
  isEngineeringWork,
  isWorkTerminal,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import {
  DEFAULT_PRIMARY_REPO_ID,
  HOPI_RELEASE_BRANCH,
  type LinkedProjectRepo,
  requireProjectRepo,
} from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import type { WorkRuntimeFacts } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
import { type C1Integrator, createC1Integrator } from '../runtime/c1Integrator'
import { createCompletionStructureVerifier } from '../runtime/completionVerifier'
import { type GoalController, createGoalController } from '../runtime/goalController'
import {
  type PassOutcomeApplication,
  type PassOutcomeCoordinator,
  createPassOutcomeCoordinator,
} from '../runtime/passOutcomeCoordinator'
import {
  type ProjectPreparationResult,
  type ProjectPreparer,
  createProjectPreparer,
} from '../runtime/projectPreparation'
import {
  type ResponsibilitySessionStore,
  createResponsibilitySessionStore,
} from '../runtime/responsibilitySessionStore'
import {
  type PreviousGeneratorObservation,
  type RoleContextStager,
  createRoleContextStager,
} from '../runtime/roleContextStager'
import { preserveRunArtifacts } from '../runtime/runArtifacts'
import {
  type RunAttemptRecorder,
  type RunAttemptStore,
  type RunAttemptSummary,
  createRunAttemptStore,
} from '../runtime/runAttemptStore'
import { readSoftwareDeliveryProfile } from '../runtime/softwareDeliveryProfile'
import {
  type StableWorktreeManager,
  StableWorktreeSyncError,
  createStableWorktreeManager,
} from '../runtime/stableWorktreeManager'
import { TaskCheckpointError, checkpointTaskWorktree } from '../runtime/taskCheckpoint'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import { type ReconcileDecision, decideGoalReconciliation } from './reconcileDecision'

export interface ProjectReconcilerOptions {
  homeRoot: string
  projectId: string
  projectRoot: string
  primaryRepoId?: string
  projectRepos?: readonly LinkedProjectRepo[]
  store: GoalPackageStore
  publisher: PublicationCoordinator
  roleRunner: RoleRunner
  contextStager?: RoleContextStager
  worktrees?: StableWorktreeManager
  outcomes?: PassOutcomeCoordinator
  attempts?: RunAttemptStore
  responsibilitySessions?: ResponsibilitySessionStore
  integrator?: C1Integrator
  goalController?: GoalController
  now?: () => Date
  createRunId?: () => string
  checkpointTask?: typeof checkpointTaskWorktree
  preparer?: ProjectPreparer
  preparationTimeoutMs?: number
  operationalRetryBaseMs?: number
  maxOperationalFailures?: number
  apiOrigin?: () => string
  onProjectBlocked?(input: {
    projectId: string
    reason: string
    commit?: string
  }): Promise<void> | void
  onReleaseUpdated?(input: { projectId: string; commit: string }): Promise<void> | void
}

export type ProjectReconcileResult =
  | { kind: 'wait'; decision: ReconcileDecision }
  | { kind: 'planning_ensured'; workId: string }
  | { kind: 'attention_ensured'; attentionId: string }
  | { kind: 'goal_completed'; attentionId: string }
  | { kind: 'cancellation_finished' }
  | {
      kind: 'pass_finished'
      workId: string
      runId: string
      result: string
      application: string
    }
  | { kind: 'project_blocked'; reason: string; commit?: string }

export interface ProjectReconciler {
  reconcileGoal(
    goalId: string,
    runtime?: Partial<WorkRuntimeFacts>,
  ): Promise<ProjectReconcileResult>
  liveWorkIds(): ReadonlySet<string>
  operationallyDeferredWorkIds?(goalId: string, observedAt?: Date): ReadonlySet<string>
  interruptRuns(goalId?: string, workId?: string): void
}

export function createProjectReconciler(options: ProjectReconcilerOptions): ProjectReconciler {
  const now = options.now ?? (() => new Date())
  const createRunId = options.createRunId ?? (() => `R-${crypto.randomUUID()}`)
  const checkpointTask = options.checkpointTask ?? checkpointTaskWorktree
  const preparer = options.preparer ?? createProjectPreparer()
  const contextStager =
    options.contextStager ?? createRoleContextStager(options.homeRoot, options.publisher)
  const worktrees = options.worktrees ?? createStableWorktreeManager(options.homeRoot)
  const attempts = options.attempts ?? createRunAttemptStore(options.homeRoot, { now })
  const responsibilitySessions =
    options.responsibilitySessions ?? createResponsibilitySessionStore(options.homeRoot)
  const primaryRepoId = options.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
  const projectRepos: readonly LinkedProjectRepo[] = options.projectRepos ?? [
    {
      repoId: primaryRepoId,
      repoPath: options.projectRoot,
      projectPath: '.',
      deliveryBranch: HOPI_RELEASE_BRANCH,
      integrationRoot: options.projectRoot,
      primary: true,
    },
  ]
  const primaryProjectRepo = requireProjectRepo({ repos: projectRepos }, primaryRepoId)
  const c1Layout = {
    primaryRepoId,
    repos: projectRepos.map((repo) => ({
      repoId: repo.repoId,
      integrationRoot: repo.integrationRoot,
      checkoutRoot: repo.repoPath,
      deliveryBranch: repo.deliveryBranch,
      projectPath: repo.projectPath,
      primary: repo.primary,
    })),
  }
  const outcomes =
    options.outcomes ??
    createPassOutcomeCoordinator(options.store, options.publisher, {
      now,
      primaryRepoId,
      projectRepoIds: projectRepos.map((repo) => repo.repoId),
    })
  const integrator =
    options.integrator ??
    createC1Integrator(options.homeRoot, options.store, options.publisher, now, c1Layout)
  const completion = createCompletionStructureVerifier(options.store, c1Layout)
  const goalController =
    options.goalController ??
    createGoalController(options.store, {
      now,
      verifyCompletion: (goalId, goalPackage) => completion.verify(goalId, goalPackage),
    })
  const live = new Set<string>()
  const runControllers = new Map<string, AbortController>()
  let projectInterruptionGeneration = 0
  const goalInterruptionGenerations = new Map<string, number>()
  let workInterruptionSequence = 0
  const workInterruptionGenerations = new Map<string, number>()
  const operationalRetries = new Map<string, { failures: number; retryAt: number }>()
  const operationalRetryBaseMs = options.operationalRetryBaseMs ?? 30_000
  const maxOperationalFailures = options.maxOperationalFailures ?? 3
  const deferredWorkIds = (goalId: string, observedAt = now()) => {
    const prefix = `${goalId}/`
    return new Set(
      [...operationalRetries.entries()].flatMap(([key, retry]) =>
        key.startsWith(prefix) && retry.retryAt > observedAt.getTime()
          ? [key.slice(prefix.length)]
          : [],
      ),
    )
  }

  return {
    interruptRuns(goalId, workId) {
      if (workId) {
        if (!goalId) throw new Error('A Work interruption requires its Goal ID')
        const liveKey = `${goalId}/${workId}`
        workInterruptionSequence += 1
        workInterruptionGenerations.set(liveKey, workInterruptionSequence)
        runControllers.get(liveKey)?.abort()
        return
      }
      const goalPrefix = goalId ? `${goalId}/` : null
      if (goalId) {
        goalInterruptionGenerations.set(goalId, (goalInterruptionGenerations.get(goalId) ?? 0) + 1)
      } else {
        projectInterruptionGeneration += 1
      }
      for (const [key, controller] of runControllers) {
        if (!goalPrefix || key.startsWith(goalPrefix)) controller.abort()
      }
    },
    liveWorkIds() {
      return new Set(live)
    },
    operationallyDeferredWorkIds(goalId, observedAt = now()) {
      return deferredWorkIds(goalId, observedAt)
    },
    async reconcileGoal(goalId, runtime = {}) {
      const interruptionGeneration = {
        project: projectInterruptionGeneration,
        goal: goalInterruptionGenerations.get(goalId) ?? 0,
        work: workInterruptionSequence,
      }
      await readSoftwareDeliveryProfile()
      const goalPackage = await options.store.readPackage(goalId)
      const attemptSnapshot = await attempts.snapshot()
      for (const work of goalPackage.works.values()) {
        if (isWorkTerminal(work.attributes)) continue
        const episode = operationalFailureEpisode(
          attemptSnapshot.list(options.projectId, goalId, work.attributes.id),
          latestResolvedWorkAttentionAt(goalPackage, options.projectId, goalId, work.attributes.id),
        )
        if (episode.count < maxOperationalFailures) continue
        if (hasOpenWorkAttention(goalPackage, options.projectId, goalId, work.attributes.id)) {
          operationalRetries.delete(`${goalId}/${work.attributes.id}`)
          continue
        }
        const attention = await goalController.ensureOperationalFailureAttention(
          goalId,
          work.attributes.id,
          episode.count,
          episode.latestSummary,
        )
        operationalRetries.delete(`${goalId}/${work.attributes.id}`)
        return { kind: 'attention_ensured', attentionId: attention.attributes.id }
      }
      const livePrefix = `${goalId}/`
      const localLiveWorkIds = [...live]
        .filter((key) => key.startsWith(livePrefix))
        .map((key) => key.slice(livePrefix.length))
      const facts: WorkRuntimeFacts = {
        projectEligible: runtime.projectEligible ?? true,
        liveRunWorkIds: new Set([...localLiveWorkIds, ...(runtime.liveRunWorkIds ?? [])]),
        operationallyDeferredWorkIds:
          runtime.operationallyDeferredWorkIds ?? deferredWorkIds(goalId),
        passCapacity: {
          planner: runtime.passCapacity?.planner ?? true,
          generator: runtime.passCapacity?.generator ?? true,
          reviewer: runtime.passCapacity?.reviewer ?? true,
        },
        now: runtime.now ?? now(),
        maxAttempts: 3,
      }
      const decision = decideGoalReconciliation({
        projectId: options.projectId,
        goalId,
        goalPackage,
        runtime: facts,
        completionStructureValid: true,
      })

      if (decision.kind === 'wait') return { kind: 'wait', decision }
      if (decision.kind === 'ensure_planning') {
        const work = await goalController.ensurePlanning(
          goalId,
          'Perform the final semantic assessment or refresh the delivery plan.',
        )
        return { kind: 'planning_ensured', workId: work.attributes.id }
      }
      if (decision.kind === 'ensure_attention') {
        const attention = await goalController.ensureAttemptsAttention(goalId, decision.workId)
        return { kind: 'attention_ensured', attentionId: attention.attributes.id }
      }
      if (decision.kind === 'complete_goal') {
        await goalController.completeGoal(goalId, decision.attentionId)
        return { kind: 'goal_completed', attentionId: decision.attentionId }
      }
      if (decision.kind === 'finish_cancellation') {
        await goalController.cancelGoal(goalId)
        return { kind: 'cancellation_finished' }
      }

      const { workId, responsibility } = decision
      const liveKey = `${goalId}/${workId}`
      if (live.has(liveKey)) return { kind: 'wait', decision }
      live.add(liveKey)
      const runController = new AbortController()
      runControllers.set(liveKey, runController)
      const runId = createRunId()
      let attempt: RunAttemptRecorder | null = null
      try {
        if (
          interruptionGeneration.project !== projectInterruptionGeneration ||
          interruptionGeneration.goal !== (goalInterruptionGenerations.get(goalId) ?? 0) ||
          (workInterruptionGenerations.get(liveKey) ?? 0) > interruptionGeneration.work
        ) {
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        const owningWork = goalPackage.works.get(workId)
        if (!owningWork) throw new Error(`Work is missing: ${workId}`)
        const selectedRepos =
          responsibility === 'planner'
            ? projectRepos
            : isEngineeringWork(owningWork.attributes)
              ? engineeringWorkRepoIds(owningWork.attributes, primaryRepoId).map((repoId) =>
                  requireProjectRepo({ repos: projectRepos }, repoId),
                )
              : []
        if (responsibility !== 'planner' && selectedRepos.length === 0) {
          throw new Error(`Engineering Work ${workId} has no Repo workspace`)
        }
        let worktreeEntries: Array<{
          repo: LinkedProjectRepo
          worktree: Awaited<ReturnType<StableWorktreeManager['prepare']>>
        }> = []
        try {
          worktreeEntries =
            responsibility === 'planner'
              ? []
              : await Promise.all(
                  selectedRepos.map(async (repo) => {
                    const worktreeInput = {
                      projectRoot: repo.integrationRoot,
                      projectId: options.projectId,
                      goalId,
                      workId,
                      repoId: repo.repoId,
                      primaryRepoId,
                    }
                    return {
                      repo,
                      worktree:
                        responsibility === 'reviewer'
                          ? await worktrees.prepareClean(worktreeInput)
                          : await worktrees.prepare(worktreeInput),
                    }
                  }),
                )
        } catch (error) {
          if (!(error instanceof StableWorktreeSyncError)) throw error
          const attention = await goalController.ensureSynchronizationAttention(
            goalId,
            workId,
            error.message,
          )
          return { kind: 'attention_ensured', attentionId: attention.attributes.id }
        }
        const scopedWorktrees = await Promise.all(
          worktreeEntries.map(async (entry) => ({
            ...entry,
            projectRoot: await ensureProjectScope(entry.worktree.path, entry.repo.projectPath),
          })),
        )
        const roleRepoRoots = await Promise.all(
          responsibility === 'planner'
            ? selectedRepos.map(async (repo) => ({
                repoId: repo.repoId,
                path: await ensureProjectScope(repo.integrationRoot, repo.projectPath),
                primary: repo.primary,
              }))
            : scopedWorktrees.map(async ({ repo, projectRoot }) => ({
                repoId: repo.repoId,
                path: projectRoot,
                primary: repo.primary,
              })),
        )
        const sessionKey = {
          projectId: options.projectId,
          goalId,
          workId,
          responsibility,
        }
        const responsibilitySession = await responsibilitySessions.open(
          sessionKey,
          owningWork.attributes.contractRevision,
        )
        const context = await contextStager.prepare({
          projectRoot: options.projectRoot,
          projectPath: primaryProjectRepo.projectPath,
          projectId: options.projectId,
          goalId,
          workId,
          runId,
          responsibility,
          primaryRepoId,
          repoRoots: roleRepoRoots,
          apiOrigin: options.apiOrigin?.(),
          runtimeScratchDir: responsibilitySession.workspaceDir,
          previousGenerator:
            responsibility === 'generator'
              ? await readPreviousGeneratorObservation(attempts, options.projectId, goalId, workId)
              : null,
        })
        attempt = await attempts
          .start({
            projectId: options.projectId,
            goalId,
            workId,
            runId,
            responsibility,
            runRoot: context.runRoot,
          })
          .catch(() => null)
        if (scopedWorktrees.length > 0) {
          const preparationProjectRoot = scopedWorktrees[0]?.projectRoot
          if (!preparationProjectRoot) {
            throw new Error(`Engineering Work ${workId} has no Repo preparation root`)
          }
          const preparation = await preparer.prepare({
            projectRoot: preparationProjectRoot,
            runtimeDir: `${context.runtimeScratchDir}/project-prepare`,
            cacheDir: context.runtimeCacheDir,
            timeoutMs: options.preparationTimeoutMs,
            goalId,
            primaryRepoId,
            repoRoots: scopedWorktrees.map(({ repo, projectRoot }) => ({
              repoId: repo.repoId,
              path: projectRoot,
            })),
          })
          await attempt?.record(preparationEvent(responsibility, preparation))
          if (preparation.kind !== 'ready') {
            if (preparation.repos.some((repo) => repo.kind === 'source_changed')) {
              await Promise.all(
                worktreeEntries.map(({ repo }) =>
                  worktrees.prepareClean({
                    projectRoot: repo.integrationRoot,
                    projectId: options.projectId,
                    goalId,
                    workId,
                    repoId: repo.repoId,
                    primaryRepoId,
                  }),
                ),
              )
            }
            if (responsibility === 'reviewer') {
              await goalController.returnEngineeringWorkToGenerate(goalId, workId)
              const outcome = await candidatePreparationFailureOutcome({
                preparation,
                runId,
                context,
                roleRepoRoots,
              })
              await attempt?.finish({ outcome, application: 'candidate_preparation_failed' })
              return {
                kind: 'pass_finished',
                workId,
                runId,
                result: outcome.result,
                application: 'candidate_preparation_failed',
              }
            }
            await appendPreparationDiagnostic(context.promptFile, preparation)
          }
        }
        if (runController.signal.aborted) {
          await attempt?.interrupt(new Error(`${responsibility} Run was interrupted`))
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        let outcome = await options.roleRunner.run(
          {
            projectId: options.projectId,
            goalId,
            workId,
            runId,
            responsibility,
            cwd:
              responsibility === 'generator'
                ? (scopedWorktrees.find(({ repo }) => repo.primary)?.projectRoot ??
                  scopedWorktrees[0]?.projectRoot ??
                  context.runRoot)
                : context.runRoot,
            sourceRoots: worktreeEntries.map(({ worktree }) => worktree.path),
            context,
            session: responsibilitySession.session,
            signal: runController.signal,
          },
          {
            onEvent: (event) => attempt?.record(event),
            onExecution: (execution) => attempt?.setExecution(execution).catch(() => undefined),
            onSession: (nextSession) =>
              responsibilitySessions.write(
                sessionKey,
                owningWork.attributes.contractRevision,
                nextSession,
              ),
            onSessionInvalid: () =>
              responsibilitySessions.invalidateVendor(
                sessionKey,
                owningWork.attributes.contractRevision,
              ),
          },
        )
        if (runController.signal.aborted) {
          let checkpointFailure: unknown = null
          if (responsibility === 'generator' && worktreeEntries.length > 0) {
            try {
              await Promise.all(
                worktreeEntries.map(({ repo, worktree }) =>
                  checkpointTask({
                    worktreePath: worktree.path,
                    projectId: options.projectId,
                    goalId,
                    workId,
                    runId,
                    repoId: repo.repoId,
                  }),
                ),
              )
              await attempt?.record({
                kind: 'message',
                level: 'info',
                role: 'coordinator',
                content: 'Checkpointed safe partial Generator source before interruption.',
              })
            } catch (error) {
              checkpointFailure = error
              await attempt?.record({
                kind: 'message',
                level: 'error',
                role: 'coordinator',
                content: `Partial Generator checkpoint failed during interruption: ${errorMessage(error)}`,
              })
            }
          }
          await attempt?.interrupt(
            new Error(
              checkpointFailure
                ? `${responsibility} Run was interrupted; partial source checkpoint failed: ${errorMessage(checkpointFailure)}`
                : `${responsibility} Run was interrupted`,
            ),
          )
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        if (responsibility === 'generator' && worktreeEntries.length > 0) {
          try {
            await Promise.all(
              worktreeEntries.map(({ repo, worktree }) =>
                checkpointTask({
                  worktreePath: worktree.path,
                  projectId: options.projectId,
                  goalId,
                  workId,
                  runId,
                  repoId: repo.repoId,
                }),
              ),
            )
          } catch (error) {
            const summary = `Task checkpoint failed: ${errorMessage(error)}`
            if (!(error instanceof TaskCheckpointError) || error.code === 'infrastructure') {
              await options.onProjectBlocked?.({
                projectId: options.projectId,
                reason: summary,
              })
              await attempt?.finish({
                outcome: {
                  result: 'fail',
                  summary,
                  exitCode: outcome.exitCode,
                },
                application: 'project_blocked',
              })
              return {
                kind: 'project_blocked',
                reason: summary,
              }
            }
            outcome = {
              result: 'fail',
              summary,
              artifacts: [],
              exitCode: outcome.exitCode,
            }
          }
        }

        try {
          outcome = await preserveOutcomeArtifacts(
            outcome,
            runId,
            context.runRoot,
            context.resultFile,
            [context.runtimeScratchDir, ...roleRepoRoots.map((repo) => repo.path)],
          )
        } catch (error) {
          outcome = artifactFailureOutcome(error, outcome.exitCode)
        }

        if (outcome.failureKind === 'operational') {
          await attempt?.finish({ outcome, application: 'operational_failure' })
          const currentGoalPackage = await options.store.readPackage(goalId)
          const currentAttemptSnapshot = await attempts.snapshot()
          const persistedEpisode = operationalFailureEpisode(
            currentAttemptSnapshot.list(options.projectId, goalId, workId),
            latestResolvedWorkAttentionAt(currentGoalPackage, options.projectId, goalId, workId),
          )
          const failureCount = Math.max(
            persistedEpisode.count,
            (operationalRetries.get(liveKey)?.failures ?? 0) + 1,
          )
          if (failureCount >= maxOperationalFailures) {
            operationalRetries.delete(liveKey)
            const attention = await goalController.ensureOperationalFailureAttention(
              goalId,
              workId,
              failureCount,
              persistedEpisode.latestSummary || outcome.summary,
            )
            return { kind: 'attention_ensured', attentionId: attention.attributes.id }
          }
          scheduleOperationalRetry(
            operationalRetries,
            liveKey,
            now(),
            operationalRetryBaseMs,
            failureCount,
          )
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: outcome.result,
            application: 'operational_failure',
          }
        }
        operationalRetries.delete(liveKey)

        const pass = { goalId, workId, runId, responsibility, context, outcome }
        const application = await outcomes.apply(pass)
        if (application.kind !== 'integration_required') {
          await finishAttempt(attempt, options.store, goalId, outcome, application)
          if (application.kind === 'stale') {
            await goalController.ensurePlanning(
              goalId,
              `Reassess stale ${responsibility} output for Work ${workId}.`,
            )
          } else if (application.kind === 'published' && application.result === 'fail') {
            await goalController.ensureResponsibilityFailureAttention(
              goalId,
              workId,
              responsibility,
              application.summary,
            )
          }
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: application.kind === 'published' ? application.result : outcome.result,
            application: application.kind,
          }
        }
        if (worktreeEntries.length === 0) {
          throw new Error('Reviewer integration has no task worktree')
        }
        const firstWorktree = worktreeEntries[0]
        if (!firstWorktree) throw new Error('Reviewer integration has no task worktree')
        const integration = await integrator.integrate({
          pass,
          taskWorktreePath: firstWorktree.worktree.path,
          taskWorktrees: Object.fromEntries(
            worktreeEntries.map(({ repo, worktree }) => [repo.repoId, worktree.path]),
          ),
          evidence: application.evidence,
          completedWork: application.work,
        })
        if (integration.kind === 'integrated' || integration.kind === 'already_integrated') {
          const recordedOutcome =
            integration.deliveryIssues.length > 0
              ? {
                  ...outcome,
                  summary: [
                    outcome.summary,
                    `Delivery pending: ${integration.deliveryIssues.map((issue) => issue.reason).join('; ')}`,
                  ].join('\n\n'),
                }
              : outcome
          await attempt?.finish({ outcome: recordedOutcome, application: integration.kind })
          try {
            await options.onReleaseUpdated?.({
              projectId: options.projectId,
              commit: integration.commit,
            })
          } catch {
            // Disposable Preview cleanup cannot change an already durable C1 outcome.
          }
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: 'success',
            application: integration.kind,
          }
        }
        if (integration.kind === 'rejected') {
          const rejectedOutcome = {
            result: 'reject' as const,
            summary: `Deterministic integration rejected the reviewed result: ${integration.reason}`,
            artifacts: [],
            exitCode: outcome.exitCode,
          }
          const rejected = await outcomes.apply({
            ...pass,
            outcome: rejectedOutcome,
          })
          await finishAttempt(attempt, options.store, goalId, rejectedOutcome, rejected)
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: 'reject',
            application: rejected.kind,
          }
        }

        if (integration.kind === 'blocked') {
          await options.onProjectBlocked?.({
            projectId: options.projectId,
            reason: integration.reason,
          })
          await attempt?.finish({
            outcome: {
              result: 'fail',
              summary: integration.reason,
              exitCode: outcome.exitCode,
            },
            application: 'project_blocked',
          })
          return {
            kind: 'project_blocked',
            reason: integration.reason,
          }
        }

        try {
          await options.onReleaseUpdated?.({
            projectId: options.projectId,
            commit: integration.commit,
          })
        } catch {
          // Disposable Preview cleanup cannot change an already durable C1 outcome.
        }
        await options.onProjectBlocked?.({
          projectId: options.projectId,
          reason: integration.reason,
          commit: integration.commit,
        })
        await attempt?.finish({
          outcome: {
            result: 'fail',
            summary: integration.reason,
            exitCode: outcome.exitCode,
          },
          application: 'project_blocked',
        })
        return {
          kind: 'project_blocked',
          reason: integration.reason,
          commit: integration.commit,
        }
      } catch (error) {
        await attempt?.interrupt(error)
        if (runController.signal.aborted) {
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        throw error
      } finally {
        await clearTerminalWorkSessions(
          responsibilitySessions,
          options.store,
          options.projectId,
          goalId,
          workId,
        ).catch(() => undefined)
        live.delete(liveKey)
        runControllers.delete(liveKey)
      }
    },
  }
}

async function clearTerminalWorkSessions(
  sessions: ResponsibilitySessionStore,
  store: GoalPackageStore,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const work = (await store.readPackage(goalId)).works.get(workId)
  if (!work || !isWorkTerminal(work.attributes)) return
  await sessions.clearWork({ projectId, goalId, workId })
}

async function preserveOutcomeArtifacts(
  outcome: RoleRunResult,
  runId: string,
  runRoot: string,
  resultFile: string,
  sourceRoots: readonly string[],
): Promise<RoleRunResult> {
  const preserved = await preserveRunArtifacts({
    runId,
    runRoot,
    artifacts: outcome.artifacts,
    sourceRoots,
    resultFile,
  })
  return { ...outcome, artifacts: preserved.references }
}

function artifactFailureOutcome(error: unknown, exitCode: number | null): RoleRunResult {
  return {
    result: 'fail',
    summary: `Run artifact preservation failed: ${errorMessage(error)}`,
    artifacts: [],
    exitCode,
    failureKind: 'operational',
  }
}

async function ensureProjectScope(repoRoot: string, projectPath: string) {
  const projectRoot = resolveProjectPath(repoRoot, projectPath)
  await mkdir(projectRoot, { recursive: true })
  return projectRoot
}

function preparationEvent(responsibility: string, preparation: ProjectPreparationResult) {
  const failedRepoIds = preparation.repos
    .filter((repo) => repo.kind !== 'ready')
    .map((repo) => repo.repoId)
  return {
    kind: 'message' as const,
    level: preparation.kind === 'ready' ? ('info' as const) : ('error' as const),
    role: 'coordinator',
    content:
      preparation.kind === 'ready'
        ? `Repo preparation completed before ${responsibility}: ${preparation.repos.map((repo) => repo.repoId).join(', ')}.`
        : `Repo preparation failed before ${responsibility} for ${failedRepoIds.join(', ')}: ${boundedPreparationLogs(preparation.logs)}`,
  }
}

function preparationFailureSummary(preparation: ProjectPreparationResult) {
  return `Candidate Repo preparation is not ready; Generator retains the Work. ${boundedPreparationLogs(preparation.logs)}`
}

async function candidatePreparationFailureOutcome(input: {
  preparation: ProjectPreparationResult
  runId: string
  context: {
    runRoot: string
    resultFile: string
    runtimeScratchDir: string
  }
  roleRepoRoots: readonly { path: string }[]
}): Promise<RoleRunResult> {
  const outcome: RoleRunResult = {
    result: 'fail',
    summary: preparationFailureSummary(input.preparation),
    artifacts: [input.preparation.logPath],
    exitCode: input.preparation.exitCode,
  }
  try {
    return await preserveOutcomeArtifacts(
      outcome,
      input.runId,
      input.context.runRoot,
      input.context.resultFile,
      [input.context.runtimeScratchDir, ...input.roleRepoRoots.map((repo) => repo.path)],
    )
  } catch (error) {
    return {
      ...outcome,
      summary: `${outcome.summary} Preparation log preservation failed: ${errorMessage(error)}`,
      artifacts: [],
    }
  }
}

async function appendPreparationDiagnostic(
  promptFile: string,
  preparation: ProjectPreparationResult,
) {
  const prompt = await Bun.file(promptFile).text()
  await Bun.write(
    promptFile,
    [
      prompt.trimEnd(),
      '',
      '## Repo Preparation Diagnostic',
      '',
      `Status: ${preparation.kind}`,
      `Repos: ${preparation.repos.map((repo) => `${repo.repoId}=${repo.kind}`).join(', ')}`,
      `Combined log: ${preparation.logPath}`,
      '',
      boundedPreparationLogs(preparation.logs),
      '',
      'Repair or create scripts/hopi/prepare in each failing Repo candidate owned by this Work. Each entrypoint must be executable, idempotent, prepare only its own checkout, and leave every Repo source unchanged.',
      '',
    ].join('\n'),
  )
}

async function readPreviousGeneratorObservation(
  attempts: RunAttemptStore,
  projectId: string,
  goalId: string,
  workId: string,
): Promise<PreviousGeneratorObservation | null> {
  const previous = (await attempts.list(projectId, goalId, workId)).find(
    (attempt) => attempt.responsibility === 'generator' && attempt.status === 'finished',
  )
  if (!previous) return null
  const events = await attempts.readEvents(projectId, goalId, workId, previous.runId)
  const commands: Array<{
    key: string
    command: string
    outcome: 'completed' | 'failed' | 'unfinished'
  }> = []
  const byInvocation = new Map<string, (typeof commands)[number]>()
  let anonymousSequence = 0
  for (const event of events ?? []) {
    if (event.kind !== 'transcript') continue
    if (event.entryKind === 'tool_call' && isExecutionToolName(event.toolName)) {
      anonymousSequence += 1
      const key = event.toolInvocationKey ?? `anonymous-${anonymousSequence}`
      const command = {
        key,
        command: boundedPromptDiagnostic(event.summary),
        outcome: 'unfinished' as const,
      }
      commands.push(command)
      if (event.toolInvocationKey) byInvocation.set(event.toolInvocationKey, command)
      continue
    }
    if (
      (event.entryKind === 'tool_result' || event.entryKind === 'error') &&
      event.toolInvocationKey
    ) {
      const command = byInvocation.get(event.toolInvocationKey)
      if (!command) continue
      command.outcome = event.entryKind === 'error' ? 'failed' : 'completed'
      byInvocation.delete(event.toolInvocationKey)
    }
  }
  return {
    runId: previous.runId,
    summary: previous.summary ? boundedPromptDiagnostic(previous.summary, 800) : null,
    commands: commands.slice(-8).map(({ command, outcome }) => ({ command, outcome })),
  }
}

function boundedPromptDiagnostic(value: string, limit = 320) {
  const compact = value.replaceAll(/\s+/g, ' ').trim()
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`
}

function scheduleOperationalRetry(
  retries: Map<string, { failures: number; retryAt: number }>,
  key: string,
  observedAt: Date,
  baseMs: number,
  failures: number,
) {
  const delay = Math.min(baseMs * 2 ** Math.min(failures - 1, 5), 15 * 60_000)
  retries.set(key, { failures, retryAt: observedAt.getTime() + delay })
}

function operationalFailureEpisode(attempts: readonly RunAttemptSummary[], after: string | null) {
  let count = 0
  let latestSummary = ''
  for (const attempt of attempts) {
    if (after && attempt.startedAt < after) break
    if (attempt.status !== 'finished') continue
    if (attempt.application !== 'operational_failure') break
    if (count === 0) latestSummary = attempt.summary ?? ''
    count += 1
  }
  return { count, latestSummary }
}

function latestResolvedWorkAttentionAt(
  goalPackage: GoalPackage,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const target = workAttentionTarget(projectId, goalId, workId)
  let latest: string | null = null
  for (const attention of goalPackage.attentions.values()) {
    if (attention.attributes.target !== target || attention.attributes.resolvedAt === null) continue
    if (latest === null || attention.attributes.resolvedAt > latest) {
      latest = attention.attributes.resolvedAt
    }
  }
  return latest
}

function hasOpenWorkAttention(
  goalPackage: GoalPackage,
  projectId: string,
  goalId: string,
  workId: string,
) {
  const target = workAttentionTarget(projectId, goalId, workId)
  return [...goalPackage.attentions.values()].some(
    (attention) =>
      attention.attributes.target === target && attention.attributes.resolvedAt === null,
  )
}

function boundedPreparationLogs(logs: string) {
  return logs.length <= 4_000 ? logs : `${logs.slice(0, 4_000)}\n[prepare log truncated]`
}

async function finishAttempt(
  recorder: RunAttemptRecorder | null,
  store: GoalPackageStore,
  goalId: string,
  outcome: RoleRunResult,
  application: PassOutcomeApplication,
) {
  if (!recorder) return
  const evidenceId = 'evidenceId' in application ? application.evidenceId : null
  let appliedResult = application.kind === 'published' ? application.result : outcome.result
  let appliedSummary = outcome.summary
  if (evidenceId) {
    const evidence = (await store.readPackage(goalId)).evidence.get(evidenceId)
    appliedSummary = evidence ? evidenceSummary(evidence.body) : appliedSummary
  }
  if (application.kind === 'stale') {
    appliedSummary = `${appliedSummary} Stale result: ${application.reason}`
  }
  if (application.kind === 'attention') appliedResult = outcome.result
  await recorder.finish({
    outcome: {
      result: appliedResult,
      summary: appliedSummary,
      exitCode: outcome.exitCode,
    },
    application: application.kind,
  })
}

function evidenceSummary(body: string) {
  return body.match(/## Summary\s+([\s\S]+)$/)?.[1]?.trim() ?? body.trim()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
