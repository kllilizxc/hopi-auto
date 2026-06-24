import { type BlockerRef } from '../lib/api'
import type { ReusableBlockerSuggestion } from './boardViewStructuredEditorTypes'

export function findBatchRequestDependencyCycleKey(
  requests: Array<{
    taskKey: string
    blockedByTaskKeys?: string[]
  }>,
) {
  const requestByKey = new Map(requests.map((request) => [request.taskKey, request] as const))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  const visit = (taskKey: string): string | null => {
    if (visited.has(taskKey)) {
      return null
    }
    if (visiting.has(taskKey)) {
      return taskKey
    }
    visiting.add(taskKey)
    for (const dependencyKey of requestByKey.get(taskKey)?.blockedByTaskKeys ?? []) {
      if (requestByKey.has(dependencyKey)) {
        const cycleKey = visit(dependencyKey)
        if (cycleKey) {
          return cycleKey
        }
      }
    }
    visiting.delete(taskKey)
    visited.add(taskKey)
    return null
  }

  for (const taskKey of requestByKey.keys()) {
    const cycleKey = visit(taskKey)
    if (cycleKey) {
      return cycleKey
    }
  }

  return null
}

export function validateDecisionAnswerBatchDecisionKeys(decisionKeys: string[]) {
  const seen = new Set<string>()
  for (const decisionKey of decisionKeys) {
    if (seen.has(decisionKey)) {
      return `Duplicate decision key in answer batch: ${decisionKey}`
    }
    seen.add(decisionKey)
  }
  return null
}

export function normalizePlanningAnswerMergeKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolvePlanningAnswerMergeSummaryKey(
  existing: string | undefined,
  incoming: string | undefined,
  summary: string,
) {
  const nextSummaryKey = normalizePlanningAnswerMergeKey(incoming)
  if (!existing) {
    return { value: nextSummaryKey, error: null as string | null }
  }
  if (!nextSummaryKey || nextSummaryKey === existing) {
    return { value: existing, error: null as string | null }
  }
  return {
    value: existing,
    error: `Planning request answer summaryKey conflict for "${summary}": ${existing} != ${nextSummaryKey}`,
  }
}

export function resolvePlanningAnswerMergeAnswerKey(
  existing: string | undefined,
  incoming: string | undefined,
  summary: string,
) {
  const nextAnswerKey = normalizePlanningAnswerMergeKey(incoming)
  if (!existing) {
    return { value: nextAnswerKey, error: null as string | null }
  }
  if (!nextAnswerKey || nextAnswerKey === existing) {
    return { value: existing, error: null as string | null }
  }
  return {
    value: existing,
    error: `Planning request answer answerKey conflict for "${summary}": ${existing} != ${nextAnswerKey}`,
  }
}

export function getPlanningAnswerMergeValueKey(summary: string, answer: string) {
  return `${summary}\u0000${answer}`
}

export function validatePlanningAnswerMergeContract(
  answers: Array<{
    summary: string
    answer?: string
    answerKey?: string
    summaryKey?: string
  }>,
) {
  if (answers.length === 0) {
    return null
  }

  const merged: Array<{
    summary: string
    answer?: string
    answerKey?: string
    summaryKey?: string
  }> = []
  const seenByValue = new Map<string, number>()
  const seenByAnswerKey = new Map<string, number>()

  for (const value of answers) {
    const nextAnswerKey = normalizePlanningAnswerMergeKey(value.answerKey)
    const nextSummaryKey = normalizePlanningAnswerMergeKey(value.summaryKey)
    const nextAnswer = normalizePlanningAnswerMergeKey(value.answer)
    const valueKey =
      nextAnswer === undefined
        ? undefined
        : getPlanningAnswerMergeValueKey(value.summary, nextAnswer)
    const existingIndexByAnswerKey =
      nextAnswerKey === undefined ? undefined : seenByAnswerKey.get(nextAnswerKey)
    const existingIndexByValue = valueKey === undefined ? undefined : seenByValue.get(valueKey)

    if (
      existingIndexByAnswerKey !== undefined &&
      existingIndexByValue !== undefined &&
      existingIndexByAnswerKey !== existingIndexByValue
    ) {
      return `Planning request answer "${value.summary}" matched different rows by answerKey and value identity`
    }

    const existingIndex = existingIndexByAnswerKey ?? existingIndexByValue
    if (existingIndex === undefined) {
      merged.push({
        summary: value.summary,
        answer: nextAnswer,
        answerKey: nextAnswerKey,
        summaryKey: nextSummaryKey,
      })
      if (valueKey) {
        seenByValue.set(valueKey, merged.length - 1)
      }
      if (nextAnswerKey) {
        seenByAnswerKey.set(nextAnswerKey, merged.length - 1)
      }
      continue
    }

    const current = merged[existingIndex]
    if (!current) {
      continue
    }
    if (existingIndexByAnswerKey !== undefined && current.summary !== value.summary) {
      return `Planning request answer summary conflict for answerKey "${current.answerKey}": "${current.summary}" != "${value.summary}"`
    }

    const resolvedAnswerKeyResult = resolvePlanningAnswerMergeAnswerKey(
      current.answerKey,
      nextAnswerKey,
      current.summary,
    )
    if (resolvedAnswerKeyResult.error) {
      return resolvedAnswerKeyResult.error
    }

    const resolvedSummaryKeyResult = resolvePlanningAnswerMergeSummaryKey(
      current.summaryKey,
      nextSummaryKey,
      current.summary,
    )
    if (resolvedSummaryKeyResult.error) {
      return resolvedSummaryKeyResult.error
    }

    const previousValueKey =
      current.answer === undefined
        ? undefined
        : getPlanningAnswerMergeValueKey(current.summary, current.answer)
    const mergedAnswer = nextAnswer ?? current.answer
    merged[existingIndex] = {
      summary: current.summary,
      answer: mergedAnswer,
      answerKey: resolvedAnswerKeyResult.value,
      summaryKey: resolvedSummaryKeyResult.value,
    }
    if (previousValueKey && previousValueKey !== valueKey) {
      seenByValue.delete(previousValueKey)
    }
    if (mergedAnswer) {
      seenByValue.set(getPlanningAnswerMergeValueKey(current.summary, mergedAnswer), existingIndex)
    }
    if (resolvedAnswerKeyResult.value) {
      seenByAnswerKey.set(resolvedAnswerKeyResult.value, existingIndex)
    }
  }

  return null
}

export function normalizeAnswerSourceMetadataValue(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeAnswerSourceSummaryLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

export function mergeAnswerSourceMetadataValidationValue(
  currentValue: string | undefined,
  nextValue: string | undefined,
  fieldLabel: string,
  label: string,
  areEqual: (left: string, right: string) => boolean = (left, right) => left === right,
) {
  const current = normalizeAnswerSourceMetadataValue(currentValue)
  const next = normalizeAnswerSourceMetadataValue(nextValue)
  if (!current) {
    return { value: next, error: null as string | null }
  }
  if (!next) {
    return { value: current, error: null as string | null }
  }
  if (!areEqual(current, next)) {
    return {
      value: current,
      error: `Conflicting ${fieldLabel} values in answerSources for ${label}.`,
    }
  }
  return { value: current, error: null as string | null }
}

export function validateAnswerSourceBatchContract(
  answerSources: Array<{
    answerSourceKey: string
    sourceGroupKey?: string
    route?: string
    decisionKey?: string
    answerKey?: string
    summaryKey?: string
    summary?: string
    prompt?: string
  }>,
) {
  if (answerSources.length === 0) {
    return null
  }

  const seenAnswerSourceKeys = new Set<string>()
  const groupedMetadataBySourceGroupKey = new Map<
    string,
    {
      route?: string
      decisionKey?: string
      answerKey?: string
      summaryKey?: string
      summary?: string
      prompt?: string
    }
  >()

  for (const entry of answerSources) {
    const answerSourceKey = normalizeAnswerSourceMetadataValue(entry.answerSourceKey)
    if (answerSourceKey && seenAnswerSourceKeys.has(answerSourceKey)) {
      return `Duplicate answerSourceKey: ${answerSourceKey}`
    }
    if (answerSourceKey) {
      seenAnswerSourceKeys.add(answerSourceKey)
    }

    const sourceGroupKey = normalizeAnswerSourceMetadataValue(entry.sourceGroupKey)
    if (!sourceGroupKey) {
      continue
    }

    const label = `sourceGroupKey "${sourceGroupKey}"`
    const current = groupedMetadataBySourceGroupKey.get(sourceGroupKey)
    if (!current) {
      groupedMetadataBySourceGroupKey.set(sourceGroupKey, {
        route: normalizeAnswerSourceMetadataValue(entry.route),
        decisionKey: normalizeAnswerSourceMetadataValue(entry.decisionKey),
        answerKey: normalizeAnswerSourceMetadataValue(entry.answerKey),
        summaryKey: normalizeAnswerSourceMetadataValue(entry.summaryKey),
        summary: normalizeAnswerSourceMetadataValue(entry.summary),
        prompt: normalizeAnswerSourceMetadataValue(entry.prompt),
      })
      continue
    }

    const mergedRoute = mergeAnswerSourceMetadataValidationValue(
      current.route,
      entry.route,
      'route',
      label,
    )
    if (mergedRoute.error) {
      return mergedRoute.error
    }

    const mergedDecisionKey = mergeAnswerSourceMetadataValidationValue(
      current.decisionKey,
      entry.decisionKey,
      'decisionKey',
      label,
    )
    if (mergedDecisionKey.error) {
      return mergedDecisionKey.error
    }

    const mergedAnswerKey = mergeAnswerSourceMetadataValidationValue(
      current.answerKey,
      entry.answerKey,
      'answerKey',
      label,
    )
    if (mergedAnswerKey.error) {
      return mergedAnswerKey.error
    }

    const mergedSummaryKey = mergeAnswerSourceMetadataValidationValue(
      current.summaryKey,
      entry.summaryKey,
      'summaryKey',
      label,
    )
    if (mergedSummaryKey.error) {
      return mergedSummaryKey.error
    }

    const mergedSummary = mergeAnswerSourceMetadataValidationValue(
      current.summary,
      entry.summary,
      'summary',
      label,
      (left, right) =>
        normalizeAnswerSourceSummaryLabel(left) === normalizeAnswerSourceSummaryLabel(right),
    )
    if (mergedSummary.error) {
      return mergedSummary.error
    }

    const mergedPrompt = mergeAnswerSourceMetadataValidationValue(
      current.prompt,
      entry.prompt,
      'prompt',
      label,
    )
    if (mergedPrompt.error) {
      return mergedPrompt.error
    }

    groupedMetadataBySourceGroupKey.set(sourceGroupKey, {
      route: mergedRoute.value,
      decisionKey: mergedDecisionKey.value,
      answerKey: mergedAnswerKey.value,
      summaryKey: mergedSummaryKey.value,
      summary: mergedSummary.value,
      prompt: mergedPrompt.value,
    })
  }

  return null
}

export function validateBatchRequestDependencyGraph(
  requests: Array<{
    taskKey: string
    blockedByTaskKeys?: string[]
  }>,
) {
  if (requests.length === 0) {
    return null
  }

  const taskKeys = requests.map((request) => request.taskKey)
  if (new Set(taskKeys).size !== taskKeys.length) {
    return 'Planning batch taskKey values must be unique'
  }

  for (const request of requests) {
    if (request.blockedByTaskKeys?.includes(request.taskKey)) {
      return `Planning batch task cannot depend on itself: ${request.taskKey}`
    }
  }

  const cycleKey = findBatchRequestDependencyCycleKey(requests)
  if (cycleKey) {
    return `Planning batch dependency cycle detected at: ${cycleKey}`
  }

  return null
}

export function buildValidTaskBlockerRefSetFromSuggestions(
  suggestions: ReusableBlockerSuggestion[],
) {
  return new Set(
    suggestions
      .filter((suggestion) => suggestion.item.kind === 'task')
      .map((suggestion) => suggestion.item.ref.trim())
      .filter((ref) => ref.length > 0),
  )
}

export function validateResolvedTaskBlockerRefs(
  blockers: BlockerRef[] | undefined,
  validTaskBlockerRefs?: Set<string>,
) {
  if (!validTaskBlockerRefs || validTaskBlockerRefs.size === 0) {
    return null
  }

  for (const blocker of blockers ?? []) {
    if (blocker.kind === 'task' && !validTaskBlockerRefs.has(blocker.ref)) {
      return `Task blocker not found: ${blocker.ref}`
    }
  }

  return null
}

export function validateBatchRequestBlockers(
  requests: Array<{
    label: string
    blockedByJson?: string
    blockedBy?: BlockerRef[]
  }>,
  validTaskBlockerRefs?: Set<string>,
) {
  for (const request of requests) {
    const blockers =
      request.blockedBy ??
      (request.blockedByJson?.trim()
        ? parseBlockerRefsJson(request.blockedByJson, request.label)
        : undefined)
    const taskBlockerError = validateResolvedTaskBlockerRefs(blockers, validTaskBlockerRefs)
    if (taskBlockerError) {
      return taskBlockerError
    }
  }

  return null
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

function parseBlockerRefsJson(source: string, label: string): BlockerRef[] {
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
