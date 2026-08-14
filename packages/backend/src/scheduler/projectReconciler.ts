import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkerRunResult, WorkerRunner } from '../agent/WorkerRunner'
import {
  type GoalDocument,
  type WorkDocument,
  isEngineeringWork,
  isWorkTerminal,
  renderGoalDocument,
  renderWorkDocument,
} from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import { type LinkedProjectRepo, requireProjectRepo } from '../domain/project'
import { resolveProjectPath } from '../domain/projectPath'
import type { WorkRuntimeFacts } from '../domain/workProjection'
import { type PublicationCoordinator, hashBytes } from '../publication/publisher'
import { type C1CompletionResult, createC1Integrator } from '../runtime/c1Integrator'
import { type GoalController, createGoalController } from '../runtime/goalController'
import {
  PROJECT_PREPARE_PATH,
  type ProjectPreparationResult,
  type ProjectPreparer,
  createProjectPreparer,
} from '../runtime/projectPreparation'
import { discoverRunArtifactPaths, preserveRunArtifacts } from '../runtime/runArtifacts'
import {
  type RunAttemptStore,
  type RunAttemptSummary,
  type RunCandidateCommit,
  createRunAttemptStore,
} from '../runtime/runAttemptStore'
import { runStoragePath } from '../runtime/runPaths'
import { type RunRequest, type RunTermination, runRequestSchema } from '../runtime/runRequest'
import {
  type StableWorktree,
  type StableWorktreeManager,
  createStableWorktreeManager,
} from '../runtime/stableWorktreeManager'
import { checkpointTaskWorktree } from '../runtime/taskCheckpoint'
import { currentSettledWorkIds, workAssignmentHash } from '../runtime/workAssignment'
import { workerRuntimeDigest } from '../runtime/workerContextRendering'
import {
  type WorkerContextBundle,
  type WorkerContextStager,
  createWorkerContextStager,
} from '../runtime/workerContextStager'
import {
  type WorkerSessionStore,
  bindWorkerSessionRunView,
  createWorkerSessionStore,
} from '../runtime/workerSessionStore'
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
  workerRunner: WorkerRunner
  contextStager?: WorkerContextStager
  worktrees?: StableWorktreeManager
  attempts?: RunAttemptStore
  preparer?: ProjectPreparer
  preparationTimeoutMs?: number
  workerSessions?: WorkerSessionStore
  goalController?: GoalController
  now?: () => Date
  createRunId?: () => string
  checkpointTask?: typeof checkpointTaskWorktree
  apiOrigin?: () => string
  onReleaseUpdated?(input: { projectId: string; commit: string }): Promise<void> | void
}

export type ProjectReconcileResult =
  | { kind: 'wait'; decision: ReconcileDecision }
  | { kind: 'cancellation_finished' }
  | {
      kind: 'run_settled'
      workId: string
      runId: string
      termination: RunTermination
    }

export interface ProjectReconciler {
  reconcileGoal(
    goalId: string,
    runtime: Pick<WorkRuntimeFacts, 'projectEligible'> &
      Partial<Omit<WorkRuntimeFacts, 'projectEligible'>> & { workerCapacity?: boolean },
  ): Promise<ProjectReconcileResult>
  decisionWhenEligible(
    goalId: string,
    goalPackage?: GoalPackage,
    runtime?: Partial<WorkRuntimeFacts>,
  ): Promise<ReconcileDecision>
  liveWorkIds(): ReadonlySet<string>
  checkpointInterruptedRun(attempt: RunAttemptSummary): Promise<RunCandidateCommit[]>
  requestWorkRun(goalId: string, workId: string, request: RunRequest): Promise<WorkRunRequest>
  completeWork(
    goalId: string,
    workId: string,
    input: { sourceEventId: string; decision: string; mapMarkdown?: string },
  ): Promise<WorkCompletionResult>
  completeGoal(
    goalId: string,
    input: { sourceEventId: string; decision: string },
  ): Promise<GoalDocument>
  interruptQueuedRuns(
    goalId?: string,
    workId?: string,
    termination?: Extract<RunTermination, 'cancelled' | 'interrupted'>,
  ): Promise<number>
  interruptRuns(
    goalId?: string,
    workId?: string,
    termination?: Extract<RunTermination, 'cancelled' | 'interrupted'>,
  ): void
}

export type WorkCompletionResult =
  | C1CompletionResult
  | { kind: 'completed'; commit: null; recoveredUncertainUpdate: false }
  | { kind: 'already_completed'; commit: string | null }

export interface WorkRunRequest {
  runId: string
  disposition: 'scheduled' | 'already_scheduled' | 'already_active'
}

interface WorkRunSlot {
  runId: string
  controller: AbortController
}

interface PreparedRepo {
  repo: LinkedProjectRepo
  worktree: StableWorktree
  projectRoot: string
  baseCommit: string
}

export function createProjectReconciler(options: ProjectReconcilerOptions): ProjectReconciler {
  const now = options.now ?? (() => new Date())
  const createRunId = options.createRunId ?? (() => `R-${crypto.randomUUID()}`)
  const checkpointTask = options.checkpointTask ?? checkpointTaskWorktree
  const contextStager =
    options.contextStager ?? createWorkerContextStager(options.homeRoot, options.publisher)
  const worktrees = options.worktrees ?? createStableWorktreeManager()
  const attempts = options.attempts ?? createRunAttemptStore(options.homeRoot, { now })
  const preparer = options.preparer ?? createProjectPreparer()
  const workerSessions = options.workerSessions ?? createWorkerSessionStore(options.homeRoot)
  const goalController = options.goalController ?? createGoalController(options.store, { now })
  const primaryProjectRepo = requireProjectRepo(
    { repos: options.projectRepos },
    options.primaryRepoId,
  )
  const runSlots = new Map<string, WorkRunSlot>()
  const completingWorks = new Set<string>()
  const completingGoals = new Set<string>()
  const c1 = createC1Integrator(options.homeRoot, options.store, options.publisher, now, {
    projectId: options.projectId,
    primaryRepoId: options.primaryRepoId,
    repos: options.projectRepos.map((repo) => ({
      repoId: repo.repoId,
      integrationRoot: repo.integrationRoot,
      projectPath: repo.projectPath,
      primary: repo.primary,
    })),
  })

  const interruptRuns: ProjectReconciler['interruptRuns'] = (
    goalId,
    workId,
    termination = 'interrupted',
  ) => {
    for (const [key, slot] of runSlots) {
      if (goalId && !key.startsWith(`${goalId}/`)) continue
      if (workId && key !== `${goalId}/${workId}`) continue
      slot.controller.abort({ termination })
    }
  }

  const decision = async (
    goalId: string,
    goalPackage: GoalPackage,
    runtime: Partial<WorkRuntimeFacts>,
  ) => {
    let snapshot = await attempts.snapshot()
    const scopedQueued = () =>
      snapshot
        .queued()
        .filter((attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId)

    let invalidated = false
    for (const queued of scopedQueued()) {
      const work = goalPackage.works.get(queued.workId)
      const currentHash =
        work && !isWorkTerminal(work.attributes) ? await workAssignmentHash(work) : null
      if (!work || isWorkTerminal(work.attributes) || currentHash !== queued.workHash) {
        await attempts.interruptQueued({
          projectId: options.projectId,
          goalId,
          workId: queued.workId,
          reason: 'Queued Attempt no longer matches current Work authority.',
        })
        invalidated = true
      }
    }
    if (invalidated) snapshot = await attempts.snapshot()

    const queued = snapshot
      .queued()
      .filter((attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId)
    const running = snapshot
      .running()
      .filter((attempt) => attempt.projectId === options.projectId && attempt.goalId === goalId)
    const localLive = [...runSlots.keys()]
      .filter((key) => key.startsWith(`${goalId}/`))
      .map((key) => key.slice(goalId.length + 1))
    const goalAttempts = snapshot.listGoal(options.projectId, goalId)
    const facts: WorkRuntimeFacts = {
      projectEligible: runtime.projectEligible ?? true,
      runningWorkIds: new Set([
        ...localLive,
        ...running.map((attempt) => attempt.workId),
        ...(runtime.runningWorkIds ?? []),
      ]),
      queuedWorkIds: new Set(queued.map((attempt) => attempt.workId)),
      settledWorkIds: await currentSettledWorkIds(goalPackage.works.values(), goalAttempts),
      now: runtime.now ?? now(),
    }
    return decideGoalReconciliation({
      projectId: options.projectId,
      goalId,
      goalPackage,
      runtime: facts,
    })
  }

  return {
    interruptRuns,
    liveWorkIds() {
      return new Set(runSlots.keys())
    },
    async checkpointInterruptedRun(attempt) {
      if (
        attempt.projectId !== options.projectId ||
        attempt.status !== 'running' ||
        attempt.workspaceMode !== 'isolated_write'
      ) {
        throw new Error(`Attempt is not a writable running Run for ${options.projectId}`)
      }
      return Promise.all(
        options.projectRepos.map(async (repo) => {
          const input = taskWorktreeInput(repo, attempt.goalId, attempt.workId)
          const worktree = (await worktrees.inspect(input)) ?? (await worktrees.prepare(input))
          const baseCommit = await git(worktree.path, ['rev-parse', 'HEAD'])
          const checkpoint = await checkpointTask({
            worktreePath: worktree.path,
            projectId: options.projectId,
            goalId: attempt.goalId,
            workId: attempt.workId,
            runId: attempt.runId,
            repoId: repo.repoId,
          })
          return { repoId: repo.repoId, baseCommit, resultCommit: checkpoint.head }
        }),
      )
    },
    interruptQueuedRuns(goalId, workId, termination = 'interrupted') {
      return attempts.interruptQueued({
        projectId: options.projectId,
        ...(goalId ? { goalId } : {}),
        ...(workId ? { workId } : {}),
        termination,
      })
    },
    async decisionWhenEligible(goalId, suppliedPackage, runtime = {}) {
      const goalPackage = suppliedPackage ?? (await options.store.readPackage(goalId))
      return decision(goalId, goalPackage, runtime)
    },
    async requestWorkRun(goalId, workId, requestInput) {
      if (completingGoals.has(goalId) || completingWorks.has(`${goalId}/${workId}`)) {
        throw new Error(`Cannot request a Run while completion is in progress: ${workId}`)
      }
      const request = runRequestSchema.parse(requestInput)
      const snapshot = await attempts.snapshot()
      const active = snapshot
        .list(options.projectId, goalId, workId)
        .find((attempt) => attempt.status === 'running')
      if (active) return { runId: active.runId, disposition: 'already_active' }

      const goalPackage = await options.store.readPackage(goalId)
      if (goalPackage.goal.attributes.lifecycle !== 'active') {
        throw new Error(
          `Cannot request a Run for ${goalPackage.goal.attributes.lifecycle} Goal ${goalId}`,
        )
      }
      const work = goalPackage.works.get(workId)
      if (!work || isWorkTerminal(work.attributes)) {
        throw new Error(`Cannot run missing or terminal Work: ${workId}`)
      }
      if (request.workspaceMode === 'isolated_write' && work.attributes.kind !== 'engineering') {
        throw new Error(`Only Engineering Work may request an isolated-write Run: ${workId}`)
      }
      const incompleteDependency = work.attributes.dependsOn.find(
        (dependencyId) => goalPackage.works.get(dependencyId)?.attributes.status !== 'done',
      )
      if (work.attributes.contractRevision !== goalPackage.goal.attributes.contractRevision) {
        throw new Error(`Cannot run stale Work: ${workId}`)
      }
      if (incompleteDependency) throw new Error(`Dependency is not done: ${incompleteDependency}`)
      if (work.attributes.notBefore && Date.parse(work.attributes.notBefore) > now().getTime()) {
        throw new Error(`Work is scheduled for ${work.attributes.notBefore}: ${workId}`)
      }
      const openAttention = [...goalPackage.attentions.values()].find(
        (attention) =>
          attention.attributes.resolvedAt === null &&
          attention.attributes.target ===
            `project:${options.projectId}/goal:${goalId}/work:${workId}`,
      )
      if (openAttention) {
        throw new Error(`Work is claimed by Attention ${openAttention.attributes.id}: ${workId}`)
      }

      return attempts.reserve({
        projectId: options.projectId,
        goalId,
        workId,
        runId: createRunId(),
        workHash: await workAssignmentHash(work),
        request,
      })
    },
    async completeWork(goalId, workId, input) {
      const completionKey = `${goalId}/${workId}`
      if (completingGoals.has(goalId) || completingWorks.has(completionKey)) {
        throw new Error(`Completion is already in progress: ${workId}`)
      }
      completingWorks.add(completionKey)
      try {
        await assertNoActiveAttempts(goalId, workId)
        const goalPackage = await options.store.readPackage(goalId)
        if (goalPackage.goal.attributes.lifecycle !== 'active') {
          throw new Error(
            `Cannot complete Work in ${goalPackage.goal.attributes.lifecycle} Goal ${goalId}`,
          )
        }
        const work = goalPackage.works.get(workId)
        if (!work || work.attributes.status === 'cancelled') {
          throw new Error(`Cannot complete missing or cancelled Work: ${workId}`)
        }
        const incompleteDependency = work.attributes.dependsOn.find(
          (dependencyId) => goalPackage.works.get(dependencyId)?.attributes.status !== 'done',
        )
        if (incompleteDependency) {
          throw new Error(`Dependency is not done: ${incompleteDependency}`)
        }
        const completedWork: WorkDocument = {
          ...work,
          attributes: { ...work.attributes, status: 'done' },
          body: appendCompletionDecision(work.body, input.sourceEventId, input.decision),
        }
        if (work.attributes.kind === 'decision') {
          if (work.attributes.status === 'done') {
            return { kind: 'already_completed', commit: null }
          }
          const path = options.store.paths.workDocument(goalId, workId)
          const source = await Bun.file(options.store.paths.absolute(path)).text()
          const mapWrite =
            input.mapMarkdown === undefined
              ? null
              : await supportingMarkdownWrite(
                  options.store.paths.absolute(options.store.paths.designIndex(goalId)),
                  options.store.paths.designIndex(goalId),
                  input.mapMarkdown,
                )
          await options.store.publishGoal(goalId, {
            supportingWrites: mapWrite ? [mapWrite] : [],
            gateWrite: {
              path,
              expectedHash: await hashBytes(new TextEncoder().encode(source)),
              content: renderWorkDocument(completedWork),
            },
          })
          return { kind: 'completed', commit: null, recoveredUncertainUpdate: false }
        }
        if (!isEngineeringWork(work.attributes)) {
          throw new Error(`Unsupported Work kind: ${workId}`)
        }

        const path = options.store.paths.workDocument(goalId, workId)
        const source = await Bun.file(options.store.paths.absolute(path)).text()
        const prepared = await prepareTaskRepos(goalId, workId)
        const taskWorktrees = Object.fromEntries(
          prepared.map(({ repo, worktree }) => [repo.repoId, worktree.path]),
        )
        const expectedTaskHeads = Object.fromEntries(
          await Promise.all(
            prepared.map(
              async ({ repo, worktree }) =>
                [repo.repoId, await git(worktree.path, ['rev-parse', 'HEAD'])] as const,
            ),
          ),
        )
        await assertNoActiveAttempts(goalId, workId)
        let result: C1CompletionResult
        try {
          result = await c1.complete({
            goalId,
            workId,
            sourceEventId: input.sourceEventId,
            decision: input.decision,
            expectedWorkHash: await hashBytes(new TextEncoder().encode(source)),
            taskWorktrees,
            expectedTaskHeads,
            completedWork,
          })
        } catch (error) {
          return { kind: 'rejected', reason: errorMessage(error) }
        }
        if (
          result.kind === 'integrated' ||
          result.kind === 'already_integrated' ||
          result.kind === 'blocked_after_boundary'
        ) {
          await options.onReleaseUpdated?.({ projectId: options.projectId, commit: result.commit })
        }
        return result
      } finally {
        completingWorks.delete(completionKey)
      }
    },
    async completeGoal(goalId, _input) {
      if (completingGoals.has(goalId)) {
        throw new Error(`Goal completion is already in progress: ${goalId}`)
      }
      completingGoals.add(goalId)
      try {
        await assertNoActiveAttempts(goalId)
        const goalPackage = await options.store.readPackage(goalId)
        const nonterminal = [...goalPackage.works.values()].find(
          (work) => !isWorkTerminal(work.attributes),
        )
        if (nonterminal) {
          throw new Error(`Work is not terminal: ${nonterminal.attributes.id}`)
        }
        if (goalPackage.goal.attributes.lifecycle === 'cancelled') {
          throw new Error(`Cannot complete cancelled Goal: ${goalId}`)
        }
        const next: GoalDocument = {
          ...goalPackage.goal,
          attributes: { ...goalPackage.goal.attributes, lifecycle: 'done' },
        }
        if (goalPackage.goal.attributes.lifecycle === 'done') return next
        if (
          goalPackage.goal.attributes.lifecycle !== 'active' &&
          goalPackage.goal.attributes.lifecycle !== 'paused'
        ) {
          throw new Error(`Cannot complete ${goalPackage.goal.attributes.lifecycle} Goal ${goalId}`)
        }
        const path = options.store.paths.goalDocument(goalId)
        const source = await Bun.file(options.store.paths.absolute(path)).text()
        await options.store.publishGoal(goalId, {
          supportingWrites: [],
          gateWrite: {
            path,
            expectedHash: await hashBytes(new TextEncoder().encode(source)),
            content: renderGoalDocument(next),
          },
        })
        return next
      } finally {
        completingGoals.delete(goalId)
      }
    },
    async reconcileGoal(goalId, runtime) {
      const goalPackage = await options.store.readPackage(goalId)
      const next = await decision(goalId, goalPackage, runtime)
      if (next.kind === 'wait') return { kind: 'wait', decision: next }
      if (next.kind === 'finish_cancellation') {
        await goalController.cancelGoal(goalId)
        return { kind: 'cancellation_finished' }
      }

      const { workId } = next
      const liveKey = `${goalId}/${workId}`
      if (runSlots.has(liveKey)) return { kind: 'wait', decision: next }
      const history = await attempts.list(options.projectId, goalId, workId)
      const queued = history.find((attempt) => attempt.status === 'queued')
      if (!queued) return { kind: 'wait', decision: { kind: 'wait', reasons: ['no_queued_run'] } }

      const runController = new AbortController()
      const slot: WorkRunSlot = {
        runId: queued.runId,
        controller: runController,
      }
      runSlots.set(liveKey, slot)
      try {
        const settlement = await executeQueuedRun({
          goalId,
          queued,
          signal: runController.signal,
        })
        return {
          kind: 'run_settled',
          workId,
          runId: queued.runId,
          termination: settlement,
        }
      } finally {
        if (runSlots.get(liveKey) === slot) runSlots.delete(liveKey)
      }
    },
  }

  async function executeQueuedRun(input: {
    goalId: string
    queued: RunAttemptSummary
    signal: AbortSignal
  }): Promise<RunTermination> {
    const { queued, goalId, signal } = input
    const workId = queued.workId
    const runId = queued.runId
    const assignmentHash = queued.workHash
    const recorder = await attempts.start({
      projectId: options.projectId,
      goalId,
      workId,
      runId,
      runRoot: runStoragePath(options.homeRoot, runId),
      workHash: assignmentHash,
    })

    let preparedRepos: PreparedRepo[] = []
    let result: WorkerRunResult = factualRunResult(
      'crashed',
      'Run did not reach the Worker process.',
    )
    try {
      if (signal.aborted) {
        result = factualRunResult(abortTermination(signal), 'Run was interrupted before setup.')
      } else {
        preparedRepos =
          queued.workspaceMode === 'none' ? [] : await prepareTaskRepos(goalId, workId)
        const workerRepoRoots =
          queued.workspaceMode === 'none'
            ? await Promise.all(
                options.projectRepos.map(async (repo) => ({
                  repoId: repo.repoId,
                  path: await ensureProjectScope(repo.integrationRoot, repo.projectPath),
                  primary: repo.primary,
                })),
              )
            : preparedRepos.map(({ repo, projectRoot }) => ({
                repoId: repo.repoId,
                path: projectRoot,
                primary: repo.primary,
              }))

        const currentPackage = await options.store.readPackage(goalId)
        const work = currentPackage.works.get(workId)
        if (!work || isWorkTerminal(work.attributes)) {
          throw new Error(`Work became terminal before Run start: ${workId}`)
        }
        if ((await workAssignmentHash(work)) !== assignmentHash) {
          throw new Error(`Work authority changed before Run start: ${workId}`)
        }

        const sessionKey = {
          projectId: options.projectId,
          goalId,
          workId,
          runId,
        }
        const sessionScope = {
          contractRevision: work.attributes.contractRevision,
          assignmentHash: assignmentHash ?? (await workAssignmentHash(work)),
          runtimeDigest: workerRuntimeDigest(),
        }
        const workerSession = await workerSessions.open(sessionKey, sessionScope)
        const previous = historyBefore(
          queued,
          await attempts.list(options.projectId, goalId, workId),
        )
        const context = await contextStager.prepare({
          projectRoot: options.projectRoot,
          projectPath: primaryProjectRepo.projectPath,
          projectId: options.projectId,
          goalId,
          workId,
          runId,
          workspaceMode: queued.workspaceMode,
          instructionMarkdown: queued.instructionMarkdown,
          refs: queued.refs,
          primaryRepoId: options.primaryRepoId,
          repoRoots: workerRepoRoots,
          apiOrigin: options.apiOrigin?.(),
          runtimeScratchDir: workerSession.workspaceDir,
          ...(previous
            ? {
                previousAttempt: {
                  runId: previous.runId,
                  termination: previous.termination ?? 'interrupted',
                  reportMarkdown:
                    previous.reportMarkdown ?? 'The previous Run has no available Report.',
                },
              }
            : {}),
        })
        const runViewRoot = await bindWorkerSessionRunView(
          workerSession.workspaceDir,
          context.runRoot,
        )

        if (queued.workspaceMode !== 'none') {
          await recorder.record({
            kind: 'message',
            level: 'info',
            role: 'coordinator',
            content: 'Project preparation started.',
          })
          const preparation = await prepareWorkerProject({
            preparer,
            timeoutMs: options.preparationTimeoutMs,
            context,
            primaryRepoId: options.primaryRepoId,
          })
          await recorder.record({
            kind: 'message',
            level: preparation.kind === 'ready' || preparation.kind === 'absent' ? 'info' : 'error',
            role: 'coordinator',
            content: `Project preparation ${preparation.kind}. Log: ${preparation.logPath}`,
          })
        }

        if (signal.aborted) {
          result = factualRunResult(
            abortTermination(signal),
            'Run was interrupted before the Worker process started.',
          )
        } else {
          const primaryPrepared = preparedRepos.find(
            ({ repo }) => repo.repoId === options.primaryRepoId,
          )
          const runCwd =
            queued.workspaceMode === 'none'
              ? workerSession.workspaceDir
              : (primaryPrepared?.projectRoot ?? workerSession.workspaceDir)
          result = await options.workerRunner.run(
            {
              projectId: options.projectId,
              goalId,
              workId,
              runId,
              workspaceMode: queued.workspaceMode,
              cwd: runCwd,
              sourceRoots: preparedRepos.map(({ worktree }) => worktree.path),
              context: { ...context, runViewRoot },
              session: workerSession.session,
              signal,
            },
            {
              onEvent: (event) => recorder.record(event),
              onExecution: (execution) => recorder.setExecution(execution),
              onSession: (session) => workerSessions.write(sessionKey, sessionScope, session),
              onSessionInvalid: () => workerSessions.invalidateVendor(sessionKey, sessionScope),
            },
          )
          await preserveArtifacts(runId, result, context, preparedRepos)
        }
      }
    } catch (error) {
      const termination = signal.aborted ? abortTermination(signal) : failureTermination(error)
      result = factualRunResult(termination, `Run runtime failed: ${errorMessage(error)}`)
      await recorder.record({
        kind: 'message',
        level: 'error',
        role: 'coordinator',
        content: result.reportMarkdown,
      })
    }

    let candidateCommits: RunCandidateCommit[] = []
    if (queued.workspaceMode === 'isolated_write' && preparedRepos.length > 0) {
      try {
        candidateCommits = await Promise.all(
          preparedRepos.map(async ({ repo, worktree, baseCommit }) => {
            const checkpoint = await checkpointTask({
              worktreePath: worktree.path,
              projectId: options.projectId,
              goalId,
              workId,
              runId,
              repoId: repo.repoId,
            })
            return {
              repoId: repo.repoId,
              baseCommit,
              resultCommit: checkpoint.head,
            }
          }),
        )
      } catch (error) {
        result = factualRunResult(
          'crashed',
          `${result.reportMarkdown.trim()}\n\nSource checkpoint failed: ${errorMessage(error)}`,
          result.exitCode,
        )
      }
    }

    await recorder.settle({
      termination: result.termination,
      reportMarkdown: result.reportMarkdown,
      exitCode: result.exitCode,
      candidateCommits,
      workHash: assignmentHash,
    })
    return result.termination
  }

  async function prepareTaskRepos(goalId: string, workId: string) {
    return Promise.all(
      options.projectRepos.map(async (repo): Promise<PreparedRepo> => {
        const worktree = await worktrees.prepare(taskWorktreeInput(repo, goalId, workId))
        return {
          repo,
          worktree,
          projectRoot: await ensureProjectScope(worktree.path, repo.projectPath),
          baseCommit: await git(worktree.path, ['rev-parse', 'HEAD']),
        }
      }),
    )
  }

  function taskWorktreeInput(repo: LinkedProjectRepo, goalId: string, workId: string) {
    return {
      projectRoot: repo.integrationRoot,
      projectId: options.projectId,
      goalId,
      workId,
      repoId: repo.repoId,
      primaryRepoId: options.primaryRepoId,
    }
  }

  async function assertNoActiveAttempts(goalId: string, workId?: string) {
    const snapshot = await attempts.snapshot()
    const active = [...snapshot.queued(), ...snapshot.running()].find(
      (attempt) =>
        attempt.projectId === options.projectId &&
        attempt.goalId === goalId &&
        (!workId || attempt.workId === workId),
    )
    if (active) {
      throw new Error(`Run ${active.runId} is still ${active.status}`)
    }
    const live = [...runSlots.keys()].find(
      (key) => key.startsWith(`${goalId}/`) && (!workId || key === `${goalId}/${workId}`),
    )
    if (live) throw new Error(`Run is still active for ${live}`)
  }
}

function historyBefore(current: RunAttemptSummary, history: readonly RunAttemptSummary[]) {
  return history.find(
    (attempt) =>
      attempt.runId !== current.runId &&
      attempt.status === 'settled' &&
      attempt.reportMarkdown !== null,
  )
}

function appendCompletionDecision(body: string, sourceEventId: string, decision: string) {
  const heading =
    body.includes('\n## Question\n') || body.startsWith('## Question\n')
      ? '## Resolution'
      : '## Completion decision'
  const section = [
    heading,
    '',
    `Assistant event: ${sourceEventId.trim()}`,
    '',
    decision.trim(),
  ].join('\n')
  const next = `${body.trimEnd()}\n\n${section}\n`
  if (body === next || body.trimEnd().endsWith(section)) return `${body.trimEnd()}\n`
  if (body.includes(`\n${heading}\n`)) {
    throw new Error('Completion decision already exists with different content')
  }
  return next
}

async function supportingMarkdownWrite(absolutePath: string, path: string, content: string) {
  const file = Bun.file(absolutePath)
  const current = (await file.exists()) ? new Uint8Array(await file.arrayBuffer()) : null
  return {
    path,
    expectedHash: current ? await hashBytes(current) : null,
    content: `${content.trimEnd()}\n`,
  }
}

async function preserveArtifacts(
  runId: string,
  result: WorkerRunResult,
  context: WorkerContextBundle,
  preparedRepos: readonly PreparedRepo[],
) {
  const discovered = await discoverRunArtifactPaths(context.artifactOutputDir)
  await preserveRunArtifacts({
    runId,
    runRoot: context.runRoot,
    artifacts: [...new Set([...result.artifacts, ...discovered])],
    sourceRoots: [
      context.artifactOutputDir,
      context.runtimeScratchDir,
      ...preparedRepos.map(({ projectRoot }) => projectRoot),
    ],
    portableRoots: preparedRepos.map(({ repo }) =>
      resolveProjectPath(repo.integrationRoot, repo.projectPath),
    ),
  })
}

async function prepareWorkerProject(input: {
  preparer: ProjectPreparer
  timeoutMs?: number
  context: WorkerContextBundle
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
  await Bun.write(input.context.promptFile, `${promptSource.trimEnd()}\n\n${facts.join('\n')}`)
  return result
}

async function ensureProjectScope(repoRoot: string, projectPath: string) {
  const projectRoot = resolveProjectPath(repoRoot, projectPath)
  await mkdir(projectRoot, { recursive: true })
  return projectRoot
}

function factualRunResult(
  termination: RunTermination,
  detail: string,
  exitCode: number | null = null,
): WorkerRunResult {
  return {
    termination,
    exitCode,
    artifacts: [],
    reportMarkdown: [
      '# Run report',
      '',
      `- Termination: ${termination}`,
      `- Exit code: ${exitCode ?? 'unavailable'}`,
      '',
      detail.trim() || 'The Run ended without an additional diagnostic.',
    ].join('\n'),
  }
}

function abortTermination(
  signal: AbortSignal,
): Extract<RunTermination, 'cancelled' | 'interrupted' | 'timed_out'> {
  const reason = signal.reason
  if (
    typeof reason === 'object' &&
    reason !== null &&
    'termination' in reason &&
    ['cancelled', 'interrupted', 'timed_out'].includes(String(reason.termination))
  ) {
    return reason.termination as Extract<RunTermination, 'cancelled' | 'interrupted' | 'timed_out'>
  }
  return 'interrupted'
}

function failureTermination(error: unknown): RunTermination {
  return /tim(?:e|ed)[ -]?out|timeout/i.test(errorMessage(error)) ? 'timed_out' : 'crashed'
}

async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim())
  return stdout.trim()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
