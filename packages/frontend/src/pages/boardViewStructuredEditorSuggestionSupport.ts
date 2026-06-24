import {
  type CapturedAnswer,
  type GoalDecision,
  type GoalPlanningRequest,
  type GoalPlanningWorkflowLeafState,
  type TodoTaskItem,
} from '../lib/api'
import {
  parseListInput,
  serializeBatchRequestEditorItems,
  serializeBlockerEditorItems,
  serializePlanningAnswerEditorItems,
} from './boardViewStructuredEditorCodec'
import type {
  BatchRequestEditorItem,
  BlockerEditorItem,
  DecisionAnswerEntryEditorItem,
  DecisionWorkflowChildEditorItem,
  PlanningAnswerEditorItem,
  ReusableAnswerSourceRoutingSuggestion,
  ReusableAnswerSourceSuggestion,
  ReusableBlockerSuggestion,
  ReusablePlanningAnswerSuggestion,
  ReusableStringSuggestion,
  WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'

export function buildBatchRequestEditorItemFromPlanningRequest(
  request: GoalPlanningRequest,
  linkedTask: TodoTaskItem | undefined,
  groupedTaskKeyByTaskRef: Map<string, string>,
): BatchRequestEditorItem | null {
  const taskKey = request.groupTaskKey?.trim()
  if (!taskKey) {
    return null
  }

  const blockedByTaskKeys = Array.from(
    new Set(
      (linkedTask?.blockedBy ?? [])
        .filter((blocker) => blocker.kind === 'task')
        .map((blocker) => groupedTaskKeyByTaskRef.get(blocker.ref) ?? '')
        .filter((value) => value.length > 0),
    ),
  )

  return {
    taskKey,
    requestKey: request.requestKey,
    title: request.title,
    description: request.description,
    acceptanceCriteria: request.acceptanceCriteria.join('\n'),
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
    blockedByTaskKeys: blockedByTaskKeys.join('\n'),
  }
}

export function buildDraftWorkflowDependencySuggestions(
  items: WorkflowChildEditorItem[],
  index: number,
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()

  for (const [itemIndex, item] of items.entries()) {
    if (itemIndex >= index) {
      break
    }
    const dependencyKey =
      item.kind === 'planning' ? item.workflowTaskKey.trim() : item.groupKey.trim()
    if (dependencyKey.length === 0 || seenValues.has(dependencyKey)) {
      continue
    }
    seenValues.add(dependencyKey)
    suggestions.push({
      suggestionKey: `draft-workflow-dependency:${itemIndex}:${dependencyKey}`,
      value: dependencyKey,
      title: dependencyKey,
      subtitle: `current draft child ${itemIndex + 1}`,
      preview: summarizePreviewText(
        [
          item.kind === 'planning' ? item.title.trim() : '',
          item.kind === 'planning' ? item.requestKey.trim() : item.groupKey.trim(),
          `kind=${item.kind}`,
        ]
          .filter((part) => part.length > 0)
          .join(' • '),
      ),
    })
  }

  return suggestions
}

export function buildDraftDecisionWorkflowDependencySuggestions(
  items: DecisionWorkflowChildEditorItem[],
  index: number,
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()

  for (const [itemIndex, item] of items.entries()) {
    if (itemIndex >= index) {
      break
    }
    const dependencyKey =
      item.kind === 'planning' ? item.workflowTaskKey.trim() : item.groupKey.trim()
    if (dependencyKey.length === 0 || seenValues.has(dependencyKey)) {
      continue
    }
    seenValues.add(dependencyKey)
    suggestions.push({
      suggestionKey: `draft-decision-workflow-dependency:${itemIndex}:${dependencyKey}`,
      value: dependencyKey,
      title: dependencyKey,
      subtitle: `current draft child ${itemIndex + 1}`,
      preview: summarizePreviewText(
        [
          item.kind === 'planning' ? item.title.trim() : '',
          item.kind === 'planning' ? item.workflowTaskKey.trim() : item.groupKey.trim(),
          `kind=${item.kind}`,
        ]
          .filter((part) => part.length > 0)
          .join(' • '),
      ),
    })
  }

  return suggestions
}

export function mergeReusableStringSuggestionsByValue(
  primary: ReusableStringSuggestion[],
  secondary: ReusableStringSuggestion[],
): ReusableStringSuggestion[] {
  const merged: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()

  for (const suggestion of [...primary, ...secondary]) {
    const value = suggestion.value.trim()
    if (value.length === 0 || seenValues.has(value)) {
      continue
    }
    seenValues.add(value)
    merged.push(suggestion)
  }

  return merged
}

export function createWorkflowRootGroupKeySuggestion(
  groupKey: string,
  requests: GoalPlanningRequest[],
): ReusableStringSuggestion | null {
  const normalizedGroupKey = groupKey.trim()
  if (normalizedGroupKey.length === 0 || requests.length === 0) {
    return null
  }

  const workflowKeys = Array.from(
    new Set(
      requests
        .map((request) => request.workflowKey?.trim() ?? '')
        .filter((value) => value.length > 0),
    ),
  )
  const previewParts = [
    `${requests.length} grouped request(s)`,
    requests.map((request) => request.title).join(', '),
    workflowKeys.length > 0 ? `workflow=${workflowKeys.join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `workflow-root-group-key:${normalizedGroupKey}`,
    value: normalizedGroupKey,
    title: normalizedGroupKey,
    subtitle:
      workflowKeys.length > 0
        ? `grouped planning surface · ${workflowKeys.join(', ')}`
        : 'grouped planning surface',
    preview:
      previewParts.length > 0 ? summarizePreviewText(previewParts.join(' • ')) : normalizedGroupKey,
  }
}

export function createTaskBlockerSuggestion(task: TodoTaskItem): ReusableBlockerSuggestion | null {
  if (task.status === 'done') {
    return null
  }

  const previewParts = [
    `status=${task.status}`,
    task.description.trim(),
    task.acceptanceCriteria.length > 0 ? `Criteria: ${task.acceptanceCriteria.join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `task:${task.ref}`,
    title: task.title,
    subtitle: `task blocker · ${task.ref}`,
    preview: summarizePreviewText(previewParts.join(' • ')),
    item: {
      kind: 'task',
      ref: task.ref,
    },
  }
}

export function createDecisionBlockerSuggestion(
  decision: GoalDecision,
): ReusableBlockerSuggestion | null {
  if (decision.status !== 'open') {
    return null
  }

  const previewParts = [
    decision.prompt?.trim(),
    decision.matchHints?.length ? `Hints: ${decision.matchHints.join(', ')}` : '',
    decision.taskRef ? `Task: ${decision.taskRef}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `decision:${decision.decisionKey}`,
    title: decision.summary,
    subtitle: `decision blocker · ${decision.decisionKey}`,
    preview:
      previewParts.length > 0
        ? summarizePreviewText(previewParts.join(' • '))
        : decision.decisionKey,
    item: {
      kind: 'decision',
      ref: decision.decisionKey,
    },
  }
}

export function buildDecisionAnswerEntrySuggestionIdentity(
  item: Pick<
    DecisionAnswerEntryEditorItem,
    | 'decisionKey'
    | 'summaryKey'
    | 'summary'
    | 'prompt'
    | 'matchHints'
    | 'taskRef'
    | 'answer'
    | 'sourceExcerpt'
    | 'sourceOccurrence'
    | 'answerSourceKey'
    | 'answerSourceGroupKey'
  >,
) {
  const decisionKey = item.decisionKey.trim()
  if (decisionKey.length > 0) {
    return `decision:${decisionKey}`
  }

  const summaryKey = item.summaryKey.trim()
  if (summaryKey.length > 0) {
    return `summaryKey:${summaryKey}`
  }

  const summary = normalizeEditorIdentityPart(item.summary)
  const prompt = normalizeEditorIdentityPart(item.prompt)
  const matchHints = normalizeEditorIdentityList(item.matchHints)
  const taskRef = normalizeEditorIdentityPart(item.taskRef)
  const answer = normalizeEditorIdentityPart(item.answer)
  const sourceExcerpt = normalizeEditorIdentityPart(item.sourceExcerpt)
  const sourceOccurrence = normalizeEditorIdentityPart(item.sourceOccurrence)
  const answerSourceKey = normalizeEditorIdentityPart(item.answerSourceKey)
  const answerSourceGroupKey = normalizeEditorIdentityPart(item.answerSourceGroupKey)
  const compositeParts = [
    summary.length > 0 ? `summary=${summary}` : '',
    prompt.length > 0 ? `prompt=${prompt}` : '',
    matchHints.length > 0 ? `matchHints=${matchHints.join(',')}` : '',
    taskRef.length > 0 ? `task=${taskRef}` : '',
    answer.length > 0 ? `answer=${answer}` : '',
    sourceExcerpt.length > 0 ? `excerpt=${sourceExcerpt}` : '',
    sourceOccurrence.length > 0 ? `occurrence=${sourceOccurrence}` : '',
    answerSourceKey.length > 0 ? `answerSourceKey=${answerSourceKey}` : '',
    answerSourceGroupKey.length > 0 ? `answerSourceGroupKey=${answerSourceGroupKey}` : '',
  ].filter((part) => part.length > 0)

  if (compositeParts.length > 0) {
    return `composite:${compositeParts.join('|')}`
  }

  return null
}

export function buildPlanningAnswerEditorSuggestionIdentity(
  item: Pick<
    PlanningAnswerEditorItem,
    | 'answerKey'
    | 'summaryKey'
    | 'summary'
    | 'prompt'
    | 'matchHints'
    | 'answer'
    | 'sourceExcerpt'
    | 'sourceOccurrence'
    | 'answerSourceKey'
    | 'answerSourceGroupKey'
  >,
) {
  const answerKey = item.answerKey.trim()
  if (answerKey.length > 0) {
    return `answer:${answerKey}`
  }

  const summaryKey = item.summaryKey.trim()
  if (summaryKey.length > 0) {
    return `summaryKey:${summaryKey}`
  }

  const summary = normalizeEditorIdentityPart(item.summary)
  const prompt = normalizeEditorIdentityPart(item.prompt)
  const matchHints = normalizeEditorIdentityList(item.matchHints)
  const answer = normalizeEditorIdentityPart(item.answer)
  const sourceExcerpt = normalizeEditorIdentityPart(item.sourceExcerpt)
  const sourceOccurrence = normalizeEditorIdentityPart(item.sourceOccurrence)
  const answerSourceKey = normalizeEditorIdentityPart(item.answerSourceKey)
  const answerSourceGroupKey = normalizeEditorIdentityPart(item.answerSourceGroupKey)
  const compositeParts = [
    summary.length > 0 ? `summary=${summary}` : '',
    prompt.length > 0 ? `prompt=${prompt}` : '',
    matchHints.length > 0 ? `matchHints=${matchHints.join(',')}` : '',
    answer.length > 0 ? `answer=${answer}` : '',
    sourceExcerpt.length > 0 ? `excerpt=${sourceExcerpt}` : '',
    sourceOccurrence.length > 0 ? `occurrence=${sourceOccurrence}` : '',
    answerSourceKey.length > 0 ? `answerSourceKey=${answerSourceKey}` : '',
    answerSourceGroupKey.length > 0 ? `answerSourceGroupKey=${answerSourceGroupKey}` : '',
  ].filter((part) => part.length > 0)

  if (compositeParts.length > 0) {
    return `composite:${compositeParts.join('|')}`
  }

  return null
}

export function normalizeEditorIdentityPart(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function normalizeEditorIdentityList(value: string) {
  return parseListInput(value).map((entry) => normalizeEditorIdentityPart(entry))
}

export function buildEditorAnswerSourceIdentity(item: {
  answerSourceKey: string
  answerSourceGroupKey?: string
  sourceGroupKey?: string
  route?: string
  decisionKey?: string
  summary: string
  answer: string
  sourceExcerpt: string
  sourceOccurrence: string
  prompt: string
  summaryKey: string
  answerKey?: string
  matchHints: string
}) {
  const answerSourceKey = item.answerSourceKey.trim()
  const answerSourceGroupKey = (item.sourceGroupKey ?? item.answerSourceGroupKey ?? '').trim()

  if (answerSourceKey.length > 0 || answerSourceGroupKey.length > 0) {
    return [answerSourceKey, answerSourceGroupKey].filter((entry) => entry.length > 0).join('::')
  }

  const compositeParts = [
    normalizeEditorIdentityPart(item.route ?? ''),
    normalizeEditorIdentityPart(item.decisionKey ?? ''),
    normalizeEditorIdentityPart(item.answerKey ?? ''),
    normalizeEditorIdentityPart(item.summaryKey),
    normalizeEditorIdentityPart(item.summary),
    normalizeEditorIdentityPart(item.prompt),
    normalizeEditorIdentityList(item.matchHints).join('|'),
    normalizeEditorIdentityPart(item.answer),
    normalizeEditorIdentityPart(item.sourceExcerpt),
    normalizeEditorIdentityPart(item.sourceOccurrence),
  ].filter((entry) => entry.length > 0)

  if (compositeParts.length > 0) {
    return `composite:${compositeParts.join('|')}`
  }

  return null
}

export function buildBlockerSuggestionIdentity(item: Pick<BlockerEditorItem, 'kind' | 'ref'>) {
  const kind = item.kind.trim()
  const ref = item.ref.trim()
  if (kind.length === 0 || ref.length === 0) {
    return null
  }
  return `${kind}:${ref}`
}

export function appendUniqueBlockerEditorItems(
  items: BlockerEditorItem[],
  nextItems: BlockerEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildBlockerSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildBlockerSuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function createPlanningAnswerSourceSuggestion(
  request: GoalPlanningRequest,
  answer: CapturedAnswer,
  kind: 'request' | 'workflow_shared',
): ReusableAnswerSourceSuggestion | null {
  if (!answer.answer.trim()) {
    return null
  }

  const requestScope =
    kind === 'workflow_shared'
      ? (request.workflowKey ?? request.groupKey ?? request.requestKey)
      : request.requestKey
  const sourceKey =
    answer.answerKey ||
    `${kind === 'workflow_shared' ? 'workflow' : 'request'}-${requestScope}-${slugifySourceKeyPart(
      answer.summaryKey || answer.summary,
    )}`

  return {
    suggestionKey: `${kind}:${request.requestKey}:${sourceKey}`,
    title: answer.summary,
    subtitle:
      kind === 'workflow_shared'
        ? `workflow-shared · ${request.workflowKey ?? request.requestKey}`
        : `planning request · ${request.requestKey}`,
    preview: summarizePreviewText(answer.answer),
    item: {
      answerSourceKey: sourceKey,
      route: 'planning',
      summary: answer.summary,
      answer: answer.answer,
      sourceExcerpt: '',
      sourceOccurrence: '',
      sourceGroupKey:
        kind === 'workflow_shared'
          ? (request.workflowKey ?? request.groupKey ?? request.requestKey)
          : (request.groupKey ?? request.requestKey),
      decisionKey: '',
      prompt: answer.prompt ?? '',
      summaryKey: answer.summaryKey ?? '',
      answerKey: answer.answerKey ?? '',
      matchHints: (answer.matchHints ?? []).join('\n'),
    },
  }
}

export function createPlanningAnswerSourceRoutingSuggestionFromPlanningAnswerItem(
  item: PlanningAnswerEditorItem,
  index: number,
): ReusableAnswerSourceRoutingSuggestion | null {
  const summary = item.summary.trim()
  const prompt = item.prompt.trim()
  const summaryKey = item.summaryKey.trim()
  const answerKey = item.answerKey.trim()
  const answerSourceGroupKey = item.answerSourceGroupKey.trim()
  const matchHints = item.matchHints.trim()
  if (
    summary.length === 0 &&
    prompt.length === 0 &&
    summaryKey.length === 0 &&
    answerKey.length === 0 &&
    answerSourceGroupKey.length === 0 &&
    matchHints.length === 0
  ) {
    return null
  }

  const stableIdentity =
    answerKey ||
    summaryKey ||
    answerSourceGroupKey ||
    summary ||
    prompt ||
    `planning-consumer-${index + 1}`
  const previewParts = [
    'route=planning',
    answerKey.length > 0 ? `answerKey=${answerKey}` : '',
    answerSourceGroupKey.length > 0 ? `sourceGroup=${answerSourceGroupKey}` : '',
    summary.length > 0 ? summary : prompt,
    matchHints.length > 0 ? `matchHints=${parseListInput(matchHints).join(', ')}` : '',
  ].filter((part) => part && part.length > 0)

  return {
    suggestionKey: `answer-source-route:planning:${slugifySourceKeyPart(stableIdentity)}`,
    title: summary || prompt || answerKey || `Planning consumer ${index + 1}`,
    subtitle:
      answerKey.length > 0
        ? `planning route · ${answerKey}`
        : `planning route · current consumer ${index + 1}`,
    preview: summarizePreviewText(previewParts.join(' • ')),
    item: {
      answerSourceKey: `planning-${slugifySourceKeyPart(stableIdentity)}-source`,
      route: 'planning',
      summary,
      answer: '',
      sourceExcerpt: '',
      sourceOccurrence: '',
      sourceGroupKey: answerSourceGroupKey,
      decisionKey: '',
      prompt,
      summaryKey,
      answerKey,
      matchHints,
    },
  }
}

export function createCapturedPlanningAnswerSuggestion(
  request: GoalPlanningRequest,
  answer: CapturedAnswer,
  kind: 'request' | 'workflow_shared',
): ReusablePlanningAnswerSuggestion | null {
  if (!answer.answer.trim()) {
    return null
  }

  const requestScope =
    kind === 'workflow_shared'
      ? (request.workflowKey ?? request.groupKey ?? request.requestKey)
      : request.requestKey
  const stableAnswerKey =
    answer.answerKey ||
    `${kind === 'workflow_shared' ? 'workflow' : 'request'}-${requestScope}-${slugifySourceKeyPart(
      answer.summaryKey || answer.summary,
    )}`

  return {
    suggestionKey: `${kind}:${request.requestKey}:${stableAnswerKey}`,
    title: answer.summary,
    subtitle:
      kind === 'workflow_shared'
        ? `workflow-shared · ${request.workflowKey ?? request.requestKey}`
        : `planning request · ${request.requestKey}`,
    preview: summarizePreviewText(answer.answer),
    item: {
      summary: answer.summary,
      answer: answer.answer,
      sourceExcerpt: '',
      sourceOccurrence: '',
      prompt: answer.prompt ?? '',
      summaryKey: answer.summaryKey ?? '',
      answerKey: answer.answerKey ?? stableAnswerKey,
      matchHints: (answer.matchHints ?? []).join('\n'),
      answerSourceKey: '',
      answerSourceGroupKey:
        kind === 'workflow_shared'
          ? (request.workflowKey ?? request.groupKey ?? request.requestKey)
          : (request.groupKey ?? request.requestKey),
    },
  }
}

function createPlanningAnswerEditorItemFromCapturedAnswer(
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

export function serializePlanningAnswersFromPlanningRequests(requests: GoalPlanningRequest[]) {
  const answers = collectUniqueCapturedAnswersFromPlanningRequests(requests)
  if (answers.length === 0) {
    return ''
  }

  return serializePlanningAnswerEditorItems(
    answers.map((answer) => createPlanningAnswerEditorItemFromCapturedAnswer(answer)),
  )
}

export function createWorkflowChildEditorItemFromWorkflowLeaf(
  workflowChild: GoalPlanningWorkflowLeafState,
  tasksByRef: Map<string, TodoTaskItem>,
  groupedTaskKeyByTaskRef: Map<string, string>,
): WorkflowChildEditorItem {
  if (workflowChild.kind === 'planning') {
    const linkedTask = tasksByRef.get(workflowChild.request.taskRef)
    return {
      kind: 'planning',
      requestKey: workflowChild.request.requestKey,
      workflowTaskKey: workflowChild.workflowTaskKey ?? '',
      groupKey: workflowChild.request.groupKey ?? workflowChild.groupKey ?? '',
      blockedByWorkflowKeys: workflowChild.blockedByWorkflowKeys.join('\n'),
      blockedByJson:
        linkedTask && linkedTask.blockedBy.length > 0
          ? serializeBlockerEditorItems(
              linkedTask.blockedBy.map((blocker) => ({
                kind: blocker.kind,
                ref: blocker.ref,
              })),
            )
          : '',
      title: workflowChild.request.title,
      description: workflowChild.request.description,
      acceptanceCriteria: workflowChild.request.acceptanceCriteria.join('\n'),
      decisionRefs: workflowChild.request.decisionRefs.join('\n'),
      answersJson: serializePlanningAnswerEditorItems(
        workflowChild.request.answers.map((answer) =>
          createPlanningAnswerEditorItemFromCapturedAnswer(answer),
        ),
      ),
      requestedUpdates: workflowChild.request.requestedUpdates.join('\n'),
      batchRequestsJson: '',
    }
  }

  return {
    kind: 'planning_batch',
    requestKey: '',
    workflowTaskKey: '',
    groupKey: workflowChild.groupKey,
    blockedByWorkflowKeys: workflowChild.blockedByWorkflowKeys.join('\n'),
    blockedByJson: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    decisionRefs: collectUniquePlanningRequestDecisionRefs(workflowChild.requests).join('\n'),
    answersJson: serializePlanningAnswersFromPlanningRequests(workflowChild.requests),
    requestedUpdates: '',
    batchRequestsJson: serializeBatchRequestEditorItems(
      workflowChild.requests
        .map((request) =>
          buildBatchRequestEditorItemFromPlanningRequest(
            request,
            tasksByRef.get(request.taskRef),
            groupedTaskKeyByTaskRef,
          ),
        )
        .filter((item): item is BatchRequestEditorItem => item !== null),
    ),
  }
}

export function createDecisionWorkflowChildEditorItemFromWorkflowLeaf(
  workflowChild: GoalPlanningWorkflowLeafState,
  tasksByRef: Map<string, TodoTaskItem>,
  groupedTaskKeyByTaskRef: Map<string, string>,
): DecisionWorkflowChildEditorItem {
  if (workflowChild.kind === 'planning') {
    return {
      kind: 'planning',
      workflowTaskKey: workflowChild.workflowTaskKey ?? '',
      groupKey: '',
      blockedByWorkflowKeys: workflowChild.blockedByWorkflowKeys.join('\n'),
      title: workflowChild.request.title,
      description: workflowChild.request.description,
      acceptanceCriteria: workflowChild.request.acceptanceCriteria.join('\n'),
      answersJson: serializePlanningAnswerEditorItems(
        workflowChild.request.answers.map((answer) =>
          createPlanningAnswerEditorItemFromCapturedAnswer(answer),
        ),
      ),
      requestedUpdates: workflowChild.request.requestedUpdates.join('\n'),
      batchRequestsJson: '',
    }
  }

  return {
    kind: 'planning_batch',
    workflowTaskKey: '',
    groupKey: workflowChild.groupKey,
    blockedByWorkflowKeys: workflowChild.blockedByWorkflowKeys.join('\n'),
    title: '',
    description: '',
    acceptanceCriteria: '',
    answersJson: serializePlanningAnswersFromPlanningRequests(workflowChild.requests),
    requestedUpdates: '',
    batchRequestsJson: serializeBatchRequestEditorItems(
      workflowChild.requests
        .map((request) =>
          buildBatchRequestEditorItemFromPlanningRequest(
            request,
            tasksByRef.get(request.taskRef),
            groupedTaskKeyByTaskRef,
          ),
        )
        .filter((item): item is BatchRequestEditorItem => item !== null),
    ),
  }
}

export function collectUniquePlanningRequestDecisionRefs(requests: GoalPlanningRequest[]) {
  return Array.from(new Set(requests.flatMap((request) => request.decisionRefs)))
}

export function collectUniqueWorkflowSharedDecisionRefsFromPlanningRequests(
  requests: GoalPlanningRequest[],
) {
  return Array.from(new Set(requests.flatMap((request) => request.workflowSharedDecisionRefs)))
}

export function collectUniqueCapturedAnswersFromPlanningRequests(requests: GoalPlanningRequest[]) {
  const answers: CapturedAnswer[] = []
  const seenKeys = new Set<string>()

  for (const request of requests) {
    for (const answer of request.answers) {
      const identity =
        answer.answerKey?.trim() ||
        answer.summaryKey?.trim() ||
        `${answer.summary.trim().toLowerCase()}::${answer.answer.trim()}`
      if (!identity || seenKeys.has(identity)) {
        continue
      }
      seenKeys.add(identity)
      answers.push(answer)
    }
  }

  return answers
}

export function collectUniqueWorkflowSharedAnswersFromPlanningRequests(
  requests: GoalPlanningRequest[],
) {
  const answers: CapturedAnswer[] = []
  const seenKeys = new Set<string>()

  for (const request of requests) {
    for (const answer of request.workflowSharedAnswers) {
      const identity =
        answer.answerKey?.trim() ||
        answer.summaryKey?.trim() ||
        `${answer.summary.trim().toLowerCase()}::${answer.answer.trim()}`
      if (!identity || seenKeys.has(identity)) {
        continue
      }
      seenKeys.add(identity)
      answers.push(answer)
    }
  }

  return answers
}

export function slugifySourceKeyPart(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : 'answer'
}

export function summarizePreviewText(value: string, maxLength = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 1)}…`
}
