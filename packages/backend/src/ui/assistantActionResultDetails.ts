export interface AssistantActionResultDetailsInput {
  kind?: string
  summary?: string
  created?: boolean
  createdDecisionKeys?: string[]
  blockerRemoved?: boolean
  resolvedSourceResponseFormat?: string
  followThrough?: {
    kind: 'planning' | 'planning_batch' | 'workflow_batch'
    workflowKey?: string
    groupKey?: string
    groupKeys?: string[]
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }
}

export function formatAssistantActionResultDetails(
  result: AssistantActionResultDetailsInput,
): string[] {
  const lines: string[] = []

  if (typeof result.created === 'boolean') {
    lines.push(`Created decision topic: ${result.created ? 'yes' : 'no'}`)
  }
  if (result.createdDecisionKeys && result.createdDecisionKeys.length > 0) {
    lines.push(`Created decision keys: ${result.createdDecisionKeys.join(', ')}`)
  }
  if (typeof result.blockerRemoved === 'boolean') {
    lines.push(`Decision blocker removed: ${result.blockerRemoved ? 'yes' : 'no'}`)
  }
  if (result.resolvedSourceResponseFormat) {
    lines.push(`Resolved source-response format: ${result.resolvedSourceResponseFormat}`)
  }
  if (result.followThrough) {
    lines.push(`Follow-through kind: ${result.followThrough.kind}`)
    if (result.followThrough.workflowKey) {
      lines.push(`Follow-through workflow key: ${result.followThrough.workflowKey}`)
    }
    if (result.followThrough.groupKey) {
      lines.push(`Follow-through group key: ${result.followThrough.groupKey}`)
    }
    if (result.followThrough.groupKeys && result.followThrough.groupKeys.length > 0) {
      lines.push(`Follow-through group keys: ${result.followThrough.groupKeys.join(', ')}`)
    }
    lines.push(`Follow-through requests: ${result.followThrough.requestKeys.join(', ')}`)
    lines.push(`Follow-through tasks: ${result.followThrough.taskRefs.join(', ')}`)
    lines.push(`Follow-through blockers: ${result.followThrough.blockerTaskRefs.join(', ')}`)
  }

  return lines
}
