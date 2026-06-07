import type { AssistantThreadEntry } from '../runtime/assistantThreadStore'
import type { GoalAssistantAction } from './assistantRun'

interface AssistantActionResultDecisionInput {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: string
  status: string
  taskRef?: string
  answer?: string
  createdAt?: string
  resolvedAt?: string
}

interface AssistantActionResultPlanningAnswerInput {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: string
  answer: string
}

interface AssistantActionResultPlanningRequestInput {
  requestKey: string
  workflowKey?: string
  workflowTaskKey?: string
  workflowSharedDecisionRefs?: string[]
  workflowSharedAnswers?: AssistantActionResultPlanningAnswerInput[]
  blockedByWorkflowKeys: string[]
  groupKey?: string
  groupTaskKey?: string
  title: string
  description: string
  acceptanceCriteria: string[]
  taskRef: string
  decisionRefs: string[]
  answers: AssistantActionResultPlanningAnswerInput[]
  requestedUpdates: string[]
  status: string
  createdAt?: string
  resolvedAt?: string
  resolution?: string
}

interface AssistantActionResultTaskInput {
  ref: string
  kind: string
  status: string
  title: string
  description: string
  acceptanceCriteria: string[]
  blockedBy: Array<{ kind: string; ref: string }>
}

interface AssistantActionResultPreferenceInput {
  preferenceKey: string
  status: string
  summary: string
  rationale?: string
  retiredReason?: string
  supersededBy?: string
}

export interface AssistantActionResultDetailsInput {
  kind?: string
  taskRef?: string
  task?: AssistantActionResultTaskInput
  taskCreated?: boolean
  requestKey?: string
  request?: AssistantActionResultPlanningRequestInput
  taskRefs?: string[]
  requestKeys?: string[]
  requests?: AssistantActionResultPlanningRequestInput[]
  createdRequestKeys?: string[]
  createdTaskRefs?: string[]
  groupKeys?: string[]
  workflowKey?: string
  workflows?: Array<{
    kind: 'planning' | 'planning_batch'
    workflowTaskKey?: string
    groupKey?: string
    requests?: AssistantActionResultPlanningRequestInput[]
    requestKeys: string[]
    taskRefs: string[]
    blockerTaskRefs: string[]
  }>
  blockerTaskRefs?: string[]
  groupKey?: string
  status?: string
  decisionKey?: string
  decisionKeys?: string[]
  decisionStatus?: string
  preferenceKey?: string
  preferenceSummary?: string
  rationale?: string
  reason?: string
  supersededBy?: string
  content?: string
  preference?: AssistantActionResultPreferenceInput
  retiredPreferences?: AssistantActionResultPreferenceInput[]
  preferences?: AssistantActionResultPreferenceInput[]
  retiredPreferenceKeys?: string[]
  summary?: string
  created?: boolean
  previousStatus?: string
  createdDecisionKeys?: string[]
  blockerAdded?: boolean
  blockerRemoved?: boolean
  decision?: AssistantActionResultDecisionInput
  decisions?: AssistantActionResultDecisionInput[]
  resolvedSourceResponseFormat?: string
  followThrough?: {
    kind: 'planning' | 'planning_batch' | 'workflow_batch'
    workflowKey?: string
    groupKey?: string
    groupKeys?: string[]
    requests?: AssistantActionResultPlanningRequestInput[]
    workflows?: Array<{
      kind: 'planning' | 'planning_batch'
      workflowTaskKey?: string
      groupKey?: string
      requests?: AssistantActionResultPlanningRequestInput[]
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
    if (result.previousStatus) {
      lines.push(`Previous status: ${result.previousStatus}`)
    }
    if (result.task) {
      appendAssistantResultTaskDetails(lines, 'Task detail', result.task)
    }
  }
  if (result.kind === 'create_planning_task') {
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`)
    }
    if (result.task) {
      appendAssistantResultTaskDetails(lines, 'Task detail', result.task)
    }
  }
  if (result.kind === 'request_planning') {
    if (result.requestKey) {
      lines.push(`Request key: ${result.requestKey}`)
    }
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`)
    }
    if (typeof result.created === 'boolean') {
      lines.push(`Created planning request: ${result.created ? 'yes' : 'no'}`)
    }
    if (typeof result.taskCreated === 'boolean') {
      lines.push(`Created planning task: ${result.taskCreated ? 'yes' : 'no'}`)
    }
    if (result.request) {
      appendAssistantResultPlanningRequestDetails(lines, 'Request detail', result.request)
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
    if (result.createdRequestKeys) {
      lines.push(
        `Created request keys: ${
          result.createdRequestKeys.length > 0 ? result.createdRequestKeys.join(', ') : 'none'
        }`,
      )
    }
    if (result.createdTaskRefs) {
      lines.push(
        `Created task refs: ${
          result.createdTaskRefs.length > 0 ? result.createdTaskRefs.join(', ') : 'none'
        }`,
      )
    }
    if (result.requests && result.requests.length > 0) {
      for (const request of result.requests) {
        appendAssistantResultPlanningRequestDetails(lines, 'Request detail', request)
      }
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
        if (workflow.requests && workflow.requests.length > 0) {
          for (const request of workflow.requests) {
            appendAssistantResultPlanningRequestDetails(
              lines,
              `Workflow child request detail: ${summarizeWorkflowResultChild(workflow)}`,
              request,
            )
          }
        }
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
    if (result.createdRequestKeys) {
      lines.push(
        `Created request keys: ${
          result.createdRequestKeys.length > 0 ? result.createdRequestKeys.join(', ') : 'none'
        }`,
      )
    }
    if (result.createdTaskRefs) {
      lines.push(
        `Created task refs: ${
          result.createdTaskRefs.length > 0 ? result.createdTaskRefs.join(', ') : 'none'
        }`,
      )
    }
    if (
      (!result.workflows || result.workflows.length === 0) &&
      result.requests &&
      result.requests.length > 0
    ) {
      for (const request of result.requests) {
        appendAssistantResultPlanningRequestDetails(lines, 'Request detail', request)
      }
    }
  }
  if (result.kind === 'request_decision' && result.decisionKey) {
    lines.push(`Decision key: ${result.decisionKey}`)
    lines.push(`Created decision topic: ${result.created ? 'yes' : 'no'}`)
  }
  if (typeof result.blockerAdded === 'boolean') {
    lines.push(`Decision blocker added: ${result.blockerAdded ? 'yes' : 'no'}`)
  }
  if (result.decisionStatus) {
    lines.push(`Decision status: ${result.decisionStatus}`)
  }
  if (result.kind === 'record_answer' || result.kind === 'resolve_decision') {
    if (result.decisionKey) {
      lines.push(`Decision key: ${result.decisionKey}`)
    }
  }
  if (result.kind === 'record_answers' && result.decisionKeys && result.decisionKeys.length > 0) {
    lines.push(`Decision keys: ${result.decisionKeys.join(', ')}`)
  }
  if (result.decision) {
    appendAssistantResultDecisionDetails(lines, result.decision)
  }
  if (result.decisions && result.decisions.length > 0) {
    for (const decision of result.decisions) {
      appendAssistantResultDecisionDetails(lines, decision)
    }
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
        if (workflow.requests && workflow.requests.length > 0) {
          for (const request of workflow.requests) {
            appendAssistantResultPlanningRequestDetails(
              lines,
              `Follow-through child request detail: ${summarizeWorkflowResultChild(workflow)}`,
              request,
            )
          }
        }
      }
    }
    lines.push(`Follow-through requests: ${result.followThrough.requestKeys.join(', ')}`)
    lines.push(`Follow-through tasks: ${result.followThrough.taskRefs.join(', ')}`)
    lines.push(`Follow-through blockers: ${result.followThrough.blockerTaskRefs.join(', ')}`)
    if (
      (!result.followThrough.workflows || result.followThrough.workflows.length === 0) &&
      result.followThrough.requests &&
      result.followThrough.requests.length > 0
    ) {
      for (const request of result.followThrough.requests) {
        appendAssistantResultPlanningRequestDetails(
          lines,
          'Follow-through request detail',
          request,
        )
      }
    }
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
  if (result.kind === 'record_preference') {
    if (result.preference) {
      lines.push(`Preference detail: ${summarizeAssistantResultPreference(result.preference)}`)
    } else if (result.preferenceSummary) {
      lines.push(`Preference summary: ${result.preferenceSummary}`)
    }
    if (!result.preference && result.rationale) {
      lines.push(`Preference rationale: ${result.rationale}`)
    }
    if (result.retiredPreferences && result.retiredPreferences.length > 0) {
      lines.push(
        `Retired preference detail: ${result.retiredPreferences
          .map((preference) => summarizeAssistantResultPreference(preference))
          .join(' | ')}`,
      )
    }
  }
  if (result.kind === 'retire_preference') {
    if (result.preference) {
      lines.push(`Preference detail: ${summarizeAssistantResultPreference(result.preference)}`)
    } else if (result.supersededBy) {
      lines.push(`Superseded by: ${result.supersededBy}`)
    }
    if (!result.preference && result.reason) {
      lines.push(`Retirement reason: ${result.reason}`)
    }
  }
  if (result.kind === 'update_preference' && result.content) {
    lines.push(`Preference content: ${summarizeInlineAssistantText(result.content)}`)
    if (result.preferences && result.preferences.length > 0) {
      lines.push(`Preference entries: ${result.preferences.length}`)
      lines.push(
        `Preference entry detail: ${result.preferences
          .map((preference) => summarizeAssistantResultPreference(preference))
          .join(' | ')}`,
      )
    }
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

function summarizeAssistantResultDecision(decision: AssistantActionResultDecisionInput) {
  const details = [`${decision.decisionKey} [${decision.status}] ${decision.summary}`]
  if (decision.summaryKey) {
    details.push(`[summaryKey=${decision.summaryKey}]`)
  }
  if (decision.prompt) {
    details.push(`[prompt=${decision.prompt}]`)
  }
  if (decision.matchHints && decision.matchHints.length > 0) {
    details.push(`[matchHints=${decision.matchHints.join(', ')}]`)
  }
  if (decision.taskRef) {
    details.push(`[taskRef=${decision.taskRef}]`)
  }
  if (decision.captureFormat) {
    details.push(`[captureFormat=${decision.captureFormat}]`)
  }
  return `Decision detail: ${details.join(' ')}`
}

function summarizeAssistantResultPlanningRequest(
  label: string,
  request: AssistantActionResultPlanningRequestInput,
) {
  const details = [`${request.requestKey} [${request.status}] ${request.title}`]
  details.push(`[taskRef=${request.taskRef}]`)
  if (request.groupKey) {
    details.push(`[groupKey=${request.groupKey}]`)
  }
  if (request.workflowTaskKey) {
    details.push(`[workflowTaskKey=${request.workflowTaskKey}]`)
  }
  if (request.decisionRefs.length > 0) {
    details.push(`[decisionRefs=${request.decisionRefs.join(', ')}]`)
  }
  if (request.requestedUpdates.length > 0) {
    details.push(`[updates=${request.requestedUpdates.join(', ')}]`)
  }
  if ((request.workflowSharedDecisionRefs?.length ?? 0) > 0) {
    details.push(
      `[workflowSharedDecisionRefs=${request.workflowSharedDecisionRefs?.join(', ')}]`,
    )
  }
  return `${label}: ${details.join(' ')}`
}

function summarizeAssistantResultPlanningAnswer(
  answer: AssistantActionResultPlanningAnswerInput,
) {
  const details = [answer.summary]
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`)
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`)
  }
  if (answer.answerKey) {
    details.push(`[answerKey=${answer.answerKey}]`)
  }
  if (answer.matchHints && answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`)
  }
  if (answer.captureFormat) {
    details.push(`[captureFormat=${answer.captureFormat}]`)
  }
  return `${details.join(' ')}: ${answer.answer}`
}

function summarizeAssistantActionPlanningAnswer(
  answer: Extract<
    GoalAssistantAction,
    { kind: 'request_planning' | 'request_planning_batch' | 'request_planning_workflows' }
  >['answers'][number],
) {
  const details = [answer.summary]
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`)
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`)
  }
  if (answer.answerKey) {
    details.push(`[answerKey=${answer.answerKey}]`)
  }
  if (answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`)
  }
  if (answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`)
  }
  if (answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`)
  }
  if (answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`)
  }
  if (typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`)
  }
  return answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ')
}

type AssistantActionWithReusableAnswerSources = Extract<
  GoalAssistantAction,
  | { kind: 'request_planning' }
  | { kind: 'request_planning_batch' }
  | { kind: 'request_planning_workflows' }
  | { kind: 'record_answer' }
  | { kind: 'record_answers' }
  | { kind: 'resolve_decision' }
>

type AssistantActionReusableAnswerSource =
  AssistantActionWithReusableAnswerSources['answerSources'][number]

type AssistantActionBlocker = Extract<
  GoalAssistantAction,
  { kind: 'create_planning_task' }
>['blockedBy'][number]

interface AssistantGroupedPlanningRequestLike {
  taskKey: string
  title: string
  description: string
  acceptanceCriteria: string[]
  requestedUpdates: string[]
  blockedBy: AssistantActionBlocker[]
  blockedByTaskKeys: string[]
}

function summarizeAssistantActionBlockers(blockers: AssistantActionBlocker[]) {
  return blockers.map((blocker) => `${blocker.kind}:${blocker.ref}`).join(', ')
}

function summarizeAcceptanceCriteria(acceptanceCriteria: string[]) {
  return acceptanceCriteria.join(' | ')
}

function summarizeInlineAssistantText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function formatGroupedPlanningRequestDetailLines(
  prefix: string,
  request: AssistantGroupedPlanningRequestLike,
) {
  return [
    `${prefix}: ${request.taskKey} -> updates ${request.requestedUpdates.join(', ')}`,
    `${prefix} ${request.taskKey} title: ${request.title}`,
    ...(request.description.trim().length > 0
      ? [`${prefix} ${request.taskKey} description: ${request.description}`]
      : []),
    ...(request.acceptanceCriteria.length > 0
      ? [
          `${prefix} ${request.taskKey} acceptance: ${summarizeAcceptanceCriteria(request.acceptanceCriteria)}`,
        ]
      : []),
    ...(request.blockedBy.length > 0
      ? [`${prefix} ${request.taskKey} blockers: ${summarizeAssistantActionBlockers(request.blockedBy)}`]
      : []),
    ...(request.blockedByTaskKeys.length > 0
      ? [`${prefix} ${request.taskKey} depends on: ${request.blockedByTaskKeys.join(', ')}`]
      : []),
  ]
}

function summarizeAssistantActionReusableAnswerSource(
  source: AssistantActionReusableAnswerSource,
) {
  const details = [source.answerSourceKey]
  if (source.sourceGroupKey) {
    details.push(`[sourceGroupKey=${source.sourceGroupKey}]`)
  }
  if (source.route) {
    details.push(`[route=${source.route}]`)
  }
  if (source.decisionKey) {
    details.push(`[decisionKey=${source.decisionKey}]`)
  }
  if (source.answerKey) {
    details.push(`[answerKey=${source.answerKey}]`)
  }
  if (source.summaryKey) {
    details.push(`[summaryKey=${source.summaryKey}]`)
  }
  if (source.summary) {
    details.push(`[summary=${source.summary}]`)
  }
  if (source.prompt) {
    details.push(`[prompt=${source.prompt}]`)
  }
  if (source.matchHints.length > 0) {
    details.push(`[matchHints=${source.matchHints.join(', ')}]`)
  }
  if ('sourceExcerpt' in source) {
    details.push(`[sourceExcerpt=${source.sourceExcerpt}]`)
    if (typeof source.sourceOccurrence === 'number') {
      details.push(`[sourceOccurrence=${source.sourceOccurrence}]`)
    }
  }
  return 'answer' in source ? `${details.join(' ')}: ${source.answer}` : details.join(' ')
}

function appendAssistantActionReusableAnswerSourceDetails(
  lines: string[],
  answerSources: AssistantActionWithReusableAnswerSources['answerSources'],
) {
  if (answerSources.length === 0) {
    return
  }
  lines.push(`Reusable answer sources: ${answerSources.length}`)
  lines.push(
    `Reusable answer source detail: ${answerSources
      .map((source) => summarizeAssistantActionReusableAnswerSource(source))
      .join(' | ')}`,
  )
}

function summarizeAssistantResultTask(task: AssistantActionResultTaskInput) {
  const details = [`${task.ref} [${task.kind}] [${task.status}] ${task.title}`]
  if (task.blockedBy.length > 0) {
    details.push(
      `[blockers=${task.blockedBy.map((blocker) => `${blocker.kind}:${blocker.ref}`).join(', ')}]`,
    )
  }
  return details.join(' ')
}

function appendAssistantResultTaskDetails(
  lines: string[],
  label: string,
  task: AssistantActionResultTaskInput,
) {
  lines.push(`${label}: ${summarizeAssistantResultTask(task)}`)
  if (task.description.trim().length > 0) {
    lines.push(`Task description ${task.ref}: ${task.description}`)
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push(`Task acceptance ${task.ref}: ${summarizeAcceptanceCriteria(task.acceptanceCriteria)}`)
  }
}

function summarizeAssistantResultPreference(preference: AssistantActionResultPreferenceInput) {
  const details = [`${preference.preferenceKey} [${preference.status}] ${preference.summary}`]
  if (preference.rationale) {
    details.push(`[rationale=${preference.rationale}]`)
  }
  if (preference.retiredReason) {
    details.push(`[retiredReason=${preference.retiredReason}]`)
  }
  if (preference.supersededBy) {
    details.push(`[supersededBy=${preference.supersededBy}]`)
  }
  return details.join(' ')
}

function appendAssistantResultDecisionDetails(
  lines: string[],
  decision: AssistantActionResultDecisionInput,
) {
  lines.push(summarizeAssistantResultDecision(decision))
  if (decision.answer) {
    lines.push(`Decision answer: ${decision.answer}`)
  }
  if (decision.resolvedAt) {
    lines.push(`Decision resolved at ${decision.decisionKey}: ${decision.resolvedAt}`)
  }
}

interface AssistantActionDecisionAnswerLike {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints: string[]
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

function summarizeAssistantActionDecisionAnswer(answer: AssistantActionDecisionAnswerLike) {
  const details = [answer.summary]
  if (answer.decisionKey) {
    details.push(`[decisionKey=${answer.decisionKey}]`)
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`)
  }
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`)
  }
  if (answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`)
  }
  if (answer.taskRef) {
    details.push(`[taskRef=${answer.taskRef}]`)
  }
  if (answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`)
  }
  if (answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`)
  }
  if (answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`)
  }
  if (typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`)
  }
  return answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ')
}

function hasAssistantActionDirectDecisionAnswerDetail(answer: AssistantActionDecisionAnswerLike) {
  return Boolean(
    answer.answer ??
      answer.sourceExcerpt ??
      answer.answerSourceKey ??
      answer.answerSourceGroupKey ??
      (typeof answer.sourceOccurrence === 'number' ? String(answer.sourceOccurrence) : undefined),
  )
}

function appendAssistantResultPlanningRequestDetails(
  lines: string[],
  label: string,
  request: AssistantActionResultPlanningRequestInput,
) {
  lines.push(summarizeAssistantResultPlanningRequest(label, request))
  if (request.description.trim().length > 0) {
    lines.push(`Request description ${request.requestKey}: ${request.description}`)
  }
  if (request.acceptanceCriteria.length > 0) {
    lines.push(
      `Request acceptance ${request.requestKey}: ${summarizeAcceptanceCriteria(request.acceptanceCriteria)}`,
    )
  }
  if (request.resolvedAt) {
    lines.push(`Request resolved at ${request.requestKey}: ${request.resolvedAt}`)
  }
  if (request.resolution) {
    lines.push(`Request resolution ${request.requestKey}: ${request.resolution}`)
  }
  if (request.answers.length > 0) {
    lines.push(
      `Request answer detail ${request.requestKey}: ${request.answers
        .map((answer) => summarizeAssistantResultPlanningAnswer(answer))
        .join(' | ')}`,
    )
  }
  if ((request.workflowSharedAnswers?.length ?? 0) > 0) {
    lines.push(
      `Workflow-shared answer detail ${request.requestKey}: ${request.workflowSharedAnswers
        ?.map((answer) => summarizeAssistantResultPlanningAnswer(answer))
        .join(' | ')}`,
    )
  }
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
    if (action.description.trim().length > 0) {
      lines.push(`Planning description: ${action.description}`)
    }
    if (action.acceptanceCriteria.length > 0) {
      lines.push(`Planning acceptance: ${summarizeAcceptanceCriteria(action.acceptanceCriteria)}`)
    }
    if (action.blockedBy.length > 0) {
      lines.push(`Initial blockers: ${summarizeAssistantActionBlockers(action.blockedBy)}`)
    }
    return lines
  }
  if (action.kind === 'request_planning') {
    lines.push(`Planning title: ${action.title}`)
    if (action.description.trim().length > 0) {
      lines.push(`Planning description: ${action.description}`)
    }
    if (action.acceptanceCriteria.length > 0) {
      lines.push(`Planning acceptance: ${summarizeAcceptanceCriteria(action.acceptanceCriteria)}`)
    }
    if (action.groupKey) {
      lines.push(`Planning group key: ${action.groupKey}`)
    }
    if (action.decisionRefs.length > 0) {
      lines.push(`Linked decisions: ${action.decisionRefs.join(', ')}`)
    }
    if (action.answers.length > 0) {
      lines.push(`Captured planner answers: ${action.answers.length}`)
      lines.push(
        `Planner answer detail: ${action.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (action.blockedBy.length > 0) {
      lines.push(`Planning blockers: ${summarizeAssistantActionBlockers(action.blockedBy)}`)
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
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
      lines.push(
        `Shared planner answer detail: ${action.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
    for (const request of action.requests) {
      lines.push(...formatGroupedPlanningRequestDetails(request))
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
      lines.push(
        `Shared planner answer detail: ${action.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
    for (const workflow of action.workflows) {
      lines.push(...formatWorkflowActionChildDetails(workflow))
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
    if (
      hasAssistantActionDirectDecisionAnswerDetail({
        summary: action.summary,
        summaryKey: action.summaryKey,
        prompt: action.prompt,
        matchHints: action.matchHints,
        decisionKey: action.decisionKey,
        taskRef: action.taskRef,
        answer: action.answer,
        sourceExcerpt: action.sourceExcerpt,
        sourceOccurrence: action.sourceOccurrence,
        answerSourceKey: action.answerSourceKey,
        answerSourceGroupKey: action.answerSourceGroupKey,
      })
    ) {
      lines.push(
        `Decision answer detail: ${summarizeAssistantActionDecisionAnswer({
          summary: action.summary,
          summaryKey: action.summaryKey,
          prompt: action.prompt,
          matchHints: action.matchHints,
          decisionKey: action.decisionKey,
          taskRef: action.taskRef,
          answer: action.answer,
          sourceExcerpt: action.sourceExcerpt,
          sourceOccurrence: action.sourceOccurrence,
          answerSourceKey: action.answerSourceKey,
          answerSourceGroupKey: action.answerSourceGroupKey,
        })}`,
      )
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
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
    if (action.answers.length > 0) {
      lines.push(
        `Explicit answer detail: ${action.answers
          .map((answer) => summarizeAssistantActionDecisionAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (action.inferOpenDecisions) {
      lines.push('Infer open decisions: yes')
    }
    if (action.inferDecisionTopics) {
      lines.push('Infer decision topics: yes')
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
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
    if (
      hasAssistantActionDirectDecisionAnswerDetail({
        summary: action.summary ?? action.decisionKey,
        summaryKey: action.summaryKey,
        prompt: action.prompt,
        matchHints: action.matchHints,
        decisionKey: action.decisionKey,
        taskRef: action.taskRef,
        answer: action.answer,
        sourceExcerpt: action.sourceExcerpt,
        sourceOccurrence: action.sourceOccurrence,
        answerSourceKey: action.answerSourceKey,
        answerSourceGroupKey: action.answerSourceGroupKey,
      })
    ) {
      lines.push(
        `Decision answer detail: ${summarizeAssistantActionDecisionAnswer({
          summary: action.summary ?? action.decisionKey,
          summaryKey: action.summaryKey,
          prompt: action.prompt,
          matchHints: action.matchHints,
          decisionKey: action.decisionKey,
          taskRef: action.taskRef,
          answer: action.answer,
          sourceExcerpt: action.sourceExcerpt,
          sourceOccurrence: action.sourceOccurrence,
          answerSourceKey: action.answerSourceKey,
          answerSourceGroupKey: action.answerSourceGroupKey,
        })}`,
      )
    }
    appendAssistantActionReusableAnswerSourceDetails(lines, action.answerSources)
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
      lines.push(`Preference rationale: ${action.rationale}`)
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
    lines.push(`Preference content: ${summarizeInlineAssistantText(action.content)}`)
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
      lines.push(...formatFollowThroughWorkflowChildDetails(workflow))
    }
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
      lines.push(
        `Follow-through shared planner answer detail: ${followThrough.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.kind === 'planning_batch') {
    lines.push(`Follow-through group key: ${followThrough.groupKey}`)
    for (const request of followThrough.requests) {
      lines.push(...formatFollowThroughGroupedPlanningRequestDetails(request))
    }
    if (followThrough.answers.length > 0) {
      lines.push(`Follow-through shared planner answers: ${followThrough.answers.length}`)
      lines.push(
        `Follow-through shared planner answer detail: ${followThrough.answers
          .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
          .join(' | ')}`,
      )
    }
    if (followThrough.inferRemainingAnswers) {
      lines.push('Follow-through infers remaining answers: yes')
    }
    return
  }

  if (followThrough.answers.length > 0) {
    lines.push(`Follow-through captured planner answers: ${followThrough.answers.length}`)
    lines.push(
      `Follow-through captured planner answer detail: ${followThrough.answers
        .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
        .join(' | ')}`,
    )
  }
  if (followThrough.inferRemainingAnswers) {
    lines.push('Follow-through infers remaining answers: yes')
  }
}

function formatWorkflowActionChildDetails(
  workflow: Extract<
    GoalAssistantAction,
    { kind: 'request_planning_workflows' }
  >['workflows'][number],
) {
  const childKey = summarizeWorkflowActionChild(workflow)
  if (workflow.kind === 'planning') {
    return [
      `Workflow child: ${childKey} -> updates ${workflow.requestedUpdates.join(', ')}`,
      `Workflow child ${childKey} title: ${workflow.title}`,
      ...(workflow.description.trim().length > 0
        ? [`Workflow child ${childKey} description: ${workflow.description}`]
        : []),
      ...(workflow.acceptanceCriteria.length > 0
        ? [
            `Workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(workflow.acceptanceCriteria)}`,
          ]
        : []),
      ...(workflow.blockedBy.length > 0
        ? [
            `Workflow child ${childKey} blockers: ${summarizeAssistantActionBlockers(workflow.blockedBy)}`,
          ]
        : []),
      ...(workflow.blockedByWorkflowKeys.length > 0
        ? [`Workflow child ${childKey} depends on: ${workflow.blockedByWorkflowKeys.join(', ')}`]
        : []),
      ...(workflow.decisionRefs.length > 0
        ? [`Workflow child ${childKey} decisions: ${workflow.decisionRefs.join(', ')}`]
        : []),
      ...(workflow.answers.length > 0
        ? [
            `Workflow child ${childKey} planner answers: ${workflow.answers.length}`,
            `Workflow child ${childKey} planner answer detail: ${workflow.answers
              .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
              .join(' | ')}`,
          ]
        : []),
    ]
  }

  return [
    `Workflow child: ${childKey} -> requests ${workflow.requests.map((request) => request.taskKey).join(', ')}`,
    ...workflow.requests.flatMap((request) =>
      formatGroupedPlanningRequestDetailLines(`Workflow child ${childKey} grouped request`, request),
    ),
    ...(workflow.blockedByWorkflowKeys.length > 0
      ? [`Workflow child ${childKey} depends on: ${workflow.blockedByWorkflowKeys.join(', ')}`]
      : []),
    ...(workflow.decisionRefs.length > 0
      ? [`Workflow child ${childKey} decisions: ${workflow.decisionRefs.join(', ')}`]
      : []),
    ...(workflow.answers.length > 0
      ? [
          `Workflow child ${childKey} planner answers: ${workflow.answers.length}`,
          `Workflow child ${childKey} planner answer detail: ${workflow.answers
            .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
            .join(' | ')}`,
        ]
      : []),
  ]
}

function formatFollowThroughWorkflowChildDetails(
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
  const childKey = summarizeWorkflowFollowThroughChild(workflow)
  if (workflow.kind === 'planning') {
    return [
      `Follow-through workflow child: ${childKey} -> updates ${workflow.requestedUpdates.join(', ')}`,
      `Follow-through workflow child ${childKey} title: ${workflow.title}`,
      ...(workflow.description.trim().length > 0
        ? [`Follow-through workflow child ${childKey} description: ${workflow.description}`]
        : []),
      ...(workflow.acceptanceCriteria.length > 0
        ? [
            `Follow-through workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(workflow.acceptanceCriteria)}`,
          ]
        : []),
      ...(workflow.blockedByWorkflowKeys.length > 0
        ? [
            `Follow-through workflow child ${childKey} depends on: ${workflow.blockedByWorkflowKeys.join(', ')}`,
          ]
        : []),
      ...(workflow.answers.length > 0
        ? [
            `Follow-through workflow child ${childKey} planner answers: ${workflow.answers.length}`,
            `Follow-through workflow child ${childKey} planner answer detail: ${workflow.answers
              .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
              .join(' | ')}`,
          ]
        : []),
    ]
  }

  return [
    `Follow-through workflow child: ${childKey} -> requests ${workflow.requests.map((request) => request.taskKey).join(', ')}`,
    ...workflow.requests.flatMap((request) =>
      formatGroupedPlanningRequestDetailLines(
        `Follow-through workflow child ${childKey} grouped request`,
        request,
      ),
    ),
    ...(workflow.blockedByWorkflowKeys.length > 0
      ? [
          `Follow-through workflow child ${childKey} depends on: ${workflow.blockedByWorkflowKeys.join(', ')}`,
        ]
      : []),
    ...(workflow.answers.length > 0
      ? [
          `Follow-through workflow child ${childKey} planner answers: ${workflow.answers.length}`,
          `Follow-through workflow child ${childKey} planner answer detail: ${workflow.answers
            .map((answer) => summarizeAssistantActionPlanningAnswer(answer))
            .join(' | ')}`,
        ]
      : []),
  ]
}

function summarizeWorkflowActionChild(
  workflow: Extract<
    GoalAssistantAction,
    { kind: 'request_planning_workflows' }
  >['workflows'][number],
) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? 'planning'
  }

  return workflow.groupKey
}

function summarizeWorkflowFollowThroughChild(
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
    return workflow.workflowTaskKey ?? 'planning'
  }

  return workflow.groupKey
}

function formatGroupedPlanningRequestDetails(
  request: Extract<GoalAssistantAction, { kind: 'request_planning_batch' }>['requests'][number],
) {
  return formatGroupedPlanningRequestDetailLines('Grouped request', request)
}

function formatFollowThroughGroupedPlanningRequestDetails(
  request: Extract<
    NonNullable<
      Extract<
        GoalAssistantAction,
        { kind: 'record_answer' | 'record_answers' | 'resolve_decision' }
      >['followThrough']
    >,
    { kind: 'planning_batch' }
  >['requests'][number],
) {
  return formatGroupedPlanningRequestDetailLines('Follow-through grouped request', request)
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
