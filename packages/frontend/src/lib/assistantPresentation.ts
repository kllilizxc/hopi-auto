import type {
  BlockerRef,
  CapturedAnswer,
  GoalAnswerSourceInput,
  GoalAssistantAction,
  GoalAssistantActionBatchRequestInput,
  GoalAssistantDecisionAnswerInput,
  GoalAssistantActionFollowThroughInput,
  GoalAssistantActionResult,
  GoalAssistantActionWorkflowChildInput,
  GoalAssistantPlanningRequestResult,
  GoalAssistantPreferenceResult,
  GoalAssistantWorkflowChildResult,
  GoalDecision,
  AssistantRuntimeEvent,
  InterpretablePlanningAnswerInput,
  TodoTaskItem,
} from './api';

export function formatAssistantActionPayload(action: GoalAssistantAction) {
  const details = formatAssistantActionDetails(action);
  return [summarizeAssistantAction(action), ...details].filter(Boolean).join('\n');
}

export function formatAssistantActionCountSummary(actionCount: number) {
  return `${actionCount} action${actionCount === 1 ? '' : 's'}`;
}

export function summarizeAssistantAction(action: GoalAssistantAction) {
  switch (action.kind) {
    case 'move_task':
      return action.taskRef && action.status ? `Move ${action.taskRef} to ${action.status}.` : 'task state change';
    case 'create_planning_task':
      return action.title ? `Create planning task: ${action.title}` : 'planning task request';
    case 'request_planning':
      return action.title ? `Request planning: ${action.title}` : 'planning request';
    case 'request_planning_batch':
      return action.groupKey ? `Request grouped planning: ${action.groupKey}` : 'planning batch request';
    case 'request_planning_workflows':
      if (action.workflowKey) {
        return `Update planning workflow ${action.workflowKey}.`;
      }
      return `Request ${action.workflows?.length ?? 0} independent planning workflows.`;
    case 'request_decision':
      return action.decisionKey ? `Request decision ${action.decisionKey}.` : 'decision request';
    case 'record_answer':
      if (action.followThrough?.kind === 'planning_batch') {
        return `Record answer with grouped planning follow-through ${action.followThrough.groupKey}.`;
      }
      if (action.followThrough?.kind === 'workflow_batch') {
        return `Record answer with ${action.followThrough.workflows?.length ?? 0} planner workflows.`;
      }
      if (action.followThrough?.kind === 'planning') {
        return 'Record answer with explicit planning follow-through.';
      }
      return `Record answer for ${action.decisionKey ?? action.summary}.`;
    case 'resolve_decision':
      if (action.followThrough?.kind === 'planning_batch') {
        return `Resolve decision ${action.decisionKey} with grouped planning follow-through ${action.followThrough.groupKey}.`;
      }
      if (action.followThrough?.kind === 'workflow_batch') {
        return `Resolve decision ${action.decisionKey} with ${action.followThrough.workflows?.length ?? 0} planner workflows.`;
      }
      if (action.followThrough?.kind === 'planning') {
        return `Resolve decision ${action.decisionKey} with explicit planning follow-through.`;
      }
      return action.decisionKey ? `Resolve decision ${action.decisionKey}.` : 'decision answer';
    case 'record_answers':
      if (action.followThrough?.kind === 'planning_batch') {
        return `Record ${action.answers?.length ?? 0} answers with grouped planning follow-through ${action.followThrough.groupKey}.`;
      }
      if (action.followThrough?.kind === 'workflow_batch') {
        return `Record ${action.answers?.length ?? 0} answers with ${action.followThrough.workflows?.length ?? 0} planner workflows.`;
      }
      if (action.followThrough?.kind === 'planning') {
        return `Record ${action.answers?.length ?? 0} answers with explicit planning follow-through.`;
      }
      return `Record ${action.answers?.length ?? 0} durable answers.`;
    case 'record_preference':
      return `Record durable preference ${action.preferenceKey ?? slugifyPreferenceSummary(action.summary ?? '')}: ${action.summary ?? ''}`;
    case 'retire_preference':
      return action.preferenceKey ? `Retire durable preference ${action.preferenceKey}.` : 'preference update';
    case 'update_preference':
      return 'Update durable preferences.';
    default:
      return [action.kind, action.taskRef, action.title].filter(Boolean).join(' · ');
  }
}

export function formatAssistantActionDetails(action: GoalAssistantAction): string[] {
  const lines: string[] = [];
  const isPlanningTaskAction = action.kind === 'create_planning_task';
  const isPlanningRequestAction = action.kind === 'request_planning';
  const isPlanningBatchAction = action.kind === 'request_planning_batch';
  const isPlanningWorkflowAction = action.kind === 'request_planning_workflows';
  const isDecisionRequestAction = action.kind === 'request_decision';
  const isDirectDecisionAnswerAction =
    action.kind === 'record_answer' || action.kind === 'resolve_decision';
  const isDecisionMultiAnswerAction = action.kind === 'record_answers';
  const isDecisionFamilyAction =
    isDecisionRequestAction || isDirectDecisionAnswerAction || isDecisionMultiAnswerAction;
  const isRootPlanningFamilyAction =
    isPlanningRequestAction || isPlanningBatchAction || isPlanningWorkflowAction;
  const usesActionSourceResponseFormatLabel =
    isRootPlanningFamilyAction || isDirectDecisionAnswerAction || isDecisionMultiAnswerAction;
  const actionAnswerLabel =
    isPlanningRequestAction
      ? 'Captured planner answers'
      : isPlanningBatchAction || isPlanningWorkflowAction
      ? 'Shared planner answers'
      : 'Planner answers';
  const actionDecisionRefLabel =
    isRootPlanningFamilyAction
      ? 'Linked decisions'
      : 'Decision refs';

  if (action.kind === 'move_task') {
    if (action.taskRef) {
      lines.push(`Target task: ${action.taskRef}`);
    }
    if (action.status) {
      lines.push(`Target status: ${action.status}`);
    }
    if (action.reason?.trim()) {
      lines.push(`Move reason: ${action.reason}`);
    }
    return lines;
  }

  if (action.taskRef) {
    lines.push(`${isDecisionRequestAction ? 'Linked task' : 'Task ref'}: ${action.taskRef}`);
  }
  if (action.status) {
    lines.push(`Target status: ${action.status}`);
  }
  if (action.taskKey) {
    lines.push(`Task key: ${action.taskKey}`);
  }
  if (action.requestKey) {
    lines.push(`Request key: ${action.requestKey}`);
  }
  if (action.workflowKey) {
    lines.push(`Workflow key: ${action.workflowKey}`);
  }
  if (action.reuseTaskRef) {
    lines.push(`Reuse task ref: ${action.reuseTaskRef}`);
  }
  if (action.reuseGroupKey) {
    lines.push(`Reuse group key: ${action.reuseGroupKey}`);
  }
  if (action.workflowTaskKey) {
    lines.push(`Workflow task key: ${action.workflowTaskKey}`);
  }
  if (action.groupKey) {
    lines.push(`${isPlanningRequestAction || isPlanningBatchAction ? 'Planning group key' : 'Group key'}: ${action.groupKey}`);
  }
  if (action.decisionKey) {
    lines.push(`Decision key: ${action.decisionKey}`);
  }
  if (action.decisionKeys && action.decisionKeys.length > 0) {
    lines.push(`Decision keys: ${action.decisionKeys.join(', ')}`);
  }
  if (action.preferenceKey) {
    lines.push(`Preference key: ${action.preferenceKey}`);
  }
  if (action.summary) {
    lines.push(`Summary: ${action.summary}`);
  }
  if (action.summaryKey) {
    lines.push(`Summary key: ${action.summaryKey}`);
  }
  if (action.prompt) {
    lines.push(`${isDecisionFamilyAction ? 'Decision prompt' : 'Prompt'}: ${action.prompt}`);
  }
  if (action.matchHints && action.matchHints.length > 0) {
    lines.push(`Match hints: ${action.matchHints.join(', ')}`);
  }
  if (action.title) {
    lines.push(`${isPlanningTaskAction || isPlanningRequestAction ? 'Planning title' : 'Title'}: ${action.title}`);
  }
  if (action.description?.trim()) {
    lines.push(
      `${isPlanningTaskAction || isPlanningRequestAction ? 'Planning description' : 'Description'}: ${action.description}`,
    );
  }
  if (action.acceptanceCriteria && action.acceptanceCriteria.length > 0) {
    lines.push(
      `${isPlanningTaskAction || isPlanningRequestAction ? 'Planning acceptance' : 'Acceptance'}: ${summarizeAcceptanceCriteria(action.acceptanceCriteria)}`,
    );
  }
  if (action.requestedUpdates && action.requestedUpdates.length > 0) {
    lines.push(
      `${isPlanningRequestAction ? 'Requested durable updates' : 'Requested updates'}: ${action.requestedUpdates.join(', ')}`,
    );
  }
  if (action.blockedBy && action.blockedBy.length > 0) {
    lines.push(
      `${
        isPlanningTaskAction
          ? 'Initial blockers'
          : isPlanningRequestAction
            ? 'Planning blockers'
            : 'Blockers'
      }: ${summarizeBlockers(action.blockedBy)}`,
    );
  }
  if (action.blockedByWorkflowKeys && action.blockedByWorkflowKeys.length > 0) {
    lines.push(`Blocked by workflow keys: ${action.blockedByWorkflowKeys.join(', ')}`);
  }
  if (action.decisionRefs && action.decisionRefs.length > 0) {
    lines.push(`${actionDecisionRefLabel}: ${action.decisionRefs.join(', ')}`);
  }
  if (isDecisionMultiAnswerAction) {
    const explicitAnswers = (action.answers ?? []) as GoalAssistantDecisionAnswerInput[];
    lines.push(`Explicit answers: ${explicitAnswers.length}`);
    if (explicitAnswers.length > 0) {
      lines.push(
        `Explicit answer detail: ${explicitAnswers.map((answer) => summarizeDecisionAnswerInput(answer)).join(' | ')}`,
      );
    }
  } else if (action.answers && action.answers.length > 0) {
    const plannerAnswers = action.answers as InterpretablePlanningAnswerInput[];
    lines.push(`${actionAnswerLabel}: ${action.answers.length}`);
    lines.push(
      `${actionAnswerLabel.slice(0, -1)} detail: ${plannerAnswers.map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
    );
  }
  if (isPlanningWorkflowAction && action.workflows && action.workflows.length > 0) {
    lines.push(`Workflow count: ${action.workflows.length}`);
  }
  const directDecisionAnswerDetail = buildDirectDecisionAnswerInput(action);
  if (directDecisionAnswerDetail && hasDecisionAnswerDetail(directDecisionAnswerDetail)) {
    lines.push(`Decision answer detail: ${summarizeDecisionAnswerInput(directDecisionAnswerDetail)}`);
  } else {
    if (action.answer) {
      lines.push(`Answer: ${action.answer}`);
    }
    if (action.sourceExcerpt) {
      lines.push(`Source excerpt: ${action.sourceExcerpt}`);
    }
    if (typeof action.sourceOccurrence === 'number') {
      lines.push(`Source occurrence: ${action.sourceOccurrence}`);
    }
    if (action.answerSourceKey) {
      lines.push(`Answer source key: ${action.answerSourceKey}`);
    }
    if (action.answerSourceGroupKey) {
      lines.push(`Answer source group key: ${action.answerSourceGroupKey}`);
    }
  }
  if (action.answerSources && action.answerSources.length > 0) {
    lines.push(`Reusable answer sources: ${action.answerSources.length}`);
    lines.push(
      `Reusable answer source detail: ${action.answerSources.map((source) => summarizeAnswerSource(source)).join(' | ')}`,
    );
  }
  if (action.sourceResponseFormat) {
    lines.push(
      `${usesActionSourceResponseFormatLabel ? 'Action source-response format' : 'Source-response format'}: ${action.sourceResponseFormat}`,
    );
  }
  if (action.sourceResponse?.trim()) {
    lines.push(`Source response: ${summarizeInlineText(action.sourceResponse)}`);
  }
  if (action.inferOpenDecisions) {
    lines.push('Infer open decisions: yes');
  }
  if (action.inferDecisionTopics) {
    lines.push('Infer decision topics: yes');
  }
  if (action.inferRemainingAnswers) {
    lines.push(
      isRootPlanningFamilyAction
        ? 'Infer remaining answers: yes'
        : 'Infers remaining planner answers: yes',
    );
  }
  if (action.requests && action.requests.length > 0) {
    lines.push(
      `${isPlanningBatchAction ? 'Grouped requests' : 'Grouped planning requests'}: ${action.requests.length}`,
    );
    for (const request of action.requests) {
      lines.push(...formatAssistantActionBatchRequestDetails('Request detail', request));
    }
  }
  if (action.workflows && action.workflows.length > 0) {
    lines.push(`Workflow children: ${action.workflows.length}`);
    for (const workflow of action.workflows) {
      lines.push(...formatAssistantActionWorkflowChildDetails(workflow));
    }
  }
  if (action.followThrough) {
    lines.push(...formatAssistantActionFollowThroughDetails(action.followThrough));
  }
  if (action.content?.trim()) {
    lines.push(`Content: ${summarizeInlineText(action.content)}`);
  }
  if (action.rationale?.trim()) {
    lines.push(`Rationale: ${action.rationale}`);
  }
  if (action.supersedes && action.supersedes.length > 0) {
    lines.push(`Supersedes: ${action.supersedes.join(', ')}`);
  }
  if (action.reason?.trim()) {
    lines.push(`Reason: ${action.reason}`);
  }
  if (action.supersededBy?.trim()) {
    lines.push(`Superseded by: ${action.supersededBy}`);
  }

  return lines;
}

export function formatAssistantActionResultPayload(result: GoalAssistantActionResult) {
  return [result.summary, ...formatAssistantActionResultDetails(result)].filter(Boolean).join('\n');
}

export function formatAssistantActionResultDetails(result: GoalAssistantActionResult): string[] {
  const lines: string[] = [];

  if (result.kind === 'move_task') {
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`);
    }
    if (result.status) {
      lines.push(`Result status: ${result.status}`);
    }
    if (result.previousStatus) {
      lines.push(`Previous status: ${result.previousStatus}`);
    }
    if (result.task) {
      appendAssistantResultTaskDetails(lines, 'Task detail', result.task);
    }
  }
  if (result.kind === 'create_planning_task') {
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`);
    }
    if (result.task) {
      appendAssistantResultTaskDetails(lines, 'Task detail', result.task);
    }
  }
  if (result.kind === 'request_planning') {
    if (result.requestKey) {
      lines.push(`Request key: ${result.requestKey}`);
    }
    if (result.taskRef) {
      lines.push(`Task ref: ${result.taskRef}`);
    }
    if (typeof result.created === 'boolean') {
      lines.push(`Created planning request: ${result.created ? 'yes' : 'no'}`);
    }
    if (typeof result.taskCreated === 'boolean') {
      lines.push(`Created planning task: ${result.taskCreated ? 'yes' : 'no'}`);
    }
    if (result.request) {
      appendAssistantResultPlanningRequestDetails(lines, 'Request detail', result.request);
    }
  }
  if (result.kind === 'request_planning_batch') {
    if (result.groupKey) {
      lines.push(`Group key: ${result.groupKey}`);
    }
    if (result.requestKeys && result.requestKeys.length > 0) {
      lines.push(`Request keys: ${result.requestKeys.join(', ')}`);
    }
    if (result.taskRefs && result.taskRefs.length > 0) {
      lines.push(`Task refs: ${result.taskRefs.join(', ')}`);
    }
    if (result.blockerTaskRefs && result.blockerTaskRefs.length > 0) {
      lines.push(`Blocker task refs: ${result.blockerTaskRefs.join(', ')}`);
    }
    if (result.createdRequestKeys) {
      lines.push(
        `Created request keys: ${result.createdRequestKeys.length > 0 ? result.createdRequestKeys.join(', ') : 'none'}`,
      );
    }
    if (result.createdTaskRefs) {
      lines.push(
        `Created task refs: ${result.createdTaskRefs.length > 0 ? result.createdTaskRefs.join(', ') : 'none'}`,
      );
    }
    const reusedRequestKeys = listReusedResultRefs(
      result.requestKeys ?? [],
      result.createdRequestKeys,
    );
    if (reusedRequestKeys.length > 0) {
      lines.push(`Reused request keys: ${reusedRequestKeys.join(', ')}`);
    }
    const reusedTaskRefs = listReusedResultRefs(result.taskRefs ?? [], result.createdTaskRefs);
    if (reusedTaskRefs.length > 0) {
      lines.push(`Reused task refs: ${reusedTaskRefs.join(', ')}`);
    }
    if (result.requests && result.requests.length > 0) {
      for (const request of result.requests) {
        appendAssistantResultPlanningRequestDetails(lines, 'Request detail', request);
      }
    }
  }
  if (result.kind === 'request_planning_workflows') {
    if (result.workflowKey) {
      lines.push(`Workflow key: ${result.workflowKey}`);
    }
    if (result.groupKeys && result.groupKeys.length > 0) {
      lines.push(`Workflow group keys: ${result.groupKeys.join(', ')}`);
    }
    const workflowRequests = collectAssistantResultPlanningRequests(
      result.requests,
      result.workflows,
    );
    const workflowSharedDecisionRefs = collectUniqueAssistantResultWorkflowSharedDecisionRefs(
      workflowRequests,
    );
    if (workflowSharedDecisionRefs.length > 0) {
      lines.push(`Workflow-shared decision refs: ${workflowSharedDecisionRefs.join(', ')}`);
    }
    const workflowSharedAnswers = collectUniqueAssistantResultWorkflowSharedAnswers(
      workflowRequests,
    );
    if (workflowSharedAnswers.length > 0) {
      lines.push(
        `Workflow-shared answer detail: ${workflowSharedAnswers.map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
      );
    }
    if (result.workflows && result.workflows.length > 0) {
      lines.push(`Workflow children: ${result.workflows.length}`);
      for (const workflow of result.workflows) {
        lines.push(
          `Workflow child detail: ${summarizeWorkflowResultChild(workflow)} -> requests ${workflow.requestKeys.join(', ')} -> tasks ${workflow.taskRefs.join(', ')} -> blockers ${workflow.blockerTaskRefs.join(', ')}`,
        );
        if (workflow.requests && workflow.requests.length > 0) {
          for (const request of workflow.requests) {
            appendAssistantResultPlanningRequestDetails(
              lines,
              `Workflow child request detail: ${summarizeWorkflowResultChild(workflow)}`,
              request,
            );
          }
        }
      }
    }
    if (result.requestKeys && result.requestKeys.length > 0) {
      lines.push(`Request keys: ${result.requestKeys.join(', ')}`);
    }
    if (result.taskRefs && result.taskRefs.length > 0) {
      lines.push(`Task refs: ${result.taskRefs.join(', ')}`);
    }
    if (result.blockerTaskRefs && result.blockerTaskRefs.length > 0) {
      lines.push(`Blocker task refs: ${result.blockerTaskRefs.join(', ')}`);
    }
    if (result.createdRequestKeys) {
      lines.push(
        `Created request keys: ${result.createdRequestKeys.length > 0 ? result.createdRequestKeys.join(', ') : 'none'}`,
      );
    }
    if (result.createdTaskRefs) {
      lines.push(
        `Created task refs: ${result.createdTaskRefs.length > 0 ? result.createdTaskRefs.join(', ') : 'none'}`,
      );
    }
    const reusedRequestKeys = listReusedResultRefs(
      result.requestKeys ?? [],
      result.createdRequestKeys,
    );
    if (reusedRequestKeys.length > 0) {
      lines.push(`Reused request keys: ${reusedRequestKeys.join(', ')}`);
    }
    const reusedTaskRefs = listReusedResultRefs(result.taskRefs ?? [], result.createdTaskRefs);
    if (reusedTaskRefs.length > 0) {
      lines.push(`Reused task refs: ${reusedTaskRefs.join(', ')}`);
    }
    if ((!result.workflows || result.workflows.length === 0) && result.requests && result.requests.length > 0) {
      for (const request of result.requests) {
        appendAssistantResultPlanningRequestDetails(lines, 'Request detail', request);
      }
    }
  }
  if (result.kind === 'request_decision' && result.decisionKey) {
    lines.push(`Decision key: ${result.decisionKey}`);
    lines.push(`Created decision topic: ${result.created ? 'yes' : 'no'}`);
  }
  if (typeof result.blockerAdded === 'boolean') {
    lines.push(`Decision blocker added: ${result.blockerAdded ? 'yes' : 'no'}`);
  }
  if (result.decisionStatus) {
    lines.push(`Decision status: ${result.decisionStatus}`);
  }
  if ((result.kind === 'record_answer' || result.kind === 'resolve_decision') && result.decisionKey) {
    lines.push(`Decision key: ${result.decisionKey}`);
  }
  if (result.kind === 'record_answers' && result.decisionKeys && result.decisionKeys.length > 0) {
    lines.push(`Decision keys: ${result.decisionKeys.join(', ')}`);
  }
  if (result.decision) {
    appendAssistantResultDecisionDetails(lines, result.decision);
  }
  if (result.decisions && result.decisions.length > 0) {
    for (const decision of result.decisions) {
      appendAssistantResultDecisionDetails(lines, decision);
    }
  }
  if (result.createdDecisionKeys && result.createdDecisionKeys.length > 0) {
    lines.push(`Created decision keys: ${result.createdDecisionKeys.join(', ')}`);
  }
  if (typeof result.blockerRemoved === 'boolean') {
    lines.push(`Decision blocker removed: ${result.blockerRemoved ? 'yes' : 'no'}`);
  }
  if (result.resolvedSourceResponseFormat) {
    lines.push(`Resolved source-response format: ${result.resolvedSourceResponseFormat}`);
  }
  if (result.followThrough) {
    lines.push(...formatAssistantResultFollowThroughDetails(result.followThrough));
  }
  if ((result.kind === 'record_preference' || result.kind === 'retire_preference') && result.preferenceKey) {
    lines.push(`Preference key: ${result.preferenceKey}`);
  }
  if (result.kind === 'record_preference' && result.retiredPreferenceKeys && result.retiredPreferenceKeys.length > 0) {
    lines.push(`Retired preference keys: ${result.retiredPreferenceKeys.join(', ')}`);
  }
  if (result.kind === 'record_preference') {
    if (result.preference) {
      lines.push(`Preference detail: ${summarizeAssistantResultPreference(result.preference)}`);
    } else if (result.preferenceSummary) {
      lines.push(`Preference summary: ${result.preferenceSummary}`);
    }
    if (!result.preference && result.rationale) {
      lines.push(`Preference rationale: ${result.rationale}`);
    }
    if (result.retiredPreferences && result.retiredPreferences.length > 0) {
      lines.push(
        `Retired preference detail: ${result.retiredPreferences.map((preference) => summarizeAssistantResultPreference(preference)).join(' | ')}`,
      );
    }
  }
  if (result.kind === 'retire_preference') {
    if (result.preference) {
      lines.push(`Preference detail: ${summarizeAssistantResultPreference(result.preference)}`);
    } else if (result.supersededBy) {
      lines.push(`Superseded by: ${result.supersededBy}`);
    }
    if (!result.preference && result.reason) {
      lines.push(`Retirement reason: ${result.reason}`);
    }
  }
  if (result.kind === 'update_preference' && result.content) {
    lines.push(`Preference content: ${summarizeInlineText(result.content)}`);
    if (result.preferences && result.preferences.length > 0) {
      lines.push(`Preference entries: ${result.preferences.length}`);
      lines.push(
        `Preference entry detail: ${result.preferences.map((preference) => summarizeAssistantResultPreference(preference)).join(' | ')}`,
      );
    }
  }

  return lines;
}

export function summarizeAssistantRuntimeEvent(event: AssistantRuntimeEvent): string {
  switch (event.kind) {
    case 'message':
      return event.content?.trim() || `${event.level ?? 'info'} message`;
    case 'transcript':
      return event.summary?.trim() || `${event.transport ?? 'process'}:${event.entryKind ?? 'status'}`;
    case 'worktree_prepared':
      return event.path ?? 'Worktree prepared';
    case 'artifact':
      return [event.label, event.ref].filter(Boolean).join(' · ') || 'Artifact recorded';
  }
}

export function formatAssistantRuntimeEventDetails(event: AssistantRuntimeEvent): string[] {
  switch (event.kind) {
    case 'message':
      return [
        event.role ? `Role: ${event.role}` : null,
        event.level ? `Level: ${event.level}` : null,
      ].filter((detail): detail is string => Boolean(detail));
    case 'transcript':
      return [
        `Transport: ${event.transport ?? 'process'}`,
        `Entry kind: ${event.entryKind ?? 'status'}`,
        event.toolName ? `Tool: ${event.toolName}` : null,
        event.toolInvocationKey ? `Tool invocation: ${event.toolInvocationKey}` : null,
        event.vendorEventType ? `Vendor event type: ${event.vendorEventType}` : null,
      ].filter((detail): detail is string => Boolean(detail));
    case 'worktree_prepared':
      return [
        event.branch ? `Branch: ${event.branch}` : null,
        event.baseBranch ? `Base branch: ${event.baseBranch}` : null,
      ].filter((detail): detail is string => Boolean(detail));
    case 'artifact':
      return [
        event.label ? `Label: ${event.label}` : null,
        event.ref ? `Ref: ${event.ref}` : null,
      ].filter((detail): detail is string => Boolean(detail));
  }
}

function formatAssistantActionBatchRequestDetails(
  label: string,
  request: GoalAssistantActionBatchRequestInput,
) {
  return [
    `${label}: ${request.taskKey}${request.requestKey ? ` [requestKey=${request.requestKey}]` : ''} -> updates ${(request.requestedUpdates ?? []).join(', ') || 'none'}`,
    `Title ${request.taskKey}: ${request.title}`,
    ...(request.description.trim().length > 0 ? [`Description ${request.taskKey}: ${request.description}`] : []),
    ...(request.acceptanceCriteria.length > 0
      ? [`Acceptance ${request.taskKey}: ${summarizeAcceptanceCriteria(request.acceptanceCriteria)}`]
      : []),
    ...((request.blockedBy?.length ?? 0) > 0 ? [`Blockers ${request.taskKey}: ${summarizeBlockers(request.blockedBy ?? [])}`] : []),
    ...((request.blockedByTaskKeys?.length ?? 0) > 0
      ? [`Depends on ${request.taskKey}: ${(request.blockedByTaskKeys ?? []).join(', ')}`]
      : []),
  ];
}

function formatAssistantActionWorkflowChildDetails(workflow: GoalAssistantActionWorkflowChildInput) {
  const childKey = summarizeWorkflowActionChild(workflow);
  const lines = [
    `Workflow child: ${childKey}`,
    ...((workflow.blockedByWorkflowKeys?.length ?? 0) > 0
      ? [`Workflow child ${childKey} depends on: ${(workflow.blockedByWorkflowKeys ?? []).join(', ')}`]
      : []),
    ...((workflow.decisionRefs?.length ?? 0) > 0
      ? [`Workflow child ${childKey} decisions: ${(workflow.decisionRefs ?? []).join(', ')}`]
      : []),
    ...((workflow.answers?.length ?? 0) > 0
      ? [
          `Workflow child ${childKey} planner answers: ${(workflow.answers ?? []).length}`,
          `Workflow child ${childKey} planner answer detail: ${(workflow.answers ?? []).map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
        ]
      : []),
  ];

  if (workflow.kind === 'planning') {
    return [
      ...lines,
      ...(workflow.requestKey ? [`Workflow child ${childKey} request key: ${workflow.requestKey}`] : []),
      ...(workflow.title ? [`Workflow child ${childKey} title: ${workflow.title}`] : []),
      ...(workflow.description?.trim() ? [`Workflow child ${childKey} description: ${workflow.description}`] : []),
      ...(workflow.acceptanceCriteria?.length
        ? [`Workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(workflow.acceptanceCriteria)}`]
        : []),
      ...((workflow.blockedBy?.length ?? 0)
        ? [`Workflow child ${childKey} blockers: ${summarizeBlockers(workflow.blockedBy ?? [])}`]
        : []),
      ...((workflow.requestedUpdates?.length ?? 0)
        ? [`Workflow child ${childKey} updates: ${(workflow.requestedUpdates ?? []).join(', ')}`]
        : []),
    ];
  }

  return [
    ...lines,
    ...((workflow.requests ?? []).flatMap((request) =>
      formatAssistantActionBatchRequestDetails(`Workflow child ${childKey} request detail`, request),
    )),
  ];
}

function summarizeWorkflowFollowThroughChild(workflow: GoalAssistantActionWorkflowChildInput) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? 'planning';
  }

  return workflow.groupKey ?? 'planning_batch';
}

function formatFollowThroughWorkflowChildDetails(workflow: GoalAssistantActionWorkflowChildInput) {
  const childKey = summarizeWorkflowFollowThroughChild(workflow);

  if (workflow.kind === 'planning') {
    return [
      `Follow-through workflow child: ${childKey} -> updates ${(workflow.requestedUpdates ?? []).join(', ')}`,
      ...(workflow.title ? [`Follow-through workflow child ${childKey} title: ${workflow.title}`] : []),
      ...(workflow.description?.trim()
        ? [`Follow-through workflow child ${childKey} description: ${workflow.description}`]
        : []),
      ...(workflow.acceptanceCriteria?.length
        ? [
            `Follow-through workflow child ${childKey} acceptance: ${summarizeAcceptanceCriteria(workflow.acceptanceCriteria)}`,
          ]
        : []),
      ...((workflow.blockedByWorkflowKeys?.length ?? 0) > 0
        ? [
            `Follow-through workflow child ${childKey} depends on: ${(workflow.blockedByWorkflowKeys ?? []).join(', ')}`,
          ]
        : []),
      ...((workflow.answers?.length ?? 0) > 0
        ? [
            `Follow-through workflow child ${childKey} planner answers: ${(workflow.answers ?? []).length}`,
            `Follow-through workflow child ${childKey} planner answer detail: ${(workflow.answers ?? []).map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
          ]
        : []),
    ];
  }

  return [
    `Follow-through workflow child: ${childKey} -> requests ${(workflow.requests ?? []).map((request) => request.taskKey).join(', ')}`,
    ...((workflow.requests ?? []).flatMap((request) =>
      formatAssistantActionBatchRequestDetails(
        `Follow-through workflow child ${childKey} grouped request`,
        request,
      ),
    )),
    ...((workflow.blockedByWorkflowKeys?.length ?? 0) > 0
      ? [
          `Follow-through workflow child ${childKey} depends on: ${(workflow.blockedByWorkflowKeys ?? []).join(', ')}`,
        ]
      : []),
    ...((workflow.answers?.length ?? 0) > 0
      ? [
          `Follow-through workflow child ${childKey} planner answers: ${(workflow.answers ?? []).length}`,
          `Follow-through workflow child ${childKey} planner answer detail: ${(workflow.answers ?? []).map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
        ]
      : []),
  ];
}

function formatAssistantActionFollowThroughDetails(followThrough: GoalAssistantActionFollowThroughInput) {
  const lines = [`Follow-through kind: ${followThrough.kind}`];
  const sharedFollowThroughAnswers =
    followThrough.kind === 'planning_batch' || followThrough.kind === 'workflow_batch';

  if (followThrough.workflowKey) {
    lines.push(`Follow-through workflow key: ${followThrough.workflowKey}`);
  }
  if (followThrough.reuseTaskRef) {
    lines.push(`Follow-through reusable task ref: ${followThrough.reuseTaskRef}`);
  }
  if (followThrough.reuseGroupKey) {
    lines.push(`Follow-through reusable group key: ${followThrough.reuseGroupKey}`);
  }
  if (followThrough.groupKey) {
    lines.push(`Follow-through group key: ${followThrough.groupKey}`);
  }
  if (followThrough.title) {
    lines.push(`Follow-through title: ${followThrough.title}`);
  }
  if (followThrough.description?.trim()) {
    lines.push(`Follow-through description: ${followThrough.description}`);
  }
  if (followThrough.acceptanceCriteria?.length) {
    lines.push(`Follow-through acceptance: ${summarizeAcceptanceCriteria(followThrough.acceptanceCriteria)}`);
  }
  if (followThrough.decisionRefs?.length) {
    lines.push(`Follow-through decision refs: ${followThrough.decisionRefs.join(', ')}`);
  }
  if (followThrough.answers?.length) {
    lines.push(
      `${
        sharedFollowThroughAnswers
          ? 'Follow-through shared planner answers'
          : 'Follow-through captured planner answers'
      }: ${followThrough.answers.length}`,
    );
    lines.push(
      `${
        sharedFollowThroughAnswers
          ? 'Follow-through shared planner answer detail'
          : 'Follow-through captured planner answer detail'
      }: ${followThrough.answers.map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
    );
  }
  if (followThrough.requestedUpdates?.length) {
    lines.push(`Follow-through requested updates: ${followThrough.requestedUpdates.join(', ')}`);
  }
  if (followThrough.inferRemainingAnswers) {
    lines.push('Follow-through infers remaining answers: yes');
  }
  if (followThrough.requests?.length) {
    lines.push(`Follow-through grouped requests: ${followThrough.requests.length}`);
    for (const request of followThrough.requests) {
      lines.push(...formatAssistantActionBatchRequestDetails('Follow-through request detail', request));
    }
  }
  if (followThrough.workflows?.length) {
    lines.push(`Follow-through workflow children: ${followThrough.workflows.length}`);
    for (const workflow of followThrough.workflows) {
      lines.push(...formatFollowThroughWorkflowChildDetails(workflow));
    }
  }

  return lines;
}

function summarizePlanningAnswerInput(answer: InterpretablePlanningAnswerInput | CapturedAnswer) {
  const details = [answer.summary];
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`);
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`);
  }
  if (answer.answerKey) {
    details.push(`[answerKey=${answer.answerKey}]`);
  }
  if (answer.matchHints && answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`);
  }
  if ('captureFormat' in answer && answer.captureFormat) {
    details.push(`[captureFormat=${answer.captureFormat}]`);
  }
  if ('answerSourceGroupKey' in answer && answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`);
  }
  if ('answerSourceKey' in answer && answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`);
  }
  if ('sourceExcerpt' in answer && answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`);
  }
  if ('sourceOccurrence' in answer && typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`);
  }
  return 'answer' in answer && answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ');
}

function summarizeDecisionAnswerInput(answer: GoalAssistantDecisionAnswerInput) {
  const details = [answer.summary];
  if (answer.decisionKey) {
    details.push(`[decisionKey=${answer.decisionKey}]`);
  }
  if (answer.summaryKey) {
    details.push(`[summaryKey=${answer.summaryKey}]`);
  }
  if (answer.prompt) {
    details.push(`[prompt=${answer.prompt}]`);
  }
  if (answer.matchHints && answer.matchHints.length > 0) {
    details.push(`[matchHints=${answer.matchHints.join(', ')}]`);
  }
  if (answer.taskRef) {
    details.push(`[taskRef=${answer.taskRef}]`);
  }
  if (answer.answerSourceGroupKey) {
    details.push(`[answerSourceGroupKey=${answer.answerSourceGroupKey}]`);
  }
  if (answer.answerSourceKey) {
    details.push(`[answerSourceKey=${answer.answerSourceKey}]`);
  }
  if (answer.sourceExcerpt) {
    details.push(`[sourceExcerpt=${answer.sourceExcerpt}]`);
  }
  if (typeof answer.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${answer.sourceOccurrence}]`);
  }
  return answer.answer ? `${details.join(' ')}: ${answer.answer}` : details.join(' ');
}

function hasDecisionAnswerDetail(answer: GoalAssistantDecisionAnswerInput) {
  return Boolean(
    answer.answer ??
      answer.sourceExcerpt ??
      answer.answerSourceKey ??
      answer.answerSourceGroupKey ??
      (typeof answer.sourceOccurrence === 'number' ? String(answer.sourceOccurrence) : undefined),
  );
}

function buildDirectDecisionAnswerInput(action: GoalAssistantAction) {
  if (action.kind !== 'record_answer' && action.kind !== 'resolve_decision') {
    return null;
  }
  const summary = action.summary ?? action.decisionKey;
  if (!summary) {
    return null;
  }
  return {
    summary,
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
  } satisfies GoalAssistantDecisionAnswerInput;
}

function summarizeAnswerSource(source: GoalAnswerSourceInput) {
  const details = [source.answerSourceKey];
  if (source.sourceGroupKey) {
    details.push(`[sourceGroupKey=${source.sourceGroupKey}]`);
  }
  if (source.route) {
    details.push(`[route=${source.route}]`);
  }
  if (source.decisionKey) {
    details.push(`[decisionKey=${source.decisionKey}]`);
  }
  if (source.answerKey) {
    details.push(`[answerKey=${source.answerKey}]`);
  }
  if (source.summaryKey) {
    details.push(`[summaryKey=${source.summaryKey}]`);
  }
  if (source.summary) {
    details.push(`[summary=${source.summary}]`);
  }
  if (source.prompt) {
    details.push(`[prompt=${source.prompt}]`);
  }
  if (source.matchHints && source.matchHints.length > 0) {
    details.push(`[matchHints=${source.matchHints.join(', ')}]`);
  }
  if (source.sourceExcerpt) {
    details.push(`[sourceExcerpt=${source.sourceExcerpt}]`);
  }
  if (typeof source.sourceOccurrence === 'number') {
    details.push(`[sourceOccurrence=${source.sourceOccurrence}]`);
  }
  return source.answer ? `${details.join(' ')}: ${source.answer}` : details.join(' ');
}

function summarizeWorkflowActionChild(workflow: GoalAssistantActionWorkflowChildInput) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? workflow.groupKey ?? 'planning';
  }
  return workflow.groupKey ?? 'planning_batch';
}

function listReusedResultRefs(allRefs: string[], createdRefs?: string[]) {
  if (!createdRefs || createdRefs.length === 0) {
    return [];
  }
  const createdRefSet = new Set(createdRefs);
  return allRefs.filter((ref) => !createdRefSet.has(ref));
}

function slugifyPreferenceSummary(summary: string) {
  const normalized = summary
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'preference';
}

function summarizeWorkflowResultChild(workflow: GoalAssistantWorkflowChildResult) {
  if (workflow.kind === 'planning') {
    return workflow.workflowTaskKey ?? workflow.groupKey ?? 'planning';
  }
  return workflow.groupKey ?? 'planning_batch';
}

function collectAssistantResultPlanningRequests(
  requests: GoalAssistantPlanningRequestResult[] | undefined,
  workflows: GoalAssistantWorkflowChildResult[] | undefined,
) {
  const collected: GoalAssistantPlanningRequestResult[] = [];
  const seenRequestKeys = new Set<string>();

  const appendRequests = (nextRequests: GoalAssistantPlanningRequestResult[] | undefined) => {
    for (const request of nextRequests ?? []) {
      if (!request.requestKey || seenRequestKeys.has(request.requestKey)) {
        continue;
      }
      seenRequestKeys.add(request.requestKey);
      collected.push(request);
    }
  };

  appendRequests(requests);
  for (const workflow of workflows ?? []) {
    appendRequests(workflow.requests);
  }

  return collected;
}

function collectUniqueAssistantResultWorkflowSharedDecisionRefs(
  requests: GoalAssistantPlanningRequestResult[],
) {
  return Array.from(
    new Set(
      requests.flatMap((request) => request.workflowSharedDecisionRefs ?? []),
    ),
  );
}

function collectUniqueAssistantResultWorkflowSharedAnswers(
  requests: GoalAssistantPlanningRequestResult[],
) {
  const answers: CapturedAnswer[] = [];
  const seenKeys = new Set<string>();

  for (const request of requests) {
    for (const answer of request.workflowSharedAnswers ?? []) {
      const identity =
        answer.answerKey?.trim() ||
        answer.summaryKey?.trim() ||
        `${answer.summary.trim().toLowerCase()}::${answer.answer.trim()}`;
      if (!identity || seenKeys.has(identity)) {
        continue;
      }
      seenKeys.add(identity);
      answers.push(answer);
    }
  }

  return answers;
}

function formatAssistantResultFollowThroughDetails(followThrough: GoalAssistantActionResult['followThrough']) {
  if (!followThrough) {
    return [];
  }

  const lines = [`Follow-through kind: ${followThrough.kind}`];

  if (followThrough.workflowKey) {
    lines.push(`Follow-through workflow key: ${followThrough.workflowKey}`);
  }
  if (followThrough.workflowTaskKey) {
    lines.push(`Follow-through workflow task key: ${followThrough.workflowTaskKey}`);
  }
  if (followThrough.groupKey) {
    lines.push(`Follow-through group key: ${followThrough.groupKey}`);
  }
  if (followThrough.groupKeys && followThrough.groupKeys.length > 0) {
    lines.push(`Follow-through group keys: ${followThrough.groupKeys.join(', ')}`);
  }
  const followThroughRequests =
    followThrough.kind === 'workflow_batch'
      ? collectAssistantResultPlanningRequests(followThrough.requests, followThrough.workflows)
      : [];
  if (followThrough.kind === 'workflow_batch' && followThroughRequests.length > 0) {
    const workflowSharedDecisionRefs = collectUniqueAssistantResultWorkflowSharedDecisionRefs(
      followThroughRequests,
    );
    if (workflowSharedDecisionRefs.length > 0) {
      lines.push(`Follow-through shared decision refs: ${workflowSharedDecisionRefs.join(', ')}`);
    }
    const workflowSharedAnswers = collectUniqueAssistantResultWorkflowSharedAnswers(
      followThroughRequests,
    );
    if (workflowSharedAnswers.length > 0) {
      lines.push(
        `Follow-through shared answer detail: ${workflowSharedAnswers.map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
      );
    }
  }
  if (followThrough.workflows && followThrough.workflows.length > 0) {
    lines.push(`Follow-through workflow children: ${followThrough.workflows.length}`);
    for (const workflow of followThrough.workflows) {
      lines.push(
        `Follow-through child detail: ${summarizeWorkflowResultChild(workflow)} -> requests ${workflow.requestKeys.join(', ')} -> tasks ${workflow.taskRefs.join(', ')} -> blockers ${workflow.blockerTaskRefs.join(', ')}`,
      );
      if (workflow.requests && workflow.requests.length > 0) {
        for (const request of workflow.requests) {
          appendAssistantResultPlanningRequestDetails(
            lines,
            `Follow-through child request detail: ${summarizeWorkflowResultChild(workflow)}`,
            request,
          );
        }
      }
    }
  }
  lines.push(`Follow-through requests: ${followThrough.requestKeys.join(', ')}`);
  lines.push(`Follow-through tasks: ${followThrough.taskRefs.join(', ')}`);
  lines.push(`Follow-through blockers: ${followThrough.blockerTaskRefs.join(', ')}`);
  if ((!followThrough.workflows || followThrough.workflows.length === 0) && followThrough.requests && followThrough.requests.length > 0) {
    for (const request of followThrough.requests) {
      appendAssistantResultPlanningRequestDetails(lines, 'Follow-through request detail', request);
    }
  }

  return lines;
}

function appendAssistantResultPlanningRequestDetails(
  lines: string[],
  label: string,
  request: GoalAssistantPlanningRequestResult,
) {
  lines.push(summarizeAssistantResultPlanningRequest(label, request));
  if (request.createdAt) {
    lines.push(`Request created at ${request.requestKey}: ${request.createdAt}`);
  }
  if (request.description.trim().length > 0) {
    lines.push(`Request description ${request.requestKey}: ${request.description}`);
  }
  if (request.acceptanceCriteria.length > 0) {
    lines.push(`Request acceptance ${request.requestKey}: ${summarizeAcceptanceCriteria(request.acceptanceCriteria)}`);
  }
  if (request.blockedByWorkflowKeys.length > 0) {
    lines.push(`Request blocked by workflow keys ${request.requestKey}: ${request.blockedByWorkflowKeys.join(', ')}`);
  }
  if (request.resolvedAt) {
    lines.push(`Request resolved at ${request.requestKey}: ${request.resolvedAt}`);
  }
  if (request.resolution) {
    lines.push(`Request resolution ${request.requestKey}: ${request.resolution}`);
  }
  if (request.answers.length > 0) {
    lines.push(
      `Request answer detail ${request.requestKey}: ${request.answers.map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
    );
  }
  if ((request.workflowSharedAnswers?.length ?? 0) > 0) {
    lines.push(
      `Workflow-shared answer detail ${request.requestKey}: ${(request.workflowSharedAnswers ?? []).map((answer) => summarizePlanningAnswerInput(answer)).join(' | ')}`,
    );
  }
}

function summarizeAssistantResultPlanningRequest(label: string, request: GoalAssistantPlanningRequestResult) {
  const details = [`${request.requestKey} [${request.status}] ${request.title}`];
  details.push(`[taskRef=${request.taskRef}]`);
  if (request.groupKey) {
    details.push(`[groupKey=${request.groupKey}]`);
  }
  if (request.groupTaskKey) {
    details.push(`[groupTaskKey=${request.groupTaskKey}]`);
  }
  if (request.workflowKey) {
    details.push(`[workflowKey=${request.workflowKey}]`);
  }
  if (request.workflowTaskKey) {
    details.push(`[workflowTaskKey=${request.workflowTaskKey}]`);
  }
  if (request.decisionRefs.length > 0) {
    details.push(`[decisionRefs=${request.decisionRefs.join(', ')}]`);
  }
  if (request.requestedUpdates.length > 0) {
    details.push(`[updates=${request.requestedUpdates.join(', ')}]`);
  }
  if ((request.workflowSharedDecisionRefs?.length ?? 0) > 0) {
    details.push(`[workflowSharedDecisionRefs=${(request.workflowSharedDecisionRefs ?? []).join(', ')}]`);
  }
  return `${label}: ${details.join(' ')}`;
}

function appendAssistantResultDecisionDetails(lines: string[], decision: GoalDecision) {
  lines.push(summarizeAssistantResultDecision(decision));
  lines.push(`Decision created at ${decision.decisionKey}: ${decision.createdAt}`);
  if (decision.answer) {
    lines.push(`Decision answer: ${decision.answer}`);
  }
  if (decision.resolvedAt) {
    lines.push(`Decision resolved at ${decision.decisionKey}: ${decision.resolvedAt}`);
  }
}

function summarizeAssistantResultDecision(decision: GoalDecision) {
  const details = [`${decision.decisionKey} [${decision.status}] ${decision.summary}`];
  if (decision.summaryKey) {
    details.push(`[summaryKey=${decision.summaryKey}]`);
  }
  if (decision.prompt) {
    details.push(`[prompt=${decision.prompt}]`);
  }
  if (decision.matchHints && decision.matchHints.length > 0) {
    details.push(`[matchHints=${decision.matchHints.join(', ')}]`);
  }
  if (decision.taskRef) {
    details.push(`[taskRef=${decision.taskRef}]`);
  }
  if (decision.captureFormat) {
    details.push(`[captureFormat=${decision.captureFormat}]`);
  }
  return `Decision detail: ${details.join(' ')}`;
}

function appendAssistantResultTaskDetails(lines: string[], label: string, task: TodoTaskItem) {
  lines.push(`${label}: ${summarizeAssistantResultTask(task)}`);
  if (task.description.trim().length > 0) {
    lines.push(`Task description ${task.ref}: ${task.description}`);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push(`Task acceptance ${task.ref}: ${summarizeAcceptanceCriteria(task.acceptanceCriteria)}`);
  }
}

function summarizeAssistantResultTask(task: TodoTaskItem) {
  const details = [`${task.ref} [${task.kind}] [${task.status}] ${task.title}`];
  if (task.blockedBy.length > 0) {
    details.push(`[blockers=${task.blockedBy.map((blocker) => `${blocker.kind}:${blocker.ref}`).join(', ')}]`);
  }
  return details.join(' ');
}

function summarizeAssistantResultPreference(preference: GoalAssistantPreferenceResult) {
  const details = [`${preference.preferenceKey} [${preference.status}] ${preference.summary}`];
  if (preference.rationale) {
    details.push(`[rationale=${preference.rationale}]`);
  }
  if (preference.retiredReason) {
    details.push(`[retiredReason=${preference.retiredReason}]`);
  }
  if (preference.supersededBy) {
    details.push(`[supersededBy=${preference.supersededBy}]`);
  }
  return details.join(' ');
}

function summarizeBlockers(blockers: BlockerRef[]) {
  return blockers.map((blocker) => `${blocker.kind}:${blocker.ref}`).join(', ');
}

function summarizeAcceptanceCriteria(acceptanceCriteria: string[]) {
  return acceptanceCriteria.join(' | ');
}

function summarizeInlineText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
