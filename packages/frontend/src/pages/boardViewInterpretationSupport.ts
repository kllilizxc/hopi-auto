import type {
  GoalAnswerSourceInput,
  GoalDecisionFollowThroughInput,
  GoalSourceResponseFormat,
} from '../lib/api'
import {
  analyzeFrontendLabeledSections,
  parseFrontendLabeledSectionLine,
  type FrontendPlanningLabeledSectionConsumer,
} from './boardViewLabeledSectionSupport'
import {
  dedupeNonEmptyFrontendStrings,
  extractFrontendStandaloneQuestionAuthoritiesFromText,
  extractFrontendStandaloneTopicAuthoritiesFromText,
  formatFrontendQuotedValueList,
  listAutoInlineTopicMixedAuthorityIssues,
} from './boardViewInlineTopicSupport'
import { normalizeOptionalString, parseAnswerSourcesJson } from './boardViewJsonInputSupport'
import {
  formatUsesAnswerSourceOnlyInterpretation,
  listMixedDecisionTopicAndRemainingAnswerIssues,
} from './boardViewRemainingAnswerSourceSupport'
import {
  INFER_DECISION_TOPIC_FORMATS,
  INFER_OPEN_DECISION_FORMATS,
  INFER_REMAINING_PLANNING_ANSWER_FORMATS,
  describeSourceResponseInputAuthority,
  type ExplicitAnswerSourceReferenceGroup,
} from './boardViewSourceResponseSupport'

export function buildPlanningAnswerConsumersFromDecisionFollowThrough(
  followThrough: GoalDecisionFollowThroughInput | undefined,
) {
  if (!followThrough) {
    return [] as FrontendPlanningLabeledSectionConsumer[]
  }

  if (followThrough.kind === 'workflow_batch') {
    return [
      ...(followThrough.answers ?? []),
      ...followThrough.workflows.flatMap((workflowChild) => workflowChild.answers ?? []),
    ]
  }

  return followThrough.answers ?? []
}

export function parseAnswerSourcesJsonIfValid(source: string, label: string) {
  if (!source.trim()) {
    return undefined
  }

  try {
    return parseAnswerSourcesJson(source, label)
  } catch {
    return undefined
  }
}

function groupRemainingNonFrontendLabeledSectionLineChunks(sourceResponse: string) {
  const chunks: string[] = []
  let currentChunkLines: string[] = []

  const flushChunk = () => {
    if (currentChunkLines.length === 0) {
      return
    }

    chunks.push(currentChunkLines.join(' '))
    currentChunkLines = []
  }

  for (const line of sourceResponse.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushChunk()
      continue
    }

    if (parseFrontendLabeledSectionLine(line)) {
      flushChunk()
      continue
    }

    currentChunkLines.push(trimmed)
  }

  flushChunk()
  return chunks
}

export function listLabeledSectionStandaloneAuthorityIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'labeled_sections' && format !== 'auto') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  const { sections, issues } = analyzeFrontendLabeledSections(normalizedSourceResponse)
  if (issues.length > 0 || sections.length === 0) {
    return []
  }

  const remainingChunks =
    groupRemainingNonFrontendLabeledSectionLineChunks(normalizedSourceResponse)
  if (remainingChunks.length === 0) {
    return []
  }

  const standaloneQuestionAuthorities = dedupeNonEmptyFrontendStrings(
    remainingChunks.flatMap((chunk) => extractFrontendStandaloneQuestionAuthoritiesFromText(chunk)),
  )
  if (standaloneQuestionAuthorities.length > 0) {
    return [
      format === 'auto'
        ? `sourceResponseFormat auto rejected labeled_sections because sourceResponse still included standalone question authority ${formatFrontendQuotedValueList(
            standaloneQuestionAuthorities,
          )} outside labeled sections.`
        : `sourceResponseFormat labeled_sections rejected sourceResponse because it still included standalone question authority ${formatFrontendQuotedValueList(
            standaloneQuestionAuthorities,
          )} outside labeled sections.`,
    ]
  }

  const standaloneTopicAuthorities = dedupeNonEmptyFrontendStrings(
    remainingChunks.flatMap((chunk) =>
      extractFrontendStandaloneTopicAuthoritiesFromText(chunk, {
        includeInlineTopicLabels: true,
      }),
    ),
  )
  if (standaloneTopicAuthorities.length > 0) {
    return [
      format === 'auto'
        ? `sourceResponseFormat auto rejected labeled_sections because sourceResponse still included standalone topic authority for ${formatFrontendQuotedValueList(
            standaloneTopicAuthorities,
          )} outside labeled sections.`
        : `sourceResponseFormat labeled_sections rejected sourceResponse because it still included standalone topic authority for ${formatFrontendQuotedValueList(
            standaloneTopicAuthorities,
          )} outside labeled sections.`,
    ]
  }

  return [] as string[]
}

export function hasDirectAnswerSourceReferenceAuthority(
  answerSourceKey: string | undefined,
  answerSourceGroupKey: string | undefined,
) {
  return (answerSourceKey?.trim().length ?? 0) > 0 || (answerSourceGroupKey?.trim().length ?? 0) > 0
}

export function listDirectAnswerSourceReferenceIssues(
  answerSourceKey: string | undefined,
  answerSourceGroupKey: string | undefined,
) {
  const normalizedAnswerSourceKey = answerSourceKey?.trim() ?? ''
  const normalizedAnswerSourceGroupKey = answerSourceGroupKey?.trim() ?? ''
  if (normalizedAnswerSourceKey.length > 0 && normalizedAnswerSourceGroupKey.length > 0) {
    return ['Provide only answerSourceKey or answerSourceGroupKey for this explicit answer.']
  }

  return [] as string[]
}

function buildKnownAnswerSourceReferenceSets(answerSources?: GoalAnswerSourceInput[]) {
  const answerSourceKeys = new Set<string>()
  const answerSourceGroupKeys = new Set<string>()

  for (const answerSource of answerSources ?? []) {
    const answerSourceKey = answerSource.answerSourceKey.trim()
    if (answerSourceKey) {
      answerSourceKeys.add(answerSourceKey)
    }

    const answerSourceGroupKey = answerSource.sourceGroupKey?.trim() ?? ''
    if (answerSourceGroupKey) {
      answerSourceGroupKeys.add(answerSourceGroupKey)
    }
  }

  return { answerSourceKeys, answerSourceGroupKeys }
}

export function listExplicitAnswerSourceReferenceExistenceIssues(
  groups: ExplicitAnswerSourceReferenceGroup[],
  answerSources?: GoalAnswerSourceInput[],
) {
  const issues: string[] = []
  const { answerSourceKeys, answerSourceGroupKeys } =
    buildKnownAnswerSourceReferenceSets(answerSources)

  for (const group of groups) {
    group.entries.forEach((entry, index) => {
      const answer = entry.answer?.trim() ?? ''
      const sourceExcerpt = entry.sourceExcerpt?.trim() ?? ''
      const answerSourceKey = entry.answerSourceKey?.trim() ?? ''
      const answerSourceGroupKey = entry.answerSourceGroupKey?.trim() ?? ''

      if (
        answer ||
        sourceExcerpt ||
        (!answerSourceKey && !answerSourceGroupKey) ||
        (answerSourceKey && answerSourceGroupKey)
      ) {
        return
      }

      const label = group.entries.length === 1 ? group.label : `${group.label} entry ${index + 1}`
      if (answerSourceKey && !answerSourceKeys.has(answerSourceKey)) {
        issues.push(`${label} references unknown answerSourceKey "${answerSourceKey}".`)
      }
      if (answerSourceGroupKey && !answerSourceGroupKeys.has(answerSourceGroupKey)) {
        issues.push(`${label} references unknown answerSourceGroupKey "${answerSourceGroupKey}".`)
      }
    })
  }

  return issues
}

export function listInferOpenDecisionExplicitAnswerIssues(
  answers: Array<{
    decisionKey?: string
    summary: string
  }>,
  inferOpenDecisions: boolean,
) {
  if (!inferOpenDecisions) {
    return [] as string[]
  }

  const missingDecisionKeys = answers
    .filter((answer) => !answer.decisionKey?.trim())
    .map((answer) => answer.summary.trim())
    .filter((summary) => summary.length > 0)

  if (missingDecisionKeys.length === 0) {
    return [] as string[]
  }

  return [
    `Infer open decisions requires every explicit answer entry to include decisionKey. Missing decisionKey for: ${missingDecisionKeys.join(', ')}.`,
  ]
}

export function hasInterpretationInputForSelectedFormat(
  format: GoalSourceResponseFormat,
  sourceResponse: string | undefined,
  answerSources?: GoalAnswerSourceInput[],
) {
  if (sourceResponse) {
    return true
  }

  return (
    !!answerSources &&
    answerSources.length > 0 &&
    (format === 'auto' || formatUsesAnswerSourceOnlyInterpretation(format))
  )
}

export function resolveSelectedInterpretationFormat(
  format: GoalSourceResponseFormat,
  sourceResponse: string | undefined,
  answerSources?: GoalAnswerSourceInput[],
) {
  return hasInterpretationInputForSelectedFormat(format, sourceResponse, answerSources)
    ? format
    : undefined
}

export function formatSupportsInferOpenDecisions(format: GoalSourceResponseFormat) {
  return format === 'auto' || INFER_OPEN_DECISION_FORMATS.has(format)
}

export function formatSupportsInferDecisionTopics(format: GoalSourceResponseFormat) {
  return format === 'auto' || INFER_DECISION_TOPIC_FORMATS.has(format)
}

export function formatSupportsInferRemainingAnswers(format: GoalSourceResponseFormat) {
  return format === 'auto' || INFER_REMAINING_PLANNING_ANSWER_FORMATS.has(format)
}

export function listSourceResponseFormatCompatibilityIssues({
  format,
  sourceResponse,
  answerSourcesJson,
  answerSourcesLabel,
  inferOpenDecisions = false,
  inferDecisionTopics = false,
  inferRemainingAnswers = false,
  mixedRemainingAnswerInference = false,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSourcesJson: string
  answerSourcesLabel: string
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
  mixedRemainingAnswerInference?: boolean
}) {
  const sourceResponseValue = normalizeOptionalString(sourceResponse)
  const answerSources = parseAnswerSourcesJsonIfValid(answerSourcesJson, answerSourcesLabel)
  const usesSharedInterpretation =
    Boolean(sourceResponseValue) ||
    Boolean(answerSources && answerSources.length > 0) ||
    inferOpenDecisions ||
    inferDecisionTopics ||
    inferRemainingAnswers

  if (!usesSharedInterpretation) {
    return []
  }

  const issues: string[] = []

  if (!hasInterpretationInputForSelectedFormat(format, sourceResponseValue, answerSources)) {
    issues.push(
      `Current selection needs ${describeSourceResponseInputAuthority(format)} before shared interpretation can run.`,
    )
  }

  if (inferOpenDecisions && !formatSupportsInferOpenDecisions(format)) {
    issues.push('Infer open decisions is not supported by the current source-response format.')
  }

  if (inferDecisionTopics && !formatSupportsInferDecisionTopics(format)) {
    issues.push('Infer decision topics is not supported by the current source-response format.')
  }

  if (inferRemainingAnswers && !formatSupportsInferRemainingAnswers(format)) {
    issues.push(
      'Infer remaining planner answers is not supported by the current source-response format.',
    )
  }

  issues.push(
    ...listMixedDecisionTopicAndRemainingAnswerIssues(
      format,
      answerSources,
      inferDecisionTopics,
      mixedRemainingAnswerInference,
    ),
  )

  issues.push(
    ...listAutoInlineTopicMixedAuthorityIssues({
      format,
      sourceResponse,
    }),
  )

  return issues
}
