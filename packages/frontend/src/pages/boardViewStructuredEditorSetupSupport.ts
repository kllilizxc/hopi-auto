import {
  canonicalizeBatchRequestEditorValue,
  canonicalizeBlockerEditorValue,
  canonicalizeEditorStringList,
  canonicalizePlanningAnswerEditorValue,
  createEmptyDecisionAnswerEntryEditorItem,
  createEmptyPlanningAnswerEditorItem,
  parseAnswerSourceEditorItems,
  parseDecisionAnswerEntryEditorItems,
  parseDecisionWorkflowChildEditorItems,
  parsePlanningAnswerEditorItems,
  parseWorkflowChildEditorItems,
  serializeAnswerSourceEditorItems,
  serializeDecisionAnswerEntryEditorItems,
  serializeDecisionWorkflowChildEditorItems,
  serializePlanningAnswerEditorItems,
  serializeWorkflowChildEditorItems,
} from './boardViewStructuredEditorCodec'
import {
  buildDecisionAnswerEntrySuggestionIdentity,
  buildEditorAnswerSourceIdentity,
  buildPlanningAnswerEditorSuggestionIdentity,
} from './boardViewStructuredEditorSuggestionSupport'
import {
  buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion,
  buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion,
} from './boardViewStructuredEditorPatchBuilders'
import type {
  AnswerSourceEditorItem,
  BatchRequestEditorItem,
  DecisionAnswerEntryEditorItem,
  DecisionFollowThroughDraft,
  DecisionWorkflowChildEditorItem,
  PlanningAnswerEditorItem,
  ReusableAnswerSourceRoutingSuggestion,
  ReusableAnswerSourceSuggestion,
  ReusableBatchRequestGroupSuggestion,
  ReusableDecisionAnswerSuggestion,
  ReusablePlanningAnswerSuggestion,
  WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'

export function appendUniqueAnswerSourceEditorItems(
  items: AnswerSourceEditorItem[],
  nextItems: AnswerSourceEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((item): item is string => Boolean(item && item.length > 0)),
  )

  for (const item of nextItems) {
    const identity = buildEditorAnswerSourceIdentity(item)
    if (identity === null || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function buildAnswerSourceEditorValueWithRoutingSuggestions(
  currentValue: string,
  suggestions: ReusableAnswerSourceRoutingSuggestion[],
) {
  const { items, error } = parseAnswerSourceEditorItems(currentValue)
  if (error) {
    return null
  }

  return serializeAnswerSourceEditorItems(
    appendUniqueAnswerSourceEditorItems(
      items,
      suggestions.map((suggestion) => suggestion.item),
    ),
  )
}

export function buildAnswerSourceEditorValueWithSetupSuggestions(
  currentValue: string,
  routingSuggestions: ReusableAnswerSourceRoutingSuggestion[],
  suggestions: ReusableAnswerSourceSuggestion[],
) {
  const { items, error } = parseAnswerSourceEditorItems(currentValue)
  if (error) {
    return null
  }

  return serializeAnswerSourceEditorItems(
    appendUniqueAnswerSourceEditorItems(
      appendUniqueAnswerSourceEditorItems(
        items,
        routingSuggestions.map((suggestion) => suggestion.item),
      ),
      suggestions.map((suggestion) => suggestion.item),
    ),
  )
}

export function buildApplyCurrentConsumerRouting(
  currentValue: string,
  suggestions: ReusableAnswerSourceRoutingSuggestion[],
  label: string,
  onApply: (value: string) => void,
) {
  if (suggestions.length === 0 || !hasValidAnswerSourcesJsonOrEmpty(currentValue, label)) {
    return undefined
  }

  return () => {
    const nextValue = buildAnswerSourceEditorValueWithRoutingSuggestions(currentValue, suggestions)
    if (!nextValue) {
      return
    }
    onApply(nextValue)
  }
}

export function buildApplyCurrentAnswerSourceSetup(
  currentValue: string,
  routingSuggestions: ReusableAnswerSourceRoutingSuggestion[],
  suggestions: ReusableAnswerSourceSuggestion[],
  label: string,
  onApply: (value: string) => void,
) {
  if (
    (routingSuggestions.length === 0 && suggestions.length === 0) ||
    !hasValidAnswerSourcesJsonOrEmpty(currentValue, label)
  ) {
    return undefined
  }

  return () => {
    const nextValue = buildAnswerSourceEditorValueWithSetupSuggestions(
      currentValue,
      routingSuggestions,
      suggestions,
    )
    if (!nextValue) {
      return
    }
    onApply(nextValue)
  }
}

function hasValidPlanningAnswersJsonOrEmpty(source: string, label: string) {
  void label
  if (source.trim().length === 0) {
    return true
  }

  return parsePlanningAnswerEditorItems(source).error === null
}

function hasValidAnswerSourcesJsonOrEmpty(source: string, label: string) {
  void label
  if (source.trim().length === 0) {
    return true
  }

  return parseAnswerSourceEditorItems(source).error === null
}

function hasValidDecisionAnswerEntriesJsonOrEmpty(source: string) {
  if (source.trim().length === 0) {
    return true
  }

  return parseDecisionAnswerEntryEditorItems(source).error === null
}

export function buildPlanningAnswerEditorValueWithSetupSuggestions(
  currentValue: string,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  const { items, error } = parsePlanningAnswerEditorItems(currentValue)
  if (error) {
    return null
  }

  return serializePlanningAnswerEditorItems(
    appendPlanningAnswerEditorItemsWithSetupSuggestions(
      items,
      suggestions,
      answerSourceSuggestions,
    ),
  )
}

export function buildApplyCurrentPlanningAnswerSetup(
  currentValue: string,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
  label: string,
  onApply: (value: string) => void,
) {
  if (
    (suggestions.length === 0 && answerSourceSuggestions.length === 0) ||
    !hasValidPlanningAnswersJsonOrEmpty(currentValue, label)
  ) {
    return undefined
  }

  return () => {
    const nextValue = buildPlanningAnswerEditorValueWithSetupSuggestions(
      currentValue,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextValue) {
      return
    }
    onApply(nextValue)
  }
}

export function buildDecisionFollowThroughAnswerSetupPatch(
  draft: DecisionFollowThroughDraft,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
): Partial<DecisionFollowThroughDraft> | null {
  if (suggestions.length === 0 && answerSourceSuggestions.length === 0) {
    return {}
  }

  const patch: Partial<DecisionFollowThroughDraft> = {}
  const applyField = (
    field: 'answersJson' | 'workflowAnswersJson',
    currentValue: string,
    label: string,
  ) => {
    if (!hasValidPlanningAnswersJsonOrEmpty(currentValue, label)) {
      return false
    }

    const nextValue = buildPlanningAnswerEditorValueWithSetupSuggestions(
      currentValue,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextValue) {
      return false
    }

    patch[field] = nextValue
    return true
  }

  if (draft.kind === 'none') {
    return patch
  }

  if (draft.kind === 'planning' || draft.kind === 'planning_batch') {
    return applyField('answersJson', draft.answersJson, 'Follow-through answers') ? patch : null
  }

  if (!applyField('workflowAnswersJson', draft.workflowAnswersJson, 'Workflow root answers')) {
    return null
  }

  if (!draft.workflowChildrenJson.trim()) {
    return applyField('answersJson', draft.answersJson, 'Decision workflow child answers')
      ? patch
      : null
  }

  const nextWorkflowChildrenJson = buildDecisionWorkflowChildEditorValueWithAnswerSetupSuggestions(
    draft.workflowChildrenJson,
    suggestions,
    answerSourceSuggestions,
  )
  if (!nextWorkflowChildrenJson) {
    return null
  }
  patch.workflowChildrenJson = nextWorkflowChildrenJson

  return patch
}

export function buildApplyCurrentDecisionFollowThroughAnswerSetup(
  draft: DecisionFollowThroughDraft,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
  onApply: (patch: Partial<DecisionFollowThroughDraft>) => void,
) {
  if (draft.kind === 'none') {
    return undefined
  }

  const initialPatch = buildDecisionFollowThroughAnswerSetupPatch(
    draft,
    suggestions,
    answerSourceSuggestions,
  )
  if (!initialPatch || Object.keys(initialPatch).length === 0) {
    return undefined
  }

  return () => {
    const nextPatch = buildDecisionFollowThroughAnswerSetupPatch(
      draft,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextPatch || Object.keys(nextPatch).length === 0) {
      return
    }
    onApply(nextPatch)
  }
}

export function buildWorkflowDraftVisibleAnswerSetupPatch(
  workflowDraft: {
    sharedAnswersJson: string
    childAnswersJson: string
    childrenJson: string
  },
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
): Partial<{
  sharedAnswersJson: string
  childAnswersJson: string
  childrenJson: string
}> | null {
  if (suggestions.length === 0 && answerSourceSuggestions.length === 0) {
    return {}
  }

  const patch: Partial<{
    sharedAnswersJson: string
    childAnswersJson: string
    childrenJson: string
  }> = {}
  const nextSharedAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
    workflowDraft.sharedAnswersJson,
    suggestions,
    answerSourceSuggestions,
  )
  if (
    !hasValidPlanningAnswersJsonOrEmpty(
      workflowDraft.sharedAnswersJson,
      'Workflow shared answers',
    ) ||
    !nextSharedAnswersJson
  ) {
    return null
  }
  patch.sharedAnswersJson = nextSharedAnswersJson

  if (!workflowDraft.childrenJson.trim()) {
    const nextChildAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
      workflowDraft.childAnswersJson,
      suggestions,
      answerSourceSuggestions,
    )
    if (
      !hasValidPlanningAnswersJsonOrEmpty(
        workflowDraft.childAnswersJson,
        'Workflow child answers',
      ) ||
      !nextChildAnswersJson
    ) {
      return null
    }
    patch.childAnswersJson = nextChildAnswersJson
  } else {
    const nextChildrenJson = buildWorkflowChildEditorValueWithAnswerSetupSuggestions(
      workflowDraft.childrenJson,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextChildrenJson) {
      return null
    }
    patch.childrenJson = nextChildrenJson
  }

  return patch
}

export function buildApplyCurrentWorkflowDraftAnswerSetup(
  workflowDraft: {
    sharedAnswersJson: string
    childAnswersJson: string
    childrenJson: string
  },
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
  onApply: (
    patch: Partial<{
      sharedAnswersJson: string
      childAnswersJson: string
      childrenJson: string
    }>,
  ) => void,
) {
  const initialPatch = buildWorkflowDraftVisibleAnswerSetupPatch(
    workflowDraft,
    suggestions,
    answerSourceSuggestions,
  )
  if (!initialPatch || Object.keys(initialPatch).length === 0) {
    return undefined
  }

  return () => {
    const nextPatch = buildWorkflowDraftVisibleAnswerSetupPatch(
      workflowDraft,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextPatch || Object.keys(nextPatch).length === 0) {
      return
    }
    onApply(nextPatch)
  }
}

export function buildWorkflowChildEditorValueWithAnswerSetupSuggestions(
  currentValue: string,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  const { items, error } = parseWorkflowChildEditorItems(currentValue)
  if (error) {
    return null
  }

  const nextItems: WorkflowChildEditorItem[] = []
  for (const item of items) {
    const nextAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
      item.answersJson,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextAnswersJson) {
      return null
    }
    nextItems.push({
      ...item,
      answersJson: nextAnswersJson,
    })
  }

  return serializeWorkflowChildEditorItems(nextItems)
}

export function buildDecisionWorkflowChildEditorValueWithAnswerSetupSuggestions(
  currentValue: string,
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  const { items, error } = parseDecisionWorkflowChildEditorItems(currentValue)
  if (error) {
    return null
  }

  const nextItems: DecisionWorkflowChildEditorItem[] = []
  for (const item of items) {
    const nextAnswersJson = buildPlanningAnswerEditorValueWithSetupSuggestions(
      item.answersJson,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextAnswersJson) {
      return null
    }
    nextItems.push({
      ...item,
      answersJson: nextAnswersJson,
    })
  }

  return serializeDecisionWorkflowChildEditorItems(nextItems)
}

export function buildDecisionAnswerEntryEditorValueWithSetupSuggestions(
  currentValue: string,
  suggestions: ReusableDecisionAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  const { items, error } = parseDecisionAnswerEntryEditorItems(currentValue)
  if (error) {
    return null
  }

  return serializeDecisionAnswerEntryEditorItems(
    appendDecisionAnswerEntryItemsWithSetupSuggestions(items, suggestions, answerSourceSuggestions),
  )
}

export function buildApplyCurrentDecisionAnswerSetup(
  currentValue: string,
  suggestions: ReusableDecisionAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
  onApply: (value: string) => void,
) {
  if (
    (suggestions.length === 0 && answerSourceSuggestions.length === 0) ||
    !hasValidDecisionAnswerEntriesJsonOrEmpty(currentValue)
  ) {
    return undefined
  }

  return () => {
    const nextValue = buildDecisionAnswerEntryEditorValueWithSetupSuggestions(
      currentValue,
      suggestions,
      answerSourceSuggestions,
    )
    if (!nextValue) {
      return
    }
    onApply(nextValue)
  }
}

export function appendUniquePlanningAnswerEditorItems(
  items: PlanningAnswerEditorItem[],
  nextItems: PlanningAnswerEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildPlanningAnswerEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildPlanningAnswerEditorSuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function appendPlanningAnswerEditorItemsFromAnswerSourceSuggestions(
  items: PlanningAnswerEditorItem[],
  suggestions: ReusableAnswerSourceSuggestion[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((item): item is string => Boolean(item && item.length > 0)),
  )

  for (const suggestion of suggestions) {
    const identity = buildEditorAnswerSourceIdentity(suggestion.item)
    if (identity === null || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push({
      ...createEmptyPlanningAnswerEditorItem(),
      ...buildPlanningAnswerEditorPatchFromAnswerSourceSuggestion(suggestion),
    })
  }

  return merged
}

export function appendPlanningAnswerEditorItemsWithSetupSuggestions(
  items: PlanningAnswerEditorItem[],
  suggestions: ReusablePlanningAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  return appendPlanningAnswerEditorItemsFromAnswerSourceSuggestions(
    appendUniquePlanningAnswerEditorItems(
      items,
      suggestions.map((suggestion) => suggestion.item),
    ),
    answerSourceSuggestions,
  )
}

export function appendUniqueDecisionAnswerEntryEditorItems(
  items: DecisionAnswerEntryEditorItem[],
  nextItems: DecisionAnswerEntryEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildDecisionAnswerEntrySuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildDecisionAnswerEntrySuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function appendDecisionAnswerEntryItemsFromAnswerSourceSuggestions(
  items: DecisionAnswerEntryEditorItem[],
  suggestions: ReusableAnswerSourceSuggestion[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildEditorAnswerSourceIdentity(item))
      .filter((item): item is string => Boolean(item && item.length > 0)),
  )

  for (const suggestion of suggestions) {
    const identity = buildEditorAnswerSourceIdentity(suggestion.item)
    if (identity === null || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push({
      ...createEmptyDecisionAnswerEntryEditorItem(),
      ...buildDecisionAnswerEntryPatchFromAnswerSourceSuggestion(suggestion),
    })
  }

  return merged
}

export function appendDecisionAnswerEntryItemsWithSetupSuggestions(
  items: DecisionAnswerEntryEditorItem[],
  suggestions: ReusableDecisionAnswerSuggestion[],
  answerSourceSuggestions: ReusableAnswerSourceSuggestion[],
) {
  return appendDecisionAnswerEntryItemsFromAnswerSourceSuggestions(
    appendUniqueDecisionAnswerEntryEditorItems(
      items,
      suggestions.map((suggestion) => suggestion.item),
    ),
    answerSourceSuggestions,
  )
}

export function buildBatchRequestEditorSuggestionIdentity(
  item: BatchRequestEditorItem,
): string | null {
  const identity = [
    item.taskKey.trim(),
    item.requestKey.trim(),
    item.title.trim(),
    item.description.trim(),
    canonicalizeEditorStringList(item.acceptanceCriteria),
    canonicalizeEditorStringList(item.requestedUpdates),
    canonicalizeBlockerEditorValue(item.blockedByJson),
    canonicalizeEditorStringList(item.blockedByTaskKeys),
  ]
    .filter((field) => field.length > 0)
    .join('::')
  return identity.length > 0 ? identity : null
}

export function matchesReusableBatchRequestGroupSuggestionSelection(
  suggestion: ReusableBatchRequestGroupSuggestion,
  selection: {
    groupKey: string
    blockedByWorkflowKeys?: string
    decisionRefs?: string
    answersJson?: string
    batchRequestsJson: string
  },
) {
  return (
    (normalizeOptionalString(suggestion.item.groupKey) ?? '') ===
      (normalizeOptionalString(selection.groupKey) ?? '') &&
    canonicalizeEditorStringList(suggestion.item.blockedByWorkflowKeys) ===
      canonicalizeEditorStringList(selection.blockedByWorkflowKeys ?? '') &&
    canonicalizeEditorStringList(suggestion.item.decisionRefs) ===
      canonicalizeEditorStringList(selection.decisionRefs ?? '') &&
    canonicalizePlanningAnswerEditorValue(suggestion.item.answersJson) ===
      canonicalizePlanningAnswerEditorValue(selection.answersJson) &&
    canonicalizeBatchRequestEditorValue(suggestion.item.batchRequestsJson) ===
      canonicalizeBatchRequestEditorValue(selection.batchRequestsJson)
  )
}

function normalizeOptionalString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : undefined
}

export function appendUniqueBatchRequestEditorItems(
  items: BatchRequestEditorItem[],
  nextItems: BatchRequestEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildBatchRequestEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildBatchRequestEditorSuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function buildWorkflowChildEditorSuggestionIdentity(
  item: WorkflowChildEditorItem,
): string | null {
  const fields =
    item.kind === 'planning'
      ? [
          item.kind,
          item.requestKey.trim(),
          item.workflowTaskKey.trim(),
          item.groupKey.trim(),
          canonicalizeEditorStringList(item.blockedByWorkflowKeys),
          canonicalizeBlockerEditorValue(item.blockedByJson),
          item.description.trim(),
          canonicalizeEditorStringList(item.acceptanceCriteria),
          canonicalizeEditorStringList(item.decisionRefs),
          canonicalizePlanningAnswerEditorValue(item.answersJson),
          item.title.trim(),
          canonicalizeEditorStringList(item.requestedUpdates),
        ]
      : [
          item.kind,
          item.groupKey.trim(),
          canonicalizeEditorStringList(item.blockedByWorkflowKeys),
          canonicalizeEditorStringList(item.decisionRefs),
          canonicalizePlanningAnswerEditorValue(item.answersJson),
          canonicalizeBatchRequestEditorValue(item.batchRequestsJson),
        ]
  const identity = fields.filter((field) => field.length > 0).join('::')
  return identity.length > 0 ? identity : null
}

export function appendUniqueWorkflowChildEditorItems(
  items: WorkflowChildEditorItem[],
  nextItems: WorkflowChildEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildWorkflowChildEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildWorkflowChildEditorSuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}

export function buildDecisionWorkflowChildEditorSuggestionIdentity(
  item: DecisionWorkflowChildEditorItem,
): string | null {
  const fields =
    item.kind === 'planning'
      ? [
          item.kind,
          item.workflowTaskKey.trim(),
          item.groupKey.trim(),
          canonicalizeEditorStringList(item.blockedByWorkflowKeys),
          item.title.trim(),
          item.description.trim(),
          canonicalizeEditorStringList(item.acceptanceCriteria),
          canonicalizePlanningAnswerEditorValue(item.answersJson),
          canonicalizeEditorStringList(item.requestedUpdates),
        ]
      : [
          item.kind,
          item.groupKey.trim(),
          canonicalizeEditorStringList(item.blockedByWorkflowKeys),
          canonicalizePlanningAnswerEditorValue(item.answersJson),
          canonicalizeBatchRequestEditorValue(item.batchRequestsJson),
        ]
  const identity = fields.filter((field) => field.length > 0).join('::')
  return identity.length > 0 ? identity : null
}

export function appendUniqueDecisionWorkflowChildEditorItems(
  items: DecisionWorkflowChildEditorItem[],
  nextItems: DecisionWorkflowChildEditorItem[],
) {
  const merged = [...items]
  const seenKeys = new Set(
    items
      .map((item) => buildDecisionWorkflowChildEditorSuggestionIdentity(item))
      .filter((item): item is string => item !== null),
  )

  for (const item of nextItems) {
    const identity = buildDecisionWorkflowChildEditorSuggestionIdentity(item)
    if (!identity || seenKeys.has(identity)) {
      continue
    }
    seenKeys.add(identity)
    merged.push(item)
  }

  return merged
}
