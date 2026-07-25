import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoleRunResult, RoleRunner } from '../agent/RoleRunner'
import { isEngineeringWork, isWorkTerminal } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import {
  DEFAULT_PRIMARY_REPO_ID,
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
  PROJECT_PREPARE_PATH,
  type ProjectPreparationResult,
  type ProjectPreparer,
  createProjectPreparer,
} from '../runtime/projectPreparation'
import {
  type ResponsibilitySessionStore,
  createResponsibilitySessionStore,
} from '../runtime/responsibilitySessionStore'
import {
  type Responsibility,
  type RoleContextBundle,
  type RoleContextStager,
  createRoleContextStager,
} from '../runtime/roleContextStager'
import { discoverRunArtifactPaths, preserveRunArtifacts } from '../runtime/runArtifacts'
import {
  type RunAttemptRecorder,
  type RunAttemptStore,
  type RunAttemptSummary,
  createRunAttemptStore,
} from '../runtime/runAttemptStore'
import { runStoragePath } from '../runtime/runPaths'
import { settledFailureWorkIds as deriveSettledFailureWorkIds } from '../runtime/settledAttemptFailure'
import {
  type StableWorktreeManager,
  StableWorktreeSyncError,
  createStableWorktreeManager,
} from '../runtime/stableWorktreeManager'
import { TaskCheckpointError, checkpointTaskWorktree } from '../runtime/taskCheckpoint'
import { workAssignmentHash } from '../runtime/workAssignment'
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
  preparer?: ProjectPreparer
  preparationTimeoutMs?: number
  responsibilitySessions?: ResponsibilitySessionStore
  integrator?: C1Integrator
  goalController?: GoalController
  now?: () => Date
  createRunId?: () => string
  checkpointTask?: typeof checkpointTaskWorktree
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
  settledFailureWorkIds?(goalId: string, goalPackage?: GoalPackage): Promise<ReadonlySet<string>>
  requestWorkRun?(goalId: string, workId: string): Promise<string>
  interruptRuns(goalId?: string, workId?: string): void
}

export function createProjectReconciler(options: ProjectReconcilerOptions): ProjectReconciler {
  const now = options.now ?? (() => new Date())
  const createRunId = options.createRunId ?? (() => `R-${crypto.randomUUID()}`)
  const checkpointTask = options.checkpointTask ?? checkpointTaskWorktree
  const contextStager =
    options.contextStager ?? createRoleContextStager(options.homeRoot, options.publisher)
  const worktrees = options.worktrees ?? createStableWorktreeManager(options.homeRoot)
  const attempts = options.attempts ?? createRunAttemptStore(options.homeRoot, { now })
  const preparer = options.preparer ?? createProjectPreparer()
  const responsibilitySessions =
    options.responsibilitySessions ?? createResponsibilitySessionStore(options.homeRoot)
  const primaryRepoId = options.primaryRepoId ?? DEFAULT_PRIMARY_REPO_ID
  const projectRepos: readonly LinkedProjectRepo[] = options.projectRepos ?? [
    {
      repoId: primaryRepoId,
      repoPath: options.projectRoot,
      projectPath: '.',
      integrationRoot: options.projectRoot,
      primary: true,
    },
  ]
  const primaryProjectRepo = requireProjectRepo({ repos: projectRepos }, primaryRepoId)
  const c1Layout = {
    projectId: options.projectId,
    primaryRepoId,
    repos: projectRepos.map((repo) => ({
      repoId: repo.repoId,
      integrationRoot: repo.integrationRoot,
      projectPath: repo.projectPath,
      primary: repo.primary,
    })),
  }
  const completion = createCompletionStructureVerifier(options.store, c1Layout)
  const outcomes =
    options.outcomes ??
    createPassOutcomeCoordinator(options.store, options.publisher, {
      now,
      verifyCompletion: (goalId, goalPackage) => completion.verify(goalId, goalPackage),
    })
  const integrator =
    options.integrator ??
    createC1Integrator(options.homeRoot, options.store, options.publisher, now, c1Layout)
  const goalController =
    options.goalController ??
    createGoalController(options.store, {
      now,
      verifyCompletion: (goalId, goalPackage) => completion.verify(goalId, goalPackage),
    })
  const live = new Set<string>()
  const requestedRuns = new Map<string, string>()
  const runControllers = new Map<string, AbortController>()
  let projectInterruptionGeneration = 0
  const goalInterruptionGenerations = new Map<string, number>()
  let workInterruptionSequence = 0
  const workInterruptionGenerations = new Map<string, number>()
  const interruptRuns = (goalId?: string, workId?: string) => {
    if (workId) {
      if (!goalId) throw new Error('A Work interruption requires its Goal ID')
      const liveKey = `${goalId}/${workId}`
      requestedRuns.delete(liveKey)
      workInterruptionSequence += 1
      workInterruptionGenerations.set(liveKey, workInterruptionSequence)
      runControllers.get(liveKey)?.abort()
      return
    }
    const goalPrefix = goalId ? `${goalId}/` : null
    if (goalId) {
      for (const key of requestedRuns.keys()) {
        if (key.startsWith(`${goalId}/`)) requestedRuns.delete(key)
      }
      goalInterruptionGenerations.set(goalId, (goalInterruptionGenerations.get(goalId) ?? 0) + 1)
    } else {
      requestedRuns.clear()
      projectInterruptionGeneration += 1
    }
    for (const [key, controller] of runControllers) {
      if (!goalPrefix || key.startsWith(goalPrefix)) controller.abort()
    }
  }

  return {
    interruptRuns,
    liveWorkIds() {
      return new Set(live)
    },
    async settledFailureWorkIds(goalId, suppliedPackage) {
      const goalPackage = suppliedPackage ?? (await options.store.readPackage(goalId))
      const snapshot = await attempts.snapshot()
      return deriveSettledFailureWorkIds(
        goalPackage,
        snapshot.listGoal(options.projectId, goalId),
        requestedWorkIds(requestedRuns, goalId),
      )
    },
    async requestWorkRun(goalId, workId) {
      const goalPackage = await options.store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new Error(`Cannot retry missing or terminal Work: ${workId}`)
      }
      const key = `${goalId}/${workId}`
      const existing = requestedRuns.get(key)
      if (existing) return existing
      const runId = createRunId()
      requestedRuns.set(key, runId)
      return runId
    },
    async reconcileGoal(goalId, runtime = {}) {
      const interruptionGeneration = {
        project: projectInterruptionGeneration,
        goal: goalInterruptionGenerations.get(goalId) ?? 0,
        work: workInterruptionSequence,
      }
      const goalPackage = await options.store.readPackage(goalId)
      const attemptSnapshot = await attempts.snapshot()
      const requested = requestedWorkIds(requestedRuns, goalId)
      const livePrefix = `${goalId}/`
      const localLiveWorkIds = [...live]
        .filter((key) => key.startsWith(livePrefix))
        .map((key) => key.slice(livePrefix.length))
      const facts: WorkRuntimeFacts = {
        projectEligible: runtime.projectEligible ?? true,
        liveRunWorkIds: new Set([...localLiveWorkIds, ...(runtime.liveRunWorkIds ?? [])]),
        settledFailureWorkIds:
          runtime.settledFailureWorkIds ??
          (await deriveSettledFailureWorkIds(
            goalPackage,
            attemptSnapshot.listGoal(options.projectId, goalId),
            requested,
          )),
        passCapacity: {
          planner: runtime.passCapacity?.planner ?? true,
          generator: runtime.passCapacity?.generator ?? true,
          reviewer: runtime.passCapacity?.reviewer ?? true,
        },
        now: runtime.now ?? now(),
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
      const runId = requestedRuns.get(liveKey) ?? createRunId()
      requestedRuns.delete(liveKey)
      live.add(liveKey)
      const runController = new AbortController()
      runControllers.set(liveKey, runController)
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
        const assignmentHash = await workAssignmentHash(owningWork)
        const runRepos =
          responsibility === 'planner' || isEngineeringWork(owningWork.attributes)
            ? projectRepos
            : []
        if (responsibility !== 'planner' && runRepos.length === 0) {
          throw new Error(`Engineering Work ${workId} has no Project Repo environment`)
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
                  runRepos.map(async (repo) => {
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
          const summary = `Task worktree preparation failed: ${error.message}`
          const failedAttempt = await attempts.start({
            projectId: options.projectId,
            goalId,
            workId,
            runId,
            responsibility,
            runRoot: runStoragePath(options.homeRoot, runId),
            workHash: assignmentHash,
          })
          await failedAttempt.record({
            kind: 'message',
            level: 'error',
            role: 'coordinator',
            content: summary,
          })
          await failedAttempt.finish({
            outcome: {
              result: 'fail',
              summary,
              exitCode: null,
            },
            application: 'operational_failure',
          })
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: 'fail',
            application: 'operational_failure',
          }
        }
        const scopedWorktrees = await Promise.all(
          worktreeEntries.map(async (entry) => ({
            ...entry,
            projectRoot: await ensureProjectScope(entry.worktree.path, entry.repo.projectPath),
          })),
        )
        const roleRepoRoots = await Promise.all(
          responsibility === 'planner'
            ? runRepos.map(async (repo) => ({
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
        const sessionScope = {
          contractRevision: owningWork.attributes.contractRevision,
          assignmentHash,
        }
        const responsibilitySession = await responsibilitySessions.open(sessionKey, sessionScope)
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
          previousAttempt: latestResponsibilityAttempt(
            attemptSnapshot.list(options.projectId, goalId, workId),
            responsibility,
          ),
        })
        const preparation =
          responsibility === 'planner'
            ? null
            : await prepareResponsibilityProject({
                preparer,
                timeoutMs: options.preparationTimeoutMs,
                context,
                primaryRepoId,
              })
        attempt = await attempts
          .start({
            projectId: options.projectId,
            goalId,
            workId,
            runId,
            responsibility,
            runRoot: context.runRoot,
            workHash: sessionScope.assignmentHash,
          })
          .catch(() => null)
        if (preparation) {
          await attempt?.record({
            kind: 'message',
            level: preparation.kind === 'ready' || preparation.kind === 'absent' ? 'info' : 'error',
            role: 'coordinator',
            content: `Project preparation ${preparation.kind}. Log: ${preparation.logPath}`,
          })
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
                  responsibilitySession.workspaceDir)
                : responsibilitySession.workspaceDir,
            sourceRoots: worktreeEntries.map(({ worktree }) => worktree.path),
            context,
            session: responsibilitySession.session,
            signal: runController.signal,
          },
          {
            onEvent: (event) => attempt?.record(event),
            onExecution: (execution) => attempt?.setExecution(execution).catch(() => undefined),
            onSession: (nextSession) =>
              responsibilitySessions.write(sessionKey, sessionScope, nextSession),
            onSessionInvalid: () =>
              responsibilitySessions.invalidateVendor(sessionKey, sessionScope),
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
            if (error instanceof TaskCheckpointError && error.code !== 'infrastructure') {
              const invalid: PassOutcomeApplication = { kind: 'invalid', reason: summary }
              await finishAttempt(attempt, options.store, goalId, outcome, invalid)
              return {
                kind: 'pass_finished',
                workId,
                runId,
                result: outcome.result,
                application: invalid.kind,
              }
            }
            outcome = {
              result: 'fail',
              summary,
              artifacts: [],
              exitCode: outcome.exitCode,
              failureKind: 'operational',
            }
          }
        }

        try {
          outcome = await preserveOutcomeArtifacts(
            outcome,
            runId,
            context.runRoot,
            context.resultFile,
            [
              context.artifactOutputDir,
              context.runtimeScratchDir,
              ...roleRepoRoots.map((repo) => repo.path),
            ],
            roleRepoRoots.map((repo) => repo.path),
            [context.proposalRoot],
          )
        } catch (error) {
          const invalid: PassOutcomeApplication = {
            kind: 'invalid',
            reason: `Run artifact validation failed: ${errorMessage(error)}`,
          }
          await finishAttempt(attempt, options.store, goalId, outcome, invalid)
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: outcome.result,
            application: invalid.kind,
          }
        }

        if (outcome.failureKind === 'operational') {
          await attempt?.finish({
            outcome,
            application: 'operational_failure',
          })
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: outcome.result,
            application: 'operational_failure',
          }
        }

        const pass = { goalId, workId, runId, responsibility, context, outcome }
        const beforeApplication =
          responsibility === 'planner' ? await options.store.readPackage(goalId) : null
        const application = await outcomes.apply(pass)
        if (
          beforeApplication &&
          application.kind === 'published' &&
          application.result === 'success'
        ) {
          const afterApplication = await options.store.readPackage(goalId)
          for (const [candidateId, beforeWork] of beforeApplication.works) {
            const afterWork = afterApplication.works.get(candidateId)
            if (
              !isWorkTerminal(beforeWork.attributes) &&
              afterWork?.attributes.stage === 'cancelled'
            ) {
              interruptRuns(goalId, candidateId)
            }
          }
        }
        if (application.kind !== 'integration_required') {
          await finishAttempt(attempt, options.store, goalId, outcome, application)
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
          await attempt?.finish({
            outcome,
            application: integration.kind,
          })
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
        if (runController.signal.aborted) {
          await attempt?.interrupt(error)
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        const summary = `Responsibility runtime failed: ${errorMessage(error)}`
        await attempt?.finish({
          outcome: {
            result: 'fail',
            summary,
            exitCode: null,
          },
          application: 'operational_failure',
        })
        return {
          kind: 'pass_finished',
          workId,
          runId,
          result: 'fail',
          application: 'operational_failure',
        }
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

async function prepareResponsibilityProject(input: {
  preparer: ProjectPreparer
  timeoutMs?: number
  context: RoleContextBundle
  primaryRepoId: string
}) {
  const runtimeDir = join(input.context.runRoot, 'project-prepare')
  let result: ProjectPreparationResult
  try {
    result = await input.preparer.prepare({
      projectRoot: input.context.primaryRepoRoot,
      runtimeDir,
      cacheDir: input.context.runtimeCacheDir,
      timeoutMs: input.timeoutMs,
      primaryRepoId: input.primaryRepoId,
      repoRoots: input.context.repoRoots.map((repo) => ({
        repoId: repo.repoId,
        path: repo.path,
      })),
      releaseHeads: input.context.repoReleaseHeads,
    })
  } catch (error) {
    const logs = `Unexpected Project preparation failure: ${errorMessage(error)}`
    const logPath = join(runtimeDir, 'prepare.log')
    await mkdir(runtimeDir, { recursive: true })
    await Bun.write(logPath, `${logs}\n`)
    result = {
      kind: 'failed',
      adapterPath: join(input.context.primaryRepoRoot, ...PROJECT_PREPARE_PATH.split('/')),
      exitCode: null,
      logs,
      logPath,
      reposFile: input.context.reposFile,
    }
  }

  const resultPath = join(runtimeDir, 'result.json')
  await Bun.write(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  const facts = [
    '## Project Preparation',
    '',
    `- Status: ${result.kind}`,
    `- Adapter: ${result.adapterPath}`,
    `- Exit code: ${result.exitCode ?? 'none'}`,
    `- Repo manifest: ${result.reposFile}`,
    `- Log: ${result.logPath}`,
    `- Result: ${resultPath}`,
    '',
  ]
  const contextSource = await Bun.file(input.context.contextFile).text()
  await Bun.write(input.context.contextFile, `${contextSource.trimEnd()}\n\n${facts.join('\n')}`)

  const promptSource = await Bun.file(input.context.promptFile).text()
  const marker = '<!-- HOPI_ASSIGNMENT_SECTION_END:supporting-authority -->'
  const preparationFacts = ['## Project Preparation', '', ...facts.slice(2)]
  await Bun.write(
    input.context.promptFile,
    promptSource.includes(marker)
      ? promptSource.replace(marker, `${preparationFacts.join('\n')}\n${marker}`)
      : `${promptSource.trimEnd()}\n\n${preparationFacts.join('\n')}`,
  )
  return result
}

async function preserveOutcomeArtifacts(
  outcome: RoleRunResult,
  runId: string,
  runRoot: string,
  resultFile: string,
  sourceRoots: readonly string[],
  portableRoots: readonly string[],
  proposalRoots: readonly string[],
): Promise<RoleRunResult> {
  const discovered = await discoverRunArtifactPaths(sourceRoots[0] ?? runRoot)
  const preserved = await preserveRunArtifacts({
    runId,
    runRoot,
    artifacts: [...new Set([...outcome.artifacts, ...discovered])],
    sourceRoots,
    portableRoots,
    proposalRoots,
    resultFile,
  })
  return { ...outcome, artifacts: preserved.references }
}

async function ensureProjectScope(repoRoot: string, projectPath: string) {
  const projectRoot = resolveProjectPath(repoRoot, projectPath)
  await mkdir(projectRoot, { recursive: true })
  return projectRoot
}

function latestResponsibilityAttempt(
  history: readonly RunAttemptSummary[],
  responsibility: Responsibility,
) {
  const previous = history.find(
    (attempt) => attempt.status === 'finished' && attempt.responsibility === responsibility,
  )
  return previous
    ? {
        runId: previous.runId,
        responsibility: previous.responsibility,
        result: previous.result,
        application: previous.application,
        summary: previous.summary,
      }
    : undefined
}

function requestedWorkIds(requestedRuns: ReadonlyMap<string, string>, goalId: string) {
  const prefix = `${goalId}/`
  return new Set(
    [...requestedRuns.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length)),
  )
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
  if (application.kind === 'invalid') {
    appliedSummary = `${appliedSummary} Application rejected: ${application.reason}`
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
