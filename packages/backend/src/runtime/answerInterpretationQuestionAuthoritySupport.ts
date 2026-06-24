import {
  dedupeNonEmptyStrings,
  normalizeSourceResponseLabel,
  normalizeSourceResponseText,
} from './answerInterpretationStrings'
import { findNonPunctuatedWhExistentialPredicateIndex } from './answerInterpretationNonPunctuatedExistentialSupport'
import {
  findNonPunctuatedWhClauseExistentialStarterIndex,
  findNonPunctuatedWhEmbeddedClausePredicateIndex,
  findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex,
  findNonPunctuatedWhOuterClausePredicateIndex,
  hasBareExistentialPluralComplementTail,
  resolveNonPunctuatedWhOuterPredicateSearchStart,
} from './answerInterpretationNonPunctuatedQuestionCoreSupport'
import type {
  EmbeddedMatchingRunToken,
  InterpretedSourceResponseState,
} from './answerInterpretationTypes'
import { AnswerInterpretationError } from './answerInterpretationErrors'

type ParsedSentence = {
  text: string
}

type ParsedClause = {
  text: string
}

type ParsedInlineTopic = {
  label: string
  value: string
}

interface QuestionAuthoritySupportDependencies {
  extractExplicitTopicSummariesFromDirectAnswerText: (answer: string) => string[]
  extractExplicitTopicSummariesFromQuestionAnswerSentence: (answer: string) => string[]
  extractExplicitTopicSummariesFromQuestionAnswerText: (answer: string) => string[]
  extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText: (
    answer: string,
  ) => string[]
  extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText: (
    answer: string,
  ) => string[]
  extractInferredTopicSummaries: (text: string) => string[]
  extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText: (answer: string) => string[]
  extractQuestionAuthorityTextsFromText: (text: string) => string[]
  formatQuotedValueList: (values: string[]) => string
  hasNonPunctuatedWhCommaContinuation: (text: string) => boolean
  inferComparableExplicitLabelSummary: (label: string) => string | undefined
  inlineTopicClauseUsesExplicitLabelValueSeparator: (trimmedClause: string) => boolean
  matchLeadingSubordinateClauseSequenceLength: (tokens: string[]) => number | undefined
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  normalizeQuestionPromptCore: (value: string) => string
  parseInlineTopicClause: (clause: string) => ParsedInlineTopic | undefined
  parseTopicSourceResponseClauses: (sourceResponse: string) => ParsedClause[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => ParsedSentence[]
  splitInlineTopicClauses: (sourceResponse: string) => string[]
  stripLeadingPresentationListMarkers: (text: string) => string
  stripLeadingQuestionPromptConjunction: (question: string) => string
  textHasIncompleteLeadingTopicAuthority: (text: string) => boolean
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
  topicTextMatchesCandidate: (
    normalizedTopicText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) => boolean
}

export function createAnswerInterpretationQuestionAuthoritySupport(
  dependencies: QuestionAuthoritySupportDependencies,
) {
  function subordinateClauseHasLaterOuterPredicateOrContinuation(
    tokens: EmbeddedMatchingRunToken[],
    text: string,
    subordinateClauseStartIndex: number,
  ) {
    if (dependencies.hasNonPunctuatedWhCommaContinuation(text)) {
      return true
    }

    const subordinateSuffix = text
      .trim()
      .split(/\s+/u)
      .slice(subordinateClauseStartIndex)
      .join(' ')
      .trim()
    if (
      subordinateSuffix &&
      (dependencies.extractExplicitTopicSummariesFromQuestionAnswerSentence(subordinateSuffix)
        .length > 0 ||
        dependencies.extractQuestionAuthorityTextsFromText(subordinateSuffix).length > 0)
    ) {
      return true
    }

    const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(
      tokens,
      subordinateClauseStartIndex,
    )
    if (existentialStarterIndex !== undefined) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        existentialStarterIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        const outerPredicateIndex = findNonPunctuatedWhOuterClausePredicateIndex(
          tokens,
          resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
        )
        return (
          outerPredicateIndex !== undefined &&
          !hasBareExistentialPluralComplementTail(tokens, existentialPredicateIndex)
        )
      }
    }

    const embeddedSubjectPredicateIndex = findNonPunctuatedWhEmbeddedClausePredicateIndex(
      tokens,
      subordinateClauseStartIndex + 1,
    )
    if (
      embeddedSubjectPredicateIndex !== undefined &&
      findNonPunctuatedWhOuterClausePredicateIndex(
        tokens,
        resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, embeddedSubjectPredicateIndex),
      ) !== undefined
    ) {
      return true
    }

    const nounPhrasePredicateIndex =
      findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
        tokens,
        subordinateClauseStartIndex + 1,
      )
    if (
      nounPhrasePredicateIndex !== undefined &&
      findNonPunctuatedWhOuterClausePredicateIndex(
        tokens,
        resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, nounPhrasePredicateIndex),
      ) !== undefined
    ) {
      return true
    }

    return false
  }

  function inferSubordinateClauseFragmentAuthority(sentence: string) {
    const strippedSentence = dependencies.stripLeadingQuestionPromptConjunction(sentence).trim()
    if (!strippedSentence || /[?？]/u.test(strippedSentence)) {
      return undefined
    }

    const withoutTerminalPunctuation = strippedSentence.replace(/[.!。！]+$/u, '').trim()
    if (!withoutTerminalPunctuation) {
      return undefined
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
    const leadingTokenCount = dependencies.matchLeadingSubordinateClauseSequenceLength(
      tokens.map((token) => token.normalizedText),
    )
    if (!leadingTokenCount || tokens.length < leadingTokenCount + 2) {
      return undefined
    }

    if (
      subordinateClauseHasLaterOuterPredicateOrContinuation(
        tokens,
        withoutTerminalPunctuation,
        leadingTokenCount,
      )
    ) {
      return undefined
    }

    return dependencies.normalizeExplicitTopicOrQuestionUnitText(strippedSentence)
  }

  function extractSubordinateClauseFragmentAuthoritiesFromText(text: string) {
    const authorities: string[] = []

    for (const sentence of dependencies.parseTopicSourceResponseSentences(text)) {
      const fragmentAuthority = inferSubordinateClauseFragmentAuthority(sentence.text)
      if (fragmentAuthority) {
        authorities.push(fragmentAuthority)
      }
    }

    return dedupeNonEmptyStrings(authorities)
  }

  function assertMatchedAnswerTextAuthorityMatchesConsumer(
    answer: string,
    candidates: string[],
    unitLabel: string,
    authorityContainerLabel = 'sourceResponse',
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
    }))
    if (normalizedCandidates.length === 0) {
      return
    }

    const authorityMatchesCurrentCandidates = (authority: string) => {
      const normalizedAuthority = normalizeSourceResponseText(authority)
      const normalizedAuthorityCore = dependencies.normalizeQuestionPromptCore(authority)
      if (!normalizedAuthority && !normalizedAuthorityCore) {
        return false
      }

      return normalizedCandidates.some(({ normalizedCandidate, normalizedCandidateCore }) => {
        if (
          normalizedAuthority &&
          dependencies.topicTextMatchesCandidate(
            normalizedAuthority,
            normalizedCandidate,
            normalizedCandidateCore,
          )
        ) {
          return true
        }
        if (normalizedAuthority && normalizedCandidate.includes(normalizedAuthority)) {
          return true
        }
        if (normalizedAuthority && normalizedCandidateCore.includes(normalizedAuthority)) {
          return true
        }
        if (normalizedAuthorityCore && normalizedCandidateCore.includes(normalizedAuthorityCore)) {
          return true
        }
        return false
      })
    }

    const conflictingQuestionAuthorities = dependencies.extractQuestionAuthorityTextsFromText(answer)
    if (conflictingQuestionAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} in ${authorityContainerLabel} included answer text with question authority ${dependencies.formatQuotedValueList(conflictingQuestionAuthorities)}.`,
      )
    }

    const subordinateClauseAuthorities = extractSubordinateClauseFragmentAuthoritiesFromText(answer)
    if (subordinateClauseAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} in ${authorityContainerLabel} included answer text with subordinate-clause fragment authority ${dependencies.formatQuotedValueList(subordinateClauseAuthorities)}.`,
      )
    }

    const nestedCurrentTopicSummaries =
      dependencies.extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText(answer).filter(
        (summary) => authorityMatchesCurrentCandidates(summary),
      )
    if (nestedCurrentTopicSummaries.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} in ${authorityContainerLabel} included incomplete topic authority for ${dependencies.formatQuotedValueList(nestedCurrentTopicSummaries)} inside answer text.`,
      )
    }

    const conflictingTopicSummaries = dependencies
      .extractExplicitTopicSummariesFromDirectAnswerText(answer)
      .filter((summary) => !authorityMatchesCurrentCandidates(summary))
    if (conflictingTopicSummaries.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} in ${authorityContainerLabel} included answer text with explicit topic authority for ${dependencies.formatQuotedValueList(conflictingTopicSummaries)}.`,
      )
    }

    const incompleteSummaries =
      dependencies.extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText(answer)
    if (incompleteSummaries.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `${unitLabel} in ${authorityContainerLabel} included incomplete topic authority for ${dependencies.formatQuotedValueList(incompleteSummaries)} inside answer text.`,
    )
  }

  function assertLabeledValueAuthorityMatchesLabel(
    label: string,
    value: string,
    unitLabel: string,
    valueLabel: string,
  ) {
    const questionAuthorities = dependencies.extractQuestionAuthorityTextsFromText(value)
    if (questionAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${label}" in sourceResponse included question authority ${dependencies.formatQuotedValueList(questionAuthorities)} inside ${valueLabel}.`,
      )
    }

    const expectedSummary = dependencies.inferComparableExplicitLabelSummary(label)
    if (!expectedSummary) {
      return
    }

    const normalizedExpectedSummary = normalizeSourceResponseLabel(expectedSummary)
    const conflictingSummaries = dependencies
      .extractExplicitTopicSummariesFromQuestionAnswerText(value)
      .filter((summary) => normalizeSourceResponseLabel(summary) !== normalizedExpectedSummary)
    if (conflictingSummaries.length === 0) {
      const incompleteSummaries =
        dependencies.extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(value)
      if (incompleteSummaries.length === 0) {
        return
      }

      throw new AnswerInterpretationError(
        `${unitLabel} "${label}" in sourceResponse included incomplete topic authority for ${dependencies.formatQuotedValueList(incompleteSummaries)} inside ${valueLabel}.`,
      )
    }

    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included ${valueLabel} with explicit topic authority for ${dependencies.formatQuotedValueList(conflictingSummaries)}.`,
    )
  }

  function assertTopicAnswerTextDoesNotContainQuestionAuthority(text: string, unitLabel: string) {
    const authorities = dependencies.extractQuestionAuthorityTextsFromText(text)
    if (authorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${text}" in sourceResponse included question authority ${dependencies.formatQuotedValueList(authorities)} inside answer text.`,
      )
    }

    const subordinateClauseAuthorities = extractSubordinateClauseFragmentAuthoritiesFromText(text)
    if (subordinateClauseAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${text}" in sourceResponse included subordinate-clause fragment authority ${dependencies.formatQuotedValueList(subordinateClauseAuthorities)} inside answer text.`,
      )
    }
  }

  function inlineTopicClauseUsesExplicitTopicAuthority(trimmedClause: string) {
    if (!trimmedClause) {
      return false
    }

    if (/^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause)) {
      return false
    }

    if (/^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/u.test(trimmedClause)) {
      return false
    }

    return dedupeNonEmptyStrings(dependencies.extractInferredTopicSummaries(trimmedClause)).length === 1
  }

  function autoInlineTopicsShouldYieldToExplicitTopicAuthority(
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    const sourceResponse = sourceResponseState?.sourceResponse?.trim()
    if (!sourceResponse) {
      return false
    }

    let parsedClauseCount = 0
    for (const clause of dependencies.splitInlineTopicClauses(sourceResponse)) {
      const parsed = dependencies.parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      parsedClauseCount += 1
      const trimmedClause = dependencies.stripLeadingPresentationListMarkers(
        clause.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (!inlineTopicClauseUsesExplicitTopicAuthority(trimmedClause)) {
        return false
      }
    }

    return parsedClauseCount > 0
  }

  function autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    const sourceResponse = sourceResponseState?.sourceResponse?.trim()
    if (!sourceResponse) {
      return false
    }

    let parsedVerbalInlineClauseCount = 0
    for (const clause of dependencies.splitInlineTopicClauses(sourceResponse)) {
      const parsed = dependencies.parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      const trimmedClause = dependencies.stripLeadingPresentationListMarkers(
        clause.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (dependencies.inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
        return false
      }
      parsedVerbalInlineClauseCount += 1
    }

    if (parsedVerbalInlineClauseCount === 0) {
      return false
    }

    const clauses = dependencies.parseTopicSourceResponseClauses(sourceResponse)
    if (clauses.length <= 1) {
      return false
    }

    const clauseTopicAuthorityCount = clauses.filter(
      (clause) =>
        dependencies.extractInferredTopicSummaries(clause.text).length > 0 ||
        dependencies.textHasIncompleteLeadingTopicAuthority(clause.text),
    ).length

    return clauseTopicAuthorityCount > 1
  }

  return {
    assertLabeledValueAuthorityMatchesLabel,
    assertMatchedAnswerTextAuthorityMatchesConsumer,
    assertTopicAnswerTextDoesNotContainQuestionAuthority,
    autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics,
    autoInlineTopicsShouldYieldToExplicitTopicAuthority,
    extractSubordinateClauseFragmentAuthoritiesFromText,
  }
}
