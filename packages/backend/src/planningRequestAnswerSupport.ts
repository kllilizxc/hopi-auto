import type { AnswerCaptureFormat } from './domain/answerCaptureFormat'
import { resolveCanonicalPromptFromSummary } from './domain/canonicalPrompt'

export interface PlanningRequestAnswerValue {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: AnswerCaptureFormat
  answer: string
}

export interface MergePlanningRequestAnswersOptions {
  prepareInsertedMatchHints?(values: string[] | undefined): string[] | undefined
  resolveInitialPrompt?(value: PlanningRequestAnswerValue): string | undefined
}

export function normalizePlanningRequestAnswerKey(value: string | undefined) {
  return trimOptionalString(value)
}

export function normalizePlanningRequestAnswerSummaryKey(value: string | undefined) {
  return trimOptionalString(value)
}

export function normalizePlanningRequestAnswerMatchHints(values: string[] | undefined) {
  if (!values || values.length === 0) {
    return undefined
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(trimmed)
  }

  return normalized.length > 0 ? normalized : undefined
}

export function mergePlanningRequestAnswers(
  existing: PlanningRequestAnswerValue[],
  incoming: PlanningRequestAnswerValue[],
  options: MergePlanningRequestAnswersOptions = {},
) {
  const prepareInsertedMatchHints =
    options.prepareInsertedMatchHints ?? normalizePlanningRequestAnswerMatchHints
  const resolveInitialPrompt = options.resolveInitialPrompt ?? defaultResolveInitialPrompt
  const merged = [...existing]
  const seenByValue = new Map<string, number>()
  const seenByAnswerKey = new Map<string, number>()

  for (const [index, value] of existing.entries()) {
    seenByValue.set(getPlanningRequestAnswerValueKey(value.summary, value.answer), index)
    const answerKey = normalizePlanningRequestAnswerKey(value.answerKey)
    if (!answerKey) {
      continue
    }
    const existingIndex = seenByAnswerKey.get(answerKey)
    if (existingIndex !== undefined && existingIndex !== index) {
      throw new Error(`Duplicate planning request answerKey "${answerKey}" in existing answers`)
    }
    seenByAnswerKey.set(answerKey, index)
  }

  for (const value of incoming) {
    const nextAnswerKey = normalizePlanningRequestAnswerKey(value.answerKey)
    const valueKey = getPlanningRequestAnswerValueKey(value.summary, value.answer)
    const existingIndexByAnswerKey =
      nextAnswerKey === undefined ? undefined : seenByAnswerKey.get(nextAnswerKey)
    const existingIndexByValue = seenByValue.get(valueKey)
    if (
      existingIndexByAnswerKey !== undefined &&
      existingIndexByValue !== undefined &&
      existingIndexByAnswerKey !== existingIndexByValue
    ) {
      throw new Error(
        `Planning request answer "${value.summary}" matched different rows by answerKey and value identity`,
      )
    }

    const existingIndex = existingIndexByAnswerKey ?? existingIndexByValue
    if (existingIndex === undefined) {
      const nextPrompt = resolveInitialPrompt(value)
      const nextSummaryKey = normalizePlanningRequestAnswerSummaryKey(value.summaryKey)
      const nextMatchHints = prepareInsertedMatchHints(value.matchHints)
      merged.push({
        summary: value.summary,
        answer: value.answer,
        ...(nextAnswerKey ? { answerKey: nextAnswerKey } : {}),
        ...(nextSummaryKey ? { summaryKey: nextSummaryKey } : {}),
        ...(nextPrompt ? { prompt: nextPrompt } : {}),
        ...(nextMatchHints ? { matchHints: nextMatchHints } : {}),
        ...(value.captureFormat ? { captureFormat: value.captureFormat } : {}),
      })
      seenByValue.set(valueKey, merged.length - 1)
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
      throw new Error(
        `Planning request answer summary conflict for answerKey "${current.answerKey}": "${current.summary}" != "${value.summary}"`,
      )
    }

    const resolvedAnswerKey = resolvePlanningRequestAnswerKey(
      current.answerKey,
      value.answerKey,
      current.summary,
    )
    const nextSummaryKey = resolvePlanningRequestAnswerSummaryKey(
      current.summaryKey,
      value.summaryKey,
      current.summary,
    )
    const nextPrompt = resolveCanonicalPromptFromSummary({
      summary: current.summary,
      currentPrompt: current.prompt,
      incomingPrompt: value.prompt,
    })
    const nextMatchHints = mergePlanningRequestAnswerMatchHints(
      current.matchHints,
      value.matchHints,
    )
    const nextCaptureFormat = resolvePlanningRequestAnswerCaptureFormat(
      current.captureFormat,
      value.captureFormat,
      current.answer !== value.answer,
    )
    if (
      resolvedAnswerKey !== current.answerKey ||
      nextSummaryKey !== current.summaryKey ||
      nextPrompt !== current.prompt ||
      !sameOptionalStringArray(current.matchHints, nextMatchHints) ||
      nextCaptureFormat !== current.captureFormat ||
      current.answer !== value.answer
    ) {
      seenByValue.delete(getPlanningRequestAnswerValueKey(current.summary, current.answer))
      merged[existingIndex] = {
        summary: current.summary,
        answer: value.answer,
        ...(resolvedAnswerKey ? { answerKey: resolvedAnswerKey } : {}),
        ...(nextSummaryKey ? { summaryKey: nextSummaryKey } : {}),
        ...(nextPrompt ? { prompt: nextPrompt } : {}),
        ...(nextMatchHints ? { matchHints: nextMatchHints } : {}),
        ...(nextCaptureFormat ? { captureFormat: nextCaptureFormat } : {}),
      }
      seenByValue.set(
        getPlanningRequestAnswerValueKey(current.summary, value.answer),
        existingIndex,
      )
      if (resolvedAnswerKey) {
        seenByAnswerKey.set(resolvedAnswerKey, existingIndex)
      }
    }
  }

  return merged
}

export function samePlanningRequestAnswerArray(
  left: PlanningRequestAnswerValue[],
  right: PlanningRequestAnswerValue[],
) {
  return (
    left.length === right.length &&
    left.every(
      (value, index) =>
        right[index]?.summary === value.summary &&
        right[index]?.answerKey === value.answerKey &&
        right[index]?.summaryKey === value.summaryKey &&
        right[index]?.prompt === value.prompt &&
        sameOptionalStringArray(right[index]?.matchHints, value.matchHints) &&
        right[index]?.captureFormat === value.captureFormat &&
        right[index]?.answer === value.answer,
    )
  )
}

function defaultResolveInitialPrompt(value: PlanningRequestAnswerValue) {
  return trimOptionalString(value.prompt)
}

function mergePlanningRequestAnswerMatchHints(
  existing: string[] | undefined,
  incoming: string[] | undefined,
) {
  if (!incoming || incoming.length === 0) {
    return existing
  }

  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map((value) => value.trim().toLowerCase().replace(/\s+/g, ' ')))
  for (const value of incoming) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    merged.push(trimmed)
  }

  return normalizePlanningRequestAnswerMatchHints(merged)
}

function resolvePlanningRequestAnswerSummaryKey(
  existing: string | undefined,
  incoming: string | undefined,
  summary: string,
) {
  const nextSummaryKey = normalizePlanningRequestAnswerSummaryKey(incoming)
  if (!existing) {
    return nextSummaryKey
  }
  if (!nextSummaryKey || nextSummaryKey === existing) {
    return existing
  }
  throw new Error(
    `Planning request answer summaryKey conflict for "${summary}": ${existing} != ${nextSummaryKey}`,
  )
}

function resolvePlanningRequestAnswerCaptureFormat(
  existing: AnswerCaptureFormat | undefined,
  incoming: AnswerCaptureFormat | undefined,
  answerChanged: boolean,
) {
  if (incoming) {
    return incoming
  }
  if (answerChanged) {
    return undefined
  }
  return existing
}

function resolvePlanningRequestAnswerKey(
  existing: string | undefined,
  incoming: string | undefined,
  summary: string,
) {
  const nextAnswerKey = normalizePlanningRequestAnswerKey(incoming)
  if (!existing) {
    return nextAnswerKey
  }
  if (!nextAnswerKey || nextAnswerKey === existing) {
    return existing
  }
  throw new Error(
    `Planning request answer answerKey conflict for "${summary}": ${existing} != ${nextAnswerKey}`,
  )
}

function getPlanningRequestAnswerValueKey(summary: string, answer: string) {
  return `${summary}\u0000${answer}`
}

function sameOptionalStringArray(left: string[] | undefined, right: string[] | undefined) {
  if (!left && !right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return left.length === right.length && left.every((value, index) => right[index] === value)
}

function trimOptionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
