import {
  appendAssistantActionReusableAnswerSourceDetails,
  appendFollowThroughDetails,
  formatGroupedPlanningRequestDetails,
  formatWorkflowActionChildDetails,
  hasAssistantActionDirectDecisionAnswerDetail,
  summarizeAcceptanceCriteria,
  summarizeAssistantActionBlockers,
  summarizeAssistantActionDecisionAnswer,
  summarizeAssistantActionPlanningAnswer,
  summarizeInlineAssistantText,
} from './assistantActionPresentationSupport'
import { slugifyPreferenceSummary } from './assistantActionSupport'
import type { GoalAssistantAction } from './assistantRun'

export function summarizeAssistantAction(action: GoalAssistantAction) {
  if (action.kind === 'request_planning') {
    if (action.mode === 'batch') {
      return `Request grouped planning: ${action.groupKey}`
    }
    if (action.mode === 'workflow') {
      return action.workflowKey
        ? `Update planning workflow ${action.workflowKey}.`
        : `Request ${action.workflows.length} independent planning workflows.`
    }
    return `Request planning: ${action.title}`
  }
  if (action.kind === 'resolve_decisions') {
    if (action.followThrough?.kind === 'planning_batch') {
      return `Resolve ${action.answers.length} decisions with grouped planning follow-through ${action.followThrough.groupKey}.`
    }
    if (action.followThrough?.kind === 'workflow_batch') {
      return `Resolve ${action.answers.length} decisions with ${action.followThrough.workflows.length} planner workflows.`
    }
    if (action.followThrough?.kind === 'planning') {
      return `Resolve ${action.answers.length} decisions with explicit planning follow-through.`
    }
    return `Resolve ${action.answers.length} durable decisions.`
  }
  if (action.kind === 'set_preference') {
    if (action.mode === 'retire') {
      return `Retire durable preference ${action.preferenceKey}.`
    }
    return `Record durable preference ${action.preferenceKey ?? slugifyPreferenceSummary(action.summary)}: ${action.summary}`
  }
  if (action.kind === 'move_task') {
    return `Move ${action.taskRef} to ${action.status}.`
  }
  if (action.kind === 'retry_task') {
    return `Retry blocked task ${action.taskRef}.`
  }
  if (action.kind === 'create_planning_task') {
    return `Create planning task: ${action.title}`
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

  if (action.kind === 'set_preference') {
    lines.push(`Preference mode: ${action.mode ?? 'upsert'}`)
    lines.push(`Preference key: ${action.preferenceKey ?? '(generated)'}`)
    if (action.mode !== 'retire' && action.summary) {
      lines.push(`Summary: ${action.summary}`)
    }
    if (action.mode !== 'retire' && action.rationale) {
      lines.push(`Preference rationale: ${action.rationale}`)
    }
    if (action.mode !== 'retire' && action.supersedes.length > 0) {
      lines.push(`Supersedes: ${action.supersedes.join(', ')}`)
    }
    if (action.mode === 'retire' && action.reason) {
      lines.push(`Retirement reason: ${action.reason}`)
    }
    if (action.mode === 'retire' && action.supersededBy) {
      lines.push(`Superseded by: ${action.supersededBy}`)
    }
    return lines
  }
  if (action.kind === 'move_task') {
    lines.push(`Target task: ${action.taskRef}`)
    lines.push(`Target status: ${action.status}`)
    lines.push(`Move reason: ${action.reason}`)
    return lines
  }
  if (action.kind === 'retry_task') {
    lines.push(`Target task: ${action.taskRef}`)
    lines.push(`Retry reason: ${action.reason}`)
    if (action.clearBlockers.length > 0) {
      lines.push(`Clear blockers: ${summarizeAssistantActionBlockers(action.clearBlockers)}`)
    } else {
      lines.push('Clear blockers: all retryable blockers on the task')
    }
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
  if (
    action.kind === 'request_planning' &&
    (action.mode === undefined || action.mode === 'single')
  ) {
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
  if (action.kind === 'request_planning' && action.mode === 'batch') {
    lines.push('Planning mode: batch')
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
  if (action.kind === 'request_planning' && action.mode === 'workflow') {
    lines.push('Planning mode: workflow')
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
  if (action.kind === 'resolve_decisions') {
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
