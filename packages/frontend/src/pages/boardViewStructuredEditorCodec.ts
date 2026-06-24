import { type BlockerKind } from '../lib/api'
import {
  validateAnswerSourceBatchContract,
  validateBatchRequestBlockers,
  validateBatchRequestDependencyGraph,
  validateDecisionAnswerBatchDecisionKeys,
  validatePlanningAnswerMergeContract,
} from './boardViewStructuredEditorValidation'
import type {
  AnswerSourceEditorItem,
  BatchRequestEditorItem,
  BlockerEditorItem,
  DecisionAnswerEntryEditorItem,
  DecisionWorkflowChildEditorItem,
  PlanningAnswerEditorItem,
  WorkflowChildEditorItem,
} from './boardViewStructuredEditorTypes'

export * from './boardViewStructuredEditorValidation'

const BLOCKER_KIND_OPTIONS: BlockerKind[] = ['task', 'decision', 'merge_conflict', 'intervention']

export function createEmptyPlanningAnswerEditorItem(): PlanningAnswerEditorItem {
  return {
    summary: '',
    answer: '',
    sourceExcerpt: '',
    sourceOccurrence: '',
    prompt: '',
    summaryKey: '',
    answerKey: '',
    matchHints: '',
    answerSourceKey: '',
    answerSourceGroupKey: '',
  }
}

export function createEmptyDecisionAnswerEntryEditorItem(): DecisionAnswerEntryEditorItem {
  return {
    decisionKey: '',
    summary: '',
    summaryKey: '',
    prompt: '',
    matchHints: '',
    taskRef: '',
    answer: '',
    sourceExcerpt: '',
    sourceOccurrence: '',
    answerSourceKey: '',
    answerSourceGroupKey: '',
  }
}

export function createEmptyAnswerSourceEditorItem(): AnswerSourceEditorItem {
  return {
    answerSourceKey: '',
    route: '',
    summary: '',
    answer: '',
    sourceExcerpt: '',
    sourceOccurrence: '',
    sourceGroupKey: '',
    decisionKey: '',
    prompt: '',
    summaryKey: '',
    answerKey: '',
    matchHints: '',
  }
}

export function createEmptyBlockerEditorItem(): BlockerEditorItem {
  return {
    kind: '',
    ref: '',
  }
}

export function createEmptyBatchRequestEditorItem(): BatchRequestEditorItem {
  return {
    taskKey: '',
    requestKey: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    requestedUpdates: '',
    blockedByJson: '',
    blockedByTaskKeys: '',
  }
}

export function createEmptyWorkflowChildEditorItem(): WorkflowChildEditorItem {
  return {
    kind: 'planning',
    requestKey: '',
    workflowTaskKey: '',
    groupKey: '',
    blockedByWorkflowKeys: '',
    blockedByJson: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    decisionRefs: '',
    answersJson: '',
    requestedUpdates: '',
    batchRequestsJson: '',
  }
}

export function createEmptyDecisionWorkflowChildEditorItem(): DecisionWorkflowChildEditorItem {
  return {
    kind: 'planning',
    workflowTaskKey: '',
    groupKey: '',
    blockedByWorkflowKeys: '',
    title: '',
    description: '',
    acceptanceCriteria: '',
    answersJson: '',
    requestedUpdates: '',
    batchRequestsJson: '',
  }
}

export function parsePlanningAnswerEditorItems(source: string): {
  items: PlanningAnswerEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Structured planning answers must be a JSON array.' }
    }

    const items = parsed.map((item) => normalizePlanningAnswerEditorItem(item))
    const validationError = validatePlanningAnswerMergeContract(
      items.map((item) => ({
        summary: item.summary.trim(),
        answer: item.answer.trim() || undefined,
        answerKey: item.answerKey.trim() || undefined,
        summaryKey: item.summaryKey.trim() || undefined,
      })),
    )

    return {
      items,
      error: validationError,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured planning answers JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseBlockerEditorItems(source: string): {
  items: BlockerEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source)
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Blockers JSON must be an array.' }
    }

    return {
      items: parsed.map((item) => normalizeBlockerEditorItem(item)),
      error: null,
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : 'Invalid blockers JSON.',
    }
  }
}

export function parseDecisionAnswerEntryEditorItems(source: string): {
  items: DecisionAnswerEntryEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Structured decision answers must be a JSON array.' }
    }

    const items = parsed.map((item) => normalizeDecisionAnswerEntryEditorItem(item))
    const validationError = validateDecisionAnswerBatchDecisionKeys(
      items.map((item) => item.decisionKey.trim()).filter((decisionKey) => decisionKey.length > 0),
    )

    return {
      items,
      error: validationError,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured decision answers JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseWorkflowChildEditorItems(source: string): {
  items: WorkflowChildEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Structured workflow children must be a JSON array.' }
    }

    return {
      items: parsed.map((item) => normalizeWorkflowChildEditorItem(item)),
      error: null,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured workflow children JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseDecisionWorkflowChildEditorItems(source: string): {
  items: DecisionWorkflowChildEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return {
        items: [],
        error: 'Structured decision workflow children must be a JSON array.',
      }
    }

    return {
      items: parsed.map((item) => normalizeDecisionWorkflowChildEditorItem(item)),
      error: null,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured decision workflow children JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseAnswerSourceEditorItems(source: string): {
  items: AnswerSourceEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Structured answer sources must be a JSON array.' }
    }

    const items = parsed.map((item) => normalizeAnswerSourceEditorItem(item))
    const validationError = validateAnswerSourceBatchContract(
      items.map((item) => ({
        answerSourceKey: item.answerSourceKey,
        sourceGroupKey: item.sourceGroupKey,
        route: item.route || undefined,
        decisionKey: item.decisionKey,
        answerKey: item.answerKey,
        summaryKey: item.summaryKey,
        summary: item.summary,
        prompt: item.prompt,
      })),
    )

    return {
      items,
      error: validationError,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured answer sources JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function parseBatchRequestEditorItems(source: string): {
  items: BatchRequestEditorItem[]
  error: string | null
} {
  if (source.trim().length === 0) {
    return { items: [], error: null }
  }

  try {
    const parsed = JSON.parse(source) as unknown
    if (!Array.isArray(parsed)) {
      return { items: [], error: 'Structured batch requests must be a JSON array.' }
    }

    const items = parsed.map((item) => normalizeBatchRequestEditorItem(item))
    const validationError = validateBatchRequestDependencyGraph(
      items
        .map((item) => ({
          taskKey: item.taskKey.trim(),
          blockedByTaskKeys: parseListInput(item.blockedByTaskKeys),
        }))
        .filter((item) => item.taskKey.length > 0),
    )
    const blockerError = validateBatchRequestBlockers(
      items.map((item, index) => ({
        label: `Batch request ${index + 1} blockers`,
        blockedByJson: item.blockedByJson,
      })),
    )

    return {
      items,
      error: validationError ?? blockerError,
    }
  } catch (error) {
    return {
      items: [],
      error: `Structured batch requests JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

export function normalizePlanningAnswerEditorItem(value: unknown): PlanningAnswerEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyPlanningAnswerEditorItem()
  }

  const entry = value as Record<string, unknown>
  return {
    summary: coerceEditorString(entry.summary),
    answer: coerceEditorString(entry.answer),
    sourceExcerpt: coerceEditorString(entry.sourceExcerpt),
    sourceOccurrence: coerceEditorString(entry.sourceOccurrence),
    prompt: coerceEditorString(entry.prompt),
    summaryKey: coerceEditorString(entry.summaryKey),
    answerKey: coerceEditorString(entry.answerKey),
    matchHints: normalizeEditorStringList(entry.matchHints),
    answerSourceKey: coerceEditorString(entry.answerSourceKey),
    answerSourceGroupKey: coerceEditorString(entry.answerSourceGroupKey),
  }
}

export function normalizeDecisionAnswerEntryEditorItem(
  value: unknown,
): DecisionAnswerEntryEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyDecisionAnswerEntryEditorItem()
  }

  const entry = value as Record<string, unknown>
  return {
    decisionKey: coerceEditorString(entry.decisionKey),
    summary: coerceEditorString(entry.summary),
    summaryKey: coerceEditorString(entry.summaryKey),
    prompt: coerceEditorString(entry.prompt),
    matchHints: normalizeEditorStringList(entry.matchHints),
    taskRef: coerceEditorString(entry.taskRef),
    answer: coerceEditorString(entry.answer),
    sourceExcerpt: coerceEditorString(entry.sourceExcerpt),
    sourceOccurrence: coerceEditorString(entry.sourceOccurrence),
    answerSourceKey: coerceEditorString(entry.answerSourceKey),
    answerSourceGroupKey: coerceEditorString(entry.answerSourceGroupKey),
  }
}

export function normalizeAnswerSourceEditorItem(value: unknown): AnswerSourceEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyAnswerSourceEditorItem()
  }

  const entry = value as Record<string, unknown>
  const route = coerceEditorString(entry.route)
  return {
    answerSourceKey: coerceEditorString(entry.answerSourceKey),
    route: route === 'decision' || route === 'planning' ? route : '',
    summary: coerceEditorString(entry.summary),
    answer: coerceEditorString(entry.answer),
    sourceExcerpt: coerceEditorString(entry.sourceExcerpt),
    sourceOccurrence: coerceEditorString(entry.sourceOccurrence),
    sourceGroupKey: coerceEditorString(entry.sourceGroupKey),
    decisionKey: coerceEditorString(entry.decisionKey),
    prompt: coerceEditorString(entry.prompt),
    summaryKey: coerceEditorString(entry.summaryKey),
    answerKey: coerceEditorString(entry.answerKey),
    matchHints: normalizeEditorStringList(entry.matchHints),
  }
}

export function normalizeBatchRequestEditorItem(value: unknown): BatchRequestEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyBatchRequestEditorItem()
  }

  const entry = value as Record<string, unknown>
  return {
    taskKey: coerceEditorString(entry.taskKey),
    requestKey: coerceEditorString(entry.requestKey),
    title: coerceEditorString(entry.title),
    description: coerceEditorString(entry.description),
    acceptanceCriteria: normalizeEditorStringList(entry.acceptanceCriteria),
    requestedUpdates: normalizeEditorStringList(entry.requestedUpdates),
    blockedByJson: normalizeEditorJsonArrayField(entry.blockedBy, entry.blockedByJson),
    blockedByTaskKeys: normalizeEditorStringList(entry.blockedByTaskKeys),
  }
}

export function normalizeBlockerEditorItem(value: unknown): BlockerEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyBlockerEditorItem()
  }

  const entry = value as Record<string, unknown>
  const kind = coerceEditorString(entry.kind)
  return {
    kind: BLOCKER_KIND_OPTIONS.includes(kind as BlockerKind) ? (kind as BlockerKind) : '',
    ref: coerceEditorString(entry.ref),
  }
}

export function normalizeWorkflowChildEditorItem(value: unknown): WorkflowChildEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyWorkflowChildEditorItem()
  }

  const entry = value as Record<string, unknown>
  const kind = coerceEditorString(entry.kind)
  return {
    kind: kind === 'planning_batch' ? 'planning_batch' : 'planning',
    requestKey: coerceEditorString(entry.requestKey),
    workflowTaskKey: coerceEditorString(entry.workflowTaskKey),
    groupKey: coerceEditorString(entry.groupKey),
    blockedByWorkflowKeys: normalizeEditorStringList(entry.blockedByWorkflowKeys),
    blockedByJson: normalizeEditorJsonArrayField(entry.blockedBy, entry.blockedByJson),
    title: coerceEditorString(entry.title),
    description: coerceEditorString(entry.description),
    acceptanceCriteria: normalizeEditorStringList(entry.acceptanceCriteria),
    decisionRefs: normalizeEditorStringList(entry.decisionRefs),
    answersJson: normalizeEditorJsonArrayField(entry.answers, entry.answersJson),
    requestedUpdates: normalizeEditorStringList(entry.requestedUpdates),
    batchRequestsJson: normalizeEditorJsonArrayField(entry.requests, entry.batchRequestsJson),
  }
}

export function normalizeDecisionWorkflowChildEditorItem(
  value: unknown,
): DecisionWorkflowChildEditorItem {
  if (!value || typeof value !== 'object') {
    return createEmptyDecisionWorkflowChildEditorItem()
  }

  const entry = value as Record<string, unknown>
  const kind = coerceEditorString(entry.kind)
  return {
    kind: kind === 'planning_batch' ? 'planning_batch' : 'planning',
    workflowTaskKey: coerceEditorString(entry.workflowTaskKey),
    groupKey: coerceEditorString(entry.groupKey),
    blockedByWorkflowKeys: normalizeEditorStringList(entry.blockedByWorkflowKeys),
    title: coerceEditorString(entry.title),
    description: coerceEditorString(entry.description),
    acceptanceCriteria: normalizeEditorStringList(entry.acceptanceCriteria),
    answersJson: normalizeEditorJsonArrayField(entry.answers, entry.answersJson),
    requestedUpdates: normalizeEditorStringList(entry.requestedUpdates),
    batchRequestsJson: normalizeEditorJsonArrayField(entry.requests, entry.batchRequestsJson),
  }
}

export function serializePlanningAnswerEditorItems(items: PlanningAnswerEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        summary: item.summary,
        answer: item.answer,
        sourceExcerpt: item.sourceExcerpt,
        sourceOccurrence: item.sourceOccurrence,
        prompt: item.prompt,
        summaryKey: item.summaryKey,
        answerKey: item.answerKey,
        matchHints: parseListInput(item.matchHints),
        answerSourceKey: item.answerSourceKey,
        answerSourceGroupKey: item.answerSourceGroupKey,
      }),
    ),
    null,
    2,
  )
}

export function serializeDecisionAnswerEntryEditorItems(items: DecisionAnswerEntryEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        decisionKey: item.decisionKey,
        summary: item.summary,
        summaryKey: item.summaryKey,
        prompt: item.prompt,
        matchHints: parseListInput(item.matchHints),
        taskRef: item.taskRef,
        answer: item.answer,
        sourceExcerpt: item.sourceExcerpt,
        sourceOccurrence: item.sourceOccurrence,
        answerSourceKey: item.answerSourceKey,
        answerSourceGroupKey: item.answerSourceGroupKey,
      }),
    ),
    null,
    2,
  )
}

export function serializeBlockerEditorItems(items: BlockerEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        kind: item.kind,
        ref: item.ref,
      }),
    ),
    null,
    2,
  )
}

export function serializeWorkflowChildEditorItems(items: WorkflowChildEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        kind: item.kind,
        requestKey: item.kind === 'planning' ? item.requestKey : undefined,
        workflowTaskKey: item.kind === 'planning' ? item.workflowTaskKey : undefined,
        groupKey: item.groupKey,
        blockedByWorkflowKeys: parseListInput(item.blockedByWorkflowKeys),
        blockedByJson: item.kind === 'planning' ? item.blockedByJson : undefined,
        title: item.kind === 'planning' ? item.title : undefined,
        description: item.kind === 'planning' ? item.description : undefined,
        acceptanceCriteria:
          item.kind === 'planning' ? parseListInput(item.acceptanceCriteria) : undefined,
        decisionRefs: parseListInput(item.decisionRefs),
        answersJson: item.answersJson,
        requestedUpdates:
          item.kind === 'planning' ? parseListInput(item.requestedUpdates) : undefined,
        batchRequestsJson: item.kind === 'planning_batch' ? item.batchRequestsJson : undefined,
      }),
    ),
    null,
    2,
  )
}

export function serializeDecisionWorkflowChildEditorItems(
  items: DecisionWorkflowChildEditorItem[],
) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        kind: item.kind,
        workflowTaskKey: item.kind === 'planning' ? item.workflowTaskKey : undefined,
        groupKey: item.kind === 'planning_batch' ? item.groupKey : undefined,
        blockedByWorkflowKeys: parseListInput(item.blockedByWorkflowKeys),
        title: item.kind === 'planning' ? item.title : undefined,
        description: item.kind === 'planning' ? item.description : undefined,
        acceptanceCriteria:
          item.kind === 'planning' ? parseListInput(item.acceptanceCriteria) : undefined,
        answersJson: item.answersJson,
        requestedUpdates:
          item.kind === 'planning' ? parseListInput(item.requestedUpdates) : undefined,
        batchRequestsJson: item.kind === 'planning_batch' ? item.batchRequestsJson : undefined,
      }),
    ),
    null,
    2,
  )
}

export function serializeAnswerSourceEditorItems(items: AnswerSourceEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        answerSourceKey: item.answerSourceKey,
        route: item.route,
        summary: item.summary,
        answer: item.answer,
        sourceExcerpt: item.sourceExcerpt,
        sourceOccurrence: item.sourceOccurrence,
        sourceGroupKey: item.sourceGroupKey,
        decisionKey: item.decisionKey,
        prompt: item.prompt,
        summaryKey: item.summaryKey,
        answerKey: item.answerKey,
        matchHints: parseListInput(item.matchHints),
      }),
    ),
    null,
    2,
  )
}

export function canonicalizePlanningAnswerEditorValue(value: string | undefined) {
  const source = value?.trim() ?? ''
  if (source.length === 0) {
    return ''
  }
  const { items, error } = parsePlanningAnswerEditorItems(source)
  return error ? source : serializePlanningAnswerEditorItems(items)
}

export function canonicalizeBatchRequestEditorValue(value: string | undefined) {
  const source = value?.trim() ?? ''
  if (source.length === 0) {
    return ''
  }
  const { items, error } = parseBatchRequestEditorItems(source)
  return error ? source : serializeBatchRequestEditorItems(items)
}

export function canonicalizeBlockerEditorValue(value: string | undefined) {
  const source = value?.trim() ?? ''
  if (source.length === 0) {
    return ''
  }
  const { items, error } = parseBlockerEditorItems(source)
  return error ? source : serializeBlockerEditorItems(items)
}

export function canonicalizeEditorStringList(value: string | undefined) {
  return parseListInput(value ?? '').join(', ')
}

export function serializeBatchRequestEditorItems(items: BatchRequestEditorItem[]) {
  return JSON.stringify(
    items.map((item) =>
      compactEditorObject({
        taskKey: item.taskKey,
        requestKey: item.requestKey,
        title: item.title,
        description: item.description,
        acceptanceCriteria: parseListInput(item.acceptanceCriteria),
        requestedUpdates: parseListInput(item.requestedUpdates),
        blockedByJson: item.blockedByJson,
        blockedByTaskKeys: parseListInput(item.blockedByTaskKeys),
      }),
    ),
    null,
    2,
  )
}

export function updatePlanningAnswerEditorItem(
  items: PlanningAnswerEditorItem[],
  index: number,
  patch: Partial<PlanningAnswerEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateDecisionAnswerEntryEditorItem(
  items: DecisionAnswerEntryEditorItem[],
  index: number,
  patch: Partial<DecisionAnswerEntryEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateAnswerSourceEditorItem(
  items: AnswerSourceEditorItem[],
  index: number,
  patch: Partial<AnswerSourceEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateBlockerEditorItem(
  items: BlockerEditorItem[],
  index: number,
  patch: Partial<BlockerEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateBatchRequestEditorItem(
  items: BatchRequestEditorItem[],
  index: number,
  patch: Partial<BatchRequestEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateWorkflowChildEditorItem(
  items: WorkflowChildEditorItem[],
  index: number,
  patch: Partial<WorkflowChildEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function updateDecisionWorkflowChildEditorItem(
  items: DecisionWorkflowChildEditorItem[],
  index: number,
  patch: Partial<DecisionWorkflowChildEditorItem>,
) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

export function compactEditorObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry === undefined || entry === null) {
        return false
      }
      if (typeof entry === 'string') {
        return entry.trim().length > 0
      }
      if (Array.isArray(entry)) {
        return entry.length > 0
      }
      return true
    }),
  )
}

export function coerceEditorString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return ''
}

export function normalizeEditorStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .join(', ')
  }
  if (typeof value === 'string') {
    return value
  }
  return ''
}

export function normalizeEditorJsonArrayField(arrayValue: unknown, stringValue: unknown) {
  if (Array.isArray(arrayValue)) {
    return JSON.stringify(arrayValue, null, 2)
  }
  if (typeof stringValue === 'string') {
    return stringValue
  }
  return ''
}

export function parseListInput(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export function serializeStringListEditorItems(items: string[]) {
  const seen = new Set<string>()
  const nextItems: string[] = []

  for (const item of items) {
    const trimmed = item.trim()
    const identity = buildStringListEditorIdentity(trimmed)
    if (identity.length === 0 || seen.has(identity)) {
      continue
    }
    seen.add(identity)
    nextItems.push(trimmed)
  }

  return nextItems.join('\n')
}

export function updateStringListEditorItems(items: string[], index: number, value: string) {
  return items.map((item, itemIndex) => (itemIndex === index ? value : item))
}

export function buildStringListEditorIdentity(value: string) {
  return value.trim()
}
