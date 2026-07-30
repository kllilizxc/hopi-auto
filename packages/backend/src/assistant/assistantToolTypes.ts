import type { GoalPackage } from '../domain/goalPackage'
import type { LinkedProjectRepo } from '../domain/project'
import type { GoalController } from '../runtime/goalController'
import type { WorkRunRequest } from '../scheduler/projectReconciler'
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
    settledFailureWorkIds(goalId: string, goalPackage?: GoalPackage): Promise<ReadonlySet<string>>
    requestWorkRun(
      goalId: string,
      workId: string,
      options?: { allowSuccessor?: boolean },
    ): Promise<WorkRunRequest>
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
