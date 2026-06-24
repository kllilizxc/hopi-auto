import type { AssistantThreadEntry } from '../runtime/assistantThreadStore'
import { formatAssistantActionPresentation } from './assistantActionPresentation'
import {
  summarizeAcceptanceCriteria,
  summarizeInlineAssistantText,
} from './assistantActionPresentationSupport'
export {
  formatAssistantActionDetails,
  formatAssistantActionPresentation,
  summarizeAssistantAction,
} from './assistantActionPresentation'

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
  mode?: string
  taskRef?: string
  clearedBlockers?: Array<{ kind: 'intervention' | 'merge_conflict'; ref: string }>
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

  if (result.kind === 'request_planning') {
    if ('mode' in result && result.mode) {
      lines.push(`Planning mode: ${result.mode}`)
    }
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
    if (result.workflowKey) {
      lines.push(`Workflow key: ${result.workflowKey}`)
    }
    if (result.groupKey) {
      lines.push(`Group key: ${result.groupKey}`)
    }
    if (result.groupKeys && result.groupKeys.length > 0) {
      lines.push(`Workflow group keys: ${result.groupKeys.join(', ')}`)
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
    if (result.request) {
      appendAssistantResultPlanningRequestDetails(lines, 'Request detail', result.request)
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
    if (result.requests && result.requests.length > 0) {
      for (const request of result.requests) {
        appendAssistantResultPlanningRequestDetails(lines, 'Request detail', request)
      }
    }
    if (result.resolvedSourceResponseFormat) {
      lines.push(`Resolved source-response format: ${result.resolvedSourceResponseFormat}`)
    }
    return lines
  }
  if (result.kind === 'resolve_decisions') {
    if (result.decisionKeys && result.decisionKeys.length > 0) {
      lines.push(`Decision keys: ${result.decisionKeys.join(', ')}`)
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
    return lines
  }
  if (result.kind === 'set_preference') {
    if ('mode' in result && result.mode) {
      lines.push(`Preference mode: ${result.mode}`)
    }
    if (result.preferenceKey) {
      lines.push(`Preference key: ${result.preferenceKey}`)
    }
    if (result.preferenceSummary) {
      lines.push(`Preference summary: ${result.preferenceSummary}`)
    }
    if (result.rationale) {
      lines.push(`Preference rationale: ${result.rationale}`)
    }
    if (result.reason) {
      lines.push(`Retirement reason: ${result.reason}`)
    }
    if (result.supersededBy) {
      lines.push(`Superseded by: ${result.supersededBy}`)
    }
    if (result.preference) {
      lines.push(`Preference detail: ${summarizeAssistantResultPreference(result.preference)}`)
    }
    if (result.retiredPreferenceKeys && result.retiredPreferenceKeys.length > 0) {
      lines.push(`Retired preference keys: ${result.retiredPreferenceKeys.join(', ')}`)
    }
    if (result.retiredPreferences && result.retiredPreferences.length > 0) {
      lines.push(
        `Retired preference detail: ${result.retiredPreferences
          .map((preference) => summarizeAssistantResultPreference(preference))
          .join(' | ')}`,
      )
    }
    return lines
  }

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
  if (result.kind === 'retry_task') {
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`)
    }
    if (result.status) {
      lines.push(`Result status: ${result.status}`)
    }
    if (result.clearedBlockers && result.clearedBlockers.length > 0) {
      lines.push(
        `Cleared blockers: ${result.clearedBlockers
          .map((blocker) => `${blocker.kind}:${blocker.ref}`)
          .join(', ')}`,
      )
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
        appendAssistantResultPlanningRequestDetails(lines, 'Follow-through request detail', request)
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
    details.push(`[workflowSharedDecisionRefs=${request.workflowSharedDecisionRefs?.join(', ')}]`)
  }
  return `${label}: ${details.join(' ')}`
}

function summarizeAssistantResultPlanningAnswer(answer: AssistantActionResultPlanningAnswerInput) {
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
    lines.push(
      `Task acceptance ${task.ref}: ${summarizeAcceptanceCriteria(task.acceptanceCriteria)}`,
    )
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

export function formatAssistantThreadEntryPresentation(entry: AssistantThreadEntry): {
  body: string
  details: string[]
} {
  if (entry.kind === 'assistant_message') {
    return {
      body: entry.content,
      details: [],
    }
  }

  if (entry.kind === 'user_message') {
    return {
      body: entry.content,
      details:
        entry.attachments.length > 0
          ? [
              `Attachments: ${entry.attachments.map((attachment) => attachment.assetPath).join(', ')}`,
            ]
          : [],
    }
  }

  if (entry.kind === 'system_message') {
    return {
      body: `${entry.label} | ${entry.content}`,
      details: entry.details,
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
