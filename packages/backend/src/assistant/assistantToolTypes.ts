import type { GoalDocument, WorkDocument } from '../domain/canonicalDocuments'
import type { GoalPackage } from '../domain/goalPackage'
import type { LinkedProjectRepo } from '../domain/project'
import type { DeliveryOperation, DeliveryOperationIntent } from '../runtime/deliveryOperationStore'
import type { GoalController } from '../runtime/goalController'
import type { RunDirective } from '../runtime/runDirective'
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
    cancelOperation(
      goalId: string,
      operationId: string,
      eventId: string,
    ): Promise<DeliveryOperation>
    listGoalOperations(goalId: string): Promise<DeliveryOperation[]>
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
