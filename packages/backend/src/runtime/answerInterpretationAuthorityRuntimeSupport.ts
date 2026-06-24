import { createAnswerInterpretationAuthoritySupport } from './answerInterpretationAuthoritySupport'
import { createAnswerInterpretationLabeledInlineSourceSupport } from './answerInterpretationLabeledInlineSourceSupport'
import { createAnswerInterpretationQuestionAuthoritySupport } from './answerInterpretationQuestionAuthoritySupport'
import { createAnswerInterpretationTopicAuthorityExtractionSupport } from './answerInterpretationTopicAuthorityExtractionSupport'
import { SUBORDINATE_CLAUSE_LEADING_WORDS } from './answerInterpretationSubordinateClauseLexicon'
import type {
  CanonicalQuestionAnchorMatch,
  EmbeddedMatchingRunToken,
  TopicSourceResponseSentence,
} from './answerInterpretationTypes'

interface AuthorityRuntimeSupportDependencies {
  assertQuestionAnswerTopicAuthorityMatchesQuestion: (
    question: string,
    answer: string,
    unitLabel: string,
  ) => void
  dedupeNonEmptyStrings: (values: string[]) => string[]
  extractAsTopicSummary: (text: string) => string | undefined
  extractCopularTopicSummary: (text: string) => string | undefined
  extractInferredTopicSummaries: (text: string) => string[]
  extractLeadingTopicSummary: (text: string) => string | undefined
  extractPrefixedTopicSummary: (text: string) => string | undefined
  extractQuestionAuthorityTextsFromText: (text: string) => string[]
  extractTopicAnchorCandidateSummariesFromText: (text: string) => string[]
  extractTrailingTopicSummary: (text: string) => string | undefined
  formatQuotedValueList: (values: string[]) => string
  hasNonPunctuatedWhCommaContinuation: (text: string) => boolean
  inferComparableExplicitLabelSummary: (label: string) => string | undefined
  inlineTopicClauseUsesExplicitLabelValueSeparator?: (trimmedClause: string) => boolean
  isQuestionSourceResponseText: (text: string) => boolean
  matchLeadingSubordinateClauseSequenceLength: (tokens: string[]) => number | undefined
  matchLeadingTopicAuthority: (text: string) => { label?: string; answer?: string } | undefined
  normalizeExtractedTopicSummary: (
    summary: string,
    stripLeadingArticle?: boolean,
  ) => string | undefined
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  normalizeQuestionPromptCore: (value: string) => string
  normalizeQuestionSourceResponsePrompt: (question: string) => string
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  parseTopicSourceResponseClauses: (sourceResponse: string) => TopicSourceResponseSentence[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => TopicSourceResponseSentence[]
  resolveCanonicalQuestionAnchorMatch: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    startTokenIndex: number,
  ) => CanonicalQuestionAnchorMatch | undefined
  splitInlineTopicClauses?: (sourceResponse: string) => string[]
  startsWithMultiTokenSubordinateClauseSequence: (tokens: string[]) => boolean
  startsWithNonPunctuatedWhClauseDeclarative: (text: string) => boolean
  stripLeadingPresentationListMarkers: (text: string) => string
  stripLeadingQuestionPromptConjunction: (question: string) => string
  stripLeadingTopicPromptConjunction: (text: string) => string
  textHasIncompleteLeadingTopicAuthority: (text: string) => boolean
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
  topicPredicateIncludesSubstantiveAnswerContent: (answer: string) => boolean
  topicSummaryVerbPattern: string
  topicTextMatchesCandidate: (
    normalizedTopicText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) => boolean
}

export function createAnswerInterpretationAuthorityRuntimeSupport(
  dependencies: AuthorityRuntimeSupportDependencies,
) {
  const {
    assertExplicitLabelTextDoesNotContainAuthority,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator,
    parseInlineTopicClause,
    parseRequiredInlineTopicSections,
    parseRequiredLabeledSourceResponseSections,
    splitInlineTopicClauses,
  } = createAnswerInterpretationLabeledInlineSourceSupport({
    extractInferredTopicSummaries: dependencies.extractInferredTopicSummaries,
    extractPrefixedTopicSummary: dependencies.extractPrefixedTopicSummary,
    extractQuestionAuthorityTextsFromText: dependencies.extractQuestionAuthorityTextsFromText,
    formatQuotedValueList: dependencies.formatQuotedValueList,
    inferComparableExplicitLabelSummary: dependencies.inferComparableExplicitLabelSummary,
    isQuestionSourceResponseSentence: dependencies.isQuestionSourceResponseText,
    normalizeExtractedTopicSummary: dependencies.normalizeExtractedTopicSummary,
    normalizeExplicitTopicOrQuestionUnitText:
      dependencies.normalizeExplicitTopicOrQuestionUnitText,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    resolveCanonicalQuestionAnchorMatch: dependencies.resolveCanonicalQuestionAnchorMatch,
    startsWithNonPunctuatedWhClauseDeclarative:
      dependencies.startsWithNonPunctuatedWhClauseDeclarative,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
    tokenizeEmbeddedMatchingRunSourceResponse:
      dependencies.tokenizeEmbeddedMatchingRunSourceResponse,
    topicPredicateIncludesSubstantiveAnswerContent:
      dependencies.topicPredicateIncludesSubstantiveAnswerContent,
    topicSummaryVerbPattern: dependencies.topicSummaryVerbPattern,
  })

  const {
    extractExplicitTopicSummariesFromDirectAnswerText,
    extractExplicitTopicSummariesFromQuestionAnswerSentence,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummary,
    extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractNestedLeadingTopicAuthoritySummary,
  } = createAnswerInterpretationTopicAuthorityExtractionSupport({
    extractAsTopicSummary: dependencies.extractAsTopicSummary,
    extractCopularTopicSummary: dependencies.extractCopularTopicSummary,
    extractPrefixedTopicSummary: dependencies.extractPrefixedTopicSummary,
    extractTrailingTopicSummary: dependencies.extractTrailingTopicSummary,
    getSubordinateClauseLeadingWords: () => SUBORDINATE_CLAUSE_LEADING_WORDS,
    matchLeadingTopicAuthority: dependencies.matchLeadingTopicAuthority,
    normalizeExtractedTopicSummary: dependencies.normalizeExtractedTopicSummary,
    parseInlineTopicClause,
    parsePendingSourceResponseConjunctions: dependencies.parsePendingSourceResponseConjunctions,
    parseTopicSourceResponseClauses: dependencies.parseTopicSourceResponseClauses,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    startsWithMultiTokenSubordinateClauseSequence:
      dependencies.startsWithMultiTokenSubordinateClauseSequence,
    stripLeadingTopicPromptConjunction: dependencies.stripLeadingTopicPromptConjunction,
    topicPredicateIncludesSubstantiveAnswerContent:
      dependencies.topicPredicateIncludesSubstantiveAnswerContent,
    topicSummaryVerbPattern: dependencies.topicSummaryVerbPattern,
  })

  const {
    assertLabeledValueAuthorityMatchesLabel,
    assertMatchedAnswerTextAuthorityMatchesConsumer,
    assertTopicAnswerTextDoesNotContainQuestionAuthority,
    autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics,
    autoInlineTopicsShouldYieldToExplicitTopicAuthority,
    extractSubordinateClauseFragmentAuthoritiesFromText,
  } = createAnswerInterpretationQuestionAuthoritySupport({
    extractExplicitTopicSummariesFromDirectAnswerText,
    extractExplicitTopicSummariesFromQuestionAnswerSentence,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText,
    extractInferredTopicSummaries: dependencies.extractInferredTopicSummaries,
    extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractQuestionAuthorityTextsFromText: dependencies.extractQuestionAuthorityTextsFromText,
    formatQuotedValueList: dependencies.formatQuotedValueList,
    hasNonPunctuatedWhCommaContinuation: dependencies.hasNonPunctuatedWhCommaContinuation,
    inferComparableExplicitLabelSummary: dependencies.inferComparableExplicitLabelSummary,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    matchLeadingSubordinateClauseSequenceLength:
      dependencies.matchLeadingSubordinateClauseSequenceLength,
    normalizeExplicitTopicOrQuestionUnitText:
      dependencies.normalizeExplicitTopicOrQuestionUnitText,
    normalizeQuestionPromptCore: dependencies.normalizeQuestionPromptCore,
    parseInlineTopicClause,
    parseTopicSourceResponseClauses: dependencies.parseTopicSourceResponseClauses,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    splitInlineTopicClauses,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
    stripLeadingQuestionPromptConjunction: dependencies.stripLeadingQuestionPromptConjunction,
    textHasIncompleteLeadingTopicAuthority: dependencies.textHasIncompleteLeadingTopicAuthority,
    tokenizeEmbeddedMatchingRunSourceResponse:
      dependencies.tokenizeEmbeddedMatchingRunSourceResponse,
    topicTextMatchesCandidate: dependencies.topicTextMatchesCandidate,
  })

  const {
    assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority,
    assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority,
    assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority,
    assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority,
    assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority,
    assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority,
    assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority,
    assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority,
    autoQuestionSurfaceEstablishedExplicitAuthority,
    autoTopicSurfaceEstablishedExplicitAuthority,
    collectSemanticallyValidInlineTopicClauseIndexes,
    groupRemainingNonInlineTopicClauseChunks,
    sourceResponseHasQuestionSentenceAuthority,
  } = createAnswerInterpretationAuthoritySupport({
    assertExplicitLabelTextDoesNotContainAuthority,
    assertLabeledValueAuthorityMatchesLabel,
    assertQuestionAnswerTopicAuthorityMatchesQuestion:
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion,
    dedupeNonEmptyStrings: dependencies.dedupeNonEmptyStrings,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractQuestionAuthorityTextsFromText: dependencies.extractQuestionAuthorityTextsFromText,
    extractTopicAnchorCandidateSummariesFromText:
      dependencies.extractTopicAnchorCandidateSummariesFromText,
    formatQuotedValueList: dependencies.formatQuotedValueList,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    isQuestionSourceResponseSentence: dependencies.isQuestionSourceResponseText,
    normalizeQuestionSourceResponsePrompt: dependencies.normalizeQuestionSourceResponsePrompt,
    parseInlineTopicClause,
    parseTopicSourceResponseSentences: dependencies.parseTopicSourceResponseSentences,
    splitInlineTopicClauses,
    stripLeadingPresentationListMarkers: dependencies.stripLeadingPresentationListMarkers,
  })

  return {
    assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority,
    assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority,
    assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority,
    assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority,
    assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority,
    assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority,
    assertExplicitLabelTextDoesNotContainAuthority,
    assertLabeledValueAuthorityMatchesLabel,
    assertMatchedAnswerTextAuthorityMatchesConsumer,
    assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority,
    assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority,
    assertTopicAnswerTextDoesNotContainQuestionAuthority,
    autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics,
    autoInlineTopicsShouldYieldToExplicitTopicAuthority,
    autoQuestionSurfaceEstablishedExplicitAuthority,
    autoTopicSurfaceEstablishedExplicitAuthority,
    collectSemanticallyValidInlineTopicClauseIndexes,
    extractExplicitTopicSummariesFromDirectAnswerText,
    extractExplicitTopicSummariesFromQuestionAnswerSentence,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText,
    extractIncompleteLeadingTopicAuthoritySummary,
    extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText,
    extractNestedLeadingTopicAuthoritySummary,
    extractSubordinateClauseFragmentAuthoritiesFromText,
    groupRemainingNonInlineTopicClauseChunks,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator,
    parseInlineTopicClause,
    parseRequiredInlineTopicSections,
    parseRequiredLabeledSourceResponseSections,
    sourceResponseHasQuestionSentenceAuthority,
    splitInlineTopicClauses,
  }
}
