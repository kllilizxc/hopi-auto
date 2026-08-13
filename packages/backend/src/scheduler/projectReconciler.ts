import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RoleRunResult, RoleRunner } from '../agent/RoleRunner'
import {
  type GoalDocument,
  type WorkDocument,
  isEngineeringWork,
  isWorkTerminal,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { type LinkedProjectRepo, requireProjectRepo } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import type { WorkRuntimeFacts } from '../domain/workProjection'
import type { PublicationCoordinator } from '../publication/publisher'
import { type C1Integrator, createC1Integrator } from '../runtime/c1Integrator'
import { createCompletionStructureVerifier } from '../runtime/completionVerifier'
import {
  type DeliveryOperationExecutor,
  createDeliveryOperationExecutor,
} from '../runtime/deliveryOperationExecutor'
import {
  type DeliveryOperation,
  type DeliveryOperationIntent,
  type DeliveryOperationStore,
  createDeliveryOperationStore,
} from '../runtime/deliveryOperationStore'
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
  bindResponsibilitySessionRunView,
  createResponsibilitySessionStore,
} from '../runtime/responsibilitySessionStore'
import { responsibilityRuntimeDigest } from '../runtime/roleContextRendering'
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
import {
  type RunChangeSetStore,
  createRunChangeSetStore,
  readGitHead,
} from '../runtime/runChangeSet'
import { type RunDirective, legacyRunDirective, runDirectiveSchema } from '../runtime/runDirective'
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
  primaryRepoId: string
  projectRepos: readonly LinkedProjectRepo[]
  store: GoalPackageStore
  publisher: PublicationCoordinator
  roleRunner: RoleRunner
  contextStager?: RoleContextStager
  worktrees?: StableWorktreeManager
  outcomes?: PassOutcomeCoordinator
  attempts?: RunAttemptStore
  changeSets?: RunChangeSetStore
  operations?: DeliveryOperationStore
  operationExecutor?: DeliveryOperationExecutor
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
    runtime: Pick<WorkRuntimeFacts, 'projectEligible' | 'passCapacity'> &
      Partial<Omit<WorkRuntimeFacts, 'projectEligible' | 'passCapacity'>>,
  ): Promise<ProjectReconcileResult>
  decisionWhenEligible(goalId: string, goalPackage?: GoalPackage): Promise<ReconcileDecision>
  liveWorkIds(): ReadonlySet<string>
  settledFailureWorkIds(goalId: string, goalPackage?: GoalPackage): Promise<ReadonlySet<string>>
  requestWorkRun(
    goalId: string,
    workId: string,
    options?: { allowSuccessor?: boolean; directive?: RunDirective },
  ): Promise<WorkRunRequest>
  completeWork(
    goalId: string,
    workId: string,
    input: { sourceEventId: string; decision: string },
  ): Promise<WorkDocument>
  completeGoal(goalId: string, input: { decision: string }): Promise<GoalDocument>
  proposeOperation(
    goalId: string,
    input: {
      id: string
      workId?: string | null
      idempotencyKey: string
      requiredForGoal: boolean
      intent: DeliveryOperationIntent
      proposedByEventId: string
    },
  ): Promise<DeliveryOperation>
  executeOperation(
    goalId: string,
    operationId: string,
    approvedByEventId: string,
  ): Promise<DeliveryOperation>
  cancelOperation(goalId: string, operationId: string, eventId: string): Promise<DeliveryOperation>
  listGoalOperations(goalId: string): Promise<DeliveryOperation[]>
  interruptQueuedRuns(goalId?: string, workId?: string): Promise<number>
  interruptRuns(goalId?: string, workId?: string): void
}

export interface WorkRunRequest {
  runId: string
  disposition: 'scheduled' | 'already_scheduled' | 'already_active'
}

interface WorkRunSlot {
  runId: string
  state: 'active'
  controller: AbortController
}

export function createProjectReconciler(options: ProjectReconcilerOptions): ProjectReconciler {
  const now = options.now ?? (() => new Date())
  const createRunId = options.createRunId ?? (() => `R-${crypto.randomUUID()}`)
  const checkpointTask = options.checkpointTask ?? checkpointTaskWorktree
  const contextStager =
    options.contextStager ?? createRoleContextStager(options.homeRoot, options.publisher)
  const worktrees = options.worktrees ?? createStableWorktreeManager()
  const attempts = options.attempts ?? createRunAttemptStore(options.homeRoot, { now })
  const changeSets = options.changeSets ?? createRunChangeSetStore(options.homeRoot, { now })
  const primaryRepoId = options.primaryRepoId
  const projectRepos = options.projectRepos
  const operations = options.operations ?? createDeliveryOperationStore(options.homeRoot, { now })
  const operationExecutor =
    options.operationExecutor ??
    createDeliveryOperationExecutor({
      projectId: options.projectId,
      repos: projectRepos,
      operations,
      changeSets,
    })
  const preparer = options.preparer ?? createProjectPreparer()
  const responsibilitySessions =
    options.responsibilitySessions ?? createResponsibilitySessionStore(options.homeRoot)
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
  const completion = createCompletionStructureVerifier(options.store, c1Layout, {
    attempts,
    operations,
    changeSets,
  })
  const outcomes =
    options.outcomes ??
    createPassOutcomeCoordinator(options.store, options.publisher, {
      now,
      verifyCompletion: (goalId, goalPackage) => completion.verify(goalId, goalPackage),
    })
  const integrator =
    options.integrator ??
    createC1Integrator(options.homeRoot, options.store, options.publisher, now, c1Layout)
  const goalController = options.goalController ?? createGoalController(options.store, { now })
  const runSlots = new Map<string, WorkRunSlot>()
  let projectInterruptionGeneration = 0
  const goalInterruptionGenerations = new Map<string, number>()
  let workInterruptionSequence = 0
  const workInterruptionGenerations = new Map<string, number>()
  const interruptRuns = (goalId?: string, workId?: string) => {
    if (workId) {
      if (!goalId) throw new Error('A Work interruption requires its Goal ID')
      const liveKey = `${goalId}/${workId}`
      const slot = runSlots.get(liveKey)
      workInterruptionSequence += 1
      workInterruptionGenerations.set(liveKey, workInterruptionSequence)
      slot?.controller?.abort()
      return
    }
    if (goalId) {
      for (const [key, slot] of runSlots) {
        if (!key.startsWith(`${goalId}/`)) continue
        slot.controller.abort()
      }
      goalInterruptionGenerations.set(goalId, (goalInterruptionGenerations.get(goalId) ?? 0) + 1)
    } else {
      for (const slot of runSlots.values()) {
        slot.controller.abort()
      }
      projectInterruptionGeneration += 1
    }
  }

  return {
    interruptRuns,
    liveWorkIds() {
      return new Set(runSlots.keys())
    },
    async decisionWhenEligible(goalId, suppliedPackage) {
      const goalPackage = suppliedPackage ?? (await options.store.readPackage(goalId))
      const snapshot = await attempts.snapshot()
      const queuedAttempts = snapshot
        .queued()
        .filter((attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId)
      const queued = new Set(queuedAttempts.map((attempt) => attempt.workId))
      const goalAttempts = snapshot.listGoal(options.projectId, goalId)
      const livePrefix = `${goalId}/`
      const live = [...runSlots]
        .filter(([key]) => key.startsWith(livePrefix))
        .map(([key]) => key.slice(livePrefix.length))
      return decideGoalReconciliation({
        projectId: options.projectId,
        goalId,
        goalPackage,
        runtime: {
          projectEligible: true,
          liveRunWorkIds: new Set(live),
          settledFailureWorkIds: await deriveSettledFailureWorkIds(
            goalPackage,
            snapshot.listGoal(options.projectId, goalId),
            queued,
          ),
          passCapacity: {
            planner: true,
            generator: true,
            reviewer: true,
          },
          requestedRunProfiles: new Map(
            queuedAttempts.map((attempt) => [attempt.workId, attempt.profile] as const),
          ),
          supervisorManagedWorkIds: new Set(
            [...goalAttempts].flatMap(([workId, workAttempts]) =>
              workAttempts.some((attempt) => attempt.protocol === 'report') ? [workId] : [],
            ),
          ),
          supervisorManagedGoal: [...goalAttempts.values()].some((workAttempts) =>
            workAttempts.some((attempt) => attempt.protocol === 'report'),
          ),
          now: now(),
        },
      })
    },
    async settledFailureWorkIds(goalId, suppliedPackage) {
      const goalPackage = suppliedPackage ?? (await options.store.readPackage(goalId))
      const snapshot = await attempts.snapshot()
      return deriveSettledFailureWorkIds(
        goalPackage,
        snapshot.listGoal(options.projectId, goalId),
        queuedWorkIds(snapshot.queued(), options.projectId, goalId),
      )
    },
    interruptQueuedRuns(goalId, workId) {
      return attempts.interruptQueued({
        projectId: options.projectId,
        ...(goalId ? { goalId } : {}),
        ...(workId ? { workId } : {}),
      })
    },
    async requestWorkRun(goalId, workId, requestOptions) {
      const active = runSlots.get(`${goalId}/${workId}`)
      if (active && !requestOptions?.allowSuccessor) {
        return { runId: active.runId, disposition: 'already_active' }
      }
      const goalPackage = await options.store.readPackage(goalId)
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new Error(`Cannot continue missing or terminal Work: ${workId}`)
      }
      const runId = createRunId()
      const directive = requestOptions?.directive
        ? runDirectiveSchema.parse(requestOptions.directive)
        : legacyRunDirective(work.attributes)
      if (!directive) throw new Error(`Work has no current Run profile: ${workId}`)
      return attempts.reserve({
        projectId: options.projectId,
        goalId,
        workId,
        runId,
        responsibility: directive.profile,
        workHash: await workAssignmentHash(work),
        allowSuccessor: requestOptions?.allowSuccessor,
        directive,
      })
    },
    async completeWork(goalId, workId, input) {
      const snapshot = await attempts.snapshot()
      if (
        runSlots.has(`${goalId}/${workId}`) ||
        [...snapshot.running(), ...snapshot.queued()].some(
          (attempt) =>
            attempt.projectId === options.projectId &&
            attempt.goalId === goalId &&
            attempt.workId === workId,
        )
      ) {
        throw new Error(`Cannot complete Work with an active or queued Run: ${workId}`)
      }
      return goalController.completeWork(goalId, workId, input)
    },
    async completeGoal(goalId, input) {
      const snapshot = await attempts.snapshot()
      if (
        [...runSlots.keys()].some((key) => key.startsWith(`${goalId}/`)) ||
        [...snapshot.running(), ...snapshot.queued()].some(
          (attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId,
        )
      ) {
        throw new Error(`Cannot complete Goal with active or queued Runs: ${goalId}`)
      }
      const incompleteRequired = (await operations.listGoal(options.projectId, goalId)).filter(
        (operation) => operation.requiredForGoal && operation.status !== 'succeeded',
      )
      if (incompleteRequired.length > 0) {
        throw new Error(
          `Cannot complete Goal with incomplete required Operations: ${incompleteRequired.map((operation) => operation.id).join(', ')}`,
        )
      }
      return goalController.completeGoal(goalId, input)
    },
    async proposeOperation(goalId, input) {
      const goalPackage = await options.store.readPackage(goalId)
      if (input.workId && !goalPackage.works.has(input.workId)) {
        throw new Error(`Delivery Operation Work not found: ${input.workId}`)
      }
      const changeSet = await changeSets.readById(input.intent.changeSetId)
      if (
        !changeSet ||
        changeSet.projectId !== options.projectId ||
        changeSet.goalId !== goalId ||
        (input.workId && changeSet.workId !== input.workId)
      ) {
        throw new Error(
          `Delivery Operation ChangeSet is outside current scope: ${input.intent.changeSetId}`,
        )
      }
      return operations.propose({
        ...input,
        projectId: options.projectId,
        goalId,
      })
    },
    async executeOperation(goalId, operationId, approvedByEventId) {
      const operation = await operations.read(operationId)
      if (!operation || operation.projectId !== options.projectId || operation.goalId !== goalId) {
        throw new Error(`Delivery Operation not found in Goal ${goalId}: ${operationId}`)
      }
      return operationExecutor.execute(operationId, approvedByEventId)
    },
    async cancelOperation(goalId, operationId, eventId) {
      const operation = await operations.read(operationId)
      if (!operation || operation.projectId !== options.projectId || operation.goalId !== goalId) {
        throw new Error(`Delivery Operation not found in Goal ${goalId}: ${operationId}`)
      }
      return operations.cancel(operationId, eventId)
    },
    listGoalOperations(goalId) {
      return operations.listGoal(options.projectId, goalId)
    },
    async reconcileGoal(goalId, runtime) {
      const interruptionGeneration = {
        project: projectInterruptionGeneration,
        goal: goalInterruptionGenerations.get(goalId) ?? 0,
        work: workInterruptionSequence,
      }
      const goalPackage = await options.store.readPackage(goalId)
      let attemptSnapshot = await attempts.snapshot()
      let invalidatedQueuedAttempt = false
      for (const queued of attemptSnapshot
        .queued()
        .filter(
          (attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId,
        )) {
        const queuedWork = goalPackage.works.get(queued.workId)
        const currentLegacyDirective = queuedWork ? legacyRunDirective(queuedWork.attributes) : null
        const currentHash =
          queuedWork && !isWorkTerminal(queuedWork.attributes)
            ? await workAssignmentHash(queuedWork)
            : null
        if (
          !queuedWork ||
          isWorkTerminal(queuedWork.attributes) ||
          (queued.protocol === 'legacy_outcome' &&
            currentLegacyDirective?.profile !== queued.profile) ||
          currentHash !== queued.workHash
        ) {
          await attempts.interruptQueued({
            projectId: options.projectId,
            goalId,
            workId: queued.workId,
            reason: 'Queued Attempt no longer matches current Work authority.',
          })
          invalidatedQueuedAttempt = true
        }
      }
      if (invalidatedQueuedAttempt) attemptSnapshot = await attempts.snapshot()
      const requested = queuedWorkIds(attemptSnapshot.queued(), options.projectId, goalId)
      const goalAttempts = attemptSnapshot.listGoal(options.projectId, goalId)
      const requestedRunProfiles = new Map(
        attemptSnapshot
          .queued()
          .filter((attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId)
          .map((attempt) => [attempt.workId, attempt.profile] as const),
      )
      const supervisorManagedWorkIds = new Set(
        [...goalAttempts].flatMap(([workId, workAttempts]) =>
          workAttempts.some((attempt) => attempt.protocol === 'report') ? [workId] : [],
        ),
      )
      const livePrefix = `${goalId}/`
      const localLiveWorkIds = [...runSlots]
        .filter(([key]) => key.startsWith(livePrefix))
        .map(([key]) => key.slice(livePrefix.length))
      const facts: WorkRuntimeFacts = {
        projectEligible: runtime.projectEligible,
        liveRunWorkIds: new Set([...localLiveWorkIds, ...(runtime.liveRunWorkIds ?? [])]),
        settledFailureWorkIds:
          runtime.settledFailureWorkIds ??
          (await deriveSettledFailureWorkIds(
            goalPackage,
            attemptSnapshot.listGoal(options.projectId, goalId),
            requested,
          )),
        passCapacity: {
          planner: runtime.passCapacity.planner,
          generator: runtime.passCapacity.generator,
          reviewer: runtime.passCapacity.reviewer,
        },
        requestedRunProfiles,
        supervisorManagedWorkIds,
        supervisorManagedGoal: [...goalAttempts.values()].some((workAttempts) =>
          workAttempts.some((attempt) => attempt.protocol === 'report'),
        ),
        now: runtime.now ?? now(),
      }
      const decision = decideGoalReconciliation({
        projectId: options.projectId,
        goalId,
        goalPackage,
        runtime: facts,
      })

      if (decision.kind === 'wait') return { kind: 'wait', decision }
      if (decision.kind === 'ensure_planning') {
        const work = await goalController.ensurePlanning(
          goalId,
          'Perform the final semantic assessment or refresh the delivery plan.',
        )
        return { kind: 'planning_ensured', workId: work.attributes.id }
      }
      if (decision.kind === 'finish_cancellation') {
        await goalController.cancelGoal(goalId)
        return { kind: 'cancellation_finished' }
      }

      const { workId, responsibility } = decision
      const liveKey = `${goalId}/${workId}`
      const existingSlot = runSlots.get(liveKey)
      if (existingSlot) return { kind: 'wait', decision }
      const owningWork = goalPackage.works.get(workId)
      if (!owningWork) throw new Error(`Work is missing: ${workId}`)
      const assignmentHash = await workAssignmentHash(owningWork)
      const queuedAttempt = attemptSnapshot
        .queued()
        .find(
          (candidate) =>
            candidate.projectId === options.projectId &&
            candidate.goalId === goalId &&
            candidate.workId === workId &&
            candidate.profile === responsibility,
        )
      const compatibilityDirective = legacyRunDirective(owningWork.attributes)
      const reservation = queuedAttempt
        ? { runId: queuedAttempt.runId, disposition: 'already_scheduled' as const }
        : await attempts.reserve({
            projectId: options.projectId,
            goalId,
            workId,
            runId: createRunId(),
            responsibility,
            workHash: assignmentHash,
            ...(compatibilityDirective ? { directive: compatibilityDirective } : {}),
          })
      if (reservation.disposition === 'already_active') return { kind: 'wait', decision }
      const runId = reservation.runId
      const runAttempt =
        queuedAttempt ??
        (await attempts.list(options.projectId, goalId, workId)).find(
          (candidate) => candidate.runId === runId,
        )
      if (!runAttempt) throw new Error(`Reserved Run is missing: ${runId}`)
      const directive = directiveFromAttempt(runAttempt)
      const reportRun = directive.protocol === 'report'
      const workspaceMode = directive.workspaceMode
      if (runSlots.has(liveKey)) return { kind: 'wait', decision }
      const runController = new AbortController()
      const runSlot: WorkRunSlot = {
        runId,
        state: 'active',
        controller: runController,
      }
      runSlots.set(liveKey, runSlot)
      let attempt: RunAttemptRecorder | null = null
      let freezeGeneratorSource: (() => Promise<void>) | null = null
      try {
        if (
          interruptionGeneration.project !== projectInterruptionGeneration ||
          interruptionGeneration.goal !== (goalInterruptionGenerations.get(goalId) ?? 0) ||
          (workInterruptionGenerations.get(liveKey) ?? 0) > interruptionGeneration.work
        ) {
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        const recorder = await attempts.start({
          projectId: options.projectId,
          goalId,
          workId,
          runId,
          responsibility,
          runRoot: runStoragePath(options.homeRoot, runId),
          workHash: assignmentHash,
        })
        attempt = recorder
        const runRepos =
          reportRun || responsibility === 'planner' || isEngineeringWork(owningWork.attributes)
            ? projectRepos
            : []
        if (!reportRun && responsibility !== 'planner' && runRepos.length === 0) {
          throw new Error(`Engineering Work ${workId} has no Project Repo environment`)
        }
        let worktreeEntries: Array<{
          repo: LinkedProjectRepo
          worktree: Awaited<ReturnType<StableWorktreeManager['prepare']>>
          baseCommit: string
        }> = []
        try {
          worktreeEntries =
            workspaceMode === 'none'
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
                    const worktree =
                      workspaceMode === 'read_only'
                        ? await worktrees.prepareClean(worktreeInput)
                        : await worktrees.prepare(worktreeInput)
                    return { repo, worktree, baseCommit: await readGitHead(worktree.path) }
                  }),
                )
        } catch (error) {
          if (!(error instanceof StableWorktreeSyncError)) throw error
          const summary = `Task worktree preparation failed: ${error.message}`
          await attempt.record({
            kind: 'message',
            level: 'error',
            role: 'coordinator',
            content: summary,
          })
          await attempt.finish({
            outcome: {
              result: reportRun ? null : 'fail',
              summary,
              exitCode: null,
              termination: 'crashed',
              reportMarkdown: `# Run Report\n\n${summary}\n`,
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
        let generatorSourceFrozen = false
        freezeGeneratorSource =
          workspaceMode === 'isolated_write'
            ? async () => {
                if (generatorSourceFrozen || worktreeEntries.length === 0) {
                  return
                }
                const checkpoints = await Promise.all(
                  worktreeEntries.map(async ({ repo, worktree, baseCommit }) => ({
                    repoId: repo.repoId,
                    worktreePath: worktree.path,
                    baseCommit,
                    resultCommit: (
                      await checkpointTask({
                        worktreePath: worktree.path,
                        projectId: options.projectId,
                        goalId,
                        workId,
                        runId,
                        repoId: repo.repoId,
                      })
                    ).head,
                  })),
                )
                const frozen = await changeSets.freeze({
                  projectId: options.projectId,
                  goalId,
                  workId,
                  runId,
                  repos: checkpoints,
                })
                if (frozen) {
                  await recorder.setChangeSet(frozen.id)
                  await recorder.record({
                    kind: 'message',
                    level: 'info',
                    role: 'coordinator',
                    content: `Frozen unaccepted ChangeSet ${frozen.id} from ${frozen.repos.length} Repo${frozen.repos.length === 1 ? '' : 's'}.`,
                  })
                }
                generatorSourceFrozen = true
              }
            : null
        const scopedWorktrees = await Promise.all(
          worktreeEntries.map(async (entry) => ({
            ...entry,
            projectRoot: await ensureProjectScope(entry.worktree.path, entry.repo.projectPath),
          })),
        )
        const roleRepoRoots = await Promise.all(
          workspaceMode === 'none'
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
          runId,
          responsibility,
        }
        const sessionScope = {
          contractRevision: owningWork.attributes.contractRevision,
          assignmentHash,
          runtimeDigest: responsibilityRuntimeDigest(responsibility),
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
          directive,
          primaryRepoId,
          repoRoots: roleRepoRoots,
          apiOrigin: options.apiOrigin?.(),
          runtimeScratchDir: responsibilitySession.workspaceDir,
          previousAttempt: latestResponsibilityAttempt(
            attemptSnapshot.list(options.projectId, goalId, workId),
            responsibility,
          ),
        })
        const runViewRoot = await bindResponsibilitySessionRunView(
          responsibilitySession.workspaceDir,
          context.runRoot,
        )
        const preparation =
          workspaceMode === 'none'
            ? null
            : await (async () => {
                await recorder.record({
                  kind: 'message',
                  level: 'info',
                  role: 'coordinator',
                  content: 'Project preparation started.',
                })
                return prepareResponsibilityProject({
                  preparer,
                  timeoutMs: options.preparationTimeoutMs,
                  context,
                  primaryRepoId,
                })
              })()
        if (preparation) {
          await recorder.record({
            kind: 'message',
            level: preparation.kind === 'ready' || preparation.kind === 'absent' ? 'info' : 'error',
            role: 'coordinator',
            content: `Project preparation ${preparation.kind}. Log: ${preparation.logPath}`,
          })
        }
        if (runController.signal.aborted) {
          if (freezeGeneratorSource) await freezeGeneratorSource()
          await recorder.interrupt(new Error(`${responsibility} Run was interrupted`))
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        let runCwd = responsibilitySession.workspaceDir
        if (workspaceMode === 'isolated_write') {
          const primaryWorktree = scopedWorktrees.find(({ repo }) => repo.repoId === primaryRepoId)
          if (!primaryWorktree) {
            throw new Error(`Primary Repo task worktree is missing: ${primaryRepoId}`)
          }
          runCwd = primaryWorktree.projectRoot
        }
        let outcome = await options.roleRunner.run(
          {
            projectId: options.projectId,
            goalId,
            workId,
            runId,
            responsibility,
            protocol: directive.protocol,
            workspaceMode,
            cwd: runCwd,
            sourceRoots: worktreeEntries.map(({ worktree }) => worktree.path),
            context: { ...context, runViewRoot },
            session: responsibilitySession.session,
            signal: runController.signal,
          },
          {
            onEvent: (event) => recorder.record(event),
            onExecution: (execution) => recorder.setExecution(execution),
            onSession: async (nextSession) => {
              await Promise.all([
                responsibilitySessions.write(sessionKey, sessionScope, nextSession),
                recorder.recordSession(nextSession),
              ])
            },
            onSessionInvalid: () =>
              responsibilitySessions.invalidateVendor(sessionKey, sessionScope),
            onSessionRotate: async (rotation) => {
              if (workspaceMode === 'isolated_write') {
                const checkpoints = await Promise.all(
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
                await recorder.record({
                  kind: 'message',
                  level: 'info',
                  role: 'coordinator',
                  content: `Checkpointed ${checkpoints.length} Repo workspace${checkpoints.length === 1 ? '' : 's'} before Session Epoch rotation.`,
                })
              }
              await recorder.rotateSession({
                reason: rotation.reason,
                handoffMarkdown: rotation.handoffMarkdown,
              })
            },
          },
        )
        if (runController.signal.aborted) {
          let checkpointFailure: unknown = null
          if (freezeGeneratorSource) {
            try {
              await freezeGeneratorSource()
              await recorder.record({
                kind: 'message',
                level: 'info',
                role: 'coordinator',
                content: reportRun
                  ? 'Checkpointed safe partial writable source before interruption and froze any delta.'
                  : 'Checkpointed safe partial Generator source before interruption and froze any delta.',
              })
            } catch (error) {
              checkpointFailure = error
              await recorder.record({
                kind: 'message',
                level: 'error',
                role: 'coordinator',
                content: `${reportRun ? 'Partial writable-source' : 'Partial Generator'} checkpoint failed during interruption: ${errorMessage(error)}`,
              })
            }
          }
          await recorder.interrupt(
            new Error(
              checkpointFailure
                ? `${responsibility} Run was interrupted; partial source checkpoint failed: ${errorMessage(checkpointFailure)}`
                : `${responsibility} Run was interrupted`,
            ),
          )
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        if (freezeGeneratorSource) {
          try {
            await freezeGeneratorSource()
          } catch (error) {
            const summary = `Task checkpoint failed: ${errorMessage(error)}`
            if (
              !reportRun &&
              error instanceof TaskCheckpointError &&
              error.code !== 'infrastructure'
            ) {
              const invalid: PassOutcomeApplication = { kind: 'invalid', reason: summary }
              await finishAttempt(recorder, options.store, goalId, outcome, invalid)
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
              termination: 'crashed',
              reportMarkdown: `# Run Report\n\n${summary}\n`,
            }
          }
        }

        try {
          const releasedRepoRoots = runRepos.map((repo) =>
            resolveProjectPath(repo.integrationRoot, repo.projectPath),
          )
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
            releasedRepoRoots,
            [context.proposalRoot],
          )
        } catch (error) {
          if (reportRun) {
            const summary = `Run artifact validation failed: ${errorMessage(error)}`
            await recorder.finish({
              outcome: {
                result: null,
                summary,
                exitCode: outcome.exitCode,
                termination: 'crashed',
                reportMarkdown: `# Run Report\n\n${summary}\n`,
              },
              application: 'reported',
            })
            return {
              kind: 'pass_finished',
              workId,
              runId,
              result: 'reported',
              application: 'reported',
            }
          }
          const invalid: PassOutcomeApplication = {
            kind: 'invalid',
            reason: `Run artifact validation failed: ${errorMessage(error)}`,
          }
          await finishAttempt(recorder, options.store, goalId, outcome, invalid)
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: outcome.result,
            application: invalid.kind,
          }
        }

        if (reportRun) {
          await recorder.finish({
            outcome: {
              result: null,
              summary: outcome.summary,
              exitCode: outcome.exitCode,
              termination:
                outcome.termination ??
                (outcome.failureKind === 'operational' ? 'crashed' : 'normal'),
              reportMarkdown: outcome.reportMarkdown,
            },
            application: 'reported',
          })
          return {
            kind: 'pass_finished',
            workId,
            runId,
            result: 'reported',
            application: 'reported',
          }
        }

        if (outcome.failureKind === 'operational') {
          await recorder.finish({
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
          await finishAttempt(recorder, options.store, goalId, outcome, application)
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
          await recorder.finish({
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
          await finishAttempt(recorder, options.store, goalId, rejectedOutcome, rejected)
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
          await recorder.finish({
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
        await recorder.finish({
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
        let sourceFreezeFailure: unknown = null
        if (freezeGeneratorSource) {
          try {
            await freezeGeneratorSource()
          } catch (freezeError) {
            sourceFreezeFailure = freezeError
          }
        }
        if (runController.signal.aborted) {
          await attempt?.interrupt(
            sourceFreezeFailure
              ? new Error(
                  `${errorMessage(error)}; source preservation failed: ${errorMessage(sourceFreezeFailure)}`,
                )
              : error,
          )
          return { kind: 'wait', decision: { kind: 'wait', reasons: ['run_interrupted'] } }
        }
        const summary = `Responsibility runtime failed: ${errorMessage(error)}${
          sourceFreezeFailure
            ? `; source preservation failed: ${errorMessage(sourceFreezeFailure)}`
            : ''
        }`
        await attempt?.finish({
          outcome: {
            result: reportRun ? null : 'fail',
            summary,
            exitCode: null,
            termination: 'crashed',
            reportMarkdown: `# Run Report\n\n${summary}\n`,
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
        if (runSlots.get(liveKey) === runSlot) runSlots.delete(liveKey)
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
  const startedAt = new Date()
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
      releaseHeads: input.context.repoProjectionHeads,
      projection: input.context.repoProjection,
    })
  } catch (error) {
    const logs = `Unexpected Project preparation failure: ${errorMessage(error)}`
    const logPath = join(runtimeDir, 'prepare.log')
    await mkdir(runtimeDir, { recursive: true })
    await Bun.write(logPath, `${logs}\n`)
    const endedAt = new Date()
    result = {
      kind: 'failed',
      adapterPath: join(input.context.primaryRepoRoot, ...PROJECT_PREPARE_PATH.split('/')),
      exitCode: null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
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
    `- Duration: ${result.durationMs} ms`,
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

function queuedWorkIds(attempts: readonly RunAttemptSummary[], projectId: string, goalId: string) {
  return new Set(
    attempts
      .filter((attempt) => attempt.projectId === projectId && attempt.goalId === goalId)
      .map((attempt) => attempt.workId),
  )
}

async function finishAttempt(
  recorder: RunAttemptRecorder,
  store: GoalPackageStore,
  goalId: string,
  outcome: RoleRunResult,
  application: PassOutcomeApplication,
) {
  const evidenceId = 'evidenceId' in application ? application.evidenceId : null
  const appliedResult = application.kind === 'published' ? application.result : outcome.result
  let appliedSummary = outcome.summary
  if (evidenceId) {
    const evidence = (await store.readPackage(goalId)).evidence.get(evidenceId)
    appliedSummary = evidence ? evidence.body.trim() : appliedSummary
  }
  if (application.kind === 'stale') {
    appliedSummary = `${appliedSummary} Stale result: ${application.reason}`
  }
  if (application.kind === 'invalid') {
    appliedSummary = `${appliedSummary} Application rejected: ${application.reason}`
  }
  await recorder.finish({
    outcome: {
      result: appliedResult,
      summary: appliedSummary,
      exitCode: outcome.exitCode,
      termination: outcome.termination,
      reportMarkdown: outcome.reportMarkdown,
    },
    application: application.kind,
  })
}

function directiveFromAttempt(attempt: RunAttemptSummary): RunDirective {
  return runDirectiveSchema.parse({
    protocol: attempt.protocol,
    profile: attempt.profile,
    workspaceMode: attempt.workspaceMode,
    instructionMarkdown: attempt.instructionMarkdown,
    refs: attempt.inputRefs,
    baseChangeSetId: attempt.baseChangeSetId,
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
