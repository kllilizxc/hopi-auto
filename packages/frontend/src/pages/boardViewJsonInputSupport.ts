import type {
  BlockerRef,
  GoalAnswerSourceInput,
  GoalDecisionAnswerEntryInput,
  GoalDecisionWorkflowBatchChildInput,
  GoalPlanningWorkflowCreateBatchRequestInput,
  GoalPlanningWorkflowCreateChildInput,
  InterpretablePlanningAnswerInput,
} from '../lib/api'
import { parseListInput } from './boardViewStructuredEditorCodec'
import {
  validateAnswerSourceBatchContract,
  validateBatchRequestBlockers,
  validateBatchRequestDependencyGraph,
  validateDecisionAnswerBatchDecisionKeys,
  validatePlanningAnswerMergeContract,
} from './boardViewStructuredEditorValidation'

export function parseWorkflowChildrenJson(source: string): GoalPlanningWorkflowCreateChildInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid workflow children JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Workflow children JSON must be a non-empty array.')
  }

  return parsed.map((item, index) => normalizeWorkflowChild(item, index))
}

export function parseDecisionAnswerEntriesJson(source: string): GoalDecisionAnswerEntryInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid decision answers JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Decision answers JSON must be an array.')
  }

  const answers = parsed.map((item, index) => normalizeDecisionAnswerEntry(item, index))
  const validationError = validateDecisionAnswerBatchDecisionKeys(
    answers
      .map((answer) => answer.decisionKey?.trim() ?? '')
      .filter((decisionKey) => decisionKey.length > 0),
  )
  if (validationError) {
    throw new Error(validationError)
  }

  return answers
}

export function parseInterpretablePlanningAnswersJson(
  source: string,
  label: string,
): InterpretablePlanningAnswerInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  const answers = normalizeInterpretablePlanningAnswerArray(parsed, label)
  const validationError = validatePlanningAnswerMergeContract(
    answers.map((answer) => ({
      summary: answer.summary,
      answer: answer.answer,
      answerKey: answer.answerKey,
      summaryKey: answer.summaryKey,
    })),
  )
  if (validationError) {
    throw new Error(validationError)
  }

  return answers
}

export function parseAnswerSourcesJson(source: string, label: string): GoalAnswerSourceInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  const answerSources = normalizeAnswerSourceArray(parsed, label)
  const validationError = validateAnswerSourceBatchContract(
    answerSources.map((entry) => ({
      answerSourceKey: entry.answerSourceKey,
      sourceGroupKey: entry.sourceGroupKey,
      route: entry.route,
      decisionKey: entry.decisionKey,
      answerKey: entry.answerKey,
      summaryKey: entry.summaryKey,
      summary: entry.summary,
      prompt: entry.prompt,
    })),
  )
  if (validationError) {
    throw new Error(validationError)
  }

  return answerSources
}

export function parseBlockerRefsJson(source: string, label: string): BlockerRef[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  return parsed.map((item, index) => normalizeBlockerRef(item, index, label))
}

export function parseDecisionWorkflowChildrenJson(
  source: string,
): GoalDecisionWorkflowBatchChildInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid decision workflow children JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Decision workflow children JSON must be a non-empty array.')
  }

  return parsed.map((item, index) => normalizeDecisionWorkflowChild(item, index))
}

function normalizeWorkflowChild(
  value: unknown,
  index: number,
): GoalPlanningWorkflowCreateChildInput {
  if (!value || typeof value !== 'object') {
    throw new Error(`Workflow child ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const kind = String(entry.kind ?? '').trim()
  if (kind === 'planning_batch') {
    const groupKey = String(entry.groupKey ?? '').trim()
    if (!groupKey) {
      throw new Error(`Workflow child ${index + 1} is missing groupKey.`)
    }

    return {
      kind: 'planning_batch',
      groupKey,
      blockedByWorkflowKeys: normalizeStringList(entry.blockedByWorkflowKeys),
      answers:
        entry.answers !== undefined
          ? normalizeInterpretablePlanningAnswerArray(
              entry.answers,
              `Workflow child ${index + 1} answers`,
            )
          : typeof entry.answersJson === 'string' && entry.answersJson.trim().length > 0
            ? parseInterpretablePlanningAnswersJson(
                entry.answersJson,
                `Workflow child ${index + 1} answers`,
              )
            : undefined,
      requests:
        entry.requests !== undefined
          ? normalizeBatchRequestArray(entry.requests)
          : typeof entry.batchRequestsJson === 'string' && entry.batchRequestsJson.trim().length > 0
            ? parseWorkflowBatchRequestsJson(entry.batchRequestsJson)
            : undefined,
    }
  }

  if (kind !== 'planning') {
    throw new Error(`Workflow child ${index + 1} must use kind "planning" or "planning_batch".`)
  }

  const title = String(entry.title ?? '').trim()
  const description = String(entry.description ?? '').trim()
  const acceptanceCriteria = normalizeStringList(entry.acceptanceCriteria)
  if (!title || acceptanceCriteria.length === 0) {
    throw new Error(
      `Workflow child ${index + 1} planning entry needs title and acceptanceCriteria.`,
    )
  }

  return {
    kind: 'planning',
    requestKey: normalizeOptionalString(entry.requestKey),
    workflowTaskKey: normalizeOptionalString(entry.workflowTaskKey),
    blockedByWorkflowKeys: normalizeStringList(entry.blockedByWorkflowKeys),
    blockedBy:
      entry.blockedBy !== undefined
        ? normalizeBlockerRefArray(entry.blockedBy, `Workflow child ${index + 1} blockers`)
        : typeof entry.blockedByJson === 'string' && entry.blockedByJson.trim().length > 0
          ? parseBlockerRefsJson(entry.blockedByJson, `Workflow child ${index + 1} blockers`)
          : undefined,
    groupKey: normalizeOptionalString(entry.groupKey),
    title,
    description,
    acceptanceCriteria,
    decisionRefs: normalizeStringList(entry.decisionRefs),
    answers:
      entry.answers !== undefined
        ? normalizeInterpretablePlanningAnswerArray(
            entry.answers,
            `Workflow child ${index + 1} answers`,
          )
        : typeof entry.answersJson === 'string' && entry.answersJson.trim().length > 0
          ? parseInterpretablePlanningAnswersJson(
              entry.answersJson,
              `Workflow child ${index + 1} answers`,
            )
          : undefined,
    requestedUpdates: normalizeStringList(entry.requestedUpdates),
  }
}

function normalizeDecisionWorkflowChild(
  value: unknown,
  index: number,
): GoalDecisionWorkflowBatchChildInput {
  if (!value || typeof value !== 'object') {
    throw new Error(`Decision workflow child ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const kind = String(entry.kind ?? '').trim()
  if (kind === 'planning_batch') {
    const groupKey = String(entry.groupKey ?? '').trim()
    if (!groupKey) {
      throw new Error(`Decision workflow child ${index + 1} is missing groupKey.`)
    }

    return {
      kind: 'planning_batch',
      groupKey,
      blockedByWorkflowKeys: normalizeStringList(entry.blockedByWorkflowKeys),
      answers:
        entry.answers !== undefined
          ? normalizeInterpretablePlanningAnswerArray(
              entry.answers,
              `Decision workflow child ${index + 1} answers`,
            )
          : typeof entry.answersJson === 'string' && entry.answersJson.trim().length > 0
            ? parseInterpretablePlanningAnswersJson(
                entry.answersJson,
                `Decision workflow child ${index + 1} answers`,
              )
            : undefined,
      requests:
        entry.requests !== undefined
          ? normalizeBatchRequestArray(entry.requests)
          : typeof entry.batchRequestsJson === 'string' && entry.batchRequestsJson.trim().length > 0
            ? parseWorkflowBatchRequestsJson(entry.batchRequestsJson)
            : undefined,
    }
  }

  if (kind !== 'planning') {
    throw new Error(
      `Decision workflow child ${index + 1} must use kind "planning" or "planning_batch".`,
    )
  }

  const title = String(entry.title ?? '').trim()
  const description = String(entry.description ?? '').trim()
  const acceptanceCriteria = normalizeStringList(entry.acceptanceCriteria)
  if (!title || acceptanceCriteria.length === 0) {
    throw new Error(
      `Decision workflow child ${index + 1} planning entry needs title and acceptanceCriteria.`,
    )
  }

  return {
    kind: 'planning',
    workflowTaskKey: normalizeOptionalString(entry.workflowTaskKey),
    blockedByWorkflowKeys: normalizeStringList(entry.blockedByWorkflowKeys),
    title,
    description,
    acceptanceCriteria,
    answers:
      entry.answers !== undefined
        ? normalizeInterpretablePlanningAnswerArray(
            entry.answers,
            `Decision workflow child ${index + 1} answers`,
          )
        : typeof entry.answersJson === 'string' && entry.answersJson.trim().length > 0
          ? parseInterpretablePlanningAnswersJson(
              entry.answersJson,
              `Decision workflow child ${index + 1} answers`,
            )
          : undefined,
    requestedUpdates: normalizeStringList(entry.requestedUpdates),
  }
}

function normalizeDecisionAnswerEntry(value: unknown, index: number): GoalDecisionAnswerEntryInput {
  if (!value || typeof value !== 'object') {
    throw new Error(`Decision answer ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const summary = String(entry.summary ?? '').trim()
  if (!summary) {
    throw new Error(`Decision answer ${index + 1} needs summary.`)
  }

  const answerSourceKey = normalizeOptionalString(entry.answerSourceKey)
  const answerSourceGroupKey = normalizeOptionalString(entry.answerSourceGroupKey)
  if (answerSourceKey && answerSourceGroupKey) {
    throw new Error(
      `Provide only answerSourceKey or answerSourceGroupKey for Decision answer ${index + 1}.`,
    )
  }
  const sourceExcerpt = normalizeOptionalString(entry.sourceExcerpt)
  const answer = normalizeOptionalString(entry.answer)
  if (!answer && !sourceExcerpt && !answerSourceKey && !answerSourceGroupKey) {
    throw new Error(
      `Decision answer ${index + 1} needs answer, sourceExcerpt, answerSourceKey, or answerSourceGroupKey.`,
    )
  }
  const sourceOccurrence = normalizePositiveInteger(
    entry.sourceOccurrence,
    `Decision answer ${index + 1} sourceOccurrence`,
  )
  if (sourceOccurrence !== undefined && !sourceExcerpt) {
    throw new Error(
      `Decision answer ${index + 1} can only set sourceOccurrence with sourceExcerpt.`,
    )
  }

  return {
    decisionKey: normalizeOptionalString(entry.decisionKey),
    summary,
    summaryKey: normalizeOptionalString(entry.summaryKey),
    prompt: normalizeOptionalString(entry.prompt),
    matchHints: normalizeStringList(entry.matchHints),
    taskRef: normalizeOptionalString(entry.taskRef),
    answer,
    sourceExcerpt,
    sourceOccurrence,
    answerSourceKey,
    answerSourceGroupKey,
  }
}

function normalizeInterpretablePlanningAnswer(
  value: unknown,
  index: number,
  label: string,
): InterpretablePlanningAnswerInput {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} entry ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const summary = String(entry.summary ?? '').trim()
  if (!summary) {
    throw new Error(`${label} entry ${index + 1} needs summary.`)
  }

  const answer = normalizeOptionalString(entry.answer)
  const sourceExcerpt = normalizeOptionalString(entry.sourceExcerpt)
  const answerSourceKey = normalizeOptionalString(entry.answerSourceKey)
  const answerSourceGroupKey = normalizeOptionalString(entry.answerSourceGroupKey)
  if (answerSourceKey && answerSourceGroupKey) {
    throw new Error(
      `Provide only answerSourceKey or answerSourceGroupKey for ${label} entry ${index + 1}.`,
    )
  }
  if (!answer && !sourceExcerpt && !answerSourceKey && !answerSourceGroupKey) {
    throw new Error(
      `${label} entry ${index + 1} needs answer, sourceExcerpt, answerSourceKey, or answerSourceGroupKey.`,
    )
  }

  const sourceOccurrence = normalizePositiveInteger(
    entry.sourceOccurrence,
    `${label} entry ${index + 1} sourceOccurrence`,
  )
  if (sourceOccurrence !== undefined && !sourceExcerpt) {
    throw new Error(`${label} entry ${index + 1} can only set sourceOccurrence with sourceExcerpt.`)
  }

  return {
    summary,
    answerKey: normalizeOptionalString(entry.answerKey),
    summaryKey: normalizeOptionalString(entry.summaryKey),
    prompt: normalizeOptionalString(entry.prompt),
    matchHints: normalizeStringList(entry.matchHints),
    answer,
    sourceExcerpt,
    sourceOccurrence,
    answerSourceKey,
    answerSourceGroupKey,
  }
}

function normalizeInterpretablePlanningAnswerArray(
  value: unknown,
  label: string,
): InterpretablePlanningAnswerInput[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  return value.map((item, index) => normalizeInterpretablePlanningAnswer(item, index, label))
}

function normalizeAnswerSourceArray(value: unknown, label: string): GoalAnswerSourceInput[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  return value.map((item, index) => normalizeAnswerSource(item, index, label))
}

function normalizeBlockerRef(value: unknown, index: number, label: string): BlockerRef {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} entry ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const kind = String(entry.kind ?? '').trim()
  if (
    kind !== 'task' &&
    kind !== 'decision' &&
    kind !== 'merge_conflict' &&
    kind !== 'intervention'
  ) {
    throw new Error(
      `${label} entry ${index + 1} kind must be task, decision, merge_conflict, or intervention.`,
    )
  }

  const ref = String(entry.ref ?? '').trim()
  if (!ref) {
    throw new Error(`${label} entry ${index + 1} needs ref.`)
  }

  return {
    kind,
    ref,
  }
}

function normalizeAnswerSource(
  value: unknown,
  index: number,
  label: string,
): GoalAnswerSourceInput {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} entry ${index + 1} must be an object.`)
  }

  const entry = value as Record<string, unknown>
  const answerSourceKey = String(entry.answerSourceKey ?? '').trim()
  if (!answerSourceKey) {
    throw new Error(`${label} entry ${index + 1} needs answerSourceKey.`)
  }

  const route = normalizeOptionalString(entry.route)
  if (route && route !== 'decision' && route !== 'planning') {
    throw new Error(`${label} entry ${index + 1} route must be "decision" or "planning".`)
  }

  const answer = normalizeOptionalString(entry.answer)
  const sourceExcerpt = normalizeOptionalString(entry.sourceExcerpt)
  if (!answer && !sourceExcerpt) {
    throw new Error(`${label} entry ${index + 1} needs answer or sourceExcerpt.`)
  }

  const sourceOccurrence = normalizePositiveInteger(
    entry.sourceOccurrence,
    `${label} entry ${index + 1} sourceOccurrence`,
  )
  if (sourceOccurrence !== undefined && !sourceExcerpt) {
    throw new Error(`${label} entry ${index + 1} can only set sourceOccurrence with sourceExcerpt.`)
  }

  return {
    answerSourceKey,
    sourceGroupKey: normalizeOptionalString(entry.sourceGroupKey),
    route: route as GoalAnswerSourceInput['route'] | undefined,
    decisionKey: normalizeOptionalString(entry.decisionKey),
    answerKey: normalizeOptionalString(entry.answerKey),
    summaryKey: normalizeOptionalString(entry.summaryKey),
    summary: normalizeOptionalString(entry.summary),
    prompt: normalizeOptionalString(entry.prompt),
    matchHints: normalizeStringList(entry.matchHints),
    answer,
    sourceExcerpt,
    sourceOccurrence,
  }
}

export function parseWorkflowBatchRequestsJson(
  source: string,
): GoalPlanningWorkflowCreateBatchRequestInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Invalid batch requests JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return normalizeBatchRequestArray(parsed)
}

function normalizeBatchRequestArray(value: unknown): GoalPlanningWorkflowCreateBatchRequestInput[] {
  if (!Array.isArray(value)) {
    throw new Error('Batch requests must be a JSON array.')
  }

  const requests = value.map((request, index) => {
    if (!request || typeof request !== 'object') {
      throw new Error(`Batch request ${index + 1} must be an object.`)
    }

    const entry = request as Record<string, unknown>
    const taskKey = String(entry.taskKey ?? '').trim()
    const title = String(entry.title ?? '').trim()
    const description = String(entry.description ?? '').trim()
    const acceptanceCriteria = normalizeStringList(entry.acceptanceCriteria)
    if (!taskKey || !title || acceptanceCriteria.length === 0) {
      throw new Error(`Batch request ${index + 1} needs taskKey, title, and acceptanceCriteria.`)
    }

    return {
      taskKey,
      requestKey: normalizeOptionalString(entry.requestKey),
      title,
      description,
      acceptanceCriteria,
      requestedUpdates: normalizeStringList(entry.requestedUpdates),
      blockedBy:
        entry.blockedBy !== undefined
          ? normalizeBlockerRefArray(entry.blockedBy, `Batch request ${index + 1} blockers`)
          : typeof entry.blockedByJson === 'string' && entry.blockedByJson.trim().length > 0
            ? parseBlockerRefsJson(entry.blockedByJson, `Batch request ${index + 1} blockers`)
            : undefined,
      blockedByTaskKeys: normalizeStringList(entry.blockedByTaskKeys),
    }
  })

  const validationError = validateBatchRequestDependencyGraph(requests)
  if (validationError) {
    throw new Error(validationError)
  }

  return requests
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
  }
  if (typeof value === 'string') {
    return parseListInput(value)
  }
  return []
}

function normalizeBlockerRefArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a JSON array.`)
  }

  return value.map((item, index) => normalizeBlockerRef(item, index, label))
}

export function normalizeOptionalString(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length > 0 ? text : undefined
}

export function normalizePositiveInteger(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }

  return parsed
}

export function hasAtLeastOneBatchRequest(source: string) {
  if (source.trim().length === 0) {
    return false
  }

  try {
    return parseWorkflowBatchRequestsJson(source).length > 0
  } catch {
    return false
  }
}

export function hasValidPlanningAnswersJsonOrEmpty(source: string, label: string) {
  if (source.trim().length === 0) {
    return true
  }

  try {
    parseInterpretablePlanningAnswersJson(source, label)
    return true
  } catch {
    return false
  }
}

export function hasValidDirectSourceOccurrenceDraft(
  sourceExcerpt: string,
  sourceOccurrence: string,
) {
  try {
    const occurrence = normalizePositiveInteger(sourceOccurrence, 'Direct sourceOccurrence')
    return occurrence === undefined || sourceExcerpt.trim().length > 0
  } catch {
    return false
  }
}

export function hasValidAnswerSourcesJsonOrEmpty(source: string, label: string) {
  if (source.trim().length === 0) {
    return true
  }

  try {
    parseAnswerSourcesJson(source, label)
    return true
  } catch {
    return false
  }
}

export function hasValidDecisionAnswerEntriesJsonOrEmpty(source: string) {
  if (source.trim().length === 0) {
    return true
  }

  try {
    parseDecisionAnswerEntriesJson(source)
    return true
  } catch {
    return false
  }
}

export function hasValidBlockersJsonOrEmpty(source: string, label: string) {
  if (source.trim().length === 0) {
    return true
  }

  try {
    parseBlockerRefsJson(source, label)
    return true
  } catch {
    return false
  }
}

export function hasValidBatchRequestsJsonOrEmpty(
  source: string,
  validTaskBlockerRefs?: Set<string>,
) {
  if (source.trim().length === 0) {
    return true
  }

  try {
    const requests = parseWorkflowBatchRequestsJson(source)
    return (
      validateBatchRequestBlockers(
        requests.map((request, index) => ({
          label: `Batch request ${index + 1} blockers`,
          blockedBy: request.blockedBy,
        })),
        validTaskBlockerRefs,
      ) === null
    )
  } catch {
    return false
  }
}

export function hasAtLeastOneWorkflowChild(source: string) {
  if (source.trim().length === 0) {
    return false
  }

  try {
    return parseWorkflowChildrenJson(source).length > 0
  } catch {
    return false
  }
}

export function hasAtLeastOneDecisionWorkflowChild(source: string) {
  if (source.trim().length === 0) {
    return false
  }

  try {
    return parseDecisionWorkflowChildrenJson(source).length > 0
  } catch {
    return false
  }
}
