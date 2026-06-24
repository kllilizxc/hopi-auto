import type { GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import { parseListInput } from './boardViewStructuredEditorCodec'
import {
  buildKnownDecisionSummaryCountMap,
  buildKnownDecisionSummaryLookup,
  humanizeRemainingDecisionDescriptorKey,
  normalizeRemainingAnswerSourceLabel,
} from './boardViewRemainingAnswerSourceSupport'

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export type FrontendLabeledSection = {
  label: string
  value: string
}

export type FrontendDecisionLabeledSectionConsumer = {
  decisionKey?: string
  summaryKey?: string
  summary: string
  prompt?: string
  matchHints?: string | string[]
}

export type FrontendPlanningLabeledSectionConsumer = {
  answerKey?: string
  summaryKey?: string
  summary: string
  prompt?: string
  matchHints?: string | string[]
}

function findNestedFrontendLabeledSectionInValue(value: string) {
  const sentences = value
    .split(/(?<=[.?!。？！])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)

  const nestedAtStart = /^(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(.+)$/u.exec(sentences[0] ?? '')
  if (nestedAtStart?.[1]?.trim() && nestedAtStart?.[2]?.trim()) {
    return nestedAtStart[1].trim()
  }

  for (const sentence of sentences.slice(1)) {
    const nestedSentence = /^(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(.+)$/u.exec(sentence)
    if (nestedSentence?.[1]?.trim() && nestedSentence?.[2]?.trim()) {
      return nestedSentence[1].trim()
    }
  }

  return null
}

export function parseFrontendLabeledSectionLine(line: string) {
  const trimmed = line.trim().replace(/^(?:[-*•]\s*)+/u, '')
  if (!trimmed) {
    return undefined
  }

  const match = /^(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(.+)$/u.exec(trimmed)
  const label = match?.[1]?.trim()
  const value = match?.[2]?.trim()
  if (!label || !value) {
    return undefined
  }

  return { label, value } satisfies FrontendLabeledSection
}

export function analyzeFrontendLabeledSections(sourceResponse: string) {
  const sections: FrontendLabeledSection[] = []
  const seenLabels = new Set<string>()
  const issues: string[] = []

  for (const line of sourceResponse.split(/\r?\n/)) {
    const parsed = parseFrontendLabeledSectionLine(line)
    if (!parsed) {
      continue
    }
    const { label, value } = parsed

    if (findNestedFrontendLabeledSectionInValue(value)) {
      issues.push(
        `Labeled section "${label}" in sourceResponse included another labeled section inside its value.`,
      )
      continue
    }

    const normalizedLabel = normalizeRemainingAnswerSourceLabel(label)
    if (!normalizedLabel) {
      continue
    }
    if (seenLabels.has(normalizedLabel)) {
      issues.push(`Duplicate labeled section "${label}" in sourceResponse.`)
      continue
    }

    seenLabels.add(normalizedLabel)
    sections.push({ label, value })
  }

  return { sections, issues }
}

export function parseFrontendLabeledSections(sourceResponse: string) {
  return analyzeFrontendLabeledSections(sourceResponse).sections
}

export function listLabeledSectionStructureIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'labeled_sections') {
    return [] as string[]
  }

  return analyzeFrontendLabeledSections(normalizeOptionalString(sourceResponse) ?? '').issues
}

export function listLabeledSectionUnconsumedIssues({
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
    format !== 'labeled_sections' ||
    inferOpenDecisions ||
    inferDecisionTopics ||
    inferRemainingAnswers
  ) {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendLabeledSections(
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
    `sourceResponseFormat labeled_sections rejected sourceResponse because it left ${unconsumedSectionCount} unconsumed labeled sections.`,
  ]
}

function normalizeFrontendLabeledSectionMatchHints(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  }

  if (typeof value === 'string') {
    return parseListInput(value)
  }

  return [] as string[]
}

function dedupeFrontendLabeledSectionCandidates(candidates: Array<string | undefined>) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const candidate of candidates) {
    const trimmed = candidate?.trim()
    if (!trimmed) {
      continue
    }
    const identity = normalizeRemainingAnswerSourceLabel(trimmed)
    if (!identity || seen.has(identity)) {
      continue
    }
    seen.add(identity)
    result.push(trimmed)
  }

  return result
}

export function buildFrontendDecisionLabeledSectionCandidates(
  answer: FrontendDecisionLabeledSectionConsumer,
) {
  return dedupeFrontendLabeledSectionCandidates([
    humanizeRemainingDecisionDescriptorKey(answer.summaryKey),
    humanizeRemainingDecisionDescriptorKey(answer.decisionKey),
    answer.summary,
    answer.prompt,
    ...normalizeFrontendLabeledSectionMatchHints(answer.matchHints),
  ])
}

export function buildFrontendPlanningLabeledSectionCandidates(
  answer: FrontendPlanningLabeledSectionConsumer,
) {
  return dedupeFrontendLabeledSectionCandidates([
    humanizeRemainingDecisionDescriptorKey(answer.answerKey),
    humanizeRemainingDecisionDescriptorKey(answer.summaryKey),
    answer.summary,
    answer.prompt,
    ...normalizeFrontendLabeledSectionMatchHints(answer.matchHints),
  ])
}

export function findFrontendSectionMatch(
  sections: FrontendLabeledSection[],
  candidates: string[],
  consumedLabels: Set<string>,
) {
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeRemainingAnswerSourceLabel(candidate)
    if (!normalizedCandidate || consumedLabels.has(normalizedCandidate)) {
      continue
    }

    const match = sections.find(
      (section) => normalizeRemainingAnswerSourceLabel(section.label) === normalizedCandidate,
    )
    if (match) {
      consumedLabels.add(normalizedCandidate)
      return match
    }
  }

  return null
}

export function listLabeledSectionExplicitConsumerMatchIssues({
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
  if (format !== 'labeled_sections') {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendLabeledSections(
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
        `No labeled section matched decision answer ${
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
        `No labeled section matched planner answer ${answer.summary.trim()} in sourceResponse.`,
      ]
    }
  }

  return [] as string[]
}

export function listLabeledSectionDecisionTopicIssues({
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
  if (!inferDecisionTopics || format !== 'labeled_sections') {
    return [] as string[]
  }

  const sections = parseFrontendLabeledSections(normalizeOptionalString(sourceResponse) ?? '')
  if (sections.length === 0) {
    return [
      'sourceResponseFormat labeled_sections requires at least one labeled section when inferDecisionTopics is enabled.',
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

export function listLabeledSectionOpenDecisionIssues({
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
  if (!inferOpenDecisions || format !== 'labeled_sections' || explicitDecisionAnswerCount > 0) {
    return [] as string[]
  }

  const sections = parseFrontendLabeledSections(normalizeOptionalString(sourceResponse) ?? '')
  if (sections.length === 0) {
    return [
      'sourceResponseFormat labeled_sections requires at least one labeled section when inferOpenDecisions is enabled.',
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
    'sourceResponseFormat labeled_sections requires at least one labeled section to match an open decision when inferOpenDecisions is enabled.',
  ]
}
