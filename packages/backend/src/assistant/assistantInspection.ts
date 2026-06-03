import type { AssistantThreadEntry } from '../runtime/assistantThreadStore'
import type { GoalAssistantAction } from './assistantRun'

export interface AssistantActionResultDetailsInput {
  kind?: string
  taskRef?: string
  requestKey?: string
  taskRefs?: string[]
  requestKeys?: string[]
  groupKeys?: string[]
  workflowKey?: string
  workflows?: Array<{
    kind: 'planning' | 'planning_batch'
    workflowTaskKey?: string
    groupKey?: string
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }>
  blockerTaskRefs?: string[]
  groupKey?: string
  status?: string
  decisionKey?: string
  decisionKeys?: string[]
  preferenceKey?: string
  retiredPreferenceKeys?: string[]
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
    workflows?: Array<{
      kind: 'planning' | 'planning_batch'
      workflowTaskKey?: string
      groupKey?: string
      requestKeys: string[]
      taskRefs: string[]
      blockerTaskRefs: string[]
    }>
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }
}

export interface AssistantEventPresentationInput {
  kind: 'message' | 'transcript' | 'worktree_prepared' | 'artifact'
  level?: 'info' | 'error'
  role?: string
  content?: string
  summary?: string
  transport?: 'process' | 'codex' | 'claude' | 'opencode'
  entryKind?: 'status' | 'assistant' | 'tool_call' | 'tool_result' | 'error'
  toolName?: string
  toolInvocationKey?: string
  vendorEventType?: string
  path?: string
  branch?: string
  baseBranch?: string
  ref?: string
  label?: string
}

export function formatAssistantActionResultDetails(
  result: AssistantActionResultDetailsInput,
): string[] {
  const lines: string[] = []

  if (result.kind === 'move_task') {
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`)
    }
    if (result.status) {
      lines.push(`Result status: ${result.status}`)
    }
  }
  if (result.kind === 'create_planning_task' && result.taskRef) {
    lines.push(`Task ref: ${result.taskRef}`)
  }
  if (result.kind === 'request_planning') {
    if (result.requestKey) {
      lines.push(`Request key: ${result.requestKey}`)
    }
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`)
    }
  }
  if (result.kind === 'request_planning_batch') {
    if (result.groupKey) {
      lines.push(`Group key: ${result.groupKey}`)
    }
    if (result.requestKeys && result.requestKeys.length > 0) {
      lines.push(`Request keys: ${result.requestKeys.join(', ')}`)
    }
    if (result.taskRefs && result.taskRefs.length > 0) {
      lines.push(`Task refs: ${result.taskRefs.join(', ')}`)
    }
    if (result.blockerTaskRefs && result.blockerTaskRefs.length > 0) {
      lines.push(`Blocker task refs: ${result.blockerTaskRefs.join(', ')}`)
    }
  }
  if (result.kind === 'request_planning_workflows') {
    if (result.workflowKey) {
      lines.push(`Workflow key: ${result.workflowKey}`)
    }
    if (result.groupKeys && result.groupKeys.length > 0) {
      lines.push(`Workflow group keys: ${result.groupKeys.join(', ')}`)
    }
    if (result.workflows && result.workflows.length > 0) {
      lines.push(`Workflow children: ${result.workflows.length}`)
      for (const workflow of result.workflows) {
        lines.push(
          `Workflow child detail: ${summarizeWorkflowResultChild(workflow)} -> requests ${workflow.requestKeys.join(', ')} -> tasks ${workflow.taskRefs.join(', ')} -> blockers ${workflow.blockerTaskRefs.join(', ')}`,
        )
      }
    }
    if (result.requestKeys && result.requestKeys.length > 0) {
      lines.push(`Request keys: ${result.requestKeys.join(', ')}`)
    }
    if (result.taskRefs && result.taskRefs.length > 0) {
      lines.push(`Task refs: ${result.taskRefs.join(', ')}`)
    }
    if (result.blockerTaskRefs && result.blockerTaskRefs.length > 0) {
      lines.push(`Blocker task refs: ${result.blockerTaskRefs.join(', ')}`)
    }
  }
  if (result.kind === 'request_decision' && result.decisionKey) {
    lines.push(`Decision key: ${result.decisionKey}`)
  }
  if (typeof result.created === 'boolean') {
    lines.push(`Created decision topic: ${result.created ? 'yes' : 'no'}`)
  }
  if (result.kind === 'record_answer' || result.kind === 'resolve_decision') {
    if (result.decisionKey) {
      lines.push(`Decision key: ${result.decisionKey}`)
    }
  }
  if (result.kind === 'record_answers' && result.decisionKeys && result.decisionKeys.length > 0) {
    lines.push(`Decision keys: ${result.decisionKeys.join(', ')}`)
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
    if (result.followThrough.workflows && result.followThrough.workflows.length > 0) {
      lines.push(`Follow-through workflow children: ${result.followThrough.workflows.length}`)
      for (const workflow of result.followThrough.workflows) {
        lines.push(
          `Follow-through child detail: ${summarizeWorkflowResultChild(workflow)} -> requests ${workflow.requestKeys.join(', ')} -> tasks ${workflow.taskRefs.join(', ')} -> blockers ${workflow.blockerTaskRefs.join(', ')}`,
        )
      }
    }
    lines.push(`Follow-through requests: ${result.followThrough.requestKeys.join(', ')}`)
    lines.push(`Follow-through tasks: ${result.followThrough.taskRefs.join(', ')}`)
    lines.push(`Follow-through blockers: ${result.followThrough.blockerTaskRefs.join(', ')}`)
  }
  if (result.kind === 'record_preference' || result.kind === 'retire_preference') {
    if (result.preferenceKey) {
      lines.push(`Preference key: ${result.preferenceKey}`)
    }
  }
  if (
    result.kind === 'record_preference' &&
    result.retiredPreferenceKeys &&
    result.retiredPreferenceKeys.length > 0
  ) {
    lines.push(`Retired preference keys: ${result.retiredPreferenceKeys.join(', ')}`)
  }

  return lines
}

function summarizeWorkflowResultChild(workflow: {
  kind: 'planning' | 'planning_batch'
  workflowTaskKey?: string
  groupKey?: string
}) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? 'planning'
  }
  return workflow.groupKey ?? 'planning_batch'
}

export function summarizeAssistantEvent(event: AssistantEventPresentationInput) {
  if (event.kind === 'message') {
    return `${event.role ?? 'assistant'}: ${event.content ?? ''}`.trim()
  }

  if (event.kind === 'transcript') {
    const prefix = event.transport ? `${event.transport} ${event.entryKind ?? 'event'}` : 'event'
    return `${prefix}: ${event.summary ?? ''}`.trim()
  }

  if (event.kind === 'worktree_prepared') {
    return `Worktree prepared: ${event.path ?? ''}`.trim()
  }

  return `${event.label ?? 'artifact'}: ${event.ref ?? ''}`.trim()
}

export function formatAssistantEventDetails(event: AssistantEventPresentationInput): string[] {
  const lines: string[] = []

  if (event.kind === 'message') {
    if (event.level) {
      lines.push(`Message level: ${event.level}`)
    }
    return lines
  }

  if (event.kind === 'transcript') {
    if (event.toolName) {
      lines.push(`Tool name: ${event.toolName}`)
    }
    if (event.toolInvocationKey) {
      lines.push(`Tool invocation key: ${event.toolInvocationKey}`)
    }
    if (event.vendorEventType) {
      lines.push(`Vendor event type: ${event.vendorEventType}`)
    }
    return lines
  }

  if (event.kind === 'worktree_prepared') {
    if (event.branch) {
      lines.push(`Worktree branch: ${event.branch}`)
    }
    if (event.baseBranch) {
      lines.push(`Worktree base branch: ${event.baseBranch}`)
    }
    return lines
  }

  if (event.label) {
    lines.push(`Artifact label: ${event.label}`)
  }
  if (event.ref) {
    lines.push(`Artifact ref: ${event.ref}`)
  }
  return lines
}

export function formatAssistantEventPresentation(event: AssistantEventPresentationInput): {
  body: string
  details: string[]
} {
  return {
    body: summarizeAssistantEvent(event),
    details: formatAssistantEventDetails(event),
  }
}

export function summarizeAssistantAction(action: GoalAssistantAction) {
  if (action.kind === 'move_task') {
    return `Move ${action.taskRef} to ${action.status}.`
  }
  if (action.kind === 'create_planning_task') {
    return `Create planning task: ${action.title}`
  }
  if (action.kind === 'request_planning') {
    return `Request planning: ${action.title}`
  }
  if (action.kind === 'request_planning_batch') {
    return `Request grouped planning: ${action.groupKey}`
  }
  if (action.kind === 'request_planning_workflows') {
    return action.workflowKey
      ? `Update planning workflow ${action.workflowKey}.`
      : `Request ${action.workflows.length} independent planning workflows.`
  }
  if (action.kind === 'request_decision') {
    return `Request decision ${action.decisionKey}.`
  }
  if (action.kind === 'record_answer') {
    if (action.followThrough?.kind === 'planning_batch') {
      return `Record answer with grouped planning follow-through ${action.followThrough.groupKey}.`
    }
    if (action.followThrough?.kind === 'workflow_batch') {
      return `Record answer with ${action.followThrough.workflows.length} planner workflows.`
    }
    if (action.followThrough?.kind === 'planning') {
      return 'Record answer with explicit planning follow-through.'
    }
    return `Record answer for ${action.decisionKey ?? action.summary}.`
  }
  if (action.kind === 'record_answers') {
    if (action.followThrough?.kind === 'planning_batch') {
      return `Record ${action.answers.length} answers with grouped planning follow-through ${action.followThrough.groupKey}.`
    }
    if (action.followThrough?.kind === 'workflow_batch') {
      return `Record ${action.answers.length} answers with ${action.followThrough.workflows.length} planner workflows.`
    }
    if (action.followThrough?.kind === 'planning') {
      return `Record ${action.answers.length} answers with explicit planning follow-through.`
    }
    return `Record ${action.answers.length} durable answers.`
  }
  if (action.kind === 'resolve_decision') {
    if (action.followThrough?.kind === 'planning_batch') {
      return `Resolve decision ${action.decisionKey} with grouped planning follow-through ${action.followThrough.groupKey}.`
    }
    if (action.followThrough?.kind === 'workflow_batch') {
      return `Resolve decision ${action.decisionKey} with ${action.followThrough.workflows.length} planner workflows.`
    }
    if (action.followThrough?.kind === 'planning') {
      return `Resolve decision ${action.decisionKey} with explicit planning follow-through.`
    }
    return `Resolve decision ${action.decisionKey}.`
  }
  if (action.kind === 'record_preference') {
    return `Record durable preference ${action.preferenceKey ?? slugifyPreferenceSummary(action.summary)}: ${action.summary}`
  }
  if (action.kind === 'retire_preference') {
    return `Retire durable preference ${action.preferenceKey}.`
  }
  return 'Update durable preferences.'
}

export function formatAssistantActionDetails(action: GoalAssistantAction): string[] {
  const lines: string[] = []

  if (action.kind === 'move_task') {
    lines.push(`Target task: ${action.taskRef}`)
    lines.push(`Target status: ${action.status}`)
    lines.push(`Move reason: ${action.reason}`)
    return lines
  }
  if (action.kind === 'create_planning_task') {
    lines.push(`Planning title: ${action.title}`)
    if (action.blockedBy.length > 0) {
      lines.push(`Initial blockers: ${action.blockedBy.map((blocker) => blocker.ref).join(', ')}`)
    }
    return lines
  }
  if (action.kind === 'request_planning') {
    lines.push(`Planning title: ${action.title}`)
    if (action.groupKey) {
      lines.push(`Planning group key: ${action.groupKey}`)
    }
    if (action.decisionRefs.length > 0) {
      lines.push(`Linked decisions: ${action.decisionRefs.join(', ')}`)
    }
    if (action.answers.length > 0) {
      lines.push(`Captured planner answers: ${action.answers.length}`)
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    if (action.inferRemainingAnswers) {
      lines.push('Infer remaining answers: yes')
    }
    if (action.requestedUpdates.length > 0) {
      lines.push(`Requested durable updates: ${action.requestedUpdates.join(', ')}`)
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    return lines
  }
  if (action.kind === 'request_planning_batch') {
    lines.push(`Planning group key: ${action.groupKey}`)
    lines.push(`Grouped requests: ${action.requests.length}`)
    if (action.decisionRefs.length > 0) {
      lines.push(`Linked decisions: ${action.decisionRefs.join(', ')}`)
    }
    if (action.answers.length > 0) {
      lines.push(`Shared planner answers: ${action.answers.length}`)
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    if (action.inferRemainingAnswers) {
      lines.push('Infer remaining answers: yes')
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    return lines
  }
  if (action.kind === 'request_planning_workflows') {
    lines.push(`Workflow count: ${action.workflows.length}`)
    if (action.workflowKey) {
      lines.push(`Workflow key: ${action.workflowKey}`)
    }
    if (action.reuseTaskRef) {
      lines.push(`Reuse task ref: ${action.reuseTaskRef}`)
    }
    if (action.reuseGroupKey) {
      lines.push(`Reuse group key: ${action.reuseGroupKey}`)
    }
    if (action.decisionRefs.length > 0) {
      lines.push(`Linked decisions: ${action.decisionRefs.join(', ')}`)
    }
    if (action.answers.length > 0) {
      lines.push(`Shared planner answers: ${action.answers.length}`)
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    for (const workflow of action.workflows) {
      lines.push(formatWorkflowActionChildDetail(workflow))
    }
    if (action.inferRemainingAnswers) {
      lines.push('Infer remaining answers: yes')
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    return lines
  }
  if (action.kind === 'request_decision') {
    lines.push(`Decision key: ${action.decisionKey}`)
    if (action.summaryKey) {
      lines.push(`Summary key: ${action.summaryKey}`)
    }
    if (action.prompt) {
      lines.push(`Decision prompt: ${action.prompt}`)
    }
    if (action.matchHints.length > 0) {
      lines.push(`Match hints: ${action.matchHints.join(', ')}`)
    }
    if (action.taskRef) {
      lines.push(`Linked task: ${action.taskRef}`)
    }
    return lines
  }
  if (action.kind === 'record_answer') {
    if (action.decisionKey) {
      lines.push(`Decision key: ${action.decisionKey}`)
    }
    if (action.summaryKey) {
      lines.push(`Summary key: ${action.summaryKey}`)
    }
    if (action.prompt) {
      lines.push(`Decision prompt: ${action.prompt}`)
    }
    if (action.matchHints.length > 0) {
      lines.push(`Match hints: ${action.matchHints.join(', ')}`)
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    if (action.followThrough) {
      appendFollowThroughDetails(lines, action.followThrough)
    }
    return lines
  }
  if (action.kind === 'record_answers') {
    lines.push(`Explicit answers: ${action.answers.length}`)
    if (action.inferOpenDecisions) {
      lines.push('Infer open decisions: yes')
    }
    if (action.inferDecisionTopics) {
      lines.push('Infer decision topics: yes')
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    if (action.followThrough) {
      appendFollowThroughDetails(lines, action.followThrough)
    }
    return lines
  }
  if (action.kind === 'resolve_decision') {
    lines.push(`Decision key: ${action.decisionKey}`)
    if (action.summaryKey) {
      lines.push(`Summary key: ${action.summaryKey}`)
    }
    if (action.prompt) {
      lines.push(`Decision prompt: ${action.prompt}`)
    }
    if (action.matchHints.length > 0) {
      lines.push(`Match hints: ${action.matchHints.join(', ')}`)
    }
    if (action.answerSources.length > 0) {
      lines.push(`Reusable answer sources: ${action.answerSources.length}`)
    }
    if (action.sourceResponseFormat) {
      lines.push(`Action source-response format: ${action.sourceResponseFormat}`)
    }
    if (action.followThrough) {
      appendFollowThroughDetails(lines, action.followThrough)
    }
    return lines
  }
  if (action.kind === 'record_preference') {
    lines.push(`Preference key: ${action.preferenceKey ?? '(generated)'}`)
    if (action.supersedes.length > 0) {
      lines.push(`Supersedes: ${action.supersedes.join(', ')}`)
    }
    if (action.rationale) {
      lines.push('Rationale captured: yes')
    }
    return lines
  }
  if (action.kind === 'retire_preference') {
    lines.push(`Preference key: ${action.preferenceKey}`)
    if (action.supersededBy) {
      lines.push(`Superseded by: ${action.supersededBy}`)
    }
    lines.push(`Retirement reason: ${action.reason}`)
    return lines
  }
  if (action.kind === 'update_preference') {
    lines.push('Preference document replaced: yes')
    return lines
  }

  return lines
}

export function formatAssistantActionPresentation(
  action: GoalAssistantAction,
  summary = summarizeAssistantAction(action),
): {
  body: string
  details: string[]
} {
  return {
    body: `${action.kind} | ${summary}`,
    details: formatAssistantActionDetails(action),
  }
}

function appendFollowThroughDetails(
  lines: string[],
  followThrough: Extract<
    GoalAssistantAction,
    { kind: 'record_answer' | 'record_answers' | 'resolve_decision' }
  >['followThrough'],
) {
  if (!followThrough) {
    return
  }

  lines.push(`Follow-through kind: ${followThrough.kind}`)
  if (followThrough.kind === 'workflow_batch') {
    if (followThrough.workflowKey) {
      lines.push(`Follow-through workflow key: ${followThrough.workflowKey}`)
    }
    if (followThrough.reuseTaskRef) {
      lines.push(`Follow-through reusable task ref: ${followThrough.reuseTaskRef}`)
    }
    if (followThrough.reuseGroupKey) {
      lines.push(`Follow-through reusable group key: ${followThrough.reuseGroupKey}`)
    }
    for (const workflow of followThrough.workflows) {
      lines.push(formatFollowThroughWorkflowChildDetail(workflow))
    }
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.kind === 'planning_batch') {
    lines.push(`Follow-through group key: ${followThrough.groupKey}`)
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.answers.length > 0) {
    lines.push(`Follow-through captured planner answers: ${followThrough.answers.length}`)
  }
  if (followThrough.inferRemainingAnswers) {
    lines.push('Follow-through infers remaining answers: yes')
  }
}

function formatWorkflowActionChildDetail(
  workflow: Extract<
    GoalAssistantAction,
    { kind: 'request_planning_workflows' }
  >['workflows'][number],
) {
  if (workflow.kind === 'planning') {
    return `Workflow child: ${workflow.workflowTaskKey ?? 'planning'} -> updates ${workflow.requestedUpdates.join(', ')}`
  }

  return `Workflow child: ${workflow.groupKey} -> requests ${workflow.requests.map((request) => request.taskKey).join(', ')}`
}

function formatFollowThroughWorkflowChildDetail(
  workflow: Extract<
    NonNullable<
      Extract<
        GoalAssistantAction,
        { kind: 'record_answer' | 'record_answers' | 'resolve_decision' }
      >['followThrough']
    >,
    { kind: 'workflow_batch' }
  >['workflows'][number],
) {
  if (workflow.kind === 'planning') {
    return `Follow-through workflow child: ${workflow.workflowTaskKey ?? 'planning'} -> updates ${workflow.requestedUpdates.join(', ')}`
  }

  return `Follow-through workflow child: ${workflow.groupKey} -> requests ${workflow.requests.map((request) => request.taskKey).join(', ')}`
}

export function formatAssistantThreadEntryPresentation(entry: AssistantThreadEntry): {
  body: string
  details: string[]
} {
  if (entry.kind === 'user_message' || entry.kind === 'assistant_message') {
    return {
      body: entry.content,
      details: [],
    }
  }

  if (entry.kind === 'action_result') {
    return {
      body: `${entry.actionType ?? 'action'} | ${entry.summary ?? ''}`,
      details: entry.result ? formatAssistantActionResultDetails(entry.result) : [],
    }
  }

  if (entry.kind === 'action') {
    return entry.action
      ? formatAssistantActionPresentation(entry.action, entry.summary)
      : {
          body: `${entry.actionType} | ${entry.summary}`,
          details: [],
        }
  }

  return {
    body: '',
    details: [],
  }
}

function slugifyPreferenceSummary(summary: string) {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'preference'
}

export function renderRecentAssistantThreadMarkdown(entries: AssistantThreadEntry[]) {
  if (entries.length === 0) {
    return '## Recent Assistant Thread\n\n- No assistant thread entries recorded yet.\n'
  }

  return `## Recent Assistant Thread

${entries
  .map((entry) => {
    const { body, details } = formatAssistantThreadEntryPresentation(entry)
    const base = `- ${entry.createdAt} | ${entry.kind} | ${body}`
    if (details.length === 0) {
      return base
    }
    return `${base}\n${details.map((detail) => `  ${detail}`).join('\n')}`
  })
  .join('\n')}
`
}
