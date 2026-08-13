import type { GoalPackage } from '../domain/goalPackage'
import type { LinkedProjectRepo } from '../domain/project'
import type { GoalController } from '../runtime/goalController'
import type { RunRequest } from '../runtime/runRequest'
import type { WorkRunRequest } from '../scheduler/projectReconciler'
import type { WorkCompletionResult } from '../scheduler/projectReconciler'
import type { ReconcileDecision } from '../scheduler/reconcileDecision'
import type { GoalPackageStore } from '../storage/goalPackageStore'
import type { AssistantToolName } from './assistantToolSchemas'

export interface AssistantToolProject {
  projectId: string
  projectRoot: string
  sourceRoot: string
  primaryRepoId: string
  repos: readonly LinkedProjectRepo[]
  store: GoalPackageStore
  controller: GoalController
  reconciler: {
    interruptRuns(goalId?: string, workId?: string): void
    interruptQueuedRuns(goalId?: string, workId?: string): Promise<number>
    liveWorkIds(): ReadonlySet<string>
    decisionWhenEligible(goalId: string, goalPackage?: GoalPackage): Promise<ReconcileDecision>
    requestWorkRun(goalId: string, workId: string, request: RunRequest): Promise<WorkRunRequest>
    completeWork(
      goalId: string,
      workId: string,
      input: { sourceEventId: string; decision: string },
    ): Promise<WorkCompletionResult>
    completeGoal(
      goalId: string,
      input: { sourceEventId: string; decision: string },
    ): Promise<import('../domain/canonicalDocuments').GoalDocument>
  }
}

export interface AssistantToolResult {
  summary: string
  changed: boolean
  value: unknown
}

export interface AssistantTools {
  issue(eventId: string): string
  revoke(token: string): void
  execute(token: string, name: AssistantToolName, input: unknown): Promise<AssistantToolResult>
  executeForEvent(
    eventId: string,
    name: AssistantToolName,
    input: unknown,
  ): Promise<AssistantToolResult>
}
