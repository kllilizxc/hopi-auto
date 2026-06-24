import type { TaskItem, TaskStatus } from '../domain/board'
import type {
  GoalDecisionAnswerBatchResult,
  GoalDecisionAnswerResult,
  GoalDecisionResolveResult,
} from '../runtime/decisionRequest'
import type { GoalAttachmentRef } from '../storage/goalAttachmentStore'
import type { PreferenceEntry } from '../storage/preferenceStore'

export function summarizeResolvedDecisionResult(
  decisionKey: string,
  result: GoalDecisionResolveResult,
) {
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Resolved decision ${decisionKey} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Resolved decision ${decisionKey} and routed engineering through grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Resolved decision ${decisionKey} and routed engineering through planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Resolved decision ${decisionKey} and cleared linked blockers.`
  }
  return `Resolved decision ${decisionKey}.`
}

export function summarizeResolvedDecisionsResult(result: GoalDecisionAnswerBatchResult) {
  const decisionKeys = result.decisions.map((decision) => decision.decisionKey)
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Resolved ${decisionKeys.length} decisions and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Resolved ${decisionKeys.length} decisions and routed engineering through grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Resolved ${decisionKeys.length} decisions and routed engineering through planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return decisionKeys.length === 1
      ? `Resolved decision ${decisionKeys[0]} and cleared linked blockers.`
      : `Resolved ${decisionKeys.length} decisions and cleared linked blockers.`
  }
  return decisionKeys.length === 1
    ? `Resolved decision ${decisionKeys[0]}.`
    : `Resolved ${decisionKeys.length} decisions.`
}

export function summarizeRecordedAnswerResult(
  decisionKey: string,
  result: GoalDecisionAnswerResult,
) {
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Recorded answer in decision ${decisionKey} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Recorded answer in decision ${decisionKey} and opened grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Recorded answer in decision ${decisionKey} and opened planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Recorded answer in decision ${decisionKey} and cleared linked blockers.`
  }
  return `Recorded answer in decision ${decisionKey}.`
}

export function summarizeRecordedAnswersResult(result: GoalDecisionAnswerBatchResult) {
  const decisionKeys = result.decisions.map((decision) => decision.decisionKey).join(', ')
  if (result.followThrough?.kind === 'workflow_batch') {
    return `Recorded answers in decisions ${decisionKeys} and opened ${result.followThrough.workflows.length} planner workflows.`
  }
  if (result.followThrough?.kind === 'planning_batch') {
    return `Recorded answers in decisions ${decisionKeys} and opened grouped planning follow-through ${result.followThrough.groupKey}.`
  }
  if (result.followThrough?.kind === 'planning') {
    return `Recorded answers in decisions ${decisionKeys} and opened planning follow-through ${result.followThrough.taskRefs.join(', ')}.`
  }
  if (result.blockerRemoved) {
    return `Recorded answers in decisions ${decisionKeys} and cleared linked blockers.`
  }
  return `Recorded answers in decisions ${decisionKeys}.`
}

export function slugifyPreferenceSummary(summary: string) {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'preference'
}

export function isLegalManualTransition(from: TaskStatus, to: TaskStatus) {
  if (from === 'planned') {
    return to === 'in_review'
  }
  if (from === 'in_review') {
    return to === 'planned' || to === 'merging'
  }
  if (from === 'merging') {
    return to === 'planned' || to === 'done'
  }
  if (from === 'done') {
    return to === 'planned'
  }
  return false
}

export function resolveActionAttachments(
  attachmentAssetPaths: string[] | undefined,
  availableAttachments: GoalAttachmentRef[],
) {
  const requestedPaths = attachmentAssetPaths ?? []
  if (requestedPaths.length === 0) {
    return []
  }

  const attachmentByPath = new Map(
    availableAttachments.map((attachment) => [attachment.assetPath, attachment] as const),
  )
  const resolved: GoalAttachmentRef[] = []
  for (const assetPath of requestedPaths) {
    const attachment = attachmentByPath.get(assetPath)
    if (!attachment) {
      throw new Error(`Unknown assistant attachment asset path: ${assetPath}`)
    }
    if (!resolved.some((candidate) => candidate.assetPath === attachment.assetPath)) {
      resolved.push(attachment)
    }
  }

  return resolved
}

export function cloneTaskItem(task: TaskItem): TaskItem {
  return {
    ...task,
    acceptanceCriteria: [...task.acceptanceCriteria],
    blockedBy: task.blockedBy.map((blocker) => ({ ...blocker })),
  }
}

export function clonePreferenceEntry(entry: PreferenceEntry): PreferenceEntry {
  return {
    preferenceKey: entry.preferenceKey,
    status: entry.status,
    summary: entry.summary,
    ...(entry.rationale ? { rationale: entry.rationale } : {}),
    ...(entry.retiredReason ? { retiredReason: entry.retiredReason } : {}),
    ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
  }
}
