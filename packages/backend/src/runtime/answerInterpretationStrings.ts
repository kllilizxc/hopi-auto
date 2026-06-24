interface BaseTextLike {
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
}

interface SummaryLike extends BaseTextLike {
  summary: string
}

interface DecisionLike extends SummaryLike {
  decisionKey?: string
}

interface PlanningAnswerLike extends SummaryLike {
  answerKey?: string
}

interface AnswerSourceLike extends BaseTextLike {
  answerKey?: string
  answerSourceKey: string
  decisionKey?: string
  summary?: string
}

export function normalizeSourceResponseLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

export function normalizeSourceResponseText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
}

export function dedupeNonEmptyStrings(values: Array<string | undefined>) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) {
      continue
    }
    const normalized = normalizeSourceResponseLabel(trimmed)
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(trimmed)
  }
  return result
}

export function humanizeDecisionKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

export function humanizeSummaryKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

export function humanizePlanningAnswerKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

export function humanizeAnswerSourceKey(value: string | undefined) {
  const trimmed = value?.trim()
  const humanized = trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
  if (!humanized) {
    return undefined
  }
  return humanized.replace(/\s+(?:answer|source)$/i, '')
}

export function buildKnownDecisionSourceResponseCandidates<T extends DecisionLike>(decision: T) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(decision.summaryKey),
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
    ...(decision.matchHints ?? []),
  ])
}

export function buildMatchingRunCandidateGroupKey(candidates: string[]) {
  return dedupeNonEmptyStrings(candidates)
    .map((candidate) => normalizeSourceResponseLabel(candidate))
    .filter(Boolean)
    .sort()
    .join('|')
}

export function buildDecisionAnswerSourceResponseCandidates<T extends DecisionLike>(answer: T) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(answer.summaryKey),
    humanizeDecisionKey(answer.decisionKey),
    answer.summary,
    answer.prompt,
    ...(answer.matchHints ?? []),
  ])
}

export function buildPlanningAnswerSourceResponseCandidates<T extends PlanningAnswerLike>(
  answer: T,
) {
  return dedupeNonEmptyStrings([
    humanizePlanningAnswerKey(answer.answerKey),
    humanizeSummaryKey(answer.summaryKey),
    answer.summary,
    answer.prompt,
    ...(answer.matchHints ?? []),
  ])
}

export function buildAnswerSourceResponseCandidates<T extends AnswerSourceLike>(source: T) {
  return dedupeNonEmptyStrings([
    humanizeDecisionKey(source.decisionKey),
    humanizePlanningAnswerKey(source.answerKey),
    humanizeSummaryKey(source.summaryKey),
    humanizeAnswerSourceKey(source.answerSourceKey),
    source.summary,
    source.prompt,
    ...(source.matchHints ?? []),
  ])
}

export function buildOpenDecisionSourceResponseCandidates<T extends DecisionLike>(decision: T) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(decision.summaryKey),
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
    ...(decision.matchHints ?? []),
  ])
}

export function createKnownDecisionsBySummaryLookup<T extends SummaryLike>(knownDecisions: T[]) {
  const lookup = new Map<string, T[]>()
  for (const decision of knownDecisions) {
    for (const candidate of [decision.summary, humanizeSummaryKey(decision.summaryKey)]) {
      if (!candidate) {
        continue
      }
      const normalized = normalizeSourceResponseLabel(candidate)
      if (!normalized) {
        continue
      }
      const existing = lookup.get(normalized)
      if (existing) {
        if (!existing.includes(decision)) {
          existing.push(decision)
        }
        continue
      }
      lookup.set(normalized, [decision])
    }
  }
  return lookup
}

export function createKnownDecisionsByDecisionKeyLookup<T extends { decisionKey: string }>(
  knownDecisions: T[],
) {
  const lookup = new Map<string, T>()
  for (const decision of knownDecisions) {
    const decisionKey = decision.decisionKey.trim()
    if (decisionKey) {
      lookup.set(decisionKey, decision)
    }
  }
  return lookup
}
