import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import { createAnswerInterpretationEmbeddedAnchorSupport } from './answerInterpretationEmbeddedAnchorSupport'
import { createAnswerInterpretationEmbeddedTopicCandidateSupport } from './answerInterpretationEmbeddedTopicCandidateSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import { createAnswerInterpretationQuestionDetectionSupport } from './answerInterpretationQuestionDetectionSupport'
import {
  QUESTION_CORE_LEADING_TOKENS,
  createAnswerInterpretationQuestionMatchingSupport,
} from './answerInterpretationQuestionMatchingSupport'
import { createAnswerInterpretationQuestionSourceSupport } from './answerInterpretationQuestionSourceSupport'
import { createAnswerInterpretationSourceResponseMatchingSupport } from './answerInterpretationSourceResponseMatchingSupport'
import { createAnswerInterpretationTopicSummarySupport } from './answerInterpretationTopicSummarySupport'
import type {
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
} from './answerInterpretationTypes'

interface QuestionRuntimeSupportDependencies {
  getExtractExplicitTopicSummariesFromQuestionAnswerText: (answer: string) => string[]
  getExtractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText: (
    answer: string,
  ) => string[]
  getExtractIncompleteLeadingTopicAuthoritySummary: (text: string) => string | undefined
  getSubordinateClauseLeadingWords: () => Iterable<string>
  isStandalonePresentationListMarker: (text: string) => boolean
  matchLeadingSubordinateClauseSequenceLength: (tokens: string[]) => number | undefined
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  parseTopicSourceResponseClauses: (sourceResponse: string) => TopicSourceResponseSentence[]
  parseTopicSourceResponseParagraphs: (sourceResponse: string) => TopicSourceResponseParagraph[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => TopicSourceResponseSentence[]
  startsWithMultiTokenSubordinateClauseSequence: (tokens: string[]) => boolean
  stripLeadingPresentationListMarkers: (text: string) => string
  stripStandalonePresentationListMarkerTokens: (text: string) => string
  stripTrailingPresentationListMarkers: (text: string) => string
  topicSummaryPrefixPattern: string
  topicSummaryVerbPattern: string
}

export function createAnswerInterpretationQuestionRuntimeSupport(
  dependencies: QuestionRuntimeSupportDependencies,
) {
  const {
    normalizeExplicitQuestionSurfaceText,
    normalizeQuestionPromptCore,
    questionTextMatchesCandidate,
    resolveSingleTopicAnchorLabel,
    stripLeadingQuestionPromptConjunction,
    topicTextMatchesCandidate,
  } = createAnswerInterpretationQuestionMatchingSupport({
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
  })

  const {
    findMatchingNormalizedTopicLabels,
    findMatchingQuestionBlockIndexes,
    findMatchingQuestionClosingBlockIndexes,
    findMatchingQuestionClosingSpanIndexes,
    findMatchingQuestionSpanIndexes,
    findMatchingTopicBlockIndexes,
    findMatchingTopicClauseIndexes,
    findMatchingTopicClosingBlockIndexes,
    findMatchingTopicClosingSpanIndexes,
    findMatchingTopicParagraphIndexes,
    findMatchingTopicSentenceIndexes,
    findMatchingTopicSpanIndexes,
    findMatchingTopicTextUnitIndexes,
    registerMatchingRunCandidateGroups,
    registerQuestionAnchorCandidateGroups,
    registerTopicAnchorCandidates,
  } = createAnswerInterpretationSourceResponseMatchingSupport({
    normalizeQuestionPromptCore,
    questionTextMatchesCandidate,
    topicTextMatchesCandidate,
  })

  let questionDetectionSupport:
    | ReturnType<typeof createAnswerInterpretationQuestionDetectionSupport>
    | undefined

  function startsWithNonPunctuatedWhClauseDeclarative(text: string) {
    return questionDetectionSupport?.startsWithNonPunctuatedWhClauseDeclarative(text) ?? false
  }

  function stripCanonicalQuestionAnchorLabel(question: string) {
    return stripLeadingQuestionPromptConjunction(question).replace(/[?？.!。！]+$/u, '').trim()
  }

  function inferCanonicalQuestionAnchorSummary(question: string) {
    const trimmed = stripCanonicalQuestionAnchorLabel(question)
    if (!trimmed) {
      return undefined
    }

    const subject = /^what should\s+(?<subject>.+?)\s+be$/i.exec(trimmed)?.groups?.subject
    if (!subject) {
      return undefined
    }

    return normalizeExtractedTopicSummary(subject, true)
  }

  function normalizeEmbeddedQuestionAnchorText(question: string) {
    const summary = inferCanonicalQuestionAnchorSummary(question)
    return synthesizeCanonicalPromptFromSummary(summary ?? '') ?? question.trim()
  }

  const {
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
  } = createAnswerInterpretationTopicSummarySupport({
    getQuestionCoreLeadingTokens: () => QUESTION_CORE_LEADING_TOKENS,
    getSubordinateClauseLeadingWords: dependencies.getSubordinateClauseLeadingWords,
    inferCanonicalQuestionAnchorSummary,
    matchLeadingSubordinateClauseSequenceLength:
      dependencies.matchLeadingSubordinateClauseSequenceLength,
    parsePendingSourceResponseConjunctions: dependencies.parsePendingSourceResponseConjunctions,
    parseTopicSourceResponseClauses: dependencies.parseTopicSourceResponseClauses,
    startsWithMultiTokenSubordinateClauseSequence:
      dependencies.startsWithMultiTokenSubordinateClauseSequence,
    startsWithNonPunctuatedWhClauseDeclarative,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
    stripLeadingQuestionPromptConjunction,
    topicSummaryPrefixPattern: dependencies.topicSummaryPrefixPattern,
    topicSummaryVerbPattern: dependencies.topicSummaryVerbPattern,
  })

  const {
    normalizeEmbeddedMatchingRunText,
    resolveCanonicalQuestionAnchorMatch,
    resolveEmbeddedMatchingRunAnchors,
    resolveEmbeddedQuestionAnchorsWithInferredCandidates,
    resolveEmbeddedTopicAnchors,
    tokenizeEmbeddedMatchingRunSourceResponse,
  } = createAnswerInterpretationEmbeddedAnchorSupport({
    normalizeEmbeddedQuestionAnchorText,
    normalizeQuestionPromptCore,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
    stripStandalonePresentationListMarkerTokens:
      dependencies.stripStandalonePresentationListMarkerTokens,
    stripTrailingPresentationListMarkers: dependencies.stripTrailingPresentationListMarkers,
  })

  questionDetectionSupport = createAnswerInterpretationQuestionDetectionSupport({
    inferCanonicalQuestionAnchorSummary,
    normalizeEmbeddedQuestionAnchorText,
    normalizeExplicitQuestionSurfaceText,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    resolveCanonicalQuestionAnchorMatch,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
    stripLeadingQuestionPromptConjunction,
    tokenizeEmbeddedMatchingRunSourceResponse,
  })

  const {
    extractLeadingTextBeforeCanonicalQuestionAuthority,
    extractQuestionAuthorityTextsFromText,
    hasNonPunctuatedWhCommaContinuation,
    inferNonPunctuatedInterrogativeQuestionAuthority,
    isQuestionSourceResponseText,
    normalizeQuestionSourceResponsePrompt,
  } = questionDetectionSupport

  function formatQuotedValueList(values: string[]) {
    return values.map((value) => `"${value}"`).join(', ')
  }

  function assertQuestionAnswerTopicAuthorityMatchesQuestion(
    question: string,
    answer: string,
    unitLabel: string,
  ) {
    const leadingTextBeforeCanonicalAuthority =
      extractLeadingTextBeforeCanonicalQuestionAuthority(question)
    if (leadingTextBeforeCanonicalAuthority) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${question}" in sourceResponse included leading text "${leadingTextBeforeCanonicalAuthority}" before canonical question authority.`,
      )
    }

    const incompleteQuestionSummary = dependencies.getExtractIncompleteLeadingTopicAuthoritySummary(
      stripQuestionBlockLabel(question),
    )
    if (incompleteQuestionSummary) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${question}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList([incompleteQuestionSummary])} inside question text.`,
      )
    }

    const expectedSummary = inferComparableQuestionTopicSummary(question)
    if (!expectedSummary) {
      return
    }

    const answerTopicSummaries =
      dependencies.getExtractExplicitTopicSummariesFromQuestionAnswerText(answer)
    if (answerTopicSummaries.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${question}" in sourceResponse included answer text with explicit topic authority for ${formatQuotedValueList(answerTopicSummaries)}.`,
      )
    }

    const incompleteSummaries =
      dependencies.getExtractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(answer)
    if (incompleteSummaries.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `${unitLabel} "${question}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList(incompleteSummaries)} inside answer text.`,
    )
  }

  const { inferEmbeddedClosingTopicCandidateLabels, inferEmbeddedLeadingTopicCandidateLabels } =
    createAnswerInterpretationEmbeddedTopicCandidateSupport({
      extractLeadingTopicSummary,
      extractTrailingTopicSummary,
      startsWithNonPunctuatedWhClauseDeclarative,
    })

  const {
    parseQuestionSourceResponseBlocks,
    parseQuestionSourceResponseClauses,
    parseQuestionSourceResponseClosingBlocks,
    parseQuestionSourceResponseClosingSpans,
    parseQuestionSourceResponseMiddleBlocks,
    parseQuestionSourceResponseMiddleSpans,
    parseQuestionSourceResponseSpans,
    parseRequiredQuestionSourceResponseBlocks,
    parseRequiredQuestionSourceResponseClauses,
    parseRequiredQuestionSourceResponseClosingBlocks,
    parseRequiredQuestionSourceResponseClosingSpans,
    parseRequiredQuestionSourceResponseMiddleBlocks,
    parseRequiredQuestionSourceResponseMiddleSpans,
    parseRequiredQuestionSourceResponseSpans,
  } = createAnswerInterpretationQuestionSourceSupport({
    assertQuestionAnswerTopicAuthorityMatchesQuestion,
    inferCanonicalQuestionAnchorSummary,
    inferNonPunctuatedInterrogativeQuestionAuthority,
    isStandalonePresentationListMarker: dependencies.isStandalonePresentationListMarker,
    normalizeEmbeddedMatchingRunText,
    normalizeEmbeddedQuestionAnchorText,
    normalizeExplicitQuestionSurfaceText,
    normalizeExplicitTopicOrQuestionUnitText: dependencies.normalizeExplicitTopicOrQuestionUnitText,
    normalizeQuestionPromptCore,
    parseTopicSourceResponseParagraphs: dependencies.parseTopicSourceResponseParagraphs,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    resolveCanonicalQuestionAnchorMatch,
    resolveEmbeddedQuestionAnchorsWithInferredCandidates,
    stripLeadingQuestionPromptConjunction,
    tokenizeEmbeddedMatchingRunSourceResponse,
  })

  return {
    assertQuestionAnswerTopicAuthorityMatchesQuestion,
    assertTopicTextHasSubstantiveLeadingAnswerContent,
    extractAsTopicSummary,
    extractCopularTopicSummary,
    extractInferredTopicSummaries,
    extractLeadingTextBeforeCanonicalQuestionAuthority,
    extractLeadingTopicSummary,
    extractPrefixedTopicSummary,
    extractQuestionAuthorityTextsFromText,
    extractTopicAnchorCandidateSummariesFromParagraphText,
    extractTopicAnchorCandidateSummariesFromText,
    extractTrailingTopicSummary,
    findMatchingNormalizedTopicLabels,
    findMatchingQuestionBlockIndexes,
    findMatchingQuestionClosingBlockIndexes,
    findMatchingQuestionClosingSpanIndexes,
    findMatchingQuestionSpanIndexes,
    findMatchingTopicBlockIndexes,
    findMatchingTopicClauseIndexes,
    findMatchingTopicClosingBlockIndexes,
    findMatchingTopicClosingSpanIndexes,
    findMatchingTopicParagraphIndexes,
    findMatchingTopicSentenceIndexes,
    findMatchingTopicSpanIndexes,
    findMatchingTopicTextUnitIndexes,
    formatQuotedValueList,
    hasMultipleStableMatchHints,
    hasNonPunctuatedWhCommaContinuation,
    inferCanonicalQuestionAnchorSummary,
    inferComparableExplicitLabelSummary,
    inferComparableQuestionTopicSummary,
    inferEmbeddedClosingTopicCandidateLabels,
    inferEmbeddedLeadingTopicCandidateLabels,
    inferNonPunctuatedInterrogativeQuestionAuthority,
    inferNormalizedTopicAnchorLabelsFromText,
    inferQuestionSummaryFromDecisionKey: inferSummaryFromDecisionKey,
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
    isQuestionSourceResponseText,
    matchLeadingTopicAuthority,
    normalizeEmbeddedMatchingRunText,
    normalizeEmbeddedQuestionAnchorText,
    normalizeExplicitQuestionSurfaceText,
    normalizeExtractedTopicSummary,
    normalizeQuestionPromptCore,
    normalizeQuestionSourceResponsePrompt,
    paragraphTextImpliesMultipleTopicSummaries,
    parseQuestionSourceResponseBlocks,
    parseQuestionSourceResponseClauses,
    parseQuestionSourceResponseClosingBlocks,
    parseQuestionSourceResponseClosingSpans,
    parseQuestionSourceResponseMiddleBlocks,
    parseQuestionSourceResponseMiddleSpans,
    parseQuestionSourceResponseSpans,
    parseRequiredQuestionSourceResponseBlocks,
    parseRequiredQuestionSourceResponseClauses,
    parseRequiredQuestionSourceResponseClosingBlocks,
    parseRequiredQuestionSourceResponseClosingSpans,
    parseRequiredQuestionSourceResponseMiddleBlocks,
    parseRequiredQuestionSourceResponseMiddleSpans,
    parseRequiredQuestionSourceResponseSpans,
    questionTextMatchesCandidate,
    registerMatchingRunCandidateGroups,
    registerQuestionAnchorCandidateGroups,
    registerTopicAnchorCandidates,
    resolveCanonicalQuestionAnchorMatch,
    resolveEmbeddedMatchingRunAnchors,
    resolveEmbeddedQuestionAnchorsWithInferredCandidates,
    resolveEmbeddedTopicAnchors,
    resolveSingleTopicAnchorLabel,
    shouldDeriveSummaryKeyFromAnswerSourceKey,
    startsWithNonPunctuatedWhClauseDeclarative,
    stripCanonicalQuestionAnchorLabel,
    stripLeadingQuestionPromptConjunction,
    stripLeadingTopicPromptConjunction,
    stripQuestionBlockLabel,
    textHasIncompleteLeadingTopicAuthority,
    tokenizeEmbeddedMatchingRunSourceResponse,
    topicPredicateIncludesSubstantiveAnswerContent,
    topicTextMatchesCandidate,
  }
}
