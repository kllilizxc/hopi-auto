import { dedupeNonEmptyStrings, normalizeSourceResponseText } from './answerInterpretationStrings'
import type { EmbeddedMatchingRunToken } from './answerInterpretationTypes'

interface EmbeddedTopicCandidateSupportDependencies {
  extractLeadingTopicSummary: (text: string) => string | undefined
  extractTrailingTopicSummary: (text: string) => string | undefined
  startsWithNonPunctuatedWhClauseDeclarative: (text: string) => boolean
}

const EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS = new Set([
  'after',
  'and',
  'before',
  'because',
  'but',
  'or',
  'then',
])

export function createAnswerInterpretationEmbeddedTopicCandidateSupport(
  dependencies: EmbeddedTopicCandidateSupportDependencies,
) {
  function inferEmbeddedLeadingTopicCandidateLabels(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
  ) {
    if (dependencies.startsWithNonPunctuatedWhClauseDeclarative(sourceResponse)) {
      return []
    }

    const labels: string[] = []

    for (const token of tokens) {
      const suffix = sourceResponse.slice(token.start)
      const summary = dependencies.extractLeadingTopicSummary(suffix)
      const normalizedSummary = summary ? normalizeSourceResponseText(summary) : undefined
      if (!normalizedSummary) {
        continue
      }

      const summaryTokens = normalizedSummary.split(' ').filter(Boolean)
      if (
        summaryTokens.length < 2 ||
        summaryTokens.some((summaryToken) =>
          EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS.has(summaryToken),
        )
      ) {
        continue
      }

      labels.push(normalizedSummary)
    }

    return dedupeNonEmptyStrings(labels)
  }

  function inferEmbeddedClosingTopicCandidateLabels(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
  ) {
    const labels: string[] = []

    for (const token of tokens) {
      const prefix = sourceResponse.slice(0, token.end)
      const summary = dependencies.extractTrailingTopicSummary(prefix)
      const normalizedSummary = summary ? normalizeSourceResponseText(summary) : undefined
      if (!normalizedSummary) {
        continue
      }

      const summaryTokens = normalizedSummary.split(' ').filter(Boolean)
      if (
        summaryTokens.length < 2 ||
        summaryTokens.some((summaryToken) =>
          EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS.has(summaryToken),
        )
      ) {
        continue
      }

      labels.push(normalizedSummary)
    }

    return dedupeNonEmptyStrings(labels)
  }

  return {
    inferEmbeddedClosingTopicCandidateLabels,
    inferEmbeddedLeadingTopicCandidateLabels,
  }
}
