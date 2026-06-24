import {
  type CapturedAnswer,
  type GoalDecision,
  type GoalPlanningRequest,
  type GoalPlanningWorkflowLeafState,
  type GoalPlanningWorkflowState,
  type PreferenceEntry,
  type TodoTaskItem,
} from '../lib/api'
import {
  type DecisionAnswerEntryEditorItem,
  type PlanningAnswerEditorItem,
  type ReusableAnswerSourceRoutingSuggestion,
  type ReusableAnswerSourceSuggestion,
  type ReusableBatchRequestSuggestion,
  type ReusableDecisionAnswerSuggestion,
  type ReusableDecisionWorkflowChildSuggestion,
  type ReusablePlanningAnswerSuggestion,
  type ReusablePlanningRequestSuggestion,
  type ReusableStringSuggestion,
  type ReusableWorkflowChildSuggestion,
  type ReusableWorkflowContextSuggestion,
  type ReusableWorkflowGraphSuggestion,
  type WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'
import {
  buildBatchRequestEditorItemFromPlanningRequest,
  collectUniqueCapturedAnswersFromPlanningRequests,
  collectUniquePlanningRequestDecisionRefs,
  createDecisionWorkflowChildEditorItemFromWorkflowLeaf,
  createWorkflowChildEditorItemFromWorkflowLeaf,
  parseListInput,
  serializeBlockerEditorItems,
  serializeDecisionWorkflowChildEditorItems,
  serializePlanningAnswerEditorItems,
  serializeWorkflowChildEditorItems,
  slugifySourceKeyPart,
  summarizePreviewText,
} from './boardViewStructuredEditors'

export function createDecisionAnswerSourceSuggestion(
  decision: GoalDecision,
): ReusableAnswerSourceSuggestion | null {
  if (!decision.answer?.trim()) {
    return null
  }

  return {
    suggestionKey: `decision:${decision.decisionKey}`,
    title: decision.summary,
    subtitle: `decision · ${decision.decisionKey}`,
    preview: summarizePreviewText(decision.answer),
    item: {
      answerSourceKey: decision.decisionKey,
      route: 'decision',
      summary: decision.summary,
      answer: decision.answer,
      sourceExcerpt: '',
      sourceOccurrence: '',
      sourceGroupKey: '',
      decisionKey: decision.decisionKey,
      prompt: decision.prompt ?? '',
      summaryKey: decision.summaryKey ?? '',
      answerKey: '',
      matchHints: (decision.matchHints ?? []).join('\n'),
    },
  }
}

export function createDecisionAnswerSourceRoutingSuggestionFromDecision(
  decision: GoalDecision,
): ReusableAnswerSourceRoutingSuggestion | null {
  return createDecisionAnswerSourceRoutingSuggestion({
    decisionKey: decision.decisionKey,
    summary: decision.summary,
    summaryKey: decision.summaryKey ?? '',
    prompt: decision.prompt ?? '',
    matchHints: (decision.matchHints ?? []).join('\n'),
    title: decision.summary,
    subtitle: `decision route · ${decision.decisionKey}`,
  })
}

export function createDecisionAnswerSourceRoutingSuggestionFromResolutionDraft(
  decision: GoalDecision,
  draft: {
    summaryKey: string
    prompt: string
    matchHints: string
  },
): ReusableAnswerSourceRoutingSuggestion | null {
  const fallbackMatchHints = (decision.matchHints ?? []).join('\n')
  const summaryKey = draft.summaryKey.trim() || (decision.summaryKey ?? '')
  const prompt = draft.prompt.trim() || (decision.prompt ?? '')

  return createDecisionAnswerSourceRoutingSuggestion({
    decisionKey: decision.decisionKey,
    summary: decision.summary,
    summaryKey,
    prompt,
    matchHints: draft.matchHints.trim() || fallbackMatchHints,
    title: decision.summary,
    subtitle: `decision route · ${decision.decisionKey}`,
  })
}

export function createDecisionAnswerSourceRoutingSuggestionFromSingleAnswerBundleDraft(draft: {
  decisionKey: string
  summary: string
  summaryKey: string
  prompt: string
  matchHints: string
}): ReusableAnswerSourceRoutingSuggestion | null {
  return createDecisionAnswerSourceRoutingSuggestion({
    decisionKey: draft.decisionKey.trim(),
    summary: draft.summary.trim(),
    summaryKey: draft.summaryKey.trim(),
    prompt: draft.prompt.trim(),
    matchHints: draft.matchHints.trim(),
    title:
      draft.summary.trim() ||
      draft.prompt.trim() ||
      draft.decisionKey.trim() ||
      'Current single decision',
    subtitle:
      draft.decisionKey.trim().length > 0
        ? `single decision route · ${draft.decisionKey.trim()}`
        : 'single decision route · current draft',
  })
}

export function createDecisionAnswerSourceRoutingSuggestionFromDecisionAnswerItem(
  item: DecisionAnswerEntryEditorItem,
  index: number,
): ReusableAnswerSourceRoutingSuggestion | null {
  const decisionKey = item.decisionKey.trim()
  const summary = item.summary.trim()
  const prompt = item.prompt.trim()
  const summaryKey = item.summaryKey.trim()
  const matchHints = item.matchHints.trim()
  if (
    decisionKey.length === 0 &&
    summary.length === 0 &&
    prompt.length === 0 &&
    summaryKey.length === 0 &&
    matchHints.length === 0
  ) {
    return null
  }

  return createDecisionAnswerSourceRoutingSuggestion({
    decisionKey,
    summary,
    summaryKey,
    prompt,
    matchHints,
    title: summary || prompt || decisionKey || `Decision consumer ${index + 1}`,
    subtitle:
      decisionKey.length > 0
        ? `decision route · ${decisionKey}`
        : `decision route · current consumer ${index + 1}`,
  })
}

export function createDecisionAnswerSourceRoutingSuggestion({
  decisionKey,
  summary,
  summaryKey,
  prompt,
  matchHints,
  title,
  subtitle,
}: {
  decisionKey: string
  summary: string
  summaryKey: string
  prompt: string
  matchHints: string
  title: string
  subtitle: string
}): ReusableAnswerSourceRoutingSuggestion | null {
  const stableIdentity = decisionKey.trim() || summaryKey.trim() || summary.trim() || prompt.trim()
  if (stableIdentity.length === 0) {
    return null
  }

  const normalizedDecisionKey = decisionKey.trim()
  const normalizedSummary = summary.trim()
  const normalizedSummaryKey = summaryKey.trim()
  const normalizedPrompt = prompt.trim()
  const normalizedMatchHints = matchHints.trim()
  const previewParts = [
    'route=decision',
    normalizedDecisionKey.length > 0 ? `decisionKey=${normalizedDecisionKey}` : '',
    normalizedSummary.length > 0 ? normalizedSummary : normalizedPrompt,
    normalizedMatchHints.length > 0
      ? `matchHints=${parseListInput(normalizedMatchHints).join(', ')}`
      : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `answer-source-route:decision:${slugifySourceKeyPart(stableIdentity)}`,
    title,
    subtitle,
    preview: summarizePreviewText(previewParts.join(' • ')),
    item: {
      answerSourceKey: `decision-${slugifySourceKeyPart(stableIdentity)}-source`,
      route: 'decision',
      summary: normalizedSummary,
      answer: '',
      sourceExcerpt: '',
      sourceOccurrence: '',
      sourceGroupKey: '',
      decisionKey: normalizedDecisionKey,
      prompt: normalizedPrompt,
      summaryKey: normalizedSummaryKey,
      answerKey: '',
      matchHints: normalizedMatchHints,
    },
  }
}

export function createDecisionPlanningAnswerSuggestion(
  decision: GoalDecision,
): ReusablePlanningAnswerSuggestion | null {
  if (!decision.answer?.trim()) {
    return null
  }

  return {
    suggestionKey: `decision:${decision.decisionKey}`,
    title: decision.summary,
    subtitle: `decision · ${decision.decisionKey}`,
    preview: summarizePreviewText(decision.answer),
    item: {
      summary: decision.summary,
      answer: decision.answer,
      sourceExcerpt: '',
      sourceOccurrence: '',
      prompt: decision.prompt ?? '',
      summaryKey: decision.summaryKey ?? '',
      answerKey: '',
      matchHints: (decision.matchHints ?? []).join('\n'),
      answerSourceKey: decision.decisionKey,
      answerSourceGroupKey: '',
    },
  }
}

export function createOpenDecisionAnswerSuggestion(
  decision: GoalDecision,
): ReusableDecisionAnswerSuggestion | null {
  if (decision.status !== 'open') {
    return null
  }

  const previewParts = [
    decision.prompt?.trim(),
    decision.matchHints?.length ? `Hints: ${decision.matchHints.join(', ')}` : '',
    decision.taskRef ? `Task: ${decision.taskRef}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `open-decision:${decision.decisionKey}`,
    title: decision.summary,
    subtitle: `open decision · ${decision.decisionKey}`,
    preview:
      previewParts.length > 0
        ? summarizePreviewText(previewParts.join(' • '))
        : 'Reuse current matching authority for this open decision and fill in the answer here.',
    item: {
      decisionKey: decision.decisionKey,
      summary: decision.summary,
      summaryKey: decision.summaryKey ?? '',
      prompt: decision.prompt ?? '',
      matchHints: (decision.matchHints ?? []).join('\n'),
      taskRef: decision.taskRef ?? '',
      answer: '',
      sourceExcerpt: '',
      sourceOccurrence: '',
      answerSourceKey: decision.decisionKey,
      answerSourceGroupKey: '',
    },
  }
}

export function createPlanningAnswerEditorItemFromCapturedAnswer(
  answer: CapturedAnswer,
): PlanningAnswerEditorItem {
  return {
    summary: answer.summary,
    answer: answer.answer,
    sourceExcerpt: '',
    sourceOccurrence: '',
    prompt: answer.prompt ?? '',
    summaryKey: answer.summaryKey ?? '',
    answerKey: answer.answerKey ?? '',
    matchHints: (answer.matchHints ?? []).join('\n'),
    answerSourceKey: '',
    answerSourceGroupKey: '',
  }
}

export function createPlanningRequestSuggestion(
  request: GoalPlanningRequest,
  linkedTask: TodoTaskItem | undefined,
): ReusablePlanningRequestSuggestion | null {
  const requestKey = request.requestKey.trim()
  if (requestKey.length === 0) {
    return null
  }

  const previewParts = [
    request.description.trim(),
    request.acceptanceCriteria.length > 0
      ? `Criteria: ${request.acceptanceCriteria.join(', ')}`
      : '',
    request.requestedUpdates.length > 0 ? `Updates: ${request.requestedUpdates.join(', ')}` : '',
    request.blockedByWorkflowKeys.length > 0
      ? `workflowDeps=${request.blockedByWorkflowKeys.join(', ')}`
      : '',
    linkedTask?.blockedBy.length ? `taskBlockers=${linkedTask.blockedBy.length}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `planning-request:${requestKey}`,
    title: request.title,
    subtitle: `${request.status} planning request · ${requestKey}`,
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : requestKey,
    item: {
      requestKey,
      groupKey: request.groupKey ?? '',
      groupTaskKey: request.groupTaskKey ?? '',
      workflowTaskKey: request.workflowTaskKey ?? '',
      title: request.title,
      description: request.description,
      acceptanceCriteria: request.acceptanceCriteria.join('\n'),
      decisionRefs: request.decisionRefs.join('\n'),
      answersJson: serializePlanningAnswerEditorItems(
        request.answers.map((answer) => createPlanningAnswerEditorItemFromCapturedAnswer(answer)),
      ),
      requestedUpdates: request.requestedUpdates.join('\n'),
      blockedByJson:
        linkedTask && linkedTask.blockedBy.length > 0
          ? serializeBlockerEditorItems(
              linkedTask.blockedBy.map((blocker) => ({
                kind: blocker.kind,
                ref: blocker.ref,
              })),
            )
          : '',
      blockedByWorkflowKeys: request.blockedByWorkflowKeys.join('\n'),
    },
  }
}

export function createDecisionRefSuggestion(
  decision: GoalDecision,
): ReusableStringSuggestion | null {
  const decisionKey = decision.decisionKey.trim()
  if (decisionKey.length === 0) {
    return null
  }

  const previewParts = [
    decision.answer?.trim(),
    decision.prompt?.trim(),
    decision.matchHints?.length ? `Hints: ${decision.matchHints.join(', ')}` : '',
    decision.taskRef ? `Task: ${decision.taskRef}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `decision-ref:${decisionKey}`,
    value: decisionKey,
    title: decision.summary,
    subtitle: `${decision.status} decision · ${decisionKey}`,
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : decisionKey,
  }
}

export function createPlanningRequestKeySuggestion(
  request: GoalPlanningRequest,
): ReusableStringSuggestion | null {
  const requestKey = request.requestKey.trim()
  if (requestKey.length === 0) {
    return null
  }

  const previewParts = [
    request.title.trim(),
    `task=${request.taskRef}`,
    request.groupKey ? `group=${request.groupKey}` : '',
    request.groupTaskKey ? `groupTask=${request.groupTaskKey}` : '',
    request.workflowKey ? `workflow=${request.workflowKey}` : '',
    request.requestedUpdates.length > 0 ? `updates=${request.requestedUpdates.join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `planning-request-key:${requestKey}`,
    value: requestKey,
    title: request.title,
    subtitle: `${request.status} planning request · ${requestKey}`,
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : requestKey,
  }
}

export function createPlanningGroupKeySuggestion(
  request: GoalPlanningRequest,
): ReusableStringSuggestion | null {
  const groupKey = request.groupKey?.trim()
  if (!groupKey) {
    return null
  }

  const previewParts = [
    request.title.trim(),
    `request=${request.requestKey}`,
    request.groupTaskKey ? `groupTask=${request.groupTaskKey}` : '',
    request.workflowKey ? `workflow=${request.workflowKey}` : '',
    `task=${request.taskRef}`,
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `planning-group-key:${groupKey}`,
    value: groupKey,
    title: groupKey,
    subtitle: `planning group key · ${request.requestKey}`,
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : groupKey,
  }
}

export function createPlanningGroupTaskKeySuggestion(
  request: GoalPlanningRequest,
): ReusableStringSuggestion | null {
  const groupTaskKey = request.groupTaskKey?.trim()
  if (!groupTaskKey) {
    return null
  }

  const previewParts = [
    request.title.trim(),
    request.groupKey ? `group=${request.groupKey}` : '',
    `request=${request.requestKey}`,
    `task=${request.taskRef}`,
    request.workflowKey ? `workflow=${request.workflowKey}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `planning-group-task-key:${groupTaskKey}`,
    value: groupTaskKey,
    title: groupTaskKey,
    subtitle: `grouped task key · ${request.requestKey}`,
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : groupTaskKey,
  }
}

export function createBatchRequestSuggestion(
  request: GoalPlanningRequest,
  linkedTask: TodoTaskItem | undefined,
  groupedTaskKeyByTaskRef: Map<string, string>,
): ReusableBatchRequestSuggestion | null {
  const item = buildBatchRequestEditorItemFromPlanningRequest(
    request,
    linkedTask,
    groupedTaskKeyByTaskRef,
  )
  if (!item) {
    return null
  }

  const previewParts = [
    request.description.trim(),
    request.acceptanceCriteria.length > 0
      ? `Criteria: ${request.acceptanceCriteria.join(', ')}`
      : '',
    request.requestedUpdates.length > 0 ? `Updates: ${request.requestedUpdates.join(', ')}` : '',
    item.blockedByTaskKeys.length > 0
      ? `blockedByTaskKeys=${parseListInput(item.blockedByTaskKeys).join(', ')}`
      : '',
    linkedTask?.blockedBy.length ? `blockers=${linkedTask.blockedBy.length}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `batch-request:${request.requestKey}:${item.taskKey}`,
    title: request.title,
    subtitle: `grouped planning request · ${request.requestKey}`,
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : request.requestKey,
    item,
  }
}

export function createWorkflowKeySuggestion(
  workflow: GoalPlanningWorkflowState,
): ReusableStringSuggestion | null {
  const workflowKey = workflow.workflowKey.trim()
  if (workflowKey.length === 0) {
    return null
  }

  const previewParts = [
    workflow.workflows.length > 0 ? `${workflow.workflows.length} child(ren)` : '',
    workflow.requestKeys.length > 0 ? `${workflow.requestKeys.length} request(s)` : '',
    workflow.taskRefs.length > 0 ? `${workflow.taskRefs.length} task(s)` : '',
    workflow.groupKeys.length > 0 ? `Groups: ${workflow.groupKeys.join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-key:${workflowKey}`,
    value: workflowKey,
    title: workflowKey,
    subtitle: 'durable workflow key',
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : workflowKey,
  }
}

export function createWorkflowContextSuggestion(
  workflow: GoalPlanningWorkflowState,
): ReusableWorkflowContextSuggestion | null {
  const workflowKey = workflow.workflowKey.trim()
  if (workflowKey.length === 0) {
    return null
  }

  const sharedDecisionRefs = workflow.workflowSharedDecisionRefs.join('\n')
  const sharedAnswersJson =
    workflow.workflowSharedAnswers.length > 0
      ? serializePlanningAnswerEditorItems(
          workflow.workflowSharedAnswers.map((answer) =>
            createPlanningAnswerEditorItemFromCapturedAnswer(answer),
          ),
        )
      : ''
  const reuseTaskRef = workflow.taskRefs[0]?.trim() ?? ''
  const reuseGroupKey = workflow.groupKeys[0]?.trim() ?? ''

  const previewParts = [
    workflow.workflowSharedDecisionRefs.length > 0
      ? `sharedDecisionRefs=${workflow.workflowSharedDecisionRefs.join(', ')}`
      : '',
    workflow.workflowSharedAnswers.length > 0
      ? `sharedAnswers=${workflow.workflowSharedAnswers.length}`
      : '',
    reuseTaskRef ? `reuseTask=${reuseTaskRef}` : '',
    reuseGroupKey ? `reuseGroup=${reuseGroupKey}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-context:${workflowKey}`,
    title: workflowKey,
    subtitle: 'workflow root context',
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : workflowKey,
    item: {
      workflowKey,
      sharedDecisionRefs,
      sharedAnswersJson,
      reuseTaskRef,
      reuseGroupKey,
    },
  }
}

export function createWorkflowGraphSuggestion(
  workflow: GoalPlanningWorkflowState,
  tasksByRef: Map<string, TodoTaskItem>,
): ReusableWorkflowGraphSuggestion | null {
  const workflowKey = workflow.workflowKey.trim()
  if (workflowKey.length === 0) {
    return null
  }

  const groupedTaskKeyByTaskRef = buildGroupedTaskKeyByTaskRefForWorkflow(workflow)

  const workflowChildItems = workflow.workflows.map((workflowChild) =>
    createWorkflowChildEditorItemFromWorkflowLeaf(
      workflowChild,
      tasksByRef,
      groupedTaskKeyByTaskRef,
    ),
  )
  const decisionWorkflowChildItems = workflow.workflows.map((workflowChild) =>
    createDecisionWorkflowChildEditorItemFromWorkflowLeaf(
      workflowChild,
      tasksByRef,
      groupedTaskKeyByTaskRef,
    ),
  )
  const sharedDecisionRefs = workflow.workflowSharedDecisionRefs.join('\n')
  const sharedAnswersJson =
    workflow.workflowSharedAnswers.length > 0
      ? serializePlanningAnswerEditorItems(
          workflow.workflowSharedAnswers.map((answer) =>
            createPlanningAnswerEditorItemFromCapturedAnswer(answer),
          ),
        )
      : ''
  const reuseTaskRef = workflow.taskRefs[0]?.trim() ?? ''
  const reuseGroupKey = workflow.groupKeys[0]?.trim() ?? ''
  const previewParts = [
    `${workflow.workflows.length} child(ren)`,
    workflow.requestKeys.length > 0 ? `${workflow.requestKeys.length} request(s)` : '',
    workflow.workflowSharedDecisionRefs.length > 0
      ? `sharedDecisionRefs=${workflow.workflowSharedDecisionRefs.length}`
      : '',
    workflow.workflowSharedAnswers.length > 0
      ? `sharedAnswers=${workflow.workflowSharedAnswers.length}`
      : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-graph:${workflowKey}`,
    title: workflowKey,
    subtitle: 'workflow graph prefill',
    preview: summarizePreviewText(previewParts.join(' • ')),
    item: {
      workflowKey,
      sharedDecisionRefs,
      sharedAnswersJson,
      reuseTaskRef,
      reuseGroupKey,
      childrenJson: serializeWorkflowChildEditorItems(workflowChildItems),
      workflowChildrenJson: serializeDecisionWorkflowChildEditorItems(decisionWorkflowChildItems),
    },
  }
}

export function createWorkflowChildSuggestion(
  workflow: GoalPlanningWorkflowState,
  workflowChild: GoalPlanningWorkflowLeafState,
  index: number,
  tasksByRef: Map<string, TodoTaskItem>,
  groupedTaskKeyByTaskRef: Map<string, string>,
): ReusableWorkflowChildSuggestion | null {
  const item = createWorkflowChildEditorItemFromWorkflowLeaf(
    workflowChild,
    tasksByRef,
    groupedTaskKeyByTaskRef,
  )
  const title =
    workflowChild.kind === 'planning' ? workflowChild.request.title : workflowChild.groupKey
  const subtitle =
    workflowChild.kind === 'planning'
      ? `workflow child · ${workflow.workflowKey}`
      : `grouped workflow child · ${workflow.workflowKey}`
  const groupedDecisionRefCount =
    workflowChild.kind === 'planning_batch'
      ? collectUniquePlanningRequestDecisionRefs(workflowChild.requests).length
      : 0
  const groupedAnswerCount =
    workflowChild.kind === 'planning_batch'
      ? collectUniqueCapturedAnswersFromPlanningRequests(workflowChild.requests).length
      : 0
  const previewParts =
    workflowChild.kind === 'planning'
      ? [
          workflowChild.request.requestKey,
          workflowChild.workflowTaskKey ?? '',
          workflowChild.request.decisionRefs.length > 0
            ? `decisionRefs=${workflowChild.request.decisionRefs.length}`
            : '',
          workflowChild.request.answers.length > 0
            ? `answers=${workflowChild.request.answers.length}`
            : '',
          workflowChild.blockedByWorkflowKeys.length > 0
            ? `deps=${workflowChild.blockedByWorkflowKeys.join(', ')}`
            : '',
        ]
      : [
          `${workflowChild.requests.length} grouped request(s)`,
          groupedDecisionRefCount > 0 ? `decisionRefs=${groupedDecisionRefCount}` : '',
          groupedAnswerCount > 0 ? `answers=${groupedAnswerCount}` : '',
          workflowChild.blockedByWorkflowKeys.length > 0
            ? `deps=${workflowChild.blockedByWorkflowKeys.join(', ')}`
            : '',
        ]

  return {
    suggestionKey: `workflow-child:${workflow.workflowKey}:${workflowChild.kind}:${index}`,
    title,
    subtitle,
    preview: summarizePreviewText(
      previewParts.filter((part) => part && part.length > 0).join(' • '),
    ),
    item,
  }
}

export function createDecisionWorkflowChildSuggestion(
  workflow: GoalPlanningWorkflowState,
  workflowChild: GoalPlanningWorkflowLeafState,
  index: number,
  tasksByRef: Map<string, TodoTaskItem>,
  groupedTaskKeyByTaskRef: Map<string, string>,
): ReusableDecisionWorkflowChildSuggestion | null {
  const item = createDecisionWorkflowChildEditorItemFromWorkflowLeaf(
    workflowChild,
    tasksByRef,
    groupedTaskKeyByTaskRef,
  )
  const title =
    workflowChild.kind === 'planning' ? workflowChild.request.title : workflowChild.groupKey
  const subtitle =
    workflowChild.kind === 'planning'
      ? `answer-driven child · ${workflow.workflowKey}`
      : `answer-driven grouped child · ${workflow.workflowKey}`
  const groupedAnswerCount =
    workflowChild.kind === 'planning_batch'
      ? collectUniqueCapturedAnswersFromPlanningRequests(workflowChild.requests).length
      : 0
  const previewParts =
    workflowChild.kind === 'planning'
      ? [
          workflowChild.request.requestKey,
          workflowChild.workflowTaskKey ?? '',
          workflowChild.request.answers.length > 0
            ? `answers=${workflowChild.request.answers.length}`
            : '',
          workflowChild.blockedByWorkflowKeys.length > 0
            ? `deps=${workflowChild.blockedByWorkflowKeys.join(', ')}`
            : '',
        ]
      : [
          `${workflowChild.requests.length} grouped request(s)`,
          groupedAnswerCount > 0 ? `answers=${groupedAnswerCount}` : '',
          workflowChild.blockedByWorkflowKeys.length > 0
            ? `deps=${workflowChild.blockedByWorkflowKeys.join(', ')}`
            : '',
        ]

  return {
    suggestionKey: `decision-workflow-child:${workflow.workflowKey}:${workflowChild.kind}:${index}`,
    title,
    subtitle,
    preview: summarizePreviewText(
      previewParts.filter((part) => part && part.length > 0).join(' • '),
    ),
    item,
  }
}

export function buildGroupedTaskKeyByTaskRefForWorkflow(workflow: GoalPlanningWorkflowState) {
  const groupedTaskKeyByTaskRef = new Map<string, string>()

  for (const workflowChild of workflow.workflows) {
    const childRequests =
      workflowChild.kind === 'planning' ? [workflowChild.request] : workflowChild.requests
    for (const request of childRequests) {
      const groupTaskKey = request.groupTaskKey?.trim()
      if (groupTaskKey) {
        groupedTaskKeyByTaskRef.set(request.taskRef, groupTaskKey)
      }
    }
  }

  return groupedTaskKeyByTaskRef
}

export function createTaskRefSuggestion(task: TodoTaskItem): ReusableStringSuggestion | null {
  const taskRef = task.ref.trim()
  if (taskRef.length === 0) {
    return null
  }

  const previewParts = [
    task.title,
    `kind=${task.kind}`,
    `status=${task.status}`,
    task.blockedBy.length > 0 ? `blockers=${task.blockedBy.length}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `task-ref:${taskRef}`,
    value: taskRef,
    title: taskRef,
    subtitle: `visible task ref · ${task.kind}`,
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : taskRef,
  }
}

export function createWorkflowRootTaskRefSuggestion(
  task: TodoTaskItem,
  request: GoalPlanningRequest | undefined,
): ReusableStringSuggestion | null {
  const taskRef = task.ref.trim()
  if (taskRef.length === 0 || task.kind !== 'planning' || task.status === 'done') {
    return null
  }

  const previewParts = [
    task.title,
    `status=${task.status}`,
    request ? `request=${request.requestKey}` : '',
    request?.groupKey ? `group=${request.groupKey}` : '',
    request?.workflowKey ? `workflow=${request.workflowKey}` : '',
    task.blockedBy.length > 0 ? `blockers=${task.blockedBy.length}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-root-task-ref:${taskRef}`,
    value: taskRef,
    title: taskRef,
    subtitle: request ? `planning task surface · ${request.title}` : 'planning task surface',
    preview: previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : taskRef,
  }
}

export function createPreferenceKeySuggestion(
  entry: PreferenceEntry,
): ReusableStringSuggestion | null {
  const preferenceKey = entry.preferenceKey.trim()
  if (preferenceKey.length === 0) {
    return null
  }

  const previewParts = [
    entry.summary,
    `status=${entry.status}`,
    entry.supersededBy ? `supersededBy=${entry.supersededBy}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `preference-key:${preferenceKey}`,
    value: preferenceKey,
    title: preferenceKey,
    subtitle: `current durable preference · ${entry.status}`,
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : preferenceKey,
  }
}

export function createWorkflowTaskRefSuggestion(
  taskRef: string,
  workflow: GoalPlanningWorkflowState,
): ReusableStringSuggestion | null {
  const normalizedTaskRef = taskRef.trim()
  if (normalizedTaskRef.length === 0) {
    return null
  }

  const previewParts = [
    `workflow=${workflow.workflowKey}`,
    workflow.workflows.length > 0 ? `${workflow.workflows.length} child(ren)` : '',
    workflow.groupKeys.length > 0 ? `Groups: ${workflow.groupKeys.join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-task-ref:${normalizedTaskRef}`,
    value: normalizedTaskRef,
    title: normalizedTaskRef,
    subtitle: `workflow task ref · ${workflow.workflowKey}`,
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : normalizedTaskRef,
  }
}

export function createWorkflowTaskKeySuggestion(
  workflowTaskKey: string,
  workflowKey: string,
): ReusableStringSuggestion | null {
  const normalizedWorkflowTaskKey = workflowTaskKey.trim()
  if (normalizedWorkflowTaskKey.length === 0) {
    return null
  }

  return {
    suggestionKey: `workflow-task-key:${normalizedWorkflowTaskKey}`,
    value: normalizedWorkflowTaskKey,
    title: normalizedWorkflowTaskKey,
    subtitle: `workflow child key · ${workflowKey}`,
    preview: summarizePreviewText(`workflow=${workflowKey}`),
  }
}

export function createWorkflowGroupKeySuggestion(
  groupKey: string,
  workflow: GoalPlanningWorkflowState,
): ReusableStringSuggestion | null {
  const normalizedGroupKey = groupKey.trim()
  if (normalizedGroupKey.length === 0) {
    return null
  }

  const previewParts = [
    `workflow=${workflow.workflowKey}`,
    workflow.requestKeys.length > 0 ? `${workflow.requestKeys.length} request(s)` : '',
    workflow.taskRefs.length > 0 ? `${workflow.taskRefs.length} task(s)` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-group-key:${normalizedGroupKey}`,
    value: normalizedGroupKey,
    title: normalizedGroupKey,
    subtitle: `workflow group key · ${workflow.workflowKey}`,
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : normalizedGroupKey,
  }
}

export function createWorkflowDependencyKeySuggestion(
  workflowChild: WorkflowChildEditorItem,
  workflowKey: string,
): ReusableStringSuggestion | null {
  const dependencyKey =
    workflowChild.kind === 'planning' ? workflowChild.workflowTaskKey : workflowChild.groupKey
  const normalizedDependencyKey = dependencyKey?.trim() ?? ''
  if (normalizedDependencyKey.length === 0) {
    return null
  }

  const previewParts =
    workflowChild.kind === 'planning'
      ? [
          workflowChild.title.trim(),
          workflowChild.requestKey.trim() ? `request=${workflowChild.requestKey.trim()}` : '',
          `workflow=${workflowKey}`,
        ]
      : [
          workflowChild.groupKey.trim() ? `group=${workflowChild.groupKey.trim()}` : '',
          `workflow=${workflowKey}`,
        ]

  return {
    suggestionKey: `workflow-dependency-key:${normalizedDependencyKey}`,
    value: normalizedDependencyKey,
    title: normalizedDependencyKey,
    subtitle:
      workflowChild.kind === 'planning'
        ? `workflow dependency key · ${workflowKey}`
        : `grouped workflow dependency key · ${workflowKey}`,
    preview: summarizePreviewText(
      previewParts.filter((part) => part && part.length > 0).join(' • '),
    ),
  }
}
