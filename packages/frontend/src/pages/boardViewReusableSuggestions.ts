import {
  type GoalDecision,
  type GoalPlanningRequest,
  type GoalPlanningWorkflowState,
  type PreferenceEntry,
  type TodoTaskItem,
} from '../lib/api'
import {
  type BatchRequestEditorItem,
  type DecisionAnswerEntryEditorItem,
  type PlanningAnswerEditorItem,
  type ReusableAnswerSourceRoutingSuggestion,
  type ReusableAnswerSourceSuggestion,
  type ReusableBatchRequestGroupSuggestion,
  type ReusableBatchRequestSuggestion,
  type ReusableBlockerSuggestion,
  type ReusableDecisionAnswerSuggestion,
  type ReusableDecisionWorkflowChildSuggestion,
  type ReusablePlanningAnswerSuggestion,
  type ReusablePlanningRequestSuggestion,
  type ReusableStringSuggestion,
  type ReusableWorkflowChildSuggestion,
  type ReusableWorkflowContextSuggestion,
  type ReusableWorkflowGraphSuggestion,
} from './boardViewStructuredEditorTypes'
import {
  buildBatchRequestEditorItemFromPlanningRequest,
  collectUniqueCapturedAnswersFromPlanningRequests,
  collectUniquePlanningRequestDecisionRefs,
  createCapturedPlanningAnswerSuggestion,
  createDecisionBlockerSuggestion,
  createPlanningAnswerSourceRoutingSuggestionFromPlanningAnswerItem,
  createPlanningAnswerSourceSuggestion,
  createTaskBlockerSuggestion,
  createWorkflowRootGroupKeySuggestion,
  parseListInput,
  parseWorkflowChildEditorItems,
  serializeBatchRequestEditorItems,
  serializePlanningAnswersFromPlanningRequests,
  summarizePreviewText,
} from './boardViewStructuredEditors'
import {
  createBatchRequestSuggestion,
  createDecisionAnswerSourceSuggestion,
  createDecisionAnswerSourceRoutingSuggestionFromDecision,
  createDecisionAnswerSourceRoutingSuggestionFromDecisionAnswerItem,
  createDecisionPlanningAnswerSuggestion,
  createDecisionRefSuggestion,
  createDecisionWorkflowChildSuggestion,
  createOpenDecisionAnswerSuggestion,
  createPlanningGroupKeySuggestion,
  createPlanningGroupTaskKeySuggestion,
  createPlanningRequestKeySuggestion,
  createPlanningRequestSuggestion,
  createPreferenceKeySuggestion,
  createTaskRefSuggestion,
  buildGroupedTaskKeyByTaskRefForWorkflow,
  createWorkflowChildSuggestion,
  createWorkflowContextSuggestion,
  createWorkflowDependencyKeySuggestion,
  createWorkflowGraphSuggestion,
  createWorkflowGroupKeySuggestion,
  createWorkflowKeySuggestion,
  createWorkflowRootTaskRefSuggestion,
  createWorkflowTaskKeySuggestion,
  createWorkflowTaskRefSuggestion,
} from './boardViewReusableSuggestionFactories'

export * from './boardViewReusableSuggestionFactories'
export * from './boardViewWorkflowSummarySupport'

export function buildReusableAnswerSourceSuggestions(
  decisions: GoalDecision[],
  requests: GoalPlanningRequest[],
): ReusableAnswerSourceSuggestion[] {
  const suggestions: ReusableAnswerSourceSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  const pushSuggestion = (suggestion: ReusableAnswerSourceSuggestion | null) => {
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      return
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  for (const decision of decisions) {
    pushSuggestion(createDecisionAnswerSourceSuggestion(decision))
  }

  for (const request of requests) {
    for (const answer of request.answers) {
      pushSuggestion(createPlanningAnswerSourceSuggestion(request, answer, 'request'))
    }
    for (const answer of request.workflowSharedAnswers) {
      pushSuggestion(createPlanningAnswerSourceSuggestion(request, answer, 'workflow_shared'))
    }
  }

  return suggestions
}

export function buildReusableAnswerSourceRoutingSuggestions({
  decisions = [],
  decisionAnswerItems = [],
  planningAnswerItems = [],
}: {
  decisions?: GoalDecision[]
  decisionAnswerItems?: DecisionAnswerEntryEditorItem[]
  planningAnswerItems?: PlanningAnswerEditorItem[]
}) {
  const suggestions: ReusableAnswerSourceRoutingSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  const pushSuggestion = (suggestion: ReusableAnswerSourceRoutingSuggestion | null) => {
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      return
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  for (const decision of decisions) {
    pushSuggestion(createDecisionAnswerSourceRoutingSuggestionFromDecision(decision))
  }

  decisionAnswerItems.forEach((item, index) => {
    pushSuggestion(createDecisionAnswerSourceRoutingSuggestionFromDecisionAnswerItem(item, index))
  })

  planningAnswerItems.forEach((item, index) => {
    pushSuggestion(createPlanningAnswerSourceRoutingSuggestionFromPlanningAnswerItem(item, index))
  })

  return suggestions
}

export function mergeReusableAnswerSourceRoutingSuggestions(
  ...groups: Array<ReusableAnswerSourceRoutingSuggestion[]>
) {
  const merged: ReusableAnswerSourceRoutingSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const group of groups) {
    for (const suggestion of group) {
      if (seenSuggestionKeys.has(suggestion.suggestionKey)) {
        continue
      }
      seenSuggestionKeys.add(suggestion.suggestionKey)
      merged.push(suggestion)
    }
  }

  return merged
}

export function buildReusablePlanningAnswerSuggestions(
  decisions: GoalDecision[],
  requests: GoalPlanningRequest[],
): ReusablePlanningAnswerSuggestion[] {
  const suggestions: ReusablePlanningAnswerSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  const pushSuggestion = (suggestion: ReusablePlanningAnswerSuggestion | null) => {
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      return
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  for (const decision of decisions) {
    pushSuggestion(createDecisionPlanningAnswerSuggestion(decision))
  }

  for (const request of requests) {
    for (const answer of request.answers) {
      pushSuggestion(createCapturedPlanningAnswerSuggestion(request, answer, 'request'))
    }
    for (const answer of request.workflowSharedAnswers) {
      pushSuggestion(createCapturedPlanningAnswerSuggestion(request, answer, 'workflow_shared'))
    }
  }

  return suggestions
}

export function buildReusableDecisionAnswerSuggestions(
  decisions: GoalDecision[],
): ReusableDecisionAnswerSuggestion[] {
  const suggestions: ReusableDecisionAnswerSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  const pushSuggestion = (suggestion: ReusableDecisionAnswerSuggestion | null) => {
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      return
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  for (const decision of decisions) {
    pushSuggestion(createOpenDecisionAnswerSuggestion(decision))
  }

  return suggestions
}

export function buildReusablePlanningRequestSuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusablePlanningRequestSuggestion[] {
  const suggestions: ReusablePlanningRequestSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))
  const reusableRequests = listReusableOpenPlanningRequests(requests, tasks)

  for (const request of reusableRequests) {
    const suggestion = createPlanningRequestSuggestion(request, tasksByRef.get(request.taskRef))
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableDecisionRefSuggestions(
  decisions: GoalDecision[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const decision of decisions) {
    const suggestion = createDecisionRefSuggestion(decision)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusablePlanningRequestKeySuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const reusableRequests = listReusableOpenPlanningRequests(requests, tasks)

  for (const request of reusableRequests) {
    const suggestion = createPlanningRequestKeySuggestion(request)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusablePlanningGroupKeySuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const reusableRequests = listReusableOpenPlanningRequests(requests, tasks)

  for (const request of reusableRequests) {
    const suggestion = createPlanningGroupKeySuggestion(request)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusablePlanningGroupTaskKeySuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const reusableRequests = listReusableOpenPlanningRequests(requests, tasks)

  for (const request of reusableRequests) {
    const suggestion = createPlanningGroupTaskKeySuggestion(request)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function listReusableOpenPlanningRequests(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
) {
  const taskByRef = new Map(tasks.map((task) => [task.ref, task]))

  return requests.filter((request) => {
    if (request.status !== 'open') {
      return false
    }
    const task = taskByRef.get(request.taskRef)
    return Boolean(task && task.status !== 'done')
  })
}

export function buildReusableBatchRequestSuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusableBatchRequestSuggestion[] {
  const suggestions: ReusableBatchRequestSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))
  const reusableGroupedRequests = listReusableGroupedPlanningRequests(requests, tasks)
  const groupedTaskKeyByTaskRef = new Map<string, string>()

  for (const request of reusableGroupedRequests) {
    const groupTaskKey = request.groupTaskKey?.trim()
    if (!groupTaskKey) {
      continue
    }
    if (!groupedTaskKeyByTaskRef.has(request.taskRef)) {
      groupedTaskKeyByTaskRef.set(request.taskRef, groupTaskKey)
    }
  }

  for (const request of reusableGroupedRequests) {
    const suggestion = createBatchRequestSuggestion(
      request,
      tasksByRef.get(request.taskRef),
      groupedTaskKeyByTaskRef,
    )
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableBatchRequestGroupSuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
): ReusableBatchRequestGroupSuggestion[] {
  const suggestions: ReusableBatchRequestGroupSuggestion[] = []
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))
  const reusableGroupedRequests = listReusableGroupedPlanningRequests(requests, tasks)
  const groupedTaskKeyByTaskRef = new Map<string, string>()
  const requestsByGroupKey = new Map<string, GoalPlanningRequest[]>()

  for (const request of reusableGroupedRequests) {
    const groupTaskKey = request.groupTaskKey?.trim()
    if (groupTaskKey && !groupedTaskKeyByTaskRef.has(request.taskRef)) {
      groupedTaskKeyByTaskRef.set(request.taskRef, groupTaskKey)
    }

    const groupKey = request.groupKey?.trim()
    if (!groupKey) {
      continue
    }

    const current = requestsByGroupKey.get(groupKey) ?? []
    current.push(request)
    requestsByGroupKey.set(groupKey, current)
  }

  for (const [groupKey, groupedRequests] of requestsByGroupKey) {
    const batchItems = groupedRequests
      .map((request) =>
        buildBatchRequestEditorItemFromPlanningRequest(
          request,
          tasksByRef.get(request.taskRef),
          groupedTaskKeyByTaskRef,
        ),
      )
      .filter((item): item is BatchRequestEditorItem => item !== null)

    if (batchItems.length === 0) {
      continue
    }

    const decisionRefs = collectUniquePlanningRequestDecisionRefs(groupedRequests).join('\n')
    const decisionRefCount = parseListInput(decisionRefs).length
    const sharedAnswersJson = serializePlanningAnswersFromPlanningRequests(groupedRequests)
    const sharedAnswerCount =
      collectUniqueCapturedAnswersFromPlanningRequests(groupedRequests).length
    const blockedByWorkflowKeys = Array.from(
      new Set(groupedRequests.flatMap((request) => request.blockedByWorkflowKeys)),
    )
    const previewParts = [
      `${batchItems.length} grouped request(s)`,
      groupedRequests.map((request) => request.title).join(', '),
      decisionRefCount > 0 ? `decisionRefs=${decisionRefCount}` : '',
      sharedAnswerCount > 0 ? `sharedAnswers=${sharedAnswerCount}` : '',
      blockedByWorkflowKeys.length > 0 ? `workflowDeps=${blockedByWorkflowKeys.join(', ')}` : '',
    ].filter((part) => part && part.length > 0)
    const workflowKey = groupedRequests
      .map((request) => request.workflowKey?.trim() ?? '')
      .find((value) => value.length > 0)

    suggestions.push({
      suggestionKey: `batch-request-group:${groupKey}`,
      title: groupKey,
      subtitle: workflowKey
        ? `grouped planning sink · workflow ${workflowKey}`
        : 'grouped planning sink',
      preview: summarizePreviewText(previewParts.join(' • ')),
      item: {
        groupKey,
        blockedByWorkflowKeys: blockedByWorkflowKeys.join('\n'),
        decisionRefs,
        answersJson: sharedAnswersJson,
        batchRequestsJson: serializeBatchRequestEditorItems(batchItems),
      },
    })
  }

  return suggestions
}

export function listReusableGroupedPlanningRequests(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
) {
  const taskByRef = new Map(tasks.map((task) => [task.ref, task]))

  return requests.filter((request) => {
    const groupTaskKey = request.groupTaskKey?.trim()
    if (!groupTaskKey || request.status !== 'open') {
      return false
    }
    const task = taskByRef.get(request.taskRef)
    return Boolean(task && task.status !== 'done')
  })
}

export function buildReusableWorkflowGraphSuggestions(
  workflows: GoalPlanningWorkflowState[],
  tasks: TodoTaskItem[],
): ReusableWorkflowGraphSuggestion[] {
  const suggestions: ReusableWorkflowGraphSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))

  for (const workflow of workflows) {
    const suggestion = createWorkflowGraphSuggestion(workflow, tasksByRef)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableWorkflowChildSuggestions(
  workflows: GoalPlanningWorkflowState[],
  tasks: TodoTaskItem[],
): ReusableWorkflowChildSuggestion[] {
  const suggestions: ReusableWorkflowChildSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))

  for (const workflow of workflows) {
    const groupedTaskKeyByTaskRef = buildGroupedTaskKeyByTaskRefForWorkflow(workflow)
    workflow.workflows.forEach((workflowChild, index) => {
      const suggestion = createWorkflowChildSuggestion(
        workflow,
        workflowChild,
        index,
        tasksByRef,
        groupedTaskKeyByTaskRef,
      )
      if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
        return
      }
      seenSuggestionKeys.add(suggestion.suggestionKey)
      suggestions.push(suggestion)
    })
  }

  return suggestions
}

export function buildReusableDecisionWorkflowChildSuggestions(
  workflows: GoalPlanningWorkflowState[],
  tasks: TodoTaskItem[],
): ReusableDecisionWorkflowChildSuggestion[] {
  const suggestions: ReusableDecisionWorkflowChildSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const tasksByRef = new Map(tasks.map((task) => [task.ref, task]))

  for (const workflow of workflows) {
    const groupedTaskKeyByTaskRef = buildGroupedTaskKeyByTaskRefForWorkflow(workflow)
    workflow.workflows.forEach((workflowChild, index) => {
      const suggestion = createDecisionWorkflowChildSuggestion(
        workflow,
        workflowChild,
        index,
        tasksByRef,
        groupedTaskKeyByTaskRef,
      )
      if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
        return
      }
      seenSuggestionKeys.add(suggestion.suggestionKey)
      suggestions.push(suggestion)
    })
  }

  return suggestions
}

export function buildReusableWorkflowContextSuggestions(
  workflows: GoalPlanningWorkflowState[],
): ReusableWorkflowContextSuggestion[] {
  const suggestions: ReusableWorkflowContextSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const workflow of workflows) {
    const suggestion = createWorkflowContextSuggestion(workflow)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableWorkflowKeySuggestions(
  workflows: GoalPlanningWorkflowState[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const workflow of workflows) {
    const suggestion = createWorkflowKeySuggestion(workflow)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableTaskRefSuggestions(tasks: TodoTaskItem[]): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const task of tasks) {
    const suggestion = createTaskRefSuggestion(task)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusablePreferenceKeySuggestions(
  entries: PreferenceEntry[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  for (const entry of entries) {
    const suggestion = createPreferenceKeySuggestion(entry)
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableWorkflowTaskRefSuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
  workflows: GoalPlanningWorkflowState[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()

  const pushSuggestion = (suggestion: ReusableStringSuggestion | null) => {
    const value = suggestion?.value.trim() ?? ''
    if (!suggestion || value.length === 0 || seenValues.has(value)) {
      return
    }
    seenValues.add(value)
    suggestions.push(suggestion)
  }

  const openPlanningTaskRefSet = new Set(
    tasks
      .filter((task) => task.kind === 'planning' && task.status !== 'done')
      .map((task) => task.ref),
  )
  const openRequestByTaskRef = new Map<string, GoalPlanningRequest>()
  for (const request of requests) {
    if (request.status !== 'open' || !openPlanningTaskRefSet.has(request.taskRef)) {
      continue
    }
    if (!openRequestByTaskRef.has(request.taskRef)) {
      openRequestByTaskRef.set(request.taskRef, request)
    }
  }

  for (const task of tasks) {
    if (task.kind !== 'planning' || task.status === 'done') {
      continue
    }
    pushSuggestion(createWorkflowRootTaskRefSuggestion(task, openRequestByTaskRef.get(task.ref)))
  }

  for (const workflow of workflows) {
    for (const taskRef of workflow.taskRefs) {
      pushSuggestion(createWorkflowTaskRefSuggestion(taskRef, workflow))
    }
  }

  return suggestions
}

export function buildReusableWorkflowTaskKeySuggestions(
  workflowGraphs: ReusableWorkflowGraphSuggestion[],
  workflowKey: string,
): ReusableStringSuggestion[] {
  const normalizedWorkflowKey = workflowKey.trim()
  if (normalizedWorkflowKey.length === 0) {
    return []
  }

  const suggestions: ReusableStringSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()
  const workflowGraph = workflowGraphs.find(
    (suggestion) => suggestion.item.workflowKey === normalizedWorkflowKey,
  )
  if (!workflowGraph) {
    return suggestions
  }

  const { items } = parseWorkflowChildEditorItems(workflowGraph.item.childrenJson)
  for (const item of items) {
    if (item.kind !== 'planning' || !item.workflowTaskKey.trim()) {
      continue
    }
    const suggestion = createWorkflowTaskKeySuggestion(
      item.workflowTaskKey,
      workflowGraph.item.workflowKey,
    )
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      continue
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  return suggestions
}

export function buildReusableWorkflowGroupKeySuggestions(
  requests: GoalPlanningRequest[],
  tasks: TodoTaskItem[],
  workflows: GoalPlanningWorkflowState[],
): ReusableStringSuggestion[] {
  const suggestions: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()

  const pushSuggestion = (suggestion: ReusableStringSuggestion | null) => {
    const value = suggestion?.value.trim() ?? ''
    if (!suggestion || value.length === 0 || seenValues.has(value)) {
      return
    }
    seenValues.add(value)
    suggestions.push(suggestion)
  }

  const openTaskRefSet = new Set(
    tasks.filter((task) => task.status !== 'done').map((task) => task.ref),
  )
  const openRequestsByGroupKey = new Map<string, GoalPlanningRequest[]>()
  for (const request of requests) {
    const groupKey = request.groupKey?.trim()
    if (!groupKey || request.status !== 'open' || !openTaskRefSet.has(request.taskRef)) {
      continue
    }
    const current = openRequestsByGroupKey.get(groupKey) ?? []
    current.push(request)
    openRequestsByGroupKey.set(groupKey, current)
  }

  for (const [groupKey, groupedRequests] of openRequestsByGroupKey) {
    pushSuggestion(createWorkflowRootGroupKeySuggestion(groupKey, groupedRequests))
  }

  for (const workflow of workflows) {
    for (const groupKey of workflow.groupKeys) {
      pushSuggestion(createWorkflowGroupKeySuggestion(groupKey, workflow))
    }
  }

  return suggestions
}

export function buildReusableWorkflowDependencyKeySuggestions(
  workflowGraphs: ReusableWorkflowGraphSuggestion[],
  workflowKey: string,
): ReusableStringSuggestion[] {
  const normalizedWorkflowKey = workflowKey.trim()
  if (normalizedWorkflowKey.length === 0) {
    return []
  }

  const suggestions: ReusableStringSuggestion[] = []
  const seenValues = new Set<string>()
  const workflowGraph = workflowGraphs.find(
    (suggestion) => suggestion.item.workflowKey === normalizedWorkflowKey,
  )
  if (!workflowGraph) {
    return suggestions
  }

  const pushSuggestion = (suggestion: ReusableStringSuggestion | null) => {
    const value = suggestion?.value.trim() ?? ''
    if (!suggestion || value.length === 0 || seenValues.has(value)) {
      return
    }
    seenValues.add(value)
    suggestions.push(suggestion)
  }

  const { items } = parseWorkflowChildEditorItems(workflowGraph.item.childrenJson)
  for (const item of items) {
    pushSuggestion(createWorkflowDependencyKeySuggestion(item, workflowGraph.item.workflowKey))
  }

  return suggestions
}

export function buildReusableBlockerSuggestions(
  tasks: TodoTaskItem[],
  decisions: GoalDecision[],
): ReusableBlockerSuggestion[] {
  const suggestions: ReusableBlockerSuggestion[] = []
  const seenSuggestionKeys = new Set<string>()

  const pushSuggestion = (suggestion: ReusableBlockerSuggestion | null) => {
    if (!suggestion || seenSuggestionKeys.has(suggestion.suggestionKey)) {
      return
    }
    seenSuggestionKeys.add(suggestion.suggestionKey)
    suggestions.push(suggestion)
  }

  for (const task of tasks) {
    pushSuggestion(createTaskBlockerSuggestion(task))
  }

  for (const decision of decisions) {
    pushSuggestion(createDecisionBlockerSuggestion(decision))
  }

  return suggestions
}
