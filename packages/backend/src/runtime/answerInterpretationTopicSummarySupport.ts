import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type { ResolvedAnswerSourceEntry } from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  dedupeNonEmptyStrings,
  humanizeAnswerSourceKey,
  humanizeDecisionKey,
  humanizeSummaryKey,
  normalizeSourceResponseLabel,
} from './answerInterpretationStrings'
import type {
  TopicSourceResponseBlock,
  TopicSourceResponseClosingBlock,
  TopicSourceResponseClosingSpan,
  TopicSourceResponseSpan,
} from './answerInterpretationTypes'

interface TopicSummarySupportDependencies {
  getQuestionCoreLeadingTokens: () => Iterable<string>
  getSubordinateClauseLeadingWords: () => Iterable<string>
  inferCanonicalQuestionAnchorSummary: (question: string) => string | undefined
  matchLeadingSubordinateClauseSequenceLength: (tokens: string[]) => number | undefined
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  parseTopicSourceResponseClauses: (sourceResponse: string) => Array<{ text: string }>
  startsWithMultiTokenSubordinateClauseSequence: (tokens: string[]) => boolean
  startsWithNonPunctuatedWhClauseDeclarative: (text: string) => boolean
  stripLeadingPresentationListMarkers: (text: string) => string
  stripLeadingQuestionPromptConjunction: (question: string) => string
  topicSummaryPrefixPattern: string
  topicSummaryVerbPattern: string
}

const EXTRACTABLE_TOPIC_SUMMARY_PATTERN = "[A-Za-z0-9][A-Za-z0-9 &'’/_-]*?"

export function createAnswerInterpretationTopicSummarySupport(
  dependencies: TopicSummarySupportDependencies,
) {
  function getLeadingTopicSummaryRejectTokens() {
    return new Set([
      'about',
      ...dependencies.getSubordinateClauseLeadingWords(),
      ...dependencies.getQuestionCoreLeadingTokens(),
      'he',
      'her',
      'here',
      'him',
      'i',
      'it',
      'me',
      'my',
      'now',
      'she',
      'that',
      'their',
      'them',
      'there',
      'these',
      'they',
      'this',
      'those',
      'us',
      'we',
      'you',
      'your',
      'regarding',
    ])
  }

  function stripQuestionBlockLabel(question: string) {
    return dependencies.stripLeadingQuestionPromptConjunction(question)
      .replace(/[?？]+\s*$/u, '')
      .trim()
  }

  function inferSummaryFromQuestionLabel(question: string) {
    return dependencies.inferCanonicalQuestionAnchorSummary(question) ?? stripQuestionBlockLabel(question)
  }

  function inferComparableQuestionTopicSummary(question: string) {
    return (
      dependencies.inferCanonicalQuestionAnchorSummary(question) ??
      normalizeExtractedTopicSummary(stripQuestionBlockLabel(question), true)
    )
  }

  function inferComparableExplicitLabelSummary(label: string) {
    return (
      dependencies.inferCanonicalQuestionAnchorSummary(label) ??
      normalizeExtractedTopicSummary(label, true)
    )
  }

  function inferTopicSpanAnchorLabelsFromSentence(sentence: string) {
    return inferNormalizedTopicAnchorLabelsFromText(sentence)
  }

  function inferTopicClosingSpanLabelsFromSentence(sentence: string) {
    return inferNormalizedTopicAnchorLabelsFromText(sentence)
  }

  function inferTopicClosingBlockLabelsFromParagraph(paragraph: string) {
    return inferNormalizedTopicAnchorLabelsFromText(paragraph)
  }

  function inferTopicBlockAnchorLabelsFromParagraph(paragraph: string) {
    return inferNormalizedTopicAnchorLabelsFromText(paragraph)
  }

  function inferNormalizedTopicAnchorLabelsFromText(text: string) {
    return extractTopicAnchorCandidateSummariesFromText(text)
      .map((summary) => normalizeSourceResponseLabel(summary))
      .filter(Boolean)
  }

  function inferTopicSummaryFromTopicSentence(sentence: string) {
    assertTopicTextHasSubstantiveLeadingAnswerContent(sentence, 'topic sentence')
    const summaries = extractTopicAnchorCandidateSummariesFromText(sentence)
    if (summaries.length === 0) {
      throw new AnswerInterpretationError(
        `Could not infer a decision summary from topic sentence "${sentence}".`,
      )
    }
    if (summaries.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple decision summaries were inferred from topic sentence "${sentence}".`,
      )
    }
    return summaries[0] as string
  }

  function inferTopicSummaryFromTopicParagraph(paragraph: string) {
    assertTopicTextHasSubstantiveLeadingAnswerContent(paragraph, 'topic paragraph')
    const summaries = extractTopicAnchorCandidateSummariesFromParagraphText(paragraph)
    if (summaries.length === 0) {
      throw new AnswerInterpretationError(
        `Could not infer a decision summary from topic paragraph "${paragraph}".`,
      )
    }
    if (summaries.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple decision summaries were inferred from topic paragraph "${paragraph}".`,
      )
    }
    return summaries[0] as string
  }

  function extractTopicAnchorCandidateSummariesFromText(text: string) {
    const conjunctionSegments = dependencies.parsePendingSourceResponseConjunctions(text)
    if (conjunctionSegments.length <= 1) {
      return extractInferredTopicSummaries(text)
    }

    return dedupeNonEmptyStrings(
      conjunctionSegments.flatMap((segment) => extractInferredTopicSummaries(segment)),
    )
  }

  function extractTopicAnchorCandidateSummariesFromParagraphText(text: string) {
    return dedupeNonEmptyStrings([
      ...extractTopicAnchorCandidateSummariesFromText(text),
      ...dependencies.parseTopicSourceResponseClauses(text).flatMap((clause) =>
        extractTopicAnchorCandidateSummariesFromText(clause.text),
      ),
    ])
  }

  function paragraphTextImpliesMultipleTopicSummaries(text: string) {
    return extractTopicAnchorCandidateSummariesFromParagraphText(text).length > 1
  }

  function inferTopicSummaryFromTopicSpan(span: TopicSourceResponseSpan) {
    return inferTopicSummaryFromTopicSentence(span.anchorText)
  }

  function inferTopicSummaryFromTopicClosingSpan(span: TopicSourceResponseClosingSpan) {
    return inferTopicSummaryFromTopicSentence(span.closingText)
  }

  function inferTopicSummaryFromTopicClosingBlock(block: TopicSourceResponseClosingBlock) {
    return inferTopicSummaryFromTopicParagraph(block.closingText)
  }

  function inferTopicSummaryFromTopicBlock(block: TopicSourceResponseBlock) {
    return inferTopicSummaryFromTopicParagraph(block.anchorText)
  }

  function normalizeExtractedTopicSummary(summary: string, stripLeadingArticle = false) {
    const normalizedSummary = summary
      .trim()
      .replace(stripLeadingArticle ? /^(?:the|a|an)\s+/i : /^$/u, '')
      .replace(/\s+/g, ' ')
    if (!normalizedSummary) {
      return undefined
    }

    const normalized = normalizeSourceResponseLabel(normalizedSummary)
    if (!normalized) {
      return undefined
    }

    const tokens = normalized.split(' ').filter(Boolean)
    if (tokens.length === 0 || tokens.length > 6) {
      return undefined
    }
    const firstToken = tokens[0]
    if (
      (firstToken && getLeadingTopicSummaryRejectTokens().has(firstToken)) ||
      dependencies.startsWithMultiTokenSubordinateClauseSequence(tokens)
    ) {
      return undefined
    }

    return `${normalizedSummary.slice(0, 1).toUpperCase()}${normalizedSummary.slice(1)}`
  }

  function extractTrailingTopicSummary(text: string) {
    const trimmed = text.trim()
    if (!trimmed || dependencies.startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
      return undefined
    }

    const normalized = normalizeSourceResponseLabel(trimmed)
    if (normalized) {
      const tokens = normalized.split(' ').filter(Boolean)
      if (dependencies.matchLeadingSubordinateClauseSequenceLength(tokens) !== undefined) {
        return undefined
      }
    }

    const match = new RegExp(
      `\\bfor\\s+(?!(?:the|a|an)\\b)(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[,.;?!，；。？！]?$`,
      'i',
    ).exec(trimmed)?.groups?.summary
    if (!match) {
      return undefined
    }

    return normalizeExtractedTopicSummary(match)
  }

  function inferSummaryFromStablePrompt(prompt: string | undefined) {
    const trimmed = prompt?.trim()
    if (!trimmed) {
      return undefined
    }

    const canonicalSummary = dependencies.inferCanonicalQuestionAnchorSummary(trimmed)
    if (!canonicalSummary) {
      return synthesizeCanonicalPromptFromSummary(trimmed) === trimmed ? trimmed : undefined
    }

    return canonicalSummary
  }

  function inferSummaryFromStableMatchHints(matchHints: string[] | undefined) {
    const hints = dedupeNonEmptyStrings(matchHints ?? [])
    if (hints.length !== 1) {
      return undefined
    }

    const onlyHint = hints[0]
    if (!onlyHint) {
      return undefined
    }

    return (
      normalizeExtractedTopicSummary(onlyHint, true) ||
      (synthesizeCanonicalPromptFromSummary(onlyHint) === onlyHint ? onlyHint : undefined)
    )
  }

  function hasMultipleStableMatchHints(matchHints: string[] | undefined) {
    return dedupeNonEmptyStrings(matchHints ?? []).length > 1
  }

  function inferSummaryFromStableSummaryKey(summaryKey: string | undefined) {
    const humanized = humanizeSummaryKey(summaryKey)
    if (!humanized) {
      return undefined
    }

    return normalizeExtractedTopicSummary(humanized, true)
  }

  function inferSummaryFromDecisionKey(decisionKey: string | undefined) {
    const humanized = humanizeDecisionKey(decisionKey)
    if (!humanized) {
      return undefined
    }

    return normalizeExtractedTopicSummary(humanized, true)
  }

  function inferSummaryFromStableAnswerSourceKey(key: string | undefined) {
    const trimmed = key?.trim()
    if (!trimmed) {
      return undefined
    }

    const humanizedWithSuffix = trimmed.replace(/[_-]+/g, ' ')
    const humanized = humanizeAnswerSourceKey(trimmed)
    if (!humanized || humanized === humanizedWithSuffix) {
      return undefined
    }

    return normalizeExtractedTopicSummary(humanized, true)
  }

  function inferSummaryKeyFromStableAnswerSourceKey(key: string | undefined) {
    const trimmed = key?.trim()
    if (!trimmed) {
      return undefined
    }

    const stripped = trimmed.replace(/(?:[_-]+(?:answer|source))$/i, '')
    if (!stripped || stripped === trimmed) {
      return undefined
    }

    const normalized = stripped
      .trim()
      .replace(/[_\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()

    return normalized || undefined
  }

  function shouldDeriveSummaryKeyFromAnswerSourceKey(entry: ResolvedAnswerSourceEntry) {
    if (entry.summary?.trim()) {
      return false
    }
    if (inferSummaryFromStablePrompt(entry.prompt)) {
      return false
    }
    if (entry.summaryKey?.trim()) {
      return false
    }
    if (inferSummaryFromStableMatchHints(entry.matchHints)) {
      return false
    }
    return !hasMultipleStableMatchHints(entry.matchHints)
  }

  function extractPrefixedTopicSummary(text: string) {
    const trimmed = stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return undefined
    }

    const normalized = normalizeSourceResponseLabel(trimmed)
    if (normalized) {
      const tokens = normalized.split(' ').filter(Boolean)
      if (dependencies.startsWithMultiTokenSubordinateClauseSequence(tokens)) {
        return undefined
      }
    }

    const summary = new RegExp(
      `^(?:${dependencies.topicSummaryPrefixPattern})\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*(?:,|:|-|，|：|－)\\s+.+$`,
      'i',
    ).exec(trimmed)?.groups?.summary
    if (!summary) {
      return undefined
    }

    return normalizeExtractedTopicSummary(summary, true)
  }

  function extractAsTopicSummary(text: string) {
    const trimmed = text.trim()
    if (!trimmed || dependencies.startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
      return undefined
    }

    const summary = new RegExp(
      `\\bas\\s+(?:the|a|an)\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[.?!。？！]?$`,
      'i',
    ).exec(trimmed)?.groups?.summary
    if (!summary) {
      return undefined
    }

    return normalizeExtractedTopicSummary(summary)
  }

  function extractCopularTopicSummary(text: string) {
    const trimmed = stripLeadingTopicPromptConjunction(text)
    if (!trimmed || dependencies.startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
      return undefined
    }

    const summary = new RegExp(
      `^(?:.+?)\\s+(?:should\\s+be|will\\s+be|must\\s+be|can\\s+be|could\\s+be|would\\s+be|is|are|was|were|serves?\\s+as|served\\s+as|acts?\\s+as|acted\\s+as|functions?\\s+as|functioned\\s+as|remain|remains|remained)\\s+(?:the|a|an|our|your|their)\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[.?!。？！]?$`,
      'i',
    ).exec(trimmed)?.groups?.summary
    if (!summary) {
      return undefined
    }

    return normalizeExtractedTopicSummary(summary)
  }

  function extractLeadingTopicSummary(text: string) {
    const trimmed = stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return undefined
    }

    const label = matchLeadingTopicAuthority(trimmed)?.label
    if (!label) {
      return undefined
    }

    return normalizeExtractedTopicSummary(label, true)
  }

  function matchLeadingTopicAuthority(text: string) {
    return new RegExp(
      `^(?<label>.+?)\\s+(?<answer>${dependencies.topicSummaryVerbPattern}\\b.+)$`,
      'i',
    ).exec(text)?.groups
  }

  function topicPredicateIncludesSubstantiveAnswerContent(answer: string) {
    const stripped = answer
      .trim()
      .replace(new RegExp(`^(?:${dependencies.topicSummaryVerbPattern})\\b\\s*`, 'i'), '')
      .replace(
        /^(?:(?:be|been|being|use|uses|means|requires|starts|with|as|the|a|an|our|your|their)\b\s*)+/i,
        '',
      )
      .replace(/^[\p{P}\p{S}\s]+/gu, '')
      .trim()

    return /[\p{L}\p{N}]/u.test(stripped)
  }

  function textHasIncompleteLeadingTopicAuthority(text: string) {
    const trimmed = stripLeadingTopicPromptConjunction(text)
    if (!trimmed) {
      return false
    }

    const answer = matchLeadingTopicAuthority(trimmed)?.answer
    return answer !== undefined && !topicPredicateIncludesSubstantiveAnswerContent(answer)
  }

  function assertTopicTextHasSubstantiveLeadingAnswerContent(text: string, unitLabel: string) {
    if (!textHasIncompleteLeadingTopicAuthority(text)) {
      return
    }

    throw new AnswerInterpretationError(
      `${unitLabel.slice(0, 1).toUpperCase()}${unitLabel.slice(1)} "${text}" in sourceResponse did not include answer text after the topic anchor.`,
    )
  }

  function stripLeadingTopicPromptConjunction(text: string) {
    return dependencies.stripLeadingPresentationListMarkers(text.trim().replace(/^(?:and|but)\s+/i, ''))
  }

  function extractInferredTopicSummaries(text: string) {
    const prefixed = extractPrefixedTopicSummary(text)
    const asTopic = extractAsTopicSummary(text)
    const copular = extractCopularTopicSummary(text)
    const leading = copular ? undefined : extractLeadingTopicSummary(text)
    const trailing = extractTrailingTopicSummary(text)

    return dedupeNonEmptyStrings([prefixed, asTopic, copular, leading, trailing])
  }

  return {
    assertTopicTextHasSubstantiveLeadingAnswerContent,
    extractAsTopicSummary,
    extractCopularTopicSummary,
    extractInferredTopicSummaries,
    extractLeadingTopicSummary,
    extractPrefixedTopicSummary,
    extractTopicAnchorCandidateSummariesFromParagraphText,
    extractTopicAnchorCandidateSummariesFromText,
    extractTrailingTopicSummary,
    hasMultipleStableMatchHints,
    inferComparableExplicitLabelSummary,
    inferComparableQuestionTopicSummary,
    inferNormalizedTopicAnchorLabelsFromText,
    inferSummaryFromDecisionKey,
    inferSummaryFromQuestionLabel,
    inferSummaryFromStableAnswerSourceKey,
    inferSummaryFromStableMatchHints,
    inferSummaryFromStablePrompt,
    inferSummaryFromStableSummaryKey,
    inferSummaryKeyFromStableAnswerSourceKey,
    inferTopicBlockAnchorLabelsFromParagraph,
    inferTopicClosingBlockLabelsFromParagraph,
    inferTopicClosingSpanLabelsFromSentence,
    inferTopicSpanAnchorLabelsFromSentence,
    inferTopicSummaryFromTopicBlock,
    inferTopicSummaryFromTopicClosingBlock,
    inferTopicSummaryFromTopicClosingSpan,
    inferTopicSummaryFromTopicParagraph,
    inferTopicSummaryFromTopicSentence,
    inferTopicSummaryFromTopicSpan,
    matchLeadingTopicAuthority,
    normalizeExtractedTopicSummary,
    paragraphTextImpliesMultipleTopicSummaries,
    shouldDeriveSummaryKeyFromAnswerSourceKey,
    stripLeadingTopicPromptConjunction,
    stripQuestionBlockLabel,
    textHasIncompleteLeadingTopicAuthority,
    topicPredicateIncludesSubstantiveAnswerContent,
  }
}
