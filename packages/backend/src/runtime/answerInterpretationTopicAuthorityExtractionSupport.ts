import { dedupeNonEmptyStrings, normalizeSourceResponseLabel } from './answerInterpretationStrings'

interface TopicAuthorityExtractionSupportDependencies {
  extractAsTopicSummary: (text: string) => string | undefined
  extractCopularTopicSummary: (text: string) => string | undefined
  extractPrefixedTopicSummary: (text: string) => string | undefined
  extractTrailingTopicSummary: (text: string) => string | undefined
  getSubordinateClauseLeadingWords: () => Iterable<string>
  matchLeadingTopicAuthority: (
    text: string,
  ) => { label?: string; answer?: string } | undefined
  normalizeExtractedTopicSummary: (
    summary: string,
    stripLeadingArticle?: boolean,
  ) => string | undefined
  parseInlineTopicClause: (clause: string) => { label: string; value: string } | undefined
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  parseTopicSourceResponseClauses: (sourceResponse: string) => Array<{ text: string }>
  parseTopicSourceResponseSentences: (sourceResponse: string) => Array<{ text: string }>
  startsWithMultiTokenSubordinateClauseSequence: (tokens: string[]) => boolean
  stripLeadingTopicPromptConjunction: (text: string) => string
  topicPredicateIncludesSubstantiveAnswerContent: (answer: string) => boolean
  topicSummaryVerbPattern: string
}

export function createAnswerInterpretationTopicAuthorityExtractionSupport(
  dependencies: TopicAuthorityExtractionSupportDependencies,
) {
  const QUESTION_ANSWER_TOPIC_LEADING_LABEL_REJECT_TOKENS = new Set([
    'do',
    'does',
    'did',
    'keep',
    'keeps',
    'keeping',
    'kept',
    'means',
    'require',
    'requires',
    'required',
    'start',
    'starts',
    'started',
    'then',
    'use',
    'uses',
    'used',
    'when',
    ...dependencies.getSubordinateClauseLeadingWords(),
  ])

  function questionAnswerLabelHasRejectedLeadingTokens(labelTokens: string[]) {
    return (
      labelTokens.length === 0 ||
      labelTokens.some((token) => QUESTION_ANSWER_TOPIC_LEADING_LABEL_REJECT_TOKENS.has(token)) ||
      dependencies.startsWithMultiTokenSubordinateClauseSequence(labelTokens)
    )
  }

  function extractQuestionAnswerLeadingTopicSummary(text: string) {
    const trimmed = dependencies.stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return undefined
    }

    const label = dependencies.matchLeadingTopicAuthority(trimmed)?.label
    if (!label) {
      return undefined
    }

    const normalizedLabel = normalizeSourceResponseLabel(label)
    if (!normalizedLabel) {
      return undefined
    }

    const labelTokens = normalizedLabel.split(' ').filter(Boolean)
    if (questionAnswerLabelHasRejectedLeadingTokens(labelTokens)) {
      return undefined
    }

    return dependencies.normalizeExtractedTopicSummary(label, true)
  }

  function matchLeadingTopicAuthorityAllowBarePredicate(text: string) {
    return new RegExp(
      `^(?<label>.+?)\\s+(?<answer>${dependencies.topicSummaryVerbPattern}\\b.*)$`,
      'i',
    ).exec(text)?.groups
  }

  function extractIncompleteLeadingTopicAuthoritySummary(text: string) {
    const trimmed = dependencies.stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return undefined
    }

    const groups = matchLeadingTopicAuthorityAllowBarePredicate(trimmed)
    const label = groups?.label
    const answer = groups?.answer
    if (
      !label ||
      answer === undefined ||
      dependencies.topicPredicateIncludesSubstantiveAnswerContent(answer)
    ) {
      return undefined
    }

    return dependencies.normalizeExtractedTopicSummary(label, true)
  }

  function extractNestedLeadingTopicAuthoritySummary(text: string): string | undefined {
    const trimmed = dependencies.stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return undefined
    }

    const groups = matchLeadingTopicAuthorityAllowBarePredicate(trimmed)
    const label = groups?.label
    const answer = groups?.answer
    if (
      !label ||
      answer === undefined ||
      !dependencies.normalizeExtractedTopicSummary(label, true)
    ) {
      return undefined
    }

    const strippedAnswer = answer
      .trim()
      .replace(new RegExp(`^(?:${dependencies.topicSummaryVerbPattern})\\b\\s*`, 'i'), '')
      .trim()
    if (!strippedAnswer) {
      return undefined
    }

    const nestedLabel = matchLeadingTopicAuthorityAllowBarePredicate(strippedAnswer)?.label
    const nestedSummary = nestedLabel
      ? dependencies.normalizeExtractedTopicSummary(nestedLabel, true)
      : undefined
    return nestedSummary ?? extractNestedLeadingTopicAuthoritySummary(strippedAnswer)
  }

  function sanitizeQuestionAnswerExplicitTopicSummary(summary: string | undefined) {
    if (!summary) {
      return undefined
    }

    const normalizedSummary = normalizeSourceResponseLabel(summary)
    if (!normalizedSummary) {
      return undefined
    }

    const labelTokens = normalizedSummary.split(' ').filter(Boolean)
    if (questionAnswerLabelHasRejectedLeadingTokens(labelTokens)) {
      return undefined
    }

    return summary
  }

  function extractExplicitTopicSummariesFromQuestionAnswerSentence(text: string) {
    const trimmed = text.trim()
    if (!trimmed) {
      return []
    }

    const hasExplicitInlineTopicDelimiter =
      /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmed) ||
      /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.test(trimmed)
    const inlineTopicSummary = sanitizeQuestionAnswerExplicitTopicSummary(
      hasExplicitInlineTopicDelimiter
        ? dependencies.normalizeExtractedTopicSummary(
            dependencies.parseInlineTopicClause(trimmed)?.label ?? '',
            true,
          )
        : undefined,
    )
    const prefixed = sanitizeQuestionAnswerExplicitTopicSummary(
      dependencies.extractPrefixedTopicSummary(trimmed),
    )
    const asTopic = sanitizeQuestionAnswerExplicitTopicSummary(
      dependencies.extractAsTopicSummary(trimmed),
    )
    const trailing = sanitizeQuestionAnswerExplicitTopicSummary(
      dependencies.extractTrailingTopicSummary(trimmed),
    )
    const copular = sanitizeQuestionAnswerExplicitTopicSummary(
      dependencies.extractCopularTopicSummary(trimmed),
    )
    const leading = copular ? undefined : extractQuestionAnswerLeadingTopicSummary(trimmed)

    return dedupeNonEmptyStrings([inlineTopicSummary, prefixed, asTopic, trailing, copular, leading])
  }

  function extractExplicitTopicSummariesFromQuestionAnswerText(answer: string) {
    return dedupeNonEmptyStrings(
      dependencies.parseTopicSourceResponseSentences(answer).flatMap((sentence) =>
        extractExplicitTopicSummariesFromQuestionAnswerSentence(sentence.text),
      ),
    )
  }

  function extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(answer: string) {
    return dedupeNonEmptyStrings(
      dependencies.parseTopicSourceResponseSentences(answer).flatMap((sentence) => {
        const summary = extractIncompleteLeadingTopicAuthoritySummary(sentence.text)
        return summary ? [summary] : []
      }),
    )
  }

  function collectDirectAnswerTextAuthoritySegments(answer: string) {
    const clauses = dependencies.parseTopicSourceResponseClauses(answer).map((clause) => clause.text)
    const conjunctions = dependencies.parsePendingSourceResponseConjunctions(answer)
    return dedupeNonEmptyStrings([
      ...dependencies.parseTopicSourceResponseSentences(answer).map((sentence) => sentence.text),
      ...(clauses.length > 1 ? clauses : []),
      ...(conjunctions.length > 1 ? conjunctions : []),
    ])
  }

  function extractExplicitTopicSummariesFromDirectAnswerText(answer: string) {
    return dedupeNonEmptyStrings(
      collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) =>
        extractExplicitTopicSummariesFromQuestionAnswerSentence(segment),
      ),
    )
  }

  function extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText(answer: string) {
    return dedupeNonEmptyStrings(
      collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) => {
        const summary = extractIncompleteLeadingTopicAuthoritySummary(segment)
        return summary ? [summary] : []
      }),
    )
  }

  function extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText(answer: string) {
    return dedupeNonEmptyStrings(
      collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) => {
        const summary = extractNestedLeadingTopicAuthoritySummary(segment)
        return summary ? [summary] : []
      }),
    )
  }

  return {
    extractExplicitTopicSummariesFromDirectAnswerText,
    extractExplicitTopicSummariesFromQuestionAnswerSentence,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummary,
    extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractNestedLeadingTopicAuthoritySummary,
  }
}
