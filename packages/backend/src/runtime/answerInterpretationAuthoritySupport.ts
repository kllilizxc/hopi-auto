import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
} from './answerInterpretationTypes'

type ConcreteInterpretableSourceResponseFormat = Exclude<InterpretableSourceResponseFormat, 'auto'>

interface AnswerInterpretationAuthoritySupportDependencies {
  assertExplicitLabelTextDoesNotContainAuthority: (label: string, unitLabel: string) => void
  assertLabeledValueAuthorityMatchesLabel: (
    label: string,
    value: string,
    unitLabel: string,
    valueLabel: string,
  ) => void
  assertQuestionAnswerTopicAuthorityMatchesQuestion: (
    question: string,
    answer: string,
    unitLabel: string,
  ) => void
  dedupeNonEmptyStrings: (values: string[]) => string[]
  extractExplicitTopicSummariesFromQuestionAnswerText: (answer: string) => string[]
  extractQuestionAuthorityTextsFromText: (text: string) => string[]
  extractTopicAnchorCandidateSummariesFromText: (text: string) => string[]
  formatQuotedValueList: (values: string[]) => string
  inlineTopicClauseUsesExplicitLabelValueSeparator: (trimmedClause: string) => boolean
  isQuestionSourceResponseSentence: (sentence: string) => boolean
  normalizeQuestionSourceResponsePrompt: (question: string) => string
  parseInlineTopicClause: (clause: string) => LabeledSourceResponseSection | undefined
  parseTopicSourceResponseSentences: (text: string) => Array<{ text: string }>
  splitInlineTopicClauses: (sourceResponse: string) => string[]
  stripLeadingPresentationListMarkers: (text: string) => string
}

export function createAnswerInterpretationAuthoritySupport(
  dependencies: AnswerInterpretationAuthoritySupportDependencies,
) {
  const {
    assertExplicitLabelTextDoesNotContainAuthority,
    assertLabeledValueAuthorityMatchesLabel,
    assertQuestionAnswerTopicAuthorityMatchesQuestion,
    dedupeNonEmptyStrings,
    extractExplicitTopicSummariesFromQuestionAnswerText,
    extractQuestionAuthorityTextsFromText,
    extractTopicAnchorCandidateSummariesFromText,
    formatQuotedValueList,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    isQuestionSourceResponseSentence,
    normalizeQuestionSourceResponsePrompt,
    parseInlineTopicClause,
    parseTopicSourceResponseSentences,
    splitInlineTopicClauses,
    stripLeadingPresentationListMarkers,
  } = dependencies

  function textHasSingleExplicitTopicAuthority(text: string) {
    return dedupeNonEmptyStrings(extractTopicAnchorCandidateSummariesFromText(text)).length === 1
  }

  function autoQuestionSurfaceEstablishedExplicitAuthority(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (!sourceResponseState) {
      return false
    }

    switch (sourceResponseFormat) {
      case 'question_blocks':
        return (sourceResponseState.questionBlocks?.length ?? 0) > 0
      case 'question_clauses':
        return (sourceResponseState.questionClauses?.length ?? 0) > 0
      case 'question_spans':
        return (sourceResponseState.questionSpans?.length ?? 0) > 0
      case 'question_middle_spans':
        return (sourceResponseState.questionMiddleSpans?.length ?? 0) > 0
      case 'question_closing_spans':
        return (sourceResponseState.questionClosingSpans?.length ?? 0) > 0
      case 'question_closing_blocks':
        return (sourceResponseState.questionClosingBlocks?.length ?? 0) > 0
      case 'question_middle_blocks':
        return (sourceResponseState.questionMiddleBlocks?.length ?? 0) > 0
      default:
        return false
    }
  }

  function sourceResponseHasQuestionSentenceAuthority(sourceResponse: string | undefined) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      return false
    }

    return extractQuestionAuthorityTextsFromText(shared).length > 0
  }

  function listStandaloneQuestionAuthoritiesOutsideLabeledSections(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    return dedupeNonEmptyStrings(
      groupRemainingNonLabeledSectionLineChunks(sourceResponse, labeledSections).flatMap((chunk) =>
        extractQuestionAuthorityTextsFromText(chunk),
      ),
    )
  }

  function assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority(text: string) {
    const sentences = parseTopicSourceResponseSentences(text)
    if (sentences.length < 2) {
      return
    }

    const [firstSentence, ...answerSentences] = sentences
    if (!firstSentence || !isQuestionSourceResponseSentence(firstSentence.text)) {
      return
    }

    assertQuestionAnswerTopicAuthorityMatchesQuestion(
      normalizeQuestionSourceResponsePrompt(firstSentence.text),
      answerSentences.map((sentence) => sentence.text).join(' '),
      'Question span',
    )
  }

  function assertLabeledSectionsDidNotSkipMalformedExplicitInlineTopicsOutsideParsedSections(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    for (const chunk of groupRemainingNonLabeledSectionLineChunks(
      sourceResponse,
      labeledSections,
    )) {
      const parsedInlineTopic = parseInlineTopicClause(chunk)
      if (!parsedInlineTopic) {
        continue
      }

      if (inlineTopicClauseUsesExplicitLabelValueSeparator(chunk)) {
        assertExplicitLabelTextDoesNotContainAuthority(
          parsedInlineTopic.label,
          'Inline topic clause label',
        )
      }
      assertLabeledValueAuthorityMatchesLabel(
        parsedInlineTopic.label,
        parsedInlineTopic.value,
        'Inline topic clause',
        'answer text',
      )
    }
  }

  function groupRemainingNonLabeledSectionLineChunks(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared || labeledSections.size === 0) {
      return []
    }

    const sectionLineIndexes = new Set<number>()
    for (const section of labeledSections.values()) {
      if (typeof section.sourceLineIndex === 'number') {
        sectionLineIndexes.add(section.sourceLineIndex)
      }
    }
    if (sectionLineIndexes.size === 0) {
      return []
    }

    const chunks: string[] = []
    let currentChunkLines: string[] = []

    const flushCurrentChunk = () => {
      if (currentChunkLines.length === 0) {
        return
      }
      chunks.push(currentChunkLines.join(' '))
      currentChunkLines = []
    }

    for (const [lineIndex, line] of shared.split(/\r?\n/).entries()) {
      if (sectionLineIndexes.has(lineIndex)) {
        flushCurrentChunk()
        continue
      }

      const trimmed = stripLeadingPresentationListMarkers(line.trim())
      if (!trimmed) {
        flushCurrentChunk()
        continue
      }

      currentChunkLines.push(trimmed)
    }

    flushCurrentChunk()
    return chunks
  }

  function assertLabeledSectionsDidNotSkipMalformedQuestionSpanAuthorityOutsideParsedSections(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    for (const chunk of groupRemainingNonLabeledSectionLineChunks(
      sourceResponse,
      labeledSections,
    )) {
      assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority(chunk)
    }
  }

  function assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    assertLabeledSectionsDidNotSkipMalformedExplicitInlineTopicsOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    assertLabeledSectionsDidNotSkipMalformedQuestionSpanAuthorityOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    const authorities = listStandaloneQuestionAuthoritiesOutsideLabeledSections(
      sourceResponse,
      labeledSections,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat auto rejected labeled_sections because sourceResponse still included standalone question authority ${formatQuotedValueList(authorities)} outside labeled sections.`,
    )
  }

  function assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    assertLabeledSectionsDidNotSkipMalformedExplicitInlineTopicsOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    assertLabeledSectionsDidNotSkipMalformedQuestionSpanAuthorityOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    const authorities = listStandaloneQuestionAuthoritiesOutsideLabeledSections(
      sourceResponse,
      labeledSections,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat labeled_sections rejected sourceResponse because it still included standalone question authority ${formatQuotedValueList(authorities)} outside labeled sections.`,
    )
  }

  function listStandaloneExplicitTopicAuthoritiesOutsideLabeledSections(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    const authorities: string[] = []
    for (const chunk of groupRemainingNonLabeledSectionLineChunks(
      sourceResponse,
      labeledSections,
    )) {
      const parsedInlineTopic = parseInlineTopicClause(chunk)
      if (parsedInlineTopic && inlineTopicClauseUsesExplicitLabelValueSeparator(chunk)) {
        try {
          assertExplicitLabelTextDoesNotContainAuthority(
            parsedInlineTopic.label,
            'Inline topic clause label',
          )
          assertLabeledValueAuthorityMatchesLabel(
            parsedInlineTopic.label,
            parsedInlineTopic.value,
            'Inline topic clause',
            'answer text',
          )
          authorities.push(parsedInlineTopic.label)
          continue
        } catch (error) {
          if (!(error instanceof AnswerInterpretationError)) {
            throw error
          }
        }
      }

      authorities.push(...extractExplicitTopicSummariesFromQuestionAnswerText(chunk))
    }

    return dedupeNonEmptyStrings(authorities)
  }

  function assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    assertLabeledSectionsDidNotSkipMalformedExplicitInlineTopicsOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    const authorities = listStandaloneExplicitTopicAuthoritiesOutsideLabeledSections(
      sourceResponse,
      labeledSections,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat auto rejected labeled_sections because sourceResponse still included standalone topic authority for ${formatQuotedValueList(authorities)} outside labeled sections.`,
    )
  }

  function assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority(
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) {
    assertLabeledSectionsDidNotSkipMalformedExplicitInlineTopicsOutsideParsedSections(
      sourceResponse,
      labeledSections,
    )
    const authorities = listStandaloneExplicitTopicAuthoritiesOutsideLabeledSections(
      sourceResponse,
      labeledSections,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat labeled_sections rejected sourceResponse because it still included standalone topic authority for ${formatQuotedValueList(authorities)} outside labeled sections.`,
    )
  }

  function listStandaloneQuestionAuthoritiesOutsideInlineTopics(
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared || inlineTopics.size === 0 || !consumedInlineTopicLabels?.size) {
      return []
    }

    const inlineClauseIndexes = collectSemanticallyValidInlineTopicClauseIndexes(shared)
    if (inlineClauseIndexes.size === 0) {
      return []
    }

    for (const chunk of groupRemainingNonInlineTopicClauseChunks(shared, inlineClauseIndexes)) {
      assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority(chunk)
    }

    const authorities: string[] = []
    for (const [clauseIndex, clause] of splitInlineTopicClauses(shared).entries()) {
      if (inlineClauseIndexes.has(clauseIndex)) {
        continue
      }

      authorities.push(...extractQuestionAuthorityTextsFromText(clause))
    }

    return dedupeNonEmptyStrings(authorities)
  }

  function groupRemainingNonInlineTopicClauseChunks(
    sourceResponse: string,
    inlineClauseIndexes: Set<number>,
  ) {
    const chunks: string[] = []
    let currentChunkClauses: string[] = []

    for (const [clauseIndex, clause] of splitInlineTopicClauses(sourceResponse).entries()) {
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

  function assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority(
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) {
    const authorities = listStandaloneQuestionAuthoritiesOutsideInlineTopics(
      sourceResponse,
      inlineTopics,
      consumedInlineTopicLabels,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone question authority ${formatQuotedValueList(authorities)} outside inline topic clauses.`,
    )
  }

  function listStandaloneExplicitTopicAuthoritiesOutsideInlineTopics(
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared || inlineTopics.size === 0 || !consumedInlineTopicLabels?.size) {
      return []
    }

    const inlineClauseIndexes = collectSemanticallyValidInlineTopicClauseIndexes(shared)
    if (inlineClauseIndexes.size === 0) {
      return []
    }

    const authorities: string[] = []
    for (const [clauseIndex, clause] of splitInlineTopicClauses(shared).entries()) {
      if (inlineClauseIndexes.has(clauseIndex)) {
        continue
      }

      authorities.push(...extractExplicitTopicSummariesFromQuestionAnswerText(clause))
    }

    return dedupeNonEmptyStrings(authorities)
  }

  function assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority(
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) {
    const authorities = listStandaloneExplicitTopicAuthoritiesOutsideInlineTopics(
      sourceResponse,
      inlineTopics,
      consumedInlineTopicLabels,
    )
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone topic authority for ${formatQuotedValueList(authorities)} outside inline topic clauses.`,
    )
  }

  function listAdditionalVerbalInlineTopicAuthoritiesAlongsideSeparatorStyleInlineTopics(
    sourceResponse: string | undefined,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      return []
    }

    let hasSeparatorStyleInlineTopic = false
    const verbalAuthorities: string[] = []
    for (const clause of splitInlineTopicClauses(shared)) {
      const trimmedClause = stripLeadingPresentationListMarkers(
        clause.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (!trimmedClause) {
        continue
      }

      const parsed = parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      try {
        if (inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
          assertExplicitLabelTextDoesNotContainAuthority(parsed.label, 'Inline topic clause label')
          assertLabeledValueAuthorityMatchesLabel(
            parsed.label,
            parsed.value,
            'Inline topic clause',
            'answer text',
          )
          hasSeparatorStyleInlineTopic = true
          continue
        }

        assertLabeledValueAuthorityMatchesLabel(
          parsed.label,
          parsed.value,
          'Inline topic clause',
          'answer text',
        )
        verbalAuthorities.push(parsed.label)
      } catch (error) {
        if (error instanceof AnswerInterpretationError) {
          continue
        }
        throw error
      }
    }

    if (!hasSeparatorStyleInlineTopic) {
      return []
    }

    return dedupeNonEmptyStrings(verbalAuthorities)
  }

  function assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority(
    sourceResponse: string | undefined,
  ) {
    const authorities =
      listAdditionalVerbalInlineTopicAuthoritiesAlongsideSeparatorStyleInlineTopics(sourceResponse)
    if (authorities.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat inline_topics rejected sourceResponse because it mixed separator-style inline topic authority with additional verbal inline topic authority for ${formatQuotedValueList(authorities)}.`,
    )
  }

  function collectSemanticallyValidInlineTopicClauseIndexes(sourceResponse: string) {
    const indexes = new Set<number>()

    for (const [clauseIndex, clause] of splitInlineTopicClauses(sourceResponse).entries()) {
      if (isSemanticallyValidInlineTopicClause(clause)) {
        indexes.add(clauseIndex)
      }
    }

    return indexes
  }

  function isSemanticallyValidInlineTopicClause(clause: string) {
    const trimmedClause = stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmedClause) {
      return false
    }
    if (extractQuestionAuthorityTextsFromText(trimmedClause).length > 0) {
      return false
    }

    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      return false
    }

    try {
      if (inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
        assertExplicitLabelTextDoesNotContainAuthority(parsed.label, 'Inline topic clause label')
      }
      assertLabeledValueAuthorityMatchesLabel(
        parsed.label,
        parsed.value,
        'Inline topic clause',
        'answer text',
      )
      return true
    } catch (error) {
      if (error instanceof AnswerInterpretationError) {
        return false
      }
      throw error
    }
  }

  function autoTopicSurfaceEstablishedExplicitAuthority(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (!sourceResponseState) {
      return false
    }

    const hasExplicitText = (texts: string[] | undefined) =>
      Boolean(texts?.some((text) => textHasSingleExplicitTopicAuthority(text)))

    switch (sourceResponseFormat) {
      case 'topic_clauses':
        return (
          (sourceResponseState.topicClauses?.length ?? 0) > 1 &&
          hasExplicitText(sourceResponseState.topicClauses?.map((clause) => clause.text))
        )
      case 'topic_spans':
        return hasExplicitText(sourceResponseState.topicSpans?.map((span) => span.anchorText))
      case 'topic_middle_spans':
        return hasExplicitText(sourceResponseState.topicMiddleSpans?.map((span) => span.anchorText))
      case 'topic_closing_spans':
        return hasExplicitText(
          sourceResponseState.topicClosingSpans?.map((span) => span.closingText),
        )
      default:
        return false
    }
  }

  return {
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
  }
}
