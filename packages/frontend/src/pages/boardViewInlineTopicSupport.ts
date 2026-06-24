import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import {
  buildFrontendDecisionLabeledSectionCandidates,
  buildFrontendPlanningLabeledSectionCandidates,
  findFrontendSectionMatch,
  type FrontendDecisionLabeledSectionConsumer,
  type FrontendLabeledSection,
  type FrontendPlanningLabeledSectionConsumer,
} from './boardViewLabeledSectionSupport'
import {
  buildKnownDecisionSummaryCountMap,
  buildKnownDecisionSummaryLookup,
  normalizeRemainingAnswerSourceLabel,
} from './boardViewRemainingAnswerSourceSupport'

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const FRONTEND_INLINE_TOPIC_SUMMARY_VERB_PATTERN =
  '(?:should|will|must|can|could|would|is|are|was|were|uses|use|means|requires|starts)'

const FRONTEND_LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN =
  /^(?:(?:(?:\d+|[一二三四五六七八九十百千万两零〇]+)、)\s*)+/u
const FRONTEND_LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN =
  /^(?:(?:\([一二三四五六七八九十百千万两零〇]+\)|（[一二三四五六七八九十百千万两零〇]+）)\s*)+/u
const FRONTEND_LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN =
  /^(?:(?:\([０-９]+\)|（[０-９]+）)\s*)+/u
const FRONTEND_LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN = /^(?:(?:[０-９]+[．.)）])\s*)+/u
const FRONTEND_LEADING_CIRCLED_NUMBER_MARKER_PATTERN = /^(?:[①-⑳]\s*)+/u
const FRONTEND_LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN =
  /^(?:(?:\([IVXivx]{2,8}\)|（[IVXivx]{2,8}）)\s*)+/u
const FRONTEND_LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN = /^(?:(?:[IVX]{2,8}[.)])\s*)+/u

export function stripFrontendPresentationListMarkers(text: string) {
  let stripped = text.trim()

  while (stripped) {
    const next = stripped
      .replace(/^(?:#{1,6}\s+)+/u, '')
      .replace(/^(?:>\s*)+/u, '')
      .replace(/^(?:[-*]\s*\[(?: |x|X)\]\s*)+/u, '')
      .replace(/^(?:\[(?: |x|X)\]\s*)+/u, '')
      .replace(FRONTEND_LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN, '')
      .replace(FRONTEND_LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN, '')
      .replace(FRONTEND_LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN, '')
      .replace(FRONTEND_LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN, '')
      .replace(FRONTEND_LEADING_CIRCLED_NUMBER_MARKER_PATTERN, '')
      .replace(/^(?:(?:\(\d+\)|（\d+）|\([A-Za-z]\)|（[A-Za-z]）)\s*)+/u, '')
      .replace(FRONTEND_LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN, '')
      .replace(FRONTEND_LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN, '')
      .replace(/^(?:(?:\d+[.)]|[A-Za-z][.)])\s*)+/u, '')
      .replace(/^(?:[-+*•・●→○◦▪◆■□▸▹►▻▶▷⁃‣–—―]\s*)+/u, '')
      .trim()
    if (next === stripped) {
      return stripped
    }
    stripped = next
  }

  return stripped
}

function frontendInlineTopicPredicateIncludesSubstantiveAnswerContent(answer: string) {
  const stripped = answer
    .trim()
    .replace(new RegExp(`^(?:${FRONTEND_INLINE_TOPIC_SUMMARY_VERB_PATTERN})\\b\\s*`, 'i'), '')
    .replace(
      /^(?:(?:be|been|being|use|uses|means|requires|starts|with|as|the|a|an|our|your|their)\b\s*)+/i,
      '',
    )
    .replace(/^[\p{P}\p{S}\s]+/gu, '')
    .trim()

  return /[\p{L}\p{N}]/u.test(stripped)
}

function normalizeFrontendInlineTopicAnswer(value: string) {
  const stripped = value
    .trim()
    .replace(new RegExp(`^(?:${FRONTEND_INLINE_TOPIC_SUMMARY_VERB_PATTERN})\\b\\s*`, 'i'), '')
    .trim()

  if (stripped.length === 0) {
    return stripped
  }

  return `${stripped.slice(0, 1).toUpperCase()}${stripped.slice(1)}`
}

function isFrontendQuestionLikeInlineTopicClause(text: string) {
  const trimmed = text.trim()
  return /[?？]$/u.test(trimmed) || /^(?:what|which|who|when|where|why|how)\b/i.test(trimmed)
}

function shouldMergeWithFollowingFrontendInlineTopicClause(clause: string) {
  const trimmed = stripFrontendPresentationListMarkers(
    clause.trim().replace(/^(?:and|but)\s+/i, ''),
  )
  if (!trimmed || /[.?!。？！]$/u.test(trimmed)) {
    return false
  }

  if (/^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*$/u.test(trimmed)) {
    return true
  }

  if (/^(?<label>.+?)\s+(?:-|－|–|—)\s*$/u.test(trimmed)) {
    return true
  }

  const verbal = new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${FRONTEND_INLINE_TOPIC_SUMMARY_VERB_PATTERN}\\b.*)$`,
    'i',
  ).exec(trimmed)?.groups

  return Boolean(
    verbal?.answer && !frontendInlineTopicPredicateIncludesSubstantiveAnswerContent(verbal.answer),
  )
}

function splitFrontendInlineTopicClauses(sourceResponse: string) {
  const rawClauses = sourceResponse
    .split(/(?:\r?\n+|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0)

  const clauses: string[] = []
  for (const clause of rawClauses) {
    const previousClause = clauses.at(-1)
    if (previousClause && shouldMergeWithFollowingFrontendInlineTopicClause(previousClause)) {
      clauses[clauses.length - 1] = `${previousClause} ${clause}`.trim()
      continue
    }
    clauses.push(clause)
  }

  return clauses
}

function parseFrontendInlineTopicClause(clause: string) {
  const trimmed = stripFrontendPresentationListMarkers(
    clause.trim().replace(/^(?:and|but)\s+/i, ''),
  )
  if (!trimmed) {
    return undefined
  }

  const punctuated = /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.exec(
    trimmed,
  )?.groups
  if (punctuated?.label && punctuated.answer) {
    return {
      label: punctuated.label.trim(),
      value: normalizeFrontendInlineTopicAnswer(punctuated.answer),
    } satisfies FrontendLabeledSection
  }

  const dashed = /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/u.exec(trimmed)?.groups
  if (dashed?.label && dashed.answer) {
    return {
      label: dashed.label.trim(),
      value: normalizeFrontendInlineTopicAnswer(dashed.answer),
    } satisfies FrontendLabeledSection
  }

  if (isFrontendQuestionLikeInlineTopicClause(trimmed)) {
    return undefined
  }

  const verbal = new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${FRONTEND_INLINE_TOPIC_SUMMARY_VERB_PATTERN}\\b.+)$`,
    'i',
  ).exec(trimmed)?.groups
  if (
    verbal?.label &&
    verbal.answer &&
    frontendInlineTopicPredicateIncludesSubstantiveAnswerContent(verbal.answer)
  ) {
    return {
      label: verbal.label.trim(),
      value: normalizeFrontendInlineTopicAnswer(verbal.answer),
    } satisfies FrontendLabeledSection
  }

  return undefined
}

function frontendInlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause: string) {
  return (
    /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause) ||
    /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/u.test(trimmedClause)
  )
}

function analyzeFrontendInlineTopicClauses(sourceResponse: string) {
  const sections: FrontendLabeledSection[] = []
  const seenLabels = new Set<string>()
  const issues: string[] = []

  for (const clause of splitFrontendInlineTopicClauses(sourceResponse)) {
    const parsed = parseFrontendInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    const normalizedLabel = normalizeRemainingAnswerSourceLabel(parsed.label)
    if (!normalizedLabel) {
      continue
    }
    if (seenLabels.has(normalizedLabel)) {
      issues.push(`Duplicate inline topic clause "${parsed.label}" in sourceResponse.`)
      continue
    }

    seenLabels.add(normalizedLabel)
    sections.push(parsed)
  }

  return { sections, issues }
}

function parseFrontendInlineTopicClauses(sourceResponse: string) {
  return analyzeFrontendInlineTopicClauses(sourceResponse).sections
}

export function listInlineTopicStructureIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'inline_topics') {
    return [] as string[]
  }

  return analyzeFrontendInlineTopicClauses(normalizeOptionalString(sourceResponse) ?? '').issues
}

export function listInlineTopicUnconsumedIssues({
  format,
  sourceResponse,
  explicitConsumerCount,
  inferOpenDecisions = false,
  inferDecisionTopics = false,
  inferRemainingAnswers = false,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  explicitConsumerCount: number
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
}) {
  if (
    format !== 'inline_topics' ||
    inferOpenDecisions ||
    inferDecisionTopics ||
    inferRemainingAnswers
  ) {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendInlineTopicClauses(
    normalizeOptionalString(sourceResponse) ?? '',
  )
  if (issues.length > 0 || sections.length === 0) {
    return []
  }

  const unconsumedSectionCount = sections.length - explicitConsumerCount
  if (unconsumedSectionCount <= 0) {
    return []
  }

  return [
    `sourceResponseFormat inline_topics rejected sourceResponse because it left ${unconsumedSectionCount} unconsumed inline topic clauses.`,
  ]
}

export function listInlineTopicExplicitConsumerMatchIssues({
  format,
  sourceResponse,
  decisionAnswers = [],
  planningAnswers = [],
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisionAnswers?: FrontendDecisionLabeledSectionConsumer[]
  planningAnswers?: FrontendPlanningLabeledSectionConsumer[]
}) {
  if (format !== 'inline_topics') {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendInlineTopicClauses(
    normalizeOptionalString(sourceResponse) ?? '',
  )
  if (issues.length > 0) {
    return []
  }

  const consumedLabels = new Set<string>()

  for (const answer of decisionAnswers) {
    const candidates = buildFrontendDecisionLabeledSectionCandidates(answer)
    if (candidates.length === 0) {
      continue
    }

    const match = findFrontendSectionMatch(sections, candidates, consumedLabels)
    if (!match) {
      return [
        `No inline topic clause matched decision answer ${
          answer.decisionKey?.trim() || answer.summary.trim()
        } in sourceResponse.`,
      ]
    }
  }

  for (const answer of planningAnswers) {
    const candidates = buildFrontendPlanningLabeledSectionCandidates(answer)
    if (candidates.length === 0) {
      continue
    }

    const match = findFrontendSectionMatch(sections, candidates, consumedLabels)
    if (!match) {
      return [
        `No inline topic clause matched planner answer ${answer.summary.trim()} in sourceResponse.`,
      ]
    }
  }

  return [] as string[]
}

export function listInlineTopicDecisionTopicIssues({
  format,
  sourceResponse,
  decisions,
  inferDecisionTopics,
  inferOpenDecisions,
  inferRemainingAnswers,
  explicitDecisionAnswerCount,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisions: GoalDecision[]
  inferDecisionTopics: boolean
  inferOpenDecisions: boolean
  inferRemainingAnswers: boolean
  explicitDecisionAnswerCount: number
  explicitPlanningAnswerCount?: number
}) {
  if (!inferDecisionTopics || format !== 'inline_topics') {
    return [] as string[]
  }

  const sections = parseFrontendInlineTopicClauses(normalizeOptionalString(sourceResponse) ?? '')
  if (sections.length === 0) {
    return [
      'sourceResponseFormat inline_topics requires at least one inline topic clause when inferDecisionTopics is enabled.',
    ]
  }

  if (
    inferOpenDecisions ||
    inferRemainingAnswers ||
    explicitDecisionAnswerCount > 0 ||
    (explicitPlanningAnswerCount ?? 0) > 0
  ) {
    return []
  }

  const summaryCounts = buildKnownDecisionSummaryCountMap(decisions)
  const issues: string[] = []
  const seenSummaries = new Set<string>()

  for (const section of sections) {
    const normalizedSummary = normalizeRemainingAnswerSourceLabel(section.label)
    if (!normalizedSummary || seenSummaries.has(normalizedSummary)) {
      continue
    }

    if ((summaryCounts.get(normalizedSummary) ?? 0) > 1) {
      issues.push(`Multiple existing decisions match inferred label "${section.label}".`)
      seenSummaries.add(normalizedSummary)
    }
  }

  return issues
}

export function listInlineTopicOpenDecisionIssues({
  format,
  sourceResponse,
  decisions,
  inferOpenDecisions,
  explicitDecisionAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisions: GoalDecision[]
  inferOpenDecisions: boolean
  explicitDecisionAnswerCount: number
}) {
  if (!inferOpenDecisions || format !== 'inline_topics' || explicitDecisionAnswerCount > 0) {
    return [] as string[]
  }

  const sections = parseFrontendInlineTopicClauses(normalizeOptionalString(sourceResponse) ?? '')
  if (sections.length === 0) {
    return [
      'sourceResponseFormat inline_topics requires at least one inline topic clause when inferOpenDecisions is enabled.',
    ]
  }

  const openDecisionSummaries = buildKnownDecisionSummaryLookup(decisions)
  if (openDecisionSummaries.size === 0) {
    return []
  }

  const hasMatchingOpenDecision = sections.some((section) =>
    openDecisionSummaries.has(normalizeRemainingAnswerSourceLabel(section.label)),
  )
  if (hasMatchingOpenDecision) {
    return []
  }

  return [
    'sourceResponseFormat inline_topics requires at least one inline topic clause to match an open decision when inferOpenDecisions is enabled.',
  ]
}

export function formatFrontendQuotedValueList(values: string[]) {
  return values.map((value) => `"${value}"`).join(', ')
}

export function dedupeNonEmptyFrontendStrings(values: Array<string | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function splitFrontendStandaloneAuthoritySentences(text: string) {
  return text
    .split(/(?:\r?\n+|(?<=[.?!。？！])\s+)/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
}

function humanizeFrontendStandaloneTopicSummary(value: string | undefined) {
  const normalized = value?.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (!normalized) {
    return undefined
  }

  return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`
}

function normalizeFrontendQuestionAuthorityPrompt(text: string) {
  const trimmed = stripFrontendPresentationListMarkers(text.trim().replace(/^(?:and|but)\s+/i, ''))
    .replace(/[?？]+$/u, '')
    .trim()
  if (!trimmed) {
    return undefined
  }

  const canonicalSummary = /^(?:what)\s+should\s+(?:the\s+)?(.+?)\s+be$/i.exec(trimmed)?.[1]
  const normalizedSummary = normalizeRemainingAnswerSourceLabel(canonicalSummary ?? '')
  if (normalizedSummary) {
    return `What should the ${normalizedSummary} be?`
  }

  const collapsed = trimmed.replace(/\s+/g, ' ')
  return `${collapsed.slice(0, 1).toUpperCase()}${collapsed.slice(1)}?`
}

export function extractFrontendStandaloneQuestionAuthoritiesFromText(text: string) {
  return dedupeNonEmptyFrontendStrings(
    splitFrontendStandaloneAuthoritySentences(text).flatMap((sentence) => {
      if (!isFrontendQuestionLikeInlineTopicClause(sentence)) {
        return []
      }

      const normalized = normalizeFrontendQuestionAuthorityPrompt(sentence)
      return normalized ? [normalized] : []
    }),
  )
}

export function extractFrontendStandaloneTopicAuthoritiesFromText(
  text: string,
  { includeInlineTopicLabels = false }: { includeInlineTopicLabels?: boolean } = {},
) {
  return dedupeNonEmptyFrontendStrings(
    splitFrontendStandaloneAuthoritySentences(text).flatMap((sentence) => {
      const trimmed = stripFrontendPresentationListMarkers(
        sentence.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (!trimmed) {
        return []
      }

      const inlineTopicClause = parseFrontendInlineTopicClause(trimmed)
      if (inlineTopicClause) {
        return includeInlineTopicLabels ? [inlineTopicClause.label] : []
      }

      const prefixedSummary =
        /^(?:for|about|regarding)\s+(.+?)(?:\s*[:,]|,\s*|\s+(?:use|be|is|are|should|can|will|needs|need|requires|means|starts|start|works|work)\b)/i.exec(
          trimmed,
        )?.[1] ?? undefined
      const trailingSummary = /\bfor\s+(.+?)(?:[.?!。？！]|$)/i.exec(trimmed)?.[1] ?? undefined

      return dedupeNonEmptyFrontendStrings([
        humanizeFrontendStandaloneTopicSummary(prefixedSummary),
        humanizeFrontendStandaloneTopicSummary(trailingSummary),
      ])
    }),
  )
}

function collectSemanticallyValidFrontendInlineTopicClauseIndexes(sourceResponse: string) {
  const indexes = new Set<number>()

  for (const [clauseIndex, clause] of splitFrontendInlineTopicClauses(sourceResponse).entries()) {
    if (parseFrontendInlineTopicClause(clause)) {
      indexes.add(clauseIndex)
    }
  }

  return indexes
}

function groupRemainingNonFrontendInlineTopicClauseChunks(
  sourceResponse: string,
  inlineClauseIndexes: Set<number>,
) {
  const chunks: string[] = []
  let currentChunkClauses: string[] = []

  for (const [clauseIndex, clause] of splitFrontendInlineTopicClauses(sourceResponse).entries()) {
    if (inlineClauseIndexes.has(clauseIndex)) {
      if (currentChunkClauses.length > 0) {
        chunks.push(currentChunkClauses.join(' '))
        currentChunkClauses = []
      }
      continue
    }

    currentChunkClauses.push(clause)
  }

  if (currentChunkClauses.length > 0) {
    chunks.push(currentChunkClauses.join(' '))
  }

  return chunks
}

function hasFrontendInlineTopicExplicitConsumerCoverage(
  sections: FrontendLabeledSection[],
  decisionAnswers: FrontendDecisionLabeledSectionConsumer[],
  planningAnswers: FrontendPlanningLabeledSectionConsumer[],
) {
  const consumedLabels = new Set<string>()
  let matchedConsumerCount = 0

  for (const answer of decisionAnswers) {
    const candidates = buildFrontendDecisionLabeledSectionCandidates(answer)
    if (candidates.length === 0) {
      continue
    }

    matchedConsumerCount += 1
    if (!findFrontendSectionMatch(sections, candidates, consumedLabels)) {
      return false
    }
  }

  for (const answer of planningAnswers) {
    const candidates = buildFrontendPlanningLabeledSectionCandidates(answer)
    if (candidates.length === 0) {
      continue
    }

    matchedConsumerCount += 1
    if (!findFrontendSectionMatch(sections, candidates, consumedLabels)) {
      return false
    }
  }

  return matchedConsumerCount > 0
}

export function listInlineTopicStandaloneAuthorityIssues({
  format,
  sourceResponse,
  decisionAnswers = [],
  planningAnswers = [],
  decisions = [],
  inferDecisionTopics = false,
  inferOpenDecisions = false,
  inferRemainingAnswers = false,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  decisionAnswers?: FrontendDecisionLabeledSectionConsumer[]
  planningAnswers?: FrontendPlanningLabeledSectionConsumer[]
  decisions?: GoalDecision[]
  inferDecisionTopics?: boolean
  inferOpenDecisions?: boolean
  inferRemainingAnswers?: boolean
}) {
  if (format !== 'inline_topics') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendInlineTopicClauses(normalizedSourceResponse)
  if (issues.length > 0 || sections.length === 0) {
    return [] as string[]
  }

  const hasExplicitCoverage = hasFrontendInlineTopicExplicitConsumerCoverage(
    sections,
    decisionAnswers,
    planningAnswers,
  )
  const openDecisionSummaries = buildKnownDecisionSummaryLookup(decisions)
  const hasOpenDecisionCoverage =
    inferOpenDecisions &&
    sections.some((section) =>
      openDecisionSummaries.has(normalizeRemainingAnswerSourceLabel(section.label)),
    )
  const hasDecisionTopicInferenceCoverage =
    inferDecisionTopics &&
    !inferOpenDecisions &&
    !inferRemainingAnswers &&
    decisionAnswers.length === 0 &&
    planningAnswers.length === 0

  if (!hasExplicitCoverage && !hasOpenDecisionCoverage && !hasDecisionTopicInferenceCoverage) {
    return [] as string[]
  }

  const inlineClauseIndexes =
    collectSemanticallyValidFrontendInlineTopicClauseIndexes(normalizedSourceResponse)
  if (inlineClauseIndexes.size === 0) {
    return [] as string[]
  }

  const remainingChunks = groupRemainingNonFrontendInlineTopicClauseChunks(
    normalizedSourceResponse,
    inlineClauseIndexes,
  )
  if (remainingChunks.length === 0) {
    return [] as string[]
  }

  const standaloneQuestionAuthorities = dedupeNonEmptyFrontendStrings(
    remainingChunks.flatMap((chunk) => extractFrontendStandaloneQuestionAuthoritiesFromText(chunk)),
  )
  if (standaloneQuestionAuthorities.length > 0) {
    return [
      `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone question authority ${formatFrontendQuotedValueList(
        standaloneQuestionAuthorities,
      )} outside inline topic clauses.`,
    ]
  }

  const standaloneTopicAuthorities = dedupeNonEmptyFrontendStrings(
    remainingChunks.flatMap((chunk) => extractFrontendStandaloneTopicAuthoritiesFromText(chunk)),
  )
  if (standaloneTopicAuthorities.length > 0) {
    return [
      `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone topic authority for ${formatFrontendQuotedValueList(
        standaloneTopicAuthorities,
      )} outside inline topic clauses.`,
    ]
  }

  return [] as string[]
}

export function listAutoInlineTopicMixedAuthorityIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'auto') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  let hasSeparatorStyleClause = false
  const verbalAuthorities: string[] = []

  for (const clause of splitFrontendInlineTopicClauses(normalizedSourceResponse)) {
    const parsed = parseFrontendInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    const trimmedClause = stripFrontendPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmedClause) {
      continue
    }

    if (frontendInlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
      hasSeparatorStyleClause = true
      continue
    }

    verbalAuthorities.push(parsed.label)
  }

  const normalizedAuthorities = dedupeNonEmptyFrontendStrings(verbalAuthorities)
  if (!hasSeparatorStyleClause || normalizedAuthorities.length === 0) {
    return [] as string[]
  }

  return [
    `sourceResponseFormat inline_topics rejected sourceResponse because it mixed separator-style inline topic authority with additional verbal inline topic authority for ${formatFrontendQuotedValueList(
      normalizedAuthorities,
    )}.`,
  ]
}
